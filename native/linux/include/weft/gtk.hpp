// Linux shell of Weft: GTK 4 widgets driven by the native kernel's ops
// (protocol/SPEC.md). The generated views (weft/Generated.cpp) subclass
// `Scope` per template and build their widgets from the element wrappers; the
// app calls `start_app()` for its root widget.
//
// Everything runs on the GTK main thread: the kernel's callbacks, timers
// and completed platform calls all arrive on the default main context.

#pragma once

#include <gtk/gtk.h>
#include <weft/elements.hpp>
#include <weft/ops.hpp>

#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <unordered_map>
#include <variant>
#include <vector>

#include <weft/runtime.h>

namespace weft {
namespace platform { class Ui; }

class Scope;
class Session;
struct Point;

/// Implemented by the generated views: starts the app compiled to
/// `weft/bundle.hbc` next to the executable and returns its root widget,
/// a vertical container that shows the app or its startup error.
GtkWidget *start_app();

// Values of value slots.

/// Reads an `Int` or `Float` slot.
double number(const ops::Value &value);
bool boolean(const ops::Value &value);
std::string_view string(const ops::Value &value);
/// Borrows the list for the duration of the current ops batch.
ops::StringList strings(const ops::Value &value);

namespace theme {

struct Entry {
  std::string_view name;
  uint32_t light;
  uint32_t dark;
};

/// Registers the generated static theme table before starting a session.
void set(std::span<const Entry> entries);

}  // namespace theme

/// Either a fixed `0xRRGGBBAA` color or a reference to a static theme entry.
class Color {
 public:
  static constexpr Color rgba(uint32_t value) { return Color(value); }
  static Color token(std::string_view name);

  /// Parses `#RGB`, `#RRGGBB`, `#RRGGBBAA`, or `@token`.
  /// Invalid colors and unknown tokens are transparent and warn in debug builds.
  static Color parse(std::string_view text);

  bool is_token() const { return std::holds_alternative<const theme::Entry *>(value_); }
  GdkRGBA resolve() const;
  GdkRGBA resolve(bool dark) const;

 private:
  explicit constexpr Color(uint32_t value) : value_(value) {}
  explicit Color(const theme::Entry *entry) : value_(entry) {}

  std::variant<uint32_t, const theme::Entry *> value_;
};

/// Reads a `Color` value slot.
Color color(const ops::Value &value);

enum class Edge;
struct WidgetLayout;

/// A built-in element: owns a reference to its widget. Properties never set
/// keep the platform's defaults; lengths are logical pixels.
class Element {
 public:
  Element(const Element &) = delete;
  Element &operator=(const Element &) = delete;
  virtual ~Element();

  GtkWidget *widget() const { return widget_; }
  virtual void reapply_colors() {}

  /// Installs the element's activation handler before it is mounted.
  void set_on_tap(std::function<void()> action);
  void set_opacity(double opacity);
  void set_hidden(bool hidden);
  void set_width(double width);
  void set_height(double height);
  void set_min_width(double min_width);
  void set_max_width(double max_width);
  void set_min_height(double min_height);
  void set_max_height(double max_height);
  void set_aspect_ratio(double aspect_ratio);
  void set_grow(double grow);
  void set_fill(bool fill);
  void set_margin(double margin);
  void set_margin_x(double margin_x);
  void set_margin_y(double margin_y);
  void set_margin_top(double margin_top);
  void set_margin_bottom(double margin_bottom);
  void set_margin_start(double margin_start);
  void set_margin_end(double margin_end);

 protected:
  /// Takes the widget's floating reference.
  explicit Element(GtkWidget *widget);
  WidgetLayout &layout() const { return layout_; }

 private:
  struct Tap;
  void apply_opacity();
  void set_margin_edge(Edge edge, double value);

  GtkWidget *widget_;
  WidgetLayout &layout_;
  double opacity_ = 1;
  std::unique_ptr<Tap> tap_;
};

/// An ordered run of sibling nodes: the children of a stack, or the
/// top-level nodes of a scope. Mount points are placeholders replaced by the
/// widgets of their child scopes, so a scope with top-level points has no
/// fixed number of widgets; it renders into the stack of the region it is
/// mounted in, at the position its point has there.
class Region {
 public:
  /// The children of a linear or overlay layout widget.
  explicit Region(GtkWidget *container) : container_(container) {}
  /// The top-level nodes of `scope`.
  explicit Region(Scope &scope) : scope_(&scope) {}
  Region(const Region &) = delete;
  Region &operator=(const Region &) = delete;

  /// Appends a static element.
  void add(const Element &element);
  /// Appends mount point `index` of `owner`.
  void point(Scope &owner, size_t index);

 private:
  friend struct Point;
  friend class Scope;

  /// A widget, or a mount point when `point` is set.
  struct Part {
    GtkWidget *widget;
    Point *point;
  };

  size_t count() const;
  void collect(std::vector<GtkWidget *> &widgets) const;
  size_t offset(const Point &point) const;
  void insert(size_t index, GtkWidget *widget);
  void remove(size_t index, size_t count);
  /// The stack region holding `point`'s widgets and their index there, or
  /// false while the scope holding it is not mounted.
  static bool locate(const Point &point, Region *&container, size_t &index);

  std::vector<Part> parts_;
  GtkWidget *container_ = nullptr;
  Scope *scope_ = nullptr;
};

/// An element whose WeftWidget paints its own decoration.
class Decorated : public Element {
 public:
  void set_background(Color color);
  void set_radius(double radius);
  void set_border(double border);
  void set_border_color(Color color);
  void set_shadow(Shadow shadow);
  void set_clip(bool clip);
  void reapply_colors() override;

 protected:
  explicit Decorated(GtkWidget *widget) : Element(widget) {}

 private:
  void resolve_border_color();

  Color background_ = Color::rgba(0);
  std::optional<Color> border_color_;
};

/// Element with schema padding, which may live inside a scroll viewport.
class Padded : public Decorated {
 public:
  void set_padding(double padding);
  void set_padding_x(double padding_x);
  void set_padding_y(double padding_y);
  void set_padding_top(double padding_top);
  void set_padding_bottom(double padding_bottom);
  void set_padding_start(double padding_start);
  void set_padding_end(double padding_end);

 protected:
  explicit Padded(GtkWidget *widget, GtkWidget *content = nullptr);

 private:
  void set_padding_edge(Edge edge, double value);
};

/// `Column` / `Row`: a vertical or horizontal linear layout.
class Linear final : public Padded {
 public:
  explicit Linear(Axis axis, CrossAlign align = CrossAlign::Start);

  Region &children() { return children_; }

  void set_gap(double gap);
  void set_align(CrossAlign align);
  void set_justify(Justify justify);

 private:
  Region children_;
};

/// `Stack`: overlays children in paint order.
class Stack final : public Padded {
 public:
  Stack();
  Region &children() { return children_; }
  void set_alignment(Alignment alignment);

 private:
  Region children_;
};

/// `Scroll`: a linear layout inside a single-axis GTK scroll viewport.
class Scroll final : public Padded {
 public:
  explicit Scroll(Axis direction = Axis::Vertical);
  Region &children() { return children_; }
  void set_gap(double gap);
  void set_align(CrossAlign align);
  void set_indicators(bool indicators);

 private:
  Scroll(Axis direction, GtkWidget *content);

  Axis direction_;
  GtkScrolledWindow *scroll_;
  GtkWidget *content_;
  Region children_;
};

/// `Spacer`: empty space on the main axis, flexible until `size` is set.
class Spacer final : public Element {
 public:
  Spacer();
  void set_size(double size);
};

/// `Text`: a `GtkLabel` styled with Pango attributes.
class Text final : public Padded {
  struct Style {
    std::optional<Color> color;
    std::string font;
    std::optional<int> size;
    std::optional<Weight> weight;
    std::optional<bool> italic;
    std::optional<Decoration> decoration;

    void apply(PangoAttrList *attributes, const Style &inherited, guint start, guint end) const;
  };

 public:
  /// A styled UTF-8 run owned by its Text, with no widget of its own.
  class Span {
   public:
    explicit Span(Text &text) : text_(text) {}

    void set_value(std::string_view value);
    void set_color(Color color);
    void set_font(std::string_view font);
    void set_size(double size);
    void set_weight(Weight weight);
    void set_italic(bool italic);
    void set_decoration(Decoration decoration);

   private:
    friend class Text;
    void restyle();

    Text &text_;
    std::string value_;
    Style style_;
  };

  explicit Text(size_t span_count = 0);
  ~Text() override;
  Span &span(size_t index) { return spans_[index]; }

  void set_value(std::string_view value);
  void set_color(Color color);
  void set_font(std::string_view font);
  void set_size(double size);
  void set_weight(Weight weight);
  void set_italic(bool italic);
  void set_decoration(Decoration decoration);
  void set_align(TextAlign align);
  void set_max_lines(double lines);
  void set_line_height(double height);
  void reapply_colors() override;

 private:
  friend struct TextLayout;
  void show_value();
  void join_spans();
  void restyle();
  PangoLayout *source_layout() const;
  void clip_paragraphs(PangoLayout *layout, int width);

  GtkLabel *label_;
  std::vector<Span> spans_;
  std::string value_;
  Style style_;
  std::optional<int> line_height_;
  int max_lines_ = -1;
  int clipped_width_ = -1;
  int clipped_height_ = 0;
  guint clipped_context_ = 0;
  std::string clipped_value_;
  bool limit_paragraphs_ = false;
};

/// `Button`: a `GtkButton` whose content is a horizontal stack of its children.
class Button final : public Element {
 public:
  explicit Button(std::function<void()> click);

  Region &children() { return content_.children(); }

  void set_disabled(bool disabled);

 private:
  static void clicked(GtkButton *button, Button *self);

  std::function<void()> click_;
  Linear content_;
};

// Controlled inputs. The widget reports every user edit
// through `edit`, which dispatches it synchronously; when the app refuses it
// (`edit` returns false) the widget shows its value slot again. Values written
// by `set` ops are recognized by comparing with the slot, so they are never
// reported back. Text being composed by an input method is not reported, so
// it is never rolled back mid-composition; the committed text is.

/// Common focus requests and edit limits for GTK text controls.
class TextControl : public Element {
 public:
  ~TextControl() override;
  void set_focused(bool focused);
  void set_max_length(double length) { max_length_ = length; }

 protected:
  explicit TextControl(GtkWidget *widget, std::function<void(bool)> focus);
  void set_focus_target(GtkWidget *target);
  std::string_view limit_edit(std::string_view text) const;

 private:
  void cancel_pending_focus();
  static void mapped(GtkWidget *target, TextControl *self);
  static void entered(GtkEventControllerFocus *controller, TextControl *self);
  static void left(GtkEventControllerFocus *controller, TextControl *self);

  std::function<void(bool)> focus_;
  GtkWidget *focus_target_ = nullptr;
  GtkEventController *focus_controller_ = nullptr;
  gulong pending_focus_ = 0;
  double max_length_ = -1;
  bool focused_ = false;
};

/// `Input`: a `GtkEntry`, 200 px wide (CSS inputs default to about 20 characters).
class Input final : public TextControl {
 public:
  explicit Input(std::function<bool(std::string_view)> edit, std::function<void()> submit = {},
                 std::function<void(bool)> focus = {});
  ~Input() override;

  /// The controlled value slot.
  void set_value(std::string_view value);
  void set_placeholder(std::string_view placeholder);
  void set_disabled(bool disabled);
  void set_type(InputType type);

 private:
  static void activated(GtkEntry *entry, Input *self);
  static void changed(GtkEditable *editable, Input *self);
  static void preedit_changed(GtkText *text, const char *preedit, Input *self);
  void edited();
  /// Replaces the text, keeping the caret where it was as far as the new text allows.
  void show(const std::string &text);

  std::function<bool(std::string_view)> edit_;
  std::function<void()> submit_;
  std::string value_;
  bool composing_ = false;
  /// Whether `show` is replacing the text.
  bool showing_ = false;
};

/// `Checkbox`: a `GtkCheckButton` without a label.
class Checkbox final : public Element {
 public:
  explicit Checkbox(std::function<bool(bool)> edit);

  /// The controlled value slot.
  void set_checked(bool checked);
  void set_disabled(bool disabled);

 private:
  static void toggled(GtkCheckButton *button, Checkbox *self);

  std::function<bool(bool)> edit_;
  bool value_ = false;
};

/// `Switch`: a `GtkSwitch` whose state follows the controlled slot.
class Switch final : public Element {
 public:
  explicit Switch(std::function<bool(bool)> edit);
  void set_checked(bool checked);
  void set_disabled(bool disabled);

 private:
  static gboolean state_set(GtkSwitch *button, gboolean active, Switch *self);

  std::function<bool(bool)> edit_;
  bool value_ = false;
};

/// `TextArea`: a wrapping `GtkTextView` with a three-line scroll viewport.
class TextArea final : public TextControl {
 public:
  explicit TextArea(std::function<bool(std::string_view)> edit, std::function<void(bool)> focus = {});
  ~TextArea() override;
  void set_value(std::string_view value);
  void set_placeholder(std::string_view placeholder);
  void set_disabled(bool disabled);

 private:
  static void changed(GtkTextBuffer *buffer, TextArea *self);
  static void begin_edit(GtkTextBuffer *buffer, TextArea *self);
  static void end_edit(GtkTextBuffer *buffer, TextArea *self);
  static void preedit_changed(GtkTextView *view, const char *preedit, TextArea *self);
  void edited();
  void show();
  void update_placeholder();

  std::function<bool(std::string_view)> edit_;
  GtkTextView *view_;
  GtkTextBuffer *buffer_;
  GtkWidget *placeholder_;
  std::string value_;
  bool composing_ = false;
  bool editing_ = false;
  bool showing_ = false;
};

/// `Slider`: a `GtkScale` snapping edits to integer increments from `min`.
class Slider final : public Element {
 public:
  explicit Slider(std::function<bool(double)> edit);
  void set_value(double value);
  void set_min(double min);
  void set_max(double max);
  void set_step(double step);
  void set_disabled(bool disabled);

 private:
  static void changed(GtkRange *range, Slider *self);
  double snap(double value) const;
  void sync_range();
  void show(double value);

  static constexpr double kMin = 0, kMax = 100, kStep = 1;
  std::function<bool(double)> edit_;
  double value_ = kMin;
  double min_ = kMin;
  double max_ = kMax;
  double step_ = kStep;
  bool showing_ = false;
};

/// `Picker`: a `GtkMenuButton` with one popover button per option.
class Picker final : public Element {
 public:
  explicit Picker(std::function<bool(double)> edit);
  ~Picker() override;
  void set_selected(double selected);
  void set_options(ops::StringList options);
  void set_placeholder(std::string_view placeholder);
  void set_disabled(bool disabled);

 private:
  static void clicked(GtkButton *button, Picker *self);
  void clear_options();
  void show();

  std::function<bool(double)> edit_;
  GtkWidget *options_box_;
  GtkLabel *label_;
  std::vector<GtkButton *> options_;
  std::string placeholder_;
  double selected_ = -1;
};

/// `Spinner`: a rotating three-quarter ring, 20 logical pixels by default.
class Spinner final : public Element {
 public:
  Spinner();
  void set_color(Color color);
  void reapply_colors() override;

 private:
  std::optional<Color> color_;
};

/// `Progress`: a four-pixel track with a fill proportional to `value`.
class Progress final : public Element {
 public:
  Progress();
  void set_value(double value);
  void set_color(Color color);
  void reapply_colors() override;

 private:
  Color color_ = Color::rgba(0x007affff);
};

/// `Divider`: a native separator or a solid one-pixel line when tinted.
class Divider final : public Element {
 public:
  explicit Divider(bool vertical = false);
  void set_color(Color color);
  void reapply_colors() override;

 private:
  std::optional<Color> color_;
};

/// `Image`: a `GtkPicture` of a bundled, remote or local image. With one
/// fixed side the other follows the aspect ratio; with neither it uses the
/// image's intrinsic logical size.
class Image final : public Decorated {
 public:
  Image();
  ~Image() override;

  void set_src(std::string_view src);
  void set_fit(ImageFit fit);
  void set_placeholder(Color color);
  void reapply_colors() override;

 private:
  void load_asset(std::string_view name);

  GtkPicture *picture_;
  GCancellable *load_cancellable_ = nullptr;
  std::string asset_name_;
  Color placeholder_ = Color::rgba(0);
};

class BarButton final : public Element {
 public:
  explicit BarButton(std::function<void()> action);
  void set_label(std::string_view label);
  void set_icon(std::string_view icon);
  void set_disabled(bool disabled);
 private:
  void update();
  std::string label_;
  std::string icon_;
  std::function<void()> action_;
};

class NavBar final : public Element {
 public:
  NavBar();
  void set_title(std::string_view title);
  void set_hidden(bool hidden);
  void add(BarButton &button);
  void set_back(GtkWidget *button);
 private:
  GtkWidget *title_;
  GtkWidget *actions_;
};

/// One template instance of the view protocol. The generated views subclass
/// it per template: the constructor creates the template's elements and
/// places them into `roots()` and the regions of stacks, and `apply` writes
/// value slots to them.
class Scope {
 public:
  Scope(uint32_t id, Session &session, size_t points = 0);
  Scope(const Scope &) = delete;
  Scope &operator=(const Scope &) = delete;
  virtual ~Scope();

  /// Scope id assigned by the JS logic layer.
  uint32_t id() const { return id_; }

  /// Writes value slot `slot` (a `set` op).
  virtual void apply(uint32_t slot, const ops::Value &value);

 protected:
  /// The template's top-level nodes; they render into the region the scope is mounted in.
  Region &roots() { return roots_; }
  void init_page();
  void set_page_bar(NavBar &bar);

  /// Creates an element that lives as long as the scope.
  template <class T, class... Args>
  T &make(Args &&...args) {
    auto element = std::make_unique<T>(std::forward<Args>(args)...);
    T &made = *element;
    elements_.push_back(std::move(element));
    return made;
  }

  /// Reports that event slot `slot` fired. The handler runs and its ops are
  /// applied before this returns; false means a controlled edit was refused
  /// and the widget must show its value slot again.
  bool dispatch(uint32_t slot);
  bool dispatch(uint32_t slot, bool value);
  bool dispatch(uint32_t slot, double value);
  bool dispatch(uint32_t slot, std::string_view value);
  /// Reports a focus change after GTK and the current ops batch finish.
  void dispatch_focus(uint32_t slot, bool focused);

 private:
  friend class Region;
  friend struct Point;
  friend class Session;

  uint32_t id_;
  Session &session_;
  Region roots_;
  GtkWidget *page_widget_ = nullptr;
  GtkWidget *page_header_ = nullptr;
  GtkWidget *back_button_ = nullptr;
  /// Mount points by index, registered by `Region::point`.
  std::vector<std::unique_ptr<Point>> points_;
  /// The point the scope is mounted at, if any.
  Point *parent_ = nullptr;
  std::vector<std::unique_ptr<Element>> elements_;
};

/// One Weft app running in the native kernel: owns the kernel runtime and
/// the scope tree its ops build. It lives as long as the root widget of
/// `start`.
class Session {
 public:
  /// Creates the scope of template `tpl` for a `create` op, or null for an unknown template.
  using Factory = std::unique_ptr<Scope> (*)(uint32_t tpl, uint32_t id, Session &session);

  /// Starts the app compiled to `weft/bundle.hbc` next to the executable,
  /// whose views implement the layout with hash `layout_hash`; see `start_app`.
  /// GTK has no safe-area insets, so `safe_area` does not affect the root layout.
  static GtkWidget *start(uint64_t layout_hash, bool safe_area, Factory make, bool app = false);

  Session(const Session &) = delete;
  Session &operator=(const Session &) = delete;
  ~Session();

  /// Reports event slot `slot` of `scope` with an encoded payload; see `Scope::dispatch`.
  bool dispatch(uint32_t scope, uint32_t slot, const std::string &payload);

  /// Requests the half-open item window of a lazy mount point.
  void window(uint32_t scope, uint32_t point, uint32_t start, uint32_t end);
  /// Delivers a host signal with a UTF-8 JSON payload.
  void signal(const std::string &name, std::string_view json);

 private:
  friend class Scope;
  friend class NavigationTest;

  Session(GtkWidget *page, Factory make, bool app);
  void navigate(const ops::Nav &nav);
  bool back();
  void open(const std::string &bundle, uint64_t layout_hash);
  void queue_environment();
  void queue_focus(uint32_t scope, uint32_t slot, bool focused);
  struct Environment;
  struct FocusEvent {
    uint32_t scope;
    uint32_t slot;
    bool focused;
  };
  void commit(const uint8_t *ops, size_t len);
  void apply(const ops::Op &op);
  void mount(uint32_t parent, uint32_t index, std::vector<uint32_t> ids);
  void destroy(Scope &scope);
  void schedule(uint64_t delay_ms);
  void call(uint32_t id, std::string module, std::string method, std::vector<uint8_t> args);
  void resolve(uint32_t id, bool ok, const std::vector<uint8_t> &result);
  /// Shows `message` instead of the app's views.
  void fail(const std::string &message);

  static void on_commit(void *ctx, const uint8_t *ops, size_t len);
  static void on_schedule(void *ctx, uint64_t delay_ms);
  static bool on_supports(void *ctx, const char *module);
  static void on_call(void *ctx, uint32_t id, const char *module, const char *method, const uint8_t *args,
                      size_t len);
  static void on_log(void *ctx, int level, const char *msg, size_t len);

  Factory make_;
  GtkWidget *page_;
  GtkWidget *stack_widget_ = nullptr;
  uint32_t nav_tab_ = 0;
  std::vector<uint32_t> nav_tabs_;
  std::vector<uint32_t> nav_stack_;
  std::unique_ptr<Environment> environment_;
  std::shared_ptr<platform::Ui> ui_;
  std::unordered_map<uint32_t, std::unique_ptr<Scope>> scopes_;
  /// Destroyed scopes, freed once the main loop is idle: a widget's signal
  /// handler may still run code of the scope that its event destroyed.
  std::vector<std::unique_ptr<Scope>> dead_;
  guint sweep_ = 0;
  std::vector<FocusEvent> focus_events_;
  guint focus_idle_ = 0;
  /// The pending tick and when it fires, in monotonic milliseconds.
  guint timer_ = 0;
  int64_t due_ = 0;
  /// Whether a batch of ops is being applied; the kernel is not reentrant.
  bool committing_ = false;
  bool failed_ = false;
  /// The last error the kernel logged: why `weft_runtime_new` failed.
  std::string last_error_;
  /// Cancels the platform calls in flight when the session ends.
  GCancellable *cancellable_;
  /// The bytecode, page aligned, alive as long as the runtime.
  GMappedFile *bytecode_ = nullptr;
  weft_runtime *runtime_ = nullptr;
};

}  // namespace weft
