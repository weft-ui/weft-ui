#include <weft/gtk.hpp>
#include <weft/protocol.hpp>

#include <cassert>
#include <cstdint>
#include <initializer_list>
#include <utility>
#include <vector>

namespace {
uint32_t window_start, window_end, tail_start, tail_end;
unsigned windows;
}
extern "C" void weft_runtime_window(weft_runtime *, uint32_t scope, uint32_t, uint32_t start, uint32_t end) {
  if (scope == 1) { window_start = start; window_end = end; ++windows; }
  if (scope == 4) { tail_start = start; tail_end = end; }
}

namespace weft {
namespace {
class Owner : public Scope {
 public:
  Owner(uint32_t id, Session &session, bool grid, bool sections = false) : Scope(id, session, 1) {
    if (grid) list = &make<Grid>(3);
    else list = &make<List>();
    list->set_padding(20);
    roots().add(*list);
    auto &head = make<Spacer>();
    list->children().add(head);
    if (sections) list->children().lazy_point(*this, 0, {1, 4});
    else list->children().lazy_point(*this, 0, {1});
    auto &foot = make<Spacer>();
    list->children().add(foot);
  }
  List *list;
};
class Row : public Scope {
 public:
  Row(uint32_t id, Session &session) : Scope(id, session) {
    auto &text = make<Text>();
    text.set_value("bound row");
    roots().add(text);
  }
};
std::unique_ptr<Scope> make_scope(uint32_t tpl, uint32_t id, Session &session) {
  if (tpl == 0) return std::make_unique<Owner>(id, session, false);
  if (tpl == 2) return std::make_unique<Owner>(id, session, true);
  if (tpl == 3) return std::make_unique<Owner>(id, session, false, true);
  return std::make_unique<Row>(id, session);
}
void append(std::vector<uint8_t> &bytes, uint32_t value) {
  for (unsigned shift = 0; shift < 32; shift += 8) bytes.push_back(uint8_t(value >> shift));
}
void bound_rows(GtkWidget *widget, std::vector<GtkWidget *> &rows) {
  if (GTK_IS_LABEL(widget) && std::string_view(gtk_label_get_text(GTK_LABEL(widget))) == "bound row") rows.push_back(widget);
  for (auto *child = gtk_widget_get_first_child(widget); child; child = gtk_widget_get_next_sibling(child))
    bound_rows(child, rows);
}
bool has_bound_row(GtkWidget *widget) {
  if (GTK_IS_LABEL(widget) && std::string_view(gtk_label_get_text(GTK_LABEL(widget))) == "bound row") return true;
  for (auto *child = gtk_widget_get_first_child(widget); child; child = gtk_widget_get_next_sibling(child))
    if (has_bound_row(child)) return true;
  return false;
}
}

class ListTest {
 public:
  static void run() {
    auto *page = GTK_WIDGET(g_object_ref_sink(gtk_box_new(GTK_ORIENTATION_VERTICAL, 0)));
    {
      Session session(page, make_scope, false);
      auto create = [&](uint32_t id, uint32_t tpl) {
        ops::Op op{}; op.code = protocol::Code::Create; op.scope = id; op.index = tpl; session.apply(op);
      };
      auto splice = [&](uint32_t owner, uint32_t index, uint32_t remove, std::initializer_list<uint32_t> ids) {
        std::vector<uint8_t> bytes;
        for (auto id : ids) { append(bytes, id); append(bytes, 0); }
        ops::Op op{}; op.code = protocol::Code::Splice; op.scope = owner;
        op.splice = {index, remove, {bytes.data(), uint32_t(ids.size())}};
        session.apply(op);
      };
      auto bind = [&](uint32_t owner, uint32_t item, uint32_t child) {
        ops::Op op{}; op.code = protocol::Code::Bind; op.scope = owner; op.bind = {item, child}; session.apply(op);
      };
      auto model = [](Owner *owner) {
        auto *scroll = GTK_SCROLLED_WINDOW(gtk_widget_get_first_child(owner->list->widget()));
        auto *view = GTK_LIST_VIEW(gtk_scrolled_window_get_child(scroll));
        return G_LIST_MODEL(gtk_list_view_get_model(view));
      };
      create(1, 0);
      auto *owner = static_cast<Owner *>(session.scopes_.at(1).get());
      assert(g_list_model_get_n_items(model(owner)) == 2); // static content with no items
      splice(1, 0, 0, {10, 11, 12});
      assert(g_list_model_get_n_items(model(owner)) == 5);
      create(20, 1); bind(1, 11, 20);
      splice(1, 0, 0, {9}); // prefix insertion retains the bound scope
      assert(session.scopes_.contains(20));
      splice(1, 4, 0, {13}); // suffix insertion
      assert(g_list_model_get_n_items(model(owner)) == 7);
      splice(1, 0, 5, {13, 11, 9}); // reorder retains item 11
      assert(session.scopes_.contains(20));
      bind(1, 11, 0);
      assert(!session.scopes_.contains(20));
      create(21, 1); bind(1, 11, 21);
      splice(1, 1, 1, {});
      assert(!session.scopes_.contains(21));
      auto *owner_scroll = GTK_SCROLLED_WINDOW(gtk_widget_get_first_child(owner->list->widget()));
      auto *owner_view = GTK_LIST_VIEW(gtk_scrolled_window_get_child(owner_scroll));
      auto *owner_selection = GTK_NO_SELECTION(gtk_list_view_get_model(owner_view));
      assert(GTK_IS_SECTION_MODEL(gtk_no_selection_get_model(owner_selection)));

      create(2, 2);
      auto *grid = static_cast<Owner *>(session.scopes_.at(2).get());
      splice(2, 0, 0, {1, 2, 3, 4, 5, 6, 7});
      assert(g_list_model_get_n_items(model(grid)) == 5); // header + three rows + footer

      create(3, 3);
      auto *grouped = static_cast<Owner *>(session.scopes_.at(3).get());
      std::vector<uint8_t> section_bytes;
      for (auto [id, tpl] : {std::pair{30u, 0u}, std::pair{31u, 1u}, std::pair{32u, 0u}, std::pair{33u, 1u}}) {
        append(section_bytes, id); append(section_bytes, tpl);
      }
      ops::Op sections{}; sections.code = protocol::Code::Splice; sections.scope = 3;
      sections.splice.items = {section_bytes.data(), 4}; session.apply(sections);
      auto *group_scroll = GTK_SCROLLED_WINDOW(gtk_widget_get_first_child(grouped->list->widget()));
      auto *group_view = GTK_LIST_VIEW(gtk_scrolled_window_get_child(group_scroll));
      auto *group_selection = GTK_NO_SELECTION(gtk_list_view_get_model(group_view));
      auto *section_model = GTK_SECTION_MODEL(gtk_no_selection_get_model(group_selection));
      guint section_start, section_end;
      gtk_section_model_get_section(section_model, 1, &section_start, &section_end);
      assert(section_start == 1 && section_end == 3);
      gtk_section_model_get_section(section_model, 3, &section_start, &section_end);
      assert(section_start == 3 && section_end == 6);

      create(4, 0);
      auto *long_list = static_cast<Owner *>(session.scopes_.at(4).get());
      std::vector<uint8_t> long_bytes;
      for (uint32_t id = 1; id <= 1000; ++id) { append(long_bytes, id); append(long_bytes, 0); }
      ops::Op long_splice{}; long_splice.code = protocol::Code::Splice; long_splice.scope = 4;
      long_splice.splice.items = {long_bytes.data(), 1000}; session.apply(long_splice);
      auto *long_scroll = GTK_SCROLLED_WINDOW(gtk_widget_get_first_child(long_list->list->widget()));
      auto *long_adjustment = gtk_scrolled_window_get_vadjustment(long_scroll);
      gtk_adjustment_configure(long_adjustment, 99912, 0, 100000, 1, 44, 88);

      auto *scroll = GTK_SCROLLED_WINDOW(gtk_widget_get_first_child(owner->list->widget()));
      auto *adjustment = gtk_scrolled_window_get_vadjustment(scroll);
      session.runtime_ = reinterpret_cast<weft_runtime *>(1);
      gtk_adjustment_configure(adjustment, 0, 0, 1000, 1, 44, 88);
      while (g_main_context_pending(nullptr)) g_main_context_iteration(nullptr, false);
      assert(windows > 0 && window_start == 0 && window_end <= 2);
      assert(tail_start >= 990 && tail_end == 1000);
      session.runtime_ = nullptr;

      // A bind changes the content of an already-realized model item without
      // changing its identity. It must replace the placeholder immediately.
      create(5, 0);
      auto *visible = static_cast<Owner *>(session.scopes_.at(5).get());
      visible->list->set_gap(14);
      splice(5, 0, 0, {50, 51});
      auto *window = gtk_window_new();
      gtk_window_set_default_size(GTK_WINDOW(window), 320, 300);
      gtk_window_set_child(GTK_WINDOW(window), visible->list->widget());
      gtk_window_present(GTK_WINDOW(window));
      for (int i = 0; i < 50; ++i) {
        while (g_main_context_pending(nullptr)) g_main_context_iteration(nullptr, false);
        g_usleep(1000);
      }
      create(22, 1);
      bind(5, 50, 22);
      assert(has_bound_row(window));
      create(23, 1);
      bind(5, 51, 23);
      for (int i = 0; i < 50; ++i) {
        while (g_main_context_pending(nullptr)) g_main_context_iteration(nullptr, false);
        g_usleep(1000);
      }
      std::vector<GtkWidget *> labels;
      bound_rows(window, labels);
      assert(labels.size() == 2);
      graphene_rect_t first, second;
      assert(gtk_widget_compute_bounds(labels[0], window, &first));
      assert(gtk_widget_compute_bounds(labels[1], window, &second));
      assert(second.origin.y - (first.origin.y + first.size.height) == 14);
      bind(5, 51, 0);
      bind(5, 50, 0);
      assert(!has_bound_row(window));
      gtk_window_destroy(GTK_WINDOW(window));
    }
    g_object_unref(page);
  }
};
}

int main() {
  if (!gtk_init_check()) return 77;
  weft::ListTest::run();
}
