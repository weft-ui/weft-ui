#include <gtk/gtk.h>
#include <weft/gtk.hpp>

#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <string>
#include <string_view>

#include "appearance.hpp"

namespace {

// Match the Web reference's logical viewport so wrapping is comparable.
constexpr int kViewportWidth = 390;
constexpr int kViewportHeight = 844;

[[noreturn]] void fail(const std::string &message) {
  std::fprintf(stderr, "%s\n", message.c_str());
  std::exit(1);
}

void pump() {
  while (g_main_context_iteration(nullptr, FALSE)) {}
}

GtkWidget *find_catalog_button(GtkWidget *widget, std::string_view label, GtkWidget *button = nullptr) {
  if (GTK_IS_BUTTON(widget)) button = widget;
  if (button && GTK_IS_LABEL(widget) && gtk_label_get_text(GTK_LABEL(widget)) == label) return button;
  for (auto *child = gtk_widget_get_first_child(widget); child; child = gtk_widget_get_next_sibling(child)) {
    if (auto *found = find_catalog_button(child, label, button)) return found;
  }
  return nullptr;
}

void capture(GtkWidget *window, const std::filesystem::path &path) {
  const int width = gtk_widget_get_width(window);
  const int height = gtk_widget_get_height(window);
  if (width != kViewportWidth || height != kViewportHeight) {
    fail("Expected a 390x844 GTK viewport, got " + std::to_string(width) + "x" + std::to_string(height) +
         "; make sure the desktop work area can fit the example window");
  }
  auto *snapshot = gtk_snapshot_new();
  auto *paintable = gtk_widget_paintable_new(window);
  gdk_paintable_snapshot(paintable, GDK_SNAPSHOT(snapshot), width, height);
  g_object_unref(paintable);
  auto *node = gtk_snapshot_free_to_node(snapshot);
  if (!node) fail("The GTK snapshot is empty");
  graphene_rect_t viewport;
  graphene_rect_init(&viewport, 0, 0, width, height);
  auto *texture = gsk_renderer_render_texture(gtk_native_get_renderer(GTK_NATIVE(window)), node, &viewport);
  gsk_render_node_unref(node);
  if (!gdk_texture_save_to_png(texture, path.c_str())) fail("Could not write " + path.string());
  g_object_unref(texture);
}

}  // namespace

int main(int argc, char **argv) {
  if (argc < 3) fail("Usage: screenshots DIRECTORY <id:light|id:dark> ...");
  if (!gtk_init_check()) fail("Screenshots need a GTK desktop (DISPLAY or WAYLAND_DISPLAY)");
  // The Docker desktop ships Inter Variable so the weight ladder shows all five weights.
  g_object_set(gtk_settings_get_default(), "gtk-font-name", "Inter Variable, Sans 10", nullptr);

  for (int i = 2; i < argc; ++i) {
    std::string_view page = argv[i];
    auto delimiter = page.find(':');
    std::string id(page.substr(0, delimiter));
    bool dark = page.substr(delimiter + 1) == "dark";
    weft::Appearance::set_test_dark(dark);

    auto *window = gtk_window_new();
    auto *root = weft::start_app();
    gtk_window_set_child(GTK_WINDOW(window), root);
    gtk_window_set_default_size(GTK_WINDOW(window), kViewportWidth, kViewportHeight);
    gtk_window_present(GTK_WINDOW(window));
    GtkWidget *button = nullptr;
    const auto label = "page:" + id;
    const auto timeout = g_get_monotonic_time() + 5 * G_TIME_SPAN_SECOND;
    do {
      pump();
      if (gtk_widget_get_width(root) > 0) button = find_catalog_button(root, label);
      if (button) break;
      g_usleep(1000);
    } while (g_get_monotonic_time() < timeout);
    if (!button) fail("No catalog button " + label);
    gtk_widget_grab_focus(button);  // The scrolled parent brings its focused child into view.
    if (!gtk_widget_activate(button)) fail("Could not click " + label);

    const auto settled = g_get_monotonic_time() + G_TIME_SPAN_SECOND;
    while (g_get_monotonic_time() < settled) {
      pump();
      g_usleep(1000);
    }
    capture(window, std::filesystem::path(argv[1]) / (id + (dark ? "-dark.png" : ".png")));
    gtk_window_destroy(GTK_WINDOW(window));
  }
}
