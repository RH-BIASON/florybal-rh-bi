import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_BUCKET = "payroll-pdfs";

export function isSupabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function config() {
  const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET;
  return { url, key, bucket };
}

function headers(extra = {}) {
  const { key } = config();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...extra,
  };
}

async function requestJson(endpoint, options = {}) {
  const { url } = config();
  const response = await fetch(`${url}${endpoint}`, {
    ...options,
    headers: headers(options.headers || {}),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const detail = payload?.message || payload?.error || text || response.statusText;
    throw new Error(`Supabase ${response.status}: ${detail}`);
  }
  return payload;
}

function toImportSummary(id, status, files, payload, detail = "") {
  return {
    id,
    status,
    imported_at: new Date().toISOString(),
    generated_at: payload?.generatedAt || null,
    detail,
    source_files: files.map((file) => file.originalname),
    periods: payload?.periods || [],
    branch_count: payload?.branches?.length || 0,
    employee_records: payload?.quality?.employeeRecords || 0,
    reconciliation_matched: Boolean(payload?.quality?.reconciliationMatched),
    unclassified_event_count: payload?.quality?.unclassifiedEventCount || 0,
    diagnostic_count: payload?.quality?.diagnosticCount || 0,
    quality: payload?.quality || null,
    dataset: status === "imported" ? payload : null,
  };
}

function sourceWithoutUploadPrefix(sourceFile) {
  return String(sourceFile || "").replace(/^\d+-/, "");
}

function recordRow(importId, employee) {
  return {
    id: `${importId}:${employee.id}`,
    import_id: importId,
    source_file: sourceWithoutUploadPrefix(employee.sourceFile),
    source_page: employee.sourcePage || null,
    period_key: employee.period?.key || "",
    period_label: employee.period?.label || "",
    period_start: employee.period?.start || null,
    period_end: employee.period?.end || null,
    branch_code: employee.branch?.code || "",
    branch_name: employee.branch?.name || "",
    branch_label: employee.branch?.label || "",
    contract: employee.contract,
    employee_name: employee.name,
    job_title: employee.jobTitle || "",
    admission_date: employee.admissionDate || null,
    resignation_date: employee.resignationDate || null,
    gross: employee.totals?.gross || 0,
    discounts: employee.totals?.discounts || 0,
    net: employee.totals?.net || 0,
    salary: employee.totals?.salary || 0,
    overtime_hours: employee.overtime?.hours || 0,
    overtime_value: employee.overtime?.value || 0,
    absence_hours: employee.absence?.hours || 0,
    absence_value: employee.absence?.value || 0,
    variables_value: employee.variables?.value || 0,
    loans_value: employee.loans?.value || 0,
    vacation_start: employee.vacation?.start || null,
    vacation_end: employee.vacation?.end || null,
    vacation_days: employee.vacation?.days || null,
    vacation_cost: employee.vacation?.cost || 0,
    charges: employee.charges || {},
    validation: employee.validation || [],
    raw: employee,
  };
}

function eventGroups(employee, event) {
  const groups = [];
  const inList = (items) => items?.some((item) => item.code === event.code && item.description === event.description && item.value === event.value);
  if (inList(employee.overtime?.events)) groups.push(["overtime", null]);
  if (inList(employee.absence?.events)) groups.push(["absence", employee.absence.events.find((item) => item.code === event.code && item.description === event.description && item.value === event.value)?.kind || null]);
  if (inList(employee.variables?.events)) groups.push(["variables", employee.variables.events.find((item) => item.code === event.code && item.description === event.description && item.value === event.value)?.kind || null]);
  if (inList(employee.loans?.events)) groups.push(["loans", null]);
  if (inList(employee.vacation?.events)) groups.push(["vacations", null]);
  if (inList(employee.vacationTermination?.events)) groups.push(["vacation_termination", null]);
  return groups.length ? groups : [[null, null]];
}

function eventRows(importId, employee) {
  return (employee.events || []).flatMap((event) =>
    eventGroups(employee, event).map(([eventGroup, kind]) => ({
      import_id: importId,
      payroll_record_id: `${importId}:${employee.id}`,
      source_file: sourceWithoutUploadPrefix(employee.sourceFile),
      source_page: employee.sourcePage || null,
      period_key: employee.period?.key || "",
      branch_code: employee.branch?.code || "",
      contract: employee.contract,
      employee_name: employee.name,
      code: event.code,
      description: event.description,
      quantity: event.quantity,
      value: event.value || 0,
      event_group: eventGroup,
      kind,
      raw: event,
    })),
  );
}

function chunk(items, size = 500) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

async function insertRows(table, rows) {
  if (!rows.length) return [];
  const inserted = [];
  for (const rowsChunk of chunk(rows)) {
    const result = await requestJson(`/rest/v1/${table}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(rowsChunk),
    });
    if (Array.isArray(result)) inserted.push(...result);
  }
  return inserted;
}

async function patchImport(id, fields) {
  return requestJson(`/rest/v1/payroll_imports?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(fields),
  });
}

async function uploadFile(importId, file) {
  const { url, bucket } = config();
  const bytes = await fs.promises.readFile(file.path);
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  const storagePath = `${importId}/${hash}-${path.basename(file.originalname).replace(/[^\w.\- À-ÿ]/g, "_")}`;
  const response = await fetch(`${url}/storage/v1/object/${bucket}/${encodeURIComponent(storagePath).replace(/%2F/g, "/")}`, {
    method: "POST",
    headers: headers({
      "Content-Type": file.mimetype || "application/pdf",
      "x-upsert": "true",
    }),
    body: bytes,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase Storage ${response.status}: ${text || response.statusText}`);
  }
  return {
    import_id: importId,
    original_name: file.originalname,
    stored_name: file.filename,
    storage_bucket: bucket,
    storage_path: storagePath,
    sha256: hash,
    size_bytes: file.size || bytes.length,
  };
}

export async function saveImportToSupabase(id, status, files, payload = null, detail = "") {
  if (!isSupabaseConfigured()) return { enabled: false };

  const importRow = toImportSummary(id, status, files, payload, detail);
  const imported = status === "imported";
  await insertRows("payroll_imports", [
    imported
      ? {
          ...importRow,
          status: "failed",
          detail: "Importacao recebida; gravacao em andamento.",
          dataset: null,
        }
      : importRow,
  ]);

  try {
    if (files.length) {
      const fileRows = [];
      for (const file of files) fileRows.push(await uploadFile(id, file));
      await insertRows("payroll_import_files", fileRows);
    }

    if (imported && payload) {
      await insertRows("payroll_records", payload.employees.map((employee) => recordRow(id, employee)));
      await insertRows("payroll_events", payload.employees.flatMap((employee) => eventRows(id, employee)));
      await insertRows("payroll_audit_results", [
        {
          import_id: id,
          reconciliation: payload.quality?.reconciliation || [],
          diagnostics: payload.quality?.diagnostics || [],
          unclassified_events: payload.quality?.unclassifiedEvents || [],
          warnings: payload.quality?.warnings || [],
        },
      ]);
      await patchImport(id, {
        status: "imported",
        detail,
        dataset: payload,
      });
    }
  } catch (error) {
    await patchImport(id, {
      status: "failed",
      detail: `Falha ao gravar importacao no Supabase: ${error.message}`,
    }).catch(() => {});
    throw error;
  }

  return { enabled: true, id };
}

export async function latestPayrollFromSupabase() {
  if (!isSupabaseConfigured()) return null;
  const rows = await requestJson("/rest/v1/payroll_imports?status=eq.imported&select=dataset&order=imported_at.desc&limit=1", {
    method: "GET",
  });
  return rows?.[0]?.dataset || null;
}

export async function importHistoryFromSupabase() {
  if (!isSupabaseConfigured()) return null;
  const rows = await requestJson(
    "/rest/v1/payroll_imports?select=id,status,imported_at,source_files,detail,periods,branch_count,employee_records,reconciliation_matched,diagnostic_count,unclassified_event_count&order=imported_at.desc&limit=80",
    { method: "GET" },
  );
  return rows.filter((row) => (row.source_files || []).length).map((row) => ({
    id: row.id,
    status: row.status,
    importedAt: row.imported_at,
    files: row.source_files || [],
    detail: row.detail || "",
    summary: {
      periods: row.periods || [],
      branches: row.branch_count || 0,
      employeeRecords: row.employee_records || 0,
      reconciliationMatched: Boolean(row.reconciliation_matched),
      diagnostics: Array(row.diagnostic_count || 0).fill(null),
      unclassifiedEvents: Array(row.unclassified_event_count || 0).fill(null),
      unclassifiedEventCount: row.unclassified_event_count || 0,
    },
  }));
}
