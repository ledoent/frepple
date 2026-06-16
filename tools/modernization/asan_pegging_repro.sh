#!/usr/bin/env bash
# Reproduce the pegging-alternate crash under Linux Debug+ASan and capture a
# symbolized backtrace. Runs INSIDE ubuntu:24.04 with:
#   - the macOS repo bind-mounted read-only at /frepple
#   - a persistent host scratch dir bind-mounted at /work (clean Linux build tree)
# so rebuilds after a source edit are incremental.
set -uxo pipefail

export DEBIAN_FRONTEND=noninteractive
if ! command -v cmake >/dev/null; then
  apt-get update -qq
  apt-get install -y -qq cmake g++ git libxerces-c-dev libssl-dev libpq-dev \
    python3 python3-dev python3-venv binutils rsync >/dev/null
fi

# One-time: seed /work with a clean copy (no macOS venv / build / native binaries).
if [ ! -f /work/.seeded ]; then
  rsync -a --delete \
    --exclude='/venv/' --exclude='/build/' --exclude='/node_modules/' \
    --exclude='/bin/frepple' --exclude='/bin/libfrepple.*' \
    /frepple/ /work/
  touch /work/.seeded
fi

cmake -B /work/build -S /work -DCMAKE_BUILD_TYPE=Debug
# The engine's static libs have a build-order dep on the 'venv' target, which
# pip-installs dev requirements. We don't need that to compile/run the C++
# engine, so satisfy the stamp to skip it (fast, deterministic).
python3 -m venv /work/venv >/dev/null 2>&1 || true
touch /work/build/venv.stamp 2>/dev/null || true
cmake --build /work/build -j"$(nproc)"

export FREPPLE_DATE_STYLE="day-month-year"
export ASAN_OPTIONS="detect_leaks=0:halt_on_error=1:abort_on_error=1:symbolize=1"
cd /work/test
echo "===== RUNNING pegging_4/5/7 UNDER ASAN ====="
./runtest.py pegging_4 pegging_5 pegging_7 -d
echo "===== runtest exit: $? ====="
