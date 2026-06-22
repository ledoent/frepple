// Config for the Problems / Constraints screen (Phase 3). Both the problem and
// constraint output reports share the same flat columns (entity / name / owner /
// description / start / end), so one column set serves a two-tab screen.

import { fmtDate, type Column } from "./records";

export const PROBLEM_COLUMNS: Column[] = [
  { key: "entity", label: "Entity" },
  { key: "name", label: "Name" },
  { key: "owner", label: "Owner" },
  { key: "description", label: "Description" },
  { key: "startdate", label: "Start", format: fmtDate },
  { key: "enddate", label: "End", format: fmtDate },
];

export const PROBLEM_TABS = [
  { key: "problem", label: "Problems", endpoint: "/api/output/problem/" },
  { key: "constraint", label: "Constraints", endpoint: "/api/output/constraint/" },
] as const;
