import { useEffect, useState } from 'react';
import { api } from './api.js';
import { ClientLoginPage } from './pages/ClientLoginPage.js';
import { ClientPortalPage } from './pages/ClientPortalPage.js';

// Igual a ClientPortalApp.tsx (mesma tela, só leitura), mas contra /api/supervisor: o acesso do
// supervisor enxerga só os sensores que o admin atribuiu (não necessariamente de um único cliente).
export function SupervisorPortalApp() {
  const [name, setName] = useState<string | null | undefined>(undefined); // undefined = carregando

  function checkSession() {
    api
      .get<{ name: string }>('/api/supervisor/me')
      .then((r) => setName(r.name))
      .catch(() => setName(null));
  }

  useEffect(checkSession, []);

  async function logout() {
    await api.post('/api/supervisor/logout');
    setName(null);
  }

  if (name === undefined) return null;
  if (name === null) {
    return (
      <ClientLoginPage
        onLoggedIn={checkSession}
        loginPath="/api/supervisor/login"
        brandLabel="Proatus — Portal do Supervisor"
        title="Acesso do Supervisor"
      />
    );
  }

  return (
    <>
      <header className="topbar">
        <span className="brand-group">
          <img src="/logo.png" alt="Proatus" className="brand-logo" />
          <strong>Portal do Supervisor</strong>
        </span>
        <span>
          {name} — <button className="secondary" onClick={logout}>sair</button>
        </span>
      </header>
      <ClientPortalPage apiBase="/api/supervisor" />
    </>
  );
}
