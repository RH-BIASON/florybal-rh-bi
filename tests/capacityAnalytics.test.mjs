import assert from "node:assert/strict";
import test from "node:test";
import { buildCapacityAnalytics as buildFlorybalCapacity } from "../Florybal/src/capacityAnalytics.js";
import { buildCapacityAnalytics as buildPegadaCapacity } from "../Pegada/src/capacityAnalytics.js";

function employee({ period, branchCode, contract, role, overtime = [], absence = [], reflexValue = 0 }) {
  const absenceEvents = [
    ...absence,
    { code: "00203", description: "Repousos Descontados", quantity: 8, value: 80 },
  ];
  return {
    period: { key: period, label: period === "2026-07" ? "07/2026" : "08/2026" },
    branch: { code: branchCode, label: `${branchCode} - Filial`, cnpj: `00.000.000/${branchCode}-00` },
    contract,
    jobTitle: role,
    events: [...overtime, ...absenceEvents],
    overtime: {
      hours: overtime.reduce((total, event) => total + event.quantity, 0),
      value: overtime.reduce((total, event) => total + event.value, 0),
      reflexValue,
      events: overtime,
    },
    absence: {
      hours: absence.reduce((total, event) => total + event.quantity, 0),
      value: absenceEvents.reduce((total, event) => total + event.value, 0),
      events: absenceEvents,
    },
  };
}

const paid = (hours, value) => ({ code: "00025", description: "Horas Extras 50%", quantity: hours, value });
const bank = (hours, value) => ({ code: "00127", description: "Banco de Horas 50%", quantity: hours, value });
const missing = (hours, value) => ({ code: "00201", description: "Faltas não Justificadas", quantity: hours, value });
const late = (hours, value) => ({ code: "00202", description: "Meias Faltas ou Atrasos", quantity: hours, value });

const rows = [
  employee({ period: "2026-07", branchCode: "0001", contract: "1", role: "Produção", overtime: [paid(10, 100)], absence: [missing(8, 80)], reflexValue: 10 }),
  employee({ period: "2026-07", branchCode: "0001", contract: "2", role: "Produção", overtime: [bank(4, 40)] }),
  employee({ period: "2026-07", branchCode: "0002", contract: "3", role: "Expedição", absence: [late(6, 60)] }),
  employee({ period: "2026-08", branchCode: "0001", contract: "1", role: "Produção", overtime: [paid(2, 20)], absence: [late(2, 20)] }),
];

for (const [name, buildCapacity] of [["Pegada", buildPegadaCapacity], ["Florybal", buildFlorybalCapacity]]) {
  test(`${name}: calcula confronto, banco e incidência por colaborador-mês`, () => {
    const result = buildCapacity(rows);
    assert.equal(result.employeeMonths, 4);
    assert.equal(result.overtimeHours, 16);
    assert.equal(result.paidOvertimeHours, 12);
    assert.equal(result.bankHours, 4);
    assert.equal(result.absenceHours, 16);
    assert.equal(result.coveragePercent, 100);
    assert.equal(result.balanceHours, 0);
    assert.equal(result.overtimeCost, 170);
    assert.equal(result.withOvertime, 3);
    assert.equal(result.withAbsence, 3);
    assert.equal(result.withBoth, 2);
    assert.equal(result.overlapOfOvertimePercent, 66.67);
    assert.equal(result.byPeriod.length, 2);
  });

  test(`${name}: exclui repouso descontado das horas de faltas`, () => {
    const result = buildCapacity(rows);
    assert.equal(result.absenceHours, 16);
    assert.equal(result.absenceValue, 160);
  });

  test(`${name}: normaliza filiais e classifica quadrantes`, () => {
    const result = buildCapacity(rows);
    const branch1 = result.byBranch.find((item) => item.key === "0001");
    const branch2 = result.byBranch.find((item) => item.key === "0002");
    assert.equal(branch1.employeeMonths, 3);
    assert.equal(branch1.overtimePer100, 533.33);
    assert.equal(branch1.quadrant, "Demanda ou quadro insuficiente");
    assert.equal(branch2.absencePer100, 600);
    assert.equal(branch2.quadrant, "Risco de capacidade");
  });

  test(`${name}: não inventa comparação quando há somente uma filial`, () => {
    const result = buildCapacity(rows.filter((item) => item.branch.code === "0001"));
    assert.equal(result.byBranch[0].quadrant, "Unidade selecionada");
  });
}
