import {
  ArrowLeft,
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  Clock3,
  FileCheck2,
  Landmark,
  ReceiptText,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import florybalLogo from "../Florybal/public/brand/florybal-logo-transparent.png";
import pegadaLogo from "../Pegada/public/brand/logo-pegada.png";
import biasonLogo from "./assets/biason-logo-white.png";

const environments = [
  {
    slug: "florybal",
    name: "Florybal Chocolates",
    href: "/florybal/?reauth=1",
    logo: florybalLogo,
    className: "florybal",
  },
  {
    slug: "pegada",
    name: "Calçados Pegada",
    href: "/pegada/",
    logo: pegadaLogo,
    className: "pegada",
  },
];

const workspaceModules = [
  { label: "Folha", detail: "Custo e líquido", icon: ReceiptText, position: "top-left", depth: 0.55, visual: "columns" },
  { label: "Ponto", detail: "Horas e jornadas", icon: Clock3, position: "top-right", depth: 0.65, visual: "steps" },
  { label: "Movimentações", detail: "Entradas e saídas", icon: UsersRound, position: "middle-left", depth: 0.85, visual: "split" },
  { label: "Encargos", detail: "INSS e FGTS", icon: Landmark, position: "middle-right", depth: 0.75, visual: "columns" },
  { label: "Férias", detail: "Saldo e programação", icon: CalendarDays, position: "bottom-left", depth: 0.7, visual: "steps" },
  { label: "Provisões", detail: "Férias e 13º", icon: BriefcaseBusiness, position: "bottom-right", depth: 0.9, visual: "split" },
  { label: "Auditoria", detail: "Dados conferidos", icon: FileCheck2, position: "far-left", depth: 1.05, visual: "check" },
  { label: "Indicadores", detail: "Visão por unidade", icon: BarChart3, position: "far-right", depth: 1.1, visual: "columns" },
];

function WorkspaceHome() {
  const stageRef = useRef(null);
  const pointerRef = useRef({ currentX: 0, currentY: 0, targetX: 0, targetY: 0, frame: 0 });

  useEffect(() => () => cancelAnimationFrame(pointerRef.current.frame), []);

  function animateModules() {
    const pointer = pointerRef.current;
    pointer.currentX += (pointer.targetX - pointer.currentX) * 0.085;
    pointer.currentY += (pointer.targetY - pointer.currentY) * 0.085;

    stageRef.current?.querySelectorAll("[data-depth]").forEach((item) => {
      const depth = Number(item.dataset.depth);
      item.style.setProperty("--parallax-x", `${pointer.currentX * depth}px`);
      item.style.setProperty("--parallax-y", `${pointer.currentY * depth}px`);
    });
    stageRef.current?.style.setProperty("--spot-x", `${50 + pointer.currentX * 0.75}%`);
    stageRef.current?.style.setProperty("--spot-y", `${48 + pointer.currentY * 0.75}%`);
    stageRef.current?.querySelectorAll(".environment-card").forEach((card, index) => {
      const direction = index === 0 ? 1 : -1;
      card.style.setProperty("--tilt-x", `${pointer.currentY * -0.045}deg`);
      card.style.setProperty("--tilt-y", `${pointer.currentX * 0.05 * direction}deg`);
    });

    const moving = Math.abs(pointer.targetX - pointer.currentX) + Math.abs(pointer.targetY - pointer.currentY) > 0.02;
    pointer.frame = moving ? requestAnimationFrame(animateModules) : 0;
  }

  function scheduleAnimation() {
    if (!pointerRef.current.frame) pointerRef.current.frame = requestAnimationFrame(animateModules);
  }

  function moveModules(event) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds) return;

    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    pointerRef.current.targetX = x * 28;
    pointerRef.current.targetY = y * 22;
    scheduleAnimation();
  }

  function resetModules() {
    pointerRef.current.targetX = 0;
    pointerRef.current.targetY = 0;
    scheduleAnimation();
  }

  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <div className="workspace-brand">
          <img src={biasonLogo} alt="BIASON Assessoria Empresarial" />
        </div>
        <div className="protected-label"><ShieldCheck size={17} /> Acesso seguro</div>
      </header>

      <section
        className="workspace-stage"
        ref={stageRef}
        onPointerMove={moveModules}
        onPointerLeave={resetModules}
      >
        <div className="workspace-heading">
          <span>Ambientes de BI</span>
          <h1>Escolha seu ambiente</h1>
          <p>Dados, usuários e importações permanecem separados em cada ambiente.</p>
        </div>

        <div className="workspace-orbit" aria-hidden="true">
          {workspaceModules.map(({ label, detail, icon: Icon, position, depth, visual }) => (
            <div className={`orbit-position ${position}`} data-depth={depth} key={label}>
              <div className="orbit-module" data-visual={visual}>
                <div className="orbit-module-copy">
                  <span><Icon size={16} /></span>
                  <div><strong>{label}</strong><small>{detail}</small></div>
                </div>
                <div className="module-visual">
                  <i /><i /><i /><i />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="environment-grid">
          {environments.map((environment) => (
            <a
              aria-label={`Acessar o BI ${environment.name}`}
              className={`environment-card ${environment.className}`}
              href={environment.href}
              key={environment.slug}
              title={`Acessar o BI ${environment.name}`}
            >
              <div className="environment-logo">
                <img src={environment.logo} alt={`Logotipo ${environment.name}`} />
              </div>
            </a>
          ))}
        </div>

        <div className="mobile-modules" aria-label="Recursos disponíveis nos ambientes">
          {workspaceModules.map(({ label, icon: Icon }) => (
            <span key={label}><Icon size={15} />{label}</span>
          ))}
        </div>
      </section>

      <footer className="workspace-footer">
        <span>BIASON Assessoria Empresarial</span>
        <span><ShieldCheck size={14} /> Ambientes independentes e protegidos</span>
      </footer>
    </main>
  );
}

function PegadaLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  function submit(event) {
    event.preventDefault();
    if (!email || !password) {
      setMessage("Informe e-mail e senha.");
      return;
    }
    setMessage("O ambiente Pegada está em implantação. Os acessos serão liberados após a conexão do banco de dados.");
  }

  return (
    <main className="login-page">
      <section className="login-shell">
        <form className="login-form" onSubmit={submit}>
          <a className="back-link" href="/"><ArrowLeft size={17} /> Ambientes</a>
          <img className="login-logo" src={pegadaLogo} alt="Calçados Pegada" />
          <span className="login-eyebrow">Business intelligence RH/DP</span>
          <h1>Entrar no BI Pegada</h1>
          <p>Use seu e-mail e senha para acessar os dados da empresa.</p>
          {message && <div className="login-notice" role="status">{message}</div>}
          <label>
            E-mail
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
          </label>
          <label>
            Senha
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" minLength={8} required />
          </label>
          <button type="submit">Entrar</button>
        </form>
        <aside className="login-brand">
          <img src={pegadaLogo} alt="" />
          <div>
            <span>Ambiente em implantação</span>
            <strong>BI Calçados Pegada</strong>
            <p>Folha de pagamento, ponto e indicadores das unidades em um ambiente seguro.</p>
          </div>
        </aside>
      </section>
    </main>
  );
}

export default function App() {
  const path = window.location.pathname.toLowerCase();
  return path.startsWith("/pegada") ? <PegadaLogin /> : <WorkspaceHome />;
}
