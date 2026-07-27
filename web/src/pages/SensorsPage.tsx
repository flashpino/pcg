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
  force_ota: boolean;
  last_firmware: string | null;
  last_variant: string | null;
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
      `Firmware ${version ?? '(não atualizar)'} aplicado a ${siblings.length} sensor(es).`,
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

      <div className="sensor-grid">
        {sensors.map((s) => (
          <div className={`device-card${isOnline(s) ? '' : ' offline'}`} key={s.id}>
            <div className="device-card-header">
              <div style={{ flex: 1, minWidth: 0 }}>
                <input
                  className="sensor-card-title"
                  defaultValue={s.name}
                  onBlur={(e) => e.target.value !== s.name && patch(s, { name: e.target.value })}
                />
                <div className="mac-cell">{s.mac}</div>
              </div>
              <span
                className={`status-chip ${isOnline(s) ? 'online' : 'offline'}`}
                title={isOnline(s) ? 'online' : 'offline'}
              >
                <span className="dot" />
              </span>
            </div>

            <div className="sensor-card-fields">
              <div className="sensor-field">
                <span className="sensor-field-label">Local</span>
                <span className="sensor-field-value">
                  <input
                    className="field-full"
                    placeholder="ex. câmara fria 2"
                    defaultValue={s.local ?? ''}
                    onBlur={(e) => e.target.value !== (s.local ?? '') && patch(s, { local: e.target.value || null })}
                  />
                </span>
              </div>
              <div className="sensor-field">
                <span className="sensor-field-label">Cliente</span>
                <span className="sensor-field-value">
                  <select
                    className="field-full"
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
                </span>
              </div>
              <div className="sensor-field">
                <span className="sensor-field-label">Temp min/max</span>
                <span className="sensor-field-value">
                  <span className="range-inputs">
                    <input
                      type="number"
                      defaultValue={s.temp_min ?? ''}
                      onBlur={(e) => patch(s, { temp_min: numberOrNull(e.target.value) })}
                    />
                    <span>–</span>
                    <input
                      type="number"
                      defaultValue={s.temp_max ?? ''}
                      onBlur={(e) => patch(s, { temp_max: numberOrNull(e.target.value) })}
                    />
                  </span>
                </span>
              </div>
              <div className="sensor-field">
                <span className="sensor-field-label">Hum min/max</span>
                <span className="sensor-field-value">
                  <span className="range-inputs">
                    <input
                      type="number"
                      defaultValue={s.hum_min ?? ''}
                      onBlur={(e) => patch(s, { hum_min: numberOrNull(e.target.value) })}
                    />
                    <span>–</span>
                    <input
                      type="number"
                      defaultValue={s.hum_max ?? ''}
                      onBlur={(e) => patch(s, { hum_max: numberOrNull(e.target.value) })}
                    />
                  </span>
                </span>
              </div>
              <div className="sensor-field">
                <span className="sensor-field-label">Calibragem</span>
                <span className="sensor-field-value">
                  <span className="calib-cell">
                    <span className="calib-value">
                      {s.temp_offset ? `${s.temp_offset > 0 ? '+' : ''}${s.temp_offset}°C` : '—'}
                    </span>
                    <button
                      className="icon-btn"
                      title="Calibrar"
                      aria-label="Calibrar"
                      onClick={() => {
                        setCalibrating(s.id);
                        setSelected(null);
                      }}
                    >
                      <span className="material-symbols-outlined">tune</span>
                    </button>
                  </span>
                </span>
              </div>
              <div className="sensor-field">
                <span className="sensor-field-label">Teste auto</span>
                <span className="sensor-field-value">
                  <span className="sched-cell">
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
                      value={s.test_schedule_time ?? ''}
                      onChange={(e) => patch(s, { test_schedule_time: e.target.value || null })}
                    />
                  </span>
                </span>
              </div>
              <div className="sensor-field">
                <span className="sensor-field-label">Firmware</span>
                <span className="sensor-field-value">
                  <span className="firmware-current">
                    {s.last_firmware ?? '—'}
                    {s.last_variant && ` (${s.last_variant})`}
                    {s.target_firmware && s.last_firmware !== s.target_firmware && (
                      <span
                        className="material-symbols-outlined"
                        title="Ainda não recebeu a versão alvo — aguarda próximo ingest do device"
                      >
                        schedule
                      </span>
                    )}
                    {s.force_ota && (
                      <span className="material-symbols-outlined" title="Atualização forçada — dispara no próximo ingest">
                        bolt
                      </span>
                    )}
                  </span>
                </span>
              </div>
              <div className="sensor-field">
                <span className="sensor-field-label">Firmware alvo</span>
                <span className="sensor-field-value">
                  <span className="firmware-target">
                    <select
                      value={s.target_firmware ?? ''}
                      onChange={(e) => patch(s, { target_firmware: e.target.value || null })}
                    >
                      <option value="">(não atualizar)</option>
                      {firmwares.map((f) => (
                        <option key={f.version} value={f.version}>
                          {f.version}
                        </option>
                      ))}
                    </select>
                    {s.client_id !== null && (
                      <button
                        className="icon-btn"
                        title="Aplicar esta versão a todos os sensores deste cliente"
                        aria-label="Aplicar esta versão a todos os sensores deste cliente"
                        onClick={() => applyToClient(s, s.target_firmware)}
                      >
                        <span className="material-symbols-outlined">groups</span>
                      </button>
                    )}
                    <button
                      className="icon-btn"
                      title="Forçar reenvio no próximo ingest, mesmo se já estiver nesta versão (ex. reverter pra uma versão anterior)"
                      aria-label="Forçar atualização mesmo na mesma versão"
                      disabled={s.force_ota}
                      onClick={() => patch(s, { force_ota: true })}
                    >
                      <span className="material-symbols-outlined">bolt</span>
                    </button>
                  </span>
                </span>
              </div>
            </div>

            <div className="device-card-footer" style={{ justifyContent: 'flex-end' }}>
              <span className="row-actions">
                {s.client_id !== null && (
                  <button
                    className="icon-btn"
                    title="Testar dispositivo"
                    aria-label="Testar dispositivo"
                    onClick={() => runMutation(() => api.post(`/api/sensors/${s.id}/test`, {}), 'Teste enviado.')}
                  >
                    <span className="material-symbols-outlined">bolt</span>
                  </button>
                )}
                <button
                  className="icon-btn"
                  title="Gráfico"
                  aria-label="Gráfico"
                  onClick={() => {
                    setSelected(s.id);
                    setCalibrating(null);
                  }}
                >
                  <span className="material-symbols-outlined">monitoring</span>
                </button>
                <button className="icon-btn danger" title="Remover" aria-label="Remover" onClick={() => remove(s)}>
                  <span className="material-symbols-outlined">delete</span>
                </button>
              </span>
            </div>
          </div>
        ))}
      </div>

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
