import type { Sensor } from '../db/queries.js';

// Mesma condição usada em connectivitySweep.ts (fonte da verdade dos alertas de conectividade):
// offline só quando a diferença é ESTRITAMENTE maior que o limite, senão o Dashboard mostraria
// "offline" um tick antes de o alerta correspondente sequer existir.
export function isSensorOnline(sensor: Pick<Sensor, 'last_seen_at' | 'offline_after_seconds'>, now: number): boolean {
  if (!sensor.last_seen_at) return false;
  return now - new Date(sensor.last_seen_at).getTime() <= sensor.offline_after_seconds * 1000;
}

export interface SensorStatusCount {
  online: number;
  offline: number;
  activeClientIds: Set<number>;
  onlineById: Map<number, boolean>;
}

// Espera receber só sensores já reivindicados (client_id não nulo) — quem chama já precisa
// dessa lista filtrada pra outras coisas (sensorIds pro Influx), então filtra 1x só.
// "Cliente ativo" = tem ao menos 1 sensor online agora.
export function countSensorStatus(claimedSensors: Sensor[], now: number): SensorStatusCount {
  const activeClientIds = new Set<number>();
  const onlineById = new Map<number, boolean>();
  let online = 0;
  for (const sensor of claimedSensors) {
    const sensorOnline = isSensorOnline(sensor, now);
    onlineById.set(sensor.id, sensorOnline);
    if (sensorOnline) {
      online++;
      activeClientIds.add(sensor.client_id!);
    }
  }
  return { online, offline: claimedSensors.length - online, activeClientIds, onlineById };
}

// Aproximação de "online desde": último alerta de conectividade resolvido daquele sensor, ou
// created_at se nunca houve um (assume online desde a criação). Ver Open Question do PRD.
export function resolveOnlineSince(sensor: Pick<Sensor, 'created_at'>, lastResolvedAt: string | undefined): string {
  return lastResolvedAt ?? sensor.created_at;
}

export interface DisplayReading {
  temperature: number | null;
  humidity: number | null;
  rssi: number | null;
  reading_time: string | null;
}

// Sensor offline não expõe NADA de leitura. O Influx guarda a última medição antes de ele calar,
// e devolvê-la faz um dado velho passar por atual — o painel mostraria a temperatura de horas
// atrás como se fosse a de agora. Mascarar aqui, na origem, impede qualquer consumidor da API de
// vazar isso por engano, em vez de depender de cada tela lembrar de checar `online`.
//
// Defeito de hardware é o MESMO dado fantasma por outro caminho, e o mais traiçoeiro dos dois: o
// device segue mandando heartbeat, então last_seen_at fica fresco e ele conta como online — quem
// parou foi só a leitura. Sem esta condição o painel exibia o chip de defeito e, ao lado, a última
// temperatura válida, como se ainda houvesse medição. Firmware (clearDashboardReading) e SNMP
// (sentinela -9999) já deixaram de servir número nesse estado; o painel era o que faltava.
export function readingForDisplay(
  reading: { temperature: number | null; humidity: number | null; rssi: number | null; time: string } | undefined,
  online: boolean,
  hardwareFault = false,
): DisplayReading {
  if (!online || hardwareFault || !reading) return { temperature: null, humidity: null, rssi: null, reading_time: null };
  return {
    temperature: reading.temperature,
    humidity: reading.humidity,
    rssi: reading.rssi,
    reading_time: reading.time,
  };
}

export interface DeviceView extends DisplayReading {
  id: number;
  name: string;
  local: string | null;
  mac: string;
  online: boolean;
  online_since: string | null;
  hardware_fault: boolean;
}

// "Card" de dispositivo — mesma forma usada pelo Dashboard admin e pelo Portal do Cliente, pra
// os dois nunca divergirem (cada um só filtra os sensores que pode ver antes de chamar isto).
export function buildDeviceView(
  sensor: Pick<Sensor, 'id' | 'name' | 'local' | 'mac' | 'last_seen_at' | 'offline_after_seconds' | 'created_at'>,
  now: number,
  opts: {
    reading?: { temperature: number | null; humidity: number | null; rssi: number | null; time: string };
    lastResolvedAt?: string;
    hardwareFault: boolean;
  },
): DeviceView {
  const online = isSensorOnline(sensor, now);
  return {
    id: sensor.id,
    name: sensor.name,
    local: sensor.local,
    mac: sensor.mac,
    online,
    online_since: online ? resolveOnlineSince(sensor, opts.lastResolvedAt) : null,
    hardware_fault: opts.hardwareFault,
    ...readingForDisplay(opts.reading, online, opts.hardwareFault),
  };
}
