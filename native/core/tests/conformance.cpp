// Conformance host: `weft_conformance <fixture dir> <golden.ops>` runs the
// fixture bundle (tests/conformance/native) in the kernel and acts as its platform
// shell. Like the JS headless renderer (@weft-ui/runtime/testing), it
// checks every batch against the layout, applies it to a scope tree, and
// dispatches the script's clicks and edits, rolling back rejected edits.
// The annotated ops log must equal the golden file byte for byte.

#include <weft/ops.hpp>
#include <weft/protocol.hpp>
#include <weft/runtime.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <deque>
#include <fstream>
#include <iterator>
#include <memory>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>
#include <unordered_map>
#include <unordered_set>
#include <variant>
#include <vector>

#include "json.hpp"

namespace {

using weft::protocol::Code;

struct Protocol : std::runtime_error {
  using std::runtime_error::runtime_error;
};

/// An owned slot value.
using Value = std::variant<bool, double, std::string, std::vector<std::string>>;

Value own(const weft::ops::Value &value) {
  if (auto *flag = std::get_if<bool>(&value)) return *flag;
  if (auto *number = std::get_if<double>(&value)) return *number;
  if (auto *text = std::get_if<std::string_view>(&value)) return std::string(*text);
  const auto list = std::get<weft::ops::StringList>(value);
  std::vector<std::string> strings;
  strings.reserve(list.count);
  for (auto text : list) strings.emplace_back(text);
  return strings;
}

struct Node {
  std::string element;  // empty for a mount point
  uint32_t point = 0;
  std::vector<uint32_t> children;
  double max_length = -1;
  std::optional<uint32_t> max_length_slot = std::nullopt;
};

struct Slot {
  uint32_t node;
  std::string prop;
  std::string type;
};

struct Event {
  uint32_t node;
  std::string name;
  std::optional<uint32_t> controls;
};

struct Point {
  std::string kind;
  std::vector<uint32_t> templates;  // allowed templates; empty for slots (any slot content)
};

struct Template {
  std::string label;
  std::string kind;
  std::vector<uint32_t> roots;
  std::vector<Node> nodes;
  std::vector<Slot> values;
  std::vector<Event> events;
  std::vector<Point> points;
};

struct Layout {
  uint64_t hash = 0;
  std::vector<Template> templates;
};

std::vector<uint32_t> ids(const json::Value &array) {
  std::vector<uint32_t> out;
  for (auto &item : array.array()) out.push_back(item.u32());
  return out;
}

Layout load_layout(const json::Value &root) {
  Layout layout;
  layout.hash = std::stoull(root["hash"].string(), nullptr, 16);
  for (auto &t : root["templates"].array()) {
    Template tpl{t["label"].string(), t["kind"].string(), ids(t["roots"]), {}, {}, {}, {}};
    for (auto &n : t["nodes"].array()) {
      if (n.has("point")) {
        tpl.nodes.push_back({"", n["point"].u32(), {}});
      } else {
        const auto &props = n["props"];
        const double limit = props.has("maxLength") ? props["maxLength"].number() : -1;
        tpl.nodes.push_back({n["element"].string(), 0, ids(n["children"]), limit});
      }
    }
    for (auto &v : t["values"].array()) {
      const uint32_t node = v["node"].u32();
      const auto &prop = v["prop"].string();
      if (prop == "maxLength") tpl.nodes.at(node).max_length_slot = uint32_t(tpl.values.size());
      tpl.values.push_back({node, prop, v["type"].string()});
    }
    for (auto &e : t["events"].array()) {
      auto &controls = e["controls"];
      tpl.events.push_back({e["node"].u32(), e["event"].string(),
                            controls.is_null() ? std::nullopt : std::optional(controls.u32())});
    }
    for (auto &p : t["points"].array()) {
      Point point{p["kind"].string(), {}};
      if (point.kind == "branch") point.templates = ids(p["templates"]);
      else if (point.kind != "slot") point.templates = {p["template"].u32()};
      tpl.points.push_back(point);
    }
    layout.templates.push_back(std::move(tpl));
  }
  return layout;
}

/// Children of a mount point: none, one scope, or the rows of a list.
using Kids = std::variant<std::monostate, uint32_t, std::vector<uint32_t>>;

struct Scope {
  uint32_t id;
  uint32_t tpl;
  std::vector<std::optional<Value>> values;
  /// What the view shows per value slot; differs from `values` during an edit.
  std::vector<std::optional<Value>> shown;
  std::vector<Kids> kids;
  bool mounted = false;
};

/// The scope tree of one app; the C++ counterpart of the headless renderer.
class Renderer {
 public:
  explicit Renderer(Layout layout) : layout_(std::move(layout)) {}

  const Layout &layout() const { return layout_; }

  /// Checks and applies one batch, returning its annotated lines.
  std::vector<std::string> commit(const uint8_t *bytes, size_t len) {
    std::vector<std::string> lines;
    auto batch = weft::ops::read_all(bytes, len);
    for (const auto &op : batch) {
      if (op.code == Code::Splice || op.code == Code::Bind)
        throw Protocol("the layout has no lazy mount point");
    }
    for (const auto &op : batch) {
      lines.push_back(annotate(op));
      apply(op);
    }
    return lines;
  }

  /// Apply a host back action and return the resulting navigation signal, if any.
  std::optional<std::string> back() {
    if (!nav_ || (!nav_->modal && nav_->stack.empty())) return std::nullopt;
    Navigation next = *nav_;
    if (next.modal) next.modal = 0;
    else next.stack.pop_back();
    set_nav(std::move(next));
    std::string json = "{\"tab\":" + std::to_string(nav_->tab) + ",\"stack\":[";
    for (size_t i = 0; i < nav_->stack.size(); i++) {
      if (i) json += ',';
      json += std::to_string(nav_->stack[i]);
    }
    return json + "],\"modal\":" + std::to_string(nav_->modal) + "}";
  }

  std::string tab(uint32_t index) {
    if (!nav_ || index >= nav_->tabs.size()) throw Protocol("invalid tab index " + std::to_string(index));
    if (nav_->tabs[index]) {
      Navigation next = *nav_;
      next.tab = index;
      next.stack.clear();
      next.modal = 0;
      set_nav(std::move(next));
    }
    return "{\"tab\":" + std::to_string(index) + ",\"stack\":[],\"modal\":0}";
  }

  /// The `index`-th element of `type` in document order, as (scope, node).
  std::pair<uint32_t, uint32_t> find(const std::string &type, uint32_t index) const {
    std::vector<std::pair<uint32_t, uint32_t>> found;
    if (nav_) {
      uint32_t current = nav_->modal ? nav_->modal :
          nav_->stack.empty() ? nav_->tabs[nav_->tab] : nav_->stack.back();
      expand_scope(current, type, found);
    } else if (root_) expand_scope(*root_, type, found);
    if (index >= found.size()) throw Protocol("no " + type + " #" + std::to_string(index));
    return found[index];
  }

  /// The first event slot on the element matching the predicate.
  template <typename Filter>
  uint32_t event_of(uint32_t scope, uint32_t node, Filter matches) const {
    auto &events = layout_.templates[at(scope).tpl].events;
    for (uint32_t i = 0; i < events.size(); i++) {
      if (events[i].node == node && matches(events[i])) return i;
    }
    throw Protocol("the element has no matching event");
  }

  const Scope *get(uint32_t id) const {
    auto found = scopes_.find(id);
    return found == scopes_.end() ? nullptr : found->second.get();
  }

  Scope &at(uint32_t id) const {
    auto found = scopes_.find(id);
    if (found == scopes_.end()) throw Protocol("unknown scope " + std::to_string(id));
    return *found->second;
  }

 private:
  Layout layout_;
  std::unordered_map<uint32_t, std::unique_ptr<Scope>> scopes_;
  std::optional<uint32_t> root_;
  struct Navigation {
    uint32_t tab;
    std::vector<uint32_t> tabs;
    std::vector<uint32_t> stack;
    uint32_t modal;
  };
  std::optional<Navigation> nav_;

  void set_nav(Navigation next) {
    if (root_ || next.tab >= next.tabs.size() || !next.tabs[next.tab] ||
        std::find(next.stack.begin(), next.stack.end(), 0) != next.stack.end()) {
      throw Protocol("invalid navigation state");
    }
    std::unordered_set<uint32_t> previous;
    if (nav_) {
      for (uint32_t id : nav_->tabs) if (id) previous.insert(id);
      for (uint32_t id : nav_->stack) previous.insert(id);
      if (nav_->modal) previous.insert(nav_->modal);
    }
    std::unordered_set<uint32_t> retained;
    auto retain = [&](uint32_t id) {
      if (!id) return;
      if (!retained.insert(id).second) throw Protocol("scope " + std::to_string(id) + " appears twice in navigation");
      Scope &scope = at(id);
      if (layout_.templates[scope.tpl].kind != "page" || (scope.mounted && !previous.count(id))) {
        throw Protocol("scope " + std::to_string(id) + " is not an available page");
      }
    };
    for (uint32_t id : next.tabs) retain(id);
    for (uint32_t id : next.stack) retain(id);
    retain(next.modal);
    for (uint32_t id : previous) if (!retained.count(id)) destroy(id);
    for (uint32_t id : retained) at(id).mounted = true;
    nav_ = std::move(next);
  }

  void expand_scope(uint32_t id, const std::string &type, std::vector<std::pair<uint32_t, uint32_t>> &found) const {
    for (uint32_t node : layout_.templates[at(id).tpl].roots) expand(id, node, type, found);
  }

  void expand(uint32_t id, uint32_t local, const std::string &type, std::vector<std::pair<uint32_t, uint32_t>> &found) const {
    const Scope &scope = at(id);
    const Node &node = layout_.templates[scope.tpl].nodes[local];
    if (node.element.empty()) {
      const Kids &kid = scope.kids[node.point];
      if (auto *one = std::get_if<uint32_t>(&kid)) expand_scope(*one, type, found);
      if (auto *rows = std::get_if<std::vector<uint32_t>>(&kid)) {
        for (uint32_t row : *rows) expand_scope(row, type, found);
      }
      return;
    }
    if (node.element == type) found.emplace_back(id, local);
    for (uint32_t child : node.children) expand(id, child, type, found);
  }

  std::string annotate(const weft::ops::Op &op) const {
    std::string text = weft::ops::format(op);
    if (op.code == Code::Create && op.index < layout_.templates.size()) {
      return text + "  # " + layout_.templates[op.index].label;
    }
    if (op.code == Code::Set) {
      if (const Scope *scope = get(op.scope)) {
        const Template &tpl = layout_.templates[scope->tpl];
        if (op.index < tpl.values.size()) {
          const Slot &slot = tpl.values[op.index];
          return text + "  # " + tpl.nodes[slot.node].element + "." + slot.prop;
        }
      }
    }
    return text;
  }

  /// Mounts a created, unmounted scope of one of `allowed`.
  uint32_t child(uint32_t id, const std::vector<uint32_t> &allowed) {
    Scope &scope = at(id);
    if (std::find(allowed.begin(), allowed.end(), scope.tpl) == allowed.end()) {
      throw Protocol("scope " + std::to_string(id) + " of template " + std::to_string(scope.tpl) + " cannot be mounted here");
    }
    if (scope.mounted) throw Protocol("scope " + std::to_string(id) + " is already mounted");
    scope.mounted = true;
    return id;
  }

  std::vector<uint32_t> templates_of_kind(const std::string &kind) const {
    std::vector<uint32_t> out;
    for (uint32_t i = 0; i < layout_.templates.size(); i++) {
      if (layout_.templates[i].kind == kind) out.push_back(i);
    }
    return out;
  }

  const Point &point(const Scope &scope, uint32_t index, const char *kind) const {
    auto &points = layout_.templates[scope.tpl].points;
    if (index >= points.size() || points[index].kind != kind) {
      throw Protocol("point " + std::to_string(index) + " of scope " + std::to_string(scope.id) + " is not a " + kind + " point");
    }
    return points[index];
  }

  void destroy(uint32_t id) {
    auto found = scopes_.find(id);
    if (found == scopes_.end()) return;
    auto scope = std::move(found->second);
    scopes_.erase(found);
    for (auto &kid : scope->kids) {
      if (auto *one = std::get_if<uint32_t>(&kid)) destroy(*one);
      if (auto *rows = std::get_if<std::vector<uint32_t>>(&kid)) {
        for (uint32_t row : *rows) destroy(row);
      }
    }
  }

  void apply(const weft::ops::Op &op) {
    switch (op.code) {
      case Code::Splice:
      case Code::Bind:
        throw Protocol("the layout has no lazy mount point");
      case Code::Nav: {
        Navigation next{op.nav.tab, {}, {}, op.nav.modal};
        next.tabs.reserve(op.nav.tabs.count);
        next.stack.reserve(op.nav.stack.count);
        for (uint32_t id : op.nav.tabs) next.tabs.push_back(id);
        for (uint32_t id : op.nav.stack) next.stack.push_back(id);
        set_nav(std::move(next));
        return;
      }
      case Code::Create: {
        if (op.index >= layout_.templates.size()) throw Protocol("unknown template " + std::to_string(op.index));
        if (op.scope == 0 || scopes_.count(op.scope)) throw Protocol("scope id " + std::to_string(op.scope) + " is in use");
        const Template &tpl = layout_.templates[op.index];
        auto scope = std::make_unique<Scope>();
        scope->id = op.scope;
        scope->tpl = op.index;
        scope->values.resize(tpl.values.size());
        scope->shown.resize(tpl.values.size());
        scope->kids.resize(tpl.points.size());
        scopes_.emplace(op.scope, std::move(scope));
        return;
      }
      case Code::Set: {
        Scope &scope = at(op.scope);
        auto &slots = layout_.templates[scope.tpl].values;
        if (op.index >= slots.size()) throw Protocol("scope " + std::to_string(op.scope) + " has no value slot " + std::to_string(op.index));
        const std::string &type = slots[op.index].type;
        auto *number = std::get_if<double>(&op.value);
        bool fits = type == "Int" ? number && std::isfinite(*number) && *number == std::trunc(*number)
                    : type == "Float" ? number != nullptr
                    : type == "Bool" ? std::holds_alternative<bool>(op.value)
                    : type == "Strings" ? std::holds_alternative<weft::ops::StringList>(op.value)
                                        : std::holds_alternative<std::string_view>(op.value);
        if (!fits) throw Protocol(weft::ops::format(op) + " does not fit a " + type + " slot");
        scope.values[op.index] = own(op.value);
        scope.shown[op.index] = scope.values[op.index];
        return;
      }
      case Code::Branch: {
        Scope &scope = at(op.scope);
        const Point &p = point(scope, op.index, "branch");
        if (auto *old = std::get_if<uint32_t>(&scope.kids[op.index])) destroy(*old);
        scope.kids[op.index] = std::monostate{};
        if (op.child != 0) scope.kids[op.index] = child(op.child, p.templates);
        return;
      }
      case Code::Rows: {
        Scope &scope = at(op.scope);
        const Point &p = point(scope, op.index, "list");
        std::vector<uint32_t> old;
        if (auto *rows = std::get_if<std::vector<uint32_t>>(&scope.kids[op.index])) old = *rows;
        std::vector<uint32_t> rows;
        for (uint32_t i = 0; i < op.count; i++) {
          uint32_t id = op.row(i);
          at(id);
          if (std::find(rows.begin(), rows.end(), id) != rows.end()) {
            throw Protocol("scope " + std::to_string(id) + " appears twice in " + weft::ops::format(op));
          }
          rows.push_back(std::find(old.begin(), old.end(), id) != old.end() ? id : child(id, p.templates));
        }
        for (uint32_t id : old) {
          if (std::find(rows.begin(), rows.end(), id) == rows.end()) destroy(id);
        }
        scope.kids[op.index] = std::move(rows);
        return;
      }
      case Code::Attach: {
        if (op.scope == 0) {
          if (op.index != 0 || root_ || nav_) throw Protocol("invalid root " + weft::ops::format(op));
          root_ = child(op.child, templates_of_kind("component"));
          return;
        }
        Scope &scope = at(op.scope);
        auto &points = layout_.templates[scope.tpl].points;
        if (op.index >= points.size()) throw Protocol("scope " + std::to_string(op.scope) + " has no point " + std::to_string(op.index));
        if (!std::holds_alternative<std::monostate>(scope.kids[op.index])) {
          throw Protocol("point " + std::to_string(op.index) + " of scope " + std::to_string(op.scope) + " is attached twice");
        }
        const Point &p = points[op.index];
        if (p.kind == "instance") scope.kids[op.index] = child(op.child, p.templates);
        else if (p.kind == "slot") scope.kids[op.index] = child(op.child, templates_of_kind("slot"));
        else throw Protocol("point " + std::to_string(op.index) + " of scope " + std::to_string(op.scope) + " does not take attach");
        return;
      }
    }
  }
};

/// One encoded value, as `weft_runtime_dispatch` takes it.
std::string encode(const json::Value &value) {
  std::string out;
  if (value.is_bool()) weft::ops::encode_value(value.boolean(), out);
  else if (value.is_number()) weft::ops::encode_value(value.number(), out);
  else weft::ops::encode_value(std::string_view(value.string()), out);
  return out;
}

Value own(const json::Value &value) {
  if (value.is_bool()) return value.boolean();
  if (value.is_number()) return value.number();
  return value.string();
}

/// Limits a UTF-8 edit to a whole-code-point prefix of at most `limit` UTF-16 units.
std::string_view limit_edit(std::string_view text, double limit) {
  if (!(limit >= 0 && limit < text.size())) return text;
  auto remaining = size_t(limit);
  size_t at = 0;
  while (at < text.size() && remaining) {
    const auto lead = static_cast<unsigned char>(text[at]);
    const size_t units = lead < 0xf0 ? 1 : 2;
    if (units > remaining) break;
    remaining -= units;
    at += lead < 0x80 ? 1 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4;
  }
  return text.substr(0, at);
}

/// The platform shell of the run.
struct Host {
  struct Call {
    uint32_t id;
    std::string method;
    std::string args;
  };

  Renderer renderer;
  weft_runtime *rt = nullptr;
  std::deque<Call> calls;
  std::optional<uint64_t> tick_in;
  std::vector<std::vector<std::string>> batches;
  size_t seen = 0;
  std::vector<std::string> golden;
  bool done = false;
  std::string error;

  explicit Host(Layout layout) : renderer(std::move(layout)) {}

  weft_host callbacks() {
    weft_host h{};
    h.protocol = weft::protocol::kVersion;
    h.ctx = this;
    h.commit = [](void *ctx, const uint8_t *ops, size_t len) {
      auto &host = *static_cast<Host *>(ctx);
      try {
        host.batches.push_back(host.renderer.commit(ops, len));
      } catch (const std::exception &e) {
        host.error = std::string("protocol violation: ") + e.what();
      }
    };
    h.schedule = [](void *ctx, uint64_t delay) {
      auto &host = *static_cast<Host *>(ctx);
      host.tick_in = host.tick_in ? std::min(*host.tick_in, delay) : delay;
    };
    h.supports = [](void *, const char *module) { return std::string_view(module) == "conformance"; };
    h.call = [](void *ctx, uint32_t id, const char *, const char *method, const uint8_t *args, size_t len) {
      static_cast<Host *>(ctx)->calls.push_back({id, method, std::string(reinterpret_cast<const char *>(args), len)});
    };
    h.log = [](void *ctx, int level, const char *msg, size_t len) {
      std::fprintf(stderr, "[%d] %.*s\n", level, int(len), msg);
      auto &host = *static_cast<Host *>(ctx);
      if (level == WEFT_LOG_ERROR && host.error.empty()) host.error = std::string(msg, len);
    };
    return h;
  }

  /// Ends a step of the ops log: its name, then every batch since the previous step.
  void step(const std::string &name) {
    golden.push_back("# " + name);
    if (seen == batches.size()) golden.push_back("(no ops)");
    for (; seen < batches.size(); seen++) {
      std::string text;
      for (auto &line : batches[seen]) text += (text.empty() ? "" : "\n") + line;
      golden.push_back(text);
    }
    golden.push_back("");
  }

  bool dispatch(uint32_t scope, uint32_t slot, std::string_view payload) {
    return weft_runtime_dispatch(rt, scope, slot, reinterpret_cast<const uint8_t *>(payload.data()), payload.size());
  }

  /// Edits a controlled element like a user; a rejected edit shows the last value received again.
  void edit(uint32_t scope_id, uint32_t node, const json::Value &value) {
    uint32_t slot = renderer.event_of(scope_id, node, [](const Event &event) { return event.controls.has_value(); });
    Scope &scope = renderer.at(scope_id);
    const auto &tpl = renderer.layout().templates[scope.tpl];
    uint32_t controls = *tpl.events[slot].controls;
    std::string payload;
    if (value.is_string()) {
      const auto &input = tpl.nodes[node];
      double limit = input.max_length;
      if (input.max_length_slot) {
        const auto &current = scope.values[*input.max_length_slot];
        if (current) limit = std::get<double>(*current);
      }
      auto text = limit_edit(value.string(), limit);
      scope.shown[controls] = std::string(text);
      weft::ops::encode_value(text, payload);
    } else {
      scope.shown[controls] = own(value);
      payload = encode(value);
    }
    bool accepted = dispatch(scope_id, slot, payload);
    const Scope *after = renderer.get(scope_id);
    if (!accepted && after) renderer.at(scope_id).shown[controls] = after->values[controls];
  }

  void handle(const Call &call) {
    json::Value args = json::parse(call.args);
    if (call.method == "step") {
      step(args["name"].string());
    } else if (call.method == "click") {
      auto [scope, node] = renderer.find(args["type"].string(), args["index"].u32());
      const std::string *name = args.has("event") ? &args["event"].string() : nullptr;
      uint32_t slot = renderer.event_of(scope, node, [name](const Event &event) {
        return !name || event.name == *name;
      });
      dispatch(scope, slot, args.has("value") ? encode(args["value"]) : std::string{});
    } else if (call.method == "edit") {
      auto [scope, node] = renderer.find(args["type"].string(), args["index"].u32());
      edit(scope, node, args["value"]);
    } else if (call.method == "back") {
      if (auto signal = renderer.back()) weft_runtime_signal(rt, "navigation", signal->data(), signal->size());
    } else if (call.method == "tab") {
      auto signal = renderer.tab(args["index"].u32());
      weft_runtime_signal(rt, "navigation", signal.data(), signal.size());
    } else if (call.method == "done") {
      done = true;
    } else if (call.method == "fail") {
      throw std::runtime_error("the script failed: " + args["message"].string());
    } else {
      throw std::runtime_error("unknown conformance call " + call.method);
    }
    weft_runtime_resolve(rt, call.id, true, nullptr, 0);
  }
};

std::string read_text(const std::string &path) {
  std::ifstream in(path, std::ios::binary);
  if (!in) throw std::runtime_error("cannot read " + path);
  return {std::istreambuf_iterator<char>(in), {}};
}

int run(const std::string &dir, const std::string &golden_path) {
  std::string bundle = read_text(dir + "/bundle.hbc");
  // Hermes needs 4-byte aligned bytecode; vector storage is suitably aligned.
  std::vector<uint8_t> bytecode(bundle.begin(), bundle.end());
  Host host(load_layout(json::parse(read_text(dir + "/layout.json"))));
  weft_host callbacks = host.callbacks();
  host.rt = weft_runtime_new(&callbacks, bytecode.data(), bytecode.size(), host.renderer.layout().hash);
  if (!host.rt) throw std::runtime_error("the bundle did not start: " + host.error);
  struct Free {
    weft_runtime *rt;
    ~Free() { weft_runtime_free(rt); }
  } free{host.rt};

  while (!host.done) {
    if (!host.error.empty()) throw std::runtime_error(host.error);
    if (!host.calls.empty()) {
      Host::Call call = host.calls.front();
      host.calls.pop_front();
      host.handle(call);
    } else if (host.tick_in) {
      std::this_thread::sleep_for(std::chrono::milliseconds(*host.tick_in));
      host.tick_in.reset();
      weft_runtime_tick(host.rt);
    } else {
      throw std::runtime_error("stalled: the bundle neither called the host nor set a timer");
    }
  }
  if (!host.error.empty()) throw std::runtime_error(host.error);

  std::string actual;
  for (size_t i = 0; i < host.golden.size(); i++) actual += (i ? "\n" : "") + host.golden[i];
  std::string expected = read_text(golden_path);
  if (actual == expected) return 0;

  std::istringstream a(actual), e(expected);
  std::string la, le;
  for (int line = 1;; line++) {
    bool more_a = bool(std::getline(a, la)), more_e = bool(std::getline(e, le));
    if (!more_a && !more_e) break;
    if (!more_a || !more_e || la != le) {
      std::fprintf(stderr, "ops log differs from %s at line %d:\n  expected: %s\n  actual:   %s\n", golden_path.c_str(),
                   line, more_e ? le.c_str() : "<end>", more_a ? la.c_str() : "<end>");
      break;
    }
  }
  std::string out = dir + "/actual.ops";
  std::ofstream(out, std::ios::binary) << actual;
  std::fprintf(stderr, "full log written to %s\n", out.c_str());
  return 1;
}

}  // namespace

int main(int argc, char **argv) {
  if (argc != 3) {
    std::fprintf(stderr, "usage: weft_conformance <fixture dir> <golden.ops>\n");
    return 2;
  }
  try {
    return run(argv[1], argv[2]);
  } catch (const std::exception &e) {
    std::fprintf(stderr, "%s\n", e.what());
    return 1;
  }
}
