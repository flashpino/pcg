import { useEffect, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api.js';

interface Client {
  id: number;
  name: string;
}

interface Sensor {
  id: number;
  client_id: number | null;
  name: string;
  mac: string;
  temp_min: number | null;
  temp_max: number | null;
  hum_min: number | null;
  hum_max: number | null;
  interval_seconds: number;
  offline_after_seconds: number;
  target_firmware: string | null;
  last_seen_at: string | null;
}

interface ReadingPoint {
  time: string;
  temperature: number | null;
  humidity: number | null;
}

interface Firmware {
  version: string;
}

function isOnline(sensor: Sensor): boolean {
  if (!sensor.last_seen_at) return false;
  return Date.now() - new Date(sensor.last_seen_at).getTime() < sensor.offline_after_seconds * 1000;
}

export function SensorsPage() {
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [firmwares, setFirmwares] = useState<Firmware[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [readings, setReadings] = useState<ReadingPoint[]>([]);

  function load() {
    api.get<Sensor[]>('/api/sensors').then(setSensors).catch((err) => setError(err.message));
    api.get<Client[]>('/api/clients').then(setClients).catch(() => {});
    api.get<Firmware[]>('/api/firmware').then(setFirmwares).catch(() => {});
  }

  useEffect(load, []);

  useEffect(() => {
    if (selected === null) return;
    api
      .get<ReadingPoint[]>(`/api/sensors/${selected}/readings?range=24h`)
      .then(setReadings)
      .catch((err) => setError(err.message));
  }, [selected]);

  async function patch(sensor: Sensor, patch: Record<string, unknown>) {
    await api.patch(`/api/sensors/${sensor.id}`, patch);
    load();
  }

  async function remove(sensor: Sensor) {
    if (!window.confirm(`Remover sensor "${sensor.name}"?`)) return;
    await api.del(`/api/sensors/${sensor.id}`);
    load();
  }

  async function applyToClient(sensor: Sensor, version: string | null) {
    const siblings = sensors.filter((s) => s.client_id === sensor.client_id && s.client_id !== null);
    await Promise.all(siblings.map((s) => api.patch(`/api/sensors/${s.id}`, { target_firmware: version })));
    load();
  }

  function numberOrNull(v: string): number | null {
    return v === '' ? null : Number(v);
  }

  return (
    <main>
      <h2>Sensores</h2>
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Nome</th>
            <th>MAC</th>
            <th>Cliente</th>
            <th>Temp min/max</th>
            <th>Hum min/max</th>
            <th>Firmware alvo</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sensors.map((s) => (
            <tr key={s.id}>
              <td className={isOnline(s) ? 'status-online' : 'status-offline'}>
                {isOnline(s) ? '● online' : '○ offline'}
              </td>
              <td>
                <input
                  defaultValue={s.name}
                  onBlur={(e) => e.target.value !== s.name && patch(s, { name: e.target.value })}
                />
              </td>
              <td>{s.mac}</td>
              <td>
                <select
                  value={s.client_id ?? ''}
                  onChange={(e) => patch(s, { client_id: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">(não reivindicado)</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  style={{ width: '4rem' }}
                  type="number"
                  defaultValue={s.temp_min ?? ''}
                  onBlur={(e) => patch(s, { temp_min: numberOrNull(e.target.value) })}
                />
                {' / '}
                <input
                  style={{ width: '4rem' }}
                  type="number"
                  defaultValue={s.temp_max ?? ''}
                  onBlur={(e) => patch(s, { temp_max: numberOrNull(e.target.value) })}
                />
              </td>
              <td>
                <input
                  style={{ width: '4rem' }}
                  type="number"
                  defaultValue={s.hum_min ?? ''}
                  onBlur={(e) => patch(s, { hum_min: numberOrNull(e.target.value) })}
                />
                {' / '}
                <input
                  style={{ width: '4rem' }}
                  type="number"
                  defaultValue={s.hum_max ?? ''}
                  onBlur={(e) => patch(s, { hum_max: numberOrNull(e.target.value) })}
                />
              </td>
              <td>
                <select
                  value={s.target_firmware ?? ''}
                  onChange={(e) => patch(s, { target_firmware: e.target.value || null })}
                >
                  <option value="">(latest)</option>
                  {firmwares.map((f) => (
                    <option key={f.version} value={f.version}>
                      {f.version}
                    </option>
                  ))}
                </select>
                {s.client_id !== null && (
                  <button
                    className="secondary"
                    title="Aplicar esta versão a todos os sensores deste cliente"
                    onClick={() => applyToClient(s, s.target_firmware)}
                  >
                    aplicar a todos
                  </button>
                )}
              </td>
              <td>
                <button className="secondary" onClick={() => setSelected(s.id)}>
                  Gráfico
                </button>{' '}
                <button className="danger" onClick={() => remove(s)}>
                  Remover
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selected !== null && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h3>Leituras (24h) — {sensors.find((s) => s.id === selected)?.name}</h3>
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
      )}
    </main>
  );
}
