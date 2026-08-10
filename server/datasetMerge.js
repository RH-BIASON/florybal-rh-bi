function sourcePeriodMap(dataset) {
  const map = new Map();
  for (const employee of dataset?.employees || []) {
    if (employee.sourceFile && employee.period?.key) map.set(employee.sourceFile, employee.period.key);
  }
  return map;
}

function periodOfSummary(item) {
  return item?.period?.key;
}

function uniqBy(items, getKey) {
  const map = new Map();
  for (const item of items || []) {
    const key = getKey(item);
    if (key) map.set(key, item);
  }
  return [...map.values()];
}

function sortPeriods(periods) {
  return [...new Set(periods || [])].sort((a, b) => a.localeCompare(b));
}

function sortBranches(branches) {
  return uniqBy(branches, (branch) => branch?.code).sort((a, b) => String(a.code).localeCompare(String(b.code)));
}

function keepOldQualityItems(oldItems, newPeriods, periodBySource) {
  return (oldItems || []).filter((item) => {
    const periodKey = item?.periodKey || item?.period?.key || periodBySource.get(item?.sourceFile);
    return !periodKey || !newPeriods.has(periodKey);
  });
}

function buildRecordsBySource(employees) {
  const totals = {};
  for (const employee of employees) {
    const sourceFile = employee.sourceFile || "sem-arquivo";
    if (!totals[sourceFile]) totals[sourceFile] = { employeeRecords: 0, gross: 0, discounts: 0, net: 0 };
    totals[sourceFile].employeeRecords += 1;
    totals[sourceFile].gross += employee.totals?.gross || 0;
    totals[sourceFile].discounts += employee.totals?.discounts || 0;
    totals[sourceFile].net += employee.totals?.net || 0;
  }
  return Object.fromEntries(
    Object.entries(totals).map(([sourceFile, values]) => [
      sourceFile,
      {
        employeeRecords: values.employeeRecords,
        gross: Number(values.gross.toFixed(2)),
        discounts: Number(values.discounts.toFixed(2)),
        net: Number(values.net.toFixed(2)),
      },
    ]),
  );
}

function rebuildQuality(baseDataset, importedDataset, employees, newPeriods) {
  const basePeriodBySource = sourcePeriodMap(baseDataset);
  const quality = {
    ...(baseDataset?.quality || {}),
    ...(importedDataset?.quality || {}),
  };
  const reconciliation = [
    ...keepOldQualityItems(baseDataset?.quality?.reconciliation, newPeriods, basePeriodBySource),
    ...(importedDataset?.quality?.reconciliation || []),
  ];
  const diagnostics = [
    ...keepOldQualityItems(baseDataset?.quality?.diagnostics, newPeriods, basePeriodBySource),
    ...(importedDataset?.quality?.diagnostics || []),
  ];
  const unclassifiedEvents = [
    ...keepOldQualityItems(baseDataset?.quality?.unclassifiedEvents, newPeriods, basePeriodBySource),
    ...(importedDataset?.quality?.unclassifiedEvents || []),
  ];
  const warnings = employees.flatMap((employee) =>
    (employee.validation || []).map((warning) => ({
      periodKey: employee.period?.key,
      periodLabel: employee.period?.label,
      branchCode: employee.branch?.code,
      employee: employee.name,
      contract: employee.contract,
      warning,
    })),
  );

  return {
    ...quality,
    employeeRecords: employees.length,
    recordsBySource: buildRecordsBySource(employees),
    reconciliation,
    reconciliationMatched: reconciliation.length ? reconciliation.every((item) => item.matched) : false,
    diagnostics,
    diagnosticCount: diagnostics.length,
    unclassifiedEvents,
    unclassifiedEventCount: unclassifiedEvents.length,
    warnings,
    warningCount: warnings.length,
  };
}

export function mergePayrollDatasets(baseDataset, importedDataset) {
  if (!baseDataset) return importedDataset;
  const baseReports = baseDataset.reportImports?.length
    ? baseDataset.reportImports
    : uniqBy(baseDataset.employees || [], (item) => `${item.sourceFile}:${item.period?.key}`).map((item) => ({
        reportType: "payroll",
        period: item.period,
        company: item.branch?.company || "",
        sourceFile: item.sourceFile,
        status: "read",
      }));
  const importedReports = importedDataset.reportImports?.length
    ? importedDataset.reportImports
    : (importedDataset.periods || []).map((period) => ({ reportType: "payroll", period: { key: period } }));
  const replacementKeys = new Set(importedReports.map((item) => `${item.reportType}:${item.period?.key}`).filter((key) => !key.endsWith(":")));
  const payrollPeriods = new Set(importedReports.filter((item) => item.reportType === "payroll").map((item) => item.period?.key));
  const replaces = (item, fallbackType) => replacementKeys.has(`${item.reportType || fallbackType}:${item.period?.key}`);
  const newPeriods = payrollPeriods;
  const preservedEmployees = (baseDataset.employees || []).filter((employee) => !newPeriods.has(employee.period?.key));
  const employees = [...preservedEmployees, ...(importedDataset.employees || [])].sort((a, b) => {
    const periodOrder = String(a.period?.key || "").localeCompare(String(b.period?.key || ""));
    if (periodOrder) return periodOrder;
    const branchOrder = String(a.branch?.code || "").localeCompare(String(b.branch?.code || ""));
    if (branchOrder) return branchOrder;
    return String(a.contract || "").localeCompare(String(b.contract || ""), undefined, { numeric: true });
  });

  const provisions = [
    ...(baseDataset.provisions || []).filter((item) => !replaces(item, "vacation_provision")),
    ...(importedDataset.provisions || []),
  ];
  const provisionSummaries = [
    ...(baseDataset.provisionSummaries || []).filter((item) => !replaces(item, "vacation_provision")),
    ...(importedDataset.provisionSummaries || []),
  ];
  const vacationSchedule = [
    ...(baseDataset.vacationSchedule || []).filter((item) => !replaces(item, "vacation_schedule")),
    ...(importedDataset.vacationSchedule || []),
  ];
  const reportImports = [
    ...baseReports.filter((item) => !replacementKeys.has(`${item.reportType}:${item.period?.key}`)),
    ...importedReports,
  ];
  const allRecords = [...employees, ...provisions, ...vacationSchedule];
  const periods = sortPeriods(allRecords.map((item) => item.period?.key).filter(Boolean));
  const branches = sortBranches(allRecords.map((item) => item.branch).filter(Boolean));
  const sources = [...new Set(reportImports.map((item) => item.sourceFile).filter(Boolean))];
  const chargeSummaries = [
    ...(baseDataset.chargeSummaries || []).filter((item) => !newPeriods.has(periodOfSummary(item))),
    ...(importedDataset.chargeSummaries || []),
  ];
  const sourceKey = new Map((baseDataset.reportImports || []).map((item) => [item.sourceFile, `${item.reportType}:${item.period?.key}`]));
  const oldReconciliation = (baseDataset.quality?.reconciliation || []).filter((item) => {
    const key = `${item.reportType || "payroll"}:${item.period?.key || sourcePeriodMap(baseDataset).get(item.sourceFile) || sourceKey.get(item.sourceFile)?.split(":")[1] || ""}`;
    return !replacementKeys.has(key);
  });
  const reconciliation = [...oldReconciliation, ...(importedDataset.quality?.reconciliation || [])];
  const quality = rebuildQuality(baseDataset, importedDataset, employees, newPeriods);
  quality.reconciliation = reconciliation;
  quality.reconciliationMatched = reconciliation.length ? reconciliation.every((item) => item.matched) : Boolean(vacationSchedule.length);

  return {
    ...baseDataset,
    ...importedDataset,
    generatedAt: new Date().toISOString(),
    sources,
    periods,
    branches,
    chargeSummaries,
    provisions,
    provisionSummaries,
    vacationSchedule,
    reportImports,
    employees,
    quality,
  };
}

export function removePayrollPeriods(baseDataset, periodKeys) {
  const removedPeriods = new Set(periodKeys || []);
  if (!baseDataset || !removedPeriods.size) return baseDataset;

  const employees = (baseDataset.employees || []).filter((employee) => !removedPeriods.has(employee.period?.key));
  const provisions = (baseDataset.provisions || []).filter((item) => !removedPeriods.has(item.period?.key));
  const provisionSummaries = (baseDataset.provisionSummaries || []).filter((item) => !removedPeriods.has(item.period?.key));
  const vacationSchedule = (baseDataset.vacationSchedule || []).filter((item) => !removedPeriods.has(item.period?.key));
  const reportImports = (baseDataset.reportImports || []).filter((item) => !removedPeriods.has(item.period?.key));
  const allRecords = [...employees, ...provisions, ...vacationSchedule];
  const periods = sortPeriods(allRecords.map((item) => item.period?.key).filter(Boolean));
  const branches = sortBranches(allRecords.map((item) => item.branch).filter(Boolean));
  const sources = [...new Set(reportImports.map((item) => item.sourceFile).filter(Boolean))];
  const chargeSummaries = (baseDataset.chargeSummaries || []).filter((item) => !removedPeriods.has(periodOfSummary(item)));

  return {
    ...baseDataset,
    generatedAt: new Date().toISOString(),
    sources,
    periods,
    branches,
    chargeSummaries,
    provisions,
    provisionSummaries,
    vacationSchedule,
    reportImports,
    employees,
    quality: rebuildQuality(baseDataset, { quality: {} }, employees, removedPeriods),
  };
}
