#include "platform.hpp"

#include "frame.hpp"
#include "weft/protocol.hpp"

#include <json-glib/json-glib.h>
#include <libsoup/soup.h>

#include <map>
#include <memory>
#include <optional>
#include <stdexcept>
#include <utility>

namespace weft::platform {

namespace {

std::vector<uint8_t> bytes_of(std::string_view text) { return {text.begin(), text.end()}; }

/// A call in flight: its cancellable (referenced) and completion.
struct Pending {
  Pending(GCancellable *cancellable, Done done)
      : cancellable(G_CANCELLABLE(g_object_ref(cancellable))), done(std::move(done)) {}
  ~Pending() { g_object_unref(cancellable); }

  void finish(bool ok, std::vector<uint8_t> result) {
    if (!g_cancellable_is_cancelled(cancellable)) done(ok, std::move(result));
  }

  GCancellable *cancellable;
  Done done;
};

/// Completes `pending` from an idle callback: results never arrive inside the kernel's `call`.
void finish_later(std::unique_ptr<Pending> pending, bool ok, std::vector<uint8_t> result) {
  struct Later {
    std::unique_ptr<Pending> pending;
    bool ok;
    std::vector<uint8_t> result;
  };
  g_idle_add_full(
      G_PRIORITY_DEFAULT,
      [](gpointer data) {
        auto *later = static_cast<Later *>(data);
        later->pending->finish(later->ok, std::move(later->result));
        return G_SOURCE_REMOVE;
      },
      new Later{std::move(pending), ok, std::move(result)}, [](gpointer data) { delete static_cast<Later *>(data); });
}

std::string to_json(JsonNode *node) {
  char *text = json_to_string(node, false);
  std::string json(text);
  g_free(text);
  return json;
}

// fetch.request through libsoup with 32 MiB streaming cap.

SoupSession *http() {
  static SoupSession *session = soup_session_new();
  return session;
}

struct FetchStream {
  std::unique_ptr<Pending> pending;
  guint status = 0;
  std::vector<uint8_t> body;
};

void read_fetch_chunk(GInputStream *stream, std::unique_ptr<FetchStream> state);

void on_fetch_chunk(GObject *source, GAsyncResult *result, gpointer data) {
  std::unique_ptr<FetchStream> state(static_cast<FetchStream *>(data));
  auto *stream = G_INPUT_STREAM(source);
  GError *error = nullptr;
  GBytes *chunk = g_input_stream_read_bytes_finish(stream, result, &error);
  if (!chunk) {
    state->pending->finish(false, bytes_of(error ? error->message : "fetch read failed"));
    if (error) g_error_free(error);
    return;
  }
  gsize n = 0;
  const auto *ptr = static_cast<const uint8_t *>(g_bytes_get_data(chunk, &n));
  if (n == 0) {
    g_bytes_unref(chunk);
    std::string head = "{\"status\":" + std::to_string(state->status) + "}";
    state->pending->finish(true, frame::frame(head, state->body.data(), state->body.size()));
    return;
  }
  if (state->body.size() + n > kMaxFetchBytes) {
    g_bytes_unref(chunk);
    state->pending->finish(false, bytes_of("weft: fetch response exceeds 32 MiB limit"));
    return;
  }
  state->body.insert(state->body.end(), ptr, ptr + n);
  g_bytes_unref(chunk);
  read_fetch_chunk(stream, std::move(state));
}

void read_fetch_chunk(GInputStream *stream, std::unique_ptr<FetchStream> state) {
  GCancellable *cancellable = state->pending->cancellable;
  g_input_stream_read_bytes_async(stream, 65536, G_PRIORITY_DEFAULT, cancellable, on_fetch_chunk,
                                  state.release());
}

/// Sends the request; `pending` is released once the request is sent.
void fetch(const std::vector<uint8_t> &args, std::unique_ptr<Pending> &pending) {
  auto [head, body] = frame::unframe(args);
  JsonObject *object = json_node_get_object(head);
  std::string url = json_object_get_string_member_with_default(object, "url", "");
  if (!is_http_url(url)) {
    json_node_unref(head);
    throw std::runtime_error("weft: unsupported fetch URL " + url);
  }
  std::string method = json_object_get_string_member_with_default(object, "method", "GET");
  SoupMessage *message = soup_message_new(method.c_str(), url.c_str());
  if (!message) {
    json_node_unref(head);
    throw std::runtime_error("weft: invalid URL " + url);
  }
  if (json_object_has_member(object, "headers") && JSON_NODE_HOLDS_OBJECT(json_object_get_member(object, "headers"))) {
    JsonObject *headers = json_object_get_object_member(object, "headers");
    SoupMessageHeaders *request = soup_message_get_request_headers(message);
    json_object_foreach_member(
        headers,
        [](JsonObject *, const char *name, JsonNode *value, gpointer request) {
          const char *text = JSON_NODE_HOLDS_VALUE(value) ? json_node_get_string(value) : nullptr;
          soup_message_headers_append(static_cast<SoupMessageHeaders *>(request), name, text ? text : "");
        },
        request);
  }
  json_node_unref(head);
  if (!body.empty()) {
    GBytes *bytes = g_bytes_new(body.data(), body.size());
    // A null content type keeps the request's Content-Type header.
    soup_message_set_request_body_from_bytes(message, nullptr, bytes);
    g_bytes_unref(bytes);
  }
  GCancellable *cancellable = pending->cancellable;
  soup_session_send_async(
      http(), message, G_PRIORITY_DEFAULT, cancellable,
      [](GObject *session, GAsyncResult *result, gpointer data) {
        std::unique_ptr<Pending> pending(static_cast<Pending *>(data));
        GError *error = nullptr;
        GInputStream *stream = soup_session_send_finish(SOUP_SESSION(session), result, &error);
        if (!stream) {
          pending->finish(false, bytes_of(error ? error->message : "fetch failed"));
          if (error) g_error_free(error);
          return;
        }
        auto *msg = soup_session_get_async_result_message(SOUP_SESSION(session), result);
        auto content_len = soup_message_headers_get_content_length(soup_message_get_response_headers(msg));
        if (content_len > goffset(kMaxFetchBytes)) {
          g_object_unref(stream);
          pending->finish(false, bytes_of("weft: fetch response exceeds 32 MiB limit"));
          return;
        }
        auto state = std::make_unique<FetchStream>();
        state->pending = std::move(pending);
        state->status = soup_message_get_status(msg);
        read_fetch_chunk(stream, std::move(state));
        g_object_unref(stream);
      },
      pending.release());
  g_object_unref(message);
}

// storage.get / set / remove: a JSON object of strings in
// $XDG_DATA_HOME/<app id>/storage.json (~/.local/share by default). The app
// id is the GApplication's, else the program name.

std::string storage_path() {
  const char *id = nullptr;
  if (GApplication *app = g_application_get_default()) id = g_application_get_application_id(app);
  if (!id || !*id) id = g_get_prgname();
  if (!id || !*id) id = "weft";
  char *path = g_build_filename(g_get_user_data_dir(), id, "storage.json", nullptr);
  std::string result(path);
  g_free(path);
  return result;
}

std::map<std::string, std::string> &stored() {
  static std::optional<std::map<std::string, std::string>> values;
  if (values) return *values;
  values.emplace();
  char *contents = nullptr;
  gsize length = 0;
  if (!g_file_get_contents(storage_path().c_str(), &contents, &length, nullptr)) return *values;
  try {
    JsonNode *root = parse_json({contents, length}, "storage file");
    if (JSON_NODE_HOLDS_OBJECT(root)) {
      json_object_foreach_member(
          json_node_get_object(root),
          [](JsonObject *, const char *name, JsonNode *value, gpointer values) {
            if (JSON_NODE_HOLDS_VALUE(value) && json_node_get_value_type(value) == G_TYPE_STRING) {
              static_cast<std::map<std::string, std::string> *>(values)->emplace(name, json_node_get_string(value));
            }
          },
          &*values);
    }
    json_node_unref(root);
  } catch (const std::runtime_error &) {
    // A damaged file starts over empty.
  }
  g_free(contents);
  return *values;
}

/// Writes the file through a temporary one, so a crash never leaves it half written.
void save(const std::map<std::string, std::string> &values) {
  JsonObject *object = json_object_new();
  for (auto &[key, value] : values) json_object_set_string_member(object, key.c_str(), value.c_str());
  JsonNode *root = json_node_init_object(json_node_alloc(), object);
  json_object_unref(object);
  std::string json = to_json(root);
  json_node_unref(root);
  std::string path = storage_path();
  char *directory = g_path_get_dirname(path.c_str());
  g_mkdir_with_parents(directory, 0700);
  g_free(directory);
  GError *error = nullptr;
  if (!g_file_set_contents(path.c_str(), json.data(), gssize(json.size()), &error)) {
    std::string message = std::string("weft: cannot write ") + path + " (" + (error ? error->message : "unknown") + ")";
    if (error) g_error_free(error);
    throw std::runtime_error(message);
  }
}

std::vector<uint8_t> storage(const std::string &method, const std::vector<std::string> &list) {
  auto &values = stored();
  if (method == protocol::kStorageGet) {
    auto found = values.find(list[0]);
    if (found == values.end()) return bytes_of("null");
    JsonNode *value = json_node_init_string(json_node_alloc(), found->second.c_str());
    std::string json = to_json(value);
    json_node_unref(value);
    return bytes_of(json);
  }
  if (method == protocol::kStorageSet) {
    if (list.size() != 2) throw std::runtime_error("weft: storage.set expects [key, value]");
    auto it = values.find(list[0]);
    bool had_old = it != values.end();
    std::string old_value = had_old ? it->second : std::string();
    values[list[0]] = list[1];
    try {
      save(values);
    } catch (...) {
      if (had_old) values[list[0]] = std::move(old_value);
      else values.erase(list[0]);
      throw;
    }
  } else {
    auto it = values.find(list[0]);
    if (it == values.end()) return {};
    std::string old_value = it->second;
    values.erase(it);
    try {
      save(values);
    } catch (...) {
      values.emplace(list[0], std::move(old_value));
      throw;
    }
  }
  return {};
}

struct StorageJob {
  std::string method;
  std::vector<std::string> list;
  std::unique_ptr<Pending> pending;
};

GThreadPool *storage_pool() {
  static GThreadPool *pool = g_thread_pool_new(
      [](gpointer data, gpointer) {
        std::unique_ptr<StorageJob> job(static_cast<StorageJob *>(data));
        try {
          auto result = storage(job->method, job->list);
          finish_later(std::move(job->pending), true, std::move(result));
        } catch (const std::runtime_error &error) {
          finish_later(std::move(job->pending), false, bytes_of(error.what()));
        }
      },
      nullptr, 1, TRUE, nullptr);
  return pool;
}

}  // namespace

bool is_http_url(std::string_view url) {
  std::string terminated(url);
  GUri *uri = g_uri_parse(terminated.c_str(), G_URI_FLAGS_NONE, nullptr);
  if (!uri) return false;
  const char *scheme = g_uri_get_scheme(uri);
  bool ok = scheme && (g_ascii_strcasecmp(scheme, "http") == 0 || g_ascii_strcasecmp(scheme, "https") == 0);
  g_uri_unref(uri);
  return ok;
}

std::vector<std::string> parse_storage_args(std::string_view method, const std::vector<uint8_t> &args) {
  JsonNode *root = parse_json({reinterpret_cast<const char *>(args.data()), args.size()}, "storage arguments");
  std::vector<std::string> list;
  bool valid = JSON_NODE_HOLDS_ARRAY(root);
  if (valid) {
    JsonArray *array = json_node_get_array(root);
    guint len = json_array_get_length(array);
    list.reserve(len);
    for (guint i = 0; i < len; i++) {
      JsonNode *item = json_array_get_element(array, i);
      if (!JSON_NODE_HOLDS_VALUE(item) || json_node_get_value_type(item) != G_TYPE_STRING) {
        valid = false;
        break;
      }
      list.emplace_back(json_node_get_string(item));
    }
  }
  json_node_unref(root);
  if (!valid || list.empty()) {
    throw std::runtime_error("weft: storage." + std::string(method) + " expects a JSON array of strings");
  }
  return list;
}

bool supported(std::string_view module) {
  return module == protocol::kFetchModule || module == protocol::kStorageModule || module == protocol::kUiModule;
}

void call(const std::string &module, const std::string &method, std::vector<uint8_t> args,
          GCancellable *cancellable, Done done) {
  auto pending = std::make_unique<Pending>(cancellable, std::move(done));
  try {
    if (module == protocol::kFetchModule && method == protocol::kFetchRequest) {
      fetch(args, pending);
    } else if (module == protocol::kStorageModule &&
               (method == protocol::kStorageGet || method == protocol::kStorageSet || method == protocol::kStorageRemove)) {
      auto list = parse_storage_args(method, args);
      auto job = std::make_unique<StorageJob>(StorageJob{method, std::move(list), std::move(pending)});
      GError *error = nullptr;
      if (!g_thread_pool_push(storage_pool(), job.release(), &error)) {
        std::string message = error ? error->message : "failed to queue storage job";
        if (error) g_error_free(error);
        throw std::runtime_error(message);
      }
    } else {
      throw std::runtime_error("weft: " + module + "." + method + " is not implemented");
    }
  } catch (const std::runtime_error &error) {
    // `pending` is still owned here: `fetch` and `storage` only release it once queued.
    if (pending) finish_later(std::move(pending), false, bytes_of(error.what()));
  }
}

}  // namespace weft::platform
