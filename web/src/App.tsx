import { useEffect, useState } from 'react';
import { api } from './api.js';
import { AdminsPage } from './pages/AdminsPage.js';
import { AlertsPage } from './pages/AlertsPage.js';
import { ClientsPage } from './pages/ClientsPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { FirmwarePage } from './pages/FirmwarePage.js';
import { LoginPage } from './pages/LoginPage.js';
import { MessagesPage } from './pages/MessagesPage.js';
import { SensorsPage } from './pages/SensorsPage.js';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', Page: DashboardPage },
  { id: 'clients', label: 'Clientes', Page: ClientsPage },
  { id: 'sensors', label: 'Sensores', Page: SensorsPage },
  { id: 'alerts', label: 'Alertas', Page: AlertsPage },
  { id: 'firmware', label: 'Firmware', Page: FirmwarePage },
  { id: 'messages', label: 'Mensagens', Page: MessagesPage },
  { id: 'admins', label: 'Admins', Page: AdminsPage },
] as const;

export function App() {
  const [email, setEmail] = useState<string | null | undefined>(undefined); // undefined = carregando
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('dashboard');
  const [menuOpen, setMenuOpen] = useState(false);

  function checkSession() {
    api
      .get<{ email: string }>('/api/auth/me')
      .then((r) => setEmail(r.email))
      .catch(() => setEmail(null));
  }

  useEffect(checkSession, []);

  async function logout() {
    await api.post('/api/auth/logout');
    setEmail(null);
  }

  if (email === undefined) return null;
  if (email === null) return <LoginPage onLoggedIn={checkSession} />;

  const Active = TABS.find((t) => t.id === tab)!.Page;

  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <h1 className="brand">
            <img src="/logo.png" alt="Proatus" className="brand-logo" />
            Monitoramento
          </h1>
          <nav className="tabs">
            {TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="topbar-right">
          <span className="user-email">{email}</span>
          <button className="icon-btn" onClick={logout} title="Sair">
            <span className="material-symbols-outlined">logout</span>
          </button>
          <button className="icon-btn menu-btn" onClick={() => setMenuOpen((v) => !v)} title="Menu">
            <span className="material-symbols-outlined">menu</span>
          </button>
        </div>
      </header>
      <div className={`mobile-nav${menuOpen ? ' open' : ''}`}>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? 'active' : ''}
            onClick={() => { setTab(t.id); setMenuOpen(false); }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <Active />
      <footer className="app-footer">
        <div>
          <span>© {new Date().getFullYear()} Proatus</span>
          <span>Painel de Monitoramento</span>
        </div>
      </footer>
    </>
  );
}
