// Built-in elements. Each wraps its widget and exposes the element's
// properties as `set_<name>`; properties never set keep the platform's
// defaults. Lengths are logical pixels.

#include <libsoup/soup.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <utility>

#include "appearance.hpp"
#include "assets.hpp"
#include "container.hpp"
#include "platform.hpp"
#include "texture_cache.hpp"
#include "weft/gtk.hpp"

namespace weft {

namespace {

int pixels(double length) { return int(std::lround(length)); }

std::string owned(std::string_view text) { return std::string(text); }

}  // namespace

// Values.

double number(const ops::Value &value) {
  auto *number = std::get_if<double>(&value);
  return number ? *number : 0;
}

bool boolean(const ops::Value &value) {
  auto *flag = std::get_if<bool>(&value);
  return flag && *flag;
}

std::string_view string(const ops::Value &value) {
  auto *text = std::get_if<std::string_view>(&value);
  return text ? *text : std::string_view();
}

ops::StringList strings(const ops::Value &value) {
  auto *list = std::get_if<ops::StringList>(&value);
  return list ? *list : ops::StringList{};
}

// Element.

struct Element::Tap {
  static void pressed(GtkGestureClick *, int, double x, double y, Tap *tap) {
    auto *widget = tap->element.widget();
    auto *target = gtk_widget_pick(widget, x, y, GTK_PICK_DEFAULT);
    // Leave the press unclaimed so a scroll viewport can still start a drag.
    // Neither a nested onTap nor a native Button should dim its ancestors.
    for (; target && target != widget; target = gtk_widget_get_parent(target)) {
      if (gtk_accessible_get_accessible_role(GTK_ACCESSIBLE(target)) == GTK_ACCESSIBLE_ROLE_BUTTON) return;
    }
    tap->down = true;
    tap->element.apply_opacity();
  }

  static void released(GtkGestureClick *gesture, int, double x, double y, Tap *tap) {
    if (!tap->clear()) return;
    auto *widget = tap->element.widget();
    gtk_gesture_set_state(GTK_GESTURE(gesture), GTK_EVENT_SEQUENCE_CLAIMED);
    if (gtk_widget_contains(widget, x, y)) tap->action();
  }

  static void cancelled(GtkGesture *, GdkEventSequence *, Tap *tap) { tap->clear(); }

  static gboolean key_pressed(GtkEventControllerKey *, guint key, guint, GdkModifierType, Tap *tap) {
    if (!gtk_widget_has_focus(tap->element.widget())) return false;
    if (key != GDK_KEY_Return && key != GDK_KEY_KP_Enter && key != GDK_KEY_space) return false;
    tap->action();
    return true;
  }

  bool clear() {
    if (!std::exchange(down, false)) return false;
    element.apply_opacity();
    return true;
  }

  Element &element;
  std::function<void()> action;
  GtkEventController *gesture;
  GtkEventController *keys;
  bool down = false;
};

Element::Element(GtkWidget *widget) : widget_(GTK_WIDGET(g_object_ref_sink(widget))), layout_(attach_layout(widget)) {}

Element::~Element() {
  // The widget may outlive the element, e.g. while GTK emits one of its
  // signals; its handlers must not reach the element any more.
  if (tap_) {
    g_signal_handlers_disconnect_by_data(tap_->gesture, tap_.get());
    g_signal_handlers_disconnect_by_data(tap_->keys, tap_.get());
    gtk_widget_remove_controller(widget_, tap_->gesture);
    gtk_widget_remove_controller(widget_, tap_->keys);
  }
  g_signal_handlers_disconnect_by_data(widget_, this);
  g_object_unref(widget_);
}

void Element::set_on_tap(std::function<void()> action) {
  if (tap_) {
    tap_->action = std::move(action);
    return;
  }
  auto *gesture = gtk_gesture_click_new();
  auto *controller = GTK_EVENT_CONTROLLER(gesture);
  auto *keys = gtk_event_controller_key_new();
  tap_ = std::make_unique<Tap>(*this, std::move(action), controller, keys);
  g_object_set(widget_, "accessible-role", GTK_ACCESSIBLE_ROLE_BUTTON, nullptr);
  gtk_widget_set_focusable(widget_, true);
  gtk_widget_set_cursor_from_name(widget_, "pointer");
  gtk_gesture_single_set_button(GTK_GESTURE_SINGLE(gesture), GDK_BUTTON_PRIMARY);
  gtk_event_controller_set_propagation_phase(controller, GTK_PHASE_BUBBLE);
  g_signal_connect(gesture, "pressed", G_CALLBACK(Tap::pressed), tap_.get());
  g_signal_connect(gesture, "released", G_CALLBACK(Tap::released), tap_.get());
  g_signal_connect(gesture, "cancel", G_CALLBACK(Tap::cancelled), tap_.get());
  gtk_widget_add_controller(widget_, controller);
  g_signal_connect(keys, "key-pressed", G_CALLBACK(Tap::key_pressed), tap_.get());
  gtk_widget_add_controller(widget_, keys);
}

void Element::set_opacity(double opacity) {
  opacity_ = std::clamp(opacity, 0.0, 1.0);
  apply_opacity();
}

void Element::apply_opacity() { gtk_widget_set_opacity(widget_, opacity_ * (tap_ && tap_->down ? 0.6 : 1)); }
void Element::set_hidden(bool hidden) { gtk_widget_set_visible(widget_, !hidden); }

void Element::set_width(double width) {
  layout_.size.width = width;
  gtk_widget_queue_resize(widget_);
}
void Element::set_height(double height) {
  layout_.size.height = height;
  gtk_widget_queue_resize(widget_);
}
void Element::set_min_width(double min_width) {
  layout_.size.min_width = min_width;
  gtk_widget_queue_resize(widget_);
}
void Element::set_max_width(double max_width) {
  layout_.size.max_width = max_width;
  gtk_widget_queue_resize(widget_);
}
void Element::set_min_height(double min_height) {
  layout_.size.min_height = min_height;
  gtk_widget_queue_resize(widget_);
}
void Element::set_max_height(double max_height) {
  layout_.size.max_height = max_height;
  gtk_widget_queue_resize(widget_);
}
void Element::set_aspect_ratio(double aspect_ratio) {
  layout_.size.aspect_ratio = aspect_ratio;
  gtk_widget_queue_resize(widget_);
}
void Element::set_grow(double grow) {
  layout_.grow = grow;
  gtk_widget_queue_resize(widget_);
}
void Element::set_fill(bool fill) {
  layout_.fill = fill;
  gtk_widget_queue_resize(widget_);
}

void Element::set_margin_edge(Edge edge, double value) {
  layout_.margin.set(edge, value);
  auto [top, right, bottom, left] = layout_.margin.resolve();
  // GTK margins are unsigned; layout and allocation still use the signed values.
  const auto native = [](double margin) { return pixels(std::clamp(margin, 0.0, double(G_MAXINT16))); };
  gtk_widget_set_margin_top(widget_, native(top));
  gtk_widget_set_margin_end(widget_, native(right));
  gtk_widget_set_margin_bottom(widget_, native(bottom));
  gtk_widget_set_margin_start(widget_, native(left));
  gtk_widget_queue_resize(widget_);
}
void Element::set_margin(double margin) { set_margin_edge(Edge::All, margin); }
void Element::set_margin_x(double margin_x) { set_margin_edge(Edge::X, margin_x); }
void Element::set_margin_y(double margin_y) { set_margin_edge(Edge::Y, margin_y); }
void Element::set_margin_top(double margin_top) { set_margin_edge(Edge::Top, margin_top); }
void Element::set_margin_bottom(double margin_bottom) { set_margin_edge(Edge::Bottom, margin_bottom); }
void Element::set_margin_start(double margin_start) { set_margin_edge(Edge::Start, margin_start); }
void Element::set_margin_end(double margin_end) { set_margin_edge(Edge::End, margin_end); }

void Decorated::set_background(Color color) {
  background_ = color;
  widget_style(widget()).background = color.resolve();
  gtk_widget_queue_draw(widget());
}

void Decorated::set_radius(double radius) {
  widget_style(widget()).radius = std::max(0.0, radius);
  gtk_widget_queue_draw(widget());
}

void Decorated::set_border(double border) {
  widget_style(widget()).border = std::max(0.0, border);
  resolve_border_color();
  gtk_widget_queue_resize(widget());
  gtk_widget_queue_draw(widget());
}

void Decorated::set_border_color(Color color) {
  border_color_ = color;
  resolve_border_color();
  gtk_widget_queue_draw(widget());
}

void Decorated::set_shadow(Shadow shadow) {
  widget_style(widget()).shadow = shadow;
  gtk_widget_queue_draw(widget());
}

void Decorated::set_clip(bool clip) {
  widget_style(widget()).clip = clip;
  gtk_widget_queue_draw(widget());
}

void Decorated::resolve_border_color() {
  const auto color = border_color_.value_or(Color::rgba(dark() ? 0xffffff26u : 0x0000001fu));
  widget_style(widget()).border_color = color.resolve();
}

void Decorated::reapply_colors() {
  const bool background_changes = background_.is_token();
  const bool border_changes = widget_style(widget()).border > 0 && (!border_color_ || border_color_->is_token());
  if (background_changes) widget_style(widget()).background = background_.resolve();
  if (border_changes) resolve_border_color();
  if (background_changes || border_changes) gtk_widget_queue_draw(widget());
}

Padded::Padded(GtkWidget *widget, GtkWidget *content) : Decorated(widget) {
  layout().padding_widget = content ? content : widget;
}

void Padded::set_padding_edge(Edge edge, double value) { container_set_padding(layout().padding_widget, edge, value); }
void Padded::set_padding(double padding) { set_padding_edge(Edge::All, padding); }
void Padded::set_padding_x(double padding_x) { set_padding_edge(Edge::X, padding_x); }
void Padded::set_padding_y(double padding_y) { set_padding_edge(Edge::Y, padding_y); }
void Padded::set_padding_top(double padding_top) { set_padding_edge(Edge::Top, padding_top); }
void Padded::set_padding_bottom(double padding_bottom) { set_padding_edge(Edge::Bottom, padding_bottom); }
void Padded::set_padding_start(double padding_start) { set_padding_edge(Edge::Start, padding_start); }
void Padded::set_padding_end(double padding_end) { set_padding_edge(Edge::End, padding_end); }

// Containers.

Linear::Linear(Axis axis, CrossAlign align) : Padded(linear_new(axis, align)), children_(widget()) {}

void Linear::set_gap(double gap) { container_set_gap(widget(), gap); }
void Linear::set_align(CrossAlign align) { container_set_align(widget(), align); }
void Linear::set_justify(Justify justify) { container_set_justify(widget(), justify); }

Stack::Stack() : Padded(overlay_new()), children_(widget()) {}
void Stack::set_alignment(Alignment alignment) { container_set_alignment(widget(), alignment); }

Scroll::Scroll(Axis direction) : Scroll(direction, linear_new(direction, CrossAlign::Start, true)) {}

Scroll::Scroll(Axis direction, GtkWidget *content)
    : Padded(widget_new(gtk_scrolled_window_new()), content), direction_(direction),
      scroll_(GTK_SCROLLED_WINDOW(gtk_widget_get_first_child(widget()))), content_(content), children_(content) {
  gtk_scrolled_window_set_propagate_natural_width(scroll_, true);
  gtk_scrolled_window_set_propagate_natural_height(scroll_, true);
  gtk_scrolled_window_set_child(scroll_, content_);
  set_indicators(true);
  layout().grow = 1;
  layout().fill = true;
}

void Scroll::set_gap(double gap) { container_set_gap(content_, gap); }
void Scroll::set_align(CrossAlign align) { container_set_align(content_, align); }
void Scroll::set_indicators(bool indicators) {
  const auto active = indicators ? GTK_POLICY_AUTOMATIC : GTK_POLICY_EXTERNAL;
  const bool horizontal = direction_ == Axis::Horizontal;
  gtk_scrolled_window_set_policy(scroll_, horizontal ? active : GTK_POLICY_NEVER,
                                 horizontal ? GTK_POLICY_NEVER : active);
}

Spacer::Spacer() : Element(widget_new()) { layout().spacer = true; }
void Spacer::set_size(double size) {
  layout().spacer_size = std::max(0.0, size);
  gtk_widget_queue_resize(widget());
}

// Text.

namespace {

int pango_length(double pixels) { return int(std::min<double>(pixels * PANGO_SCALE, G_MAXINT)); }

GQuark paragraph_limit_key() {
  static const GQuark key = g_quark_from_static_string("weft-paragraph-limit");
  return key;
}

Text *paragraph_limited_text(GtkWidget *widget) {
  return static_cast<Text *>(g_object_get_qdata(G_OBJECT(widget), paragraph_limit_key()));
}

PangoWeight pango_weight(Weight weight) {
  switch (weight) {
    case Weight::Light: return PANGO_WEIGHT_LIGHT;
    case Weight::Medium: return PANGO_WEIGHT_MEDIUM;
    case Weight::Semibold: return PANGO_WEIGHT_SEMIBOLD;
    case Weight::Bold: return PANGO_WEIGHT_BOLD;
    case Weight::Regular: return PANGO_WEIGHT_NORMAL;
  }
  return PANGO_WEIGHT_NORMAL;
}

}  // namespace

Text::Text(size_t span_count)
    : Padded(text_new()), label_(GTK_LABEL(gtk_label_new(nullptr))) {
  spans_.reserve(span_count);
  for (size_t index = 0; index < span_count; ++index) spans_.emplace_back(*this);
  gtk_widget_set_direction(GTK_WIDGET(label_), GTK_TEXT_DIR_LTR);
  set_align(TextAlign::Start);
  gtk_label_set_wrap(label_, true);
  gtk_label_set_wrap_mode(label_, PANGO_WRAP_WORD_CHAR);
  gtk_widget_set_parent(GTK_WIDGET(label_), widget());
}

Text::~Text() {
  if (limit_paragraphs_) g_object_set_qdata(G_OBJECT(label_), paragraph_limit_key(), nullptr);
}

void Text::set_value(std::string_view value) {
  if (value_ == value) return;
  value_ = value;
  show_value();
}

void Text::show_value() {
  gtk_label_set_text(label_, value_.c_str());
  clipped_width_ = -1;
  const bool limit = max_lines_ > 0 && (value_.find_first_of("\r\n") != std::string::npos ||
                                      value_.find("\u2028") != std::string::npos || value_.find("\u2029") != std::string::npos);
  if (limit_paragraphs_ != limit) {
    limit_paragraphs_ = limit;
    g_object_set_qdata(G_OBJECT(label_), paragraph_limit_key(), limit ? this : nullptr);
  }
}

void Text::set_color(Color color) {
  style_.color = color;
  restyle();
}

void Text::set_font(std::string_view font) {
  if (style_.font == font) return;
  style_.font.assign(font);
  restyle();
}

void Text::set_size(double size) {
  style_.size = size > 0 ? std::optional(pango_length(size)) : std::nullopt;
  restyle();
}

void Text::set_weight(Weight weight) {
  style_.weight = weight;
  restyle();
}

void Text::set_italic(bool italic) {
  style_.italic = italic;
  restyle();
}

void Text::set_decoration(Decoration decoration) {
  style_.decoration = decoration;
  restyle();
}

void Text::set_align(TextAlign align) {
  switch (align) {
    case TextAlign::Start:
      gtk_label_set_justify(label_, GTK_JUSTIFY_LEFT);
      gtk_label_set_xalign(label_, 0);
      break;
    case TextAlign::Center:
      gtk_label_set_justify(label_, GTK_JUSTIFY_CENTER);
      gtk_label_set_xalign(label_, 0.5);
      break;
    case TextAlign::End:
      gtk_label_set_justify(label_, GTK_JUSTIFY_RIGHT);
      gtk_label_set_xalign(label_, 1);
      break;
  }
}

void Text::set_max_lines(double lines) {
  const int limit = lines >= 1 ? int(std::min<double>(lines, G_MAXINT)) : -1;
  if (max_lines_ == limit) return;
  max_lines_ = limit;
  gtk_label_set_lines(label_, limit);
  gtk_label_set_ellipsize(label_, limit > 0 ? PANGO_ELLIPSIZE_END : PANGO_ELLIPSIZE_NONE);
  show_value();
}

void Text::set_line_height(double height) {
  line_height_ = height >= 0 ? std::optional(pango_length(height)) : std::nullopt;
  restyle();
}

void Text::reapply_colors() {
  Decorated::reapply_colors();
  const auto token = [](const Style &style) { return style.color && style.color->is_token(); };
  if (token(style_) || std::ranges::any_of(spans_, [&](const Span &span) { return token(span.style_); })) restyle();
}

void Text::Span::set_value(std::string_view value) {
  if (value_ == value) return;
  value_ = value;
  text_.join_spans();
}

void Text::Span::set_color(Color color) {
  style_.color = color;
  restyle();
}

void Text::Span::set_font(std::string_view font) {
  if (style_.font == font) return;
  style_.font.assign(font);
  restyle();
}

void Text::Span::set_size(double size) {
  style_.size = size > 0 ? std::optional(pango_length(size)) : std::nullopt;
  restyle();
}

void Text::Span::set_weight(Weight weight) {
  style_.weight = weight;
  restyle();
}

void Text::Span::set_italic(bool italic) {
  style_.italic = italic;
  restyle();
}

void Text::Span::set_decoration(Decoration decoration) {
  style_.decoration = decoration;
  restyle();
}

void Text::Span::restyle() {
  if (!value_.empty()) text_.restyle();
}

void Text::join_spans() {
  size_t length = 0;
  for (const auto &span : spans_) length += span.value_.size();
  value_.clear();
  value_.reserve(length);
  for (const auto &span : spans_) value_ += span.value_;
  show_value();
  restyle();
}

void Text::Style::apply(PangoAttrList *attributes, const Style &inherited, guint start, guint end) const {
  const auto choose = []<class T>(const std::optional<T> &local, const std::optional<T> &parent)
      -> const std::optional<T> & { return local ? local : parent; };
  const auto insert = [=](PangoAttribute *attr) {
    attr->start_index = start;
    attr->end_index = end;
    pango_attr_list_insert(attributes, attr);
  };
  if (const auto &value = choose(color, inherited.color)) {
    const auto rgba = value->resolve();
    const auto channel = [](float value) { return guint16(std::lround(value * 65535)); };
    insert(pango_attr_foreground_new(channel(rgba.red), channel(rgba.green), channel(rgba.blue)));
    // Pango reserves alpha 0 for inheriting the renderer's foreground alpha.
    insert(pango_attr_foreground_alpha_new(std::max<guint16>(channel(rgba.alpha), 1)));
  }
  const auto &family = font.empty() ? inherited.font : font;
  if (!family.empty()) insert(pango_attr_family_new(family.c_str()));
  if (auto value = choose(size, inherited.size)) insert(pango_attr_size_new_absolute(*value));
  if (auto value = choose(weight, inherited.weight)) insert(pango_attr_weight_new(pango_weight(*value)));
  if (auto value = choose(italic, inherited.italic))
    insert(pango_attr_style_new(*value ? PANGO_STYLE_ITALIC : PANGO_STYLE_NORMAL));
  switch (choose(decoration, inherited.decoration).value_or(Decoration::None)) {
    case Decoration::Underline: insert(pango_attr_underline_new(PANGO_UNDERLINE_SINGLE)); break;
    case Decoration::LineThrough: insert(pango_attr_strikethrough_new(true)); break;
    case Decoration::None: break;
  }
}

void Text::restyle() {
  auto *attributes = pango_attr_list_new();
  if (line_height_) pango_attr_list_insert(attributes, pango_attr_line_height_new_absolute(*line_height_));
  if (spans_.empty()) {
    style_.apply(attributes, style_, 0, PANGO_ATTR_INDEX_TO_TEXT_END);
  } else {
    // Pango ranges are byte offsets, including for non-ASCII and emoji runs.
    guint start = 0;
    for (const auto &span : spans_) {
      const guint end = start + guint(span.value_.size());
      if (start != end) span.style_.apply(attributes, style_, start, end);
      start = end;
    }
  }
  gtk_label_set_attributes(label_, attributes);
  pango_attr_list_unref(attributes);
  clipped_width_ = -1;
}

PangoLayout *Text::source_layout() const {
  auto *layout = pango_layout_copy(gtk_label_get_layout(label_));
  pango_layout_set_ellipsize(layout, PANGO_ELLIPSIZE_NONE);
  pango_layout_set_height(layout, -1);
  pango_layout_set_text(layout, value_.c_str(), -1);
  return layout;
}

void Text::clip_paragraphs(PangoLayout *layout, int width) {
  clipped_width_ = width;
  clipped_context_ = pango_context_get_serial(pango_layout_get_context(layout));
  clipped_value_.clear();
  pango_layout_set_width(layout, pango_length(width));
  if (pango_layout_get_line_count(layout) > max_lines_) {
    const auto *line = pango_layout_get_line_readonly(layout, max_lines_ - 1);
    const char *first = value_.data() + line->start_index;
    const char *end = first + line->length;
    // Keep hard breaks before the last visible line. Trim only the tail,
    // backing up by grapheme clusters if the ellipsis itself needs room.
    while (end > first && g_unichar_isspace(g_utf8_get_char(g_utf8_prev_char(end)))) end = g_utf8_prev_char(end);
    for (;;) {
      clipped_value_.assign(value_.data(), end - value_.data());
      clipped_value_ += "…";
      pango_layout_set_text(layout, clipped_value_.c_str(), -1);
      if (end == first || pango_layout_get_line_count(layout) <= max_lines_) break;
      int count;
      const auto *attributes = pango_layout_get_log_attrs_readonly(layout, &count);
      // There is one log attribute per character plus one at end of text.
      int previous = count - 3;  // Boundary before the character preceding the ellipsis.
      do {
        end = g_utf8_prev_char(end);
      } while (end > first && !attributes[previous--].is_cursor_position);
    }
  }
  pango_layout_get_pixel_size(layout, nullptr, &clipped_height_);
}

std::optional<layout::Size> TextLayout::measure(GtkWidget *widget, layout::Proposal proposal) {
  auto *text = paragraph_limited_text(widget);
  if (!text) return std::nullopt;
  const auto [width, height] = proposal;
  g_autoptr(PangoLayout) layout = nullptr;
  double fitted_width = width.value;
  if (!width.is_exact()) {
    layout = text->source_layout();
    pango_layout_set_width(layout, -1);
    int natural;
    pango_layout_get_pixel_size(layout, &natural, nullptr);
    fitted_width = width.fit(natural);
  }
  if (height.is_exact()) return layout::Size{fitted_width, height.value};
  const int fitted_pixels = pixels(fitted_width);
  if (text->clipped_width_ != fitted_pixels ||
      text->clipped_context_ != pango_context_get_serial(gtk_widget_get_pango_context(widget))) {
    if (!layout) layout = text->source_layout();
    text->clip_paragraphs(layout, fitted_pixels);
  }
  return layout::Size{fitted_width, height.fit(text->clipped_height_)};
}

void TextLayout::before_allocate(GtkWidget *widget, int width) {
  auto *text = paragraph_limited_text(widget);
  if (!text) return;
  if (text->clipped_width_ != width ||
      text->clipped_context_ != pango_context_get_serial(gtk_widget_get_pango_context(widget))) {
    g_autoptr(PangoLayout) layout = text->source_layout();
    text->clip_paragraphs(layout, width);
  }
  const auto &value = text->clipped_value_.empty() ? text->value_ : text->clipped_value_;
  gtk_label_set_text(text->label_, value.c_str());
}

// Button.

Button::Button(std::function<void()> click)
    : Element(gtk_button_new()), click_(std::move(click)), content_(Axis::Horizontal, CrossAlign::Center) {
  content_.set_justify(Justify::Center);
  gtk_button_set_child(GTK_BUTTON(widget()), content_.widget());
  // GTK handles Button releases in capture by default. Use the same
  // child-first order as onTap when a Button contains another tappable.
  g_autoptr(GListModel) controllers = gtk_widget_observe_controllers(widget());
  for (guint i = 0, n = g_list_model_get_n_items(controllers); i < n; ++i) {
    g_autoptr(GtkEventController) controller = GTK_EVENT_CONTROLLER(g_list_model_get_item(controllers, i));
    if (!GTK_IS_GESTURE_CLICK(controller)) continue;
    gtk_event_controller_set_propagation_phase(controller, GTK_PHASE_BUBBLE);
    break;
  }
  if (click_) g_signal_connect(widget(), "clicked", G_CALLBACK(clicked), this);
}

void Button::clicked(GtkButton *, Button *self) { self->click_(); }

void Button::set_disabled(bool disabled) { gtk_widget_set_sensitive(widget(), !disabled); }

// Input.

namespace {

/// Natural width of an `Input` when no width is specified.
constexpr int kInputWidth = 200;

}  // namespace

Input::Input(std::function<bool(std::string_view)> edit, std::function<void()> submit,
             std::function<void(bool)> focus)
    : TextControl(gtk_entry_new(), std::move(focus)), edit_(std::move(edit)), submit_(std::move(submit)) {
  gtk_widget_set_size_request(widget(), kInputWidth, -1);
  set_focus_target(widget());
  g_signal_connect(widget(), "changed", G_CALLBACK(changed), this);
  if (submit_) g_signal_connect(widget(), "activate", G_CALLBACK(activated), this);
  GtkEditable *text = gtk_editable_get_delegate(GTK_EDITABLE(widget()));
  g_signal_connect(text, "preedit-changed", G_CALLBACK(preedit_changed), this);
}

Input::~Input() {
  g_signal_handlers_disconnect_by_data(gtk_editable_get_delegate(GTK_EDITABLE(widget())), this);
}

void Input::set_value(std::string_view value) {
  value_ = value;
  if (!composing_ && gtk_editable_get_text(GTK_EDITABLE(widget())) != value_) show(value_);
}

void Input::set_placeholder(std::string_view placeholder) {
  gtk_entry_set_placeholder_text(GTK_ENTRY(widget()), owned(placeholder).c_str());
}

void Input::set_disabled(bool disabled) { gtk_widget_set_sensitive(widget(), !disabled); }

void Input::set_type(InputType type) {
  GtkInputPurpose purpose = GTK_INPUT_PURPOSE_FREE_FORM;
  switch (type) {
    case InputType::Text: break;
    case InputType::Password: purpose = GTK_INPUT_PURPOSE_PASSWORD; break;
    case InputType::Number: purpose = GTK_INPUT_PURPOSE_NUMBER; break;
    case InputType::Email: purpose = GTK_INPUT_PURPOSE_EMAIL; break;
    case InputType::Phone: purpose = GTK_INPUT_PURPOSE_PHONE; break;
  }
  gtk_entry_set_input_purpose(GTK_ENTRY(widget()), purpose);
  gtk_entry_set_visibility(GTK_ENTRY(widget()), type != InputType::Password);
}

void Input::activated(GtkEntry *, Input *self) {
  if (!self->composing_) self->submit_();
}

void Input::changed(GtkEditable *, Input *self) { self->edited(); }

void Input::preedit_changed(GtkText *, const char *preedit, Input *self) {
  bool composing = preedit && *preedit;
  if (composing == self->composing_) return;
  self->composing_ = composing;
  if (!composing) self->edited();
}

void Input::edited() {
  if (showing_ || composing_) return;
  auto *editable = GTK_EDITABLE(widget());
  std::string_view raw = gtk_editable_get_text(editable);
  if (raw == value_) return;
  const auto limited = limit_edit(raw);
  if (limited.size() != raw.size()) {
    const auto suffix = g_utf8_strlen(raw.data() + limited.size(), -1);
    showing_ = true;
    gtk_editable_delete_text(editable, gtk_entry_get_text_length(GTK_ENTRY(widget())) - suffix, -1);
    showing_ = false;
    raw = gtk_editable_get_text(editable);
    if (raw == value_) return;
  }
  // The handler applies the app's ops synchronously, so the widget's text
  // may change during dispatch. Own the payload until the handler returns.
  std::string text(raw);
  if (!edit_(text)) show(value_);
}

void Input::show(const std::string &text) {
  auto *editable = GTK_EDITABLE(widget());
  int caret = gtk_editable_get_position(editable);
  // Replacing the text deletes it first; that intermediate edit is not the user's.
  showing_ = true;
  gtk_editable_set_text(editable, text.c_str());
  showing_ = false;
  gtk_editable_set_position(editable, std::min(caret, int(g_utf8_strlen(text.c_str(), -1))));
}

// Checkbox.

Checkbox::Checkbox(std::function<bool(bool)> edit) : Element(gtk_check_button_new()), edit_(std::move(edit)) {
  g_signal_connect(widget(), "toggled", G_CALLBACK(toggled), this);
}

void Checkbox::set_checked(bool checked) {
  value_ = checked;
  gtk_check_button_set_active(GTK_CHECK_BUTTON(widget()), checked);
}

void Checkbox::set_disabled(bool disabled) { gtk_widget_set_sensitive(widget(), !disabled); }

void Checkbox::toggled(GtkCheckButton *button, Checkbox *self) {
  bool now = gtk_check_button_get_active(button);
  if (now == self->value_) return;
  // Accepted edits write `value_` through a `set` op before `edit_` returns.
  if (!self->edit_(now)) gtk_check_button_set_active(button, self->value_);
}

// Image.

namespace {

/// Downloaded images by source, shared by every `Image` of the process.
TextureCache &textures() {
  static TextureCache textures(64 * 1024 * 1024);
  return textures;
}

SoupSession *images_session() {
  static SoupSession *session = soup_session_new();
  return session;
}

/// A load in flight: the picture it is for, unless it is gone, and the source.
struct Load {
  GWeakRef picture;
  GCancellable *cancellable = nullptr;
  std::string src;
  std::vector<uint8_t> body;

  ~Load() {
    g_weak_ref_clear(&picture);
    g_clear_object(&cancellable);
  }
};

bool within_image_pixel_limit(const uint8_t *data, size_t len) {
  GdkPixbufLoader *loader = gdk_pixbuf_loader_new();
  struct Probe {
    bool seen = false;
    bool ok = false;
  } probe;
  g_signal_connect(
      loader, "size-prepared",
      G_CALLBACK(+[](GdkPixbufLoader *, int width, int height, gpointer user_data) {
        auto *p = static_cast<Probe *>(user_data);
        p->seen = true;
        p->ok = width > 0 && height > 0 && int64_t(width) * int64_t(height) <= platform::kMaxImagePixels;
      }),
      &probe);
  GError *err = nullptr;
  // Write only in small slices so oversized headers abort without decoding huge rasters.
  size_t step = std::min<size_t>(len, 4096);
  size_t offset = 0;
  while (offset < len && !probe.seen) {
    size_t n = std::min(step, len - offset);
    if (!gdk_pixbuf_loader_write(loader, data + offset, n, &err)) {
      if (err) g_error_free(err);
      gdk_pixbuf_loader_close(loader, nullptr);
      g_object_unref(loader);
      return probe.seen ? probe.ok : false;
    }
    offset += n;
  }
  gdk_pixbuf_loader_close(loader, nullptr);
  g_object_unref(loader);
  return probe.seen && probe.ok;
}

/// Shows `bytes` in the picture of `load` if it still shows that source.
void loaded(std::unique_ptr<Load> load, GBytes *bytes, GError *error) {
  if (load->cancellable && g_cancellable_is_cancelled(load->cancellable)) {
    if (error) g_error_free(error);
    if (bytes) g_bytes_unref(bytes);
    return;
  }
  GdkTexture *texture = nullptr;
  if (bytes) {
    gsize len = 0;
    const auto *ptr = static_cast<const uint8_t *>(g_bytes_get_data(bytes, &len));
    if (len > platform::kMaxImageBytes || !within_image_pixel_limit(ptr, len)) {
      error = g_error_new(G_IO_ERROR, G_IO_ERROR_FAILED, "image exceeds size or pixel limits");
    } else {
      texture = gdk_texture_new_from_bytes(bytes, &error);
    }
  }
  if (!texture) {
    std::fprintf(stderr, "[weft warn] weft: cannot load the image %s (%s)\n", load->src.c_str(),
                 error ? error->message : "unknown error");
  }
  if (auto *picture = static_cast<GtkPicture *>(g_weak_ref_get(&load->picture))) {
    if (g_object_get_data(G_OBJECT(picture), "weft-load") == load.get()) {
      g_object_set_data(G_OBJECT(picture), "weft-load", nullptr);
      if (texture) gtk_picture_set_paintable(picture, GDK_PAINTABLE(texture));
    }
    g_object_unref(picture);
  }
  if (texture) {
    textures().insert(std::move(load->src), texture);
    g_object_unref(texture);
  }
  if (error) g_error_free(error);
  if (bytes) g_bytes_unref(bytes);
}

void read_image_chunk(GInputStream *stream, std::unique_ptr<Load> load);

void on_image_chunk(GObject *source, GAsyncResult *result, gpointer data) {
  std::unique_ptr<Load> load(static_cast<Load *>(data));
  auto *stream = G_INPUT_STREAM(source);
  GError *error = nullptr;
  GBytes *chunk = g_input_stream_read_bytes_finish(stream, result, &error);
  if (!chunk) {
    loaded(std::move(load), nullptr, error);
    return;
  }
  gsize n = 0;
  const auto *ptr = static_cast<const uint8_t *>(g_bytes_get_data(chunk, &n));
  if (n == 0) {
    g_bytes_unref(chunk);
    GBytes *bytes = g_bytes_new(load->body.data(), load->body.size());
    loaded(std::move(load), bytes, nullptr);
    return;
  }
  if (load->body.size() + n > platform::kMaxImageBytes) {
    g_bytes_unref(chunk);
    loaded(std::move(load), nullptr,
           g_error_new(G_IO_ERROR, G_IO_ERROR_FAILED, "image exceeds 16 MiB limit"));
    return;
  }
  load->body.insert(load->body.end(), ptr, ptr + n);
  g_bytes_unref(chunk);
  read_image_chunk(stream, std::move(load));
}

void read_image_chunk(GInputStream *stream, std::unique_ptr<Load> load) {
  GCancellable *cancellable = load->cancellable;
  g_input_stream_read_bytes_async(stream, 65536, G_PRIORITY_LOW, cancellable, on_image_chunk,
                                  load.release());
}

}  // namespace

Image::Image() : Decorated(widget_new(gtk_picture_new())), picture_(GTK_PICTURE(gtk_widget_get_first_child(widget()))) {
  gtk_picture_set_can_shrink(picture_, true);
  gtk_widget_set_overflow(GTK_WIDGET(picture_), GTK_OVERFLOW_HIDDEN);
  set_fit(ImageFit::Cover);
  g_signal_connect(widget(), "notify::scale-factor", G_CALLBACK(+[](GtkWidget *, GParamSpec *, Image *image) {
    if (!image->asset_name_.empty()) image->load_asset(image->asset_name_);
  }), this);
}

Image::~Image() {
  if (load_cancellable_) {
    g_cancellable_cancel(load_cancellable_);
    g_clear_object(&load_cancellable_);
  }
  if (picture_) g_object_set_data(G_OBJECT(picture_), "weft-load", nullptr);
}

void Image::set_src(std::string_view src) {
  if (load_cancellable_) {
    g_cancellable_cancel(load_cancellable_);
    g_clear_object(&load_cancellable_);
  }
  g_object_set_data(G_OBJECT(picture_), "weft-load", nullptr);
  if (src.starts_with("asset:")) {
    asset_name_.assign(src.substr(6));
    load_asset(asset_name_);
    return;
  }
  asset_name_.clear();
  picture_set_density(picture_, 1);
  if (src.empty()) {
    gtk_picture_set_paintable(picture_, nullptr);
    return;
  }
  if (!platform::is_http_url(src)) {
    gtk_picture_set_paintable(picture_, nullptr);
    return;
  }
  std::string source(src);
  if (auto *cached = textures().find(source)) {
    gtk_picture_set_paintable(picture_, GDK_PAINTABLE(cached));
    return;
  }
  gtk_picture_set_paintable(picture_, nullptr);
  load_cancellable_ = g_cancellable_new();
  auto load = std::make_unique<Load>();
  load->src = std::move(source);
  load->cancellable = G_CANCELLABLE(g_object_ref(load_cancellable_));
  g_weak_ref_init(&load->picture, picture_);
  g_object_set_data(G_OBJECT(picture_), "weft-load", load.get());
  SoupMessage *message = soup_message_new(SOUP_METHOD_GET, load->src.c_str());
  if (!message) {
    loaded(std::move(load), nullptr, g_error_new(G_IO_ERROR, G_IO_ERROR_INVALID_ARGUMENT, "invalid URL"));
    return;
  }
  GCancellable *cancellable = load->cancellable;
  soup_session_send_async(
      images_session(), message, G_PRIORITY_LOW, cancellable,
      [](GObject *session, GAsyncResult *result, gpointer data) {
        std::unique_ptr<Load> load(static_cast<Load *>(data));
        GError *error = nullptr;
        GInputStream *stream = soup_session_send_finish(SOUP_SESSION(session), result, &error);
        if (!stream) {
          loaded(std::move(load), nullptr, error);
          return;
        }
        auto *message = soup_session_get_async_result_message(SOUP_SESSION(session), result);
        if (!SOUP_STATUS_IS_SUCCESSFUL(soup_message_get_status(message))) {
          g_object_unref(stream);
          loaded(std::move(load), nullptr,
                 g_error_new(G_IO_ERROR, G_IO_ERROR_FAILED, "HTTP %u", soup_message_get_status(message)));
          return;
        }
        auto content_len = soup_message_headers_get_content_length(soup_message_get_response_headers(message));
        if (content_len > goffset(platform::kMaxImageBytes)) {
          g_object_unref(stream);
          loaded(std::move(load), nullptr,
                 g_error_new(G_IO_ERROR, G_IO_ERROR_FAILED, "image exceeds 16 MiB limit"));
          return;
        }
        read_image_chunk(stream, std::move(load));
        g_object_unref(stream);
      },
      load.release());
  g_object_unref(message);
}

void Image::load_asset(std::string_view name) {
  const int scale = gtk_widget_get_scale_factor(widget());
  auto asset = find_asset(asset_directory(), name, scale);
  picture_set_density(picture_, asset ? asset->density : 1);
  g_autoptr(GError) error = nullptr;
  if (asset) {
    if (asset->path.ends_with(".svg")) {
      g_autoptr(GdkPaintable) svg = svg_paintable(asset->path.c_str(), scale, &error);
      if (svg) {
        gtk_picture_set_paintable(picture_, svg);
        return;
      }
    } else {
      auto &cache = textures();
      if (auto *cached = cache.find(asset->path)) {
        gtk_picture_set_paintable(picture_, GDK_PAINTABLE(cached));
        return;
      }
      g_autoptr(GdkTexture) texture = gdk_texture_new_from_filename(asset->path.c_str(), &error);
      if (texture) {
        gtk_picture_set_paintable(picture_, GDK_PAINTABLE(texture));
        cache.insert(std::move(asset->path), texture);
        return;
      }
    }
  }
  gtk_picture_set_paintable(picture_, nullptr);
#ifndef NDEBUG
  std::fprintf(stderr, "[weft warn] weft: cannot load asset:%.*s (%s)\n", int(name.size()), name.data(),
               error ? error->message : "asset not found");
#endif
}

void Image::set_fit(ImageFit fit) {
  switch (fit) {
    case ImageFit::Cover: gtk_picture_set_content_fit(picture_, GTK_CONTENT_FIT_COVER); break;
    case ImageFit::Contain: gtk_picture_set_content_fit(picture_, GTK_CONTENT_FIT_CONTAIN); break;
    case ImageFit::Fill: gtk_picture_set_content_fit(picture_, GTK_CONTENT_FIT_FILL); break;
  }
}

void Image::set_placeholder(Color color) {
  placeholder_ = color;
  widget_style(widget()).placeholder = color.resolve();
  gtk_widget_queue_draw(widget());
}

void Image::reapply_colors() {
  Decorated::reapply_colors();
  if (placeholder_.is_token()) set_placeholder(placeholder_);
}

}  // namespace weft
