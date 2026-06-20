# Engine track E2 - stress scenario. Builds a large model (~N items, each a
# make-from-purchased-component with a demand), solves it fully constrained, and
# records operationplan count + solve time + peak memory. Regression-gated: a
# hard floor on the operationplan count (proves the stress size) plus GENEROUS
# ceilings on time/memory (catch catastrophic regressions - O(n^2) blowups,
# leaks - without flaking on CI-runner variance). Actual metrics are printed for
# trend tracking; the golden output is a deterministic STRESS_OK.
import datetime, time, os

N = 8000  # tune to keep operationplan count comfortably above 10k

frepple.settings.current = datetime.datetime(2024, 1, 1)
loc = frepple.location(name="factory")
cust = frepple.customer(name="cust")
sup = frepple.supplier(name="sup")
res = frepple.resource(name="machine", maximum=100000, location=loc)
due = datetime.datetime(2024, 3, 1)

t_build = time.time()
for i in range(N):
    it = frepple.item(name="I%d" % i)
    comp = frepple.item(name="C%d" % i)
    op = frepple.operation_fixed_time(name="make%d" % i, location=loc, item=it, duration=86400)
    # Flows are item-based; buffers are auto-created at the operation location.
    frepple.flow(operation=op, item=it, quantity=1, type="flow_end")       # produce the item
    frepple.flow(operation=op, item=comp, quantity=-1, type="flow_start")  # consume the component
    frepple.itemsupplier(item=comp, supplier=sup, location=loc, leadtime=7 * 86400)
    frepple.load(operation=op, resource=res, quantity=1)
    frepple.demand(name="D%d" % i, item=it, location=loc, quantity=10, due=due,
                   customer=cust, priority=1)
build_s = time.time() - t_build

t0 = time.time()
frepple.solver_mrp(constraints=15, plantype=1, loglevel=0).solve()
solve_s = time.time() - t0

count = sum(1 for _ in frepple.operationplans())

def peak_rss_mb():
    try:
        import resource
        kb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return kb / 1024.0  # Linux ru_maxrss is KB
    except Exception:
        try:
            for line in open("/proc/self/status"):
                if line.startswith("VmHWM:"):
                    return int(line.split()[1]) / 1024.0
        except Exception:
            return -1.0
    return -1.0

mb = peak_rss_mb()
# Recorded for trend-tracking (printed, not byte-asserted - timings vary by host).
print("STRESS items=%d operationplans=%d build_s=%.2f solve_s=%.2f peak_rss_mb=%.0f"
      % (N, count, build_s, solve_s, mb))

# Regression gate. The count is a hard, deterministic floor (proves the stress
# size). Time/memory use GENEROUS ceilings - they catch a catastrophic regression
# (an O(n^2) blow-up or a leak) without flaking on CI-runner variance. Baseline on
# an optimised Release build: ~24k operationplans, ~1.5 s solve, ~80 MB peak.
# NB: run in the Release suite only - excluded from engine-asan/engine-ubsan, where
# the Debug+sanitizer build makes this ~1000x slower (allocation-heavy at scale).
assert count >= 10000, "expected >= 10000 operationplans, got %d" % count
assert solve_s < 180.0, "solve regression: %.1fs (baseline ~1.5s; ceiling 180s)" % solve_s
if mb > 0:
    assert mb < 1500.0, "memory regression: %.0f MB peak (baseline ~80 MB; ceiling 1500 MB)" % mb

# Deterministic golden output (host-independent) so this is a stable golden test.
with open("output.1.xml", "wt") as out:
    print("STRESS_OK", file=out)
