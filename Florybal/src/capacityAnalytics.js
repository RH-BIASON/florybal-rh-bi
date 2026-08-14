const round = (value, digits = 2) => Number(Number(value || 0).toFixed(digits));

const sum = (items, getter) => items.reduce((total, item) => total + Number(getter(item) || 0), 0);

const normalizedDescription = (event) => String(event?.description || "").toLocaleLowerCase("pt-BR");

function directAbsenceEvents(item) {
  const events = item.events?.length ? item.events : item.absence?.events || [];
  return events.filter((event) => ["00201", "00202"].includes(String(event.code)));
}

function directAbsenceHours(item) {
  const events = directAbsenceEvents(item);
  const hasEventDetail = Boolean(item.events?.length || item.absence?.events?.length);
  return hasEventDetail ? sum(events, (event) => event.quantity) : Number(item.absence?.hours || 0);
}

function directAbsenceValue(item) {
  const events = directAbsenceEvents(item);
  const hasEventDetail = Boolean(item.events?.length || item.absence?.events?.length);
  return hasEventDetail ? sum(events, (event) => event.value) : Number(item.absence?.value || 0);
}

function overtimeBreakdown(item) {
  const events = item.overtime?.events || [];
  const eventHours = sum(events, (event) => event.quantity);
  const totalHours = Number(item.overtime?.hours || eventHours || 0);
  const bankHours = events.length
    ? sum(events, (event) => normalizedDescription(event).includes("banco") ? event.quantity : 0)
    : 0;
  return {
    totalHours,
    paidHours: Math.max(0, totalHours - bankHours),
    bankHours,
    value: Number(item.overtime?.value || sum(events, (event) => event.value) || 0),
    reflectionValue: Number(item.overtime?.reflexValue || sum(item.overtime?.reflexes || [], (event) => event.value) || 0),
  };
}

function percentileConcentration(entries, field, percentile = 0.2) {
  const values = entries.map((entry) => entry[field]).filter((value) => value > 0).sort((a, b) => b - a);
  const total = sum(values, (value) => value);
  if (!total) return 0;
  const count = Math.max(1, Math.ceil(entries.length * percentile));
  return round((sum(values.slice(0, count), (value) => value) / total) * 100);
}

function pearson(entries) {
  if (entries.length < 2) return null;
  const averageAbsence = sum(entries, (entry) => entry.absenceHours) / entries.length;
  const averageOvertime = sum(entries, (entry) => entry.overtimeHours) / entries.length;
  let numerator = 0;
  let absenceVariance = 0;
  let overtimeVariance = 0;
  for (const entry of entries) {
    const absenceDelta = entry.absenceHours - averageAbsence;
    const overtimeDelta = entry.overtimeHours - averageOvertime;
    numerator += absenceDelta * overtimeDelta;
    absenceVariance += absenceDelta ** 2;
    overtimeVariance += overtimeDelta ** 2;
  }
  const denominator = Math.sqrt(absenceVariance * overtimeVariance);
  return denominator ? round(numerator / denominator, 3) : null;
}

function median(values) {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!ordered.length) return 0;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function groupEntries(entries, keyGetter, labelGetter) {
  const groups = new Map();
  for (const entry of entries) {
    const key = keyGetter(entry) || "nao-informado";
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: labelGetter(entry) || "Não informado",
        branchCode: entry.branchCode,
        cnpj: entry.cnpj,
        employeeMonths: 0,
        overtimeHours: 0,
        absenceHours: 0,
        overtimeCost: 0,
        withOvertime: 0,
        withAbsence: 0,
      });
    }
    const group = groups.get(key);
    group.employeeMonths += 1;
    group.overtimeHours += entry.overtimeHours;
    group.absenceHours += entry.absenceHours;
    group.overtimeCost += entry.overtimeCost;
    if (entry.overtimeHours > 0) group.withOvertime += 1;
    if (entry.absenceHours > 0) group.withAbsence += 1;
  }
  return Array.from(groups.values()).map((group) => ({
    ...group,
    employeeMonths: group.employeeMonths,
    overtimeHours: round(group.overtimeHours),
    absenceHours: round(group.absenceHours),
    overtimeCost: round(group.overtimeCost),
    overtimePer100: round((group.overtimeHours / group.employeeMonths) * 100),
    absencePer100: round((group.absenceHours / group.employeeMonths) * 100),
    coveragePercent: group.absenceHours ? round((group.overtimeHours / group.absenceHours) * 100) : null,
  }));
}

export function buildCapacityAnalytics(rows = []) {
  const entries = rows.map((item) => {
    const overtime = overtimeBreakdown(item);
    const absenceHours = directAbsenceHours(item);
    return {
      period: item.period?.key || "",
      periodLabel: item.period?.label || item.period?.key || "-",
      branchCode: item.branch?.code || "-",
      branchLabel: item.branch?.label || item.branch?.name || "Sem filial",
      cnpj: item.branch?.cnpj || item.cnpj || "",
      contract: item.contract || "",
      role: item.jobTitle || "Cargo não informado",
      overtimeHours: overtime.totalHours,
      paidOvertimeHours: overtime.paidHours,
      bankHours: overtime.bankHours,
      overtimeValue: overtime.value,
      reflectionValue: overtime.reflectionValue,
      overtimeCost: overtime.value + overtime.reflectionValue,
      absenceHours,
      absenceValue: directAbsenceValue(item),
    };
  });

  const employeeMonths = entries.length;
  const overtimeHours = sum(entries, (entry) => entry.overtimeHours);
  const paidOvertimeHours = sum(entries, (entry) => entry.paidOvertimeHours);
  const bankHours = sum(entries, (entry) => entry.bankHours);
  const absenceHours = sum(entries, (entry) => entry.absenceHours);
  const overtimeValue = sum(entries, (entry) => entry.overtimeValue);
  const reflectionValue = sum(entries, (entry) => entry.reflectionValue);
  const absenceValue = sum(entries, (entry) => entry.absenceValue);
  const withOvertime = entries.filter((entry) => entry.overtimeHours > 0).length;
  const withAbsence = entries.filter((entry) => entry.absenceHours > 0).length;
  const withBoth = entries.filter((entry) => entry.overtimeHours > 0 && entry.absenceHours > 0).length;

  const byPeriod = groupEntries(entries, (entry) => entry.period, (entry) => entry.periodLabel)
    .map((item) => ({ ...item, period: item.key }))
    .sort((a, b) => a.period.localeCompare(b.period));
  const byRole = groupEntries(entries, (entry) => entry.role, (entry) => entry.role)
    .sort((a, b) => (b.absenceHours + b.overtimeHours) - (a.absenceHours + a.overtimeHours));
  const branchRows = groupEntries(entries, (entry) => entry.branchCode, (entry) => entry.branchLabel);
  const medianOvertime = median(branchRows.map((item) => item.overtimePer100));
  const medianAbsence = median(branchRows.map((item) => item.absencePer100));
  const byBranch = branchRows
    .map((item) => {
      if (branchRows.length === 1) return { ...item, quadrant: "Unidade selecionada" };
      const highOvertime = item.overtimePer100 > medianOvertime;
      const highAbsence = item.absencePer100 > medianAbsence;
      let quadrant = "Equilibrado";
      if (highOvertime && highAbsence) quadrant = "Pressão crítica";
      else if (highOvertime) quadrant = "Demanda ou quadro insuficiente";
      else if (highAbsence) quadrant = "Risco de capacidade";
      return { ...item, quadrant };
    })
    .sort((a, b) => b.absencePer100 - a.absencePer100);

  return {
    employeeMonths,
    overtimeHours: round(overtimeHours),
    paidOvertimeHours: round(paidOvertimeHours),
    bankHours: round(bankHours),
    absenceHours: round(absenceHours),
    balanceHours: round(absenceHours - overtimeHours),
    coveragePercent: absenceHours ? round((overtimeHours / absenceHours) * 100) : null,
    overtimeValue: round(overtimeValue),
    reflectionValue: round(reflectionValue),
    overtimeCost: round(overtimeValue + reflectionValue),
    absenceValue: round(absenceValue),
    overtimePer100: employeeMonths ? round((overtimeHours / employeeMonths) * 100) : 0,
    absencePer100: employeeMonths ? round((absenceHours / employeeMonths) * 100) : 0,
    withOvertime,
    withAbsence,
    withBoth,
    overlapOfOvertimePercent: withOvertime ? round((withBoth / withOvertime) * 100) : 0,
    overlapOfAbsencePercent: withAbsence ? round((withBoth / withAbsence) * 100) : 0,
    overtimeIncidencePercent: employeeMonths ? round((withOvertime / employeeMonths) * 100) : 0,
    absenceIncidencePercent: employeeMonths ? round((withAbsence / employeeMonths) * 100) : 0,
    overtimeTop20Share: percentileConcentration(entries, "overtimeHours"),
    absenceTop20Share: percentileConcentration(entries, "absenceHours"),
    correlation: pearson(entries),
    medianOvertime: round(medianOvertime),
    medianAbsence: round(medianAbsence),
    byPeriod,
    byRole,
    byBranch,
  };
}
