#include <sys/utsname.h>

#include <json-glib/json-glib.h>

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <exception>
#include <unordered_set>
#include <utility>

#include "appearance.hpp"
#include "assets.hpp"
#include "platform.hpp"
#include "ui.hpp"
#include "point.hpp"
#include "container.hpp"
#include "weft/gtk.hpp"
#include "weft/protocol.hpp"

namespace weft {

namespace {

/// Why a batch of ops does not fit the views.
struct OpError : std::runtime_error {
  using std::runtime_error::runtime_error;
};

/// Console messages and diagnostics go to stderr.
void write_log(int level, std::string_view message) {
  static constexpr const char *kLevels[] = {"debug", "info", "warn", "error"};
  std::fprintf(stderr, "[weft %s] %.*s\n", kLevels[std::clamp(level, 0, 3)], int(message.size()), message.data());
}

/// The OS version reported as `platform.version`: the distribution's
/// version, else the kernel release.
std::string os_version() {
  char *version = g_get_os_info(G_OS_INFO_KEY_VERSION_ID);
  if (version) {
    std::string result(version);
    g_free(version);
    return result;
  }
  utsname name{};
  return uname(&name) == 0 ? name.release : "";
}

/// Scope 0: holds the root component instance at mount point 0.
class RootScope final : public Scope {
 public:
  RootScope(Session &session, GtkWidget *page) : Scope(0, session, 1), page_(page) { page_.point(*this, 0); }

 private:
  Region page_;
};

}  // namespace

struct Session::Environment {
  struct Snapshot {
    bool dark;
    int width;
    int height;
    int scale;

    bool operator==(const Snapshot &) const = default;

    char *json() const {
      auto *obj = json_object_new();
      json_object_set_string_member(obj, "colorScheme", dark ? "dark" : "light");
      auto *screen = json_object_new();
      json_object_set_int_member(screen, "width", width);
      json_object_set_int_member(screen, "height", height);
      json_object_set_int_member(screen, "scale", scale);
      json_object_set_object_member(obj, "screen", screen);
      auto *safe = json_object_new();
      for (const char *edge : {"top", "bottom", "start", "end"}) json_object_set_int_member(safe, edge, 0);
      json_object_set_object_member(obj, "safeArea", safe);
      json_object_set_string_member(obj, "orientation", width > height ? "landscape" : "portrait");
      auto *node = json_node_new(JSON_NODE_OBJECT);
      json_node_take_object(node, obj);
      char *result = json_to_string(node, false);
      json_node_unref(node);
      return result;
    }
  };

  explicit Environment(GtkWidget *view) : view(view) {}

  ~Environment() {
    if (idle) g_source_remove(idle);
  }

  Snapshot current() const {
    return {weft::dark(), gtk_widget_get_width(view), gtk_widget_get_height(view), gtk_widget_get_scale_factor(view)};
  }

  GtkWidget *view;
  Snapshot sent{};
  std::optional<Appearance> appearance;
  bool colors_changed = false;
  guint idle = 0;
};

GtkWidget *Session::start(uint64_t layout_hash, [[maybe_unused]] bool safe_area, Factory make) {
  register_asset_fonts();
  GtkWidget *page = linear_new(Axis::Vertical);
  gtk_widget_set_overflow(page, GTK_OVERFLOW_HIDDEN);
  GtkWidget *overlay = gtk_overlay_new();
  gtk_overlay_set_child(GTK_OVERLAY(overlay), page);
  // The session ends with the root widget.
  auto *session = new Session(page, make);
  session->ui_ = std::make_shared<platform::Ui>(overlay);
  g_object_set_data(G_OBJECT(page), "weft-session", session);
  g_object_set_data_full(G_OBJECT(overlay), "weft-session", session,
                         [](gpointer session) { delete static_cast<Session *>(session); });
  // GTK has no width/height notifications; observe the root's allocation.
  container_on_allocate(page, [](GtkWidget *widget) {
    static_cast<Session *>(g_object_get_data(G_OBJECT(widget), "weft-session"))->queue_environment();
  });
  g_signal_connect(page, "notify::scale-factor", G_CALLBACK(+[](GtkWidget *, GParamSpec *, gpointer data) {
    static_cast<Session *>(data)->queue_environment();
  }), session);
  session->open(weft_directory() + "/bundle.hbc", layout_hash);
  return overlay;
}

Session::Session(GtkWidget *page, Factory make)
    : make_(make), page_(page), environment_(std::make_unique<Environment>(page)), cancellable_(g_cancellable_new()) {
  scopes_[0] = std::make_unique<RootScope>(*this, page);
}

Session::~Session() {
  if (ui_) ui_->close();
  weft_runtime_free(runtime_);
  g_cancellable_cancel(cancellable_);
  g_object_unref(cancellable_);
  if (timer_) g_source_remove(timer_);
  if (sweep_) g_source_remove(sweep_);
  if (focus_idle_) g_source_remove(focus_idle_);
  scopes_.clear();
  dead_.clear();
  if (bytecode_) g_mapped_file_unref(bytecode_);
}

void Session::open(const std::string &bundle, uint64_t layout_hash) {
  GError *error = nullptr;
  // Mapped files are page aligned and stay unchanged: the kernel keeps using the bytecode.
  bytecode_ = g_mapped_file_new(bundle.c_str(), false, &error);
  if (!bytecode_) {
    fail("weft: cannot read the bundle " + bundle + ": " + error->message);
    g_error_free(error);
    return;
  }
  std::string version = os_version();
  environment_->appearance.emplace([](void *data) {
    auto &session = *static_cast<Session *>(data);
    session.environment_->colors_changed = true;
    session.queue_environment();
  }, this);
  environment_->sent = environment_->current();
  g_autofree char *environment = environment_->sent.json();
  weft_host host{
      .protocol = weft::protocol::kVersion,
      .ctx = this,
      .commit = on_commit,
      .schedule = on_schedule,
      .supports = on_supports,
      .call = on_call,
      .log = on_log,
      .version = version.c_str(),
      .environment = environment,
      .launch = nullptr,
  };
  runtime_ = weft_runtime_new(&host, reinterpret_cast<const uint8_t *>(g_mapped_file_get_contents(bytecode_)),
                              g_mapped_file_get_length(bytecode_), layout_hash);
  if (!runtime_) fail(last_error_.empty() ? "weft: the app failed to start" : last_error_);
}

void Session::queue_environment() {
  auto &env = *environment_;
  if (!runtime_ || env.idle || (!env.colors_changed && env.current() == env.sent)) return;
  // Theme updates and environment listeners can change the views, so run outside GTK allocation/signals.
  env.idle = g_idle_add([](gpointer data) -> gboolean {
    auto &session = *static_cast<Session *>(data);
    auto &env = *session.environment_;
    env.idle = 0;
    if (std::exchange(env.colors_changed, false)) {
      for (auto &entry : session.scopes_) {
        for (auto &element : entry.second->elements_) element->reapply_colors();
      }
    }
    auto updated = env.current();
    if (updated != env.sent) {
      env.sent = updated;
      g_autofree char *json = updated.json();
      weft_runtime_environment(session.runtime_, json, std::strlen(json));
    }
    return G_SOURCE_REMOVE;
  }, this);
}

void Session::queue_focus(uint32_t scope, uint32_t slot, bool focused) {
  if (failed_ || !scopes_.contains(scope)) return;
  focus_events_.push_back({scope, slot, focused});
  if (focus_idle_) return;
  // Focus can change inside GTK's focus handling or while applying a Set op.
  // Deliver both edges in order once it is safe to run the kernel again.
  focus_idle_ = g_idle_add([](gpointer data) -> gboolean {
    auto &session = *static_cast<Session *>(data);
    for (size_t i = 0; i < session.focus_events_.size() && !session.failed_; ++i) {
      const auto [scope, slot, focused] = session.focus_events_[i];
      if (auto it = session.scopes_.find(scope); it != session.scopes_.end()) {
        it->second->dispatch(slot, focused);
      }
    }
    session.focus_events_.clear();
    session.focus_idle_ = 0;
    return G_SOURCE_REMOVE;
  }, this);
}

bool Session::dispatch(uint32_t scope, uint32_t slot, const std::string &payload) {
  if (committing_) {
    write_log(WEFT_LOG_ERROR, "weft: an event was dispatched while ops were applied");
    return true;
  }
  if (!runtime_) return true;
  return weft_runtime_dispatch(runtime_, scope, slot, reinterpret_cast<const uint8_t *>(payload.data()),
                               payload.size());
}

void Session::window(uint32_t scope, uint32_t point, uint32_t start, uint32_t end) {
  if (committing_) {
    write_log(WEFT_LOG_ERROR, "weft: a window was requested while ops were applied");
    return;
  }
  if (runtime_) weft_runtime_window(runtime_, scope, point, start, end);
}

void Session::signal(const std::string &name, std::string_view json) {
  if (committing_) {
    write_log(WEFT_LOG_ERROR, "weft: a signal was sent while ops were applied");
    return;
  }
  if (runtime_) weft_runtime_signal(runtime_, name.c_str(), json.empty() ? "" : json.data(), json.size());
}

void Session::commit(const uint8_t *ops, size_t len) {
  if (failed_) return;
  committing_ = true;
  try {
    auto batch = ops::read_all(ops, len);
    for (const auto &op : batch) {
      if (op.code == protocol::Code::Splice || op.code == protocol::Code::Bind || op.code == protocol::Code::Nav)
        throw OpError("the layout has no lazy mount point or app");
    }
    for (const auto &op : batch) apply(op);
  } catch (const std::exception &error) {
    committing_ = false;
    fail(std::string("weft: cannot apply ops (") + error.what() + ")");
  }
  committing_ = false;
}

void Session::apply(const ops::Op &op) {
  switch (op.code) {
    case protocol::Code::Create: {
      auto scope = make_(op.index, op.scope, *this);
      if (!scope) throw OpError("the views have no template " + std::to_string(op.index));
      scopes_[op.scope] = std::move(scope);
      break;
    }
    case protocol::Code::Set: {
      auto found = scopes_.find(op.scope);
      if (found != scopes_.end()) found->second->apply(op.index, op.value);
      break;
    }
    case protocol::Code::Branch:
      mount(op.scope, op.index, op.child == 0 ? std::vector<uint32_t>{} : std::vector<uint32_t>{op.child});
      break;
    case protocol::Code::Attach:
      mount(op.scope, op.index, {op.child});
      break;
    case protocol::Code::Splice:
    case protocol::Code::Bind:
    case protocol::Code::Nav:
      throw OpError("the layout has no lazy mount point or app");
    case protocol::Code::Rows: {
      std::vector<uint32_t> rows(op.count);
      for (uint32_t i = 0; i < op.count; i++) rows[i] = op.row(i);
      mount(op.scope, op.index, std::move(rows));
      break;
    }
  }
}

void Session::mount(uint32_t parent, uint32_t index, std::vector<uint32_t> ids) {
  auto found = scopes_.find(parent);
  if (found == scopes_.end()) return;
  Scope &scope = *found->second;
  if (index >= scope.points_.size() || !scope.points_[index]) {
    throw OpError("scope " + std::to_string(parent) + " has no mount point " + std::to_string(index));
  }
  Point &point = *scope.points_[index];
  std::unordered_set<uint32_t> kept(ids.begin(), ids.end());
  for (Scope *old : point.children) {
    if (!kept.contains(old->id())) destroy(*old);
  }
  std::vector<Scope *> children;
  children.reserve(ids.size());
  for (uint32_t id : ids) {
    auto child = scopes_.find(id);
    if (child != scopes_.end()) children.push_back(child->second.get());
  }
  point.mount(std::move(children));
}

void Session::destroy(Scope &scope) {
  for (auto &point : scope.points_) {
    if (!point) continue;
    for (Scope *child : point->children) destroy(*child);
  }
  auto found = scopes_.find(scope.id());
  if (found == scopes_.end()) return;
  dead_.push_back(std::move(found->second));
  scopes_.erase(found);
  if (!sweep_) {
    sweep_ = g_idle_add(
        [](gpointer data) {
          auto *session = static_cast<Session *>(data);
          session->sweep_ = 0;
          session->dead_.clear();
          return G_SOURCE_REMOVE;
        },
        this);
  }
}

void Session::schedule(uint64_t delay_ms) {
  auto delay = guint(std::min<uint64_t>(delay_ms, G_MAXINT));
  int64_t at = g_get_monotonic_time() / 1000 + delay;
  if (timer_ && at >= due_) return;
  if (timer_) g_source_remove(timer_);
  due_ = at;
  timer_ = g_timeout_add(delay, [](gpointer data) {
    auto *session = static_cast<Session *>(data);
    session->timer_ = 0;
    if (session->runtime_) weft_runtime_tick(session->runtime_);
    return G_SOURCE_REMOVE;
  }, this);
}

void Session::call(uint32_t id, std::string module, std::string method, std::vector<uint8_t> args) {
  auto done = [this, id](bool ok, std::vector<uint8_t> result) { resolve(id, ok, result); };
  if (module == protocol::kUiModule) ui_->call(std::move(method), std::move(args), cancellable_, std::move(done));
  else platform::call(module, method, std::move(args), cancellable_, std::move(done));
}

void Session::resolve(uint32_t id, bool ok, const std::vector<uint8_t> &result) {
  if (runtime_) weft_runtime_resolve(runtime_, id, ok, result.data(), result.size());
}

void Session::fail(const std::string &message) {
  write_log(WEFT_LOG_ERROR, message);
  failed_ = true;
  while (GtkWidget *child = gtk_widget_get_first_child(page_)) gtk_widget_unparent(child);
  GtkWidget *label = gtk_label_new(message.c_str());
  gtk_label_set_wrap(GTK_LABEL(label), true);
  gtk_label_set_xalign(GTK_LABEL(label), 0);
  gtk_widget_add_css_class(label, "error");
  gtk_widget_set_margin_start(label, 16);
  gtk_widget_set_margin_end(label, 16);
  gtk_widget_set_margin_top(label, 16);
  gtk_widget_set_margin_bottom(label, 16);
  gtk_widget_set_parent(label, page_);
}

// Kernel callbacks; every one arrives on the main thread. Exceptions must not
// unwind into the kernel.

void Session::on_commit(void *ctx, const uint8_t *ops, size_t len) { static_cast<Session *>(ctx)->commit(ops, len); }

void Session::on_schedule(void *ctx, uint64_t delay_ms) { static_cast<Session *>(ctx)->schedule(delay_ms); }

bool Session::on_supports(void *, const char *module) { return module && platform::supported(module); }

void Session::on_call(void *ctx, uint32_t id, const char *module, const char *method, const uint8_t *args,
                      size_t len) {
  try {
    static_cast<Session *>(ctx)->call(id, module, method, {args, args + len});
  } catch (const std::exception &error) {
    write_log(WEFT_LOG_ERROR, std::string("weft: cannot start a platform call (") + error.what() + ")");
  }
}

void Session::on_log(void *ctx, int level, const char *msg, size_t len) {
  std::string_view message(msg, len);
  write_log(level, message);
  if (level >= WEFT_LOG_ERROR) static_cast<Session *>(ctx)->last_error_ = message;
}

}  // namespace weft
