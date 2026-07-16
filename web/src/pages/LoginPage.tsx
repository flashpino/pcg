import { useState } from 'react';
import { api } from '../api.js';

export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/api/auth/login', { email, password });
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'falha no login');
    }
  }

  return (
    <main>
      <form className="login-box" onSubmit={submit}>
        <h2>PCG — Login</h2>
        {error && <p className="error">{error}</p>}
        <input type="email" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input
          type="password"
          placeholder="senha"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button type="submit">Entrar</button>
      </form>
    </main>
  );
}
