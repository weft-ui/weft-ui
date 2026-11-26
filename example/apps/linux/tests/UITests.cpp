// UI tests of the app, driving its widgets in process; run with
// `ctest --test-dir build` on a desktop session after building the app.

#include <gtk/gtk.h>
#include <weft/gtk.hpp>
#ifdef GDK_WINDOWING_X11
#include <gdk/x11/gdkx.h>
#endif

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <string_view>
#include <vector>

namespace {

void check(bool passed, const char *message) {
  if (passed) return;
  std::fprintf(stderr, "%s\n", message);
  std::exit(1);
}

void pump() {
  while (g_main_context_iteration(nullptr, false)) {}
}

void collect(GtkWidget *widget, GType type, std::vector<GtkWidget *> &out) {
  if (g_type_is_a(G_OBJECT_TYPE(widget), type)) out.push_back(widget);
  for (auto *child = gtk_widget_get_first_child(widget); child; child = gtk_widget_get_next_sibling(child)) {
    collect(child, type, out);
  }
}

std::vector<GtkWidget *> all(GtkWidget *root, GType type, size_t count) {
  std::vector<GtkWidget *> found;
  collect(root, type, found);
  if (found.size() != count) {
    std::fprintf(stderr, "Expected %zu %s widgets, found %zu\n", count, g_type_name(type), found.size());
    std::exit(1);
  }
  return found;
}

GtkWidget *label(GtkWidget *widget, std::string_view text) {
  if (GTK_IS_LABEL(widget) && std::string_view(gtk_label_get_text(GTK_LABEL(widget))) == text) return widget;
  for (auto *child = gtk_widget_get_first_child(widget); child; child = gtk_widget_get_next_sibling(child)) {
    if (auto *found = label(child, text)) return found;
  }
  return nullptr;
}

void click(GtkWidget *root, std::string_view text) {
  auto *caption = label(root, text);
  auto *button = caption ? gtk_widget_get_ancestor(caption, GTK_TYPE_BUTTON) : nullptr;
  if (!button) {
    std::fprintf(stderr, "Button '%.*s' missing\n", int(text.size()), text.data());
    std::exit(1);
  }
  g_signal_emit_by_name(button, "clicked");
  pump();
}

bool active(GtkWidget *widget, bool value) {
  auto *control = GTK_SWITCH(widget);
  return gtk_switch_get_active(control) == value && gtk_switch_get_state(control) == value;
}

std::string_view choice(GtkWidget *picker) {
  return gtk_label_get_text(GTK_LABEL(gtk_menu_button_get_child(GTK_MENU_BUTTON(picker))));
}

void select(GtkWidget *picker, unsigned index) {
  auto *menu = GTK_MENU_BUTTON(picker);
  gtk_menu_button_popup(menu);
  auto *popover = gtk_menu_button_get_popover(menu);
  auto *list = gtk_popover_get_child(popover);
  auto *option = gtk_widget_get_first_child(list);
  while (index-- && option) option = gtk_widget_get_next_sibling(option);
  check(option && GTK_IS_BUTTON(option), "Picker option missing");
  g_signal_emit_by_name(option, "clicked");
  check(!gtk_widget_get_visible(GTK_WIDGET(popover)), "Picker popover did not close");
}

void type(GtkWidget *area, const char *text) {
  g_signal_emit_by_name(area, "insert-at-cursor", text);
}

bool contains(GtkWidget *area, std::string_view expected) {
  auto *buffer = gtk_text_view_get_buffer(GTK_TEXT_VIEW(area));
  GtkTextIter begin, end;
  gtk_text_buffer_get_bounds(buffer, &begin, &end);
  g_autofree char *text = gtk_text_buffer_get_text(buffer, &begin, &end, true);
  return expected == text;
}

void controls(GtkWidget *root) {
  click(root, "page:controls");

  const auto switches = all(root, GTK_TYPE_SWITCH, 4);
  const auto checkboxes = all(root, GTK_TYPE_CHECK_BUTTON, 2);
  const auto scales = all(root, GTK_TYPE_SCALE, 2);
  const auto pickers = all(root, GTK_TYPE_MENU_BUTTON, 3);
  const auto textareas = all(root, GTK_TYPE_TEXT_VIEW, 2);
  all(root, g_type_from_name("WeftSpinner"), 1);
  all(root, g_type_from_name("WeftProgress"), 2);
  const auto dividers = all(root, GTK_TYPE_SEPARATOR, 4);
  check(gtk_orientable_get_orientation(GTK_ORIENTABLE(dividers[1])) == GTK_ORIENTATION_HORIZONTAL &&
        gtk_orientable_get_orientation(GTK_ORIENTABLE(dividers[2])) == GTK_ORIENTATION_VERTICAL,
        "Expected horizontal and vertical dividers");
  check(!gtk_widget_is_sensitive(switches.back()) && !gtk_widget_is_sensitive(checkboxes.back()) &&
        !gtk_widget_is_sensitive(scales.back()) && !gtk_widget_is_sensitive(pickers.back()) &&
        !gtk_widget_is_sensitive(textareas.back()), "Disabled controls are interactive");

  check(active(switches[0], false) && active(switches[1], true) && active(switches[2], false),
        "Wrong initial switch values");
  auto *checkbox = GTK_CHECK_BUTTON(checkboxes[0]);
  auto *scale = GTK_RANGE(scales[0]);
  check(gtk_check_button_get_active(checkbox), "Wrong initial checkbox value");
  check(gtk_range_get_value(scale) == 40, "Wrong initial slider value");
  check(choice(pickers[0]) == "本地" && choice(pickers[1]) == "选择频道", "Wrong initial Picker labels");
  check(contains(textareas[0], ""), "Wrong initial TextArea value");

  gtk_widget_activate(switches[1]);
  gtk_widget_activate(switches[2]);
  gtk_widget_activate(checkboxes[0]);
  gtk_range_set_value(scale, 62.5);
  select(pickers[0], 1);
  type(textareas[0], "First\nSecond");
  check(active(switches[1], false) && active(switches[2], true), "Unlocked switches rejected edits");
  check(!gtk_check_button_get_active(checkbox), "Unlocked checkbox rejected edit");
  check(gtk_range_get_value(scale) == 65, "Unlocked slider did not snap to 65");
  check(choice(pickers[0]) == "远程", "Unlocked Picker rejected an option");
  check(contains(textareas[0], "First\nSecond"), "Unlocked TextArea rejected multiline input");

  gtk_widget_activate(switches[0]);
  check(active(switches[0], true), "Could not enable lock");
  gtk_widget_activate(switches[1]);
  gtk_widget_activate(switches[2]);
  gtk_widget_activate(checkboxes[0]);
  gtk_range_set_value(scale, 95);
  select(pickers[0], 0);
  select(pickers[1], 1);
  type(textareas[0], " rejected");
  pump();
  check(active(switches[1], false) && active(switches[2], true), "Locked switches did not restore");
  check(!gtk_check_button_get_active(checkbox), "Locked checkbox did not restore");
  check(gtk_range_get_value(scale) == 65, "Locked slider did not restore");
  check(choice(pickers[0]) == "远程" && choice(pickers[1]) == "选择频道", "Locked pickers did not restore");
  check(contains(textareas[0], "First\nSecond"), "Locked TextArea did not restore");

  gtk_widget_activate(switches[0]);
  select(pickers[1], 1);
  check(active(switches[0], false) && choice(pickers[1]) == "测试版", "Picker could not select after unlocking");
}

void inputs(GtkWidget *root) {
  click(root, "page:inputs");
  const auto entries = all(root, GTK_TYPE_ENTRY, 5);
  const auto textareas = all(root, GTK_TYPE_TEXT_VIEW, 1);
  auto *draft = gtk_editable_get_delegate(GTK_EDITABLE(entries[0]));
  auto *window = gtk_widget_get_root(root);
  auto expect_focus = [&](GtkWidget *widget, std::string_view message_label) {
    check(gtk_root_get_focus(window) == widget, "Unexpected keyboard focus");
    check(label(root, message_label), "onFocusChange did not update the label");
  };
  check(!gtk_entry_get_visibility(GTK_ENTRY(entries[1])), "Password input is not masked");
  check(gtk_entry_get_input_purpose(GTK_ENTRY(entries[2])) == GTK_INPUT_PURPOSE_NUMBER &&
        gtk_entry_get_input_purpose(GTK_ENTRY(entries[3])) == GTK_INPUT_PURPOSE_EMAIL &&
        gtk_entry_get_input_purpose(GTK_ENTRY(entries[4])) == GTK_INPUT_PURPOSE_PHONE,
        "Wrong keyboard purposes");

  click(root, "聚焦文本框");
  expect_focus(GTK_WIDGET(draft), "已聚焦");
  gtk_widget_grab_focus(entries[1]);
  pump();
  auto *password = gtk_editable_get_delegate(GTK_EDITABLE(entries[1]));
  expect_focus(GTK_WIDGET(password), "未聚焦");
  click(root, "放弃焦点");  // User focus changes must not write back to requestFocus.
  expect_focus(GTK_WIDGET(password), "未聚焦");
  click(root, "聚焦文本框");
  expect_focus(GTK_WIDGET(draft), "已聚焦");
  click(root, "放弃焦点");
  expect_focus(nullptr, "未聚焦");
  click(root, "聚焦文本框");
  expect_focus(GTK_WIDGET(draft), "已聚焦");

  g_signal_emit_by_name(draft, "insert-at-cursor", "1234567890123456789😀z");
  check(std::string_view(gtk_editable_get_text(draft)) == "1234567890123456789" && label(root, "19/20"),
        "Input split the emoji at the UTF-16 boundary");
  g_signal_emit_by_name(draft, "activate");  // GtkText's Return key binding.
  check(*gtk_editable_get_text(draft) == '\0' && label(root, "0/20"), "onSubmit did not clear the draft");

  g_signal_emit_by_name(draft, "insert-at-cursor", "123456789012345678😀z");
  check(std::string_view(gtk_editable_get_text(draft)) == "123456789012345678😀" && label(root, "20/20"),
        "Input did not count the preserved emoji as two UTF-16 units");
  gtk_widget_grab_focus(textareas.front());
  pump();
  expect_focus(textareas.front(), "未聚焦");
  const std::string expected = std::string(78, 'a') + '\n';
  type(textareas.front(), (expected + "😀z").c_str());
  check(contains(textareas.front(), expected), "TextArea split the emoji at the UTF-16 boundary");
}

#ifdef GDK_WINDOWING_X11
void xdotool(GtkWidget *widget, std::initializer_list<const char *> args) {
  std::vector<char *> argv{const_cast<char *>("xdotool")};
  for (const char *arg : args) argv.push_back(const_cast<char *>(arg));
  argv.push_back(nullptr);
  int status;
  g_autoptr(GError) error = nullptr;
  check(g_spawn_sync(nullptr, argv.data(), nullptr, G_SPAWN_SEARCH_PATH, nullptr, nullptr,
                     nullptr, nullptr, &status, &error), "Could not run xdotool");
  check(g_spawn_check_wait_status(status, &error), "xdotool command failed");
  gdk_display_sync(gtk_widget_get_display(widget));
  pump();
}

void point_at(GtkWidget *widget) {
  check(widget, "Pointer target missing");
  auto ready = [&] {
    return gtk_widget_get_mapped(widget) && gtk_widget_get_width(widget) > 0 && gtk_widget_get_height(widget) > 0;
  };
  // Replacing the catalog with the page queues allocation on the frame clock.
  const auto deadline = g_get_monotonic_time() + G_TIME_SPAN_SECOND;
  while (!ready() && g_get_monotonic_time() < deadline) {
    g_usleep(1000);
    pump();
  }
  check(ready(), "Pointer target was not allocated");
  auto *native = gtk_widget_get_native(widget);
  auto *surface = gtk_native_get_surface(native);
  const graphene_point_t local_center{gtk_widget_get_width(widget) * 0.5f, gtk_widget_get_height(widget) * 0.5f};
  graphene_point_t center;
  check(gtk_widget_compute_point(widget, GTK_WIDGET(native), &local_center, &center),
        "Pointer target is not in the window");
  double x, y;
  gtk_native_get_surface_transform(native, &x, &y);
  const int scale = gdk_surface_get_scale_factor(surface);
  const auto xid = std::to_string(gdk_x11_surface_get_xid(surface));
  const auto px = std::to_string(std::lround((center.x - x) * scale));
  const auto py = std::to_string(std::lround((center.y - y) * scale));
  xdotool(widget, {"mousemove", "--window", xid.c_str(), px.c_str(), py.c_str()});
}

GtkWidget *tap_target(GtkWidget *widget) {
  for (; widget; widget = gtk_widget_get_parent(widget)) {
    if (gtk_accessible_get_accessible_role(GTK_ACCESSIBLE(widget)) == GTK_ACCESSIBLE_ROLE_BUTTON) return widget;
  }
  check(false, "Target has no accessible button ancestor");
  return nullptr;
}

void taps(GtkWidget *root) {
  xdotool(root, {"mouseup", "1"});
  click(root, "page:tap");
  auto expect_counts = [&](int rows, int cards, int buttons, int texts) {
    check(label(root, "Rows: " + std::to_string(rows)) && label(root, "Cards: " + std::to_string(cards)) &&
          label(root, "Buttons: " + std::to_string(buttons)) && label(root, "Text: " + std::to_string(texts)),
          "A tap changed the wrong counters");
  };
  auto expect_opacity = [](GtkWidget *widget, double opacity) {
    const auto actual = gtk_widget_get_opacity(widget);
    if (std::abs(actual - opacity) <= 1.0 / 255.0) return;
    std::fprintf(stderr, "Expected opacity %.3f during or after tap, got %.3f\n", opacity, actual);
    std::exit(1);
  };
  auto press = [&](GtkWidget *target) {
    point_at(target);
    xdotool(root, {"mousedown", "1"});
  };
  auto release = [&] { xdotool(root, {"mouseup", "1"}); };

  auto *details = label(root, "Open details");
  auto *row = tap_target(details);
  press(details);
  expect_counts(0, 0, 0, 0);
  expect_opacity(row, 0.85 * 0.6);
  point_at(label(root, "Tap targets"));
  release();
  expect_counts(0, 0, 0, 0);
  expect_opacity(row, 0.85);
  press(details);
  release();
  expect_counts(1, 0, 0, 0);

  auto *card_label = label(root, "Image card");
  auto *card = tap_target(card_label);
  press(card_label);
  expect_opacity(card, 0.6);
  release();
  expect_counts(1, 1, 0, 0);

  auto *image = all(root, GTK_TYPE_PICTURE, 1)[0];
  press(image);
  expect_opacity(tap_target(image), 0.6);
  expect_opacity(card, 1);
  release();
  expect_counts(1, 2, 0, 0);

  auto *nested_row = tap_target(label(root, "Nested actions"));
  press(label(root, "Save"));
  expect_opacity(nested_row, 1);
  release();
  expect_counts(1, 2, 1, 0);

  auto *preview_label = label(root, "Preview");
  auto *preview = tap_target(preview_label);
  press(preview_label);
  expect_opacity(preview, 0.6);
  expect_opacity(nested_row, 1);
  release();
  expect_counts(1, 2, 1, 1);

  check(gtk_widget_grab_focus(preview), "Tappable Text cannot receive keyboard focus");
  xdotool(root, {"key", "space"});
  expect_counts(1, 2, 1, 2);
}

void button_containing_tappables() {
  int outer_count = 0, text_count = 0, button_count = 0;
  weft::Button outer([&] { ++outer_count; });
  weft::Button inner([&] { ++button_count; });
  weft::Text text;
  text.set_value("Text in Button");
  text.set_on_tap([&] { ++text_count; });
  weft::Text caption;
  caption.set_value("Button in Button");
  inner.children().add(caption);
  outer.children().add(text);
  outer.children().add(inner);

  auto *window = gtk_window_new();
  gtk_window_set_child(GTK_WINDOW(window), outer.widget());
  gtk_window_present(GTK_WINDOW(window));
  pump();
  point_at(text.widget());
  xdotool(window, {"click", "1"});
  check(outer_count == 0 && text_count == 1 && button_count == 0, "Outer Button intercepted a nested onTap");
  point_at(inner.widget());
  xdotool(window, {"click", "1"});
  check(outer_count == 0 && text_count == 1 && button_count == 1, "Outer Button intercepted a nested Button");
  gtk_window_destroy(GTK_WINDOW(window));
  pump();
}
#endif

void run(void (*verify)(GtkWidget *)) {
  GtkWidget *window = gtk_window_new();
  GtkWidget *root = weft::start_app();
  gtk_window_set_child(GTK_WINDOW(window), root);
  gtk_window_set_default_size(GTK_WINDOW(window), 390, 844);
  gtk_window_present(GTK_WINDOW(window));
  pump();

  // The first batch is applied when start_app returns; a failed launch
  // shows its reason in a label styled `error` instead of the catalog.
  GtkWidget *first = gtk_widget_get_first_child(root);
  check(first && !gtk_widget_has_css_class(first, "error"), "The app did not start");
  verify(root);
  gtk_window_destroy(GTK_WINDOW(window));
  pump();
}

}  // namespace

int main(int argc, char **argv) {
  if (!gtk_init_check()) {
    std::fprintf(stderr, "UI tests need a display (DISPLAY or WAYLAND_DISPLAY)\n");
    return 1;
  }
  g_object_set(gtk_settings_get_default(), "gtk-enable-animations", false, nullptr);
  if (argc == 2 && std::string_view(argv[1]) == "--tap") {
#ifdef GDK_WINDOWING_X11
    g_autofree char *tool = g_find_program_in_path("xdotool");
    if (GDK_IS_X11_DISPLAY(gdk_display_get_default()) && tool) {
      run(taps);
      button_containing_tappables();
      return 0;
    }
#endif
    std::fprintf(stderr, "Tap pointer tests need X11 and xdotool\n");
    return 77;
  }
  run(controls);
  run(inputs);
  return 0;
}
