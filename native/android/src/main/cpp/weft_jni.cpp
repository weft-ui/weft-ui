// JNI glue of the Android shell: the kernel's C ABI (weft/runtime.h) as the
// external functions of net.mioyi.weftui.Native, and the kernel's host callbacks
// as calls to a net.mioyi.weftui.NativeHost. Everything runs on the main thread,
// which the JVM has attached; strings cross as UTF-8 byte arrays because JNI's
// modified UTF-8 cannot carry every string a bundle may produce.

#include <jni.h>

#include <fbjni/fbjni.h>

#include <cstdint>
#include <cstring>
#include <limits>
#include <memory>
#include <string>
#include <vector>

#include "weft/runtime.h"
#include "weft/protocol.hpp"

namespace {

JavaVM *g_vm = nullptr;

/// One runtime with the shell object its callbacks go to.
struct Session {
  jobject host = nullptr;
  jmethodID commit = nullptr;
  jmethodID schedule = nullptr;
  jmethodID supports = nullptr;
  jmethodID call = nullptr;
  jmethodID log = nullptr;
  /// The bytecode, aligned and alive for the runtime's lifetime as the kernel requires.
  std::unique_ptr<uint8_t[]> bytecode;
  weft_runtime *runtime = nullptr;
};

JNIEnv *env() {
  JNIEnv *env = nullptr;
  g_vm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6);
  return env;
}

/// Reports and clears an exception thrown by a callback into the shell: the
/// kernel's caller is native code that cannot propagate it.
void clear(JNIEnv *env) {
  if (env->ExceptionCheck()) {
    env->ExceptionDescribe();
    env->ExceptionClear();
  }
}

uint8_t kEmptyByte = 0;

jbyteArray bytes(JNIEnv *env, const void *data, size_t len) {
  if (len > static_cast<size_t>(std::numeric_limits<jsize>::max())) return nullptr;
  jbyteArray array = env->NewByteArray(static_cast<jsize>(len));
  if (array == nullptr) {
    clear(env);
    return nullptr;
  }
  if (len > 0 && data != nullptr) {
    env->SetByteArrayRegion(array, 0, static_cast<jsize>(len), static_cast<const jbyte *>(data));
    clear(env);
  }
  return array;
}

jbyteArray bytes(JNIEnv *env, const char *text) {
  if (text == nullptr) return bytes(env, "", 0);
  return bytes(env, text, std::char_traits<char>::length(text));
}

std::vector<uint8_t> copy(JNIEnv *env, jbyteArray array) {
  std::vector<uint8_t> out;
  if (array == nullptr) return out;
  const jsize len = env->GetArrayLength(array);
  if (len > 0) {
    out.resize(static_cast<size_t>(len));
    env->GetByteArrayRegion(array, 0, len, reinterpret_cast<jbyte *>(out.data()));
    if (env->ExceptionCheck()) {
      clear(env);
      out.clear();
    }
  }
  return out;
}

Session *from(void *ctx) { return static_cast<Session *>(ctx); }

Session *from(jlong handle) { return reinterpret_cast<Session *>(handle); }

void commit(void *ctx, const uint8_t *ops, size_t len) {
  JNIEnv *e = env();
  if (e == nullptr || ctx == nullptr || len > static_cast<size_t>(std::numeric_limits<jlong>::max())) return;
  // The batch is only valid during this call: the buffer is a view, not a copy.
  void *ptr = (len > 0 && ops != nullptr) ? const_cast<uint8_t *>(ops) : &kEmptyByte;
  jobject buffer = e->NewDirectByteBuffer(ptr, static_cast<jlong>(len));
  if (buffer == nullptr) {
    clear(e);
    return;
  }
  e->CallVoidMethod(from(ctx)->host, from(ctx)->commit, buffer);
  clear(e);
  e->DeleteLocalRef(buffer);
}

void schedule(void *ctx, uint64_t delay_ms) {
  JNIEnv *e = env();
  if (e == nullptr || ctx == nullptr) return;
  e->CallVoidMethod(from(ctx)->host, from(ctx)->schedule, static_cast<jlong>(delay_ms));
  clear(e);
}

bool supports(void *ctx, const char *module) {
  JNIEnv *e = env();
  if (e == nullptr || ctx == nullptr) return false;
  jbyteArray name = bytes(e, module);
  if (name == nullptr) return false;
  bool result = e->CallBooleanMethod(from(ctx)->host, from(ctx)->supports, name);
  if (e->ExceptionCheck()) {
    clear(e);
    result = false;
  }
  e->DeleteLocalRef(name);
  return result;
}

void call(void *ctx, uint32_t id, const char *module, const char *method, const uint8_t *args,
          size_t len) {
  JNIEnv *e = env();
  if (e == nullptr || ctx == nullptr) return;
  jbyteArray m = bytes(e, module);
  jbyteArray f = bytes(e, method);
  jbyteArray a = bytes(e, args, len);
  if (m != nullptr && f != nullptr && a != nullptr) {
    e->CallVoidMethod(from(ctx)->host, from(ctx)->call, static_cast<jint>(id), m, f, a);
    clear(e);
  }
  e->DeleteLocalRef(m);
  e->DeleteLocalRef(f);
  e->DeleteLocalRef(a);
}

void log(void *ctx, int level, const char *msg, size_t len) {
  JNIEnv *e = env();
  if (e == nullptr || ctx == nullptr) return;
  jbyteArray text = bytes(e, msg, len);
  if (text == nullptr) return;
  e->CallVoidMethod(from(ctx)->host, from(ctx)->log, static_cast<jint>(level), text);
  clear(e);
  e->DeleteLocalRef(text);
}

}  // namespace

extern "C" {

JNIEXPORT jint JNI_OnLoad(JavaVM *vm, void *) {
  g_vm = vm;
  // Hermes attaches its finalizer thread through fbjni.
  return facebook::jni::initialize(vm, [] {});
}

JNIEXPORT jlong JNICALL Java_net_mioyi_weftui_Native_create(JNIEnv *e, jobject, jobject host,
                                                            jbyteArray bytecode,
                                                            jlong layout_hash, jstring version,
                                                            jstring environment, jbyteArray launch) {
  if (host == nullptr || bytecode == nullptr || version == nullptr || environment == nullptr || launch == nullptr) return 0;
  auto session = std::make_unique<Session>();
  jclass type = e->GetObjectClass(host);
  if (type == nullptr || e->ExceptionCheck()) return 0;
  session->commit = e->GetMethodID(type, "commit", "(Ljava/nio/ByteBuffer;)V");
  session->schedule = e->GetMethodID(type, "schedule", "(J)V");
  session->supports = e->GetMethodID(type, "supports", "([B)Z");
  session->call = e->GetMethodID(type, "call", "(I[B[B[B)V");
  session->log = e->GetMethodID(type, "log", "(I[B)V");
  e->DeleteLocalRef(type);
  if (e->ExceptionCheck()) return 0;  // NoSuchMethodError propagates to the caller.
  session->host = e->NewGlobalRef(host);
  if (session->host == nullptr) return 0;

  const jsize bytecode_len = e->GetArrayLength(bytecode);
  if (bytecode_len < 0 || e->ExceptionCheck()) {
    clear(e);
    e->DeleteGlobalRef(session->host);
    return 0;
  }
  const auto len = static_cast<size_t>(bytecode_len);
  session->bytecode.reset(new uint8_t[len > 0 ? len : 1]);
  if (len > 0) {
    e->GetByteArrayRegion(bytecode, 0, bytecode_len, reinterpret_cast<jbyte *>(session->bytecode.get()));
    if (e->ExceptionCheck()) {
      clear(e);
      e->DeleteGlobalRef(session->host);
      return 0;
    }
  }

  const char *chars = e->GetStringUTFChars(version, nullptr);
  if (chars == nullptr) {
    clear(e);
    e->DeleteGlobalRef(session->host);
    return 0;
  }
  const std::string os = chars;
  e->ReleaseStringUTFChars(version, chars);

  // The environment JSON has ASCII keys and values (numbers and fixed strings).
  const char *json = e->GetStringUTFChars(environment, nullptr);
  if (json == nullptr) {
    clear(e);
    e->DeleteGlobalRef(session->host);
    return 0;
  }
  const jsize launch_len = e->GetArrayLength(launch);
  std::vector<char> launch_json(static_cast<size_t>(launch_len) + 1, '\0');
  e->GetByteArrayRegion(launch, 0, launch_len, reinterpret_cast<jbyte *>(launch_json.data()));
  if (e->ExceptionCheck()) {
    e->ReleaseStringUTFChars(environment, json);
    e->DeleteGlobalRef(session->host);
    return 0;
  }
  const weft_host callbacks{
      .protocol = weft::protocol::kVersion,
      .ctx = session.get(),
      .commit = commit,
      .schedule = schedule,
      .supports = supports,
      .call = call,
      .log = log,
      .version = os.c_str(),
      .environment = json,
      .launch = launch_json.data(),
  };
  session->runtime = weft_runtime_new(&callbacks, session->bytecode.get(), len,
                                      static_cast<uint64_t>(layout_hash));
  e->ReleaseStringUTFChars(environment, json);
  if (session->runtime == nullptr) {
    e->DeleteGlobalRef(session->host);
    return 0;
  }
  return reinterpret_cast<jlong>(session.release());
}

JNIEXPORT void JNICALL Java_net_mioyi_weftui_Native_environment(JNIEnv *e, jobject, jlong handle, jstring json) {
  Session *s = from(handle);
  if (s == nullptr || s->runtime == nullptr || json == nullptr) return;
  const char *bytes = e->GetStringUTFChars(json, nullptr);
  if (bytes == nullptr) return;
  weft_runtime_environment(s->runtime, bytes, std::strlen(bytes));
  e->ReleaseStringUTFChars(json, bytes);
}

JNIEXPORT void JNICALL Java_net_mioyi_weftui_Native_tick(JNIEnv *, jobject, jlong handle) {
  Session *s = from(handle);
  if (s == nullptr || s->runtime == nullptr) return;
  weft_runtime_tick(s->runtime);
}

JNIEXPORT jboolean JNICALL Java_net_mioyi_weftui_Native_dispatch(JNIEnv *e, jobject, jlong handle,
                                                                 jint scope, jint slot,
                                                                 jbyteArray payload) {
  Session *s = from(handle);
  if (s == nullptr || s->runtime == nullptr) return JNI_TRUE;
  const std::vector<uint8_t> bytes = copy(e, payload);
  return weft_runtime_dispatch(s->runtime, static_cast<uint32_t>(scope),
                               static_cast<uint32_t>(slot),
                               bytes.empty() ? nullptr : bytes.data(), bytes.size());
}

JNIEXPORT void JNICALL Java_net_mioyi_weftui_Native_window(JNIEnv *, jobject, jlong handle,
                                                           jint scope, jint point, jint start, jint end) {
  Session *s = from(handle);
  if (s == nullptr || s->runtime == nullptr) return;
  weft_runtime_window(s->runtime, static_cast<uint32_t>(scope), static_cast<uint32_t>(point),
                      static_cast<uint32_t>(start), static_cast<uint32_t>(end));
}

JNIEXPORT void JNICALL Java_net_mioyi_weftui_Native_signal(JNIEnv *e, jobject, jlong handle,
                                                           jbyteArray name, jbyteArray json) {
  Session *s = from(handle);
  if (s == nullptr || s->runtime == nullptr || name == nullptr || json == nullptr) return;
  auto name_bytes = copy(e, name);
  name_bytes.push_back(0);
  const auto json_bytes = copy(e, json);
  weft_runtime_signal(s->runtime, reinterpret_cast<const char *>(name_bytes.data()),
                      json_bytes.empty() ? "" : reinterpret_cast<const char *>(json_bytes.data()),
                      json_bytes.size());
}

JNIEXPORT void JNICALL Java_net_mioyi_weftui_Native_resolve(JNIEnv *e, jobject, jlong handle,
                                                            jint id, jboolean ok,
                                                            jbyteArray result) {
  Session *s = from(handle);
  if (s == nullptr || s->runtime == nullptr) return;
  const std::vector<uint8_t> bytes = copy(e, result);
  weft_runtime_resolve(s->runtime, static_cast<uint32_t>(id), ok,
                       bytes.empty() ? nullptr : bytes.data(), bytes.size());
}

JNIEXPORT void JNICALL Java_net_mioyi_weftui_Native_free(JNIEnv *e, jobject, jlong handle) {
  Session *session = from(handle);
  if (session == nullptr) return;
  weft_runtime_free(session->runtime);
  e->DeleteGlobalRef(session->host);
  delete session;
}

}  // extern "C"
