"use client";

import TabListScreen from "@/components/TabListScreen";
import { PROBLEM_COLUMNS, PROBLEM_TABS } from "@/lib/problems";

// Problems / Constraints screen (Phase 3): the violation lists the engine flags —
// late demands, capacity overloads, material shortages. Two tabs, shared columns.
export default function ProblemsPage() {
  return (
    <TabListScreen
      eyebrow="Plan analysis"
      title="Problems"
      subtitle="Constraint violations and plan issues the engine flagged — what to fix, and when it bites."
      path="/problems"
      tabs={[...PROBLEM_TABS]}
      columns={PROBLEM_COLUMNS}
      emptyText="NO PROBLEMS — A CLEAN PLAN, OR NONE COMPUTED YET"
    />
  );
}
