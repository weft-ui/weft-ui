// Decoder and text form of view protocol ops
// (protocol/SPEC.md, "Binary encoding"), for C++ shells and
// the kernel's tests. Strings, string lists and row lists borrow the batch,
// which is only valid during `weft_host.commit`.

#pragma once

#include <cstddef>
#include <cstdint>
#include <iterator>
#include <stdexcept>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

#include "weft/protocol.hpp"

namespace weft::ops {

/// A validated string list borrowing the length-prefixed strings from the batch.
struct StringList {
  const uint8_t *data;
  uint32_t count;

  class Iterator {
   public:
    using iterator_category = std::forward_iterator_tag;
    using value_type = std::string_view;
    using difference_type = std::ptrdiff_t;

    Iterator() = default;
    value_type operator*() const;
    Iterator &operator++();
    Iterator operator++(int);
    bool operator==(const Iterator &) const = default;

   private:
    friend struct StringList;
    Iterator(const uint8_t *data, uint32_t count) : at_(count ? data : nullptr), remaining_(count) {}

    const uint8_t *at_ = nullptr;
    uint32_t remaining_ = 0;
  };

  Iterator begin() const { return Iterator(data, count); }
  Iterator end() const { return {}; }
  bool operator==(const StringList &other) const;
};

/// A slot value; `Int` slots carry a double like every number.
using Value = std::variant<bool, double, std::string_view, StringList>;

/// A malformed batch or value.
class Error : public std::runtime_error {
 public:
  /// The decoding error kinds of protocol/SPEC.md
  /// ("Decoding errors").
  enum class Kind { Truncated, Version, Opcode, Tag, Utf8 };

  Error(Kind kind, const std::string &what) : std::runtime_error(what), kind_(kind) {}

  Kind kind() const { return kind_; }

 private:
  Kind kind_;
};

/// Fixed-width little-endian records borrowed from a validated batch.
template <typename T, size_t Width>
struct ListView {
  const uint8_t *data = nullptr;
  uint32_t count = 0;
  struct Iterator {
    using iterator_category = std::forward_iterator_tag;
    using value_type = T;
    using difference_type = std::ptrdiff_t;
    const uint8_t *at = nullptr;
    T operator*() const;
    Iterator &operator++() { at += Width; return *this; }
    Iterator operator++(int) { auto old = *this; ++*this; return old; }
    bool operator==(const Iterator &) const = default;
  };
  Iterator begin() const { return {data}; }
  Iterator end() const { return {count ? data + size_t(count) * Width : data}; }
};

struct Item { uint32_t item, template_index; };
using ItemList = ListView<Item, 8>;
using ScopeList = ListView<uint32_t, 4>;
struct Splice { uint32_t index = 0, remove = 0; ItemList items; };
struct Bind { uint32_t item = 0, child = 0; };
struct Nav { uint32_t tab = 0; ScopeList tabs, stack; uint32_t modal = 0, style = 0; };

template <> uint32_t ScopeList::Iterator::operator*() const;
template <> Item ItemList::Iterator::operator*() const;

struct Op {
  protocol::Code code{};
  uint32_t scope = 0;
  /// The template (`create`), value slot (`set`) or mount point (other ops).
  uint32_t index = 0;
  /// The child scope of `branch` (0 for none) and `attach`.
  uint32_t child = 0;
  /// The value of `set`.
  Value value;
  /// The children of `rows`: `count` little-endian u32 scope ids.
  const uint8_t *rows = nullptr;
  uint32_t count = 0;
  Splice splice;
  Bind bind;
  Nav nav;

  /// Child `i` of a `rows` op.
  uint32_t row(uint32_t i) const;
};

/// Reads the ops of one batch in order.
class Reader {
 public:
  /// Throws `Error` on an empty batch (`Truncated`) or an unsupported version.
  Reader(const uint8_t *data, size_t len);

  /// Reads the next op into `op`; returns false at the end of the batch.
  /// Throws `Error` on an unknown opcode or value tag, truncated input or
  /// invalid UTF-8.
  bool next(Op &op);

 private:
  const uint8_t *at_;
  const uint8_t *end_;
};

/// Decodes the whole batch, throwing `Error` if any op is malformed.
/// The result borrows the input buffer for strings, string lists and `rows` children and
/// is valid only while the buffer remains alive.
std::vector<Op> read_all(const uint8_t *data, size_t len);

/// Reads one encoded value (a tag byte and its data), advancing `at`.
Value read_value(const uint8_t *&at, const uint8_t *end);

/// Appends the encoding of `value` (a tag byte and its data) to `out`.
void encode_value(const Value &value, std::string &out);

/// A boolean, the number as JavaScript prints it, a JSON string, or a JSON string array.
std::string format_value(const Value &value);

/// The one-line text form, e.g. `set 3 0 "milk"` or `rows 2 0 [4 5]`.
std::string format(const Op &op);

}  // namespace weft::ops
