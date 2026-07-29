import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { DeviceCard, type DeviceCardData } from '../components/DeviceCard.js';
import { ClientSensorDetailPage } from './ClientSensorDetailPage.js';

export function ClientPortalPage() {
  const [sensors, setSensors] = useState<DeviceCardData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openSensorId, setOpenSensorId] = useState<number | null>(null);

  useEffect(() => {
    const load = () => {
      api.get<DeviceCardData[]>('/api/client/sensors').then(setSensors).catch((err) => setError(err.message));
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
    </main>
  );
}
