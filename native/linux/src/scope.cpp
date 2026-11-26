#include <algorithm>
#include <stdexcept>
#include <unordered_map>
#include <unordered_set>
#include <utility>

#include "point.hpp"
#include "container.hpp"
#include "weft/gtk.hpp"

namespace weft {

namespace {

GtkWidget *child_at(GtkWidget *container, size_t index) {
  auto *child = gtk_widget_get_first_child(container);
  for (; child && index > 0; index--) child = gtk_widget_get_next_sibling(child);
  return child;
}

/// For each scope of `next`, whether its widgets keep their place.
std::vector<uint8_t> stable_rows(const std::vector<Scope *> &previous, const std::vector<Scope *> &next) {
  std::vector<uint8_t> stable(next.size(), 0);
  if (previous.empty() || next.empty()) return stable;
  std::vector<uint32_t> old_rows;
  std::vector<uint32_t> new_rows;
  old_rows.reserve(previous.size());
  new_rows.reserve(next.size());
  for (auto *scope : previous) old_rows.push_back(scope->id());
  for (auto *scope : next) new_rows.push_back(scope->id());
  weft_stable_rows(old_rows.data(), old_rows.size(), new_rows.data(), new_rows.size(), stable.data());
  return stable;
}

}  // namespace

// Scope.

Scope::Scope(uint32_t id, Session &session, size_t points)
    : id_(id), session_(session), roots_(*this), points_(points) {}

Scope::~Scope() {
  if (page_widget_) g_object_unref(page_widget_);
  if (back_button_) g_object_unref(back_button_);
}

void Scope::init_page() {
  page_widget_ = GTK_WIDGET(g_object_ref_sink(gtk_box_new(GTK_ORIENTATION_VERTICAL, 0)));
  GtkWidget *content = linear_new(Axis::Vertical);
  gtk_widget_set_vexpand(content, true);
  roots_.container_ = content;
  roots_.scope_ = nullptr;
  auto &bar = make<NavBar>();
  back_button_ = GTK_WIDGET(g_object_ref_sink(gtk_button_new_from_icon_name("go-previous-symbolic")));
  gtk_widget_set_visible(back_button_, false);
  g_signal_connect(back_button_, "clicked", G_CALLBACK(+[](GtkButton *, gpointer data) {
    static_cast<Scope *>(data)->session_.back();
  }), this);
  set_page_bar(bar);
  gtk_box_append(GTK_BOX(page_widget_), content);
}

void Scope::set_page_bar(NavBar &bar) {
  if (page_header_) {
    gtk_center_box_set_start_widget(GTK_CENTER_BOX(page_header_), nullptr);
    gtk_box_remove(GTK_BOX(page_widget_), page_header_);
  }
  page_header_ = bar.widget();
  bar.set_back(back_button_);
  gtk_box_prepend(GTK_BOX(page_widget_), page_header_);
}

void Scope::apply(uint32_t, const ops::Value &) {}

bool Scope::dispatch(uint32_t slot) { return session_.dispatch(id_, slot, {}); }

bool Scope::dispatch(uint32_t slot, bool value) {
  std::string payload;
  ops::encode_value(value, payload);
  return session_.dispatch(id_, slot, payload);
}

bool Scope::dispatch(uint32_t slot, double value) {
  std::string payload;
  ops::encode_value(value, payload);
  return session_.dispatch(id_, slot, payload);
}

bool Scope::dispatch(uint32_t slot, std::string_view value) {
  std::string payload;
  ops::encode_value(value, payload);
  return session_.dispatch(id_, slot, payload);
}

void Scope::dispatch_focus(uint32_t slot, bool focused) { session_.queue_focus(id_, slot, focused); }

// Region.

void Region::add(const Element &element) {
  parts_.push_back({element.widget(), nullptr});
  if (container_) gtk_widget_set_parent(element.widget(), container_);
}

void Region::point(Scope &owner, size_t index) {
  auto &point = owner.points_.at(index);
  point = std::make_unique<Point>(*this);
  parts_.push_back({nullptr, point.get()});
}

size_t Region::count() const {
  size_t count = 0;
  for (auto &part : parts_) count += part.point ? part.point->count() : 1;
  return count;
}

void Region::collect(std::vector<GtkWidget *> &widgets) const {
  for (auto &part : parts_) {
    if (!part.point) {
      widgets.push_back(part.widget);
      continue;
    }
    for (auto *child : part.point->children) child->roots_.collect(widgets);
  }
}

size_t Region::offset(const Point &point) const {
  size_t offset = 0;
  for (auto &part : parts_) {
    if (part.point == &point) return offset;
    offset += part.point ? part.point->count() : 1;
  }
  throw std::logic_error("the point belongs to another region");
}

bool Region::locate(const Point &point, Region *&container, size_t &index) {
  Region *region = &point.region;
  index = region->offset(point);
  while (!region->container_) {
    Scope *scope = region->scope_;
    Point *parent = scope->parent_;
    if (!parent) return false;
    index += parent->offset(*scope);
    region = &parent->region;
    index += region->offset(*parent);
  }
  container = region;
  return true;
}

void Region::insert(size_t index, GtkWidget *widget) {
  gtk_widget_insert_before(widget, container_, child_at(container_, index));
}

void Region::remove(size_t index, size_t count) {
  for (size_t i = 0; i < count; i++) gtk_widget_unparent(child_at(container_, index));
}

// Point.

size_t Point::count() const {
  size_t count = 0;
  for (auto *child : children) count += child->roots_.count();
  return count;
}

size_t Point::offset(const Scope &child) const {
  size_t offset = 0;
  for (auto *other : children) {
    if (other == &child) return offset;
    offset += other->roots_.count();
  }
  throw std::logic_error("the scope is not mounted at this point");
}

void Point::mount(std::vector<Scope *> next) {
  std::vector<Scope *> old = std::exchange(children, std::move(next));
  for (auto *child : old) {
    if (child->parent_ == this) child->parent_ = nullptr;
  }
  for (auto *child : children) child->parent_ = this;
  // Widgets are only placed once the point's scope renders into a stack;
  // until then mounting its scope places the whole subtree.
  Region *container = nullptr;
  size_t start = 0;
  if (!Region::locate(*this, container, start)) return;

  // Remove the widgets of children that are gone, last first so earlier offsets stay valid.
  std::unordered_set<Scope *> kept(children.begin(), children.end());
  std::vector<size_t> offsets(old.size());
  size_t offset = start;
  for (size_t i = 0; i < old.size(); i++) {
    offsets[i] = offset;
    offset += old[i]->roots_.count();
  }
  std::vector<Scope *> survivors;
  survivors.reserve(old.size());
  size_t end = offset;
  for (size_t i = old.size(); i-- > 0;) {
    if (kept.contains(old[i])) {
      survivors.push_back(old[i]);
      continue;
    }
    size_t count = old[i]->roots_.count();
    container->remove(offsets[i], count);
    end -= count;
  }
  std::reverse(survivors.begin(), survivors.end());

  std::vector<uint8_t> stable = stable_rows(survivors, children);
  std::unordered_map<Scope *, size_t> survivor_indices;
  survivor_indices.reserve(survivors.size());
  for (size_t i = 0; i < survivors.size(); i++) survivor_indices.emplace(survivors[i], i);

  std::vector<bool> keep_in_place(survivors.size(), false);
  for (size_t i = 0; i < children.size(); i++) {
    if (stable[i]) keep_in_place[survivor_indices.at(children[i])] = true;
  }

  // Remove non-stable survivors right-to-left using their known offsets in O(N).
  std::vector<size_t> survivor_offsets(survivors.size());
  size_t pos = start;
  for (size_t i = 0; i < survivors.size(); i++) {
    survivor_offsets[i] = pos;
    pos += survivors[i]->roots_.count();
  }
  for (size_t i = survivors.size(); i-- > 0;) {
    if (keep_in_place[i]) continue;
    size_t count = survivors[i]->roots_.count();
    container->remove(survivor_offsets[i], count);
    end -= count;
  }

  std::unordered_map<Scope *, size_t> stable_offsets;
  stable_offsets.reserve(survivors.size());
  pos = start;
  for (size_t i = 0; i < survivors.size(); i++) {
    if (!keep_in_place[i]) continue;
    stable_offsets.emplace(survivors[i], pos);
    pos += survivors[i]->roots_.count();
  }

  std::vector<GtkWidget *> widgets;
  // Place the children last to first in front of `anchor`, the index where the next child's widgets start.
  size_t anchor = end;
  for (size_t i = children.size(); i-- > 0;) {
    Scope *child = children[i];
    if (stable[i]) {
      anchor = stable_offsets.at(child);
      continue;
    }
    widgets.clear();
    child->roots_.collect(widgets);
    for (size_t j = 0; j < widgets.size(); j++) container->insert(anchor + j, widgets[j]);
  }
}

}  // namespace weft
