import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ClientContacts } from './ClientContacts.js';

interface Client {
  id: number;
  name: string;
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

  return (
    <main>
      <h2>Clientes</h2>
      {error && <p className="error">{error}</p>}
      <form className="inline" onSubmit={create}>
        <input placeholder="nome do cliente" value={name} onChange={(e) => setName(e.target.value)} required />
        <button type="submit">Adicionar</button>
      </form>
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

      {expandedClientId !== null && (
        <div style={{ marginTop: '1rem' }}>
          <h2>Contatos — {clients.find((c) => c.id === expandedClientId)?.name}</h2>
          <ClientContacts clientId={expandedClientId} />
        </div>
      )}
    </main>
  );
}
