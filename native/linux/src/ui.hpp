#pragma once

#include "platform.hpp"
#include <gtk/gtk.h>
#include <deque>
#include <memory>

namespace weft::platform {

struct UiOptions {
  std::string title, message, confirm_text = "OK", cancel_text = "Cancel", icon = "none", duration = "short";
  std::vector<std::string> options;
  int destructive_index = -1;
  bool destructive = false;
};
UiOptions parse_ui(std::string_view method, const std::vector<uint8_t> &args);
std::vector<uint8_t> ui_result(std::string_view method, int choice);

class Ui : public std::enable_shared_from_this<Ui> {
 public:
  explicit Ui(GtkWidget *overlay);
  ~Ui();
  void call(std::string method, std::vector<uint8_t> args, GCancellable *cancellable, Done done);
  void close();
 private:
  struct Request { std::string method; UiOptions options; Done done; };
  void next();
  void toast(const UiOptions &options);
  GtkWidget *overlay_;
  GtkWidget *revealer_;
  GtkWidget *toast_label_;
  GCancellable *cancel_;
  std::deque<Request> queue_;
  guint idle_ = 0, timer_ = 0;
  bool active_ = false, closed_ = false;
};
}
