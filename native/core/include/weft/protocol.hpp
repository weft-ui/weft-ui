// Generated from protocol/weft.protocol.json by protocol/generate.ts; do not edit.

#pragma once

#include <cstdint>
#include <string_view>

namespace weft::protocol {

inline constexpr std::uint8_t kVersion = 3;

enum class Code : std::uint8_t {
  Create = 1,
  Set = 2,
  Branch = 3,
  Rows = 4,
  Attach = 5,
};

enum class Tag : std::uint8_t {
  False = 0,
  True = 1,
  Number = 2,
  String = 3,
  Strings = 4,
};

inline constexpr std::string_view kFetchModule = "fetch";
inline constexpr std::string_view kFetchRequest = "request";
inline constexpr std::string_view kStorageModule = "storage";
inline constexpr std::string_view kStorageGet = "get";
inline constexpr std::string_view kStorageSet = "set";
inline constexpr std::string_view kStorageRemove = "remove";

}  // namespace weft::protocol
