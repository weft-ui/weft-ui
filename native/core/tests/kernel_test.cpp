// Kernel tests: `weft_core_tests <bundle dir> <case>` runs one case against
// a fake platform shell. Bundles are the compiled files of tests/js/.

#include <weft/ops.hpp>
#include <weft/protocol.hpp>
#include <weft/runtime.h>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <functional>
#include <iterator>
#include <map>
#include <optional>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

#include "json.hpp"

namespace {

struct Failure : std::runtime_error {
  using std::runtime_error::runtime_error;
};

#define CHECK(cond)                                                                     \
  do {                                                                                  \
    if (!(cond)) throw Failure(std::string(__FILE__ ":") + std::to_string(__LINE__) + \
                               ": CHECK(" #cond ") failed");                            \
  } while (0)

#define CHECK_EQ(a, b)                                                                     \
  do {                                                                                     \
    auto &&va = (a);                                                                       \
    auto &&vb = (b);                                                                       \
    if (!(va == vb)) {                                                                     \
      std::ostringstream message;                                                          \
      message << __FILE__ ":" << __LINE__ << ": " #a " == " #b " failed:\n  " << va        \
              << "\n  " << vb;                                                             \
      throw Failure(message.str());                                                        \
    }                                                                                      \
  } while (0)

std::string dir;

std::vector<uint8_t> read_file(const std::string &path) {
  std::ifstream in(path, std::ios::binary);
  if (!in) throw Failure("cannot read " + path);
  return {std::istreambuf_iterator<char>(in), {}};
}

/// A platform shell that records everything the kernel sends.
struct Shell {
  struct Call {
    uint32_t id;
    std::string module, method;
    std::vector<uint8_t> args;
  };
  std::vector<std::pair<int, std::string>> logs;
  std::vector<std::vector<uint8_t>> commits;
  std::vector<Call> calls;
  std::optional<uint64_t> tick_in;
  std::set<std::string> modules{"echo"};
  std::vector<uint8_t> bytecode;
  weft_runtime *rt = nullptr;

  weft_host host() {
    weft_host h{};
    h.protocol = weft::protocol::kVersion;
    h.ctx = this;
    h.commit = [](void *ctx, const uint8_t *ops, size_t len) {
      static_cast<Shell *>(ctx)->commits.emplace_back(ops, ops + len);
    };
    h.schedule = [](void *ctx, uint64_t delay) {
      auto &shell = *static_cast<Shell *>(ctx);
      shell.tick_in = shell.tick_in ? std::min(*shell.tick_in, delay) : delay;
    };
    h.supports = [](void *ctx, const char *module) {
      return static_cast<Shell *>(ctx)->modules.count(module) > 0;
    };
    h.call = [](void *ctx, uint32_t id, const char *module, const char *method, const uint8_t *args,
                size_t len) {
      static_cast<Shell *>(ctx)->calls.push_back({id, module, method, {args, args + len}});
    };
    h.log = [](void *ctx, int level, const char *msg, size_t len) {
      static_cast<Shell *>(ctx)->logs.emplace_back(level, std::string(msg, len));
    };
    h.version = "17.0";
    return h;
  }

  weft_runtime *start(const std::string &bundle, uint64_t hash = 0, const char *environment = nullptr) {
    bytecode = read_file(dir + "/" + bundle + ".hbc");
    weft_host h = host();
    h.environment = environment;
    rt = weft_runtime_new(&h, bytecode.data(), bytecode.size(), hash);
    return rt;
  }

  /// Ticks whenever asked to, sleeping until the requested time, until no timer is left.
  void pump() {
    for (int i = 0; i < 1000 && tick_in; i++) {
      std::this_thread::sleep_for(std::chrono::milliseconds(*tick_in));
      tick_in.reset();
      weft_runtime_tick(rt);
    }
    CHECK(!tick_in);
  }

  std::vector<std::string> lines(int level = WEFT_LOG_INFO) const {
    std::vector<std::string> out;
    for (auto &[l, text] : logs) {
      if (l == level) out.push_back(text);
    }
    return out;
  }

  bool logged(int level, const std::string &part) const {
    return std::any_of(logs.begin(), logs.end(), [&](auto &entry) {
      return entry.first == level && entry.second.find(part) != std::string::npos;
    });
  }

  ~Shell() { weft_runtime_free(rt); }
};

std::ostream &operator<<(std::ostream &out, const std::vector<std::string> &lines) {
  out << '[';
  for (size_t i = 0; i < lines.size(); i++) out << (i ? ", " : "") << '"' << lines[i] << '"';
  return out << ']';
}

size_t index_of(const std::vector<std::string> &lines, const std::string &line) {
  auto found = std::find(lines.begin(), lines.end(), line);
  if (found == lines.end()) throw Failure("missing log line: " + line);
  return size_t(found - lines.begin());
}

void timers() {
  Shell shell;
  CHECK(shell.start("timers"));
  CHECK(shell.tick_in.has_value());
  // Deliberately deliver the first tick late. OS timer granularity (notably
  // on Windows) cannot guarantee a tick between the 10 ms and 20 ms timers.
  // Overdue timers run in deadline order; nested timers and repeats must
  // still wait for the next tick, rather than running in this batch.
  std::this_thread::sleep_for(std::chrono::milliseconds(50));
  shell.tick_in.reset();
  weft_runtime_tick(shell.rt);
  CHECK_EQ(shell.lines(),
           (std::vector<std::string>{"a 0", "args 1 two", "zero 1", "interval 1", "outer", "b 20", "done"}));
  CHECK(shell.tick_in.has_value());
  shell.pump();
  auto lines = shell.lines();
  CHECK(index_of(lines, "done") < index_of(lines, "nested"));
  auto count = [&](const char *prefix) {
    return std::count_if(lines.begin(), lines.end(), [&](auto &l) { return l.rfind(prefix, 0) == 0; });
  };
  CHECK_EQ(count("interval"), 3);
  index_of(lines, "interval 3");
  // A zero delay interval repeats too, once per tick.
  CHECK_EQ(count("zero"), 3);
  CHECK(index_of(lines, "done") < index_of(lines, "zero 2"));
  index_of(lines, "zero 3");
  CHECK(std::find(lines.begin(), lines.end(), "cancelled") == lines.end());
}

void microtasks() {
  Shell shell;
  CHECK(shell.start("microtasks"));
  CHECK_EQ(shell.lines(), (std::vector<std::string>{"sync", "promise", "micro", "after boom"}));
  CHECK(shell.logged(WEFT_LOG_ERROR, "boom"));
  shell.pump();
  CHECK_EQ(shell.lines(), (std::vector<std::string>{"sync", "promise", "micro", "after boom", "timer 1",
                                                    "micro of timer 1", "timer 2"}));
}

void console() {
  Shell shell;
  CHECK(shell.start("console"));
  auto &logs = shell.logs;
  CHECK_EQ(logs.size(), size_t(7));
  CHECK_EQ(logs[0].second, std::string(R"(text 1 1.5 true null undefined {"a":[1,"b"]})"));
  CHECK_EQ(logs[1].first, WEFT_LOG_DEBUG);
  CHECK_EQ(logs[2].first, WEFT_LOG_INFO);
  CHECK_EQ(logs[3].first, WEFT_LOG_WARN);
  CHECK_EQ(logs[4].first, WEFT_LOG_ERROR);
  CHECK_EQ(logs[4].second, std::string("e"));
  CHECK_EQ(logs[5].second, std::string("[object Object]"));
  CHECK_EQ(logs[6].second.rfind("Error: bad", 0), size_t(0));
}

void text() {
  Shell shell;
  CHECK(shell.start("text"));
  CHECK_EQ(shell.lines(), (std::vector<std::string>{"10 héllo ✓"}));
}

void unicode() {
  Shell shell;
  CHECK(shell.start("unicode"));
  CHECK_EQ(shell.lines(), (std::vector<std::string>{"Unicode OK"}));

  // Linux locale tests run in separate processes because ICU4X caches LC_*/LANG.
  if (const char *locale = std::getenv("WEFT_UNICODE_EXPECTED")) {
    const std::map<std::string_view, std::string_view> expected = {
        {"root", "II ii\u0307 1 false"},
        {"pinyin", "II ii\u0307 -1 false"},
        {"turkish", "İI ıi 1 false"},
        {"serbian-latin", "II ii\u0307 1 true"},
    };
    Shell linux_shell;
    const auto runtime = linux_shell.start("unicode-linux");
    CHECK_EQ(linux_shell.lines(WEFT_LOG_ERROR), (std::vector<std::string>{}));
    CHECK(runtime);
    CHECK_EQ(linux_shell.lines(), (std::vector<std::string>{std::string(expected.at(locale))}));
  }
}

void calls() {
  Shell shell;
  CHECK(shell.start("calls"));
  CHECK_EQ(shell.lines(), (std::vector<std::string>{
                              "supports true false version 17.0",
                              R"(unsupported weft: platform module "nope" is not supported)",
                          }));
  CHECK_EQ(shell.calls.size(), size_t(3));
  auto &upper = shell.calls[0];
  CHECK_EQ(upper.module, std::string("echo"));
  CHECK_EQ(upper.method, std::string("upper"));
  CHECK(upper.args == (std::vector<uint8_t>{'h', 'i'}));
  CHECK(shell.calls[1].args == (std::vector<uint8_t>{2, 3}));
  CHECK(shell.calls[2].args.empty());

  const uint8_t hi[] = {'H', 'I'};
  weft_runtime_resolve(shell.rt, upper.id, true, hi, sizeof hi);
  const char nope[] = "nope!";
  weft_runtime_resolve(shell.rt, shell.calls[1].id, false, reinterpret_cast<const uint8_t *>(nope), 5);
  weft_runtime_resolve(shell.rt, shell.calls[2].id, true, nullptr, 0);
  // Completed and unknown ids are ignored.
  weft_runtime_resolve(shell.rt, upper.id, true, hi, sizeof hi);
  weft_runtime_resolve(shell.rt, 99, true, hi, sizeof hi);
  auto lines = shell.lines();
  CHECK_EQ(std::vector<std::string>(lines.begin() + 2, lines.end()),
           (std::vector<std::string>{"resolved HI", "rejected nope!", "empty 0"}));
}

void environment() {
  Shell shell;
  CHECK(shell.start("environment", 0, R"({"colorScheme":"light"})"));
  CHECK_EQ(shell.lines(), (std::vector<std::string>{R"({"colorScheme":"light"})"}));

  const std::string_view dark = R"({"colorScheme":"dark"})";
  weft_runtime_environment(shell.rt, dark.data(), dark.size());
  CHECK_EQ(shell.lines(), (std::vector<std::string>{R"({"colorScheme":"light"})",
      R"({"colorScheme":"dark"})", "after change"}));
  CHECK(shell.logged(WEFT_LOG_ERROR, "listener error"));

  Shell missing;
  CHECK(missing.start("environment"));
  CHECK_EQ(missing.lines(), (std::vector<std::string>{"{}"}));
}

/// A payload: one encoded value.
std::vector<uint8_t> payload(const std::string &text) {
  std::vector<uint8_t> out{3, uint8_t(text.size()), 0, 0, 0};
  out.insert(out.end(), text.begin(), text.end());
  return out;
}

void session() {
  Shell shell;
  CHECK(shell.start("session", 0xab));
  CHECK_EQ(shell.commits.size(), size_t(1));
  auto &batch = shell.commits[0];
  weft::ops::Reader reader(batch.data(), batch.size());
  weft::ops::Op op;
  CHECK(reader.next(op));
  CHECK_EQ(weft::ops::format(op), std::string("create 7 0"));
  CHECK(!reader.next(op));

  auto send = [&](const std::vector<uint8_t> &bytes) {
    return weft_runtime_dispatch(shell.rt, 3, 1, bytes.data(), bytes.size());
  };
  CHECK(send(payload("ok")));
  CHECK(!send(payload("reject")));
  CHECK(send({1}));
  std::vector<uint8_t> number{2, 0, 0, 0, 0, 0, 0, 4, 64};  // 2.5
  CHECK(send(number));
  CHECK(send({}));
  // A malformed payload is reported and ignored.
  CHECK(send({9}));
  CHECK(shell.logged(WEFT_LOG_ERROR, "unknown value tag 9"));
  CHECK(send({static_cast<uint8_t>(weft::protocol::Tag::Strings), 0, 0, 0, 0}));
  CHECK(shell.logged(WEFT_LOG_ERROR, "string lists are not event payloads"));
  CHECK(send(payload("close")));
  CHECK(send(payload("after close")));
  CHECK_EQ(shell.lines(), (std::vector<std::string>{
                              "dispatch 3 1 string ok",
                              "dispatch 3 1 string reject",
                              "dispatch 3 1 boolean true",
                              "dispatch 3 1 number 2.5",
                              "dispatch 3 1 undefined undefined",
                              "dispatch 3 1 string close",
                          }));
}

void refused() {
  {
    Shell shell;
    CHECK(!shell.start("session", 0xac));
    CHECK(shell.logged(WEFT_LOG_ERROR, "layout mismatch (native views 00000000000000ac, app 00000000000000ab)"));
  }
  {
    Shell shell;
    CHECK(!shell.start("throws"));
    CHECK(shell.logged(WEFT_LOG_ERROR, "bad bundle"));
  }
  {
    Shell shell;
    std::vector<uint8_t> junk(64, 7);
    weft_host h = shell.host();
    CHECK(!weft_runtime_new(&h, junk.data(), junk.size(), 0));
    CHECK(shell.logged(WEFT_LOG_ERROR, "the bundle failed to start"));
  }
}

void protocol() {
  {
    Shell shell;
    auto h = shell.host();
    h.protocol = 2;
    CHECK(!weft_runtime_new(&h, nullptr, 0, 0));
    CHECK(shell.logged(WEFT_LOG_ERROR, "weft: protocol mismatch: kernel speaks 3, shell speaks 2"));
  }
  {
    Shell shell;
    CHECK(!shell.start("protocol-mismatch", 0xab));
    CHECK(shell.logged(WEFT_LOG_ERROR, "weft: protocol mismatch: bundle speaks 2, kernel speaks 3"));
  }
  {
    Shell shell;
    CHECK(shell.start("session", 0xab));
  }
}

void stable_rows() {
  auto stable = [](std::vector<uint32_t> old_rows, std::vector<uint32_t> new_rows) {
    std::vector<uint8_t> out(new_rows.size(), 9);
    size_t count = weft_stable_rows(old_rows.data(), old_rows.size(), new_rows.data(), new_rows.size(), out.data());
    CHECK_EQ(count, size_t(std::count(out.begin(), out.end(), 1)));
    return out;
  };
  CHECK(stable({1, 2, 3, 4, 5}, {5, 1, 2, 6, 3}) == (std::vector<uint8_t>{0, 1, 1, 0, 1}));
  CHECK(stable({1, 2, 3}, {3, 2, 1}) == (std::vector<uint8_t>{0, 0, 1}));
  CHECK(stable({1, 2, 3}, {1, 2, 3}) == (std::vector<uint8_t>{1, 1, 1}));
  CHECK(stable({}, {4, 5}) == (std::vector<uint8_t>{0, 0}));
  CHECK(stable({1, 2}, {}).empty());
}

/// Encodes ops for the decoder tests.
struct Batch {
  std::vector<uint8_t> bytes{weft::protocol::kVersion};
  Batch &u8(uint8_t v) {
    bytes.push_back(v);
    return *this;
  }
  Batch &u32(uint32_t v) {
    for (int i = 0; i < 4; i++) bytes.push_back(uint8_t(v >> (8 * i)));
    return *this;
  }
  Batch &number(double v) {
    uint64_t bits;
    std::memcpy(&bits, &v, 8);
    u8(2);
    for (int i = 0; i < 8; i++) bytes.push_back(uint8_t(bits >> (8 * i)));
    return *this;
  }
  Batch &string(const std::string &s) {
    u8(3).u32(uint32_t(s.size()));
    bytes.insert(bytes.end(), s.begin(), s.end());
    return *this;
  }
};

std::vector<std::string> decode(const std::vector<uint8_t> &bytes) {
  weft::ops::Reader reader(bytes.data(), bytes.size());
  std::vector<std::string> out;
  for (weft::ops::Op op; reader.next(op);) out.push_back(weft::ops::format(op));
  return out;
}

void ops() {
  Batch b;
  b.u8(1).u32(1).u32(0);
  b.u8(2).u32(1).u32(0).string("a\"\\\n\x01é");
  b.u8(2).u32(1).u32(1).u8(1);
  for (double v : {0.1, 123.0, -0.0, 1.5e-7, 1e21, 123456789012345680000.0, -2.5}) b.u8(2).u32(1).u32(2).number(v);
  b.u8(4).u32(2).u32(0).u32(2).u32(3).u32(4);
  b.u8(4).u32(2).u32(0).u32(0);
  b.u8(3).u32(1).u32(0).u32(0);
  b.u8(5).u32(0).u32(0).u32(1);
  CHECK_EQ(decode(b.bytes), (std::vector<std::string>{
                                "create 1 0",
                                R"(set 1 0 "a\"\\\n\u0001é")",
                                "set 1 1 true",
                                "set 1 2 0.1",
                                "set 1 2 123",
                                "set 1 2 0",
                                "set 1 2 1.5e-7",
                                "set 1 2 1e+21",
                                "set 1 2 123456789012345680000",
                                "set 1 2 -2.5",
                                "rows 2 0 [3 4]",
                                "rows 2 0 []",
                                "branch 1 0 0",
                                "attach 0 0 1",
                            }));
}

// The shared corpus (protocol/corpus).

json::Value read_corpus(const std::string &file) {
  auto bytes = read_file(std::string(WEFT_CORPUS_DIR) + "/" + file);
  return json::parse(std::string_view(reinterpret_cast<const char *>(bytes.data()), bytes.size()));
}

/// The bytes of a corpus `hex` string, which may contain whitespace.
std::vector<uint8_t> hex_bytes(const std::string &hex) {
  std::string digits;
  for (char c : hex) {
    if (c != ' ' && c != '\n') digits += c;
  }
  std::vector<uint8_t> out;
  for (size_t i = 0; i + 1 < digits.size(); i += 2) {
    out.push_back(uint8_t(std::stoul(digits.substr(i, 2), nullptr, 16)));
  }
  return out;
}

/// A corpus value (`{"bool": b}`, `{"number": n}` or `{"string": s}`); strings point into `value`.
weft::ops::Value corpus_value(const json::Value &value) {
  if (value.has("bool")) return value["bool"].boolean();
  if (value.has("number")) return value["number"].number();
  return std::string_view(value["string"].string());
}

void check_value(const weft::ops::Value &value, const json::Value &want) {
  if (want.has("strings")) {
    auto *list = std::get_if<weft::ops::StringList>(&value);
    auto &strings = want["strings"].array();
    CHECK(list != nullptr);
    CHECK_EQ(size_t(list->count), strings.size());
    size_t i = 0;
    for (auto text : *list) CHECK(text == strings[i++].string());
    CHECK_EQ(i, strings.size());
  } else {
    CHECK(value == corpus_value(want));
  }
}

const char *kind_name(weft::ops::Error::Kind kind) {
  using Kind = weft::ops::Error::Kind;
  switch (kind) {
    case Kind::Truncated: return "truncated";
    case Kind::Version: return "version";
    case Kind::Opcode: return "opcode";
    case Kind::Tag: return "tag";
    case Kind::Utf8: return "utf8";
  }
  return "?";
}

const char *op_name(weft::protocol::Code code) {
  using weft::protocol::Code;
  switch (code) {
    case Code::Create: return "create";
    case Code::Set: return "set";
    case Code::Branch: return "branch";
    case Code::Rows: return "rows";
    case Code::Attach: return "attach";
    case Code::Splice: return "splice";
    case Code::Bind: return "bind";
    case Code::Nav: return "nav";
  }
  return "?";
}

void check_op(const std::string &name, const weft::ops::Op &op, const json::Value &want) {
  using weft::protocol::Code;
  CHECK_EQ(name + " " + op_name(op.code), name + " " + want["op"].string());
  if (op.code != Code::Nav) CHECK_EQ(op.scope, want["scope"].u32());
  switch (op.code) {
    case Code::Splice: {
      CHECK_EQ(op.index, want["point"].u32());
      CHECK_EQ(op.splice.index, want["index"].u32());
      CHECK_EQ(op.splice.remove, want["remove"].u32());
      auto &items = want["items"].array();
      CHECK_EQ(op.splice.items.count, uint32_t(items.size()));
      size_t i = 0;
      for (auto item : op.splice.items) {
        CHECK_EQ(item.item, items[i]["item"].u32());
        CHECK_EQ(item.template_index, items[i++]["template"].u32());
      }
      break;
    }
    case Code::Bind:
      CHECK_EQ(op.index, want["point"].u32());
      CHECK_EQ(op.bind.item, want["item"].u32());
      CHECK_EQ(op.bind.child, want["child"].u32());
      break;
    case Code::Nav: {
      CHECK_EQ(op.nav.tab, want["tab"].u32());
      auto check_list = [](weft::ops::ScopeList got, const json::Value &expected) {
        auto &values = expected.array();
        CHECK_EQ(got.count, uint32_t(values.size()));
        size_t i = 0;
        for (auto value : got) CHECK_EQ(value, values[i++].u32());
      };
      check_list(op.nav.tabs, want["tabs"]);
      check_list(op.nav.stack, want["stack"]);
      CHECK_EQ(op.nav.modal, want["modal"].u32());
      CHECK_EQ(op.nav.style, want["style"].string() == "sheet" ? 0u : 1u);
      break;
    }
    case Code::Create:
      CHECK_EQ(op.index, want["template"].u32());
      break;
    case Code::Set:
      CHECK_EQ(op.index, want["slot"].u32());
      check_value(op.value, want["value"]);
      break;
    case Code::Branch:
    case Code::Attach:
      CHECK_EQ(op.index, want["point"].u32());
      CHECK_EQ(op.child, want["child"].u32());
      break;
    case Code::Rows: {
      CHECK_EQ(op.index, want["point"].u32());
      auto &children = want["children"].array();
      CHECK_EQ(op.count, uint32_t(children.size()));
      for (uint32_t i = 0; i < op.count; i++) CHECK_EQ(op.row(i), children[i].u32());
      break;
    }
  }
}

void corpus() {
  // Keep the documents alive: a range-for does not extend the lifetime of the
  // temporary that `["cases"]` is called on (before C++23).
  auto ops_corpus = read_corpus("ops.json");
  for (auto &c : ops_corpus["cases"].array()) {
    const std::string &name = c["name"].string();
    auto bytes = hex_bytes(c["hex"].string());
    if (c.has("ops")) {
      auto ops = weft::ops::read_all(bytes.data(), bytes.size());
      auto &want = c["ops"].array();
      CHECK_EQ(name + " " + std::to_string(ops.size()), name + " " + std::to_string(want.size()));
      for (size_t i = 0; i < ops.size(); i++) check_op(name, ops[i], want[i]);
      if (c.has("text")) {
        CHECK_EQ(ops.size(), size_t(1));
        CHECK_EQ(weft::ops::format(ops[0]), c["text"].string());
      }
    } else {
      std::string kind = "none";
      try {
        weft::ops::read_all(bytes.data(), bytes.size());
      } catch (const weft::ops::Error &e) {
        kind = kind_name(e.kind());
      }
      CHECK_EQ(name + " " + kind, name + " " + c["error"].string());
    }
  }

  auto values_corpus = read_corpus("values.json");
  for (auto &c : values_corpus["cases"].array()) {
    const std::string &name = c["name"].string();
    auto bytes = hex_bytes(c["hex"].string());
    const uint8_t *at = bytes.data();
    auto value = weft::ops::read_value(at, bytes.data() + bytes.size());
    const auto &want = c["value"];
    check_value(value, want);
    CHECK(at == bytes.data() + bytes.size());
    std::string encoded;
    weft::ops::encode_value(want.has("strings") ? value : corpus_value(want), encoded);
    CHECK_EQ(name + " " + encoded, name + " " + std::string(bytes.begin(), bytes.end()));
  }
}

void bounds() {
  Shell shell;
  CHECK(shell.start("bounds", 0xab));
  CHECK(shell.commits.empty());
  CHECK(shell.calls.empty());
  CHECK_EQ(shell.lines(), (std::vector<std::string>{"bounds-ok:false"}));

  // Verify Code::Rows with count > SIZE_MAX / 4 throws Truncated instead of overflowing.
  const std::vector<uint8_t> overflow_rows = {
      weft::protocol::kVersion,
      uint8_t(weft::protocol::Code::Rows),
      1, 0, 0, 0,
      0, 0, 0, 0,
      0x01, 0x00, 0x00, 0x40,
  };
  std::string kind = "none";
  try {
    weft::ops::read_all(overflow_rows.data(), overflow_rows.size());
  } catch (const weft::ops::Error &e) {
    kind = kind_name(e.kind());
  }
  CHECK_EQ(kind, std::string("truncated"));
}

const std::map<std::string, std::function<void()>> kCases = {
    {"timers", timers},   {"microtasks", microtasks},   {"console", console},
    {"text", text},       {"calls", calls},             {"session", session},
    {"refused", refused}, {"stable_rows", stable_rows}, {"ops", ops},
    {"corpus", corpus},   {"unicode", unicode},         {"environment", environment},
    {"bounds", bounds},   {"protocol", protocol},
};

}  // namespace

int main(int argc, char **argv) {
  if (argc != 3 || !kCases.count(argv[2])) {
    std::fprintf(stderr, "usage: weft_core_tests <bundle dir> <case>\n");
    return 2;
  }
  dir = argv[1];
  try {
    kCases.at(argv[2])();
  } catch (const std::exception &e) {
    std::fprintf(stderr, "%s\n", e.what());
    return 1;
  }
  return 0;
}
