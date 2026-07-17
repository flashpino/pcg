import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface Admin {
  id: number;
  email: string;
  phone: string | null;
}

export function AdminsPage() {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.get<Admin[]>('/api/admins').then(setAdmins).catch((err) => setError(err.message));
  }

  useEffect(load, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/api/admins', { email, password, phone: phone || undefined });
      setEmail('');
      setPassword('');
      setPhone('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'falha ao criar');
    }
  }

  async function remove(admin: Admin) {
    if (!window.confirm(`Remover admin "${admin.email}"?`)) return;
    setError(null);
    try {
      await api.del(`/api/admins/${admin.id}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'falha ao remover');
    }
  }

  return (
    <main>
      <h2>Admins</h2>
      {error && <p className="error">{error}</p>}
      <form className="inline" onSubmit={create}>
        <input placeholder="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input
          placeholder="senha (mín. 8 caracteres)"
          type="password"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <input
          placeholder="telefone p/ alerta de hardware (opcional, E.164)"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <button type="submit">Adicionar</button>
      </form>
      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Telefone</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {admins.map((a) => (
            <tr key={a.id}>
              <td>{a.email}</td>
              <td>{a.phone ?? '—'}</td>
              <td>
                <button className="danger" onClick={() => remove(a)}>
                  Remover
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
