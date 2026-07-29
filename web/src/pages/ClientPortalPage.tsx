import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { DeviceCard, type DeviceCardData } from '../components/DeviceCard.js';
import { ClientSensorDetailPage } from './ClientSensorDetailPage.js';

interface Alert {
  id: number;
  sensor_id: number;
  type: string;
  state: 'firing' | 'resolved';
  message: string;
  fired_at: string;
  resolved_at: string | null;
}

export function ClientPortalPage() {
  const [sensors, setSensors] = useState<DeviceCardData[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openSensorId, setOpenSensorId] = useState<number | null>(null);

  useEffect(() => {
    const load = () => {
      api.get<DeviceCardData[]>('/api/client/sensors').then(setSensors).catch((err) => setError(err.message));
      api.get<Alert[]>('/api/client/alerts').then(setAlerts).catch((err) => setError(err.message));
    };
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  if (openSensorId !== null) {
    const sensor = sensors.find((s) => s.id === openSensorId);
    return (
      <ClientSensorDetailPage
        sensorId={openSensorId}
        sensorName={sensor?.local ?? sensor?.name ?? ''}
        onBack={() => setOpenSensorId(null)}
      />
    );
  }

  return (
    <main>
      <h2>Meus sensores</h2>
      {error && <p className="error">{error}</p>}
      <div className="device-grid">
        {sensors.map((s) => (
          <DeviceCard key={s.id} device={s} onClick={() => setOpenSensorId(s.id)} />
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
