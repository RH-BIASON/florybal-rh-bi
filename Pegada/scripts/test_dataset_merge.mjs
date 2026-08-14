import assert from "node:assert/strict";
import test from "node:test";

import { mergePayrollDatasets, normalizeVacationScheduleCompetence } from "../server/datasetMerge.js";
import { classifyVacationUrgency } from "../src/vacationUrgency.js";

test("keeps vacation schedule in the competence printed by the report", () => {
  const dataset = normalizeVacationScheduleCompetence({
    periods: ["2026-08"],
    employees: [],
    provisions: [],
    vacationSchedule: [{ period: { key: "2026-08", label: "08/2026", start: "2026-08-01", end: "2026-08-07", positionDate: "2026-08-07" } }],
    reportImports: [{ reportType: "vacation_schedule", period: { key: "2026-08", label: "08/2026", start: "2026-08-01", end: "2026-08-07", positionDate: "2026-08-07" } }],
  });

  assert.equal(dataset.vacationSchedule[0].period.key, "2026-08");
  assert.equal(dataset.vacationSchedule[0].period.positionDate, "2026-08-07");
  assert.equal(dataset.reportImports[0].period.key, "2026-08");
  assert.deepEqual(dataset.periods, []);
});

test("keeps schedules already stored with the corrected competence", () => {
  const period = { key: "2026-07", label: "07/2026", start: "2026-07-01", end: "2026-08-07", positionDate: "2026-08-07" };
  const dataset = normalizeVacationScheduleCompetence({ periods: ["2026-07"], employees: [], provisions: [], vacationSchedule: [{ period }], reportImports: [] });
  assert.equal(dataset.vacationSchedule[0].period.key, "2026-07");
  assert.equal(dataset.vacationSchedule[0].period.positionDate, "2026-08-07");
  assert.deepEqual(dataset.periods, []);
});

test("classifies vacation urgency from the current business date instead of the report horizon", () => {
  assert.deepEqual(classifyVacationUrgency("2026-08-13", 10, "2026-08-14"), { urgency: "Vencido", daysToDeadline: -1 });
  assert.deepEqual(classifyVacationUrgency("2026-10-01", 10, "2026-08-14"), { urgency: "Até 2 meses", daysToDeadline: 48 });
  assert.deepEqual(classifyVacationUrgency("2026-11-01", 10, "2026-08-14"), { urgency: "No prazo", daysToDeadline: 79 });
});

test("rebuilds unclassified events from active employees without historical duplicates", () => {
  const period = { key: "2026-07", label: "07/2026" };
  const employee = {
    id: "new:1",
    sourceFile: "new.pdf",
    sourcePage: 1,
    period,
    branch: { code: "0005", label: "0005 - Pegada Nordeste" },
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

test("replaces only the imported report type in the same competence", () => {
  const period = { key: "2026-07", label: "07/2026" };
  const branch = { code: "0005", label: "0005 - Pegada Nordeste" };
  const employee = { id: "payroll:1", sourceFile: "folha.pdf", period, branch, contract: "1", name: "COLABORADOR", totals: { gross: 100, discounts: 10, net: 90 }, validation: [], unclassifiedEvents: [] };
  const vacation = { id: "vacation:1", reportType: "vacation_provision", sourceFile: "ferias.pdf", period, branch, total: 100 };
  const thirteenth = { id: "thirteenth:1", reportType: "thirteenth_provision", sourceFile: "13.pdf", period, branch, total: 200 };
  const base = {
    employees: [employee], provisions: [vacation], provisionSummaries: [], vacationSchedule: [], chargeSummaries: [], branches: [branch], periods: [period.key],
    reportImports: [{ reportType: "payroll", period, sourceFile: "folha.pdf" }, { reportType: "vacation_provision", period, sourceFile: "ferias.pdf" }],
    quality: { reconciliation: [], diagnostics: [] },
  };
  const imported = {
    employees: [], provisions: [thirteenth], provisionSummaries: [], vacationSchedule: [], chargeSummaries: [], branches: [branch], periods: [period.key],
    reportImports: [{ reportType: "thirteenth_provision", period, sourceFile: "13.pdf" }],
    quality: { reconciliation: [], diagnostics: [] },
  };

  const merged = mergePayrollDatasets(base, imported);
  assert.equal(merged.employees.length, 1);
  assert.deepEqual(merged.provisions.map((item) => item.reportType).sort(), ["thirteenth_provision", "vacation_provision"]);
  assert.equal(merged.reportImports.length, 3);
});
