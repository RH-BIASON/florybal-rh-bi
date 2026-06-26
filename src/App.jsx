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
  const description = event.description.toLowerCase();
  if (["00030", "00058", "00065", "00076", "00077", "15006", "16006", "17006"].includes(event.code)) return "Reflexo HE";
  if (
    description.includes("repouso s/horas extras") ||
    description.includes("média de horas extras") ||
    description.includes("media de horas extras") ||
    description.includes("hrs extras") ||
    description.includes("h.ext") ||
    description.includes("hr.extra") ||
    description.includes("h.extras") ||
    description.includes("s/horas extras")
  ) {
    return "Reflexo HE";
  }
  return null;
}

function overtimeReflectionValue(item) {
  if (typeof item.overtime?.reflexValue === "number") return item.overtime.reflexValue;
  return sum(item.events || [], (event) => (overtimeReflectionKind(event) ? event.value : 0));
}

function variablesValue(item) {
  return sum(item.events || [], (event) => (variableKind(event) ? event.value : 0));
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
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [selectedPeriods, setSelectedPeriods] = useState(new Set());
  const [selectedBranches, setSelectedBranches] = useState(new Set());
  const [periodMode, setPeriodMode] = useState("multi");
  const [dragActive, setDragActive] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useState("overview");

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [response, historyResponse] = await Promise.all([fetch("/api/payroll"), fetch("/api/import-history")]);
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
    loadData();
  }, []);

  async function importFiles(files) {
    if (!files.length) return;
    const pdfs = files.filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length) {
      setError("Arraste ou selecione apenas arquivos PDF.");
      return;
    }
    const form = new FormData();
    pdfs.forEach((file) => form.append("pdfs", file));
    setUploading(true);
    setError("");
    try {
      const response = await fetch("/api/upload", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao importar PDFs");
      setDataset(payload);
      setSelectedPeriods(new Set(payload.periods));
      setSelectedBranches(new Set(payload.branches.map((branch) => branch.code)));
      const historyResponse = await fetch("/api/import-history");
      if (historyResponse.ok) setImportHistory(await historyResponse.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
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
            ["variables", BriefcaseBusiness, "Variáveis"],
            ["charges", Landmark, "Encargos"],
            ["benefits", Banknote, "Férias e consignados"],
            ["audit", ClipboardCheck, "Auditoria"],
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
          </div>
        </section>

        <KpiStrip analytics={analytics} />
        <DataStatus quality={dataset.quality} analytics={analytics} />

        {view === "overview" && <Overview analytics={analytics} />}
        {view === "movement" && <Movement analytics={analytics} />}
        {view === "overtime" && <Overtime analytics={analytics} />}
        {view === "attendance" && <Attendance analytics={analytics} />}
        {view === "variables" && <Variables analytics={analytics} />}
        {view === "charges" && <Charges analytics={analytics} />}
        {view === "benefits" && <Benefits analytics={analytics} />}
        {view === "audit" && <Audit dataset={dataset} analytics={analytics} importHistory={importHistory} />}
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
  const loans = rows.filter((item) => item.loans.value > 0);
  const vacations = rows.filter((item) => item.vacation.cost > 0 || item.vacation.start);
  const alerts = rows.filter((item) => item.validation.length || item.overtime.hours > 40 || (item.absence?.hours || 0) >= 8);

  const byMonthMap = new Map();
  const byBranchMap = new Map();
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
    monthRow.loans += item.loans.value || 0;
    monthRow.vacations += item.vacation.cost || 0;
    monthRow.absenceHours += item.absence?.hours || 0;
    monthRow.absenceValue += item.absence?.value || 0;
    if ((item.absence?.hours || 0) >= 24) monthRow.absenceRed += 1;
    else if ((item.absence?.hours || 0) >= 8) monthRow.absenceYellow += 1;
    monthRow.employees.add(monthEmployeeKey(item));
    if (item.admissionDate?.slice(0, 7) === month) monthRow.admissions += 1;
    if (item.resignationDate?.slice(0, 7) === month) monthRow.resignations += 1;

    if (!byBranchMap.has(branch)) {
      byBranchMap.set(branch, { branch, branchCode, gross: 0, net: 0, loans: 0, vacations: 0, admissions: 0, resignations: 0, employees: new Set(), alerts: 0 });
    }
    const branchRow = byBranchMap.get(branch);
    branchRow.gross += item.totals.gross || 0;
    branchRow.net += item.totals.net || 0;
    branchRow.loans += item.loans.value || 0;
    branchRow.vacations += item.vacation.cost || 0;
    if (item.admissionDate?.slice(0, 7) === month) branchRow.admissions += 1;
    if (item.resignationDate?.slice(0, 7) === month) branchRow.resignations += 1;
    branchRow.employees.add(personKey(item));
    branchRow.alerts += item.validation.length || (item.absence?.hours || 0) >= 8 ? 1 : 0;

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
      } else {
        monthRow.overtime100Hours += hours;
        monthRow.overtime100Value += value;
      }
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

  return { rows, records, employees, payroll, net, discounts, admissions, resignations, loans, vacations, alerts, byMonth, byBranch, charges, overtimeTop, overtimeTotals, absenceTop, absenceAlerts, variableBreakdown, variableTop };
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
      <Panel title="Todas as filiais no filtro" icon={Landmark} wide>
        <DataTable
          columns={["Filial", "Colaboradores", "Bruto", "Líquido", "Admissões", "Rescisões", "Consignados", "Férias"]}
          rows={analytics.byBranch.map((item) => [
            item.branch,
            item.employees,
            currency(item.gross),
            currency(item.net),
            item.admissions,
            item.resignations,
            currency(item.loans),
            currency(item.vacations),
          ])}
        />
      </Panel>
    </section>
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

function Variables({ analytics }) {
  const total = sum(analytics.variableBreakdown, (item) => item.value);
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
      <Panel title="Férias por competência" icon={CalendarDays}>
        <Chart>
          <BarChart data={analytics.byMonth}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" />
            <YAxis tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
            <Tooltip formatter={(value) => currency(value)} />
            <Bar dataKey="vacations" name="Custo de férias" fill="#0f766e" radius={[4, 4, 0, 0]} />
          </BarChart>
        </Chart>
      </Panel>
      <Panel title="Empréstimos consignados" icon={Banknote}>
        <DataTable columns={["Contrato", "Colaborador", "Matriz/Filial", "Mês", "Valor"]} rows={analytics.loans.slice(0, 80).map((item) => [item.contract, item.name, branchLabel(item.branch), item.period.label, currency(item.loans.value)])} />
      </Panel>
      <Panel title="Férias" icon={CalendarDays}>
        <DataTable
          columns={["Colaborador", "Matriz/Filial", "Saída", "Dias", "Custo"]}
          rows={analytics.vacations.slice(0, 80).map((item) => [item.name, branchLabel(item.branch), shortDate(item.vacation.start), item.vacation.days || "-", currency(item.vacation.cost)])}
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

function Audit({ dataset, analytics, importHistory }) {
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
      <Panel title="Conferência com os PDFs" icon={CheckCircle2} wide>
        <DataTable
          columns={["Arquivo", "Página", "Status", "Bruto PDF", "Bruto App", "Líquido PDF", "Líquido App", "Diferença"]}
          rows={reconciliationRows}
          empty="Nenhum arquivo reconciliado ainda."
          limit={120}
        />
      </Panel>
      <Panel title="Histórico de importações manuais" icon={FileUp} wide>
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
    })),
    { currencyKeys: new Set(["gross", "discounts", "net", "overtime50Value", "overtime100Value", "overtimeReflectionValue", "absenceValue", "loans", "vacations"]) },
  );

  addSheet(workbook, "Colaboradores", baseColumns(), rows.map(baseEmployeeRow), {
    currencyKeys: new Set(["gross", "discounts", "net", "salary", "overtimeValue", "overtimeReflectionValue", "absenceValue", "variablesValue", "loansValue", "vacationCost"]),
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
      vacationCost: item.vacation?.cost || 0,
    })),
    { currencyKeys: new Set(["vacationCost"]), dateKeys: new Set(["vacationStart", "vacationEnd"]) },
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
      loansValue: item.loans?.value || 0,
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
    loansValue: item.loans?.value || 0,
    vacationCost: item.vacation?.cost || 0,
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
