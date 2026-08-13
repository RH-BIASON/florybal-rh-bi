import { ArrowLeft, ArrowUpRight, Building2, LockKeyhole, ShieldCheck } from "lucide-react";
import { useState } from "react";
import florybalLogo from "../Florybal/public/brand/florybal-logo.png";
import pegadaLogo from "../Pegada/logo-pegada-2-1.webp";

const environments = [
  {
    slug: "florybal",
    name: "Florybal Chocolates",
    description: "Folha, movimentações, encargos, provisões e férias.",
    status: "Em produção",
    href: "/florybal/?reauth=1",
    logo: florybalLogo,
    className: "florybal",
  },
  {
    slug: "pegada",
    name: "Calçados Pegada",
    description: "Folha, ponto, unidades e indicadores de RH/DP.",
    status: "Em implantação",
    href: "/pegada/",
    logo: pegadaLogo,
    className: "pegada",
  },
];

function WorkspaceHome() {
  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <div className="workspace-mark" aria-hidden="true"><Building2 size={20} /></div>
        <div>
          <strong>Área de trabalho</strong>
          <span>Business intelligence RH/DP</span>
        </div>
        <div className="protected-label"><ShieldCheck size={17} /> Ambientes protegidos</div>
      </header>

      <section className="workspace-content">
        <div className="workspace-heading">
          <span>Empresas</span>
          <h1>Selecione o ambiente de trabalho</h1>
          <p>Cada empresa possui acesso, dados e importações independentes.</p>
        </div>

        <div className="environment-grid">
          {environments.map((environment) => (
            <a className={`environment-card ${environment.className}`} href={environment.href} key={environment.slug}>
              <div className="environment-card-top">
                <div className="environment-logo">
                  <img src={environment.logo} alt={`Logotipo ${environment.name}`} />
                </div>
                <span className="environment-status">{environment.status}</span>
              </div>
              <div className="environment-copy">
                <h2>{environment.name}</h2>
                <p>{environment.description}</p>
              </div>
              <div className="environment-access">
                <span><LockKeyhole size={16} /> Acesso com e-mail e senha</span>
                <ArrowUpRight size={21} aria-hidden="true" />
              </div>
            </a>
          ))}
        </div>
      </section>

      <footer className="workspace-footer">
        <ShieldCheck size={16} /> Os dados de uma empresa não são compartilhados com outro ambiente.
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
