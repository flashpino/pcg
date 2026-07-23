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
  local: string | null;
  temp_min: number | null;
  temp_max: number | null;
  temp_offset: number;
  hum_min: number | null;
  hum_max: number | null;
  interval_seconds: number;
  offline_after_seconds: number;
  target_firmware: string | null;
  last_firmware: string | null;
  last_seen_at: string | null;
  test_schedule_dow: string | null;
  test_schedule_time: string | null;
}

interface ReadingPoint {
  time: string;
  temperature: number | null;
  humidity: number | null;
}

interface Firmware {
  version: string;
}

interface LatestReading {
  temperature: number | null;
  humidity: number | null;
  time: string | null;
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
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [readings, setReadings] = useState<ReadingPoint[]>([]);
  const [calibrating, setCalibrating] = useState<number | null>(null);
  const [calibLatest, setCalibLatest] = useState<LatestReading | null>(null);
  const [calibReference, setCalibReference] = useState('');
  const [schedDow, setSchedDow] = useState('1');
  const [schedTime, setSchedTime] = useState('09:00');

  function load() {
    api.get<Sensor[]>('/api/sensors').then(setSensors).catch((err) => setError(err.message));
    api.get<Client[]>('/api/clients').then(setClients).catch(() => {});
    api.get<Firmware[]>('/api/firmware').then(setFirmwares).catch(() => {});
    api
      .get<{ dow: string; time: string }>('/api/settings/test-schedule')
      .then((s) => {
        setSchedDow(s.dow);
        setSchedTime(s.time);
      })
      .catch(() => {});
  }

  useEffect(load, []);

  useEffect(() => {
    if (selected === null) return;
    api
      .get<ReadingPoint[]>(`/api/sensors/${selected}/readings?range=24h`)
      .then(setReadings)
      .catch((err) => setError(err.message));
  }, [selected]);

  useEffect(() => {
    if (calibrating === null) return;
    setCalibLatest(null);
    setCalibReference('');
    api
      .get<LatestReading>(`/api/sensors/${calibrating}/latest`)
      .then(setCalibLatest)
      .catch((err) => setError(err.message));
  }, [calibrating]);

  // Toda mutação passa por aqui — sem isso, uma falha na requisição (auth expirada,
  // rede) ficava muda: nada na tela indicava se o clique funcionou ou não.
  async function runMutation(action: () => Promise<unknown>, successMessage: string) {
    setError(null);
    setMessage(null);
    try {
      await action();
      load();
      setMessage(successMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'falha ao salvar');
    }
  }

  function patch(sensor: Sensor, patch: Record<string, unknown>) {
    return runMutation(() => api.patch(`/api/sensors/${sensor.id}`, patch), 'Salvo.');
  }

  function remove(sensor: Sensor) {
    if (!window.confirm(`Remover sensor "${sensor.name}"?`)) return;
    return runMutation(() => api.del(`/api/sensors/${sensor.id}`), 'Sensor removido.');
  }

  function applyToClient(sensor: Sensor, version: string | null) {
    const siblings = sensors.filter((s) => s.client_id === sensor.client_id && s.client_id !== null);
    return runMutation(
      () => Promise.all(siblings.map((s) => api.patch(`/api/sensors/${s.id}`, { target_firmware: version }))),
      `Firmware ${version ?? '(latest)'} aplicado a ${siblings.length} sensor(es).`,
    );
  }

  async function applyCalibration(sensor: Sensor) {
    setError(null);
    setMessage(null);
    try {
      const updated = await api.post<Sensor>(`/api/sensors/${sensor.id}/calibrate`, {
        reference: Number(calibReference),
      });
      setMessage(`Offset ajustado para ${updated.temp_offset}°C.`);
      setCalibrating(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'falha ao calibrar');
    }
  }

  function numberOrNull(v: string): number | null {
    return v === '' ? null : Number(v);
  }

  const onlineCount = sensors.filter(isOnline).length;
  const temps = sensors.map((s) => s.temp_max).filter((v): v is number => v !== null);
  const avgTempMax = temps.length ? (temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1) : '—';

  return (
    <main>
      <h2>Sensores em Campo</h2>
      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="inline">
          <strong>Teste automático — padrão global (sensores sem agendamento próprio):</strong>
          <label>
            dia{' '}
            <select value={schedDow} onChange={(e) => setSchedDow(e.target.value)}>
              <option value="0">domingo</option>
              <option value="1">segunda</option>
              <option value="2">terça</option>
              <option value="3">quarta</option>
              <option value="4">quinta</option>
              <option value="5">sexta</option>
              <option value="6">sábado</option>
            </select>
          </label>
          <label>
            hora <input type="time" value={schedTime} onChange={(e) => setSchedTime(e.target.value)} />
          </label>
          <button
            onClick={() =>
              runMutation(
                () => api.put('/api/settings/test-schedule', { dow: schedDow, time: schedTime }),
                'Agendamento salvo.',
              )
            }
          >
            Salvar
          </button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-tile">
          <span className="kpi-value">{sensors.length}</span>
          <span className="kpi-label">Total cadastrados</span>
        </div>
        <div className="kpi-tile">
          <span className="kpi-value">{onlineCount}</span>
          <span className="kpi-label">Online</span>
        </div>
        <div className="kpi-tile">
          <span className="kpi-value">{sensors.length - onlineCount}</span>
          <span className="kpi-label">Offline</span>
        </div>
        <div className="kpi-tile">
          <span className="kpi-value">{avgTempMax}<small style={{ fontSize: '1.1rem' }}>°C</small></span>
          <span className="kpi-label">Limite médio de temp.</span>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Nome</th>
            <th>Local</th>
            <th>MAC</th>
            <th>Cliente</th>
            <th>Temp min/max</th>
            <th>Hum min/max</th>
            <th>Calibragem</th>
            <th>Teste automático</th>
            <th>Firmware atual</th>
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
              <td>
                <input
                  placeholder="ex. câmara fria 2"
                  defaultValue={s.local ?? ''}
                  onBlur={(e) => e.target.value !== (s.local ?? '') && patch(s, { local: e.target.value || null })}
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
                {s.temp_offset ? `${s.temp_offset > 0 ? '+' : ''}${s.temp_offset}°C` : '—'}{' '}
                <button
                  className="secondary"
                  onClick={() => {
                    setCalibrating(s.id);
                    setSelected(null);
                  }}
                >
                  Calibrar
                </button>
              </td>
              <td>
                <select
                  value={s.test_schedule_dow ?? ''}
                  onChange={(e) => patch(s, { test_schedule_dow: e.target.value || null })}
                >
                  <option value="">(padrão)</option>
                  <option value="0">domingo</option>
                  <option value="1">segunda</option>
                  <option value="2">terça</option>
                  <option value="3">quarta</option>
                  <option value="4">quinta</option>
                  <option value="5">sexta</option>
                  <option value="6">sábado</option>
                </select>
                <input
                  type="time"
                  style={{ width: '6rem' }}
                  value={s.test_schedule_time ?? ''}
                  onChange={(e) => patch(s, { test_schedule_time: e.target.value || null })}
                />
              </td>
              <td>
                {s.last_firmware ?? '—'}
                {s.target_firmware && s.last_firmware !== s.target_firmware && (
                  <span title="Ainda não recebeu a versão alvo — aguarda próximo ingest do device">
                    {' '}
                    ⏳
                  </span>
                )}
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
                {s.client_id !== null && (
                  <>
                    <button
                      className="secondary"
                      onClick={() => runMutation(() => api.post(`/api/sensors/${s.id}/test`, {}), 'Teste enviado.')}
                    >
                      Testar dispositivo
                    </button>{' '}
                  </>
                )}
                <button
                  className="secondary"
                  onClick={() => {
                    setSelected(s.id);
                    setCalibrating(null);
                  }}
                >
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

      {calibrating !== null && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h3>Calibrar — {sensors.find((s) => s.id === calibrating)?.name}</h3>
          {calibLatest === null ? (
            <p>Carregando leitura atual…</p>
          ) : calibLatest.temperature === null ? (
            <p className="error">Sensor sem leitura recente — aguarde o próximo envio.</p>
          ) : (
            <>
              <p>
                Leitura atual: {calibLatest.temperature}°C
                {calibLatest.time && ` (${new Date(calibLatest.time).toLocaleString('pt-BR')})`}
              </p>
              <label>
                Temperatura real (termômetro de referência):{' '}
                <input
                  type="number"
                  step="0.1"
                  value={calibReference}
                  onChange={(e) => setCalibReference(e.target.value)}
                />
              </label>{' '}
              <button
                disabled={calibReference === '' || Number.isNaN(Number(calibReference))}
                onClick={() => applyCalibration(sensors.find((s) => s.id === calibrating)!)}
              >
                Aplicar
              </button>{' '}
            </>
          )}
          <button className="secondary" onClick={() => setCalibrating(null)}>
            Cancelar
          </button>
        </div>
      )}
    </main>
  );
}
