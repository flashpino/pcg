import { InfluxDB, Point } from '@influxdata/influxdb-client';

const client = new InfluxDB({ url: process.env.INFLUX_URL!, token: process.env.INFLUX_TOKEN! });
const writeApi = client.getWriteApi(process.env.INFLUX_ORG!, process.env.INFLUX_BUCKET!, 'ms');
const queryApi = client.getQueryApi(process.env.INFLUX_ORG!);

export interface Reading {
  temp: number;
  hum: number;
  rssi: number;
  ago_ms: number;
}

// Cardinalidade: só client_id e sensor_id como tags (baixa cardinalidade).
export function writeReadings(clientId: number | null, sensorId: number, readings: Reading[]): void {
  const now = Date.now();
  for (const r of readings) {
    const point = new Point('readings')
      .tag('sensor_id', String(sensorId))
      .floatField('temperature', r.temp)
      .floatField('humidity', r.hum)
      .floatField('rssi', r.rssi)
      .timestamp(new Date(now - r.ago_ms));
    if (clientId !== null) point.tag('client_id', String(clientId));
    writeApi.writePoint(point);
  }
}

export const flushInflux = () => writeApi.flush();

export interface ReadingPoint {
  time: string;
  temperature: number | null;
  humidity: number | null;
}

// Range vira texto interpolado direto na query Flux — whitelist estrita evita Flux injection
// via querystring (ex. ?range=1h) fechar(query) e injetar outra instrução.
const RANGE_RE = /^\d{1,4}[smhd]$/;

export function queryReadings(sensorId: number, range: string): Promise<ReadingPoint[]> {
  if (!RANGE_RE.test(range)) {
    throw Object.assign(new Error("range inválido — use algo como '24h', '7d', '30m'"), { statusCode: 400 });
  }
  const flux = `
    from(bucket: "${process.env.INFLUX_BUCKET}")
      |> range(start: -${range})
      |> filter(fn: (r) => r._measurement == "readings" and r.sensor_id == "${sensorId}")
      |> filter(fn: (r) => r._field == "temperature" or r._field == "humidity")
      |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"])
  `;
  return queryApi.collectRows<ReadingPoint>(flux, (values, tableMeta) => {
    const row = tableMeta.toObject(values) as Record<string, unknown>;
    return {
      time: row._time as string,
      temperature: (row.temperature as number) ?? null,
      humidity: (row.humidity as number) ?? null,
    };
  });
}
