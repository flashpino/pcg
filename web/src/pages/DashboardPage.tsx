import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { DeviceCard, type DeviceCardData } from '../components/DeviceCard.js';

interface Kpis {
  activeClients: number;
  sensorsOnline: number;
  sensorsOffline: number;
  alerts7d: number;
}

interface Device extends DeviceCardData {
  client_name: string;
}

interface DashboardData {
  kpis: Kpis;
  devices: Device[];
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => api.get<DashboardData>('/api/dashboard').then(setData).catch((err) => setError(err.message));
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  if (error) return <main><p className="error">{error}</p></main>;
  if (!data) return null;

  const { kpis, devices } = data;

  return (
    <main>
      <div className="kpi-grid">
        <div className="kpi-tile">
          <span className="kpi-label">Clientes ativos</span>
          <span className="kpi-value">{kpis.activeClients}</span>
        </div>
        <div className="kpi-tile">
          <span className="kpi-label">Sensores online</span>
          <span className="kpi-value">
            {kpis.sensorsOnline}
            <small style={{ fontSize: '0.9rem', fontWeight: 400, color: 'var(--on-surface-variant)' }}>
              /{kpis.sensorsOnline + kpis.sensorsOffline}
            </small>
          </span>
        </div>
        <div className="kpi-tile">
          <span className="kpi-label">Equipamentos offline</span>
          <span className="kpi-value" style={kpis.sensorsOffline > 0 ? { color: 'var(--status-yellow)' } : undefined}>
            {kpis.sensorsOffline}
          </span>
        </div>
        <div className="kpi-tile">
          <span className="kpi-label">Alertas (7d)</span>
          <span className="kpi-value" style={kpis.alerts7d > 0 ? { color: 'var(--status-red)' } : undefined}>
            {kpis.alerts7d}
          </span>
        </div>
      </div>

      <div className="section-title">
        <h3><span className="material-symbols-outlined">sensors</span> Monitoramento de Dispositivos</h3>
      </div>
      <div className="device-grid">
        {devices.map((d) => (
          <DeviceCard key={d.id} device={d} secondaryLabel={`${d.client_name} — ${d.name}`} />
        ))}
      </div>
    </main>
  );
}
