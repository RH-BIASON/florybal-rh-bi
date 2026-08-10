import assert from "node:assert/strict";
import test from "node:test";

import { normalizeVacationScheduleCompetence } from "../server/datasetMerge.js";

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
