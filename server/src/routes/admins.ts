import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { countUsers, createUserRecord, deleteUser, getUserByEmail, listUsers, updateUser } from '../db/queries.js';

export async function adminsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admins', async () => listUsers());

  app.post<{ Body: { email: string; password: string; phone?: string } }>('/api/admins', async (req, reply) => {
    const { email, password, phone } = req.body ?? {};
    if (!email || !password || password.length < 8) {
      throw Object.assign(new Error('email e senha (mín. 8 caracteres) obrigatórios'), { statusCode: 400 });
    }
    if (await getUserByEmail(email)) {
      throw Object.assign(new Error('já existe um admin com este email'), { statusCode: 409 });
    }
    const hash = await bcrypt.hash(password, 10);
    reply.status(201);
    return createUserRecord(email, hash, phone || null);
  });

  app.patch<{ Params: { id: string }; Body: { email?: string; password?: string; phone?: string | null } }>(
    '/api/admins/:id',
    async (req) => {
      const { email, password, phone } = req.body ?? {};
      if (password && password.length < 8) {
        throw Object.assign(new Error('senha deve ter no mínimo 8 caracteres'), { statusCode: 400 });
      }
      const patch: { email?: string; phone?: string | null; password_hash?: string } = {};
      if (email) patch.email = email;
      if (phone !== undefined) patch.phone = phone || null;
      if (password) patch.password_hash = await bcrypt.hash(password, 10);
      const admin = await updateUser(Number(req.params.id), patch);
      if (!admin) throw Object.assign(new Error('admin não encontrado'), { statusCode: 404 });
      return admin;
    },
  );

  // Nunca deixar o sistema sem nenhum admin — não há super-admin (todo admin tem acesso
  // total), então a única trava é não zerar a tabela inteira.
  app.delete<{ Params: { id: string } }>('/api/admins/:id', async (req, reply) => {
    if ((await countUsers()) <= 1) {
      throw Object.assign(new Error('não é possível remover o último admin'), { statusCode: 400 });
    }
    const ok = await deleteUser(Number(req.params.id));
    if (!ok) throw Object.assign(new Error('admin não encontrado'), { statusCode: 404 });
    reply.status(204);
  });
}
