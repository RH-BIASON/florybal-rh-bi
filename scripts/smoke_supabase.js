import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadEnv } from "../server/env.js";
import { saveImportToSupabase } from "../server/supabaseStore.js";

loadEnv(path.resolve(import.meta.dirname, ".."));

const importId = `smoke-${Date.now()}`;
const tempPdf = path.join(os.tmpdir(), `${importId}.pdf`);
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET || "payroll-pdfs";

function authHeaders(extra = {}) {
  return {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    ...extra,
  };
}

async function supabaseFetch(endpoint, options = {}) {
  const response = await fetch(`${supabaseUrl}${endpoint}`, {
    ...options,
    headers: authHeaders(options.headers || {}),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text || response.statusText}`);
  return text ? JSON.parse(text) : null;
}

const employee = {
  id: "2026-05-000-999",
  sourceFile: "SYNTHETIC-FOPAG.pdf",
  sourcePage: 1,
  period: { key: "2026-05", label: "05/2026", start: "2026-05-01", end: "2026-05-31" },
  branch: { code: "000", name: "FLORYBAL MATRIZ", label: "000 - FLORYBAL MATRIZ" },
  contract: "999",
  name: "FUNCIONARIO TESTE SUPABASE",
  jobTitle: "TESTE",
  admissionDate: "2026-05-01",
  resignationDate: null,
  totals: { gross: 1000, discounts: 100, net: 900, salary: 1000 },
  overtime: { hours: 2, value: 50, events: [{ code: "100", description: "HORA EXTRA 50%", quantity: 2, value: 50 }] },
  absence: { hours: 0, value: 0, events: [] },
  variables: { value: 0, events: [] },
  loans: { value: 0, events: [] },
  vacation: { start: null, end: null, days: null, cost: 0, events: [] },
  charges: { inss: 75, fgts: 80 },
  validation: [],
  events: [{ code: "100", description: "HORA EXTRA 50%", quantity: 2, value: 50 }],
};

const payload = {
  generatedAt: new Date().toISOString(),
  sources: ["SYNTHETIC-FOPAG.pdf"],
  periods: ["2026-05"],
  branches: [employee.branch],
  employees: [employee],
  quality: {
    employeeRecords: 1,
    reconciliationMatched: true,
    unclassifiedEventCount: 0,
    diagnosticCount: 0,
    reconciliation: [],
    diagnostics: [],
    unclassifiedEvents: [],
    warnings: [],
  },
};

const file = {
  path: tempPdf,
  originalname: "SYNTHETIC-FOPAG.pdf",
  filename: `${importId}-SYNTHETIC-FOPAG.pdf`,
  mimetype: "application/pdf",
  size: 0,
};

await fs.writeFile(tempPdf, "%PDF-1.4\n% synthetic smoke test\n");
try {
  await saveImportToSupabase(importId, "imported", [file], payload, "Smoke test Supabase sem dados reais.");
  const rows = await supabaseFetch(`/rest/v1/payroll_imports?id=eq.${encodeURIComponent(importId)}&select=id,status,employee_records`);
  if (rows?.[0]?.status !== "imported" || rows?.[0]?.employee_records !== 1) {
    throw new Error("Smoke test gravou dados inesperados.");
  }
  const fileRows = await supabaseFetch(`/rest/v1/payroll_import_files?import_id=eq.${encodeURIComponent(importId)}&select=storage_path`);
  await supabaseFetch(`/rest/v1/payroll_imports?id=eq.${encodeURIComponent(importId)}`, { method: "DELETE" });
  await Promise.all(
    (fileRows || []).map((row) =>
      fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${encodeURIComponent(row.storage_path).replace(/%2F/g, "/")}`, {
        method: "DELETE",
        headers: authHeaders(),
      }).catch(() => null),
    ),
  );
  console.log(JSON.stringify({ ok: true, importId, records: payload.employees.length, cleaned: true }));
} finally {
  await fs.rm(tempPdf, { force: true }).catch(() => {});
}
