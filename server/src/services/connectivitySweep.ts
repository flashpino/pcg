import type { FastifyBaseLogger } from 'fastify';
import { listSensors } from '../db/queries.js';
import { evaluateConnectivity } from './alertService.js';

const CHECK_INTERVAL_MS = 60_000;

async function sweepOnce(): Promise<void> {
  const now = Date.now();
  for (const sensor of await listSensors()) {
    if (sensor.client_id === null || sensor.last_seen_at === null) continue; // não reivindicado ou nunca reportou
    const offline = now - new Date(sensor.last_seen_at).getTime() > sensor.offline_after_seconds * 1000;
    await evaluateConnectivity(sensor, offline);
  }
}

// Uma exceção não pode matar o interval — sensor remoto instável é rotina, não motivo pra
// derrubar a varredura dos outros 49. Roda uma vez já no boot, depois a cada 60s.
export function startConnectivitySweep(log: FastifyBaseLogger): NodeJS.Timeout {
  const run = () => {
    sweepOnce().catch((err) => log.error({ err }, 'connectivitySweep falhou'));
  };
  run();
  return setInterval(run, CHECK_INTERVAL_MS);
}
