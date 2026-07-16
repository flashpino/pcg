import type { FastifyInstance } from 'fastify';
import { countAlertsSince, getLastConnectivityResolutions, listAlerts, listClients, listSensors } from '../db/queries.js';
import { countSensorStatus, resolveOnlineSince } from '../services/dashboardService.js';
import { queryLatestReadings } from '../services/influx.js';

const RECENT_EVENTS_LIMIT = 20;
const ALERTS_WINDOW_HOURS = 24 * 7;

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/dashboard', async () => {
    const now = Date.now();
    const [clients, sensors, events, alerts7d] = await Promise.all([
      listClients(),
      listSensors(),
      listAlerts(undefined, RECENT_EVENTS_LIMIT),
      countAlertsSince(ALERTS_WINDOW_HOURS),
    ]);

    const claimed = sensors.filter((s) => s.client_id !== null);
    const sensorIds = claimed.map((s) => s.id);
    const [latestReadings, onlineSince] = await Promise.all([
      queryLatestReadings(sensorIds),
      getLastConnectivityResolutions(sensorIds),
    ]);

    const clientNames = new Map(clients.map((c) => [c.id, c.name]));
    const { online, offline, activeClientIds, onlineById } = countSensorStatus(claimed, now);

    const devices = claimed.map((sensor) => {
      const reading = latestReadings.get(sensor.id);
      const sensorOnline = onlineById.get(sensor.id)!;
      return {
        id: sensor.id,
        name: sensor.name,
        mac: sensor.mac,
        client_id: sensor.client_id,
        client_name: clientNames.get(sensor.client_id!) ?? '—',
        online: sensorOnline,
        online_since: sensorOnline ? resolveOnlineSince(sensor, onlineSince.get(sensor.id)) : null,
        temperature: reading?.temperature ?? null,
        humidity: reading?.humidity ?? null,
        rssi: reading?.rssi ?? null,
        reading_time: reading?.time ?? null,
      };
    });

    return {
      kpis: { activeClients: activeClientIds.size, sensorsOnline: online, sensorsOffline: offline, alerts7d },
      devices,
      events,
    };
  });
}
