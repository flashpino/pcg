import { useEffect, useState } from 'react';
import { api } from './api.js';
import { AlertsPage } from './pages/AlertsPage.js';
import { ClientsPage } from './pages/ClientsPage.js';
import { ContactsPage } from './pages/ContactsPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { FirmwarePage } from './pages/FirmwarePage.js';
import { LoginPage } from './pages/LoginPage.js';
import { SensorsPage } from './pages/SensorsPage.js';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', Page: DashboardPage },
  { id: 'clients', label: 'Clientes', Page: ClientsPage },
  { id: 'sensors', label: 'Sensores', Page: SensorsPage },
  { id: 'contacts', label: 'Contatos', Page: ContactsPage },
  { id: 'alerts', label: 'Alertas', Page: AlertsPage },
  { id: 'firmware', label: 'Firmware', Page: FirmwarePage },
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
        <strong>PCG — Monitoramento</strong>
        <span>
          {email} — <button className="secondary" onClick={logout}>sair</button>
        </span>
      </header>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <Active />
    </>
  );
}
