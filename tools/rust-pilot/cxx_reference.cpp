// Parity authority for the Rust pilot (Engine track E4). Standalone (no
// libfrepple): replicates the number-conversion semantics VERBATIM from
// src/utils/json.cpp:790-890 — the JSON_DOUBLE clamp branches of getLong /
// getInt / getUnsignedLong and the JSON_STRING (atol) branch — so the Rust
// implementation can be diffed against the real C++ behaviour, not a
// hand-authored expectation.
//
//   NOTE: keep in sync with src/utils/json.cpp if those getters change.
//   Build:  g++ -O2 -o cxx_reference cxx_reference.cpp
//   Usage:  cxx_reference <long|int|ulong|parse_long> <value>
#include <climits>
#include <cstdio>
#include <cstdlib>
#include <string>

int main(int argc, char** argv) {
  if (argc < 3) {
    fprintf(stderr, "usage: %s <long|int|ulong|parse_long> <value>\n", argv[0]);
    return 2;
  }
  const std::string op = argv[1];

  // JSON_STRING branch: atol (json.cpp:810/835/885).
  if (op == "parse_long") {
    printf("%ld\n", atol(argv[2]));
    return 0;
  }

  const double data_double = strtod(argv[2], nullptr);
  if (op == "long") {
    // getLong, JSON_DOUBLE (json.cpp:803-808).
    if (data_double > LONG_MAX)
      printf("%ld\n", LONG_MAX);
    else if (data_double < LONG_MIN)
      printf("%ld\n", LONG_MIN);
    else
      printf("%ld\n", static_cast<long>(data_double));
  } else if (op == "int") {
    // getInt, JSON_DOUBLE (json.cpp:878-883).
    if (data_double > INT_MAX)
      printf("%d\n", INT_MAX);
    else if (data_double < INT_MIN)
      printf("%d\n", INT_MIN);
    else
      printf("%d\n", static_cast<int>(data_double));
  } else if (op == "ulong") {
    // getUnsignedLong, JSON_DOUBLE (json.cpp:830-833). Note: no lower clamp -
    // a negative double here is undefined/wraps; the parity test only feeds
    // this op non-negative, in-range values.
    if (data_double > static_cast<double>(ULONG_MAX))
      printf("%lu\n", ULONG_MAX);
    else
      printf("%lu\n", static_cast<unsigned long>(static_cast<long>(data_double)));
  } else {
    fprintf(stderr, "unknown op: %s\n", op.c_str());
    return 2;
  }
  return 0;
}
