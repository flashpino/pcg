import type { FastifyInstance } from 'fastify';
import {
  countAlertsSince,
  getLastConnectivityResolutions,
  listAlerts,
  listClients,
  listSensorIdsWithFiringAlert,
  listSensors,
} from '../db/queries.js';
import { buildDeviceView, countSensorStatus } from '../services/dashboardService.js';
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
    const [latestReadings, onlineSince, hardwareFaults] = await Promise.all([
      queryLatestReadings(sensorIds),
      getLastConnectivityResolutions(sensorIds),
      listSensorIdsWithFiringAlert('hardware'),
    ]);

    const clientNames = new Map(clients.map((c) => [c.id, c.name]));
    const { online, offline, activeClientIds } = countSensorStatus(claimed, now);

    const devices = claimed.map((sensor) => ({
      ...buildDeviceView(sensor, now, {
        reading: latestReadings.get(sensor.id),
        lastResolvedAt: onlineSince.get(sensor.id),
        hardwareFault: hardwareFaults.has(sensor.id),
      }),
      client_id: sensor.client_id,
      client_name: clientNames.get(sensor.client_id!) ?? '—',
    }));

    return {
      kpis: { activeClients: activeClientIds.size, sensorsOnline: online, sensorsOffline: offline, alerts7d },
      devices,
      events,
    };
  });
}
