import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface Kpis {
  activeClients: number;
  sensorsOnline: number;
  sensorsOffline: number;
  alerts7d: number;
}

interface Device {
  id: number;
  name: string;
  mac: string;
  client_name: string;
  online: boolean;
  online_since: string | null;
  temperature: number | null;
  humidity: number | null;
  rssi: number | null;
  reading_time: string | null;
}

interface DashboardData {
  kpis: Kpis;
  devices: Device[];
}

// Faixa aproximada dBm -> barras de sinal (4 = ótimo, 0 = péssimo). Sem hardware de referência
// pra calibrar precisamente — thresholds de senso comum de WiFi.
function signalBars(rssi: number | null): number {
  if (rssi === null) return 0;
  if (rssi >= -55) return 4;
  if (rssi >= -65) return 3;
  if (rssi >= -75) return 2;
  if (rssi >= -85) return 1;
  return 0;
}

function formatUptime(since: string | null): string {
  if (!since) return '—';
  const ms = Date.now() - new Date(since).getTime();
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m`;
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
      <h2>Dashboard</h2>

      <div className="kpi-grid">
        <div className="kpi-tile">
          <span className="kpi-value">{kpis.activeClients}</span>
          <span className="kpi-label">Clientes ativos</span>
        </div>
        <div className="kpi-tile">
          <span className="kpi-value">{kpis.sensorsOnline}</span>
          <span className="kpi-label">Sensores online</span>
        </div>
        <div className="kpi-tile">
          <span className="kpi-value">{kpis.sensorsOffline}</span>
          <span className="kpi-label">Sensores offline</span>
        </div>
        <div className="kpi-tile">
          <span className="kpi-value">{kpis.alerts7d}</span>
          <span className="kpi-label">Alertas (7d)</span>
        </div>
      </div>

      <div className="section-title">
        <h3>Unidades</h3>
      </div>
      <div className="device-grid">
        {devices.map((d) => (
          <div className={`device-card${d.online ? '' : ' offline'}`} key={d.id}>
            <div className="device-card-header">
              <div>
                <strong>{d.name}</strong>
                <div><small>{d.client_name} — {d.mac}</small></div>
              </div>
              <span className={`status-chip ${d.online ? 'online' : 'offline'}`}>
                <span className="dot" />
                {d.online ? 'online' : 'offline'}
              </span>
            </div>
            <div className="device-card-readings">
              <div>
                <span className="reading-label">Temperatura</span>
                <span className="reading-value">{d.temperature ?? '—'}<small>°C</small></span>
              </div>
              <div>
                <span className="reading-label">Humidade</span>
                <span className="reading-value">{d.humidity ?? '—'}<small>%</small></span>
              </div>
            </div>
            <div className="device-card-footer">
              <span className="signal-bars" title={d.rssi !== null ? `${d.rssi} dBm` : 'sem leitura'}>
                {[0, 1, 2, 3].map((i) => (
                  <i key={i} className={i < signalBars(d.rssi) ? 'bar-on' : 'bar-off'} />
                ))}
                {d.rssi !== null && ` ${d.rssi} dBm`}
              </span>
              <span>uptime {d.online ? formatUptime(d.online_since) : '—'}</span>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
