#include "container.hpp"

#include <algorithm>
#include <cmath>
#include <memory>
#include <vector>

using namespace weft;
using namespace weft::layout;

struct WeftLayoutChild {
  GtkLayoutChild parent_instance;
  const WidgetLayout *data;
};
struct WeftLayoutChildClass { GtkLayoutChildClass parent_class; };
G_DEFINE_TYPE(WeftLayoutChild, weft_layout_child, GTK_TYPE_LAYOUT_CHILD)

struct LayoutState {
  Linear linear;
  Alignment alignment = Alignment::TopStart;
  Edges padding;
  std::optional<Axis> scroll_axis;
  bool overlay = false;
  bool text = false;
  std::vector<Child> children;
};

struct WeftLinearLayout {
  GtkLayoutManager parent_instance;
  LayoutState state;
};
struct WeftLinearLayoutClass { GtkLayoutManagerClass parent_class; };
G_DEFINE_TYPE(WeftLinearLayout, weft_linear_layout, GTK_TYPE_LAYOUT_MANAGER)

struct WeftStackLayout { WeftLinearLayout parent_instance; };
struct WeftStackLayoutClass { WeftLinearLayoutClass parent_class; };
G_DEFINE_TYPE(WeftStackLayout, weft_stack_layout, weft_linear_layout_get_type())

struct WeftWidget {
  GtkWidget parent_instance;
  WidgetStyle style;
};
struct WeftWidgetClass { GtkWidgetClass parent_class; };
G_DEFINE_TYPE(WeftWidget, weft_widget, GTK_TYPE_WIDGET)

struct WeftSpinner {
  WeftWidget parent_instance;
  GdkRGBA color;
  double angle;
};
struct WeftSpinnerClass { WeftWidgetClass parent_class; };
G_DEFINE_TYPE(WeftSpinner, weft_spinner, weft_widget_get_type())

struct WeftProgress {
  WeftWidget parent_instance;
  GdkRGBA bar;
  GdkRGBA track;
  double fraction;
};
struct WeftProgressClass { WeftWidgetClass parent_class; };
G_DEFINE_TYPE(WeftProgress, weft_progress, weft_widget_get_type())

struct WeftLinear {
  WeftWidget parent_instance;
  void (*on_allocate)(GtkWidget *);
};
struct WeftLinearClass { WeftWidgetClass parent_class; };
G_DEFINE_TYPE(WeftLinear, weft_linear, weft_widget_get_type())

namespace {

GQuark layout_key() { return g_quark_from_static_string("weft-layout"); }

const WidgetLayout *widget_layout(GtkWidget *widget) {
  return static_cast<const WidgetLayout *>(g_object_get_qdata(G_OBJECT(widget), layout_key()));
}

bool is_container(GtkWidget *widget) {
  return G_TYPE_CHECK_INSTANCE_TYPE(widget, weft_linear_get_type());
}

bool is_weft_widget(GtkWidget *widget) {
  return G_TYPE_CHECK_INSTANCE_TYPE(widget, weft_widget_get_type());
}

Insets inset_border(Insets padding, double border) {
  return {padding.top + border, padding.right + border, padding.bottom + border, padding.left + border};
}

LayoutState &state(GtkLayoutManager *manager) { return reinterpret_cast<WeftLinearLayout *>(manager)->state; }
LayoutState &state(GtkWidget *widget) { return state(gtk_widget_get_layout_manager(widget)); }

int pixels(double value) { return int(std::lround(value)); }

Insets native_margin(GtkWidget *widget) {
  return {double(gtk_widget_get_margin_top(widget)), double(gtk_widget_get_margin_end(widget)),
          double(gtk_widget_get_margin_bottom(widget)), double(gtk_widget_get_margin_start(widget))};
}

Size measure_widget(const void *pointer, Proposal proposal);

GQuark picture_density_key() {
  static const auto key = g_quark_from_static_string("weft-picture-density");
  return key;
}

Size measure_native(GtkWidget *widget, Proposal proposal) {
  const auto [w, h] = proposal;
  if (w.is_exact() && h.is_exact()) return {w.value, h.value};
  if (GTK_IS_LABEL(widget) && gtk_label_get_ellipsize(GTK_LABEL(widget)) != PANGO_ELLIPSIZE_NONE) {
    if (auto clipped = TextLayout::measure(widget, proposal)) return *clipped;
  }
  const Insets margin = native_margin(widget);
  const auto measure = [&](GtkOrientation orientation, Length length, int for_size) {
    if (length.is_exact()) return length.value;
    int natural = 0;
    gtk_widget_measure(widget, orientation, for_size, nullptr, &natural, nullptr, nullptr);
    return length.fit(std::max(0.0, natural - (orientation == GTK_ORIENTATION_HORIZONTAL ? margin.horizontal()
                                                                                        : margin.vertical())));
  };

  if (GTK_IS_PICTURE(widget)) {
    if (auto *image = gtk_picture_get_paintable(GTK_PICTURE(widget))) {
      const double ratio = gdk_paintable_get_intrinsic_aspect_ratio(image);
      if (ratio > 0) {
        if (w.is_exact()) return {w.value, h.fit(w.value / ratio)};
        if (h.is_exact()) return {w.fit(h.value * ratio), h.value};
        const int intrinsic_width = gdk_paintable_get_intrinsic_width(image);
        const int intrinsic_height = gdk_paintable_get_intrinsic_height(image);
        if (intrinsic_width > 0 && intrinsic_height > 0) {
          const int density = std::max(1, GPOINTER_TO_INT(g_object_get_qdata(G_OBJECT(widget), picture_density_key())));
          const double width = std::min(w.fit(double(intrinsic_width) / density),
                                        h.fit(double(intrinsic_height) / density) * ratio);
          return {width, width / ratio};
        }
      }
    }
  }

  if (gtk_widget_get_request_mode(widget) == GTK_SIZE_REQUEST_WIDTH_FOR_HEIGHT) {
    const double height = measure(GTK_ORIENTATION_VERTICAL, h, -1);
    return {measure(GTK_ORIENTATION_HORIZONTAL, w, pixels(height + margin.vertical())), height};
  }
  const double width = measure(GTK_ORIENTATION_HORIZONTAL, w, h.is_exact() ? pixels(h.value + margin.vertical()) : -1);
  const double height = measure(GTK_ORIENTATION_VERTICAL, h, pixels(width + margin.horizontal()));
  return {width, height};
}

Size run(GtkLayoutManager *manager, GtkWidget *widget, Proposal proposal) {
  auto &box = state(manager);
  auto &children = box.children;
  children.clear();
  for (GtkWidget *child = gtk_widget_get_first_child(widget); child; child = gtk_widget_get_next_sibling(child)) {
    if (!gtk_widget_should_layout(child)) continue;
    const auto *entry = reinterpret_cast<WeftLayoutChild *>(gtk_layout_manager_get_layout_child(manager, child));
    const auto *data = entry->data;
    children.push_back({child, measure_widget, data ? data->margin.resolve() : native_margin(child),
                        data ? data->grow : 0, data && data->fill, data && data->size.width.has_value(),
                        data && data->size.height.has_value(), data && data->spacer,
                        data ? data->spacer_size : std::nullopt, {}});
  }
  const auto padding = inset_border(box.padding.resolve(), widget_style(widget).border);
  if (box.overlay) return stack(box.alignment, padding, proposal, children);
  // A viewport gives its child a finite allocation even on the scrolling
  // axis. Keep that axis unbounded for the algorithm so grow stays intrinsic.
  if (box.scroll_axis == Axis::Vertical) proposal.height = {};
  if (box.scroll_axis == Axis::Horizontal) proposal.width = {};
  auto options = box.linear;
  // An at-most width constrains wrapping but must not force an intrinsically sized Text to fill.
  if (box.text && !proposal.width.is_exact()) options.align = CrossAlign::Start;
  return linear(options, padding, proposal, children);
}

Size measure_widget(const void *pointer, Proposal proposal) {
  auto *widget = const_cast<GtkWidget *>(static_cast<const GtkWidget *>(pointer));
  const auto *data = widget_layout(widget);
  const bool container = is_container(widget);
  const bool hosted = container || is_weft_widget(widget);
  const double border = hosted ? widget_style(widget).border : 0;
  const auto padding = inset_border(data && data->padding_widget ? state(data->padding_widget).padding.resolve()
                                                                 : Insets{}, border);
  const auto measure = [&](Proposal bounds) {
    if (bounds.width.is_exact() && bounds.height.is_exact()) return Size{bounds.width.value, bounds.height.value};
    if (container) return run(gtk_widget_get_layout_manager(widget), widget, bounds);
    if (!hosted) return measure_native(widget, bounds);
    const double inset = border * 2;
    auto *child = gtk_widget_get_first_child(widget);
    if (!child) return Size{bounds.width.fit(inset), bounds.height.fit(inset)};
    const auto inner = measure_native(child, {bounds.width.inset(inset), bounds.height.inset(inset)});
    return Size{bounds.width.fit(inner.width + inset), bounds.height.fit(inner.height + inset)};
  };
  if (!data) return measure(proposal);
  const auto bounds = data->size.propose(proposal, padding);
  const auto measured = measure(bounds);
  const auto clamped = data->size.clamp(measured, padding);
  // When a minimum establishes the width, remeasure height at that width.
  if (clamped.width != measured.width && !bounds.height.is_exact()) {
    return data->size.clamp(measure({Length::exact(clamped.width), bounds.height}), padding);
  }
  return clamped;
}

GtkLayoutChild *create_child(GtkLayoutManager *manager, GtkWidget *, GtkWidget *child) {
  auto *entry = static_cast<WeftLayoutChild *>(g_object_new(weft_layout_child_get_type(), "layout-manager", manager,
                                                           "child-widget", child, nullptr));
  entry->data = widget_layout(child);
  return GTK_LAYOUT_CHILD(entry);
}

GtkSizeRequestMode request_mode(GtkLayoutManager *manager, GtkWidget *) {
  return state(manager).scroll_axis == Axis::Horizontal ? GTK_SIZE_REQUEST_WIDTH_FOR_HEIGHT
                                                       : GTK_SIZE_REQUEST_HEIGHT_FOR_WIDTH;
}

void measure(GtkLayoutManager *manager, GtkWidget *widget, GtkOrientation orientation, int for_size, int *minimum,
             int *natural, int *minimum_baseline, int *natural_baseline) {
  const bool x = orientation == GTK_ORIENTATION_HORIZONTAL;
  // GTK's height-for-width argument is an allocation in the other axis.
  const auto constraint = for_size < 0 ? Length{} : Length::exact(for_size);
  const auto measured = measure_widget(widget, x ? Proposal{{}, constraint} : Proposal{constraint, {}});
  *natural = pixels(x ? measured.width : measured.height);
  const auto &box = state(manager);
  const auto *data = widget_layout(widget);
  const bool scroll_extent = box.scroll_axis == (x ? Axis::Horizontal : Axis::Vertical);
  const auto &size = data ? data->size : Rules{};
  const auto padding = inset_border(box.padding.resolve(), widget_style(widget).border);
  const double min_padding = x ? padding.horizontal() : padding.vertical();
  const auto min_size = x ? size.min_width : size.min_height;
  const auto fixed = x ? size.width : size.height;
  // GtkViewport uses the minimum to decide its scrollable extent. Elsewhere
  // keep GTK's minimum flexible, since a Weft parent already chose the size.
  *minimum = scroll_extent || fixed || (!x && gtk_widget_has_css_class(widget, "weft-list-row"))
      ? *natural : std::min(*natural, pixels(min_padding + min_size.value_or(0)));
  *minimum_baseline = *natural_baseline = -1;
}

void allocate(GtkLayoutManager *manager, GtkWidget *widget, int width, int height, int) {
  run(manager, widget, {Length::exact(width), Length::exact(height)});
  for (const auto &child : state(manager).children) {
    auto *native = const_cast<GtkWidget *>(static_cast<const GtkWidget *>(child.data));
    const auto margin = native_margin(native);
    const auto &frame = child.frame;
    const int x = pixels(frame.x), y = pixels(frame.y);
    // GTK applies its own margins; give it a margin box so the resulting
    // border box is the one picked by the algorithm (also for negative margins).
    GtkAllocation allocation{x - pixels(margin.left), y - pixels(margin.top),
                             pixels(frame.x + frame.size.width) - x + pixels(margin.horizontal()),
                             pixels(frame.y + frame.size.height) - y + pixels(margin.vertical())};
    if (GTK_IS_LABEL(native) && gtk_label_get_ellipsize(GTK_LABEL(native)) != PANGO_ELLIPSIZE_NONE)
      TextLayout::before_allocate(native, allocation.width - pixels(margin.horizontal()));
    gtk_widget_size_allocate(native, &allocation, -1);
  }
  if (const auto callback = reinterpret_cast<WeftLinear *>(widget)->on_allocate) callback(widget);
}

void finalize_layout(GObject *object) {
  std::destroy_at(&reinterpret_cast<WeftLinearLayout *>(object)->state);
  G_OBJECT_CLASS(weft_linear_layout_parent_class)->finalize(object);
}

GtkSizeRequestMode widget_request_mode(GtkWidget *widget) {
  auto *child = gtk_widget_get_first_child(widget);
  return child ? gtk_widget_get_request_mode(child) : GTK_SIZE_REQUEST_CONSTANT_SIZE;
}

void widget_measure(GtkWidget *widget, GtkOrientation orientation, int for_size, int *minimum, int *natural,
                    int *minimum_baseline, int *natural_baseline) {
  const bool x = orientation == GTK_ORIENTATION_HORIZONTAL;
  const auto constraint = for_size < 0 ? Length{} : Length::exact(for_size);
  const auto size = measure_widget(widget, x ? Proposal{{}, constraint} : Proposal{constraint, {}});
  *natural = pixels(x ? size.width : size.height);
  *minimum = std::min(*natural, pixels(widget_style(widget).border * 2));
  *minimum_baseline = *natural_baseline = -1;
}

void widget_allocate(GtkWidget *widget, int width, int height, int) {
  auto *child = gtk_widget_get_first_child(widget);
  if (!child) return;
  const double border = widget_style(widget).border;
  const int x = pixels(std::min(border, width / 2.0)), y = pixels(std::min(border, height / 2.0));
  GtkAllocation inner{x, y, std::max(0, width - 2 * x), std::max(0, height - 2 * y)};
  gtk_widget_size_allocate(child, &inner, -1);
}

void snapshot(GtkWidget *widget, GtkSnapshot *snapshot) {
  const auto &style = widget_style(widget);
  const auto &background = [&]() -> const GdkRGBA & {
    if (style.placeholder && !gtk_picture_get_paintable(GTK_PICTURE(gtk_widget_get_first_child(widget)))) {
      return *style.placeholder;
    }
    return style.background;
  }();
  const bool border = style.border > 0 && style.border_color.alpha > 0;
  const bool clip = style.clip || (style.radius > 0 && GTK_IS_PICTURE(gtk_widget_get_first_child(widget)));
  if (style.shadow != Shadow::None || background.alpha > 0 || border || clip) {
    const auto bounds = GRAPHENE_RECT_INIT(0, 0, float(gtk_widget_get_width(widget)), float(gtk_widget_get_height(widget)));
    GskRoundedRect outline;
    gsk_rounded_rect_init_from_rect(&outline, &bounds, float(style.radius));
    const auto shadow = [&](float y, float blur, float alpha) {
      const GdkRGBA color{0, 0, 0, alpha};
      gtk_snapshot_append_outset_shadow(snapshot, &outline, &color, 0, y, 0, blur);
    };
    switch (style.shadow) {
      case Shadow::None: break;
      case Shadow::Small: shadow(1, 3, 31 / 255.0f); break;
      case Shadow::Medium: shadow(4, 12, 38 / 255.0f); break;
      case Shadow::Large: shadow(12, 32, 46 / 255.0f); break;
    }
    if (background.alpha > 0) {
      gtk_snapshot_push_rounded_clip(snapshot, &outline);
      gtk_snapshot_append_color(snapshot, &background, &bounds);
      gtk_snapshot_pop(snapshot);
    }
    const float thickness = style.border;
    if (border) {
      const float widths[]{thickness, thickness, thickness, thickness};
      const GdkRGBA colors[]{style.border_color, style.border_color, style.border_color, style.border_color};
      gtk_snapshot_append_border(snapshot, &outline, widths, colors);
    }
    if (clip) {
      gsk_rounded_rect_shrink(&outline, thickness, thickness, thickness, thickness);
      gtk_snapshot_push_rounded_clip(snapshot, &outline);
    }
  }
  GTK_WIDGET_CLASS(weft_widget_parent_class)->snapshot(widget, snapshot);
  if (clip) gtk_snapshot_pop(snapshot);
}

gboolean spin(GtkWidget *widget, GdkFrameClock *clock, gpointer) {
  constexpr int64_t period_us = 800'000;
  auto &spinner = *reinterpret_cast<WeftSpinner *>(widget);
  spinner.angle = (gdk_frame_clock_get_frame_time(clock) % period_us) * (2 * G_PI / period_us);
  gtk_widget_queue_draw(widget);
  return G_SOURCE_CONTINUE;
}

void snapshot_spinner(GtkWidget *widget, GtkSnapshot *snapshot) {
  const auto &spinner = *reinterpret_cast<WeftSpinner *>(widget);
  const float width = gtk_widget_get_width(widget), height = gtk_widget_get_height(widget);
  constexpr double stroke = 2;
  const double radius = (std::min(width, height) - stroke) / 2;
  if (radius <= 0 || spinner.color.alpha == 0) return;
  const auto bounds = GRAPHENE_RECT_INIT(0, 0, width, height);
  auto *cr = gtk_snapshot_append_cairo(snapshot, &bounds);
  const auto &color = spinner.color;
  cairo_set_source_rgba(cr, color.red, color.green, color.blue, color.alpha);
  cairo_set_line_width(cr, stroke);
  cairo_arc(cr, width / 2, height / 2, radius, spinner.angle, spinner.angle + 1.5 * G_PI);
  cairo_stroke(cr);
  cairo_destroy(cr);
}

void snapshot_progress(GtkWidget *widget, GtkSnapshot *snapshot) {
  const auto &progress = *reinterpret_cast<WeftProgress *>(widget);
  const float width = gtk_widget_get_width(widget), height = gtk_widget_get_height(widget);
  const auto paint = [&](float span, const GdkRGBA &color) {
    if (span <= 0 || height <= 0 || color.alpha == 0) return;
    const auto bounds = GRAPHENE_RECT_INIT(0, 0, span, height);
    GskRoundedRect rounded;
    gsk_rounded_rect_init_from_rect(&rounded, &bounds, std::min(span, height) / 2);
    gtk_snapshot_push_rounded_clip(snapshot, &rounded);
    gtk_snapshot_append_color(snapshot, &color, &bounds);
    gtk_snapshot_pop(snapshot);
  };
  paint(width, progress.track);
  paint(width * progress.fraction, progress.bar);
}

void dispose(GObject *object) {
  while (auto *child = gtk_widget_get_first_child(GTK_WIDGET(object))) gtk_widget_unparent(child);
  G_OBJECT_CLASS(weft_widget_parent_class)->dispose(object);
}

GtkWidget *container_new(GType manager_type) {
  auto *widget = GTK_WIDGET(g_object_new(weft_linear_get_type(), nullptr));
  gtk_widget_set_layout_manager(widget, GTK_LAYOUT_MANAGER(g_object_new(manager_type, nullptr)));
  return widget;
}

}  // namespace

static void weft_layout_child_init(WeftLayoutChild *) {}
static void weft_layout_child_class_init(WeftLayoutChildClass *) {}

static void weft_linear_layout_init(WeftLinearLayout *self) { std::construct_at(&self->state); }
static void weft_linear_layout_class_init(WeftLinearLayoutClass *klass) {
  G_OBJECT_CLASS(klass)->finalize = finalize_layout;
  auto *manager = GTK_LAYOUT_MANAGER_CLASS(klass);
  manager->create_layout_child = create_child;
  manager->layout_child_type = weft_layout_child_get_type();
  manager->get_request_mode = request_mode;
  manager->measure = measure;
  manager->allocate = allocate;
}

static void weft_stack_layout_init(WeftStackLayout *self) { self->parent_instance.state.overlay = true; }
static void weft_stack_layout_class_init(WeftStackLayoutClass *) {}

static void weft_linear_init(WeftLinear *) {}
static void weft_linear_class_init(WeftLinearClass *klass) {
  gtk_widget_class_set_css_name(GTK_WIDGET_CLASS(klass), "weft-linear");
}

static void weft_widget_init(WeftWidget *self) { std::construct_at(&self->style); }
static void weft_widget_class_init(WeftWidgetClass *klass) {
  G_OBJECT_CLASS(klass)->dispose = dispose;
  auto *widget = GTK_WIDGET_CLASS(klass);
  widget->get_request_mode = widget_request_mode;
  widget->measure = widget_measure;
  widget->size_allocate = widget_allocate;
  widget->snapshot = snapshot;
  gtk_widget_class_set_css_name(widget, "weft-widget");
}

static void weft_spinner_init(WeftSpinner *) {}
static void weft_spinner_class_init(WeftSpinnerClass *klass) {
  auto *widget = GTK_WIDGET_CLASS(klass);
  widget->snapshot = snapshot_spinner;
  gtk_widget_class_set_css_name(widget, "weft-spinner");
}

static void weft_progress_init(WeftProgress *) {}
static void weft_progress_class_init(WeftProgressClass *klass) {
  auto *widget = GTK_WIDGET_CLASS(klass);
  widget->snapshot = snapshot_progress;
  gtk_widget_class_set_css_name(widget, "weft-progress");
  gtk_widget_class_set_accessible_role(widget, GTK_ACCESSIBLE_ROLE_PROGRESS_BAR);
}

namespace weft {

Insets Edges::resolve() const {
  const auto value = [this](Edge edge) { return values[static_cast<int>(edge)]; };
  const double all = value(Edge::All).value_or(0);
  const double x = value(Edge::X).value_or(all), y = value(Edge::Y).value_or(all);
  return {value(Edge::Top).value_or(y), value(Edge::End).value_or(x),
          value(Edge::Bottom).value_or(y), value(Edge::Start).value_or(x)};
}

WidgetLayout &attach_layout(GtkWidget *widget) {
  auto *data = new WidgetLayout;
  g_object_set_qdata_full(G_OBJECT(widget), layout_key(), data, [](gpointer p) { delete static_cast<WidgetLayout *>(p); });
  // M1 uses physical left/right for start/end, independent of system locale.
  gtk_widget_set_direction(widget, GTK_TEXT_DIR_LTR);
  return *data;
}

GtkWidget *linear_new(Axis axis, CrossAlign align, bool scrolling) {
  auto *widget = container_new(weft_linear_layout_get_type());
  auto &box = state(widget);
  box.linear.axis = axis;
  box.linear.align = align;
  if (scrolling) box.scroll_axis = axis;
  return widget;
}

GtkWidget *overlay_new() { return container_new(weft_stack_layout_get_type()); }

GtkWidget *text_new() {
  auto *widget = linear_new(Axis::Vertical, CrossAlign::Stretch);
  state(widget).text = true;
  return widget;
}

WidgetStyle &widget_style(GtkWidget *widget) { return reinterpret_cast<WeftWidget *>(widget)->style; }

GtkWidget *widget_new(GtkWidget *child) {
  auto *widget = GTK_WIDGET(g_object_new(weft_widget_get_type(), nullptr));
  if (child) gtk_widget_set_parent(child, widget);
  return widget;
}

GtkWidget *spinner_new() {
  auto *widget = GTK_WIDGET(g_object_new(weft_spinner_get_type(), nullptr));
  gtk_widget_set_can_target(widget, false);
  gtk_widget_add_tick_callback(widget, spin, nullptr, nullptr);
  return widget;
}

void spinner_set_color(GtkWidget *widget, GdkRGBA color) {
  reinterpret_cast<WeftSpinner *>(widget)->color = color;
  gtk_widget_queue_draw(widget);
}

GtkWidget *progress_new() {
  auto *widget = GTK_WIDGET(g_object_new(weft_progress_get_type(), nullptr));
  gtk_widget_set_can_target(widget, false);
  gtk_accessible_update_property(GTK_ACCESSIBLE(widget), GTK_ACCESSIBLE_PROPERTY_VALUE_MIN, 0.0,
                                 GTK_ACCESSIBLE_PROPERTY_VALUE_MAX, 1.0,
                                 GTK_ACCESSIBLE_PROPERTY_VALUE_NOW, 0.0, -1);
  return widget;
}

void progress_set_color(GtkWidget *widget, GdkRGBA color, bool dark) {
  auto &progress = *reinterpret_cast<WeftProgress *>(widget);
  progress.bar = color;
  progress.track = dark ? GdkRGBA{1, 1, 1, 38 / 255.0f} : GdkRGBA{0, 0, 0, 31 / 255.0f};
  gtk_widget_queue_draw(widget);
}

void progress_set_value(GtkWidget *widget, double value) {
  auto &progress = *reinterpret_cast<WeftProgress *>(widget);
  progress.fraction = std::isnan(value) ? 0 : std::clamp(value, 0.0, 1.0);
  gtk_accessible_update_property(GTK_ACCESSIBLE(widget), GTK_ACCESSIBLE_PROPERTY_VALUE_NOW, progress.fraction, -1);
  gtk_widget_queue_draw(widget);
}

void picture_set_density(GtkPicture *picture, int density) {
  auto *object = G_OBJECT(picture);
  const auto key = picture_density_key();
  auto *value = density > 1 ? GINT_TO_POINTER(density) : nullptr;
  if (g_object_get_qdata(object, key) == value) return;
  g_object_set_qdata(object, key, value);
  gtk_widget_queue_resize(GTK_WIDGET(picture));
}

void container_set_gap(GtkWidget *widget, double gap) {
  state(widget).linear.gap = std::max(0.0, gap);
  gtk_widget_queue_resize(widget);
}
void container_set_align(GtkWidget *widget, CrossAlign align) {
  state(widget).linear.align = align;
  gtk_widget_queue_resize(widget);
}
void container_set_justify(GtkWidget *widget, Justify justify) {
  state(widget).linear.justify = justify;
  gtk_widget_queue_allocate(widget);
}
void container_set_alignment(GtkWidget *widget, Alignment alignment) {
  state(widget).alignment = alignment;
  gtk_widget_queue_allocate(widget);
}
void container_set_padding(GtkWidget *widget, Edge edge, double value) {
  state(widget).padding.set(edge, std::max(0.0, value));
  gtk_widget_queue_resize(widget);
}

void container_on_allocate(GtkWidget *widget, void (*callback)(GtkWidget *)) {
  reinterpret_cast<WeftLinear *>(widget)->on_allocate = callback;
}

}  // namespace weft
