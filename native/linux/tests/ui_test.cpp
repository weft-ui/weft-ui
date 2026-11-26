#include "ui.hpp"
#include <cassert>
#include <stdexcept>
#include <string>

using namespace weft::platform;
static std::vector<uint8_t> bytes(std::string_view s) { return {s.begin(), s.end()}; }
static std::string text(const std::vector<uint8_t> &v) { return {v.begin(), v.end()}; }
static void pump() { while (g_main_context_iteration(nullptr, FALSE)) {} }
static GtkWidget *button(GtkWidget *w, std::string_view name) {
  if (GTK_IS_BUTTON(w)) {
    const char *label = gtk_button_get_label(GTK_BUTTON(w));
    if (label && name == label) return w;
  }
  for (auto *c = gtk_widget_get_first_child(w); c; c = gtk_widget_get_next_sibling(c))
    if (auto *found = button(c, name)) return found;
  return nullptr;
}
static GtkWidget *dialog_button(std::string_view name) {
  auto *windows = gtk_window_get_toplevels();
  for (guint i = 0; i < g_list_model_get_n_items(windows); ++i) {
    auto *window = GTK_WIDGET(g_list_model_get_item(windows, i));
    auto *found = button(window, name);
    g_object_unref(window);
    if (found) return found;
  }
  return nullptr;
}
int main() {
  auto options = parse_ui("confirm", bytes(R"({"title":"Title","destructive":true})"));
  assert(options.title == "Title" && options.confirm_text == "OK" && options.cancel_text == "Cancel" && options.destructive);
  options = parse_ui("actionSheet", bytes(R"({"options":["one","two"],"destructiveIndex":1})"));
  assert(options.options.size() == 2 && options.destructive_index == 1);
  bool rejected = false;
  try { parse_ui("actionSheet", bytes(R"({"options":[]})")); } catch (const std::runtime_error &) { rejected = true; }
  assert(rejected);
  assert(text(ui_result("confirm", 1)) == "true" && text(ui_result("confirm", -1)) == "false");
  assert(text(ui_result("actionSheet", -1)) == "null" && text(ui_result("actionSheet", 2)) == "2");
  assert(ui_result("alert", 0).empty());
  if (!gtk_init_check()) return 77;
  auto *window = gtk_window_new(); auto *overlay = gtk_overlay_new();
  gtk_window_set_child(GTK_WINDOW(window), overlay); gtk_window_present(GTK_WINDOW(window)); pump();
  auto ui = std::make_shared<Ui>(overlay); auto *cancel = g_cancellable_new();
  std::string result;
  ui->call("confirm", bytes(R"({"title":"First"})"), cancel, [&](bool ok, auto value) { assert(ok); result += text(value); });
  ui->call("actionSheet", bytes(R"({"title":"Second","options":["Choice"]})"), cancel, [&](bool ok, auto value) { assert(ok); result += text(value); });
  pump(); assert(dialog_button("OK") && !dialog_button("Choice"));
  g_signal_emit_by_name(dialog_button("OK"), "clicked"); pump();
  assert(result == "true" && dialog_button("Choice"));
  g_signal_emit_by_name(dialog_button("Choice"), "clicked"); pump();
  assert(result == "true0");
  auto dismiss = [&] {
    auto *windows = gtk_window_get_toplevels();
    for (guint i = 0; i < g_list_model_get_n_items(windows); ++i) {
      auto *dialog = GTK_WINDOW(g_list_model_get_item(windows, i));
      if (gtk_window_get_transient_for(dialog) == GTK_WINDOW(window)) {
        gtk_window_close(dialog); g_object_unref(dialog); pump(); return;
      }
      g_object_unref(dialog);
    }
    assert(false && "dialog missing");
  };
  ui->call("confirm", bytes("{}"), cancel, [&](bool ok, auto value) { assert(ok); result += text(value); });
  pump(); dismiss(); assert(result == "true0false");
  ui->call("actionSheet", bytes(R"({"options":["Choice"]})"), cancel, [&](bool ok, auto value) { assert(ok); result += text(value); });
  pump(); dismiss(); assert(result == "true0falsenull");
  ui->close(); g_cancellable_cancel(cancel); g_object_unref(cancel); ui.reset();
  gtk_window_destroy(GTK_WINDOW(window)); pump();
}
