import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import Fastify from 'fastify';
import { migrate, pool, seedAdmin } from './db/index.js';
import { authRoutes } from './routes/auth.js';
import { clientsRoutes } from './routes/clients.js';
import { contactsRoutes } from './routes/contacts.js';
import { provisionRoutes } from './routes/provision.js';
import { sensorsRoutes } from './routes/sensors.js';

// Env-check fatal: servidor meio-configurado em local remoto é o pior cenário.
const REQUIRED_ENVS = [
  'DATABASE_URL',
  'INFLUX_URL', 'INFLUX_TOKEN', 'INFLUX_ORG', 'INFLUX_BUCKET',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VOICE_FROM',
  'JWT_SECRET', 'ADMIN_EMAIL', 'ADMIN_PASSWORD',
];
const missing = REQUIRED_ENVS.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`FATAL: envs obrigatórias ausentes: ${missing.join(', ')}. Copie .env.example para .env e preencha.`);
  process.exit(1);
}

// Rotas públicas: sem cookie/JWT exigido.
const PUBLIC_ROUTES = ['/health', '/api/auth/login', '/api/ingest', '/api/provision'];
const isPublic = (url: string) => PUBLIC_ROUTES.includes(url.split('?')[0]) || url.startsWith('/api/ota/');

const app = Fastify({ logger: true });

await app.register(cookie);
await app.register(jwt, { secret: process.env.JWT_SECRET!, cookie: { cookieName: 'token', signed: false } });

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
  return { db, influx };
});

await app.register(authRoutes);
await app.register(clientsRoutes);
await app.register(sensorsRoutes);
await app.register(contactsRoutes);
await app.register(provisionRoutes);

await migrate();
await seedAdmin(process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!);
app.log.info('migração ok');
await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
