import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface Notification {
  id: number;
  contact_id: number;
  channel: string;
  status: string;
  detail: string | null;
  created_at: string;
}

interface Alert {
  id: number;
  sensor_id: number;
  type: string;
  state: 'firing' | 'resolved';
  value: number | null;
  message: string;
  fired_at: string;
  resolved_at: string | null;
  notifications: Notification[];
}

export function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [state, setState] = useState<'' | 'firing' | 'resolved'>('firing');
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .get<Alert[]>(`/api/alerts${state ? `?state=${state}` : ''}`)
      .then(setAlerts)
      .catch((err) => setError(err.message));
  }

  useEffect(load, [state]);

  async function resolve(a: Alert) {
    if (!window.confirm(`Marcar o alerta de ${a.type} (sensor #${a.sensor_id}) como resolvido?`)) return;
    await api.post(`/api/alerts/${a.id}/resolve`);
    load();
  }

  return (
    <main>
      <h2>Alertas</h2>
      {error && <p className="error">{error}</p>}
      <div className="inline">
        {(['firing', 'resolved', ''] as const).map((s) => (
          <button key={s} className={state === s ? '' : 'secondary'} onClick={() => setState(s)}>
            {s === 'firing' ? 'Ativos' : s === 'resolved' ? 'Resolvidos' : 'Todos'}
          </button>
        ))}
      </div>
      {alerts.map((a) => (
        <div className="card" key={a.id}>
          <strong>
            [{a.type}] {a.state === 'firing' ? '🔴 firing' : '✅ resolved'}
          </strong>
          <p>{a.message}</p>
          <small>
            sensor #{a.sensor_id} — disparado em {new Date(a.fired_at).toLocaleString('pt-BR')}
            {a.resolved_at && ` — resolvido em ${new Date(a.resolved_at).toLocaleString('pt-BR')}`}
          </small>
          {a.state === 'firing' && (
            <p>
              <button className="secondary" onClick={() => resolve(a)}>
                Marcar como resolvido
              </button>
            </p>
          )}
          {a.notifications.length > 0 && (
            <table style={{ marginTop: '0.5rem' }}>
              <thead>
                <tr>
                  <th>Contato</th>
                  <th>Canal</th>
                  <th>Status</th>
                  <th>Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {a.notifications.map((n) => (
                  <tr key={n.id}>
                    <td>#{n.contact_id}</td>
                    <td>{n.channel}</td>
                    <td>{n.status}</td>
                    <td>{n.detail ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </main>
  );
}
