// Mount points of scopes.

#pragma once

#include <vector>

#include "weft/gtk.hpp"

namespace weft {

/// A mount point: where the widgets of its child scopes are placed.
struct Point {
  explicit Point(Region &region) : region(region) {}

  /// Number of widgets the children render.
  size_t count() const;
  /// Number of widgets before `child` at this point.
  size_t offset(const Scope &child) const;

  /// Replaces the children (`branch`, `rows` and `attach` ops). Children kept
  /// in the same relative order (the longest such run, from the kernel's
  /// `weft_stable_rows`) keep their widgets in place; the rest are moved,
  /// inserted or removed, so focused widgets in unmoved rows stay focused.
  void mount(std::vector<Scope *> next);

  Region &region;
  List *list = nullptr;
  /// The mounted scopes, in order.
  std::vector<Scope *> children;
};

}  // namespace weft
