#include "weft/ops.hpp"

#include <algorithm>
#include <bit>
#include <charconv>
#include <cmath>
#include <limits>
#include <string>

namespace weft::ops {
namespace {

uint32_t load_u32(const uint8_t *p) {
  return uint32_t(p[0]) | uint32_t(p[1]) << 8 | uint32_t(p[2]) << 16 | uint32_t(p[3]) << 24;
}

void need(const uint8_t *at, const uint8_t *end, size_t size) {
  if (size_t(end - at) < size) throw Error(Error::Kind::Truncated, "weft ops: truncated batch");
}

void put_u32(uint32_t value, std::string &out) {
  for (int shift = 0; shift < 32; shift += 8) out.push_back(char(value >> shift & 0xff));
}

uint32_t take_u32(const uint8_t *&at, const uint8_t *end) {
  need(at, end, 4);
  uint32_t value = load_u32(at);
  at += 4;
  return value;
}

/// Whether `text` is well-formed UTF-8 (no overlongs, surrogates or code points past U+10FFFF).
bool valid_utf8(std::string_view text) {
  auto *p = reinterpret_cast<const unsigned char *>(text.data());
  auto *end = p + text.size();
  while (p < end) {
    unsigned char c = *p++;
    if (c < 0x80) continue;
    int more;
    unsigned char lo = 0x80, hi = 0xbf;
    if (c >= 0xc2 && c <= 0xdf) {
      more = 1;
    } else if (c >= 0xe0 && c <= 0xef) {
      more = 2;
      if (c == 0xe0) lo = 0xa0;
      if (c == 0xed) hi = 0x9f;
    } else if (c >= 0xf0 && c <= 0xf4) {
      more = 3;
      if (c == 0xf0) lo = 0x90;
      if (c == 0xf4) hi = 0x8f;
    } else {
      return false;
    }
    for (; more > 0; more--, lo = 0x80, hi = 0xbf) {
      if (p == end || *p < lo || *p > hi) return false;
      p++;
    }
  }
  return true;
}

/// ECMAScript Number::toString(10).
std::string js_number(double value) {
  if (std::isnan(value)) return "NaN";
  if (std::isinf(value)) return value < 0 ? "-Infinity" : "Infinity";
  if (value == 0) return "0";
  std::string out;
  if (value < 0) {
    out += '-';
    value = -value;
  }
  // The shortest round-trip digits, as "d.ddde+x".
  char buf[32];
  auto [end, ec] = std::to_chars(buf, buf + sizeof buf, value, std::chars_format::scientific);
  std::string_view sci(buf, size_t(end - buf));
  size_t e = sci.find('e');
  std::string digits;
  for (char c : sci.substr(0, e)) {
    if (c != '.') digits += c;
  }
  int exponent = 0;
  std::string_view exp = sci.substr(e + 1);
  if (exp.front() == '+') exp.remove_prefix(1);
  std::from_chars(exp.data(), exp.data() + exp.size(), exponent);
  int k = int(digits.size());
  int n = exponent + 1;
  if (k <= n && n <= 21) {
    out += digits;
    out.append(size_t(n - k), '0');
  } else if (0 < n && n <= 21) {
    out += digits.substr(0, size_t(n));
    out += '.';
    out += digits.substr(size_t(n));
  } else if (-6 < n && n <= 0) {
    out += "0.";
    out.append(size_t(-n), '0');
    out += digits;
  } else {
    out += digits[0];
    if (k > 1) {
      out += '.';
      out += digits.substr(1);
    }
    out += 'e';
    out += n - 1 < 0 ? '-' : '+';
    out += std::to_string(std::abs(n - 1));
  }
  return out;
}

/// Appends the JSON.stringify form of a string.
void append_json_string(std::string_view text, std::string &out) {
  static constexpr char kHex[] = "0123456789abcdef";
  out += '"';
  for (char c : text) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\b': out += "\\b"; break;
      case '\f': out += "\\f"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (static_cast<unsigned char>(c) < 0x20) {
          out += "\\u00";
          out += kHex[(c >> 4) & 0xf];
          out += kHex[c & 0xf];
        } else {
          out += c;
        }
    }
  }
  out += '"';
}

std::string_view take_string(const uint8_t *&at, const uint8_t *end) {
  uint32_t len = take_u32(at, end);
  need(at, end, len);
  std::string_view text(reinterpret_cast<const char *>(at), len);
  if (!valid_utf8(text)) throw Error(Error::Kind::Utf8, "weft ops: invalid UTF-8 in a string value");
  at += len;
  return text;
}

}  // namespace

std::string_view StringList::Iterator::operator*() const {
  return {reinterpret_cast<const char *>(at_ + 4), load_u32(at_)};
}

StringList::Iterator &StringList::Iterator::operator++() {
  at_ = --remaining_ ? at_ + 4 + load_u32(at_) : nullptr;
  return *this;
}

StringList::Iterator StringList::Iterator::operator++(int) {
  auto previous = *this;
  ++*this;
  return previous;
}

bool StringList::operator==(const StringList &other) const {
  return count == other.count && (data == other.data || std::ranges::equal(*this, other));
}

template <> uint32_t ScopeList::Iterator::operator*() const { return load_u32(at); }
template <> Item ItemList::Iterator::operator*() const { return {load_u32(at), load_u32(at + 4)}; }

uint32_t Op::row(uint32_t i) const { return load_u32(rows + size_t(i) * 4); }

Reader::Reader(const uint8_t *data, size_t len) : at_(data), end_(data + len) {
  if (len == 0) throw Error(Error::Kind::Truncated, "weft ops: empty batch");
  if (*at_ != protocol::kVersion) {
    throw Error(Error::Kind::Version, "weft ops: unsupported version " + std::to_string(*at_));
  }
  at_++;
}

bool Reader::next(Op &op) {
  if (at_ == end_) return false;
  uint8_t code = *at_++;
  op = Op{};
  op.code = static_cast<protocol::Code>(code);
  switch (op.code) {
    case protocol::Code::Create:
      op.scope = take_u32(at_, end_);
      op.index = take_u32(at_, end_);
      return true;
    case protocol::Code::Set:
      op.scope = take_u32(at_, end_);
      op.index = take_u32(at_, end_);
      op.value = read_value(at_, end_);
      return true;
    case protocol::Code::Branch:
    case protocol::Code::Attach:
      op.scope = take_u32(at_, end_);
      op.index = take_u32(at_, end_);
      op.child = take_u32(at_, end_);
      return true;
    case protocol::Code::Splice: {
      op.scope = take_u32(at_, end_);
      op.index = take_u32(at_, end_);
      op.splice.index = take_u32(at_, end_);
      op.splice.remove = take_u32(at_, end_);
      op.splice.items.count = take_u32(at_, end_);
      if (op.splice.items.count > size_t(end_ - at_) / 8) throw Error(Error::Kind::Truncated, "weft ops: truncated batch");
      op.splice.items.data = at_;
      at_ += size_t(op.splice.items.count) * 8;
      return true;
    }
    case protocol::Code::Bind:
      op.scope = take_u32(at_, end_);
      op.index = take_u32(at_, end_);
      op.bind.item = take_u32(at_, end_);
      op.bind.child = take_u32(at_, end_);
      return true;
    case protocol::Code::Nav: {
      op.nav.tab = take_u32(at_, end_);
      auto list = [&](ScopeList &out) {
        out.count = take_u32(at_, end_);
        if (out.count > size_t(end_ - at_) / 4) throw Error(Error::Kind::Truncated, "weft ops: truncated batch");
        out.data = at_;
        at_ += size_t(out.count) * 4;
      };
      list(op.nav.tabs);
      list(op.nav.stack);
      op.nav.modal = take_u32(at_, end_);
      op.nav.style = take_u32(at_, end_);
      return true;
    }
    case protocol::Code::Rows: {
      op.scope = take_u32(at_, end_);
      op.index = take_u32(at_, end_);
      op.count = take_u32(at_, end_);
      if (size_t(op.count) > std::numeric_limits<size_t>::max() / 4) {
        throw Error(Error::Kind::Truncated, "weft ops: truncated batch");
      }
      size_t bytes = size_t(op.count) * 4;
      need(at_, end_, bytes);
      op.rows = at_;
      at_ += bytes;
      return true;
    }
  }
  throw Error(Error::Kind::Opcode, "weft ops: unknown opcode " + std::to_string(code));
}

std::vector<Op> read_all(const uint8_t *data, size_t len) {
  Reader reader(data, len);
  std::vector<Op> ops;
  for (Op op; reader.next(op);) ops.push_back(op);
  return ops;
}

Value read_value(const uint8_t *&at, const uint8_t *end) {
  need(at, end, 1);
  uint8_t tag = *at++;
  switch (static_cast<protocol::Tag>(tag)) {
    case protocol::Tag::False:
      return false;
    case protocol::Tag::True:
      return true;
    case protocol::Tag::Number: {
      need(at, end, 8);
      uint64_t bits = uint64_t(load_u32(at)) | uint64_t(load_u32(at + 4)) << 32;
      at += 8;
      return std::bit_cast<double>(bits);
    }
    case protocol::Tag::String:
      return take_string(at, end);
    case protocol::Tag::Strings: {
      uint32_t count = take_u32(at, end);
      if (count > size_t(end - at) / 4) throw Error(Error::Kind::Truncated, "weft ops: truncated batch");
      StringList strings{at, count};
      for (uint32_t i = 0; i < count; i++) take_string(at, end);
      return strings;
    }
    default:
      throw Error(Error::Kind::Tag, "weft ops: unknown value tag " + std::to_string(tag));
  }
}

void encode_value(const Value &value, std::string &out) {
  if (auto *flag = std::get_if<bool>(&value)) {
    out.push_back(char(*flag ? protocol::Tag::True : protocol::Tag::False));
  } else if (auto *number = std::get_if<double>(&value)) {
    out.push_back(char(protocol::Tag::Number));
    auto bits = std::bit_cast<uint64_t>(*number);
    put_u32(uint32_t(bits), out);
    put_u32(uint32_t(bits >> 32), out);
  } else if (auto *text = std::get_if<std::string_view>(&value)) {
    out.push_back(char(protocol::Tag::String));
    put_u32(uint32_t(text->size()), out);
    out.append(*text);
  } else {
    const auto &strings = std::get<StringList>(value);
    out.push_back(char(protocol::Tag::Strings));
    put_u32(strings.count, out);
    if (strings.count != 0) {
      auto end = strings.data;
      for (uint32_t i = 0; i < strings.count; i++) end += 4 + size_t(load_u32(end));
      out.append(reinterpret_cast<const char *>(strings.data), size_t(end - strings.data));
    }
  }
}

std::string format_value(const Value &value) {
  if (auto *flag = std::get_if<bool>(&value)) return *flag ? "true" : "false";
  if (auto *number = std::get_if<double>(&value)) return js_number(*number);
  std::string out;
  if (auto *text = std::get_if<std::string_view>(&value)) {
    out.reserve(text->size() + 2);
    append_json_string(*text, out);
  } else {
    out += '[';
    for (auto text : std::get<StringList>(value)) {
      if (out.size() > 1) out += ',';
      append_json_string(text, out);
    }
    out += ']';
  }
  return out;
}

std::string format(const Op &op) {
  auto head = [&](const char *name) {
    return std::string(name) + ' ' + std::to_string(op.scope) + ' ' + std::to_string(op.index);
  };
  switch (op.code) {
    case protocol::Code::Create:
      return head("create");
    case protocol::Code::Set:
      return head("set") + ' ' + format_value(op.value);
    case protocol::Code::Branch:
      return head("branch") + ' ' + std::to_string(op.child);
    case protocol::Code::Attach:
      return head("attach") + ' ' + std::to_string(op.child);
    case protocol::Code::Splice: {
      std::string out = head("splice") + ' ' + std::to_string(op.splice.index) + ' ' + std::to_string(op.splice.remove) + " [";
      bool first = true;
      for (auto item : op.splice.items) {
        if (!first) out += ' ';
        first = false;
        out += std::to_string(item.item) + '/' + std::to_string(item.template_index);
      }
      return out + ']';
    }
    case protocol::Code::Bind:
      return head("bind") + ' ' + std::to_string(op.bind.item) + ' ' + std::to_string(op.bind.child);
    case protocol::Code::Nav: {
      auto list = [](ScopeList values) {
        std::string out = "[";
        bool first = true;
        for (auto value : values) { if (!first) out += ' '; first = false; out += std::to_string(value); }
        return out + ']';
      };
      std::string out = "nav " + std::to_string(op.nav.tab) + ' ' + list(op.nav.tabs) + ' ' + list(op.nav.stack) + ' ' + std::to_string(op.nav.modal);
      if (op.nav.modal) out += op.nav.style == uint32_t(protocol::ModalStyle::FullScreen) ? " fullScreen" : " sheet";
      return out;
    }
    case protocol::Code::Rows: {
      std::string out = head("rows") + " [";
      for (uint32_t i = 0; i < op.count; i++) {
        if (i > 0) out += ' ';
        out += std::to_string(op.row(i));
      }
      return out + ']';
    }
  }
  return {};
}

}  // namespace weft::ops
