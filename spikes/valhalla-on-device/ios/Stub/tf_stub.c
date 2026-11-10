// Baseline for the size comparison: the same app without Valhalla.
#include "../../native/tf_valhalla.h"
#include <stdlib.h>
#include <string.h>
char* tf_bench_run(const char* plan) { (void)plan; return strdup("{}"); }
void tf_string_free(char* value) { free(value); }
