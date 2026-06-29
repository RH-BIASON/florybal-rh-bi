function sourcePeriodMap(dataset) {
  const map = new Map();
  for (const employee of dataset?.employees || []) {
    if (employee.sourceFile && employee.period?.key) map.set(employee.sourceFile, employee.period.key);
  }
  return map;
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
  if (!baseDataset?.employees?.length) return importedDataset;
  if (!importedDataset?.employees?.length) return baseDataset;

  const newPeriods = new Set(importedDataset.periods || importedDataset.employees.map((employee) => employee.period?.key).filter(Boolean));
  const preservedEmployees = (baseDataset.employees || []).filter((employee) => !newPeriods.has(employee.period?.key));
  const employees = [...preservedEmployees, ...importedDataset.employees].sort((a, b) => {
    const periodOrder = String(a.period?.key || "").localeCompare(String(b.period?.key || ""));
    if (periodOrder) return periodOrder;
    const branchOrder = String(a.branch?.code || "").localeCompare(String(b.branch?.code || ""));
    if (branchOrder) return branchOrder;
    return String(a.contract || "").localeCompare(String(b.contract || ""), undefined, { numeric: true });
  });

  const periods = sortPeriods(employees.map((employee) => employee.period?.key).filter(Boolean));
  const branches = sortBranches(employees.map((employee) => employee.branch).filter(Boolean));
  const sources = uniqBy(employees, (employee) => employee.sourceFile).map((employee) => employee.sourceFile);

  return {
    ...baseDataset,
    ...importedDataset,
    generatedAt: new Date().toISOString(),
    sources,
    periods,
    branches,
    employees,
    quality: rebuildQuality(baseDataset, importedDataset, employees, newPeriods),
  };
}

export function removePayrollPeriods(baseDataset, periodKeys) {
  const removedPeriods = new Set(periodKeys || []);
  if (!baseDataset?.employees?.length || !removedPeriods.size) return baseDataset;

  const employees = baseDataset.employees.filter((employee) => !removedPeriods.has(employee.period?.key));
  const periods = sortPeriods(employees.map((employee) => employee.period?.key).filter(Boolean));
  const branches = sortBranches(employees.map((employee) => employee.branch).filter(Boolean));
  const sources = uniqBy(employees, (employee) => employee.sourceFile).map((employee) => employee.sourceFile);

  return {
    ...baseDataset,
    generatedAt: new Date().toISOString(),
    sources,
    periods,
    branches,
    employees,
    quality: rebuildQuality(baseDataset, { quality: {} }, employees, removedPeriods),
  };
}
