// Platform modules of the shell; byte formats in
// protocol/SPEC.md ("Platform calls").

#pragma once

#include <gio/gio.h>

#include <cstdint>
#include <functional>
#include <string>
#include <string_view>
#include <vector>

namespace weft::platform {

/// Completes a call: whether it succeeded, and its result or error message.
using Done = std::function<void(bool ok, std::vector<uint8_t> result)>;

/// Whether the shell implements module `module`.
bool supported(std::string_view module);

/// Whether `url` uses an allowed `http` or `https` scheme.
bool is_http_url(std::string_view url);

/// Maximum bytes accepted from `fetch.request` (32 MiB).
inline constexpr size_t kMaxFetchBytes = 32 * 1024 * 1024;

/// Maximum bytes and pixels accepted for remote images (16 MiB, 16,777,216 px).
inline constexpr size_t kMaxImageBytes = 16 * 1024 * 1024;
inline constexpr int64_t kMaxImagePixels = 16'777'216;

/// Parses and validates a `storage` JSON string-array payload for `method`.
std::vector<std::string> parse_storage_args(std::string_view method, const std::vector<uint8_t> &args);

/// Starts `module.method` with `args`. `done` runs later on the main loop,
/// never before this returns, and never once `cancellable` is cancelled.
void call(const std::string &module, const std::string &method, std::vector<uint8_t> args,
          GCancellable *cancellable, Done done);

}  // namespace weft::platform
