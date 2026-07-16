import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { getUserByEmail } from '../db/queries.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { email: string; password: string } }>('/api/auth/login', async (req, reply) => {
    const { email, password } = req.body ?? {};
    const user = email && (await getUserByEmail(email));
    if (!user || !(await bcrypt.compare(password ?? '', user.password_hash))) {
      throw Object.assign(new Error('credenciais inválidas'), { statusCode: 401 });
    }
    const token = app.jwt.sign({ sub: user.id, email: user.email, role: 'admin' });
    reply.setCookie('token', token, { httpOnly: true, path: '/', sameSite: 'lax' });
    return { ok: true };
  });

  // Cookie é httpOnly — o painel não tem outro jeito de saber se está logado.
  app.get('/api/auth/me', async (req) => {
    const { email } = req.user as { email: string };
    return { email };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie('token', { path: '/' });
    return { ok: true };
  });
}
