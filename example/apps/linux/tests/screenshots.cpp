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

struct Shot {
  std::filesystem::path path;
  bool dark;
};

void show(GtkApplication *app, const char *url, Shot *shot) {
  g_object_set(gtk_settings_get_default(), "gtk-font-name", "Inter Variable, Sans 10", nullptr);
  weft::Appearance::set_test_dark(shot->dark);
  auto *window = gtk_application_window_new(app);
  gtk_window_set_child(GTK_WINDOW(window), weft::start_app_with_url(url));
  gtk_window_set_default_size(GTK_WINDOW(window), kViewportWidth, kViewportHeight);
  gtk_window_present(GTK_WINDOW(window));
  g_timeout_add(1000, +[](gpointer data) -> gboolean {
    auto *window = GTK_WIDGET(data);
    auto *shot = static_cast<Shot *>(g_object_get_data(G_OBJECT(window), "shot"));
    auto *root = gtk_window_get_child(GTK_WINDOW(window));
    auto *first = gtk_widget_get_first_child(root);
    if (!first || gtk_widget_has_css_class(first, "error")) fail("The app did not start");
    capture(window, shot->path);
    gtk_window_destroy(GTK_WINDOW(window));
    return G_SOURCE_REMOVE;
  }, window);
  g_object_set_data(G_OBJECT(window), "shot", shot);
}

void activate(GtkApplication *app, gpointer data) { show(app, nullptr, static_cast<Shot *>(data)); }
void open(GtkApplication *app, GFile **files, int count, const char *, gpointer data) {
  if (count != 1) fail("Expected one deep link");
  g_autofree char *url = g_file_get_uri(files[0]);
  show(app, url, static_cast<Shot *>(data));
}

}  // namespace

int main(int argc, char **argv) {
  if (argc < 3 || argc > 4) fail("Usage: screenshots DIRECTORY id:light|id:dark [URL]");
  g_autofree char *data = g_dir_make_tmp("weft-screenshots-XXXXXX", nullptr);
  if (!data || !g_setenv("XDG_DATA_HOME", data, true)) fail("Could not isolate screenshot storage");
  struct Cleanup { const char *path; ~Cleanup() { std::filesystem::remove_all(path); } } cleanup{data};
  std::string_view page = argv[2];
  auto delimiter = page.find(':');
  if (delimiter == page.npos) fail("Missing screenshot scheme");
  std::string id(page.substr(0, delimiter));
  bool dark = page.substr(delimiter + 1) == "dark";
  Shot shot{std::filesystem::path(argv[1]) / (id + (dark ? "-dark.png" : ".png")), dark};
  auto *app = gtk_application_new(nullptr, GApplicationFlags(G_APPLICATION_HANDLES_OPEN | G_APPLICATION_NON_UNIQUE));
  g_signal_connect(app, "activate", G_CALLBACK(activate), &shot);
  g_signal_connect(app, "open", G_CALLBACK(open), &shot);
  char *app_argv[] = {argv[0], argc == 4 ? argv[3] : nullptr, nullptr};
  int status = g_application_run(G_APPLICATION(app), argc == 4 ? 2 : 1, app_argv);
  g_object_unref(app);
  return status;
}
