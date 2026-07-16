import { useEffect, useState } from 'react';
import { api } from './api.js';
import { ClientLoginPage } from './pages/ClientLoginPage.js';
import { ClientPortalPage } from './pages/ClientPortalPage.js';

export function ClientPortalApp() {
  const [name, setName] = useState<string | null | undefined>(undefined); // undefined = carregando

  function checkSession() {
    api
      .get<{ name: string }>('/api/client/me')
      .then((r) => setName(r.name))
      .catch(() => setName(null));
  }

  useEffect(checkSession, []);

  async function logout() {
    await api.post('/api/client/logout');
    setName(null);
  }

  if (name === undefined) return null;
  if (name === null) return <ClientLoginPage onLoggedIn={checkSession} />;

  return (
    <>
      <header className="topbar">
        <strong>PCG — Portal do Cliente</strong>
        <span>
          {name} — <button className="secondary" onClick={logout}>sair</button>
        </span>
      </header>
      <ClientPortalPage />
    </>
  );
}
