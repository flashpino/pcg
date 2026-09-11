import { useEffect, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api.js';
import type { DeviceCardData } from '../components/DeviceCard.js';

interface ReadingPoint {
  time: string;
  temperature: number | null;
  humidity: number | null;
}

interface Props {
  sensor: DeviceCardData;
  onBack: () => void;
  apiBase?: string;
}

// Tela dedicada ao datalog de um único sensor — separada da lista, ao contrário do gráfico
// inline do painel admin (SensorsPage), porque o cliente clica no card pra "entrar" no sensor.
// apiBase reaproveita esta tela no portal do supervisor (/api/supervisor em vez de /api/client).
export function ClientSensorDetailPage({ sensor, onBack, apiBase = '/api/client' }: Props) {
  const [readings, setReadings] = useState<ReadingPoint[]>([]);
  const [pointsInput, setPointsInput] = useState('40');
  const [points, setPoints] = useState(40);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .get<ReadingPoint[]>(`${apiBase}/sensors/${sensor.id}/readings?range=7d`)
      .then(setReadings)
      .catch((err) => setError(err.message));
  }

  useEffect(load, [sensor.id, apiBase]);

  const chartData = readings.slice(-points);
  const tableRows = [...chartData].reverse();

  return (
    <main>
      <button className="secondary" onClick={onBack}>← voltar</button>
      <h2>{sensor.local ?? sensor.name}</h2>
      {error && <p className="error">{error}</p>}

      <div className="kpi-grid" style={{ marginTop: '1rem' }}>
        <div className="kpi-tile">
          <span className="kpi-value">
            {sensor.temperature ?? '—'}
            {sensor.temperature !== null && <small>°C</small>}
          </span>
          <span className="kpi-label">Temperatura atual</span>
        </div>
        <div className="kpi-tile">
          <span className="kpi-value">
            {sensor.humidity ?? '—'}
            {sensor.humidity !== null && <small>%</small>}
          </span>
          <span className="kpi-label">Umidade atual</span>
        </div>
      </div>

      <div className="card">
        <h3>Histórico de Leituras</h3>
        <div className="inline">
          <label>
            Pontos no gráfico{' '}
            <input
              type="number"
              min="1"
              value={pointsInput}
              onChange={(e) => setPointsInput(e.target.value)}
            />
          </label>
          <button
            onClick={() => {
              setPoints(Math.max(1, Number(pointsInput) || 40));
              load();
            }}
          >
            Atualizar Gráficos
          </button>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="time"
              tickFormatter={(t) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              minTickGap={40}
            />
            <YAxis />
            <Tooltip labelFormatter={(t) => new Date(t).toLocaleString('pt-BR')} />
            {sensor.temp_max !== null && (
              <ReferenceLine
                y={sensor.temp_max}
                stroke="#dc2626"
                strokeDasharray="4 4"
                label={{ value: `Limite: ${sensor.temp_max}°C`, position: 'right', fill: '#dc2626', fontSize: 11 }}
              />
            )}
            <Line type="monotone" dataKey="temperature" stroke="#f97316" dot={{ r: 3 }} name="Temp °C" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <div className="inline" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Registro de Leituras</h3>
          <button onClick={load}>Atualizar Tabela</button>
        </div>
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Data/Hora</th>
                <th>Temperatura (°C)</th>
                <th>Umidade (%)</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r) => (
                <tr key={r.time}>
                  <td>{new Date(r.time).toLocaleString('pt-BR')}</td>
                  <td>{r.temperature ?? '—'}</td>
                  <td>{r.humidity ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
