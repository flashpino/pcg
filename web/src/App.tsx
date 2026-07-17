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
            <span className="material-symbols-outlined" style={{ color: 'var(--primary)', marginRight: '0.4rem' }}>bolt</span>
            PCG — Monitoramento
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
          <button className="secondary" onClick={logout}>
            <span className="material-symbols-outlined" style={{ fontSize: '0.9rem' }}>logout</span> Sair
          </button>
        </div>
      </header>
      <Active />
    </>
  );
}
