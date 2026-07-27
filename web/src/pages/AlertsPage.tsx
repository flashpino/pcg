import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface Notification {
  id: number;
  contact_id: number | null;
  channel: string;
  status: string;
  detail: string | null;
  created_at: string;
  contact_name: string | null;
  admin_email: string | null;
}

interface Alert {
  id: number;
  sensor_id: number;
  sensor_name: string;
  type: string;
  state: 'firing' | 'resolved';
  value: number | null;
  message: string;
  fired_at: string;
  resolved_at: string | null;
  notifications: Notification[];
}

const STATUS_LABELS: Record<string, string> = {
  queued: 'na fila',
  sent: 'enviado',
  failed: 'falhou',
  skipped_window: 'fora da janela',
  skipped_pref: 'desativado',
  // Resultado final da ligação de voz, reportado pela Twilio (server/src/routes/twilio.ts).
  completed: 'atendeu',
  'no-answer': 'não atendeu',
  busy: 'ocupado',
  canceled: 'cancelada',
};

const TYPE_LABELS: Record<string, string> = {
  temperature: 'temperatura',
  humidity: 'umidade',
  connectivity: 'conectividade',
  reboot: 'reinício',
  firmware: 'firmware',
  test: 'teste',
};

interface AlertsResponse {
  alerts: Alert[];
  total: number;
  page: number;
  pageSize: number;
}

export function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [state, setState] = useState<'' | 'firing' | 'resolved'>('firing');
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .get<AlertsResponse>(`/api/alerts?page=${page}${state ? `&state=${state}` : ''}`)
      .then((res) => {
        setAlerts(res.alerts);
        setTotal(res.total);
        setPageSize(res.pageSize);
      })
      .catch((err) => setError(err.message));
  }

  useEffect(load, [state, page]);
  useEffect(() => setPage(1), [state]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function resolve(a: Alert) {
    if (!window.confirm(`Marcar o alerta de ${TYPE_LABELS[a.type] ?? a.type} (${a.sensor_name}) como resolvido?`))
      return;
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
            [{TYPE_LABELS[a.type] ?? a.type}] {a.state === 'firing' ? '🔴 disparado' : '✅ resolvido'}
          </strong>
          <p>{a.message}</p>
          <small>
            {a.sensor_name} — disparado em {new Date(a.fired_at).toLocaleString('pt-BR')}
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
                  <th>Hora</th>
                </tr>
              </thead>
              <tbody>
                {a.notifications.map((n) => (
                  <tr key={n.id}>
                    <td>{n.contact_name ?? n.admin_email ?? `#${n.contact_id}`}</td>
                    <td>{n.channel}</td>
                    <td>{STATUS_LABELS[n.status] ?? n.status}</td>
                    <td>{n.detail ?? '-'}</td>
                    <td>{new Date(n.created_at).toLocaleString('pt-BR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
      {totalPages > 1 && (
        <div className="inline">
          <button className="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Anterior
          </button>
          <span>
            Página {page} de {totalPages}
          </span>
          <button className="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Próxima
          </button>
        </div>
      )}
    </main>
  );
}
