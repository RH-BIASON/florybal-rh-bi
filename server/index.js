import cors from "cors";
import express from "express";
import multer from "multer";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergePayrollDatasets } from "./datasetMerge.js";
import { loadEnv } from "./env.js";
import { importHistoryFromSupabase, isSupabaseConfigured, latestPayrollFromSupabase, saveImportToSupabase } from "./supabaseStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
loadEnv(root);
const app = express();
const port = process.env.PORT || 4000;
const pythonBin = process.env.PYTHON_BIN || "python";
const dataDir = path.join(root, "data");
const uploadDir = path.join(dataDir, "uploads");
const historyDir = path.join(dataDir, "import-history");
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^\w.\- À-ÿ]/g, "_");
    cb(null, `${Date.now()}-${safeName}`);
  },
});
const upload = multer({ storage });

app.use(cors());
app.use(express.json({ limit: "10mb" }));

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

ensureDir(dataDir);
ensureDir(uploadDir);
ensureDir(historyDir);

function importId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    storage: isSupabaseConfigured() ? "supabase" : "local",
  });
});

function writeImportHistory(id, status, files, payload = null, detail = "") {
  ensureDir(historyDir);
  const metadata = {
    id,
    status,
    importedAt: new Date().toISOString(),
    files: files.map((file) => file.originalname),
    detail,
    summary: payload
      ? {
          sources: payload.sources || [],
          periods: payload.periods || [],
          branches: payload.branches?.length || 0,
          employeeRecords: payload.quality?.employeeRecords || 0,
          reconciliationMatched: Boolean(payload.quality?.reconciliationMatched),
          diagnostics: payload.quality?.diagnostics || [],
          unclassifiedEvents: payload.quality?.unclassifiedEvents || [],
          unclassifiedEventCount: payload.quality?.unclassifiedEventCount || 0,
        }
      : null,
  };
  fs.writeFileSync(path.join(historyDir, `${id}.metadata.json`), JSON.stringify(metadata, null, 2), "utf8");
}

async function persistImport(id, status, files, payload = null, detail = "") {
  if (isSupabaseConfigured()) {
    await saveImportToSupabase(id, status, files, payload, detail);
  }
  writeImportHistory(id, status, files, payload, detail);
}

async function currentPayrollDataset() {
  if (isSupabaseConfigured()) {
    const payload = await latestPayrollFromSupabase();
    if (payload) return payload;
  }
  const dataPath = path.join(root, "data", "payroll.json");
  if (fs.existsSync(dataPath)) return JSON.parse(fs.readFileSync(dataPath, "utf8"));
  return null;
}

app.get("/api/payroll", async (_req, res) => {
  if (isSupabaseConfigured()) {
    try {
      const payload = await latestPayrollFromSupabase();
      if (payload) {
        res.json(payload);
        return;
      }
    } catch (error) {
      console.error("Falha ao ler Supabase, usando fallback local:", error);
    }
  }
  const dataPath = path.join(root, "data", "payroll.json");
  if (!fs.existsSync(dataPath)) {
    res.status(404).json({ error: "Nenhum dado importado ainda." });
    return;
  }
  res.sendFile(dataPath);
});

app.get("/api/import-history", async (_req, res) => {
  if (isSupabaseConfigured()) {
    try {
      const entries = await importHistoryFromSupabase();
      if (entries) {
        res.json(entries);
        return;
      }
    } catch (error) {
      console.error("Falha ao ler histórico do Supabase, usando fallback local:", error);
    }
  }
  if (!fs.existsSync(historyDir)) {
    res.json([]);
    return;
  }
  const entries = fs
    .readdirSync(historyDir)
    .filter((file) => file.endsWith(".metadata.json"))
    .map((file) => JSON.parse(fs.readFileSync(path.join(historyDir, file), "utf8")))
    .sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  res.json(entries);
});

app.post("/api/upload", upload.array("pdfs"), (req, res) => {
  if (!req.files?.length) {
    res.status(400).json({ error: "Envie ao menos um PDF." });
    return;
  }

  const outputPath = path.join(root, "data", "payroll.json");
  const id = importId();
  const pendingPath = path.join(root, "data", `payroll-import-${id}.json`);
  const args = [path.join(root, "scripts", "parse_payroll.py"), ...req.files.map((file) => file.path), "--out", pendingPath];
  let child;
  try {
    child = spawn(pythonBin, args, { cwd: root });
  } catch (error) {
    fs.rm(pendingPath, { force: true }, () => {});
    Promise.resolve(persistImport(id, "failed", req.files, null, `Falha ao iniciar parser Python: ${error.message}`))
      .catch((persistError) => console.error("Falha ao persistir erro de inicialização do parser:", persistError))
      .finally(() => {
        for (const file of req.files) fs.rm(file.path, { force: true }, () => {});
      });
    res.status(500).json({ error: "Falha ao iniciar o parser Python.", detail: error.message });
    return;
  }
  let stderr = "";
  let parserFailedToStart = false;
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.on("error", async (error) => {
    parserFailedToStart = true;
    fs.rm(pendingPath, { force: true }, () => {});
    try {
      await persistImport(id, "failed", req.files, null, `Falha ao iniciar parser Python: ${error.message}`);
    } catch (persistError) {
      console.error("Falha ao persistir erro de inicialização do parser:", persistError);
    } finally {
      for (const file of req.files) fs.rm(file.path, { force: true }, () => {});
    }
    res.status(500).json({ error: "Falha ao iniciar o parser Python.", detail: error.message });
  });
  child.on("close", async (code) => {
    if (parserFailedToStart) return;
    if (code !== 0) {
      fs.rm(pendingPath, { force: true }, () => {});
      try {
        await persistImport(id, "failed", req.files, null, stderr || `Parser finalizou com código ${code}`);
      } catch (error) {
        console.error("Falha ao persistir importação com erro:", error);
      } finally {
        for (const file of req.files) fs.rm(file.path, { force: true }, () => {});
      }
      res.status(500).json({ error: "Falha ao processar PDFs.", detail: stderr });
      return;
    }
    try {
      const parsedPayload = JSON.parse(fs.readFileSync(pendingPath, "utf8"));
      if (!parsedPayload.quality?.reconciliationMatched) {
        fs.rm(pendingPath, { force: true }, () => {});
        await persistImport(id, "blocked", req.files, parsedPayload, "Totais extraidos nao bateram com o total geral do PDF.");
        for (const file of req.files) fs.rm(file.path, { force: true }, () => {});
        res.status(422).json({
          error: "Importação bloqueada: os totais extraídos não bateram com o total geral do PDF.",
          reconciliation: parsedPayload.quality?.reconciliation || [],
          diagnostics: parsedPayload.quality?.diagnostics || [],
          unclassifiedEvents: parsedPayload.quality?.unclassifiedEvents || [],
        });
        return;
      }
      const basePayload = await currentPayrollDataset();
      const payload = mergePayrollDatasets(basePayload, parsedPayload);
      fs.writeFileSync(pendingPath, JSON.stringify(payload, null, 2), "utf8");
      ensureDir(historyDir);
      await persistImport(id, "imported", req.files, payload);
      fs.copyFileSync(pendingPath, path.join(historyDir, `${id}.payroll.json`));
      fs.copyFileSync(pendingPath, outputPath);
      fs.rmSync(pendingPath, { force: true });
      for (const file of req.files) fs.rm(file.path, { force: true }, () => {});
      res.sendFile(outputPath);
    } catch (error) {
      fs.rm(pendingPath, { force: true }, () => {});
      try {
        writeImportHistory(id, "failed", req.files, null, String(error));
      } finally {
        for (const file of req.files) fs.rm(file.path, { force: true }, () => {});
      }
      res.status(500).json({ error: "Falha ao validar a importação.", detail: String(error) });
    }
  });
});

app.use(express.static(path.join(root, "dist")));
app.use((_req, res) => {
  const indexPath = path.join(root, "dist", "index.html");
  if (fs.existsSync(indexPath)) res.sendFile(indexPath);
  else res.status(200).send("BI Florybal Chocolates API ativa. Use npm run dev para abrir a interface.");
});

app.listen(port, () => {
  console.log(`BI Florybal Chocolates API em http://127.0.0.1:${port}`);
});
