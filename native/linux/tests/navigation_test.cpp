#include <weft/gtk.hpp>
#include <weft/protocol.hpp>

#include <cassert>
#include <initializer_list>
#include <string>
#include <vector>

namespace {
std::string signal_name;
std::string signal_json;
}

// Capture the actual kernel signal sent by the session without starting Hermes.
extern "C" void weft_runtime_signal(weft_runtime *, const char *name, const char *json, size_t len) {
  signal_name = name;
  signal_json.assign(json, len);
}

namespace weft {
namespace {
class Page final : public Scope {
 public:
  Page(uint32_t id, Session &session) : Scope(id, session) { init_page(); }
};

std::unique_ptr<Scope> make_page(uint32_t, uint32_t id, Session &session) {
  return std::make_unique<Page>(id, session);
}

std::vector<uint8_t> encode_ids(std::initializer_list<uint32_t> ids) {
  std::vector<uint8_t> bytes;
  for (uint32_t id : ids) {
    for (unsigned shift = 0; shift < 32; shift += 8) bytes.push_back(uint8_t(id >> shift));
  }
  return bytes;
}
}

class NavigationTest {
 public:
  static void run() {
    auto *page = GTK_WIDGET(g_object_ref_sink(gtk_box_new(GTK_ORIENTATION_VERTICAL, 0)));
    {
      Session session(page, make_page, true);
      session.runtime_ = reinterpret_cast<weft_runtime *>(1);
      signal_name.clear();
      session.lifecycle_state(GdkToplevelState(0));
      assert(signal_name.empty());
      session.lifecycle_state(GDK_TOPLEVEL_STATE_MINIMIZED);
      assert(signal_name == "lifecycle" && signal_json == "{\"state\":\"background\"}");
      signal_name.clear();
      session.lifecycle_state(GDK_TOPLEVEL_STATE_MINIMIZED);
#if GTK_CHECK_VERSION(4, 12, 0)
      session.lifecycle_state(GdkToplevelState(GDK_TOPLEVEL_STATE_MINIMIZED | GDK_TOPLEVEL_STATE_SUSPENDED));
      session.lifecycle_state(GDK_TOPLEVEL_STATE_SUSPENDED);
#endif
      assert(signal_name.empty());
      session.lifecycle_state(GdkToplevelState(0));
      assert(signal_name == "lifecycle" && signal_json == "{\"state\":\"foreground\"}");
      signal_name.clear();
      session.lifecycle_state(GdkToplevelState(0));
      assert(signal_name.empty());
      session.runtime_ = nullptr;
      auto create = [&](uint32_t id) {
        ops::Op op{};
        op.code = protocol::Code::Create;
        op.scope = id;
        session.apply(op);
      };
      auto nav = [&](std::initializer_list<uint32_t> stack) {
        auto tabs = encode_ids({1});
        auto stack_bytes = encode_ids(stack);
        ops::Op op{};
        op.code = protocol::Code::Nav;
        op.nav.tabs = {tabs.data(), 1};
        op.nav.stack = {stack_bytes.data(), uint32_t(stack.size())};
        session.apply(op);
      };
      auto visible = [&] { return gtk_stack_get_visible_child(GTK_STACK(session.stack_widget_)); };
      auto transition = [&] { return gtk_stack_get_transition_type(GTK_STACK(session.stack_widget_)); };

      create(1);
      nav({});
      auto *home = visible();
      assert(home && transition() == GTK_STACK_TRANSITION_TYPE_NONE);
      create(2);
      nav({2});
      auto *detail = visible();
      assert(detail && detail != home);
      assert(transition() == GTK_STACK_TRANSITION_TYPE_SLIDE_LEFT_RIGHT);
      assert(session.scopes_.contains(1) && session.scopes_.contains(2));

      nav({});
      assert(visible() == home && !session.scopes_.contains(2));
      assert(transition() == GTK_STACK_TRANSITION_TYPE_SLIDE_LEFT_RIGHT);

      create(3);
      nav({3});
      create(4);
      nav({4});
      assert(visible() != home && !session.scopes_.contains(3) && session.scopes_.contains(4));
      assert(transition() == GTK_STACK_TRANSITION_TYPE_NONE);

      create(5);
      nav({4, 5});
      session.runtime_ = reinterpret_cast<weft_runtime *>(1);
      bool went_back = session.back();
      assert(went_back);
      session.runtime_ = nullptr;
      assert(visible() != home && session.scopes_.contains(4) && !session.scopes_.contains(5));
      assert(signal_name == "navigation" && signal_json == "{\"tab\":0,\"stack\":[4],\"modal\":0}");
      assert(transition() == GTK_STACK_TRANSITION_TYPE_SLIDE_LEFT_RIGHT);
      signal_name.clear();
      signal_json.clear();
      session.runtime_ = reinterpret_cast<weft_runtime *>(1);
      went_back = session.back();
      bool at_root = !session.back();
      assert(went_back && at_root);
      session.runtime_ = nullptr;
      assert(visible() == home && !session.scopes_.contains(4));
      assert(signal_name == "navigation" && signal_json == "{\"tab\":0,\"stack\":[],\"modal\":0}");

      create(6);
      auto tabs = encode_ids({1});
      ops::Op modal{}; modal.code = protocol::Code::Nav; modal.nav.tabs = {tabs.data(), 1}; modal.nav.modal = 6;
      session.apply(modal);
      assert(session.nav_modal_ == 6 && gtk_widget_get_visible(session.modal_scrim_));
      assert(gtk_widget_get_halign(gtk_widget_get_last_child(session.navigation_overlay_)) == GTK_ALIGN_CENTER);
      modal.nav.style = uint32_t(protocol::ModalStyle::FullScreen);
      session.apply(modal);
      assert(!gtk_widget_get_visible(session.modal_scrim_));
      assert(gtk_widget_get_halign(gtk_widget_get_last_child(session.navigation_overlay_)) == GTK_ALIGN_FILL);
      modal.nav.modal = 0; modal.nav.style = 0;
      session.apply(modal);
      assert(!session.nav_modal_ && !session.scopes_.contains(6));
      create(7); modal.nav.modal = 7; session.apply(modal);
      session.runtime_ = reinterpret_cast<weft_runtime *>(1);
      auto *card = gtk_widget_get_last_child(session.navigation_overlay_);
      auto *header = gtk_widget_get_first_child(gtk_frame_get_child(GTK_FRAME(card)));
      auto *close = gtk_center_box_get_start_widget(GTK_CENTER_BOX(header));
      g_signal_emit_by_name(close, "clicked");
      assert(!session.nav_modal_ && !session.scopes_.contains(7));
      assert(signal_name == "navigation" && signal_json == "{\"tab\":0,\"stack\":[],\"modal\":0}");
      create(8); modal.nav.modal = 8; session.apply(modal);
      auto *controllers = gtk_widget_observe_controllers(session.modal_scrim_);
      auto *click = g_list_model_get_item(controllers, 0);
      g_signal_emit_by_name(click, "pressed", 1, 1.0, 1.0);
      g_object_unref(click);
      g_object_unref(controllers);
      assert(!session.nav_modal_ && !session.scopes_.contains(8));
      assert(signal_json == "{\"tab\":0,\"stack\":[],\"modal\":0}");
      session.runtime_ = nullptr;
    }
    g_object_unref(page);

    page = GTK_WIDGET(g_object_ref_sink(gtk_box_new(GTK_ORIENTATION_VERTICAL, 0)));
    {
      Session session(page, make_page, true, {{"Home", "asset:home", "asset:home"}, {"Settings", "asset:settings", "asset:settings"}});
      for (uint32_t id : {1u, 2u, 3u}) {
        ops::Op op{}; op.code = protocol::Code::Create; op.scope = id; session.apply(op);
      }
      auto badge = [&](const std::string &json) {
        session.call(1, "navigation", "badge", {json.begin(), json.end()});
      };
      badge("{\"tab\":1,\"text\":\"3\"}");
      auto *badge_page = gtk_stack_get_page(GTK_STACK(session.tab_stack_), session.tab_pages_[1]);
      assert(gtk_stack_page_get_needs_attention(badge_page));
      badge("{\"tab\":1,\"text\":null}");
      assert(!gtk_stack_page_get_needs_attention(badge_page));
      badge("{\"tab\":1,\"text\":\"\"}");
      assert(gtk_stack_page_get_needs_attention(badge_page));
      auto tabs = encode_ids({1, 2});
      auto stack = encode_ids({3});
      ops::Op op{}; op.code = protocol::Code::Nav; op.nav.tabs = {tabs.data(), 2};
      signal_name.clear(); session.runtime_ = reinterpret_cast<weft_runtime *>(1);
      session.apply(op);
      assert(signal_name.empty());
      gtk_stack_set_visible_child(GTK_STACK(session.tab_stack_), session.tab_pages_[1]);
      assert(signal_name == "navigation" && signal_json == "{\"tab\":1,\"stack\":[],\"modal\":0}");
      signal_name.clear();
      op.nav.tab = 0; op.nav.stack = {stack.data(), 1}; session.apply(op);
      assert(signal_name.empty());
      assert(gtk_stack_get_visible_child(GTK_STACK(session.stack_widget_)) != session.tab_root_);
      op.nav.tab = 1; op.nav.stack = {nullptr, 0}; session.apply(op);
      assert(signal_name.empty() && !session.scopes_.contains(3));
      assert(gtk_stack_get_visible_child(GTK_STACK(session.stack_widget_)) == session.tab_root_);
      session.runtime_ = nullptr;
    }
    g_object_unref(page);
  }
};
}

int main() {
  if (!gtk_init_check()) return 77;
  weft::NavigationTest::run();
}
