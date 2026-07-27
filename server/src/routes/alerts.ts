import type { FastifyInstance } from 'fastify';
import { countAlerts, listAlerts, resolveAlert } from '../db/queries.js';

const PAGE_SIZE = 20;

export async function alertsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { state?: string; page?: string } }>('/api/alerts', async (req) => {
    const { state } = req.query;
    if (state !== undefined && state !== 'firing' && state !== 'resolved') {
      throw Object.assign(new Error("state deve ser 'firing' ou 'resolved'"), { statusCode: 400 });
    }
    const page = Math.max(1, Number(req.query.page) || 1);
    const [alerts, total] = await Promise.all([
      listAlerts(state, PAGE_SIZE, (page - 1) * PAGE_SIZE),
      countAlerts(state),
    ]);
    return { alerts, total, page, pageSize: PAGE_SIZE };
  });

  // Resolução manual pelo admin — mesmo efeito de um resolve automático (libera o índice
  // alerts_one_firing pra um novo disparo), sem apagar o registro/histórico de notifications.
  app.post<{ Params: { id: string } }>('/api/alerts/:id/resolve', async (req) => {
    const alert = await resolveAlert(Number(req.params.id));
    if (!alert) throw Object.assign(new Error('alerta não encontrado'), { statusCode: 404 });
    return alert;
  });
}
