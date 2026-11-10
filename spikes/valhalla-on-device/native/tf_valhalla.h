// A minimal C surface over Valhalla's actor for on-device routing measurements.
#pragma once

#ifdef __cplusplus
extern "C" {
#endif

typedef struct tf_router tf_router;

// Creates a router from a complete Valhalla configuration (JSON text). The configuration's
// mjolnir.tile_extract names the graph archive. Returns NULL and sets *error (free it with
// tf_string_free) when the configuration or the archive cannot be opened.
tf_router* tf_router_create(const char* config_json, char** error);

// Runs Valhalla's route action on a JSON request. Returns Valhalla's JSON answer, or an error
// object {"error_code", "error", "status_code"} with *status set to the HTTP-like status.
char* tf_router_route(tf_router* router, const char* request_json, int* status);

void tf_router_destroy(tf_router* router);
void tf_string_free(char* value);

// Runs a measurement plan (see bench/README in the spike) and returns its results as JSON.
// `plan_json` holds the configuration, the cases and the repetitions.
char* tf_bench_run(const char* plan_json);

#ifdef __cplusplus
}
#endif
