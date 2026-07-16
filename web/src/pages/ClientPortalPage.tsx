import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface Sensor {
  id: number;
  name: string;
  mac: string;
  last_seen_at: string | null;
  offline_after_seconds: number;
}

interface Alert {
  id: number;
  sensor_id: number;
  type: string;
  state: 'firing' | 'resolved';
  message: string;
  fired_at: string;
  resolved_at: string | null;
}

function isOnline(sensor: Sensor): boolean {
  if (!sensor.last_seen_at) return false;
  return Date.now() - new Date(sensor.last_seen_at).getTime() <= sensor.offline_after_seconds * 1000;
}

export function ClientPortalPage() {
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => {
      api.get<Sensor[]>('/api/client/sensors').then(setSensors).catch((err) => setError(err.message));
      api.get<Alert[]>('/api/client/alerts').then(setAlerts).catch((err) => setError(err.message));
    };
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <main>
      <h2>Meus sensores</h2>
      {error && <p className="error">{error}</p>}
      <div className="device-grid">
        {sensors.map((s) => (
          <div className="device-card" key={s.id}>
            <div className="device-card-header">
              <strong>{s.name}</strong>
              <span className={isOnline(s) ? 'status-online' : 'status-offline'}>
                {isOnline(s) ? '● online' : '○ offline'}
              </span>
            </div>
            <small>{s.mac}</small>
          </div>
        ))}
      </div>

      <h2>Alertas recentes</h2>
      {alerts.map((a) => (
        <div className="card" key={a.id}>
          <strong>
            [{a.type}] {a.state === 'firing' ? '🔴 firing' : '✅ resolved'}
          </strong>
          <p>{a.message}</p>
          <small>{new Date(a.fired_at).toLocaleString('pt-BR')}</small>
        </div>
      ))}
    </main>
  );
}
