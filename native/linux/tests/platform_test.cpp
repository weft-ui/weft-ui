#include "frame.hpp"
#include "platform.hpp"
#include "weft/protocol.hpp"

#include <glib.h>
#include <glib/gstdio.h>

#include <cassert>
#include <cstdlib>
#include <functional>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

std::vector<uint8_t> bytes_of(std::string_view s) { return {s.begin(), s.end()}; }

bool expect_throws(const std::function<void()> &fn) {
  try {
    fn();
  } catch (const std::runtime_error &) {
    return true;
  }
  return false;
}

std::pair<bool, std::string> run_call(std::string_view mod, std::string_view method, std::string_view payload) {
  GCancellable *c = g_cancellable_new();
  bool finished = false;
  bool out_ok = false;
  std::string out_msg;
  weft::platform::call(std::string(mod), std::string(method), bytes_of(payload), c,
                       [&](bool ok, std::vector<uint8_t> res) {
                         out_ok = ok;
                         out_msg.assign(res.begin(), res.end());
                         finished = true;
                       });
  while (!finished) g_main_context_iteration(nullptr, TRUE);
  g_object_unref(c);
  return {out_ok, out_msg};
}

}  // namespace

int main() {
  // 1. parse_json handles empty input / whitespace without null GError or null JsonNode deref.
  assert(expect_throws([] { weft::parse_json("", "test"); }));
  assert(expect_throws([] { weft::parse_json("   ", "test"); }));
  assert(expect_throws([] { weft::parse_json("{", "test"); }));

  // 2. HTTP URL scheme validation.
  assert(weft::platform::is_http_url("https://example.com/a"));
  assert(weft::platform::is_http_url("HTTP://example.com/a"));
  assert(!weft::platform::is_http_url("file:///etc/passwd"));
  assert(!weft::platform::is_http_url("data:text/plain,hello"));
  assert(!weft::platform::is_http_url(""));

  // 3. fetch rejects non-HTTP(S) schemes cleanly via async callback.
  {
    auto body = weft::frame::frame(R"({"url":"file:///etc/passwd"})", nullptr, 0);
    GCancellable *c = g_cancellable_new();
    bool finished = false;
    bool ok = true;
    weft::platform::call(std::string(weft::protocol::kFetchModule), std::string(weft::protocol::kFetchRequest), body, c,
                         [&](bool res_ok, std::vector<uint8_t>) {
                           ok = res_ok;
                           finished = true;
                         });
    while (!finished) g_main_context_iteration(nullptr, TRUE);
    g_object_unref(c);
    assert(!ok);
  }

  // 4. parse_storage_args strictly rejects arrays containing non-string elements.
  assert(expect_throws([] { weft::platform::parse_storage_args("set", bytes_of(R"(["k", 123])")); }));
  assert(expect_throws([] { weft::platform::parse_storage_args("set", bytes_of(R"(["k", null])")); }));
  assert(expect_throws([] { weft::platform::parse_storage_args("get", bytes_of(R"([])")); }));

  // 5. Storage round-trip and rollback when disk write fails.
  g_autofree gchar *tmp_dir = g_dir_make_tmp("weft-linux-platform-XXXXXX", nullptr);
  assert(tmp_dir != nullptr);
  g_setenv("XDG_DATA_HOME", tmp_dir, TRUE);
  g_set_prgname("weft-platform-test");

  auto [set_ok, _] = run_call(weft::protocol::kStorageModule, weft::protocol::kStorageSet, R"(["k","v1"])");
  assert(set_ok);
  auto [get_ok, get_val] = run_call(weft::protocol::kStorageModule, weft::protocol::kStorageGet, R"(["k"])");
  assert(get_ok && get_val == R"("v1")");

  // Replace storage.json with a directory so g_file_set_contents fails (EISDIR) and must roll back.
  g_autofree gchar *storage_file = g_build_filename(tmp_dir, "weft-platform-test", "storage.json", nullptr);
  assert(g_unlink(storage_file) == 0);
  assert(g_mkdir_with_parents(storage_file, 0700) == 0);

  auto [bad_set_ok, _err] = run_call(weft::protocol::kStorageModule, weft::protocol::kStorageSet, R"(["k","v2"])");
  assert(!bad_set_ok);
  auto [after_ok, after_val] = run_call(weft::protocol::kStorageModule, weft::protocol::kStorageGet, R"(["k"])");
  assert(after_ok && after_val == R"("v1")");

  return 0;
}
