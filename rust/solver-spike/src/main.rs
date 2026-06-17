//! Solver spike (Engine track): can an advanced optimization engine, driven from
//! Rust, power a greenfield *finite-capacity* planning mode for frePPLe?
//!
//! frePPLe's shipping MRP solver is a fast *constructive heuristic* — it pegs
//! demand to supply operation-by-operation and is excellent at feasibility, but
//! it does not optimise a global objective. The classic problem where that gap
//! shows is **capacitated production planning**: when a resource is tight, the
//! cheapest feasible plan pre-builds inventory in slack periods. A heuristic that
//! plans lot-for-lot can't see that trade-off; an optimiser finds it exactly.
//!
//! This spike models a small multi-period, multi-product capacitated lot-sizing
//! LP with the `good_lp` modelling layer (pure-Rust `microlp` backend) and
//! compares the optimal cost against a lot-for-lot heuristic — the kind of plan a
//! naive MRP pass produces. The same model object swaps to HiGHS / CBC / SCIP
//! behind a `good_lp` feature flag when scale demands a heavier solver.

use good_lp::{constraint, variable, variables, Expression, Solution, SolverModel};

/// A tiny but non-trivial instance: 2 products over 4 periods, one shared
/// capacity-constrained resource. Demand spikes in the last period beyond what
/// the resource can make in a single period — so a feasible plan MUST pre-build.
struct Instance {
    periods: usize,
    products: usize,
    demand: Vec<Vec<f64>>,  // [product][period]
    prod_cost: Vec<f64>,    // per unit produced
    hold_cost: Vec<f64>,    // per unit of end-of-period inventory
    res_per_unit: Vec<f64>, // resource units consumed per unit produced
    capacity: Vec<f64>,     // resource units available [period]
}

fn demo_instance() -> Instance {
    Instance {
        periods: 4,
        products: 2,
        // P1 ramps to a spike in period 4; P2 steady. The spike exceeds one
        // period's capacity once P2 is accounted for, forcing a pre-build.
        demand: vec![
            vec![20.0, 20.0, 20.0, 60.0], // product 1
            vec![15.0, 15.0, 15.0, 15.0], // product 2
        ],
        prod_cost: vec![1.0, 1.0],
        hold_cost: vec![0.2, 0.2],
        res_per_unit: vec![1.0, 1.0],
        // 50 units/period of the shared resource. Period-4 demand = 60+15 = 75 > 50,
        // so it can't all be made in period 4: a feasible plan builds ahead.
        capacity: vec![50.0, 50.0, 50.0, 50.0],
    }
}

/// Solve the capacitated lot-sizing LP to optimality. Returns (total_cost, plan)
/// where plan[product][period] is the optimal production quantity.
fn solve_optimal(inst: &Instance) -> (f64, Vec<Vec<f64>>) {
    let (np, nt) = (inst.products, inst.periods);
    let mut vars = variables!();

    // Decision vars: production x[p][t] >= 0 and end inventory inv[p][t] >= 0.
    let x: Vec<Vec<_>> = (0..np)
        .map(|_| (0..nt).map(|_| vars.add(variable().min(0.0))).collect())
        .collect();
    let inv: Vec<Vec<_>> = (0..np)
        .map(|_| (0..nt).map(|_| vars.add(variable().min(0.0))).collect())
        .collect();

    // Objective: minimise production + holding cost.
    let mut objective = Expression::from(0.0);
    for p in 0..np {
        for t in 0..nt {
            objective += inst.prod_cost[p] * x[p][t] + inst.hold_cost[p] * inv[p][t];
        }
    }

    let mut model = vars.minimise(objective).using(good_lp::default_solver);

    // Inventory balance: inv[p][t] = inv[p][t-1] + x[p][t] - demand[p][t].
    for p in 0..np {
        for t in 0..nt {
            let prev: Expression = if t == 0 { 0.0.into() } else { inv[p][t - 1].into() };
            model = model.with(constraint!(inv[p][t] == prev + x[p][t] - inst.demand[p][t]));
        }
    }
    // Finite capacity: sum_p res_per_unit[p] * x[p][t] <= capacity[t].
    for t in 0..nt {
        let mut load = Expression::from(0.0);
        for p in 0..np {
            load += inst.res_per_unit[p] * x[p][t];
        }
        model = model.with(constraint!(load <= inst.capacity[t]));
    }

    let sol = model.solve().expect("LP should be feasible");
    let plan: Vec<Vec<f64>> = x
        .iter()
        .map(|row| row.iter().map(|v| sol.value(*v)).collect())
        .collect();
    let cost = total_cost(inst, &plan);
    (cost, plan)
}

/// The naive lot-for-lot plan: make exactly each period's demand, ignoring the
/// capacity-smoothing opportunity. This is what a feasibility-first MRP pass
/// produces. It may be INFEASIBLE on capacity (we report the overload).
fn lot_for_lot(inst: &Instance) -> (f64, Vec<Vec<f64>>, Vec<f64>) {
    let plan: Vec<Vec<f64>> = inst.demand.clone();
    let mut overload = vec![0.0; inst.periods];
    for t in 0..inst.periods {
        let load: f64 = (0..inst.products).map(|p| inst.res_per_unit[p] * plan[p][t]).sum();
        overload[t] = (load - inst.capacity[t]).max(0.0);
    }
    (total_cost(inst, &plan), plan, overload)
}

/// Production + holding cost of a plan, carrying inventory forward.
fn total_cost(inst: &Instance, plan: &[Vec<f64>]) -> f64 {
    let mut cost = 0.0;
    for p in 0..inst.products {
        let mut inv = 0.0;
        for t in 0..inst.periods {
            inv += plan[p][t] - inst.demand[p][t];
            if inv < 0.0 {
                inv = 0.0; // unmet demand isn't held (lot-for-lot meets each period)
            }
            cost += inst.prod_cost[p] * plan[p][t] + inst.hold_cost[p] * inv;
        }
    }
    cost
}

fn main() {
    let inst = demo_instance();

    let (lfl_cost, lfl_plan, overload) = lot_for_lot(&inst);
    let (opt_cost, opt_plan) = solve_optimal(&inst);

    println!("Capacitated production-planning spike (good_lp + microlp)\n");
    println!(
        "Instance: {} products x {} periods, shared capacity {:?}\n",
        inst.products, inst.periods, inst.capacity
    );

    println!("Lot-for-lot (feasibility-first heuristic, like a naive MRP pass):");
    print_plan(&inst, &lfl_plan);
    let infeasible: f64 = overload.iter().sum();
    if infeasible > 0.0 {
        println!("  ! capacity OVERLOAD per period: {:?}", overload);
        println!("    -> the lot-for-lot plan is INFEASIBLE on the tight resource.");
    }
    println!("  cost (if it were feasible): {:.2}\n", lfl_cost);

    println!("Optimal (capacitated LP, microlp):");
    print_plan(&inst, &opt_plan);
    println!("  cost: {:.2}", opt_cost);
    println!("  -> capacity-feasible, pre-builds ahead of the period-4 spike.\n");

    println!(
        "Optimiser vs heuristic: feasible where lot-for-lot overloads by {:.0} units; \
         optimum {:.2} vs naive {:.2}.",
        infeasible, opt_cost, lfl_cost
    );
}

fn print_plan(inst: &Instance, plan: &[Vec<f64>]) {
    for p in 0..inst.products {
        let row: Vec<String> = plan[p].iter().map(|v| format!("{:5.1}", v)).collect();
        println!("  product {}: produce [{}]", p + 1, row.join(", "));
    }
}
