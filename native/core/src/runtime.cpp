// The native kernel: embeds Hermes, installs the globals a Weft bundle
// needs (`__weft`, timers, `queueMicrotask`, `console`) and forwards between
// the bundle and the platform shell. See include/weft/runtime.h.

#include "weft/runtime.h"

#include <hermes/hermes.h>
#include <jsi/jsi.h>

#include <algorithm>
#include <chrono>
#include <cinttypes>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <limits>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>
#include <vector>

#include "weft/ops.hpp"
#include "weft/protocol.hpp"

namespace jsi = facebook::jsi;
using Clock = std::chrono::steady_clock;

namespace {

/// The app's bytecode, owned by the shell.
class Bytecode final : public jsi::Buffer {
 public:
  Bytecode(const uint8_t *data, size_t len) : data_(data), len_(len) {}
  size_t size() const override { return len_; }
  const uint8_t *data() const override { return data_; }

 private:
  const uint8_t *data_;
  size_t len_;
};

/// A function with its arguments, shared so that it survives its own removal while it runs.
struct Callback {
  jsi::Function fn;
  std::vector<jsi::Value> args;
};

struct Timer {
  Clock::time_point due;
  /// Arming order: breaks ties of `due`, and timers armed during a tick wait for the next one.
  uint64_t seq;
  /// Period of an interval, which may be zero.
  Clock::duration period;
  /// Interval rather than timeout.
  bool repeat;
  std::shared_ptr<Callback> callback;
};

struct PendingCall {
  jsi::Function resolve;
  jsi::Function reject;
};

/// Longest delay accepted by `setTimeout`, as in browsers.
constexpr double kMaxDelayMs = 2147483647.0;

}  // namespace

struct weft_runtime {
  weft_host host{};
  std::string version;
  /// The layout hash of the native views, as the app spells it.
  std::string hash;
  std::unique_ptr<facebook::hermes::HermesRuntime> js;
  // JavaScript values below must be released before `js`, so they are declared after it.
  std::shared_ptr<jsi::Function> dispatch;
  std::shared_ptr<jsi::Function> window;
  std::unordered_map<std::string, std::shared_ptr<jsi::Function>> signals;
  std::shared_ptr<jsi::Function> environment_listener;
  std::map<uint32_t, Timer> timers;
  uint32_t last_timer = 0;
  uint64_t seq = 0;
  /// Deadline of the last `schedule` request not yet followed by a tick.
  std::optional<Clock::time_point> requested;
  std::unordered_map<uint32_t, PendingCall> calls;
  uint32_t last_call = 0;
  /// Nesting of kernel entry points that run JavaScript; microtasks drain at depth 0.
  int depth = 0;
};

namespace {

void log(weft_runtime &rt, int level, std::string_view message) {
  if (rt.host.log) rt.host.log(rt.host.ctx, level, message.data(), message.size());
}

/// Runs JavaScript from a kernel entry point: exceptions are logged and
/// microtasks drained once the outermost entry point finishes.
template <typename F>
bool run(weft_runtime &rt, F &&body) {
  bool ok = true;
  rt.depth++;
  try {
    body();
  } catch (const jsi::JSError &e) {
    ok = false;
    log(rt, WEFT_LOG_ERROR, e.getStack().empty() ? e.getMessage() : e.getStack());
  } catch (const std::exception &e) {
    ok = false;
    log(rt, WEFT_LOG_ERROR, e.what());
  }
  rt.depth--;
  if (rt.depth > 0) return ok;
  for (;;) {
    try {
      if (rt.js->drainMicrotasks()) break;
    } catch (const jsi::JSError &e) {
      log(rt, WEFT_LOG_ERROR, e.getStack().empty() ? e.getMessage() : e.getStack());
    } catch (const std::exception &e) {
      log(rt, WEFT_LOG_ERROR, e.what());
    }
  }
  return ok;
}

/// Asks the shell for a tick at the earliest timer deadline, unless an earlier request is pending.
void request(weft_runtime &rt) {
  if (rt.timers.empty() || !rt.host.schedule) return;
  auto due = std::min_element(rt.timers.begin(), rt.timers.end(), [](auto &a, auto &b) {
               return a.second.due < b.second.due;
             })->second.due;
  if (rt.requested && *rt.requested <= due) return;
  rt.requested = due;
  auto delay = std::chrono::ceil<std::chrono::milliseconds>(due - Clock::now()).count();
  rt.host.schedule(rt.host.ctx, delay > 0 ? uint64_t(delay) : 0);
}

jsi::Function host_function(jsi::Runtime &js, const char *name, unsigned params,
                            jsi::HostFunctionType fn) {
  return jsi::Function::createFromHostFunction(js, jsi::PropNameID::forAscii(js, name), params,
                                               std::move(fn));
}

jsi::Value error(jsi::Runtime &js, std::string_view message) {
  auto ctor = js.global().getPropertyAsFunction(js, "Error");
  return ctor.callAsConstructor(js, jsi::String::createFromUtf8(js, std::string(message)));
}

bool is_function(jsi::Runtime &js, const jsi::Value &value) {
  return value.isObject() && value.getObject(js).isFunction(js);
}

std::pair<size_t, size_t> parse_range(jsi::Runtime &js, double offset, double length, size_t size,
                                      const char *message) {
  const double limit = std::ldexp(1.0, std::numeric_limits<size_t>::digits);
  if (!std::isfinite(offset) || !std::isfinite(length) || offset < 0 || length < 0 ||
      offset >= limit || length >= limit ||
      std::trunc(offset) != offset || std::trunc(length) != length) {
    throw jsi::JSError(js, message);
  }
  auto off = size_t(offset);
  auto len = size_t(length);
  if (off > size || len > size - off) throw jsi::JSError(js, message);
  return {off, len};
}

/// Bytes of a string (UTF-8), ArrayBuffer or ArrayBuffer view; `storage` keeps string bytes alive.
std::pair<const uint8_t *, size_t> bytes_of(jsi::Runtime &js, const jsi::Value &value,
                                            std::string &storage) {
  if (value.isUndefined()) return {nullptr, 0};
  if (value.isString()) {
    storage = value.getString(js).utf8(js);
    return {reinterpret_cast<const uint8_t *>(storage.data()), storage.size()};
  }
  if (value.isObject()) {
    auto object = value.getObject(js);
    if (object.isArrayBuffer(js)) {
      auto buffer = object.getArrayBuffer(js);
      return {buffer.data(js), buffer.size(js)};
    }
    auto inner = object.getProperty(js, "buffer");
    if (inner.isObject() && inner.getObject(js).isArrayBuffer(js)) {
      auto buffer = inner.getObject(js).getArrayBuffer(js);
      auto byte_offset = object.getProperty(js, "byteOffset");
      auto byte_length = object.getProperty(js, "byteLength");
      if (!byte_offset.isNumber() || !byte_length.isNumber()) {
        throw jsi::JSError(js, "weft: view out of bounds");
      }
      auto [offset, length] = parse_range(js, byte_offset.getNumber(), byte_length.getNumber(),
                                          buffer.size(js), "weft: view out of bounds");
      return {length > 0 ? buffer.data(js) + offset : nullptr, length};
    }
  }
  throw jsi::JSError(js, "weft: expected a string, an ArrayBuffer or an ArrayBuffer view");
}

/// Text of one console argument: strings as is, errors by their stack, plain data as JSON.
std::string describe(jsi::Runtime &js, const jsi::Value &value) {
  try {
    if (value.isString()) return value.getString(js).utf8(js);
    if (value.isObject()) {
      auto object = value.getObject(js);
      auto stack = object.getProperty(js, "stack");
      if (stack.isString()) return stack.getString(js).utf8(js);
      if (!object.isFunction(js)) {
        auto stringify = js.global().getPropertyAsObject(js, "JSON").getPropertyAsFunction(js, "stringify");
        auto json = stringify.call(js, value);
        if (json.isString()) return json.getString(js).utf8(js);
      }
    }
    return value.toString(js).utf8(js);
  } catch (const jsi::JSError &) {
    // Cyclic structures and exotic values: fall back to String().
  }
  try {
    return value.toString(js).utf8(js);
  } catch (const jsi::JSError &) {
    return "<unprintable>";
  }
}

jsi::Value arm(weft_runtime &rt, const jsi::Value *args, size_t count, bool repeat) {
  auto &js = *rt.js;
  if (count == 0 || !is_function(js, args[0])) {
    throw jsi::JSError(js, repeat ? "setInterval expects a function" : "setTimeout expects a function");
  }
  double ms = count > 1 && args[1].isNumber() ? args[1].getNumber() : 0;
  if (!(ms > 0)) ms = 0;
  ms = std::min(ms, kMaxDelayMs);
  auto callback = std::make_shared<Callback>(Callback{args[0].getObject(js).getFunction(js), {}});
  for (size_t i = 2; i < count; i++) callback->args.emplace_back(js, args[i]);
  auto period = std::chrono::duration_cast<Clock::duration>(std::chrono::duration<double, std::milli>(ms));
  uint32_t id = ++rt.last_timer;
  rt.timers.emplace(id, Timer{Clock::now() + period, ++rt.seq, period, repeat, std::move(callback)});
  request(rt);
  return jsi::Value(double(id));
}

void install_timers(weft_runtime &rt) {
  auto &js = *rt.js;
  auto global = js.global();
  global.setProperty(js, "setTimeout", host_function(js, "setTimeout", 2, [&rt](jsi::Runtime &, const jsi::Value &, const jsi::Value *args, size_t count) {
    return arm(rt, args, count, false);
  }));
  global.setProperty(js, "setInterval", host_function(js, "setInterval", 2, [&rt](jsi::Runtime &, const jsi::Value &, const jsi::Value *args, size_t count) {
    return arm(rt, args, count, true);
  }));
  auto clear = [&rt](jsi::Runtime &, const jsi::Value &, const jsi::Value *args, size_t count) {
    if (count > 0 && args[0].isNumber()) {
      double raw = args[0].getNumber();
      if (std::isfinite(raw) && raw >= 0 && raw <= double(UINT32_MAX) && std::trunc(raw) == raw) {
        rt.timers.erase(uint32_t(raw));
      }
    }
    return jsi::Value::undefined();
  };
  global.setProperty(js, "clearTimeout", host_function(js, "clearTimeout", 1, clear));
  global.setProperty(js, "clearInterval", host_function(js, "clearInterval", 1, clear));
  global.setProperty(js, "queueMicrotask", host_function(js, "queueMicrotask", 1, [](jsi::Runtime &js, const jsi::Value &, const jsi::Value *args, size_t count) {
    if (count == 0 || !is_function(js, args[0])) throw jsi::JSError(js, "queueMicrotask expects a function");
    js.queueMicrotask(args[0].getObject(js).getFunction(js));
    return jsi::Value::undefined();
  }));
}

void install_console(weft_runtime &rt) {
  auto &js = *rt.js;
  jsi::Object console(js);
  auto method = [&](const char *name, int level) {
    console.setProperty(js, name, host_function(js, name, 0, [&rt, level](jsi::Runtime &js, const jsi::Value &, const jsi::Value *args, size_t count) {
      std::string line;
      for (size_t i = 0; i < count; i++) {
        if (i > 0) line += ' ';
        line += describe(js, args[i]);
      }
      log(rt, level, line);
      return jsi::Value::undefined();
    }));
  };
  method("debug", WEFT_LOG_DEBUG);
  method("log", WEFT_LOG_INFO);
  method("info", WEFT_LOG_INFO);
  method("warn", WEFT_LOG_WARN);
  method("error", WEFT_LOG_ERROR);
  js.global().setProperty(js, "console", console);
}

/// `globalThis.__weft`: the bundle's side of the kernel (see `@weft-ui/runtime/native`).
void install_weft(weft_runtime &rt, const char *environment, const char *launch) {
  auto &js = *rt.js;
  jsi::Object weft(js);
  weft.setProperty(js, "version", jsi::String::createFromUtf8(js, rt.version));
  weft.setProperty(js, "protocol", int(weft::protocol::kVersion));
  weft.setProperty(js, "launch", jsi::String::createFromUtf8(js, launch ? launch : "{}"));
  weft.setProperty(js, "on", host_function(js, "on", 2, [&rt](jsi::Runtime &js, const jsi::Value &, const jsi::Value *args, size_t count) {
    if (count < 2 || !args[0].isString() || !is_function(js, args[1]))
      throw jsi::JSError(js, "weft: on expects a name and callback");
    rt.signals.insert_or_assign(args[0].getString(js).utf8(js),
        std::make_shared<jsi::Function>(args[1].getObject(js).getFunction(js)));
    return jsi::Value::undefined();
  }));
  const char *json = environment ? environment : "{}";
  weft.setProperty(js, "environment", jsi::String::createFromUtf8(
      js, reinterpret_cast<const uint8_t *>(json), std::strlen(json)));
  weft.setProperty(js, "listen", host_function(js, "listen", 1, [&rt](jsi::Runtime &js, const jsi::Value &, const jsi::Value *args, size_t count) {
    if (count == 0 || !is_function(js, args[0])) {
      throw jsi::JSError(js, "weft: listen expects a function");
    }
    rt.environment_listener = std::make_shared<jsi::Function>(args[0].getObject(js).getFunction(js));
    return jsi::Value::undefined();
  }));

  weft.setProperty(js, "open", host_function(js, "open", 4, [&rt](jsi::Runtime &js, const jsi::Value &, const jsi::Value *args, size_t count) {
    if (count < 3 || !args[0].isString() || !is_function(js, args[1]) || !args[2].isNumber()) {
      throw jsi::JSError(js, "weft: open expects a layout hash, a dispatch function and a protocol version");
    }
    if (args[2].getNumber() != weft::protocol::kVersion) {
      throw jsi::JSError(js, "weft: protocol mismatch: bundle speaks " +
          describe(js, args[2]) + ", kernel speaks " + std::to_string(weft::protocol::kVersion));
    }
    if (count < 4 || !is_function(js, args[3]))
      throw jsi::JSError(js, "weft: open expects a window function");
    auto hash = args[0].getString(js).utf8(js);
    if (hash != rt.hash) {
      throw jsi::JSError(js, "weft: layout mismatch (native views " + rt.hash + ", app " + hash +
                                 "); rebuild the app so the bundle and the views match");
    }
    if (rt.dispatch) throw jsi::JSError(js, "weft: the native views already render an app");
    rt.dispatch = std::make_shared<jsi::Function>(args[1].getObject(js).getFunction(js));
    rt.window = std::make_shared<jsi::Function>(args[3].getObject(js).getFunction(js));
    return jsi::Value::undefined();
  }));

  weft.setProperty(js, "close", host_function(js, "close", 0, [&rt](jsi::Runtime &, const jsi::Value &, const jsi::Value *, size_t) {
    rt.dispatch.reset();
    rt.window.reset();
    return jsi::Value::undefined();
  }));

  weft.setProperty(js, "commit", host_function(js, "commit", 3, [&rt](jsi::Runtime &js, const jsi::Value &, const jsi::Value *args, size_t count) {
    if (!rt.dispatch) throw jsi::JSError(js, "weft: commit before open");
    if (count < 3 || !args[0].isObject() || !args[0].getObject(js).isArrayBuffer(js) ||
        !args[1].isNumber() || !args[2].isNumber()) {
      throw jsi::JSError(js, "weft: commit expects an ArrayBuffer, an offset and a length");
    }
    auto buffer = args[0].getObject(js).getArrayBuffer(js);
    auto [offset, length] = parse_range(js, args[1].getNumber(), args[2].getNumber(),
                                        buffer.size(js), "weft: commit range out of bounds");
    if (rt.host.commit) {
      rt.host.commit(rt.host.ctx, length > 0 ? buffer.data(js) + offset : nullptr, length);
    }
    return jsi::Value::undefined();
  }));

  weft.setProperty(js, "supports", host_function(js, "supports", 1, [&rt](jsi::Runtime &js, const jsi::Value &, const jsi::Value *args, size_t count) {
    if (count == 0 || !args[0].isString() || !rt.host.supports || !rt.host.call) return jsi::Value(false);
    return jsi::Value(rt.host.supports(rt.host.ctx, args[0].getString(js).utf8(js).c_str()));
  }));

  weft.setProperty(js, "call", host_function(js, "call", 3, [&rt](jsi::Runtime &js, const jsi::Value &, const jsi::Value *args, size_t count) {
    if (count < 2 || !args[0].isString() || !args[1].isString()) {
      throw jsi::JSError(js, "weft: call expects a module and a method name");
    }
    auto module = args[0].getString(js).utf8(js);
    auto method = args[1].getString(js).utf8(js);
    std::string storage;
    auto [data, len] = count > 2 ? bytes_of(js, args[2], storage) : std::pair<const uint8_t *, size_t>{};

    std::optional<jsi::Function> resolve, reject;
    auto executor = host_function(js, "executor", 2, [&](jsi::Runtime &js, const jsi::Value &, const jsi::Value *args, size_t count) {
      if (count >= 2 && is_function(js, args[0]) && is_function(js, args[1])) {
        resolve = args[0].getObject(js).getFunction(js);
        reject = args[1].getObject(js).getFunction(js);
      }
      return jsi::Value::undefined();
    });
    auto promise_val = js.global().getProperty(js, "Promise");
    if (!is_function(js, promise_val)) {
      throw jsi::JSError(js, "weft: Promise constructor is not callable");
    }
    auto promise = promise_val.getObject(js).getFunction(js).callAsConstructor(js, executor);
    if (!resolve || !reject) {
      throw jsi::JSError(js, "weft: Promise constructor did not invoke executor");
    }

    bool supported = rt.host.supports && rt.host.call && rt.host.supports(rt.host.ctx, module.c_str());
    if (!supported) {
      reject->call(js, error(js, "weft: platform module \"" + module + "\" is not supported"));
      return promise;
    }
    uint32_t id = ++rt.last_call;
    rt.calls.emplace(id, PendingCall{std::move(*resolve), std::move(*reject)});
    rt.host.call(rt.host.ctx, id, module.c_str(), method.c_str(), data, len);
    return promise;
  }));

  js.global().setProperty(js, "__weft", weft);
}

}  // namespace

extern "C" {

weft_runtime *weft_runtime_new(const weft_host *host, const uint8_t *bytecode, size_t len,
                               uint64_t layout_hash) {
  if (!host) return nullptr;
  if (host->protocol != weft::protocol::kVersion) {
    if (host->log) {
      std::string message = "weft: protocol mismatch: kernel speaks " +
          std::to_string(weft::protocol::kVersion) + ", shell speaks " + std::to_string(host->protocol);
      host->log(host->ctx, WEFT_LOG_ERROR, message.data(), message.size());
    }
    return nullptr;
  }
  auto rt = std::make_unique<weft_runtime>();
  rt->host = *host;
  rt->version = host->version ? host->version : "";
  rt->host.version = nullptr;
  rt->host.environment = nullptr;
  rt->host.launch = nullptr;
  char hash[17];
  std::snprintf(hash, sizeof hash, "%016" PRIx64, layout_hash);
  rt->hash = hash;
  try {
    rt->js = facebook::hermes::makeHermesRuntime(
        ::hermes::vm::RuntimeConfig::Builder().withMicrotaskQueue(true).build());
    install_timers(*rt);
    install_console(*rt);
    install_weft(*rt, host->environment, host->launch);
  } catch (const std::exception &e) {
    log(*rt, WEFT_LOG_ERROR, std::string("weft: cannot start Hermes: ") + e.what());
    return nullptr;
  }
  bool ok = run(*rt, [&] {
    rt->js->evaluateJavaScript(std::make_shared<Bytecode>(bytecode, len), "bundle.hbc");
  });
  if (!ok) {
    log(*rt, WEFT_LOG_ERROR, "weft: the bundle failed to start");
    return nullptr;
  }
  return rt.release();
}

void weft_runtime_tick(weft_runtime *rt) {
  rt->requested.reset();
  auto now = Clock::now();
  uint64_t horizon = rt->seq;
  for (;;) {
    auto next = rt->timers.end();
    for (auto it = rt->timers.begin(); it != rt->timers.end(); ++it) {
      const Timer &t = it->second;
      if (t.seq > horizon || t.due > now) continue;
      if (next == rt->timers.end() || t.due < next->second.due ||
          (t.due == next->second.due && t.seq < next->second.seq)) {
        next = it;
      }
    }
    if (next == rt->timers.end()) break;
    auto callback = next->second.callback;
    if (!next->second.repeat) {
      rt->timers.erase(next);
    } else {
      // A new arming order defers the repeat to the next tick, even with a zero period.
      next->second.due = now + next->second.period;
      next->second.seq = ++rt->seq;
    }
    run(*rt, [&] {
      callback->fn.call(*rt->js, static_cast<const jsi::Value *>(callback->args.data()),
                        callback->args.size());
    });
  }
  request(*rt);
}

bool weft_runtime_dispatch(weft_runtime *rt, uint32_t scope, uint32_t handler,
                           const uint8_t *payload, size_t len) {
  auto dispatch = rt->dispatch;
  if (!dispatch) return true;
  std::optional<weft::ops::Value> value;
  if (len > 0) {
    try {
      const uint8_t *at = payload;
      value = weft::ops::read_value(at, payload + len);
      if (std::holds_alternative<weft::ops::StringList>(*value)) {
        log(*rt, WEFT_LOG_ERROR, "weft: string lists are not event payloads");
        return true;
      }
      if (at != payload + len) {
        log(*rt, WEFT_LOG_ERROR, "weft: trailing bytes after the payload");
        return true;
      }
    } catch (const weft::ops::Error &e) {
      log(*rt, WEFT_LOG_ERROR, e.what());
      return true;
    }
  }
  bool accepted = true;
  run(*rt, [&] {
    auto &js = *rt->js;
    jsi::Value arg;
    if (value) {
      if (auto *flag = std::get_if<bool>(&*value)) {
        arg = jsi::Value(*flag);
      } else if (auto *number = std::get_if<double>(&*value)) {
        arg = jsi::Value(*number);
      } else {
        auto text = std::get<std::string_view>(*value);
        arg = jsi::String::createFromUtf8(js, reinterpret_cast<const uint8_t *>(text.data()), text.size());
      }
    }
    auto result = dispatch->call(js, jsi::Value(double(scope)), jsi::Value(double(handler)), std::move(arg));
    if (result.isBool()) accepted = result.getBool();
  });
  request(*rt);
  return accepted;
}

void weft_runtime_resolve(weft_runtime *rt, uint32_t id, bool ok, const uint8_t *result,
                          size_t len) {
  auto found = rt->calls.find(id);
  if (found == rt->calls.end()) return;
  PendingCall call = std::move(found->second);
  rt->calls.erase(found);
  run(*rt, [&] {
    auto &js = *rt->js;
    if (!ok) {
      call.reject.call(js, error(js, std::string_view(reinterpret_cast<const char *>(result), len)));
      return;
    }
    auto buffer = js.global()
                      .getPropertyAsFunction(js, "ArrayBuffer")
                      .callAsConstructor(js, double(len))
                      .getObject(js)
                      .getArrayBuffer(js);
    if (len > 0) std::memcpy(buffer.data(js), result, len);
    call.resolve.call(js, std::move(buffer));
  });
  request(*rt);
}

void weft_runtime_window(weft_runtime *rt, uint32_t scope, uint32_t point, uint32_t start, uint32_t end) {
  run(*rt, [&] {
    if (auto window = rt->window)
      window->call(*rt->js, double(scope), double(point), double(start), double(end));
  });
  request(*rt);
}

void weft_runtime_signal(weft_runtime *rt, const char *name, const char *json, size_t len) {
  run(*rt, [&] {
    auto found = rt->signals.find(name ? name : "");
    if (found == rt->signals.end()) return;
    auto callback = found->second;  // The callback may replace itself.
    auto text = jsi::String::createFromUtf8(*rt->js, reinterpret_cast<const uint8_t *>(json), len);
    callback->call(*rt->js, std::move(text));
  });
  request(*rt);
}

void weft_runtime_environment(weft_runtime *rt, const char *json, size_t len) {
  run(*rt, [&] {
    auto &js = *rt->js;
    auto weft = js.global().getPropertyAsObject(js, "__weft");
    weft.setProperty(js, "environment", jsi::String::createFromUtf8(
        js, reinterpret_cast<const uint8_t *>(json), len));
    // The listener can replace itself during the call.
    if (auto listener = rt->environment_listener) listener->call(js);
  });
  request(*rt);
}

void weft_runtime_free(weft_runtime *rt) { delete rt; }

}  // extern "C"
