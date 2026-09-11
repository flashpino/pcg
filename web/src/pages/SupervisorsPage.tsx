import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface Supervisor {
  id: number;
  name: string;
  email: string | null;
}

interface SensorOption {
  id: number;
  name: string;
  local: string | null;
}

function CredentialsForm({ supervisor }: { supervisor: Supervisor }) {
  const [email, setEmail] = useState(supervisor.email ?? '');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    try {
      await api.put(`/api/supervisors/${supervisor.id}/credentials`, { email, password });
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

// Quais sensores esse supervisor enxerga no portal dele — conjunto arbitrário, não precisa ser
// de um único cliente (ver server/src/routes/supervisorPortal.ts).
function SensorPicker({ supervisorId, sensors }: { supervisorId: number; sensors: SensorOption[] }) {
  const [selected, setSelected] = useState<number[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    api.get<number[]>(`/api/supervisors/${supervisorId}/sensors`).then(setSelected);
  }, [supervisorId]);

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  async function save() {
    setStatus(null);
    try {
      await api.put(`/api/supervisors/${supervisorId}/sensors`, { sensorIds: selected });
      setStatus('Sensores salvos.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'falha ao salvar');
    }
  }

  return (
    <div className="card">
      <h4>Sensores visíveis</h4>
      <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
        {sensors.map((s) => (
          <label key={s.id} style={{ display: 'block' }}>
            <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />{' '}
            {s.local ?? s.name}
          </label>
        ))}
      </div>
      <button onClick={save} style={{ marginTop: '0.5rem' }}>
        Salvar sensores
      </button>
      {status && <small style={{ marginLeft: '0.5rem' }}>{status}</small>}
    </div>
  );
}

// Acesso de supervisor: mesma tela do cliente (só leitura), mas o admin escolhe um conjunto
// arbitrário de sensores em vez de "todos os sensores de um cliente" — ver ClientsPage.tsx
// pro CRUD equivalente do lado do cliente.
export function SupervisorsPage() {
  const [supervisors, setSupervisors] = useState<Supervisor[]>([]);
  const [sensors, setSensors] = useState<SensorOption[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  function load() {
    api.get<Supervisor[]>('/api/supervisors').then(setSupervisors).catch((err) => setError(err.message));
  }

  useEffect(load, []);
  useEffect(() => {
    api.get<SensorOption[]>('/api/sensors').then(setSensors);
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/api/supervisors', { name });
      setName('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'falha ao criar');
    }
  }

  async function rename(supervisor: Supervisor) {
    const novo = window.prompt('Novo nome:', supervisor.name);
    if (!novo || novo === supervisor.name) return;
    await api.put(`/api/supervisors/${supervisor.id}`, { name: novo });
    load();
  }

  async function remove(supervisor: Supervisor) {
    if (!window.confirm(`Remover supervisor "${supervisor.name}"?`)) return;
    await api.del(`/api/supervisors/${supervisor.id}`);
    load();
  }

  const expanded = supervisors.find((s) => s.id === expandedId) ?? null;

  return (
    <main>
      <h2>Gestão de Supervisores</h2>
      <p>Acesso só-leitura, igual ao portal do cliente — mas você escolhe quais sensores cada supervisor vê.</p>
      {error && <p className="error">{error}</p>}
      <div className="card">
        <h3>Adicionar novo supervisor</h3>
        <form className="inline" onSubmit={create}>
          <input placeholder="nome do supervisor" value={name} onChange={(e) => setName(e.target.value)} required style={{ flex: 1, minWidth: '240px' }} />
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
          {supervisors.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>
                <button className="secondary" onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}>
                  {expandedId === s.id ? '▾' : '▸'} Configurar
                </button>{' '}
                <button className="secondary" onClick={() => rename(s)}>
                  Renomear
                </button>{' '}
                <button className="danger" onClick={() => remove(s)}>
                  Remover
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {expanded && (
        <div style={{ marginTop: '1.5rem' }}>
          <div className="two-col">
            <div className="card" style={{ borderLeft: '4px solid var(--primary)' }}>
              <h3>Supervisor selecionado — {expanded.name}</h3>
              <CredentialsForm supervisor={expanded} />
            </div>
            <SensorPicker supervisorId={expanded.id} sensors={sensors} />
          </div>
        </div>
      )}
    </main>
  );
}
