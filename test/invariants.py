# Structural-invariant checks for a solved frePPLe plan (Engine track E2).
#
# `check()` inspects the CURRENT in-memory plan and returns a list of violation
# strings (empty == all invariants hold). A test script (e.g. test/invariants_sweep)
# solves, calls check(), and raises on any violation - so the assertion is a boolean pass/fail,
# independent of output ORDER (which is environment-dependent for some models; see
# tools/modernization/engine-review-E1.md H4). That makes it a true "rewrite oracle"
# the byte-exact golden diff can't be: it catches capacity/material/temporal
# violations the diff would miss, and is robust across build environments.
#
# Deliberately CONSERVATIVE. A plan has many *legitimate* outcomes - late or short
# deliveries (lead-time/capacity), over-deliveries (lot sizing), WIP buffers going
# negative - so asserting "demand met by due date" or "buffer never negative" would
# false-positive on valid plans (empirically confirmed). We assert only what must
# hold on EVERY valid plan. Validated false-positive-free across the
# constraints_*/pegging_5/demand_policy/safety_stock/flow_alternate golden models;
# the overload check is proven to fire when the capacity constraint is removed.

import frepple

TOL = 1e-6


def _infinite_buffer_type():
    # BufferInfinite is an unconstrained source; its onhand may go negative by
    # design, so the material invariant skips it. Returns the type or None.
    try:
        return frepple.buffer_infinite
    except AttributeError:
        return None


def check(capacity_constrained=True):
    """Invariant violations for the current solved plan (empty list == OK)."""
    violations = []
    binf = _infinite_buffer_type()

    # Index problems once: resource overloads and the buffers frePPLe itself
    # flagged with a material shortage.
    overloaded_resources = []
    shortage_buffers = set()
    for p in frepple.problems():
        name = p.name
        owner = getattr(p, "owner", None)
        owner_name = getattr(owner, "name", None)
        if name == "overload":
            overloaded_resources.append(owner_name or "?")
        elif name == "material shortage" and owner_name:
            shortage_buffers.add(owner_name)

    # I-1: operationplan temporal + quantity sanity (universal - holds always).
    for op in frepple.operationplans():
        if op.start > op.end:
            violations.append(
                "operationplan start after end: %s (%s > %s)"
                % (op.operation.name, op.start, op.end)
            )
        if op.quantity < -TOL:
            violations.append(
                "operationplan negative quantity: %s (%s)"
                % (op.operation.name, op.quantity)
            )

    # I-2: a capacity-constrained plan must leave no resource overloaded.
    if capacity_constrained:
        for name in overloaded_resources:
            violations.append("resource overloaded under capacity constraint: %s" % name)

    # I-3: a finite buffer may dip negative only if frePPLe flags a material
    #      shortage for it - otherwise the material balance is silently broken.
    if binf is not None:
        for buf in frepple.buffers():
            if isinstance(buf, binf):
                continue
            worst = min((fp.onhand for fp in buf.flowplans), default=0.0)
            if worst < -TOL and buf.name not in shortage_buffers:
                violations.append(
                    "buffer negative without a shortage problem: %s (min onhand %.4f)"
                    % (buf.name, worst)
                )

    return violations
