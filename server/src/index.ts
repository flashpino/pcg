import Fastify from 'fastify';
import { migrate, pool } from './db/index.js';

// Env-check fatal: servidor meio-configurado em local remoto é o pior cenário.
const REQUIRED_ENVS = [
  'DATABASE_URL',
  'INFLUX_URL', 'INFLUX_TOKEN', 'INFLUX_ORG', 'INFLUX_BUCKET',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VOICE_FROM',
  'JWT_SECRET',
];
const missing = REQUIRED_ENVS.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`FATAL: envs obrigatórias ausentes: ${missing.join(', ')}. Copie .env.example para .env e preencha.`);
  process.exit(1);
}

const app = Fastify({ logger: true });

app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
  req.log.error({ err }, 'unhandled error');
  reply.status(err.statusCode ?? 500).send({ error: err.message });
});

app.get('/health', async () => {
  const db = await pool.query('SELECT 1').then(() => 'ok', () => 'error');
  // ponytail: ping não valida token — o client Influx da Task 5 valida na primeira escrita
  const influx = await fetch(`${process.env.INFLUX_URL}/ping`)
    .then((r) => (r.status === 204 || r.ok ? 'ok' : 'error'), () => 'error');
  return { db, influx };
});

await migrate();
app.log.info('migração ok');
await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
