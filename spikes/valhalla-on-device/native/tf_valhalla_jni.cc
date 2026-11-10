// JNI entry points for the Android measurement app.
#include "tf_valhalla.h"

#include <jni.h>

#include <string>

namespace {
std::string text(JNIEnv* env, jstring value) {
  const char* chars = env->GetStringUTFChars(value, nullptr);
  std::string out(chars);
  env->ReleaseStringUTFChars(value, chars);
  return out;
}
} // namespace

extern "C" JNIEXPORT jstring JNICALL
Java_dev_tileflow_spike_valhalla_Bench_run(JNIEnv* env, jclass, jstring plan) {
  char* result = tf_bench_run(text(env, plan).c_str());
  jstring out = env->NewStringUTF(result);
  tf_string_free(result);
  return out;
}

extern "C" JNIEXPORT jlong JNICALL
Java_dev_tileflow_spike_valhalla_Bench_create(JNIEnv* env, jclass, jstring config) {
  char* error = nullptr;
  tf_router* router = tf_router_create(text(env, config).c_str(), &error);
  tf_string_free(error);
  return reinterpret_cast<jlong>(router);
}

extern "C" JNIEXPORT jstring JNICALL
Java_dev_tileflow_spike_valhalla_Bench_route(JNIEnv* env, jclass, jlong router, jstring request) {
  int status = 0;
  char* answer =
      tf_router_route(reinterpret_cast<tf_router*>(router), text(env, request).c_str(), &status);
  jstring out = env->NewStringUTF(answer);
  tf_string_free(answer);
  return out;
}
