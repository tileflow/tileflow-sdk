// Minimal on-device router over Valhalla's actor, plus the measurement harness both test apps
// call. Measurements: wall and thread-CPU time per call, and memory as the platform accounts it
// (iOS: physical footprint and its peak; Android: /proc/self/status RSS split and its peak).
#include "tf_valhalla.h"

#include <valhalla/baldr/rapidjson_utils.h>
#include <valhalla/exceptions.h>
#include <valhalla/tyr/actor.h>

#include <boost/property_tree/ptree.hpp>
#include <rapidjson/document.h>
#include <rapidjson/stringbuffer.h>
#include <rapidjson/writer.h>

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

#include <pthread.h>
#include <time.h>

#if defined(__APPLE__)
#include <mach/mach.h>
#endif

struct tf_router {
  std::unique_ptr<valhalla::tyr::actor_t> actor;
};

namespace {

char* dup(const std::string& value) {
  char* out = static_cast<char*>(std::malloc(value.size() + 1));
  std::memcpy(out, value.c_str(), value.size() + 1);
  return out;
}

std::string error_json(unsigned code, const std::string& message, unsigned status) {
  rapidjson::StringBuffer buffer;
  rapidjson::Writer<rapidjson::StringBuffer> writer(buffer);
  writer.StartObject();
  writer.Key("error_code");
  writer.Uint(code);
  writer.Key("error");
  writer.String(message.c_str());
  writer.Key("status_code");
  writer.Uint(status);
  writer.EndObject();
  return buffer.GetString();
}

double now_ms() {
  using namespace std::chrono;
  return duration<double, std::milli>(steady_clock::now().time_since_epoch()).count();
}

double thread_cpu_ms() {
  timespec ts{};
  clock_gettime(CLOCK_THREAD_CPUTIME_ID, &ts);
  return ts.tv_sec * 1e3 + ts.tv_nsec / 1e6;
}

struct memory_t {
  double current_mb = -1; // iOS phys_footprint; Android RssAnon
  double peak_mb = -1;    // iOS ledger peak footprint; Android VmHWM (includes file pages)
  double file_mb = -1;    // Android RssFile (mapped graph pages); iOS: n/a
  double resident_mb = -1; // resident size, all pages
};

memory_t memory_now() {
  memory_t m;
#if defined(__APPLE__)
  task_vm_info_data_t info{};
  mach_msg_type_number_t count = TASK_VM_INFO_COUNT;
  if (task_info(mach_task_self(), TASK_VM_INFO, reinterpret_cast<task_info_t>(&info), &count) ==
      KERN_SUCCESS) {
    m.current_mb = info.phys_footprint / 1048576.0;
    m.peak_mb = info.ledger_phys_footprint_peak / 1048576.0;
    m.resident_mb = info.resident_size / 1048576.0;
  }
#else
  std::ifstream status("/proc/self/status");
  std::string line;
  auto kb = [](const std::string& l) { return std::strtod(l.c_str() + l.find(':') + 1, nullptr); };
  while (std::getline(status, line)) {
    if (line.rfind("RssAnon:", 0) == 0) m.current_mb = kb(line) / 1024.0;
    else if (line.rfind("VmHWM:", 0) == 0) m.peak_mb = kb(line) / 1024.0;
    else if (line.rfind("RssFile:", 0) == 0) m.file_mb = kb(line) / 1024.0;
    else if (line.rfind("VmRSS:", 0) == 0) m.resident_mb = kb(line) / 1024.0;
  }
#endif
  return m;
}

template <typename Writer> void write_memory(Writer& w, const char* key, const memory_t& m) {
  w.Key(key);
  w.StartObject();
  w.Key("currentMb");
  w.Double(m.current_mb);
  w.Key("peakMb");
  w.Double(m.peak_mb);
  w.Key("fileMb");
  w.Double(m.file_mb);
  w.Key("residentMb");
  w.Double(m.resident_mb);
  w.EndObject();
}

double median(std::vector<double> values) {
  if (values.empty()) return -1;
  std::sort(values.begin(), values.end());
  size_t n = values.size();
  return n % 2 ? values[n / 2] : (values[n / 2 - 1] + values[n / 2]) / 2;
}

std::string bench(const std::string& plan_text) {
  rapidjson::Document plan;
  plan.Parse(plan_text.c_str());
  if (plan.HasParseError() || !plan.IsObject()) return error_json(0, "invalid plan", 400);
  int repeats = plan.HasMember("repeats") ? plan["repeats"].GetInt() : 5;

  rapidjson::StringBuffer config_buffer;
  {
    rapidjson::Writer<rapidjson::StringBuffer> w(config_buffer);
    plan["config"].Accept(w);
  }

  rapidjson::StringBuffer out;
  rapidjson::Writer<rapidjson::StringBuffer> w(out);
  w.StartObject();
  write_memory(w, "memoryAtStart", memory_now());

  double started = now_ms(), cpu_started = thread_cpu_ms();
  char* error = nullptr;
  tf_router* router = tf_router_create(config_buffer.GetString(), &error);
  w.Key("createMs");
  w.Double(now_ms() - started);
  w.Key("createCpuMs");
  w.Double(thread_cpu_ms() - cpu_started);
  write_memory(w, "memoryAfterCreate", memory_now());
  if (!router) {
    w.Key("error");
    w.String(error ? error : "unknown");
    tf_string_free(error);
    w.EndObject();
    return out.GetString();
  }

  w.Key("cases");
  w.StartArray();
  for (auto& item : plan["cases"].GetArray()) {
    rapidjson::StringBuffer request;
    {
      rapidjson::Writer<rapidjson::StringBuffer> rw(request);
      item["request"].Accept(rw);
    }
    w.StartObject();
    w.Key("id");
    w.String(item["id"].GetString());
    std::vector<double> wall, cpu;
    int status = 0;
    std::string first_answer;
    for (int i = 0; i <= repeats; ++i) {
      double t = now_ms(), c = thread_cpu_ms();
      char* answer = tf_router_route(router, request.GetString(), &status);
      double dt = now_ms() - t, dc = thread_cpu_ms() - c;
      if (i == 0) {
        first_answer = answer;
        w.Key("firstMs");
        w.Double(dt);
        w.Key("firstCpuMs");
        w.Double(dc);
      } else {
        wall.push_back(dt);
        cpu.push_back(dc);
      }
      tf_string_free(answer);
    }
    w.Key("status");
    w.Int(status);
    w.Key("warmMedianMs");
    w.Double(median(wall));
    w.Key("warmMaxMs");
    w.Double(wall.empty() ? -1 : *std::max_element(wall.begin(), wall.end()));
    w.Key("warmMedianCpuMs");
    w.Double(median(cpu));
    w.Key("answerBytes");
    w.Uint64(first_answer.size());
    rapidjson::Document answer;
    answer.Parse(first_answer.c_str());
    if (!answer.HasParseError() && answer.HasMember("trip")) {
      const auto& summary = answer["trip"]["summary"];
      w.Key("lengthKm");
      w.Double(summary["length"].GetDouble());
      w.Key("timeS");
      w.Double(summary["time"].GetDouble());
      size_t maneuvers = 0;
      for (const auto& leg : answer["trip"]["legs"].GetArray())
        maneuvers += leg["maneuvers"].Size();
      w.Key("maneuvers");
      w.Uint64(maneuvers);
    } else {
      w.Key("answer");
      w.String(first_answer.c_str());
    }
    if (item.HasMember("keepAnswer") && item["keepAnswer"].GetBool()) {
      w.Key("raw");
      w.String(first_answer.c_str());
    }
    write_memory(w, "memoryAfter", memory_now());
    w.EndObject();
  }
  w.EndArray();
  tf_router_destroy(router);
  write_memory(w, "memoryAfterDestroy", memory_now());
  w.EndObject();
  return out.GetString();
}

struct bench_call {
  std::string plan;
  std::string result;
};

void* bench_thread(void* arg) {
  auto* call = static_cast<bench_call*>(arg);
  call->result = bench(call->plan);
  return nullptr;
}

} // namespace

extern "C" {

tf_router* tf_router_create(const char* config_json, char** error) {
  try {
    boost::property_tree::ptree config;
    std::stringstream stream(config_json);
    rapidjson::read_json(stream, config);
    auto router = std::make_unique<tf_router>();
    // auto_cleanup releases each worker's per-request state after every call.
    router->actor = std::make_unique<valhalla::tyr::actor_t>(config, true);
    return router.release();
  } catch (const std::exception& e) {
    if (error) *error = dup(e.what());
    return nullptr;
  }
}

char* tf_router_route(tf_router* router, const char* request_json, int* status) {
  try {
    std::string answer = router->actor->route(request_json);
    if (status) *status = 200;
    return dup(answer);
  } catch (const valhalla::valhalla_exception_t& e) {
    if (status) *status = static_cast<int>(e.http_code);
    return dup(error_json(e.code, e.message, e.http_code));
  } catch (const std::exception& e) {
    if (status) *status = 500;
    return dup(error_json(0, e.what(), 500));
  }
}

void tf_router_destroy(tf_router* router) {
  delete router;
}

void tf_string_free(char* value) {
  std::free(value);
}

char* tf_bench_run(const char* plan_json) {
  // Valhalla's searches recurse little, but the caller's thread may be small (512 KiB on iOS
  // secondary threads); run on a thread with a known stack.
  bench_call call{plan_json, {}};
  pthread_attr_t attr;
  pthread_attr_init(&attr);
  pthread_attr_setstacksize(&attr, 8 * 1024 * 1024);
  pthread_t thread;
  pthread_create(&thread, &attr, bench_thread, &call);
  pthread_join(thread, nullptr);
  pthread_attr_destroy(&attr);
  return dup(call.result);
}

} // extern "C"
