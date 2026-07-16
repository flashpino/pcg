import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { migrate, pool, seedAdmin } from './db/index.js';
import { alertsRoutes } from './routes/alerts.js';
import { authRoutes } from './routes/auth.js';
import { clientsRoutes } from './routes/clients.js';
import { contactsRoutes } from './routes/contacts.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { firmwareRoutes } from './routes/firmware.js';
import { ingestRoutes } from './routes/ingest.js';
import { provisionRoutes } from './routes/provision.js';
import { sensorsRoutes } from './routes/sensors.js';
import { startConnectivitySweep } from './services/connectivitySweep.js';
import { getEvolutionConnectionState, startNotifier } from './services/notifier.js';

// Env-check fatal: servidor meio-configurado em local remoto é o pior cenário.
const REQUIRED_ENVS = [
  'DATABASE_URL',
  'INFLUX_URL', 'INFLUX_TOKEN', 'INFLUX_ORG', 'INFLUX_BUCKET',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VOICE_FROM',
  'EVOLUTION_URL', 'EVOLUTION_APIKEY', 'EVOLUTION_INSTANCE',
  'JWT_SECRET', 'ADMIN_EMAIL', 'ADMIN_PASSWORD',
];
const missing = REQUIRED_ENVS.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`FATAL: envs obrigatórias ausentes: ${missing.join(', ')}. Copie .env.example para .env e preencha.`);
  process.exit(1);
}

// Rotas /api/* públicas: sem cookie/JWT exigido. Tudo fora de /api (shell do painel,
// assets estáticos) é público por padrão — a SPA decide mostrar login via /api/auth/me.
const PUBLIC_API_ROUTES = ['/api/auth/login', '/api/ingest', '/api/provision'];
const isPublic = (url: string) => {
  const path = url.split('?')[0];
  if (!path.startsWith('/api/')) return true;
  return PUBLIC_API_ROUTES.includes(path) || path.startsWith('/api/ota/');
};

const app = Fastify({ logger: true });

await app.register(cookie);
await app.register(jwt, { secret: process.env.JWT_SECRET!, cookie: { cookieName: 'token', signed: false } });
// Firmware ESP32 fica bem abaixo de 4MB (partição app do CYD é 1.25MB — ver docs/sessions/task-13.md).
await app.register(multipart, { limits: { fileSize: 4 * 1024 * 1024 } });

app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
  req.log.error({ err }, 'unhandled error');
  reply.status(err.statusCode ?? 500).send({ error: err.message });
});

app.addHook('onRequest', async (req, reply) => {
  if (isPublic(req.raw.url ?? '')) return;
  try {
    await req.jwtVerify();
  } catch {
    reply.status(401).send({ error: 'não autenticado' });
  }
});

app.get('/health', async () => {
  const db = await pool.query('SELECT 1').then(() => 'ok', () => 'error');
  // ponytail: ping não valida token — o client Influx da Task 5 valida na primeira escrita
  const influx = await fetch(`${process.env.INFLUX_URL}/ping`)
    .then((r) => (r.status === 204 || r.ok ? 'ok' : 'error'), () => 'error');
  const evolution = await getEvolutionConnectionState();
  return { db, influx, evolution };
});

await app.register(alertsRoutes);
await app.register(authRoutes);
await app.register(clientsRoutes);
await app.register(sensorsRoutes);
await app.register(contactsRoutes);
await app.register(dashboardRoutes);
await app.register(provisionRoutes);
await app.register(ingestRoutes);
await app.register(firmwareRoutes);

// web/dist só existe depois de `npm run build` em web/ — em dev usa-se o Vite dev server
// (proxy pra :3000) em vez disto, então não travar o boot se a pasta não existir ainda.
const webDist = path.join(import.meta.dirname, '../../web/dist');
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
} else {
  app.log.warn('web/dist não encontrado — rode `npm run build` em web/ para servir o painel');
}

await migrate();
await seedAdmin(process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!);
app.log.info('migração ok');
await startNotifier();
app.log.info('notifier ok');
startConnectivitySweep(app.log);
await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
