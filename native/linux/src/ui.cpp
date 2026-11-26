#include "ui.hpp"
#include "frame.hpp"
#include <json-glib/json-glib.h>
#include <stdexcept>
#include <utility>

namespace weft::platform {
namespace {
std::vector<uint8_t> bytes(std::string_view value) { return {value.begin(), value.end()}; }
std::string str(JsonObject *obj, const char *key, const char *fallback = "") {
  if (!json_object_has_member(obj, key)) return fallback;
  auto *node = json_object_get_member(obj, key);
  if (!JSON_NODE_HOLDS_VALUE(node) || json_node_get_value_type(node) != G_TYPE_STRING)
    throw std::runtime_error(std::string("weft: ui expected string ") + key);
  return json_node_get_string(node);
}
}
UiOptions parse_ui(std::string_view method, const std::vector<uint8_t> &args) {
  g_autoptr(JsonNode) root = parse_json({reinterpret_cast<const char *>(args.data()), args.size()}, "ui arguments");
  if (!JSON_NODE_HOLDS_OBJECT(root)) throw std::runtime_error("weft: ui expects an object");
  auto *obj = json_node_get_object(root);
  UiOptions out;
  out.title = str(obj, "title"); out.message = str(obj, "message");
  out.confirm_text = str(obj, "confirmText", "OK"); out.cancel_text = str(obj, "cancelText", "Cancel");
  if (method == "confirm" && json_object_has_member(obj, "destructive")) {
    auto *node = json_object_get_member(obj, "destructive");
    if (!JSON_NODE_HOLDS_VALUE(node) || json_node_get_value_type(node) != G_TYPE_BOOLEAN)
      throw std::runtime_error("weft: ui destructive must be boolean");
    out.destructive = json_node_get_boolean(node);
  }
  if (method == "actionSheet") {
    auto *node = json_object_get_member(obj, "options");
    if (!node || !JSON_NODE_HOLDS_ARRAY(node)) throw std::runtime_error("weft: ui options must be an array");
    auto *array = json_node_get_array(node);
    auto count = json_array_get_length(array);
    if (count < 1 || count > 6) throw std::runtime_error("weft: ui actionSheet expects 1 to 6 options");
    for (guint i = 0; i < count; ++i) {
      auto *item = json_array_get_element(array, i);
      if (!JSON_NODE_HOLDS_VALUE(item) || json_node_get_value_type(item) != G_TYPE_STRING)
        throw std::runtime_error("weft: ui options must be strings");
      out.options.emplace_back(json_node_get_string(item));
    }
    if (json_object_has_member(obj, "destructiveIndex")) {
      auto *index = json_object_get_member(obj, "destructiveIndex");
      if (!JSON_NODE_HOLDS_VALUE(index) || json_node_get_value_type(index) != G_TYPE_INT64)
        throw std::runtime_error("weft: ui destructiveIndex must be an integer");
      out.destructive_index = int(json_node_get_int(index));
    }
  } else if (method == "toast") {
    out.icon = str(obj, "icon", "none"); out.duration = str(obj, "duration", "short");
  } else if (method != "alert" && method != "confirm") throw std::runtime_error("weft: unknown ui method");
  return out;
}
std::vector<uint8_t> ui_result(std::string_view method, int choice) {
  if (method == "confirm") return bytes(choice == 1 ? "true" : "false");
  if (method == "actionSheet") return bytes(choice < 0 ? "null" : std::to_string(choice));
  return {};
}
Ui::Ui(GtkWidget *overlay) : overlay_(overlay), cancel_(g_cancellable_new()) {
  revealer_ = gtk_revealer_new();
  gtk_widget_set_halign(revealer_, GTK_ALIGN_CENTER); gtk_widget_set_valign(revealer_, GTK_ALIGN_END);
  gtk_widget_set_margin_bottom(revealer_, 32);
  toast_label_ = gtk_label_new("");
  gtk_widget_add_css_class(toast_label_, "weft-toast");
  auto *css = gtk_css_provider_new();
  gtk_css_provider_load_from_data(css, ".weft-toast { background: alpha(black, 0.85); color: white; border-radius: 24px; padding: 12px 20px; }", -1);
  gtk_style_context_add_provider(gtk_widget_get_style_context(toast_label_), GTK_STYLE_PROVIDER(css), GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
  g_object_unref(css);
  gtk_revealer_set_child(GTK_REVEALER(revealer_), toast_label_);
  gtk_overlay_add_overlay(GTK_OVERLAY(overlay_), revealer_);
}
Ui::~Ui() { close(); g_object_unref(cancel_); }
void Ui::close() {
  if (closed_) return;
  closed_ = true; g_cancellable_cancel(cancel_);
  if (idle_) { g_source_remove(idle_); idle_ = 0; }
  if (timer_) { g_source_remove(timer_); timer_ = 0; }
  queue_.clear();
}
void Ui::toast(const UiOptions &options) {
  std::string text = options.icon == "success" ? "✓  " : options.icon == "error" ? "✕  " : "";
  text += options.message;
  gtk_label_set_text(GTK_LABEL(toast_label_), text.c_str());
  gtk_revealer_set_reveal_child(GTK_REVEALER(revealer_), true);
  if (timer_) g_source_remove(timer_);
  timer_ = g_timeout_add(options.duration == "long" ? 3000 : 1500, +[](gpointer data) -> gboolean {
    auto *self = static_cast<Ui *>(data); self->timer_ = 0;
    gtk_revealer_set_reveal_child(GTK_REVEALER(self->revealer_), false); return G_SOURCE_REMOVE;
  }, this);
}
void Ui::call(std::string method, std::vector<uint8_t> args, GCancellable *cancellable, Done done) {
  // All completions are deferred, including parse errors and toast.
  auto guarded = [c = std::shared_ptr<GCancellable>(G_CANCELLABLE(g_object_ref(cancellable)), [](GCancellable *p) { g_object_unref(p); }), done = std::move(done)](bool ok, std::vector<uint8_t> result) mutable {
    if (!g_cancellable_is_cancelled(c.get())) done(ok, std::move(result));
  };
  try {
    auto options = parse_ui(method, args);
    if (method == "toast") {
      toast(options);
      g_idle_add_full(G_PRIORITY_DEFAULT, +[](gpointer p) -> gboolean { auto *f = static_cast<Done *>(p); (*f)(true, {}); return G_SOURCE_REMOVE; }, new Done(std::move(guarded)), +[](gpointer p) { delete static_cast<Done *>(p); });
    } else {
      queue_.push_back({std::move(method), std::move(options), std::move(guarded)});
      if (!active_ && !idle_) idle_ = g_idle_add(+[](gpointer p) -> gboolean { auto *self = static_cast<Ui *>(p); self->idle_ = 0; self->next(); return G_SOURCE_REMOVE; }, this);
    }
  } catch (const std::exception &e) {
    struct Error { Done done; std::vector<uint8_t> message; };
    g_idle_add_full(G_PRIORITY_DEFAULT, +[](gpointer p) -> gboolean { auto *e = static_cast<Error *>(p); e->done(false, std::move(e->message)); return G_SOURCE_REMOVE; }, new Error{std::move(guarded), bytes(e.what())}, +[](gpointer p) { delete static_cast<Error *>(p); });
  }
}
void Ui::next() {
  if (closed_ || active_ || queue_.empty()) return;
  auto &request = queue_.front();
  auto *root = gtk_widget_get_root(overlay_);
  if (!root || !GTK_IS_WINDOW(root)) {
    // Calls can arrive during startup, before the app is attached to a window.
    idle_ = g_timeout_add(10, +[](gpointer p) -> gboolean { auto *self = static_cast<Ui *>(p); self->idle_ = 0; self->next(); return G_SOURCE_REMOVE; }, this);
    return;
  }
  auto *dialog = gtk_alert_dialog_new("%s", request.options.title.c_str());
  if (!request.options.message.empty()) gtk_alert_dialog_set_detail(dialog, request.options.message.c_str());
  std::vector<std::string> labels;
  if (request.method == "alert") labels = {request.options.confirm_text};
  else if (request.method == "confirm") labels = {request.options.cancel_text, request.options.confirm_text};
  else { labels = request.options.options; labels.push_back(request.options.cancel_text); }
  std::vector<const char *> buttons; for (const auto &label : labels) buttons.push_back(label.c_str()); buttons.push_back(nullptr);
  gtk_alert_dialog_set_buttons(dialog, buttons.data());
  gtk_alert_dialog_set_cancel_button(dialog, request.method == "confirm" ? 0 : request.method == "actionSheet" ? int(labels.size() - 1) : 0);
  gtk_alert_dialog_set_default_button(dialog, request.method == "confirm" ? 1 : 0);
  active_ = true;
  gtk_alert_dialog_choose(dialog, GTK_WINDOW(root), cancel_, +[](GObject *source, GAsyncResult *result, gpointer data) {
    std::unique_ptr<std::shared_ptr<Ui>> holder(static_cast<std::shared_ptr<Ui> *>(data));
    auto self = *holder;
    g_autoptr(GError) error = nullptr;
    int choice = gtk_alert_dialog_choose_finish(GTK_ALERT_DIALOG(source), result, &error);
    if (self->closed_) return;
    auto request = std::move(self->queue_.front()); self->queue_.pop_front(); self->active_ = false;
    if (request.method == "actionSheet" && choice >= int(request.options.options.size())) choice = -1;
    request.done(true, ui_result(request.method, choice));
    self->next();
  }, new std::shared_ptr<Ui>(shared_from_this()));
  g_object_unref(dialog);
}
}
