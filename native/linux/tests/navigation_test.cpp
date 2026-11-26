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
    }
    g_object_unref(page);
  }
};
}

int main() {
  if (!gtk_init_check()) return 77;
  weft::NavigationTest::run();
}
