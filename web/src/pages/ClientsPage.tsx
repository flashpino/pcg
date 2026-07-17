import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ClientContacts } from './ClientContacts.js';

interface Client {
  id: number;
  name: string;
  email: string | null;
}

function CredentialsForm({ client }: { client: Client }) {
  const [email, setEmail] = useState(client.email ?? '');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    try {
      await api.put(`/api/clients/${client.id}/credentials`, { email, password });
      setPassword('');
      setStatus('Credenciais salvas.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'falha ao salvar');
    }
  }

  return (
    <form className="inline" onSubmit={save} style={{ marginBottom: '1rem' }}>
      <input type="email" placeholder="email do portal" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input
        type="password"
        placeholder="nova senha (mín. 8 caracteres)"
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <button type="submit">Salvar credenciais do portal</button>
      {status && <small>{status}</small>}
    </form>
  );
}

export function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expandedClientId, setExpandedClientId] = useState<number | null>(null);

  function load() {
    api.get<Client[]>('/api/clients').then(setClients).catch((err) => setError(err.message));
  }

  useEffect(load, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/api/clients', { name });
      setName('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'falha ao criar');
    }
  }

  async function rename(client: Client) {
    const novo = window.prompt('Novo nome:', client.name);
    if (!novo || novo === client.name) return;
    await api.patch(`/api/clients/${client.id}`, { name: novo });
    load();
  }

  async function remove(client: Client) {
    if (!window.confirm(`Remover cliente "${client.name}"?`)) return;
    await api.del(`/api/clients/${client.id}`);
    load();
  }

  const expandedClient = clients.find((c) => c.id === expandedClientId) ?? null;

  return (
    <main>
      <h2>Gestão de Clientes</h2>
      {error && <p className="error">{error}</p>}
      <div className="card">
        <h3>Adicionar novo cliente</h3>
        <form className="inline" onSubmit={create}>
          <input placeholder="nome do cliente" value={name} onChange={(e) => setName(e.target.value)} required style={{ flex: 1, minWidth: '240px' }} />
          <button type="submit">Adicionar</button>
        </form>
      </div>

      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>
                <button className="secondary" onClick={() => setExpandedClientId(expandedClientId === c.id ? null : c.id)}>
                  {expandedClientId === c.id ? '▾' : '▸'} Contatos
                </button>{' '}
                <button className="secondary" onClick={() => rename(c)}>
                  Renomear
                </button>{' '}
                <button className="danger" onClick={() => remove(c)}>
                  Remover
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {expandedClient && (
        <div style={{ marginTop: '1.5rem' }}>
          <div className="two-col">
            <div className="card" style={{ borderLeft: '4px solid var(--primary)' }}>
              <h3>Cliente selecionado — {expandedClient.name}</h3>
              <CredentialsForm client={expandedClient} />
            </div>
            <ClientContacts clientId={expandedClient.id} />
          </div>
        </div>
      )}
    </main>
  );
}
