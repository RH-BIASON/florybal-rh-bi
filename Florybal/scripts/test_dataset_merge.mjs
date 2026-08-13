import assert from "node:assert/strict";
import test from "node:test";

import { mergePayrollDatasets, normalizeVacationScheduleCompetence } from "../server/datasetMerge.js";

test("normalizes legacy vacation schedule to the month before its position date", () => {
  const dataset = normalizeVacationScheduleCompetence({
    periods: ["2026-08"],
    employees: [],
    provisions: [],
    vacationSchedule: [{ period: { key: "2026-08", label: "08/2026", start: "2026-08-01", end: "2026-08-07" } }],
    reportImports: [{ reportType: "vacation_schedule", period: { key: "2026-08", label: "08/2026", start: "2026-08-01", end: "2026-08-07" } }],
  });

  assert.equal(dataset.vacationSchedule[0].period.key, "2026-07");
  assert.equal(dataset.vacationSchedule[0].period.positionDate, "2026-08-07");
  assert.equal(dataset.reportImports[0].period.key, "2026-07");
  assert.deepEqual(dataset.periods, ["2026-07"]);
});

test("keeps schedules already stored with the corrected competence", () => {
  const period = { key: "2026-07", label: "07/2026", start: "2026-07-01", end: "2026-08-07", positionDate: "2026-08-07" };
  const dataset = normalizeVacationScheduleCompetence({ periods: ["2026-07"], employees: [], provisions: [], vacationSchedule: [{ period }], reportImports: [] });
  assert.equal(dataset.vacationSchedule[0].period.key, "2026-07");
  assert.equal(dataset.vacationSchedule[0].period.positionDate, "2026-08-07");
});

test("rebuilds unclassified events from active employees without historical duplicates", () => {
  const period = { key: "2026-07", label: "07/2026" };
  const employee = {
    id: "new:1",
    sourceFile: "new.pdf",
    sourcePage: 1,
    period,
    branch: { code: "000", label: "000 - MATRIZ" },
    contract: "1",
    name: "COLABORADOR",
    totals: { gross: 100, discounts: 0, net: 100 },
    validation: [],
    unclassifiedEvents: [{ code: "99999", description: "Nova verba", quantity: 1, value: 10 }],
  };
  const base = {
    periods: ["2026-07"], employees: [{ ...employee, id: "old:1", sourceFile: "old.pdf" }], provisions: [], vacationSchedule: [],
    reportImports: [{ reportType: "payroll", period }], quality: { unclassifiedEvents: [{ code: "99999", description: "Nova verba", count: 4, value: 40 }] },
  };
  const imported = {
    periods: ["2026-07"], employees: [employee], provisions: [], vacationSchedule: [],
    reportImports: [{ reportType: "payroll", period }], quality: { reconciliation: [], diagnostics: [], unclassifiedEvents: [] },
  };

  const merged = mergePayrollDatasets(base, imported);
  assert.equal(merged.quality.unclassifiedEvents.length, 1);
  assert.equal(merged.quality.unclassifiedEvents[0].count, 1);
  assert.equal(merged.quality.unclassifiedEvents[0].value, 10);
});
