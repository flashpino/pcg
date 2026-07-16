import type { FastifyInstance } from 'fastify';
import { listMessageTemplates, updateMessageTemplate } from '../db/queries.js';

export async function messageTemplatesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/message-templates', async () => listMessageTemplates());

  app.patch<{ Params: { key: string }; Body: { whatsapp: string; voice?: string | null } }>(
    '/api/message-templates/:key',
    async (req) => {
      const { whatsapp, voice } = req.body ?? {};
      if (!whatsapp) throw Object.assign(new Error('whatsapp obrigatório'), { statusCode: 400 });
      const tpl = await updateMessageTemplate(req.params.key, whatsapp, voice || null);
      if (!tpl) throw Object.assign(new Error('template não encontrado'), { statusCode: 404 });
      return tpl;
    },
  );
}
