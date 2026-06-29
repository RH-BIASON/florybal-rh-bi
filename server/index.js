import cors from "cors";
import express from "express";
import multer from "multer";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createUser, deleteUser, hasUsers, isAuthConfigured, listUsers, loginUser, publicUser, userFromToken } from "./authStore.js";
import { mergePayrollDatasets, removePayrollPeriods } from "./datasetMerge.js";
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
    auth: isAuthConfigured() ? "supabase" : "disabled",
  });
});

function tokenFromRequest(req) {
  const value = req.headers.authorization || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

async function requireAuth(req, res, next) {
  if (!isAuthConfigured()) {
    req.user = { id: "local", email: "local", user_metadata: { name: "Local", role: "admin" } };
    next();
    return;
  }
  const token = tokenFromRequest(req);
  if (!token) {
    res.status(401).json({ error: "Login obrigatorio." });
    return;
  }
  try {
    req.user = await userFromToken(token);
    next();
  } catch (_error) {
    res.status(401).json({ error: "Sessao expirada. Entre novamente." });
  }
}

function requireAdmin(req, res, next) {
  const role = req.user?.user_metadata?.role || "user";
  if (role !== "admin") {
    res.status(403).json({ error: "Acesso permitido somente para administradores." });
    return;
  }
  next();
}

app.get("/api/auth/status", async (_req, res) => {
  if (!isAuthConfigured()) {
    res.json({ configured: false, hasUsers: true });
    return;
  }
  res.json({ configured: true, hasUsers: await hasUsers() });
});

app.post("/api/auth/setup", async (req, res) => {
  if (!isAuthConfigured()) {
    res.status(503).json({ error: "Autenticacao nao configurada." });
    return;
  }
  if (await hasUsers()) {
    res.status(409).json({ error: "O primeiro acesso ja foi criado." });
    return;
  }
  const { name, email, password } = req.body || {};
  if (!name || !email || !password || password.length < 8) {
    res.status(400).json({ error: "Informe nome, e-mail e senha com pelo menos 8 caracteres." });
    return;
  }
  await createUser({ name, email, password, role: "admin" });
  const session = await loginUser({ email, password });
  res.json({ token: session.access_token, user: publicUser(session.user) });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    res.status(400).json({ error: "Informe e-mail e senha." });
    return;
  }
  try {
    const session = await loginUser({ email, password });
    res.json({ token: session.access_token, user: publicUser(session.user) });
  } catch (_error) {
    res.status(401).json({ error: "E-mail ou senha invalido." });
  }
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.get("/api/auth/users", requireAuth, requireAdmin, async (_req, res) => {
  const users = await listUsers();
  res.json(users.map(publicUser));
});

app.post("/api/auth/users", requireAuth, requireAdmin, async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password || password.length < 8) {
    res.status(400).json({ error: "Informe nome, e-mail e senha com pelo menos 8 caracteres." });
    return;
  }
  const user = await createUser({ name, email, password, role });
  res.json(publicUser(user));
});

app.delete("/api/auth/users/:id", requireAuth, requireAdmin, async (req, res) => {
  if (req.params.id === req.user?.id) {
    res.status(400).json({ error: "Voce nao pode excluir o proprio acesso logado." });
    return;
  }
  await deleteUser(req.params.id);
  res.json({ ok: true });
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

app.get("/api/payroll", requireAuth, async (_req, res) => {
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

app.get("/api/import-history", requireAuth, async (_req, res) => {
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
    .filter((entry) => entry.files?.length)
    .sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  res.json(entries);
});

app.delete("/api/periods/:periodKey", requireAuth, requireAdmin, async (req, res) => {
  const periodKey = req.params.periodKey;
  const current = await currentPayrollDataset();
  if (!current?.periods?.includes(periodKey)) {
    res.status(404).json({ error: "Periodo nao encontrado na base ativa." });
    return;
  }

  const id = `${importId()}-periodo-removido`;
  const outputPath = path.join(root, "data", "payroll.json");
  const payload = removePayrollPeriods(current, [periodKey]);
  await persistImport(id, "imported", [], payload, `Periodo ${periodKey} removido da base ativa.`);
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf8");
  res.json(payload);
});

app.post("/api/upload", requireAuth, requireAdmin, upload.array("pdfs"), (req, res) => {
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
      const duplicatePeriods = (parsedPayload.periods || []).filter((period) => basePayload?.periods?.includes(period));
      const replaceExisting = req.body?.replaceExisting === "true" || req.query?.replaceExisting === "true";
      if (duplicatePeriods.length && !replaceExisting) {
        fs.rm(pendingPath, { force: true }, () => {});
        for (const file of req.files) fs.rm(file.path, { force: true }, () => {});
        res.status(409).json({
          error: "Competencia ja existe na base ativa.",
          code: "PERIOD_EXISTS",
          periods: duplicatePeriods,
          message: `A competencia ${duplicatePeriods.join(", ")} ja existe. Confirme para substituir somente esse(s) mes(es).`,
        });
        return;
      }
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
