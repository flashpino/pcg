import type { FastifyInstance } from 'fastify';
import { listAlerts, resolveAlert } from '../db/queries.js';

export async function alertsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { state?: string } }>('/api/alerts', async (req) => {
    const { state } = req.query;
    if (state !== undefined && state !== 'firing' && state !== 'resolved') {
      throw Object.assign(new Error("state deve ser 'firing' ou 'resolved'"), { statusCode: 400 });
    }
    return listAlerts(state);
  });

  // Resolução manual pelo admin — mesmo efeito de um resolve automático (libera o índice
  // alerts_one_firing pra um novo disparo), sem apagar o registro/histórico de notifications.
  app.post<{ Params: { id: string } }>('/api/alerts/:id/resolve', async (req) => {
    const alert = await resolveAlert(Number(req.params.id));
    if (!alert) throw Object.assign(new Error('alerta não encontrado'), { statusCode: 404 });
    return alert;
  });
}
