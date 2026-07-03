import {
  AlertTriangle,
  Banknote,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileUp,
  Filter,
  Landmark,
  Clock3,
  RefreshCw,
  Search,
  ShieldAlert,
  TrendingUp,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const chargeLabels = {
  inss_employee: "INSS colaborador",
  inss_company: "INSS empresa",
  fgts: "FGTS",
  rat_fap: "RAT x FAP",
  third_parties: "Terceiros",
  gps_total: "Total GPS",
  irrf: "IRRF",
};

const chartColors = ["#f59e0b", "#2563eb", "#10b981", "#ef4444", "#8b5cf6", "#64748b", "#0f766e"];
const tokenKey = "florybal_bi_token";
const vacationCodes = new Set(["00061", "00062", "00063", "00065", "00066", "00067", "00068", "00069", "00081", "00083", "00085", "00086", "00165", "00166", "00167", "00197"]);
const vacationTerminationCodes = new Set(["00070", "00071", "00072", "00073", "00075", "00076", "00077", "00078", "00079", "00080", "00176", "00177", "00178", "00179", "17001", "17002", "17006", "17007", "17008", "17099"]);

function currency(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function compactCurrency(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: "compact",
    maximumFractionDigits: 2,
  });
}

function formatHours(value) {
  return `${Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}h`;
}

function shortDate(value) {
  if (!value) return "-";
  return value.split("-").reverse().join("/");
}

function periodLabel(key) {
  if (!key) return "";
  const [year, month] = key.split("-");
  return `${month}/${year}`;
}

function branchLabel(branch) {
  if (!branch) return "-";
  if (typeof branch === "string") return branch;
  return branch.label || branch.code || "-";
}

function sum(items, getter) {
  return items.reduce((total, item) => total + Number(getter(item) || 0), 0);
}

function uniqueCount(items, getter) {
  return new Set(items.map(getter).filter(Boolean)).size;
}

function isInSelected(values, selected) {
  return selected.size === 0 || selected.has(values);
}

function overtimeKind(event) {
  if (event.code === "00025" || event.code === "00096" || event.code === "00107") return "50";
  if (event.code === "00026" || event.code === "00097") return "100";
  return null;
}

function overtimeReflectionKind(event) {
  return event.code === "00030" ? "Reflexo HE" : null;
}

function overtimeReflectionValue(item) {
  const events = item.events || item.overtime?.reflexes || [];
  if (events.length) return sum(events, (event) => (overtimeReflectionKind(event) ? event.value : 0));
  return item.overtime?.reflexValue || 0;
}

function medicalCertificateEvents(item) {
  const events = item.events || item.medicalCertificates?.events || [];
  return events.filter((event) => event.code === "00007");
}

function medicalCertificateHours(item) {
  const events = medicalCertificateEvents(item);
  if (events.length) return sum(events, (event) => event.quantity);
  return item.medicalCertificates?.hours || 0;
}

function medicalCertificateValue(item) {
  const events = medicalCertificateEvents(item);
  if (events.length) return sum(events, (event) => event.value);
  return item.medicalCertificates?.value || 0;
}

function variablesValue(item) {
  return sum(item.events || [], (event) => (variableKind(event) ? event.value : 0));
}

function validLoanEvent(event) {
  const description = event.description.toLowerCase();
  return description.includes("consign") && event.code !== "49992" && !description.includes("estorno");
}

function loanValue(item) {
  const events = item.loans?.events || [];
  if (events.length) return sum(events, (event) => (validLoanEvent(event) ? event.value : 0));
  return item.loans?.value || 0;
}

function vacationValue(item) {
  const events = item.events || item.vacation?.events || [];
  if (events.length) return sum(events, (event) => (vacationCodes.has(event.code) ? event.value : 0));
  return item.vacation?.cost || 0;
}

function vacationTerminationValue(item) {
  const events = item.events || item.vacationTermination?.events || [];
  if (events.length) return sum(events, (event) => (vacationTerminationCodes.has(event.code) ? event.value : 0));
  return item.vacationTermination?.cost || 0;
}

function absenceKind(event) {
  const description = event.description.toLowerCase();
  if (event.code === "00201" || description.includes("faltas não justificadas") || description.includes("faltas nao justificadas")) return "Faltas";
  if (event.code === "00202" || description.includes("faltas ou atrasos") || description.includes("atrasos")) return "Atrasos";
  if (event.code === "00203" || description.includes("repousos descontados")) return "Repouso descontado";
  return null;
}

function variableKind(event) {
  if (overtimeKind(event)) return null;
  if (event.code === "00028" || event.code === "00029") return "Comissões";
  if (event.code === "00035" || event.code === "00088" || event.code === "00089") return "Prêmios e bonificações";
  if (["00020", "00021", "00022", "00023", "00024", "00037", "00050"].includes(event.code)) return "Adicionais";
  return null;
}

function absenceLevel(hours) {
  if (hours >= 24) return "Vermelho";
  if (hours >= 8) return "Amarelo";
  return "";
}

function App() {
  const [dataset, setDataset] = useState(null);
  const [importHistory, setImportHistory] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [authToken, setAuthToken] = useState(() => localStorage.getItem(tokenKey) || "");
  const [authMode, setAuthMode] = useState("login");
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [selectedPeriods, setSelectedPeriods] = useState(new Set());
  const [selectedBranches, setSelectedBranches] = useState(new Set());
  const [periodMode, setPeriodMode] = useState("multi");
  const [dragActive, setDragActive] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useState("overview");
  const [replacePrompt, setReplacePrompt] = useState(null);
  const [importModal, setImportModal] = useState(null);
  const [removingPeriod, setRemovingPeriod] = useState("");

  const isAdmin = currentUser?.role === "admin";

  function authHeaders(token = authToken) {
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function apiRequest(path, options = {}, token = authToken) {
    const headers = {
      ...(options.headers || {}),
      ...authHeaders(token),
    };
    if (options.body && !(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
    const response = await fetch(path, { ...options, headers });
    if (response.status === 401) logout();
    return response;
  }

  async function loadData(token = authToken) {
    setLoading(true);
    setError("");
    try {
      const [response, historyResponse] = await Promise.all([apiRequest("/api/payroll", {}, token), apiRequest("/api/import-history", {}, token)]);
      if (!response.ok) throw new Error("Não foi possível carregar data/payroll.json");
      const payload = await response.json();
      const historyPayload = historyResponse.ok ? await historyResponse.json() : [];
      setDataset(payload);
      setImportHistory(historyPayload);
      setSelectedPeriods(new Set(payload.periods));
      setSelectedBranches(new Set(payload.branches.map((branch) => branch.code)));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    initializeAuth();
  }, []);

  async function initializeAuth() {
    setAuthLoading(true);
    try {
      const statusResponse = await fetch("/api/auth/status");
      const status = statusResponse.ok ? await statusResponse.json() : { hasUsers: true };
      setAuthMode(status.hasUsers ? "login" : "setup");
      if (!authToken) return;
      const response = await fetch("/api/auth/me", { headers: authHeaders(authToken) });
      if (!response.ok) throw new Error("Sessão expirada.");
      const payload = await response.json();
      setCurrentUser(payload.user);
      await loadData(authToken);
    } catch (_error) {
      localStorage.removeItem(tokenKey);
      setAuthToken("");
      setCurrentUser(null);
    } finally {
      setAuthLoading(false);
      setLoading(false);
    }
  }

  async function handleAuthSubmit(values) {
    setError("");
    const endpoint = authMode === "setup" ? "/api/auth/setup" : "/api/auth/login";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error || "Falha ao entrar.");
      return;
    }
    localStorage.setItem(tokenKey, payload.token);
    setAuthToken(payload.token);
    setCurrentUser(payload.user);
    await loadData(payload.token);
  }

  function logout() {
    localStorage.removeItem(tokenKey);
    setAuthToken("");
    setCurrentUser(null);
    setDataset(null);
    setImportHistory([]);
    setView("overview");
  }

  async function refreshImportHistory() {
    const historyResponse = await apiRequest("/api/import-history");
    if (historyResponse.ok) setImportHistory(await historyResponse.json());
  }

  function applyDataset(payload) {
    setDataset(payload);
    setSelectedPeriods(new Set(payload.periods));
    setSelectedBranches(new Set(payload.branches.map((branch) => branch.code)));
  }

  async function importFiles(files, options = {}) {
    if (!files.length) return;
    const pdfs = files.filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length) {
      setError("Arraste ou selecione apenas arquivos PDF.");
      return;
    }
    const form = new FormData();
    pdfs.forEach((file) => form.append("pdfs", file));
    if (options.replaceExisting) form.append("replaceExisting", "true");
    setUploading(true);
    setError("");
    setImportModal({
      status: "running",
      files: pdfs.map((file) => file.name),
      replaceExisting: Boolean(options.replaceExisting),
      startedAt: new Date().toISOString(),
    });
    try {
      const response = await apiRequest("/api/upload", { method: "POST", body: form });
      const result = await response.json();
      if (response.status === 409 && result.code === "PERIOD_EXISTS") {
        setImportModal(null);
        setReplacePrompt({ periods: result.periods || [], files: pdfs });
        return;
      }
      if (!response.ok) throw new Error(result.error || "Falha ao importar PDFs");
      const payload = result.dataset || result;
      applyDataset(payload);
      await refreshImportHistory();
      setImportModal({
        status: "done",
        files: pdfs.map((file) => file.name),
        summary: result.importSummary || importSummaryFromDataset(payload, pdfs),
        replaceExisting: Boolean(options.replaceExisting),
      });
    } catch (err) {
      setError(err.message);
      setImportModal({
        status: "error",
        files: pdfs.map((file) => file.name),
        error: err.message,
        replaceExisting: Boolean(options.replaceExisting),
      });
    } finally {
      setUploading(false);
    }
  }

  async function confirmReplacePeriods() {
    const files = replacePrompt?.files || [];
    setReplacePrompt(null);
    await importFiles(files, { replaceExisting: true });
  }

  async function removePeriod(periodKey) {
    setRemovingPeriod(periodKey);
    setError("");
    try {
      const response = await apiRequest(`/api/periods/${encodeURIComponent(periodKey)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao remover período");
      applyDataset(payload);
      await refreshImportHistory();
    } catch (err) {
      setError(err.message);
    } finally {
      setRemovingPeriod("");
    }
  }

  async function handleUpload(event) {
    await importFiles(Array.from(event.target.files || []));
    event.target.value = "";
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragActive(false);
    importFiles(Array.from(event.dataTransfer.files || []));
  }

  const filtered = useMemo(() => {
    if (!dataset) return [];
    const normalized = query.trim().toLowerCase();
    return dataset.employees.filter((employee) => {
      const periodOk = isInSelected(employee.period?.key, selectedPeriods);
      const branchOk = isInSelected(employee.branch?.code, selectedBranches);
      const queryOk =
        !normalized ||
        employee.name.toLowerCase().includes(normalized) ||
        employee.contract.includes(normalized) ||
        employee.jobTitle.toLowerCase().includes(normalized);
      return periodOk && branchOk && queryOk;
    });
  }, [dataset, selectedPeriods, selectedBranches, query]);

  const analytics = useMemo(() => buildAnalytics(filtered), [filtered]);

  if (authLoading) return <ShellState icon={RefreshCw} label="Carregando acesso..." />;
  if (!currentUser) return <AuthScreen mode={authMode} error={error} onSubmit={handleAuthSubmit} />;
  if (loading) return <ShellState icon={RefreshCw} label="Carregando dados da folha..." />;
  if (error && !dataset) return <ShellState icon={ShieldAlert} label={error} />;

  const periods = dataset?.periods || [];
  const branches = dataset?.branches || [];

  return (
    <main className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <img src="/brand/florybal-logo.png" alt="Florybal Chocolates" />
          </div>
          <div>
            <strong>BI Florybal Chocolates</strong>
            <span>Folha e DP</span>
          </div>
        </div>
        <nav className="nav">
          {[
            ["overview", TrendingUp, "Visão geral"],
            ["movement", Users, "Admissões e rescisões"],
            ["overtime", Clock3, "Horas extras"],
            ["attendance", AlertTriangle, "Faltas e atrasos"],
            ["certificates", ClipboardCheck, "Atestados"],
            ["variables", BriefcaseBusiness, "Variáveis e consignados"],
            ["charges", Landmark, "Encargos"],
            ["benefits", CalendarDays, "Férias"],
            ["audit", ClipboardCheck, "Auditoria"],
            ...(isAdmin ? [["access", UserPlus, "Acessos"]] : []),
          ].map(([key, Icon, label]) => (
            <button key={key} className={view === key ? "active" : ""} onClick={() => setView(key)}>
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <div className="source-box">
          <span>Fonte atual</span>
          <strong>{dataset.sources.length} PDFs</strong>
          <small>{dataset.quality.employeeRecords.toLocaleString("pt-BR")} registros extraídos</small>
          <button onClick={logout}>Sair</button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">Business intelligence RH/DP</span>
            <h1>Folhas de pagamento Florybal</h1>
          </div>
          <div className="actions">
            <button className="secondary-action" onClick={() => exportWorkbook(filtered)} title="Exportar visão filtrada em Excel com abas">
              <Download size={18} />
              Excel
            </button>
            <button className="icon-button" onClick={loadData} title="Recarregar dados">
              <RefreshCw size={18} />
            </button>
          </div>
        </header>

        {error && <div className="notice danger">{error}</div>}
        {importModal && <ImportProgressModal state={importModal} onClose={() => setImportModal(null)} />}
        {replacePrompt && (
          <ConfirmDialog
            title="Substituir competência existente?"
            message={`A competência ${replacePrompt.periods.map(periodLabel).join(", ")} já existe na base. Deseja substituir somente esse mês e manter os demais períodos salvos?`}
            confirmLabel="Substituir"
            cancelLabel="Cancelar"
            onConfirm={confirmReplacePeriods}
            onCancel={() => setReplacePrompt(null)}
          />
        )}

        <section className="control-surface">
          <div className="filter-group periods">
            <div className="filter-label">
              <CalendarDays size={16} />
              Período
              <span className="filter-count">{selectedPeriods.size || periods.length} de {periods.length}</span>
            </div>
            <div className="segmented">
              <button className={periodMode === "single" ? "active" : ""} onClick={() => {
                setPeriodMode("single");
                setSelectedPeriods(new Set([periods.at(-1)]));
              }}>Mês único</button>
              <button className={periodMode === "multi" ? "active" : ""} onClick={() => setPeriodMode("multi")}>Comparar meses</button>
            </div>
            <div className="quick-row compact">
              <QuickRange label="Último mês" count={1} periods={periods} setSelectedPeriods={setSelectedPeriods} setPeriodMode={setPeriodMode} />
              <QuickRange label="2 meses" count={2} periods={periods} setSelectedPeriods={setSelectedPeriods} setPeriodMode={setPeriodMode} />
              <QuickRange label="3 meses" count={3} periods={periods} setSelectedPeriods={setSelectedPeriods} setPeriodMode={setPeriodMode} />
              <button onClick={() => {
                setPeriodMode("multi");
                setSelectedPeriods(new Set(periods));
              }}>Todos</button>
            </div>
            <div className="chip-row">
              {periods.map((period) => (
                <ToggleChip key={period} active={selectedPeriods.has(period)} onClick={() => togglePeriod(period, periodMode, setSelectedPeriods)}>
                  {periodLabel(period)}
                </ToggleChip>
              ))}
            </div>
          </div>

          <div className="filter-group branches">
            <div className="filter-label">
              <Filter size={16} />
              Filiais
              <span className="filter-count">{selectedBranches.size || branches.length} de {branches.length}</span>
            </div>
            <div className="quick-row compact">
              <button onClick={() => setSelectedBranches(new Set(branches.map((branch) => branch.code)))}>Todas</button>
              <button onClick={() => setSelectedBranches(new Set(["000"]))}>Matriz</button>
              <button onClick={() => setSelectedBranches(new Set())}>Nenhuma</button>
            </div>
            <div className="branch-grid">
              {branches.map((branch) => (
                <button
                  key={branch.code}
                  className={selectedBranches.has(branch.code) ? "branch-cell active" : "branch-cell"}
                  onClick={() => toggleSet(branch.code, setSelectedBranches)}
                  title={branch.label}
                >
                  {branch.code}
                </button>
              ))}
            </div>
          </div>

          <div className="utility-stack">
            <label className="search">
              <Search size={17} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar colaborador, contrato ou cargo" />
            </label>
            {isAdmin ? (
              <label
                className={dragActive ? "dropzone active" : "dropzone"}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
              >
                <FileUp size={18} />
                <span>{uploading ? "Importando e conferindo..." : "Arraste PDFs aqui"}</span>
                <input type="file" accept="application/pdf" multiple onChange={handleUpload} disabled={uploading} />
              </label>
            ) : (
              <div className="readonly-note">
                <FileUp size={18} />
                <span>Importação disponível para administradores.</span>
              </div>
            )}
          </div>
        </section>

        <KpiStrip analytics={analytics} />
        <DataStatus quality={dataset.quality} analytics={analytics} />

        {view === "overview" && <Overview analytics={analytics} />}
        {view === "movement" && <Movement analytics={analytics} />}
        {view === "overtime" && <Overtime analytics={analytics} />}
        {view === "attendance" && <Attendance analytics={analytics} />}
        {view === "certificates" && <MedicalCertificates analytics={analytics} />}
        {view === "variables" && <Variables analytics={analytics} />}
        {view === "charges" && <Charges analytics={analytics} />}
        {view === "benefits" && <Benefits analytics={analytics} />}
        {view === "audit" && <Audit dataset={dataset} analytics={analytics} importHistory={importHistory} onRemovePeriod={removePeriod} removingPeriod={removingPeriod} isAdmin={isAdmin} />}
        {view === "access" && isAdmin && <AccessPanel apiRequest={apiRequest} currentUser={currentUser} />}
      </section>
    </main>
  );
}

function buildAnalytics(rows) {
  const personKey = (item) => `${item.branch?.code}-${item.contract}`;
  const monthEmployeeKey = (item) => `${item.period?.key}-${item.branch?.code}-${item.contract}`;
  const employees = uniqueCount(rows, personKey);
  const records = rows.length;
  const payroll = sum(rows, (item) => item.totals.gross);
  const net = sum(rows, (item) => item.totals.net);
  const discounts = sum(rows, (item) => item.totals.discounts);
  const admissions = rows.filter((item) => item.admissionDate?.slice(0, 7) === item.period?.key);
  const resignations = rows.filter((item) => item.resignationDate?.slice(0, 7) === item.period?.key);
  const loans = rows.filter((item) => loanValue(item) > 0);
  const vacations = rows.filter((item) => vacationValue(item) > 0 || item.vacation.start);
  const vacationTerminations = rows.filter((item) => vacationTerminationValue(item) > 0);
  const medicalCertificates = rows.filter((item) => medicalCertificateEvents(item).length > 0 || medicalCertificateHours(item) > 0 || medicalCertificateValue(item) > 0);
  const alerts = rows.filter((item) => item.validation.length || item.overtime.hours > 40 || (item.absence?.hours || 0) >= 8);

  const byMonthMap = new Map();
  const byBranchMap = new Map();
  const branchRankingMap = new Map();
  const overtimeTopMap = new Map();
  const absenceTopMap = new Map();
  const variableTopMap = new Map();
  const variableTotals = { "Comissões": 0, "Prêmios e bonificações": 0, "Adicionais": 0 };
  const chargeTotals = {};
  Object.keys(chargeLabels).forEach((key) => {
    chargeTotals[key] = 0;
  });

  for (const item of rows) {
    const month = item.period?.key;
    const branch = item.branch?.label;
    const branchCode = item.branch?.code;
    const rankingKey = branchCode || branch || "sem-filial";
    if (!byMonthMap.has(month)) {
      byMonthMap.set(month, {
        period: month,
        label: periodLabel(month),
        gross: 0,
        discounts: 0,
        net: 0,
        admissions: 0,
        resignations: 0,
        loans: 0,
        vacations: 0,
        vacationTerminations: 0,
        medicalCertificateHours: 0,
        medicalCertificateValue: 0,
        medicalCertificateRecords: 0,
        overtime50Hours: 0,
        overtime50Value: 0,
        overtime100Hours: 0,
        overtime100Value: 0,
        overtimeReflectionValue: 0,
        absenceHours: 0,
        absenceValue: 0,
        absenceYellow: 0,
        absenceRed: 0,
        variableCommissions: 0,
        variablePremiums: 0,
        variableAdditionals: 0,
        employees: new Set(),
        charges: Object.fromEntries(Object.keys(chargeLabels).map((key) => [key, 0])),
      });
    }
    const monthRow = byMonthMap.get(month);
    monthRow.gross += item.totals.gross || 0;
    monthRow.discounts += item.totals.discounts || 0;
    monthRow.net += item.totals.net || 0;
    monthRow.loans += loanValue(item);
    monthRow.vacations += vacationValue(item);
    monthRow.vacationTerminations += vacationTerminationValue(item);
    monthRow.medicalCertificateHours += medicalCertificateHours(item);
    monthRow.medicalCertificateValue += medicalCertificateValue(item);
    if (medicalCertificateEvents(item).length || medicalCertificateHours(item) || medicalCertificateValue(item)) monthRow.medicalCertificateRecords += 1;
    monthRow.absenceHours += item.absence?.hours || 0;
    monthRow.absenceValue += item.absence?.value || 0;
    if ((item.absence?.hours || 0) >= 24) monthRow.absenceRed += 1;
    else if ((item.absence?.hours || 0) >= 8) monthRow.absenceYellow += 1;
    monthRow.employees.add(monthEmployeeKey(item));
    if (item.admissionDate?.slice(0, 7) === month) monthRow.admissions += 1;
    if (item.resignationDate?.slice(0, 7) === month) monthRow.resignations += 1;

    if (!byBranchMap.has(branch)) {
      byBranchMap.set(branch, { branch, branchCode, gross: 0, net: 0, loans: 0, vacations: 0, vacationTerminations: 0, admissions: 0, resignations: 0, employees: new Set(), alerts: 0 });
    }
    const branchRow = byBranchMap.get(branch);
    branchRow.gross += item.totals.gross || 0;
    branchRow.net += item.totals.net || 0;
    branchRow.loans += loanValue(item);
    branchRow.vacations += vacationValue(item);
    branchRow.vacationTerminations += vacationTerminationValue(item);
    if (item.admissionDate?.slice(0, 7) === month) branchRow.admissions += 1;
    if (item.resignationDate?.slice(0, 7) === month) branchRow.resignations += 1;
    branchRow.employees.add(personKey(item));
    branchRow.alerts += item.validation.length || (item.absence?.hours || 0) >= 8 ? 1 : 0;

    if (!branchRankingMap.has(rankingKey)) {
      branchRankingMap.set(rankingKey, {
        branch: branch || "Sem filial",
        branchCode: branchCode || "-",
        employees: new Set(),
        admissions: 0,
        resignations: 0,
        overtime50Hours: 0,
        overtime50Value: 0,
        overtime100Hours: 0,
        overtime100Value: 0,
        overtimeReflectionValue: 0,
        overtimeTotalHours: 0,
        overtimeTotalValue: 0,
        absenceHours: 0,
        absenceValue: 0,
        medicalCertificateHours: 0,
        medicalCertificateValue: 0,
        medicalCertificateRecords: 0,
        variableCommissions: 0,
        variablePremiums: 0,
        variableAdditionals: 0,
        variableTotal: 0,
        loans: 0,
        vacations: 0,
        vacationTerminations: 0,
        charges: 0,
        gross: 0,
        net: 0,
      });
    }
    const branchRanking = branchRankingMap.get(rankingKey);
    branchRanking.employees.add(personKey(item));
    branchRanking.gross += item.totals.gross || 0;
    branchRanking.net += item.totals.net || 0;
    branchRanking.loans += loanValue(item);
    branchRanking.vacations += vacationValue(item);
    branchRanking.vacationTerminations += vacationTerminationValue(item);
    branchRanking.absenceHours += item.absence?.hours || 0;
    branchRanking.absenceValue += item.absence?.value || 0;
    branchRanking.medicalCertificateHours += medicalCertificateHours(item);
    branchRanking.medicalCertificateValue += medicalCertificateValue(item);
    if (medicalCertificateEvents(item).length || medicalCertificateHours(item) || medicalCertificateValue(item)) branchRanking.medicalCertificateRecords += 1;
    if (item.admissionDate?.slice(0, 7) === month) branchRanking.admissions += 1;
    if (item.resignationDate?.slice(0, 7) === month) branchRanking.resignations += 1;

    if ((item.absence?.hours || 0) > 0) {
      const absenceKey = `${item.period?.key}-${item.branch?.code}-${item.contract}-${item.name}`;
      absenceTopMap.set(absenceKey, {
        contract: item.contract,
        name: item.name,
        branch: item.branch?.label,
        branchCode: item.branch?.code,
        period: item.period?.label,
        hours: item.absence.hours,
        value: item.absence.value,
        level: absenceLevel(item.absence.hours),
      });
    }

    for (const event of item.events || []) {
      const kind = overtimeKind(event);
      const reflection = overtimeReflectionKind(event);
      const variable = variableKind(event);
      if (variable) {
        const value = event.value || 0;
        variableTotals[variable] += value;
        if (variable === "Comissões") monthRow.variableCommissions += value;
        if (variable === "Prêmios e bonificações") monthRow.variablePremiums += value;
        if (variable === "Adicionais") monthRow.variableAdditionals += value;

        if (variable === "Comissões") branchRanking.variableCommissions += value;
        if (variable === "Prêmios e bonificações") branchRanking.variablePremiums += value;
        if (variable === "Adicionais") branchRanking.variableAdditionals += value;
        branchRanking.variableTotal += value;

        const variableKey = `${item.branch?.code}-${item.contract}-${item.name}`;
        if (!variableTopMap.has(variableKey)) {
          variableTopMap.set(variableKey, {
            contract: item.contract,
            name: item.name,
            branch: item.branch?.label,
            branchCode: item.branch?.code,
            commissions: 0,
            premiums: 0,
            additionals: 0,
            total: 0,
          });
        }
        const variableTop = variableTopMap.get(variableKey);
        if (variable === "Comissões") variableTop.commissions += value;
        if (variable === "Prêmios e bonificações") variableTop.premiums += value;
        if (variable === "Adicionais") variableTop.additionals += value;
        variableTop.total += value;
      }
      if (reflection) {
        const value = event.value || 0;
        monthRow.overtimeReflectionValue += value;
        branchRanking.overtimeReflectionValue += value;
        branchRanking.overtimeTotalValue += value;
        const topKey = `${item.branch?.code}-${item.contract}-${item.name}`;
        if (!overtimeTopMap.has(topKey)) {
          overtimeTopMap.set(topKey, {
            contract: item.contract,
            name: item.name,
            branch: item.branch?.label,
            branchCode: item.branch?.code,
            jobTitle: item.jobTitle,
            hours50: 0,
            value50: 0,
            hours100: 0,
            value100: 0,
            reflectionValue: 0,
            totalHours: 0,
            totalValue: 0,
          });
        }
        const top = overtimeTopMap.get(topKey);
        top.reflectionValue += value;
        top.totalValue += value;
      }
      if (!kind) continue;
      const hours = event.quantity || 0;
      const value = event.value || 0;
      if (kind === "50") {
        monthRow.overtime50Hours += hours;
        monthRow.overtime50Value += value;
        branchRanking.overtime50Hours += hours;
        branchRanking.overtime50Value += value;
      } else {
        monthRow.overtime100Hours += hours;
        monthRow.overtime100Value += value;
        branchRanking.overtime100Hours += hours;
        branchRanking.overtime100Value += value;
      }
      branchRanking.overtimeTotalHours += hours;
      branchRanking.overtimeTotalValue += value;
      const topKey = `${item.branch?.code}-${item.contract}-${item.name}`;
      if (!overtimeTopMap.has(topKey)) {
        overtimeTopMap.set(topKey, {
          contract: item.contract,
          name: item.name,
          branch: item.branch?.label,
          branchCode: item.branch?.code,
          jobTitle: item.jobTitle,
          hours50: 0,
          value50: 0,
          hours100: 0,
          value100: 0,
          reflectionValue: 0,
          totalHours: 0,
          totalValue: 0,
        });
      }
      const top = overtimeTopMap.get(topKey);
      if (kind === "50") {
        top.hours50 += hours;
        top.value50 += value;
      } else {
        top.hours100 += hours;
        top.value100 += value;
      }
      top.totalHours += hours;
      top.totalValue += value;
    }

    Object.keys(chargeLabels).forEach((key) => {
      const value = item.charges[key] || 0;
      chargeTotals[key] += value;
      monthRow.charges[key] += value;
      branchRanking.charges += value;
    });
  }

  const byMonth = Array.from(byMonthMap.values())
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((item) => ({ ...item, employees: item.employees.size }));
  const byBranch = Array.from(byBranchMap.values())
    .map((item) => ({ ...item, employees: item.employees.size }))
    .sort((a, b) => b.gross - a.gross);
  const charges = Object.entries(chargeTotals)
    .map(([key, value]) => ({ key, name: chargeLabels[key], value: Number(value.toFixed(2)) }))
    .filter((item) => item.value);
  const overtimeTop = Array.from(overtimeTopMap.values())
    .map((item) => ({
      ...item,
      hours50: Number(item.hours50.toFixed(2)),
      value50: Number(item.value50.toFixed(2)),
      hours100: Number(item.hours100.toFixed(2)),
      value100: Number(item.value100.toFixed(2)),
      reflectionValue: Number((item.reflectionValue || 0).toFixed(2)),
      totalHours: Number(item.totalHours.toFixed(2)),
      totalValue: Number(item.totalValue.toFixed(2)),
    }))
    .sort((a, b) => b.totalHours - a.totalHours)
    .slice(0, 5);
  const absenceRecords = Array.from(absenceTopMap.values())
    .map((item) => ({ ...item, hours: Number(item.hours.toFixed(2)), value: Number(item.value.toFixed(2)) }))
    .sort((a, b) => b.hours - a.hours);
  const absenceTop = absenceRecords.slice(0, 10);
  const absenceAlerts = absenceRecords.filter((item) => item.hours >= 8);
  const variableBreakdown = Object.entries(variableTotals)
    .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
    .filter((item) => item.value);
  const variableTop = Array.from(variableTopMap.values())
    .map((item) => ({
      ...item,
      commissions: Number(item.commissions.toFixed(2)),
      premiums: Number(item.premiums.toFixed(2)),
      additionals: Number(item.additionals.toFixed(2)),
      total: Number(item.total.toFixed(2)),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
  const branchRanking = Array.from(branchRankingMap.values())
    .map((item) => ({
      ...item,
      employees: item.employees.size,
      overtime50Hours: Number(item.overtime50Hours.toFixed(2)),
      overtime50Value: Number(item.overtime50Value.toFixed(2)),
      overtime100Hours: Number(item.overtime100Hours.toFixed(2)),
      overtime100Value: Number(item.overtime100Value.toFixed(2)),
      overtimeReflectionValue: Number(item.overtimeReflectionValue.toFixed(2)),
      overtimeTotalHours: Number(item.overtimeTotalHours.toFixed(2)),
      overtimeTotalValue: Number(item.overtimeTotalValue.toFixed(2)),
      absenceHours: Number(item.absenceHours.toFixed(2)),
      absenceValue: Number(item.absenceValue.toFixed(2)),
      medicalCertificateHours: Number(item.medicalCertificateHours.toFixed(2)),
      medicalCertificateValue: Number(item.medicalCertificateValue.toFixed(2)),
      variableCommissions: Number(item.variableCommissions.toFixed(2)),
      variablePremiums: Number(item.variablePremiums.toFixed(2)),
      variableAdditionals: Number(item.variableAdditionals.toFixed(2)),
      variableTotal: Number(item.variableTotal.toFixed(2)),
      loans: Number(item.loans.toFixed(2)),
      vacations: Number(item.vacations.toFixed(2)),
      vacationTerminations: Number(item.vacationTerminations.toFixed(2)),
      charges: Number(item.charges.toFixed(2)),
      gross: Number(item.gross.toFixed(2)),
      net: Number(item.net.toFixed(2)),
    }));

  const overtimeTotals = byMonth.reduce(
    (total, item) => ({
      hours50: total.hours50 + item.overtime50Hours,
      value50: total.value50 + item.overtime50Value,
      hours100: total.hours100 + item.overtime100Hours,
      value100: total.value100 + item.overtime100Value,
      reflectionValue: total.reflectionValue + item.overtimeReflectionValue,
    }),
    { hours50: 0, value50: 0, hours100: 0, value100: 0, reflectionValue: 0 },
  );

  return { rows, records, employees, payroll, net, discounts, admissions, resignations, loans, vacations, vacationTerminations, medicalCertificates, alerts, byMonth, byBranch, branchRanking, charges, overtimeTop, overtimeTotals, absenceTop, absenceAlerts, variableBreakdown, variableTop };
}

function toggleSet(value, setter) {
  setter((current) => {
    const next = new Set(current);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  });
}

function QuickRange({ label, count, periods, setSelectedPeriods, setPeriodMode }) {
  return <button onClick={() => {
    setPeriodMode(count === 1 ? "single" : "multi");
    setSelectedPeriods(new Set(periods.slice(-count)));
  }}>{label}</button>;
}

function ToggleChip({ active, onClick, children }) {
  return (
    <button className={active ? "chip active" : "chip"} onClick={onClick}>
      {children}
    </button>
  );
}

function togglePeriod(period, mode, setter) {
  if (mode === "single") {
    setter(new Set([period]));
    return;
  }
  toggleSet(period, setter);
}

function KpiStrip({ analytics }) {
  return (
    <section className="kpis">
      <Kpi icon={Users} label="Colaboradores" value={analytics.employees.toLocaleString("pt-BR")} />
      <Kpi icon={FileUp} label="Registros folha" value={analytics.records.toLocaleString("pt-BR")} />
      <Kpi icon={BriefcaseBusiness} label="Folha bruta" value={compactCurrency(analytics.payroll)} title={currency(analytics.payroll)} />
      <Kpi icon={TrendingUp} label="Líquido" value={compactCurrency(analytics.net)} title={currency(analytics.net)} />
      <Kpi icon={CheckCircle2} label="Admissões" value={analytics.admissions.length.toLocaleString("pt-BR")} />
      <Kpi icon={ShieldAlert} label="Rescisões" value={analytics.resignations.length.toLocaleString("pt-BR")} />
    </section>
  );
}

function DataStatus({ quality, analytics }) {
  const matched = quality.reconciliationMatched;
  return (
    <section className={matched ? "status-strip ok" : "status-strip warn"}>
      <div>
        {matched ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
        <strong>{matched ? "Valores conferidos com os PDFs" : "Há divergências na conferência"}</strong>
        <span>{quality.reconciliation?.length || 0} arquivos reconciliados; filtro atual com {analytics.rows.length.toLocaleString("pt-BR")} registros.</span>
      </div>
      <span>{matched ? "Diferença total: R$ 0,00" : "Conferir importação"}</span>
    </section>
  );
}

function Kpi({ icon: Icon, label, value, title, tone = "" }) {
  return (
    <article className={`kpi ${tone}`} title={title || `${label}: ${value}`}>
      <Icon size={20} />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Overview({ analytics }) {
  return (
    <section className="grid two">
      <Panel title="Evolução da folha" icon={TrendingUp}>
        <Chart>
          <AreaChart data={analytics.byMonth}>
            <defs>
              <linearGradient id="gross" x1="0" x2="0" y1="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" />
            <YAxis tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
            <Tooltip formatter={(value) => currency(value)} />
            <Area type="monotone" dataKey="gross" name="Bruto" stroke="#d97706" fill="url(#gross)" strokeWidth={2} />
            <Area type="monotone" dataKey="net" name="Líquido" stroke="#2563eb" fill="#dbeafe" strokeWidth={2} />
          </AreaChart>
        </Chart>
      </Panel>
      <Panel title="Folha por filial" icon={Landmark}>
        <Chart>
          <BarChart data={analytics.byBranch.slice(0, 10)} layout="vertical" margin={{ left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
            <YAxis type="category" dataKey="branchCode" width={48} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(value) => currency(value)} />
            <Bar dataKey="gross" name="Folha bruta" radius={[0, 4, 4, 0]} fill="#2563eb" />
          </BarChart>
        </Chart>
      </Panel>
      <Panel title="Resumo por competência" icon={CalendarDays} wide>
        <DataTable
          columns={["Mês", "Colaboradores", "Admissões", "Rescisões", "Bruto", "Líquido", "Consignados"]}
          rows={analytics.byMonth.map((item) => [item.label, item.employees, item.admissions, item.resignations, currency(item.gross), currency(item.net), currency(item.loans)])}
        />
      </Panel>
      <BranchRankingPanel analytics={analytics} />
      <Panel title="Todas as filiais no filtro" icon={Landmark} wide>
        <DataTable
          columns={["Filial", "Colaboradores", "Bruto", "Líquido", "Admissões", "Rescisões", "Consignados", "Férias", "Férias rescisórias"]}
          rows={analytics.byBranch.map((item) => [
            item.branch,
            item.employees,
            currency(item.gross),
            currency(item.net),
            item.admissions,
            item.resignations,
            currency(item.loans),
            currency(item.vacations),
            currency(item.vacationTerminations),
          ])}
        />
      </Panel>
    </section>
  );
}

function BranchRankingPanel({ analytics }) {
  const rankings = [
    {
      title: "Horas extras",
      getValue: (item) => item.overtimeTotalHours,
      formatValue: formatHours,
      detail: (item) => `${formatHours(item.overtime50Hours)} 50% | ${formatHours(item.overtime100Hours)} 100% | ${currency(item.overtimeTotalValue)}`,
    },
    { title: "Admissões", getValue: (item) => item.admissions, formatValue: (value) => value.toLocaleString("pt-BR"), detail: (item) => `${item.employees} colaboradores no filtro` },
    { title: "Rescisões", getValue: (item) => item.resignations, formatValue: (value) => value.toLocaleString("pt-BR"), detail: (item) => `${item.employees} colaboradores no filtro` },
    {
      title: "Atestados",
      getValue: (item) => item.medicalCertificateHours,
      formatValue: formatHours,
      detail: (item) => `${item.medicalCertificateRecords} ocorrências | ${currency(item.medicalCertificateValue)}`,
    },
    { title: "Variáveis", getValue: (item) => item.variableTotal, formatValue: compactCurrency, detail: (item) => `Comissões ${currency(item.variableCommissions)} | Prêmios ${currency(item.variablePremiums)} | Adicionais ${currency(item.variableAdditionals)}` },
    { title: "Consignados", getValue: (item) => item.loans, formatValue: compactCurrency, detail: (item) => currency(item.loans) },
    { title: "Férias", getValue: (item) => item.vacations, formatValue: compactCurrency, detail: (item) => currency(item.vacations) },
    { title: "Férias Rec", getValue: (item) => item.vacationTerminations, formatValue: compactCurrency, detail: (item) => currency(item.vacationTerminations) },
    { title: "Faltas/atrasos", getValue: (item) => item.absenceHours, formatValue: formatHours, detail: (item) => currency(item.absenceValue) },
    { title: "Encargos", getValue: (item) => item.charges, formatValue: compactCurrency, detail: (item) => currency(item.charges) },
  ];

  return (
    <Panel title="Top 5 filiais no filtro" icon={Landmark} wide>
      <div className="branch-ranking-grid">
        {rankings.map((ranking) => (
          <BranchRankingCard key={ranking.title} ranking={ranking} rows={analytics.branchRanking} />
        ))}
      </div>
    </Panel>
  );
}

function BranchRankingCard({ ranking, rows }) {
  const topRows = rows
    .map((item) => ({ ...item, rankingValue: ranking.getValue(item) || 0 }))
    .filter((item) => item.rankingValue > 0)
    .sort((a, b) => b.rankingValue - a.rankingValue)
    .slice(0, 5);

  return (
    <article className="branch-ranking-card">
      <h3>{ranking.title}</h3>
      {topRows.length ? (
        <ol>
          {topRows.map((item) => (
            <li key={`${ranking.title}-${item.branchCode}`}>
              <span>{item.branchCode}</span>
              <div>
                <strong>{ranking.formatValue(item.rankingValue)}</strong>
                <small>{item.branch}</small>
                <em>{ranking.detail(item)}</em>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="empty-mini">Sem dados no filtro</div>
      )}
    </article>
  );
}

function Movement({ analytics }) {
  return (
    <section className="grid two">
      <Panel title="Movimentação mensal" icon={Users} wide>
        <Chart>
          <BarChart data={analytics.byMonth}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="admissions" name="Admissões" fill="#10b981" radius={[4, 4, 0, 0]} />
            <Bar dataKey="resignations" name="Rescisões" fill="#ef4444" radius={[4, 4, 0, 0]} />
          </BarChart>
        </Chart>
      </Panel>
      <Panel title="Admissões" icon={CheckCircle2}>
        <PeopleTable rows={analytics.admissions} dateField="admissionDate" empty="Sem admissões no filtro." />
      </Panel>
      <Panel title="Rescisões" icon={ShieldAlert}>
        <PeopleTable rows={analytics.resignations} dateField="resignationDate" empty="Sem rescisões no filtro." />
      </Panel>
    </section>
  );
}

function Overtime({ analytics }) {
  const overtimeRows = analytics.byMonth.map((item) => [
    item.label,
    formatHours(item.overtime50Hours),
    currency(item.overtime50Value),
    formatHours(item.overtime100Hours),
    currency(item.overtime100Value),
    currency(item.overtimeReflectionValue),
    currency(item.overtime50Value + item.overtime100Value + item.overtimeReflectionValue),
  ]);
  return (
    <section className="grid two">
      <Panel title="Resumo de horas extras no filtro" icon={Clock3} wide>
        <div className="metric-inline">
          <div><span>HE 50%</span><strong>{formatHours(analytics.overtimeTotals.hours50)}</strong><small>{currency(analytics.overtimeTotals.value50)}</small></div>
          <div><span>HE 100%</span><strong>{formatHours(analytics.overtimeTotals.hours100)}</strong><small>{currency(analytics.overtimeTotals.value100)}</small></div>
          <div><span>Reflexos HE</span><strong>{compactCurrency(analytics.overtimeTotals.reflectionValue)}</strong><small>DSR, médias e rescisórios</small></div>
          <div><span>Total HE</span><strong>{formatHours(analytics.overtimeTotals.hours50 + analytics.overtimeTotals.hours100)}</strong><small>{currency(analytics.overtimeTotals.value50 + analytics.overtimeTotals.value100 + analytics.overtimeTotals.reflectionValue)}</small></div>
        </div>
      </Panel>
      <Panel title="Horas extras mês a mês" icon={TrendingUp} wide>
        <Chart>
          <BarChart data={analytics.byMonth}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" />
            <YAxis />
            <Tooltip formatter={(value, name) => [name.includes("Valor") ? currency(value) : formatHours(value), name]} />
            <Legend />
            <Bar dataKey="overtime50Hours" name="HE 50% horas" fill="#2563eb" radius={[4, 4, 0, 0]} />
            <Bar dataKey="overtime100Hours" name="HE 100% horas" fill="#f59e0b" radius={[4, 4, 0, 0]} />
          </BarChart>
        </Chart>
      </Panel>
      <Panel title="Valores de HE por competência" icon={Banknote}>
        <Chart>
          <BarChart data={analytics.byMonth}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" />
            <YAxis tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
            <Tooltip formatter={(value) => currency(value)} />
            <Legend />
            <Bar dataKey="overtime50Value" name="Valor 50%" fill="#2563eb" radius={[4, 4, 0, 0]} />
            <Bar dataKey="overtime100Value" name="Valor 100%" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            <Bar dataKey="overtimeReflectionValue" name="Reflexos HE" fill="#0f766e" radius={[4, 4, 0, 0]} />
          </BarChart>
        </Chart>
      </Panel>
      <Panel title="Top 5 mais horas extras" icon={AlertTriangle}>
        <OvertimeRanking rows={analytics.overtimeTop} />
      </Panel>
      <Panel title="Resumo mensal 50%, 100% e reflexos" icon={CalendarDays} wide>
        <DataTable columns={["Mês", "HE 50%", "Valor 50%", "HE 100%", "Valor 100%", "Reflexos HE", "Total valor"]} rows={overtimeRows} />
      </Panel>
    </section>
  );
}

function OvertimeRanking({ rows }) {
  if (!rows.length) {
    return <div className="empty-state">Sem horas extras no filtro.</div>;
  }

  return (
    <div className="rank-list">
      {rows.map((item, index) => (
        <article className="rank-item" key={`${item.branchCode}-${item.contract}-${item.name}`}>
          <div className="rank-position">{index + 1}</div>
          <div className="rank-main">
            <strong>{item.name}</strong>
            <span>{item.branchCode} · Contrato {item.contract}{item.jobTitle ? ` · ${item.jobTitle}` : ""}</span>
          </div>
          <div className="rank-metrics">
            <div><span>Total</span><strong>{formatHours(item.totalHours)}</strong></div>
            <div><span>50%</span><strong>{formatHours(item.hours50)}</strong></div>
            <div><span>100%</span><strong>{formatHours(item.hours100)}</strong></div>
            <div><span>Reflexos</span><strong>{currency(item.reflectionValue || 0)}</strong></div>
            <div><span>Valor</span><strong>{currency(item.totalValue)}</strong></div>
          </div>
        </article>
      ))}
    </div>
  );
}

function Attendance({ analytics }) {
  const yellow = analytics.absenceAlerts.filter((item) => item.level === "Amarelo").length;
  const red = analytics.absenceAlerts.filter((item) => item.level === "Vermelho").length;
  const totalHours = sum(analytics.rows, (item) => item.absence?.hours);
  const totalValue = sum(analytics.rows, (item) => item.absence?.value);
  const monthlyRows = analytics.byMonth.map((item) => [
    item.label,
    formatHours(item.absenceHours),
    currency(item.absenceValue),
    item.absenceYellow,
    item.absenceRed,
  ]);
  const topRows = analytics.absenceTop.map((item) => [
    item.level || "-",
    item.period,
    item.branch,
    item.contract,
    item.name,
    formatHours(item.hours),
    currency(item.value),
  ]);
  const alertRows = analytics.absenceAlerts.map((item) => [
    item.level,
    item.period,
    item.branch,
    item.contract,
    item.name,
    formatHours(item.hours),
    currency(item.value),
  ]);

  return (
    <section className="grid two">
      <Panel title="Faltas, atrasos e repousos descontados" icon={AlertTriangle} wide>
        <div className="metric-inline">
          <div><span>Horas no filtro</span><strong>{formatHours(totalHours)}</strong><small>{currency(totalValue)}</small></div>
          <div><span>Alerta amarelo</span><strong>{yellow.toLocaleString("pt-BR")}</strong><small>8h a 23,99h no mês</small></div>
          <div><span>Alerta vermelho</span><strong>{red.toLocaleString("pt-BR")}</strong><small>24h ou mais no mês</small></div>
        </div>
      </Panel>
      <Panel title="Evolução mensal de faltas e atrasos" icon={TrendingUp} wide>
        <Chart>
          <BarChart data={analytics.byMonth}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" />
            <YAxis />
            <Tooltip formatter={(value, name) => [name.includes("Valor") ? currency(value) : Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 }), name]} />
            <Legend />
            <Bar dataKey="absenceHours" name="Horas descontadas" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            <Bar dataKey="absenceRed" name="Alertas vermelhos" fill="#ef4444" radius={[4, 4, 0, 0]} />
          </BarChart>
        </Chart>
      </Panel>
      <Panel title="Resumo por competência" icon={CalendarDays}>
        <DataTable columns={["Mês", "Horas", "Valor", "Amarelos", "Vermelhos"]} rows={monthlyRows} />
      </Panel>
      <Panel title="Maiores ocorrências no filtro" icon={ShieldAlert}>
        <DataTable columns={["Nível", "Mês", "Matriz/Filial", "Contrato", "Colaborador", "Horas", "Valor"]} rows={topRows} limit={10} />
      </Panel>
      <Panel title="Alertas para ação no mês" icon={AlertTriangle} wide>
        <DataTable columns={["Nível", "Mês", "Matriz/Filial", "Contrato", "Colaborador", "Horas", "Valor"]} rows={alertRows} empty="Sem alertas de faltas/atrasos no filtro." limit={120} />
      </Panel>
    </section>
  );
}

function MedicalCertificates({ analytics }) {
  const totalHours = sum(analytics.medicalCertificates, medicalCertificateHours);
  const totalValue = sum(analytics.medicalCertificates, medicalCertificateValue);
  const people = uniqueCount(analytics.medicalCertificates, (item) => `${item.branch?.code}-${item.contract}`);
  const detailRows = analytics.medicalCertificates
    .map((item) => [
      item.period?.label,
      branchLabel(item.branch),
      item.contract,
      item.name,
      item.jobTitle || "-",
      formatHours(medicalCertificateHours(item)),
      currency(medicalCertificateValue(item)),
    ])
    .sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <section className="grid two">
      <Panel title="Atestados médicos" icon={ClipboardCheck} wide>
        <div className="metric-inline">
          <div><span>Colaboradores</span><strong>{people.toLocaleString("pt-BR")}</strong><small>No filtro atual</small></div>
          <div><span>Ocorrências</span><strong>{analytics.medicalCertificates.length.toLocaleString("pt-BR")}</strong><small>Rubrica 00007</small></div>
          <div><span>Horas</span><strong>{formatHours(totalHours)}</strong><small>Total informado na folha</small></div>
          <div><span>Valor</span><strong>{compactCurrency(totalValue)}</strong><small>{currency(totalValue)}</small></div>
        </div>
      </Panel>
      <Panel title="Atestados por competência" icon={TrendingUp} wide>
        <Chart>
          <BarChart data={analytics.byMonth}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" />
            <YAxis />
            <Tooltip formatter={(value, name) => [name === "Valor" ? currency(value) : Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 }), name]} />
            <Legend />
            <Bar dataKey="medicalCertificateHours" name="Horas" fill="#2563eb" radius={[4, 4, 0, 0]} />
            <Bar dataKey="medicalCertificateRecords" name="Ocorrências" fill="#10b981" radius={[4, 4, 0, 0]} />
          </BarChart>
        </Chart>
      </Panel>
      <Panel title="Resumo mensal" icon={CalendarDays}>
        <DataTable
          columns={["Mês", "Ocorrências", "Horas", "Valor"]}
          rows={analytics.byMonth.map((item) => [item.label, item.medicalCertificateRecords, formatHours(item.medicalCertificateHours), currency(item.medicalCertificateValue)])}
          empty="Sem atestados no filtro."
        />
      </Panel>
      <Panel title="Atestados por colaborador" icon={Users}>
        <DataTable
          columns={["Mês", "Matriz/Filial", "Contrato", "Colaborador", "Cargo", "Horas", "Valor"]}
          rows={detailRows}
          empty="Sem atestados no filtro."
          limit={120}
        />
      </Panel>
    </section>
  );
}

function Variables({ analytics }) {
  const total = sum(analytics.variableBreakdown, (item) => item.value);
  const loansTotal = sum(analytics.rows, loanValue);
  const categoryValue = (name) => analytics.variableBreakdown.find((item) => item.name === name)?.value || 0;
  const topRows = analytics.variableTop.map((item) => [
    item.branch,
    item.contract,
    item.name,
    currency(item.commissions),
    currency(item.premiums),
    currency(item.additionals),
    currency(item.total),
  ]);

  return (
    <section className="grid two">
      <Panel title="Comissões, prêmios e adicionais" icon={BriefcaseBusiness} wide>
        <div className="metric-inline">
          <div><span>Total variável</span><strong>{compactCurrency(total)}</strong><small>{currency(total)}</small></div>
          <div><span>Comissões</span><strong>{compactCurrency(categoryValue("Comissões"))}</strong><small>{currency(categoryValue("Comissões"))}</small></div>
          <div><span>Prêmios e bonificações</span><strong>{compactCurrency(categoryValue("Prêmios e bonificações"))}</strong><small>{currency(categoryValue("Prêmios e bonificações"))}</small></div>
          <div><span>Adicionais</span><strong>{compactCurrency(categoryValue("Adicionais"))}</strong><small>{currency(categoryValue("Adicionais"))}</small></div>
          <div><span>Consignados</span><strong>{compactCurrency(loansTotal)}</strong><small>{currency(loansTotal)}</small></div>
        </div>
      </Panel>
      <Panel title="Variáveis por competência" icon={TrendingUp} wide>
        <Chart>
          <BarChart data={analytics.byMonth}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" />
            <YAxis tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
            <Tooltip formatter={(value) => currency(value)} />
            <Legend />
            <Bar dataKey="variableCommissions" name="Comissões" fill="#2563eb" radius={[4, 4, 0, 0]} />
            <Bar dataKey="variablePremiums" name="Prêmios" fill="#10b981" radius={[4, 4, 0, 0]} />
            <Bar dataKey="variableAdditionals" name="Adicionais" fill="#f59e0b" radius={[4, 4, 0, 0]} />
          </BarChart>
        </Chart>
      </Panel>
      <Panel title="Composição das variáveis" icon={Banknote}>
        <Chart>
          <BarChart data={analytics.variableBreakdown} layout="vertical" margin={{ left: 28, right: 16 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
            <YAxis type="category" dataKey="name" width={132} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(value) => currency(value)} />
            <Bar dataKey="value" name="Valor" radius={[0, 4, 4, 0]} fill="#2563eb" />
          </BarChart>
        </Chart>
      </Panel>
      <Panel title="Critérios das variáveis" icon={ClipboardCheck}>
        <DataTable
          columns={["Grupo", "O que entra"]}
          rows={[
            ["Comissões", "Somente rubricas 00028 Comissões e 00029 Repouso s/Comissões."],
            ["Prêmios e bonificações", "Somente rubricas 00035, 00088 e 00089."],
            ["Adicionais", "Somente rubricas 00020, 00021, 00022, 00023, 00024, 00037 e 00050."],
          ]}
          limit={10}
        />
      </Panel>
      <Panel title="Top colaboradores por variável" icon={Users}>
        <DataTable columns={["Matriz/Filial", "Contrato", "Colaborador", "Comissões", "Prêmios", "Adicionais", "Total"]} rows={topRows} limit={10} />
      </Panel>
      <Panel title="Consignados por competência" icon={Banknote}>
        <Chart>
          <BarChart data={analytics.byMonth}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" />
            <YAxis tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
            <Tooltip formatter={(value) => currency(value)} />
            <Bar dataKey="loans" name="Consignados" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </Chart>
      </Panel>
      <Panel title="Empréstimos consignados" icon={Banknote}>
        <DataTable columns={["Contrato", "Colaborador", "Matriz/Filial", "Mês", "Valor"]} rows={analytics.loans.slice(0, 80).map((item) => [item.contract, item.name, branchLabel(item.branch), item.period.label, currency(loanValue(item))])} />
      </Panel>
    </section>
  );
}

function Charges({ analytics }) {
  return (
    <section className="grid two">
      <Panel title="Encargos por tipo" icon={Landmark}>
        <Chart>
          <BarChart data={analytics.charges} layout="vertical" margin={{ left: 28, right: 16 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
            <YAxis type="category" dataKey="name" width={112} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(value) => currency(value)} />
            <Bar dataKey="value" name="Valor" radius={[0, 4, 4, 0]} fill="#2563eb" />
          </BarChart>
        </Chart>
      </Panel>
      <Panel title="Valores por tipo" icon={Banknote}>
        <DataTable columns={["Encargo", "Valor"]} rows={analytics.charges.map((item) => [item.name, currency(item.value)])} />
      </Panel>
      <Panel title="Encargos por competência" icon={CalendarDays} wide>
        <DataTable
          columns={["Mês", "INSS colab.", "INSS empresa", "FGTS", "RAT x FAP", "Terceiros", "GPS", "IRRF"]}
          rows={analytics.byMonth.map((item) => [
            item.label,
            currency(item.charges.inss_employee),
            currency(item.charges.inss_company),
            currency(item.charges.fgts),
            currency(item.charges.rat_fap),
            currency(item.charges.third_parties),
            currency(item.charges.gps_total),
            currency(item.charges.irrf),
          ])}
        />
      </Panel>
    </section>
  );
}

function Benefits({ analytics }) {
  return (
    <section className="grid two">
      <Panel title="Férias e férias rescisórias por competência" icon={CalendarDays} wide>
        <Chart>
          <BarChart data={analytics.byMonth}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" />
            <YAxis tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
            <Tooltip formatter={(value) => currency(value)} />
            <Legend />
            <Bar dataKey="vacations" name="Férias" fill="#0f766e" radius={[4, 4, 0, 0]} />
            <Bar dataKey="vacationTerminations" name="Férias rescisórias" fill="#ef4444" radius={[4, 4, 0, 0]} />
          </BarChart>
        </Chart>
      </Panel>
      <Panel title="Resumo por competência" icon={ClipboardCheck}>
        <DataTable columns={["Mês", "Férias", "Férias rescisórias"]} rows={analytics.byMonth.map((item) => [item.label, currency(item.vacations), currency(item.vacationTerminations)])} />
      </Panel>
      <Panel title="Férias" icon={CalendarDays}>
        <DataTable
          columns={["Colaborador", "Matriz/Filial", "Saída", "Dias", "Custo"]}
          rows={analytics.vacations.slice(0, 80).map((item) => [item.name, branchLabel(item.branch), shortDate(item.vacation.start), item.vacation.days || "-", currency(vacationValue(item))])}
        />
      </Panel>
      <Panel title="Férias rescisórias" icon={ShieldAlert}>
        <DataTable
          columns={["Colaborador", "Matriz/Filial", "Mês", "Contrato", "Valor"]}
          rows={analytics.vacationTerminations.slice(0, 80).map((item) => [item.name, branchLabel(item.branch), item.period.label, item.contract, currency(vacationTerminationValue(item))])}
          empty="Sem férias rescisórias no filtro."
        />
      </Panel>
    </section>
  );
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function Audit({ dataset, analytics, importHistory, onRemovePeriod, removingPeriod, isAdmin }) {
  const quality = dataset.quality || {};
  const reconciliationRows = (quality.reconciliation || []).map((item) => [
    item.sourceFile,
    item.sourcePage,
    item.matched ? "Batido" : "Divergente",
    currency(item.pdf.gross),
    currency(item.app.gross),
    currency(item.pdf.net),
    currency(item.app.net),
    `${currency(item.difference.gross)} / ${currency(item.difference.net)}`,
  ]);
  const unclassifiedRows = (quality.unclassifiedEvents || []).map((item) => [
    item.code || "-",
    item.description || "-",
    (item.count || 0).toLocaleString("pt-BR"),
    currency(item.value || 0),
  ]);
  const diagnosticRows = (quality.diagnostics || []).map((item) => [
    item.sourceFile || item.file || "-",
    item.page || "-",
    item.branch || "-",
    item.message || item.detail || String(item),
  ]);
  const historyRows = (importHistory || []).map((entry) => [
    formatDateTime(entry.importedAt),
    entry.status === "imported" ? "Importado" : entry.status === "blocked" ? "Bloqueado" : "Falhou",
    (entry.files || []).join(", "),
    entry.summary?.periods?.map(periodLabel).join(", ") || "-",
    entry.summary?.branches?.toLocaleString("pt-BR") || "-",
    entry.summary?.employeeRecords?.toLocaleString("pt-BR") || "-",
    entry.summary?.reconciliationMatched ? "Sim" : "Não",
    entry.detail || "-",
  ]);

  return (
    <section className="grid two">
      <Panel title="Auditoria da base atual" icon={ClipboardCheck} wide>
        <div className="metric-inline">
          <div><span>PDFs ativos</span><strong>{dataset.sources.length.toLocaleString("pt-BR")}</strong><small>{dataset.periods.map(periodLabel).join(", ")}</small></div>
          <div><span>Registros extraídos</span><strong>{quality.employeeRecords.toLocaleString("pt-BR")}</strong><small>{dataset.branches.length.toLocaleString("pt-BR")} filiais identificadas</small></div>
          <div><span>Conferência</span><strong>{quality.reconciliationMatched ? "Batido" : "Divergente"}</strong><small>{quality.reconciliation?.filter((item) => item.matched).length || 0}/{quality.reconciliation?.length || 0} arquivos reconciliados</small></div>
          <div><span>Verbas novas</span><strong>{(quality.unclassifiedEventCount || 0).toLocaleString("pt-BR")}</strong><small>eventos não classificados</small></div>
          <div><span>Diagnósticos</span><strong>{(quality.diagnosticCount || 0).toLocaleString("pt-BR")}</strong><small>falhas ou avisos do parser</small></div>
          <div><span>Filtro atual</span><strong>{analytics.rows.length.toLocaleString("pt-BR")}</strong><small>registros em análise</small></div>
        </div>
      </Panel>
      <Panel title="Backup e retenção" icon={Download} wide>
        <div className="backup-box">
          <div>
            <strong>Histórico preservado no Supabase</strong>
            <span>Os PDFs enviados ficam armazenados no bucket privado, e cada importação fica registrada no histórico. O botão abaixo exporta uma cópia JSON da base ativa, reconciliação e histórico visível.</span>
          </div>
          <button className="secondary-action" onClick={() => exportBackup(dataset, importHistory)}>
            <Download size={18} />
            Backup JSON
          </button>
        </div>
      </Panel>
      <Panel title="Conferência com os PDFs" icon={CheckCircle2} wide>
        <DataTable
          columns={["Arquivo", "Página", "Status", "Bruto PDF", "Bruto App", "Líquido PDF", "Líquido App", "Diferença"]}
          rows={reconciliationRows}
          empty="Nenhum arquivo reconciliado ainda."
          limit={120}
        />
      </Panel>
      <Panel title="Histórico de importações manuais" icon={FileUp} wide>
        {isAdmin && (
          <div className="period-admin">
            <div>
              <strong>Meses ativos na base</strong>
              <span>Remover tira o mês do BI atual, sem apagar o PDF nem o registro da importação no Supabase.</span>
            </div>
            <div className="period-admin-actions">
              {(dataset.periods || []).map((period) => (
                <button key={period} onClick={() => onRemovePeriod(period)} disabled={Boolean(removingPeriod)} title={`Remover ${periodLabel(period)} da base ativa`}>
                  <Trash2 size={14} />
                  {removingPeriod === period ? "Removendo..." : periodLabel(period)}
                </button>
              ))}
            </div>
          </div>
        )}
        <DataTable
          columns={["Data", "Status", "Arquivos", "Períodos", "Filiais", "Registros", "Batido", "Detalhe"]}
          rows={historyRows}
          empty="Nenhuma importação manual registrada ainda."
          limit={40}
        />
      </Panel>
      <Panel title="Verbas não classificadas" icon={ShieldAlert}>
        <DataTable
          columns={["Código", "Descrição", "Ocorrências", "Valor"]}
          rows={unclassifiedRows}
          empty="Nenhuma verba nova sem classificação."
          limit={80}
        />
      </Panel>
      <Panel title="Diagnósticos do parser" icon={AlertTriangle}>
        <DataTable
          columns={["Arquivo", "Página", "Filial", "Diagnóstico"]}
          rows={diagnosticRows}
          empty="Sem diagnósticos de falha na importação atual."
          limit={80}
        />
      </Panel>
    </section>
  );
}

function AuthScreen({ mode, error, onSubmit }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const firstAccess = mode === "setup";

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit({ name, email, password });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <form className="auth-form" onSubmit={submit}>
          <img src="/brand/florybal-logo.png" alt="Florybal Chocolates" />
          <span>Business intelligence RH/DP</span>
          <h1>{firstAccess ? "Criar primeiro acesso" : "Entrar no BI"}</h1>
          <p>{firstAccess ? "Este usuário será o administrador inicial do painel." : "Use seu e-mail e senha para acessar os dados da folha."}</p>
          {error && <div className="notice danger">{error}</div>}
          {firstAccess && (
            <label>
              Nome
              <input value={name} onChange={(event) => setName(event.target.value)} required autoComplete="name" />
            </label>
          )}
          <label>
            E-mail
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
          </label>
          <label>
            Senha
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} autoComplete={firstAccess ? "new-password" : "current-password"} />
          </label>
          <button className="secondary-action" disabled={submitting}>{submitting ? "Aguarde..." : firstAccess ? "Criar acesso" : "Entrar"}</button>
        </form>
        <aside className="auth-brand">
          <img src="/brand/florybal-logo.png" alt="" />
          <div>
            <strong>BI Florybal Chocolates</strong>
            <span>Folha de pagamento, indicadores e auditoria em um só ambiente.</span>
          </div>
        </aside>
      </section>
    </main>
  );
}

function AccessPanel({ apiRequest, currentUser }) {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "user" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadUsers() {
    const response = await apiRequest("/api/auth/users");
    const payload = await response.json();
    if (response.ok) setUsers(payload);
    else setMessage(payload.error || "Falha ao carregar acessos.");
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function createAccess(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await apiRequest("/api/auth/users", {
        method: "POST",
        body: JSON.stringify(form),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao criar acesso.");
      setForm({ name: "", email: "", password: "", role: "user" });
      setMessage("Acesso criado com sucesso.");
      await loadUsers();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeAccess(user) {
    setBusy(true);
    setMessage("");
    try {
      const response = await apiRequest(`/api/auth/users/${encodeURIComponent(user.id)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao excluir acesso.");
      setMessage("Acesso excluído.");
      await loadUsers();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid two">
      <Panel title="Criar acesso" icon={UserPlus}>
        <form className="access-form" onSubmit={createAccess}>
          <label>Nome<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
          <label>E-mail<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label>
          <label>Senha<input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required minLength={8} /></label>
          <label>Perfil<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}><option value="user">Usuário</option><option value="admin">Administrador</option></select></label>
          <button className="secondary-action" disabled={busy}>{busy ? "Salvando..." : "Criar acesso"}</button>
          {message && <span className="form-message">{message}</span>}
        </form>
      </Panel>
      <Panel title="Acessos cadastrados" icon={Users}>
        <div className="record-list">
          {users.map((user) => (
            <article className="record-row access-row" key={user.id}>
              <div className="record-primary">
                <span>{user.role === "admin" ? "Administrador" : "Usuário"}</span>
                <strong>{user.name}</strong>
              </div>
              <div className="record-fields">
                <div className="record-field"><span>E-mail</span><strong>{user.email}</strong></div>
                <div className="record-field"><span>Último acesso</span><strong>{user.lastSignInAt ? formatDateTime(user.lastSignInAt) : "-"}</strong></div>
                <button className="danger-action" onClick={() => removeAccess(user)} disabled={busy || user.id === currentUser.id}>
                  <Trash2 size={15} />
                  Excluir
                </button>
              </div>
            </article>
          ))}
        </div>
      </Panel>
    </section>
  );
}

function ConfirmDialog({ title, message, confirmLabel, cancelLabel, onConfirm, onCancel }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="confirm-icon">
          <AlertTriangle size={22} />
        </div>
        <div className="confirm-copy">
          <h2 id="confirm-title">{title}</h2>
          <p>{message}</p>
        </div>
        <div className="confirm-actions">
          <button className="secondary-action ghost" onClick={onCancel}>{cancelLabel}</button>
          <button className="secondary-action" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}

function importSummaryFromDataset(payload, files) {
  const rows = payload.employees || [];
  return {
    files: files.map((file) => file.name),
    periods: payload.periods || [],
    branches: payload.branches || [],
    branchCount: payload.branches?.length || 0,
    employeeRecords: payload.quality?.employeeRecords || rows.length,
    gross: sum(rows, (row) => row.totals?.gross),
    net: sum(rows, (row) => row.totals?.net),
    admissions: rows.filter((row) => row.admission?.date).length,
    terminations: rows.filter((row) => row.termination?.date).length,
    reconciliationMatched: Boolean(payload.quality?.reconciliationMatched),
    unclassifiedEventCount: payload.quality?.unclassifiedEventCount || 0,
  };
}

function ImportProgressModal({ state, onClose }) {
  const running = state.status === "running";
  const done = state.status === "done";
  const failed = state.status === "error";
  const summary = state.summary || {};
  const steps = ["Enviando PDFs", "Extraindo folha", "Conferindo totais", "Salvando histórico"];

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div className={failed ? "import-icon danger" : done ? "import-icon success" : "import-icon"}>
          {failed ? <AlertTriangle size={24} /> : done ? <CheckCircle2 size={24} /> : <RefreshCw size={24} />}
        </div>
        <div className="import-copy">
          <span>{state.replaceExisting ? "Substituição de competência" : "Importação de folha"}</span>
          <h2 id="import-title">
            {running && "Importando e conferindo PDFs"}
            {done && "Importação concluída"}
            {failed && "Importação não concluída"}
          </h2>
          <p>
            {running && "Mantenha esta janela aberta enquanto o sistema lê a folha, valida os totais e salva o histórico."}
            {done && "Os dados foram incorporados à base e já estão disponíveis nos filtros do painel."}
            {failed && state.error}
          </p>
        </div>

        <div className="import-files">
          {(state.files || []).map((file) => (
            <span key={file}>{file}</span>
          ))}
        </div>

        {running && (
          <div className="import-steps">
            {steps.map((step) => (
              <div key={step} className="import-step active">
                <span />
                {step}
              </div>
            ))}
          </div>
        )}

        {done && (
          <div className="import-summary-grid">
            <div><span>Períodos</span><strong>{(summary.periods || []).map(periodLabel).join(", ") || "-"}</strong></div>
            <div><span>Filiais</span><strong>{summary.branchCount || summary.branches?.length || 0}</strong></div>
            <div><span>Registros</span><strong>{Number(summary.employeeRecords || 0).toLocaleString("pt-BR")}</strong></div>
            <div><span>Folha bruta</span><strong>{currency(summary.gross)}</strong></div>
            <div><span>Líquido</span><strong>{currency(summary.net)}</strong></div>
            <div><span>Admissões</span><strong>{summary.admissions || 0}</strong></div>
            <div><span>Rescisões</span><strong>{summary.terminations || 0}</strong></div>
            <div><span>Conferência</span><strong>{summary.reconciliationMatched ? "Valores batem" : "Revisar"}</strong></div>
            <div><span>Rubricas novas</span><strong>{summary.unclassifiedEventCount || 0}</strong></div>
          </div>
        )}

        {!running && (
          <div className="import-actions">
            <button className="primary-action" onClick={onClose}>
              Entendi
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function exportBackup(dataset, importHistory) {
  const payload = {
    exportedAt: new Date().toISOString(),
    product: "BI Florybal Chocolates",
    periods: dataset.periods,
    sources: dataset.sources,
    quality: dataset.quality,
    branches: dataset.branches,
    employees: dataset.employees,
    importHistory,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `backup-bi-florybal-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function branchRankingExportRows(rows) {
  const rankings = [
    { label: "Horas extras", valueKey: "overtimeTotalHours", moneyKey: "overtimeTotalValue", detail: (item) => `HE 50 ${formatHours(item.overtime50Hours)} | HE 100 ${formatHours(item.overtime100Hours)} | Reflexos ${currency(item.overtimeReflectionValue)}` },
    { label: "Admissoes", valueKey: "admissions", detail: (item) => `${item.employees} colaboradores no filtro` },
    { label: "Rescisoes", valueKey: "resignations", detail: (item) => `${item.employees} colaboradores no filtro` },
    { label: "Atestados", valueKey: "medicalCertificateHours", moneyKey: "medicalCertificateValue", detail: (item) => `${item.medicalCertificateRecords} ocorrencias` },
    { label: "Variaveis", valueKey: "variableTotal", moneyKey: "variableTotal", detail: (item) => `Comissoes ${currency(item.variableCommissions)} | Premios ${currency(item.variablePremiums)} | Adicionais ${currency(item.variableAdditionals)}` },
    { label: "Consignados", valueKey: "loans", moneyKey: "loans", detail: () => "" },
    { label: "Ferias", valueKey: "vacations", moneyKey: "vacations", detail: () => "" },
    { label: "Ferias Rec", valueKey: "vacationTerminations", moneyKey: "vacationTerminations", detail: () => "" },
    { label: "Faltas e atrasos", valueKey: "absenceHours", moneyKey: "absenceValue", detail: () => "" },
    { label: "Encargos", valueKey: "charges", moneyKey: "charges", detail: () => "" },
  ];

  return rankings.flatMap((ranking) =>
    rows
      .filter((item) => (item[ranking.valueKey] || 0) > 0)
      .sort((a, b) => (b[ranking.valueKey] || 0) - (a[ranking.valueKey] || 0))
      .slice(0, 5)
      .map((item, index) => ({
        ranking: ranking.label,
        position: index + 1,
        branch: item.branch,
        branchCode: item.branchCode,
        mainValue: item[ranking.valueKey] || 0,
        moneyValue: ranking.moneyKey ? item[ranking.moneyKey] || 0 : "",
        detail: ranking.detail(item),
      })),
  );
}

async function exportWorkbook(rows) {
  const { default: ExcelJS } = await import("exceljs");
  const analytics = buildAnalytics(rows);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BI Florybal Chocolates";
  workbook.created = new Date();
  workbook.modified = new Date();

  addSheet(
    workbook,
    "Resumo",
    [
      { header: "Indicador", key: "metric", width: 30 },
      { header: "Valor", key: "value", width: 22 },
      { header: "Tipo", key: "type", width: 8 },
    ],
    [
      { metric: "Colaboradores unicos", value: analytics.employees, type: "number" },
      { metric: "Registros de folha", value: analytics.records, type: "number" },
      { metric: "Folha bruta", value: analytics.payroll, type: "currency" },
      { metric: "Descontos", value: analytics.discounts, type: "currency" },
      { metric: "Liquido", value: analytics.net, type: "currency" },
      { metric: "Admissoes", value: analytics.admissions.length, type: "number" },
      { metric: "Rescisoes", value: analytics.resignations.length, type: "number" },
      { metric: "Alertas", value: analytics.alerts.length, type: "number" },
      { metric: "Horas extras 50%", value: analytics.overtimeTotals.hours50, type: "number" },
      { metric: "Horas extras 100%", value: analytics.overtimeTotals.hours100, type: "number" },
      { metric: "Reflexos HE", value: analytics.overtimeTotals.reflectionValue, type: "currency" },
      { metric: "Atestados - horas", value: sum(analytics.medicalCertificates, medicalCertificateHours), type: "number" },
      { metric: "Atestados - valor", value: sum(analytics.medicalCertificates, medicalCertificateValue), type: "currency" },
    ],
    { specialSummaryFormatting: true },
  );

  addSheet(
    workbook,
    "Resumo Mes",
    [
      { header: "Periodo", key: "period", width: 12 },
      { header: "Colaboradores", key: "employees", width: 14 },
      { header: "Admissoes", key: "admissions", width: 12 },
      { header: "Rescisoes", key: "resignations", width: 12 },
      { header: "Bruto", key: "gross", width: 16 },
      { header: "Descontos", key: "discounts", width: 16 },
      { header: "Liquido", key: "net", width: 16 },
      { header: "HE 50 h", key: "overtime50Hours", width: 12 },
      { header: "HE 50 valor", key: "overtime50Value", width: 16 },
      { header: "HE 100 h", key: "overtime100Hours", width: 12 },
      { header: "HE 100 valor", key: "overtime100Value", width: 16 },
      { header: "Reflexos HE", key: "overtimeReflectionValue", width: 16 },
      { header: "Faltas/Atrasos h", key: "absenceHours", width: 16 },
      { header: "Faltas/Atrasos valor", key: "absenceValue", width: 18 },
      { header: "Consignados", key: "loans", width: 16 },
      { header: "Ferias", key: "vacations", width: 16 },
      { header: "Ferias Rec", key: "vacationTerminations", width: 16 },
      { header: "Atestados h", key: "medicalCertificateHours", width: 14 },
      { header: "Atestados valor", key: "medicalCertificateValue", width: 16 },
    ],
    analytics.byMonth.map((item) => ({
      period: item.label,
      employees: item.employees,
      admissions: item.admissions,
      resignations: item.resignations,
      gross: item.gross,
      discounts: item.discounts,
      net: item.net,
      overtime50Hours: item.overtime50Hours,
      overtime50Value: item.overtime50Value,
      overtime100Hours: item.overtime100Hours,
      overtime100Value: item.overtime100Value,
      overtimeReflectionValue: item.overtimeReflectionValue,
      absenceHours: item.absenceHours,
      absenceValue: item.absenceValue,
      loans: item.loans,
      vacations: item.vacations,
      vacationTerminations: item.vacationTerminations,
      medicalCertificateHours: item.medicalCertificateHours,
      medicalCertificateValue: item.medicalCertificateValue,
    })),
    { currencyKeys: new Set(["gross", "discounts", "net", "overtime50Value", "overtime100Value", "overtimeReflectionValue", "absenceValue", "loans", "vacations", "vacationTerminations", "medicalCertificateValue"]) },
  );

  addSheet(
    workbook,
    "Ranking Filiais",
    [
      { header: "Ranking", key: "ranking", width: 22 },
      { header: "Posicao", key: "position", width: 10 },
      { header: "Filial", key: "branch", width: 30 },
      { header: "Codigo", key: "branchCode", width: 10 },
      { header: "Valor principal", key: "mainValue", width: 16 },
      { header: "Valor R$", key: "moneyValue", width: 16 },
      { header: "Detalhe", key: "detail", width: 48 },
    ],
    branchRankingExportRows(analytics.branchRanking),
    { currencyKeys: new Set(["moneyValue"]) },
  );

  addSheet(workbook, "Colaboradores", baseColumns(), rows.map(baseEmployeeRow), {
    currencyKeys: new Set(["gross", "discounts", "net", "salary", "overtimeValue", "overtimeReflectionValue", "absenceValue", "variablesValue", "loansValue", "vacationCost", "vacationTerminationCost"]),
    dateKeys: new Set(["admissionDate", "resignationDate", "vacationStart", "vacationEnd"]),
  });

  addSheet(workbook, "Admissoes", movementColumns("Admissao"), analytics.admissions.map((item) => movementRow(item, "admissionDate")), { dateKeys: new Set(["date"]) });
  addSheet(workbook, "Rescisoes", movementColumns("Rescisao"), analytics.resignations.map((item) => movementRow(item, "resignationDate")), { dateKeys: new Set(["date"]) });

  addSheet(
    workbook,
    "Horas Extras",
    [
      ...personColumns(),
      { header: "HE 50 h", key: "hours50", width: 12 },
      { header: "HE 50 valor", key: "value50", width: 16 },
      { header: "HE 100 h", key: "hours100", width: 12 },
      { header: "HE 100 valor", key: "value100", width: 16 },
      { header: "Reflexos HE", key: "reflectionValue", width: 16 },
      { header: "Total h", key: "totalHours", width: 12 },
      { header: "Total valor", key: "totalValue", width: 16 },
    ],
    analytics.overtimeTop.map((item) => ({
      period: item.period,
      branch: item.branch,
      contract: item.contract,
      name: item.name,
      jobTitle: item.jobTitle || "",
      hours50: item.hours50,
      value50: item.value50,
      hours100: item.hours100,
      value100: item.value100,
      reflectionValue: item.reflectionValue || 0,
      totalHours: item.totalHours,
      totalValue: item.totalValue,
    })),
    { currencyKeys: new Set(["value50", "value100", "reflectionValue", "totalValue"]) },
  );

  addSheet(
    workbook,
    "Faltas Atrasos",
    [
      ...personColumns(),
      { header: "Nivel", key: "level", width: 12 },
      { header: "Horas", key: "hours", width: 12 },
      { header: "Valor", key: "value", width: 16 },
    ],
    analytics.absenceTop.map((item) => ({
      period: item.period,
      branch: item.branch,
      contract: item.contract,
      name: item.name,
      jobTitle: item.jobTitle || "",
      level: item.level || "-",
      hours: item.hours,
      value: item.value,
    })),
    { currencyKeys: new Set(["value"]) },
  );

  addSheet(
    workbook,
    "Atestados",
    [
      ...personColumns(),
      { header: "Horas", key: "hours", width: 12 },
      { header: "Valor", key: "value", width: 16 },
    ],
    analytics.medicalCertificates.map((item) => ({
      period: item.period?.label,
      branch: branchLabel(item.branch),
      contract: item.contract,
      name: item.name,
      jobTitle: item.jobTitle || "",
      hours: medicalCertificateHours(item),
      value: medicalCertificateValue(item),
    })),
    { currencyKeys: new Set(["value"]) },
  );

  addSheet(
    workbook,
    "Variaveis",
    [
      ...personColumns(),
      { header: "Comissoes", key: "commissions", width: 16 },
      { header: "Premios", key: "premiums", width: 16 },
      { header: "Adicionais", key: "additionals", width: 16 },
      { header: "Total", key: "total", width: 16 },
    ],
    analytics.variableTop.map((item) => ({
      period: item.period,
      branch: item.branch,
      contract: item.contract,
      name: item.name,
      jobTitle: item.jobTitle || "",
      commissions: item.commissions,
      premiums: item.premiums,
      additionals: item.additionals,
      total: item.total,
    })),
    { currencyKeys: new Set(["commissions", "premiums", "additionals", "total"]) },
  );

  addSheet(
    workbook,
    "Ferias",
    [
      ...personColumns(),
      { header: "Saida", key: "vacationStart", width: 13 },
      { header: "Retorno", key: "vacationEnd", width: 13 },
      { header: "Dias", key: "vacationDays", width: 10 },
      { header: "Custo", key: "vacationCost", width: 16 },
    ],
    analytics.vacations.map((item) => ({
      period: item.period?.label,
      branch: branchLabel(item.branch),
      contract: item.contract,
      name: item.name,
      jobTitle: item.jobTitle || "",
      vacationStart: excelDate(item.vacation?.start),
      vacationEnd: excelDate(item.vacation?.end),
      vacationDays: item.vacation?.days || "",
      vacationCost: vacationValue(item),
    })),
    { currencyKeys: new Set(["vacationCost"]), dateKeys: new Set(["vacationStart", "vacationEnd"]) },
  );

  addSheet(
    workbook,
    "Ferias Rec",
    [...personColumns(), { header: "Valor", key: "vacationTerminationCost", width: 16 }],
    analytics.vacationTerminations.map((item) => ({
      period: item.period?.label,
      branch: branchLabel(item.branch),
      contract: item.contract,
      name: item.name,
      jobTitle: item.jobTitle || "",
      vacationTerminationCost: vacationTerminationValue(item),
    })),
    { currencyKeys: new Set(["vacationTerminationCost"]) },
  );

  addSheet(
    workbook,
    "Consignados",
    [...personColumns(), { header: "Valor", key: "loansValue", width: 16 }],
    analytics.loans.map((item) => ({
      period: item.period?.label,
      branch: branchLabel(item.branch),
      contract: item.contract,
      name: item.name,
      jobTitle: item.jobTitle || "",
      loansValue: loanValue(item),
    })),
    { currencyKeys: new Set(["loansValue"]) },
  );

  addSheet(workbook, "Encargos", [
    { header: "Encargo", key: "name", width: 24 },
    { header: "Valor", key: "value", width: 18 },
  ], analytics.charges, { currencyKeys: new Set(["value"]) });

  addSheet(
    workbook,
    "Eventos",
    [
      ...personColumns(),
      { header: "Codigo", key: "code", width: 12 },
      { header: "Descricao", key: "description", width: 34 },
      { header: "Quantidade", key: "quantity", width: 14 },
      { header: "Valor", key: "value", width: 16 },
      { header: "Tipo", key: "kind", width: 18 },
    ],
    rows.flatMap((item) => (item.events || []).map((event) => ({
      period: item.period?.label,
      branch: branchLabel(item.branch),
      contract: item.contract,
      name: item.name,
      jobTitle: item.jobTitle || "",
      code: event.code,
      description: event.description,
      quantity: event.quantity ?? "",
      value: event.value || 0,
      kind: overtimeKind(event) ? `Hora extra ${overtimeKind(event)}%` : absenceKind(event) || variableKind(event) || "",
    }))),
    { currencyKeys: new Set(["value"]) },
  );

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `florybal-rh-bi-${new Date().toISOString().slice(0, 10)}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}

function addSheet(workbook, name, columns, rows, options = {}) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns;
  sheet.addRows(rows);
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, sheet.rowCount), column: columns.length },
  };

  const header = sheet.getRow(1);
  header.height = 22;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = thinBorder();
  });

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.height = 20;
    row.eachCell((cell, columnNumber) => {
      const key = columns[columnNumber - 1]?.key;
      cell.border = thinBorder("FFE2E8F0");
      cell.alignment = { vertical: "middle", wrapText: false };
      if (rowNumber % 2 === 0) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      }
      if (options.currencyKeys?.has(key)) cell.numFmt = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
      if (options.dateKeys?.has(key) && cell.value) cell.numFmt = "dd/mm/yyyy";
      if (typeof cell.value === "number" && !options.currencyKeys?.has(key)) cell.numFmt = "#,##0.00";
      if (options.specialSummaryFormatting && key === "value") {
        const type = sheet.getRow(rowNumber).getCell("C").value;
        if (type === "currency") cell.numFmt = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
        if (type === "number") cell.numFmt = "#,##0.00";
      }
    });
  });

  if (options.specialSummaryFormatting) {
    sheet.getColumn("C").hidden = true;
  }
}

function thinBorder(color = "FFCBD5E1") {
  return {
    top: { style: "thin", color: { argb: color } },
    left: { style: "thin", color: { argb: color } },
    bottom: { style: "thin", color: { argb: color } },
    right: { style: "thin", color: { argb: color } },
  };
}

function excelDate(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function personColumns() {
  return [
    { header: "Periodo", key: "period", width: 12 },
    { header: "Matriz/Filial", key: "branch", width: 28 },
    { header: "Contrato", key: "contract", width: 12 },
    { header: "Colaborador", key: "name", width: 32 },
    { header: "Cargo", key: "jobTitle", width: 28 },
  ];
}

function baseColumns() {
  return [
    ...personColumns(),
    { header: "Admissao", key: "admissionDate", width: 13 },
    { header: "Rescisao", key: "resignationDate", width: 13 },
    { header: "Salario", key: "salary", width: 16 },
    { header: "Bruto", key: "gross", width: 16 },
    { header: "Descontos", key: "discounts", width: 16 },
    { header: "Liquido", key: "net", width: 16 },
    { header: "HE h", key: "overtimeHours", width: 12 },
    { header: "HE valor", key: "overtimeValue", width: 16 },
    { header: "Reflexos HE", key: "overtimeReflectionValue", width: 16 },
    { header: "Faltas/Atrasos h", key: "absenceHours", width: 16 },
    { header: "Faltas/Atrasos valor", key: "absenceValue", width: 18 },
    { header: "Variaveis", key: "variablesValue", width: 16 },
    { header: "Consignado", key: "loansValue", width: 16 },
    { header: "Ferias", key: "vacationCost", width: 16 },
    { header: "Ferias Rec", key: "vacationTerminationCost", width: 16 },
    { header: "Inicio Ferias", key: "vacationStart", width: 13 },
    { header: "Fim Ferias", key: "vacationEnd", width: 13 },
    { header: "Dias Ferias", key: "vacationDays", width: 12 },
    { header: "Alertas", key: "validation", width: 42 },
  ];
}

function baseEmployeeRow(item) {
  return {
    period: item.period?.label,
    branch: branchLabel(item.branch),
    contract: item.contract,
    name: item.name,
    jobTitle: item.jobTitle || "",
    admissionDate: excelDate(item.admissionDate),
    resignationDate: excelDate(item.resignationDate),
    salary: item.totals?.salary || 0,
    gross: item.totals?.gross || 0,
    discounts: item.totals?.discounts || 0,
    net: item.totals?.net || 0,
    overtimeHours: item.overtime?.hours || 0,
    overtimeValue: item.overtime?.value || 0,
    overtimeReflectionValue: overtimeReflectionValue(item),
    absenceHours: item.absence?.hours || 0,
    absenceValue: item.absence?.value || 0,
    variablesValue: variablesValue(item),
    loansValue: loanValue(item),
    vacationCost: vacationValue(item),
    vacationTerminationCost: vacationTerminationValue(item),
    vacationStart: excelDate(item.vacation?.start),
    vacationEnd: excelDate(item.vacation?.end),
    vacationDays: item.vacation?.days || "",
    validation: (item.validation || []).join("; "),
  };
}

function movementColumns(label) {
  return [
    { header: label, key: "date", width: 13 },
    ...personColumns(),
  ];
}

function movementRow(item, dateField) {
  return {
    date: excelDate(item[dateField]),
    period: item.period?.label,
    branch: branchLabel(item.branch),
    contract: item.contract,
    name: item.name,
    jobTitle: item.jobTitle || "",
  };
}

function PeopleTable({ rows, dateField, empty }) {
  return (
    <DataTable
      columns={["Nº", "Nome", "Matriz/Filial", "Data", "Cargo"]}
      rows={rows.slice(0, 90).map((item) => [item.contract, item.name, branchLabel(item.branch), shortDate(item[dateField]), item.jobTitle || "-"])}
      empty={empty}
    />
  );
}

function Panel({ title, icon: Icon, children, wide = false }) {
  return (
    <article className={wide ? "panel wide" : "panel"}>
      <header>
        <Icon size={18} />
        <h2>{title}</h2>
      </header>
      {children}
    </article>
  );
}

function Chart({ children }) {
  return <ResponsiveContainer width="100%" height={310}>{children}</ResponsiveContainer>;
}

function DataTable({ columns, rows, empty = "Nenhum registro no filtro.", limit = 80 }) {
  const displayed = rows.slice(0, limit);
  if (!displayed.length) {
    return <div className="empty-state">{empty}</div>;
  }

  return (
    <div className="record-list">
      {displayed.map((row, index) => (
        <article className="record-row" key={index}>
          <div className="record-primary">
            <span>{columns[0]}</span>
            <strong>{row[0]}</strong>
          </div>
          <div className="record-fields">
            {columns.slice(1).map((column, columnIndex) => (
              <div className="record-field" key={column}>
                <span>{column}</span>
                <strong>{row[columnIndex + 1]}</strong>
              </div>
            ))}
          </div>
        </article>
      ))}
      {rows.length > limit && <div className="table-note">Mostrando {limit} de {rows.length.toLocaleString("pt-BR")} registros. Use filtros ou exporte Excel para a base completa.</div>}
    </div>
  );
}

function ShellState({ icon: Icon, label }) {
  return (
    <main className="state">
      <Icon size={28} />
      <strong>{label}</strong>
    </main>
  );
}

export default App;
