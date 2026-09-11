import { useState } from 'react';
import { api } from '../api.js';

interface Props {
  onLoggedIn: () => void;
  loginPath?: string;
  brandLabel?: string;
  title?: string;
}

// Reaproveitado pelo portal do supervisor (mesma tela, só troca o endpoint e os textos) —
// ver SupervisorPortalApp.tsx.
export function ClientLoginPage({
  onLoggedIn,
  loginPath = '/api/client/login',
  brandLabel = 'Proatus — Portal do Cliente',
  title = 'Acesso do Cliente',
}: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post(loginPath, { email, password });
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'falha no login');
    }
  }

  return (
    <main className="login-shell">
      <div className="login-card">
        <div className="login-card-header">
          <img src="/logo.png" alt="Proatus" className="brand-logo" />
          <p>{brandLabel}</p>
        </div>
        <div className="login-card-body">
          <h2>{title}</h2>
          <p>Insira suas credenciais para continuar</p>
          {error && <p className="error">{error}</p>}
          <form onSubmit={submit}>
            <div className="login-field">
              <label>Email</label>
              <div className="input-icon">
                <span className="material-symbols-outlined">person</span>
                <input
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="login-field">
              <label>Senha</label>
              <div className="input-icon">
                <span className="material-symbols-outlined">lock</span>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>
            <button type="submit">
              <span className="material-symbols-outlined">login</span> Entrar
            </button>
          </form>
        </div>
        <div className="login-card-footer">{brandLabel}</div>
      </div>
    </main>
  );
}
