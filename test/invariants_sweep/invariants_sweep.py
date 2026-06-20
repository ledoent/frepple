# Engine track E2 - structural-invariant sweep. Loads each model below DATA-ONLY
# (no embedded python), solves it fully constrained, and asserts the shared
# test/invariants.py invariants. One process, many models, full control of the
# solve mode - so every invariant applies. A boolean pass/fail oracle (emits a
# deterministic INVARIANTS_OK), robust to the environment-dependent output ORDER
# that blocks byte-exact golden coverage (engine-review-E1.md H4). Reset between
# models with frepple.erase(True).
import sys, os

_testroot = os.path.dirname(os.getcwd())   # test/ (cwd is test/invariants_sweep)
if _testroot not in sys.path:
    sys.path.insert(0, _testroot)
import invariants

# Validated false-positive-free, solved constrained (see PR / E2 notes).
MODELS = [
    "constraints_resource_1", "constraints_resource_3", "constraints_resource_5",
    "constraints_material_1", "constraints_material_3",
    "constraints_combined_1", "constraints_leadtime_1",
    "pegging_5", "demand_policy", "safety_stock", "flow_alternate_1",
]
verbose = bool(os.environ.get("INV_VERBOSE"))

failures = []
for m in MODELS:
    model = os.path.join(_testroot, m, m + ".xml")
    frepple.erase(True)
    frepple.readXMLfile(model, False, False, None, False)
    frepple.solver_mrp(plantype=1, constraints=15, loglevel=0).solve()
    v = invariants.check(capacity_constrained=True)
    if verbose:
        print("%-26s %s" % (m, "OK" if not v else ("FAIL: " + "; ".join(v))))
    if v:
        failures.append("%s -> %s" % (m, "; ".join(v)))

if failures:
    raise Exception("structural invariants violated in %d model(s): %s"
                    % (len(failures), " || ".join(failures)))

with open("output.1.xml", "wt") as out:
    print("INVARIANTS_OK", file=out)
