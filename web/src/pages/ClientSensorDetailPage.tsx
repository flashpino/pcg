import { useEffect, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api.js';

interface ReadingPoint {
  time: string;
  temperature: number | null;
  humidity: number | null;
}

interface Props {
  sensorId: number;
  sensorName: string;
  onBack: () => void;
}

// Tela dedicada ao datalog de um único sensor — separada da lista, ao contrário do gráfico
// inline do painel admin (SensorsPage), porque o cliente clica no card pra "entrar" no sensor.
export function ClientSensorDetailPage({ sensorId, sensorName, onBack }: Props) {
  const [readings, setReadings] = useState<ReadingPoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ReadingPoint[]>(`/api/client/sensors/${sensorId}/readings?range=24h`)
      .then(setReadings)
      .catch((err) => setError(err.message));
  }, [sensorId]);

  return (
    <main>
      <button className="secondary" onClick={onBack}>← voltar</button>
      <h2>{sensorName} — Leituras (24h)</h2>
      {error && <p className="error">{error}</p>}
      <div className="card" style={{ marginTop: '1rem' }}>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={readings}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" tick={false} />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="temperature" stroke="#f97316" dot={false} name="Temp °C" />
            <Line type="monotone" dataKey="humidity" stroke="#3b82f6" dot={false} name="Umidade %" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </main>
  );
}
