export interface DeviceCardData {
  id: number;
  name: string;
  local: string | null;
  mac: string;
  online: boolean;
  online_since: string | null;
  hardware_fault: boolean;
  temperature: number | null;
  humidity: number | null;
  rssi: number | null;
  reading_time: string | null;
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

interface DeviceCardProps {
  device: DeviceCardData;
  secondaryLabel?: string;
  onClick?: () => void;
}

// Card de dispositivo compartilhado entre o Dashboard admin e o Portal do Cliente — mesma
// aparência nos dois, pra não divergirem a cada mudança futura.
export function DeviceCard({ device: d, secondaryLabel, onClick }: DeviceCardProps) {
  return (
    <div
      className={`device-card${d.online ? '' : ' offline'}${d.hardware_fault ? ' fault' : ''}`}
      style={onClick ? { cursor: 'pointer' } : undefined}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
    >
      <div className="device-card-header">
        <div>
          <strong>{d.local ?? d.name}</strong>
          <div><small style={{ fontFamily: 'var(--mono)', fontSize: '0.62rem' }}>MAC: {d.mac}</small></div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {secondaryLabel && <small>{secondaryLabel}</small>}
          <div>
            <span
              className={`status-chip ${d.hardware_fault ? 'fault' : d.online ? 'online' : 'offline'}`}
              title={d.hardware_fault ? 'sensor com defeito' : d.online ? 'online' : 'offline'}
            >
              <span className="dot" />
            </span>
          </div>
        </div>
      </div>
      {/* Defeito de hardware é device comunicando sem leitura válida — não é queda de rede,
          e sem esse aviso o card fica igual ao de um sensor que só ainda não reportou. */}
      {d.hardware_fault && (
        <div className="device-fault-banner" role="status">
          Sensor com defeito — sem leitura válida. Verifique o dispositivo.
        </div>
      )}
      <div className="device-card-readings">
        <div>
          <span className="reading-label">Temperatura</span>
          {/* Unidade some junto com o valor: "—°C" sugere uma medição que não existe. */}
          <span className="reading-value">{d.temperature ?? '—'}{d.temperature !== null && <small>°C</small>}</span>
        </div>
        <div>
          <span className="reading-label">Humidade</span>
          <span className="reading-value">{d.humidity ?? '—'}{d.humidity !== null && <small>%</small>}</span>
        </div>
      </div>
      <div className="device-card-footer">
        <span>uptime {d.online ? formatUptime(d.online_since) : '—'}</span>
        {/* Sem sinal não desenha barra nenhuma — 4 barras apagadas ainda são uma leitura. */}
        {d.rssi !== null ? (
          <span className="signal-bars" title={`${d.rssi} dBm`}>
            {[0, 1, 2, 3].map((i) => (
              <i key={i} className={i < signalBars(d.rssi) ? 'bar-on' : 'bar-off'} />
            ))}
            {` ${d.rssi} dBm`}
          </span>
        ) : (
          <span className="signal-bars" title="sem leitura">—</span>
        )}
      </div>
    </div>
  );
}
