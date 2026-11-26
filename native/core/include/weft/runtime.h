/*
 * Weft native kernel: runs the Hermes bytecode of a Weft app and connects it
 * to a platform shell (protocol/SPEC.md, "Native kernel").
 *
 * The kernel owns no thread. Every function must be called on the thread
 * that created the runtime (the UI thread), and never from inside one of the
 * `weft_host` callbacks. Microtasks are drained before every function that
 * runs JavaScript returns. Uncaught JavaScript exceptions are reported
 * through `weft_host.log` at `WEFT_LOG_ERROR` and do not stop the runtime.
 */

#ifndef WEFT_RUNTIME_H
#define WEFT_RUNTIME_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#if defined(_WIN32) && defined(WEFT_CORE_SHARED)
#if defined(WEFT_CORE_BUILD)
#define WEFT_API __declspec(dllexport)
#else
#define WEFT_API __declspec(dllimport)
#endif
#elif defined(__GNUC__)
#define WEFT_API __attribute__((visibility("default")))
#else
#define WEFT_API
#endif

#ifdef __cplusplus
extern "C" {
#endif

typedef struct weft_runtime weft_runtime;

/* Levels of `weft_host.log`; `console.debug` / `log` / `info` / `warn` / `error` map to them. */
enum {
  WEFT_LOG_DEBUG = 0,
  WEFT_LOG_INFO = 1,
  WEFT_LOG_WARN = 2,
  WEFT_LOG_ERROR = 3,
};

/* Callbacks of the platform shell. `ctx` is passed back unchanged. */
typedef struct {
  uint32_t protocol;
  void *ctx;
  /* One batch of view protocol ops (binary encoding), valid only during the call. */
  void (*commit)(void *ctx, const uint8_t *ops, size_t len);
  /* Asks for `weft_runtime_tick` after `delay_ms`. Requests may be coalesced
     into the earliest one; an early or extra tick is harmless. */
  void (*schedule)(void *ctx, uint64_t delay_ms);
  /* Whether the shell implements platform module `module` (e.g. "fetch"). */
  bool (*supports)(void *ctx, const char *module);
  /* Starts platform call `id` of a supported module. The shell completes it
     later on the runtime's thread with `weft_runtime_resolve`, exactly once.
     `module`, `method` and `args` are valid only during the call. */
  void (*call)(void *ctx, uint32_t id, const char *module, const char *method,
               const uint8_t *args, size_t len);
  /* A console message or kernel diagnostic in UTF-8, valid only during the call. */
  void (*log)(void *ctx, int level, const char *msg, size_t len);
  /* OS version reported as `platform.version`; may be NULL. Copied by `weft_runtime_new`. */
  const char *version;
  /* Initial environment as NUL-terminated UTF-8 JSON; NULL means {}.
     Copied by `weft_runtime_new`. */
  const char *environment;
  /* Initial launch options as NUL-terminated UTF-8 JSON; NULL means {}. Copied at startup. */
  const char *launch;
} weft_host;

/*
 * Creates a runtime and runs the app's bytecode (`bundle.hbc`), which mounts
 * the app: the first batch of ops arrives through `commit` before this
 * returns. `bytecode` must be 4-byte aligned (mapped files and heap blocks
 * are) and stay valid and unchanged until `weft_runtime_free`.
 * `layout_hash` is the layout hash of the native views; an app compiled
 * with another layout is refused. Returns NULL after logging the reason
 * when the bytecode is invalid, the layouts differ, or the bundle throws.
 */
WEFT_API weft_runtime *weft_runtime_new(const weft_host *host, const uint8_t *bytecode,
                                        size_t len, uint64_t layout_hash);

/* Runs the timers that are due, then asks for the next tick if timers remain. */
WEFT_API void weft_runtime_tick(weft_runtime *rt);

/*
 * Reports that event slot `handler` of `scope` fired. `payload` is one
 * encoded value (the value encoding of the ops), or empty for events without
 * payload. The handler runs and the app flushes before this returns, so any
 * resulting ops have been committed. Returns false when a controlled element
 * must be restored to the last value of its value slot.
 */
WEFT_API bool weft_runtime_dispatch(weft_runtime *rt, uint32_t scope, uint32_t handler,
                                    const uint8_t *payload, size_t len);

/*
 * Completes platform call `id`: the call's promise resolves with an
 * ArrayBuffer copy of `result`, or, if `ok` is false, rejects with an Error
 * whose message is `result` as UTF-8. Unknown ids are ignored.
 */
WEFT_API void weft_runtime_resolve(weft_runtime *rt, uint32_t id, bool ok, const uint8_t *result,
                                   size_t len);

/* Requests materialization of the half-open window [start, end). */
WEFT_API void weft_runtime_window(weft_runtime *rt, uint32_t scope, uint32_t point,
                                  uint32_t start, uint32_t end);

/* Delivers a named host signal with `len` UTF-8 JSON bytes. Unknown names are ignored. */
WEFT_API void weft_runtime_signal(weft_runtime *rt, const char *name, const char *json, size_t len);

/* Publishes a changed environment as `len` UTF-8 JSON bytes and notifies the bundle. */
WEFT_API void weft_runtime_environment(weft_runtime *rt, const char *json, size_t len);

/* Destroys the runtime; pending calls are dropped. Accepts NULL. */
WEFT_API void weft_runtime_free(weft_runtime *rt);

/*
 * Helper for shells that move native rows themselves: given the previous
 * and the new row order of a list point (scope ids, as in a `rows` op),
 * sets `stable[i]` to 1 for the rows of `new_rows` that keep their place
 * (a longest subsequence already in order) and to 0 for rows to move or
 * insert. Returns the number of stable rows.
 */
WEFT_API size_t weft_stable_rows(const uint32_t *old_rows, size_t old_len,
                                 const uint32_t *new_rows, size_t new_len, uint8_t *stable);

#ifdef __cplusplus
}
#endif

#endif /* WEFT_RUNTIME_H */
