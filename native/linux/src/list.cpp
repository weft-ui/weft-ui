#include "weft/gtk.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <unordered_map>
#include <unordered_set>

#include "container.hpp"
#include "point.hpp"

// The list model owns no widgets: GTK asks for row tokens on demand.  Section
// boundaries are row indices, not item IDs (a grid row contains several IDs).
struct WeftListModel;
struct RowToken { WeftListModel *model; guint64 key; GObject *object; };
struct WeftListModel {
  GObject parent;
  guint count;
  std::vector<guint> *sections;
  std::vector<guint64> *keys;
  std::unordered_map<guint64, RowToken *> *tokens;
};
struct WeftListModelClass { GObjectClass parent; };
static GType model_item_type(GListModel *) { return G_TYPE_OBJECT; }
static guint model_count(GListModel *model) { return reinterpret_cast<WeftListModel *>(model)->count; }
static void token_finalized(gpointer data, GObject *) {
  auto *token = static_cast<RowToken *>(data);
  token->model->tokens->erase(token->key);
  delete token;
}
static gpointer model_item(GListModel *base, guint position) {
  auto *model = reinterpret_cast<WeftListModel *>(base);
  if (position >= model->count) return nullptr;
  auto key = (*model->keys)[position];
  auto found = model->tokens->find(key);
  if (found != model->tokens->end()) return g_object_ref(found->second->object);
  auto *object = G_OBJECT(g_object_new(G_TYPE_OBJECT, nullptr));
  auto *token = new RowToken{model, key, object};
  model->tokens->emplace(key, token);
  g_object_weak_ref(object, token_finalized, token);
  return object;
}
static void model_list_init(GListModelInterface *iface) {
  iface->get_item_type = model_item_type;
  iface->get_n_items = model_count;
  iface->get_item = model_item;
}
static void get_section(GtkSectionModel *model, guint position, guint *start, guint *end) {
  auto &sections = *reinterpret_cast<WeftListModel *>(model)->sections;
  auto it = std::upper_bound(sections.begin(), sections.end(), position);
  *start = it == sections.begin() ? 0 : *std::prev(it);
  *end = it == sections.end() ? model_count(G_LIST_MODEL(model)) : *it;
}
static void model_section_init(GtkSectionModelInterface *iface) { iface->get_section = get_section; }
G_DEFINE_TYPE_WITH_CODE(WeftListModel, weft_list_model, G_TYPE_OBJECT,
  G_IMPLEMENT_INTERFACE(G_TYPE_LIST_MODEL, model_list_init)
  G_IMPLEMENT_INTERFACE(GTK_TYPE_SECTION_MODEL, model_section_init))
static void weft_list_model_finalize(GObject *object) {
  auto *model = reinterpret_cast<WeftListModel *>(object);
  for (auto &[key, token] : *model->tokens) {
    g_object_weak_unref(token->object, token_finalized, token);
    delete token;
  }
  delete model->tokens;
  delete model->keys;
  delete model->sections;
  G_OBJECT_CLASS(weft_list_model_parent_class)->finalize(object);
}
static void weft_list_model_class_init(WeftListModelClass *klass) { G_OBJECT_CLASS(klass)->finalize = weft_list_model_finalize; }
static void weft_list_model_init(WeftListModel *model) {
  model->count = 0;
  model->sections = new std::vector<guint>;
  model->keys = new std::vector<guint64>;
  model->tokens = new std::unordered_map<guint64, RowToken *>;
}

namespace weft {

struct List::Impl {
  struct Item { uint32_t id, tpl; Scope *scope = nullptr; };
  struct Row { GtkWidget *fixed = nullptr; size_t first = 0, count = 0; };
  struct Measurement { Impl *owner; uint32_t tpl; int height = 0; };
  List &list;
  GtkScrolledWindow *scroll;
  GtkWidget *view;
  WeftListModel *model;
  Point *point = nullptr;
  Scope *owner = nullptr;
  uint32_t point_index = 0;
  int columns;
  int gap = 0;
  std::vector<Item> items;
  std::unordered_map<uint32_t, size_t> indices;
  std::vector<uint32_t> templates;
  std::vector<Row> rows;
  std::unordered_map<uint32_t, std::pair<double, unsigned>> heights;
  std::unordered_map<GtkWidget *, std::pair<uint32_t, WidgetLayout *>> placeholders;
  std::unordered_set<GtkListItem *> realized;
  guint idle = 0;
  uint32_t requested_start = 0, requested_end = 0;

  Impl(List &list, int columns) : list(list), columns(std::max(1, columns)) {
    scroll = GTK_SCROLLED_WINDOW(gtk_widget_get_first_child(list.widget()));
    model = reinterpret_cast<WeftListModel *>(g_object_new(weft_list_model_get_type(), nullptr));
    auto *factory = gtk_signal_list_item_factory_new();
    g_signal_connect(factory, "setup", G_CALLBACK(+[](GtkSignalListItemFactory *, GtkListItem *item, gpointer data) {
      auto &self = *static_cast<Impl *>(data);
      auto *row = self.columns > 1 ? gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0)
                                   : linear_new(Axis::Horizontal, CrossAlign::Stretch);
      if (self.columns == 1) gtk_widget_add_css_class(row, "weft-list-row");
      gtk_widget_set_hexpand(row, true);
      gtk_list_item_set_child(item, row);
    }), this);
    g_signal_connect(factory, "bind", G_CALLBACK(+[](GtkSignalListItemFactory *, GtkListItem *item, gpointer data) {
      auto &self = *static_cast<Impl *>(data);
      self.realized.insert(item);
      self.show(item);
      self.queue_window();
    }), this);
    g_signal_connect(factory, "unbind", G_CALLBACK(+[](GtkSignalListItemFactory *, GtkListItem *item, gpointer data) {
      auto &self = *static_cast<Impl *>(data);
      self.realized.erase(item);
      self.clear(item);
      self.queue_window();
    }), this);
    auto *selection = gtk_no_selection_new(G_LIST_MODEL(g_object_ref(model)));
    view = gtk_list_view_new(GTK_SELECTION_MODEL(selection), GTK_LIST_ITEM_FACTORY(factory));
    // GtkListView's theme supplies a background and row padding/minimum height.
    // List spacing and backgrounds belong to Weft, not the desktop theme.
    static bool css_installed = false;
    if (!css_installed) {
      auto *css = gtk_css_provider_new();
      gtk_css_provider_load_from_data(css,
          ".weft-list, .weft-list > row { background: transparent; }"
          ".weft-list > row { padding: 0; margin: 0; min-width: 0; min-height: 0; }", -1);
      gtk_style_context_add_provider_for_display(gtk_widget_get_display(view), GTK_STYLE_PROVIDER(css),
                                                 GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
      g_object_unref(css);
      css_installed = true;
    }
    gtk_widget_add_css_class(view, "weft-list");
    gtk_scrolled_window_set_child(scroll, view);
    auto *adjustment = gtk_scrolled_window_get_vadjustment(scroll);
    g_signal_connect(adjustment, "value-changed", G_CALLBACK(+[](GtkAdjustment *, gpointer data) { static_cast<Impl *>(data)->queue_window(); }), this);
    g_signal_connect(adjustment, "changed", G_CALLBACK(+[](GtkAdjustment *, gpointer data) { static_cast<Impl *>(data)->queue_window(); }), this);
  }
  ~Impl() {
    if (idle) g_source_remove(idle);
    g_signal_handlers_disconnect_by_data(gtk_scrolled_window_get_vadjustment(scroll), this);
    gtk_scrolled_window_set_child(scroll, nullptr);
    g_object_unref(model);
  }
  double estimate(uint32_t tpl) const {
    auto it = heights.find(tpl);
    return it == heights.end() ? 44.0 : it->second.first / it->second.second;
  }
  void rebuild(guint position = 0, guint removed = G_MAXUINT, guint added = G_MAXUINT) {
    guint old = model->count;
    rows.clear();
    model->sections->clear();
    for (auto &part : list.children_.parts_) {
      if (part.point) {
        for (size_t i = 0; i < items.size();) {
          // Section headers are independent list rows, even in a grid.
          size_t n = std::min<size_t>(columns, items.size() - i);
          rows.push_back({nullptr, i, n});
          i += n;
        }
      } else {
        rows.push_back({part.widget, 0, 0});
      }
    }
    if (templates.size() == 2) {
      for (guint i = 0; i < rows.size(); ++i)
        if (rows[i].count && items[rows[i].first].tpl == 0) model->sections->push_back(i);
    }
    model->keys->clear();
    model->keys->reserve(rows.size());
    for (const auto &row : rows) {
      guint64 key = row.fixed ? (guint64(reinterpret_cast<uintptr_t>(row.fixed)) | (guint64(1) << 63))
                             : items[row.first].id;
      model->keys->push_back(key);
    }
    model->count = guint(rows.size());
    if (removed == G_MAXUINT) { position = 0; removed = old; added = model->count; }
    if (removed || added) g_list_model_items_changed(G_LIST_MODEL(model), position, removed, added);
    if (model->count) gtk_section_model_sections_changed(GTK_SECTION_MODEL(model), 0, model->count);
    queue_window();
  }
  void clear(GtkListItem *item) {
    auto *box = gtk_list_item_get_child(item);
    while (auto *child = gtk_widget_get_first_child(box)) {
      placeholders.erase(child);
      if (auto *fixed = static_cast<GtkWidget *>(g_object_get_data(G_OBJECT(child), "weft-list-fixed")))
        gtk_widget_unparent(fixed);
      if (auto *scope = static_cast<Scope *>(g_object_get_data(G_OBJECT(child), "weft-list-scope"))) {
        while (auto *widget = gtk_widget_get_first_child(child)) gtk_widget_unparent(widget);
        scope->roots_.container_ = nullptr;
        scope->roots_.scope_ = scope;
      }
      if (columns > 1) gtk_box_remove(GTK_BOX(box), child);
      else gtk_widget_unparent(child);
    }
  }
  void show(GtkListItem *item) {
    auto position = gtk_list_item_get_position(item);
    if (position >= rows.size()) return;
    auto *box = gtk_list_item_get_child(item);
    if (columns > 1) gtk_box_set_spacing(GTK_BOX(box), gap);
    gtk_widget_set_margin_bottom(box, position + 1 < rows.size() ? gap : 0);
    auto append = [&](GtkWidget *child) {
      if (columns > 1) gtk_box_append(GTK_BOX(box), child);
      else gtk_widget_set_parent(child, box);
    };
    const Row &row = rows[position];
    if (row.fixed) {
      if (columns > 1) gtk_box_set_homogeneous(GTK_BOX(box), false);
      if (gtk_widget_get_parent(row.fixed)) gtk_widget_unparent(row.fixed);
      auto *cell = linear_new(Axis::Vertical, CrossAlign::Stretch, true);
      gtk_widget_set_hexpand(cell, true);
      auto &layout = attach_layout(cell);
      layout.grow = 1;
      layout.fill = true;
      gtk_widget_set_parent(row.fixed, cell);
      g_object_set_data(G_OBJECT(cell), "weft-list-fixed", row.fixed);
      append(cell);
      return;
    }
    if (columns > 1) gtk_box_set_homogeneous(GTK_BOX(box), true);
    for (size_t i = row.first; i < row.first + row.count; ++i) {
      auto &entry = items[i];
      auto *cell = linear_new(Axis::Vertical, CrossAlign::Stretch, true);
      gtk_widget_set_hexpand(cell, true);
      gtk_widget_set_valign(cell, GTK_ALIGN_START);
      auto &layout = attach_layout(cell);
      layout.grow = 1;
      layout.fill = true;
      if (entry.scope) {
        auto *scope = entry.scope;
        scope->roots_.container_ = cell;
        scope->roots_.scope_ = nullptr;
        std::vector<GtkWidget *> widgets;
        scope->roots_.collect(widgets);
        for (auto *widget : widgets) gtk_widget_set_parent(widget, cell);
        g_object_set_data(G_OBJECT(cell), "weft-list-scope", scope);
        g_object_set_data_full(G_OBJECT(cell), "weft-list-measurement", new Measurement{this, entry.tpl},
                               +[](gpointer data) { delete static_cast<Measurement *>(data); });
        container_on_allocate(cell, +[](GtkWidget *widget) {
          auto *measurement = static_cast<Measurement *>(g_object_get_data(G_OBJECT(widget), "weft-list-measurement"));
          int height = gtk_widget_get_height(widget);
          if (height <= 0 || height == measurement->height) return;
          auto &sample = measurement->owner->heights[measurement->tpl];
          sample.first += height - measurement->height;
          if (!measurement->height) ++sample.second;
          measurement->height = height;
          for (auto &[placeholder, entry] : measurement->owner->placeholders) {
            if (entry.first != measurement->tpl) continue;
            const auto height = int(std::ceil(measurement->owner->estimate(entry.first)));
            entry.second->size.min_height = height;
            gtk_widget_set_size_request(placeholder, -1, height);
            gtk_widget_queue_resize(placeholder);
          }
          measurement->owner->queue_window();
        });
      } else {
        placeholders.emplace(cell, std::pair{entry.tpl, &layout});
        const auto height = int(std::ceil(estimate(entry.tpl)));
        layout.size.min_height = height;
        gtk_widget_set_size_request(cell, -1, height);
      }
      append(cell);
    }
    for (size_t i = row.count; i < size_t(columns); ++i) {
      auto *empty = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
      gtk_widget_set_hexpand(empty, true);
      gtk_box_append(GTK_BOX(box), empty);
    }
  }
  void queue_window() {
    if (!owner || idle) return;
    idle = g_idle_add(+[](gpointer data) -> gboolean {
      auto &self = *static_cast<Impl *>(data);
      self.idle = 0;
      if (!self.owner || self.items.empty()) return G_SOURCE_REMOVE;
      auto *adjustment = gtk_scrolled_window_get_vadjustment(self.scroll);
      double top = gtk_adjustment_get_value(adjustment);
      double page = gtk_adjustment_get_page_size(adjustment);
      if (page <= 0) return G_SOURCE_REMOVE;
      auto row_height = [&](const Row &row) {
        if (!row.count) return double(std::max(1, gtk_widget_get_height(row.fixed)));
        double height = 0;
        for (size_t i = row.first; i < row.first + row.count; ++i)
          height = std::max(height, self.estimate(self.items[i].tpl));
        return height;
      };
      // GtkListView estimates its scroll extent independently of our per-template
      // estimates. Map its fraction to our extent so the final viewport always
      // requests the final items even while GTK is correcting its estimate.
      double total = 0;
      for (const auto &row : self.rows) total += row_height(row) + self.gap;
      const double range = gtk_adjustment_get_upper(adjustment) - page;
      if (range > 0) top = std::clamp(top / range, 0.0, 1.0) * std::max(0.0, total - page);
      double y = 0;
      uint32_t start = 0, end = uint32_t(self.items.size());
      bool found = false;
      for (const auto &row : self.rows) {
        double height = row_height(row);
        if (row.count) {
          if (!found && y + height >= std::max(0.0, top - page)) { start = uint32_t(row.first); found = true; }
          if (y > top + page * 2) { end = uint32_t(row.first); break; }
        }
        y += height + self.gap;
      }
      // The factory is authoritative about which rows GTK actually placed.
      // Its internal extent estimate can differ substantially from ours after
      // a large jump, so anchor the requested window to those allocations.
      size_t first_visible = self.rows.size(), last_visible = 0;
      for (auto *item : self.realized) {
        guint position = gtk_list_item_get_position(item);
        if (position >= self.rows.size() || !self.rows[position].count) continue;
        auto *widget = gtk_list_item_get_child(item);
        graphene_rect_t bounds;
        if (!gtk_widget_compute_bounds(widget, GTK_WIDGET(self.scroll), &bounds) ||
            bounds.size.height <= 0 || bounds.origin.y >= page || bounds.origin.y + bounds.size.height <= 0) continue;
        first_visible = std::min(first_visible, size_t(position));
        last_visible = std::max(last_visible, size_t(position));
      }
      // Immediately after a jump to the end GTK may still report allocations
      // from the previous frame. Keep the fraction-derived tail in that case.
      if (first_visible != self.rows.size() &&
          !(range > 0 && gtk_adjustment_get_value(adjustment) >= range - 1 &&
            last_visible + 1 < self.rows.size())) {
        size_t first = first_visible, last = last_visible + 1;
        double before = 0, after = 0;
        while (first > 0 && before < page) { --first; before += row_height(self.rows[first]) + self.gap; }
        while (last < self.rows.size() && after < page) { after += row_height(self.rows[last]) + self.gap; ++last; }
        start = uint32_t(self.rows[first_visible].first);
        for (size_t i = first; i < first_visible; ++i) if (self.rows[i].count) { start = uint32_t(self.rows[i].first); break; }
        end = uint32_t(self.rows[last_visible].first + self.rows[last_visible].count);
        for (size_t i = last_visible + 1; i < last; ++i) if (self.rows[i].count)
          end = uint32_t(self.rows[i].first + self.rows[i].count);
      }
      if (start != self.requested_start || end != self.requested_end) {
        self.requested_start = start; self.requested_end = end;
        self.owner->session_.window(self.owner->id(), self.point_index, start, end);
      }
      return G_SOURCE_REMOVE;
    }, this);
  }
};

List::List(int columns) : Padded(linear_new(Axis::Vertical)) {
  auto *scroll = gtk_scrolled_window_new();
  auto &scroll_layout = attach_layout(scroll);
  scroll_layout.grow = 1;
  scroll_layout.fill = true;
  gtk_widget_set_parent(scroll, widget());
  children_.list_ = this;
  layout().grow = 1;
  layout().fill = true;
  impl_ = std::make_unique<Impl>(*this, columns);
  set_indicators(true);
}
List::~List() = default;
void List::shutdown() {
  if (impl_->idle) { g_source_remove(impl_->idle); impl_->idle = 0; }
  impl_->owner = nullptr;
  gtk_scrolled_window_set_child(impl_->scroll, nullptr);
}
void List::set_gap(double gap) { impl_->gap = std::max(0, int(gap)); impl_->rebuild(); }
void List::set_indicators(bool indicators) {
  gtk_scrolled_window_set_policy(impl_->scroll, GTK_POLICY_NEVER, indicators ? GTK_POLICY_AUTOMATIC : GTK_POLICY_EXTERNAL);
}
void List::register_point(Scope &owner, size_t index, Point &point, std::initializer_list<uint32_t> templates) {
  if (impl_->point) throw std::logic_error("list has more than one lazy point");
  impl_->point = &point; impl_->owner = &owner; impl_->point_index = uint32_t(index); point.list = this;
  impl_->templates.assign(templates);
  impl_->rebuild();
}
void List::children_changed() { impl_->rebuild(); }
void List::splice(const ops::Splice &splice) {
  auto &items = impl_->items;
  if (splice.index > items.size() || splice.remove > items.size() - splice.index) throw std::logic_error("invalid lazy splice");
  std::unordered_map<uint32_t, Impl::Item> removed;
  for (size_t i = splice.index; i < splice.index + splice.remove; ++i) removed.emplace(items[i].id, items[i]);
  std::vector<Impl::Item> inserted;
  std::unordered_set<uint32_t> ids;
  for (size_t i = 0; i < items.size(); ++i) if (i < splice.index || i >= splice.index + splice.remove) ids.insert(items[i].id);
  for (auto entry : splice.items) {
    if (!entry.item || !ids.insert(entry.item).second) throw std::logic_error("duplicate lazy item");
    if (entry.template_index >= impl_->templates.size()) throw std::logic_error("invalid lazy item template");
    auto old = removed.find(entry.item);
    if (old != removed.end() && old->second.tpl != entry.template_index) throw std::logic_error("lazy item template changed");
    inserted.push_back(old == removed.end() ? Impl::Item{entry.item, entry.template_index} : old->second);
    if (old != removed.end()) removed.erase(old);
  }
  const size_t columns = size_t(impl_->columns);
  const size_t old_rows = (items.size() + columns - 1) / columns;
  const size_t new_size = items.size() - splice.remove + inserted.size();
  const size_t new_rows = (new_size + columns - 1) / columns;
  size_t leading = 0;
  for (const auto &part : children_.parts_) { if (part.point) break; ++leading; }
  size_t first = splice.index / columns;
  size_t suffix = 0;
  if ((splice.remove % columns) == (inserted.size() % columns)) {
    auto old_end = (splice.index + splice.remove + columns - 1) / columns;
    auto new_end = (splice.index + inserted.size() + columns - 1) / columns;
    suffix = std::min(old_rows - old_end, new_rows - new_end);
  }
  for (auto &[id, item] : removed) if (item.scope) std::erase(impl_->point->children, item.scope);
  items.erase(items.begin() + splice.index, items.begin() + splice.index + splice.remove);
  items.insert(items.begin() + splice.index, inserted.begin(), inserted.end());
  impl_->indices.clear();
  for (size_t i = 0; i < items.size(); ++i) impl_->indices.emplace(items[i].id, i);
  if (!impl_->model->count) impl_->rebuild();
  else impl_->rebuild(guint(leading + first), guint(old_rows - first - suffix), guint(new_rows - first - suffix));
  // GTK has now unbound affected cells; the scopes can safely be retired.
  for (auto &[id, item] : removed) if (item.scope) impl_->owner->session_.destroy(*item.scope);
}
void List::bind(uint32_t id, Scope *child) {
  auto &items = impl_->items;
  auto index_it = impl_->indices.find(id);
  if (index_it == impl_->indices.end()) throw std::logic_error("bind references an unknown item");
  auto found = items.begin() + index_it->second;
  if (child && child->template_index_ != impl_->templates[found->tpl]) throw std::logic_error("bind template differs from item");
  if (found->scope == child) return;
  Scope *old = found->scope;
  if (old) std::erase(impl_->point->children, old);
  found->scope = child;
  if (child) { child->parent_ = impl_->point; impl_->point->children.push_back(child); }
  size_t index = size_t(found - items.begin());
  for (auto *item : impl_->realized) {
    guint row = gtk_list_item_get_position(item);
    if (row >= impl_->rows.size()) continue;
    const auto &entry = impl_->rows[row];
    if (entry.count && index >= entry.first && index < entry.first + entry.count) {
      // The model item and its identity have not changed. Refresh the realized
      // cell directly; GTK may coalesce a remove/add of the same object.
      impl_->clear(item);
      impl_->show(item);
      break;
    }
  }
  if (old) impl_->owner->session_.destroy(*old);
}

}  // namespace weft
