import type { FastifyInstance } from 'fastify';
import { listAlerts } from '../db/queries.js';

export async function alertsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { state?: string } }>('/api/alerts', async (req) => {
    const { state } = req.query;
    if (state !== undefined && state !== 'firing' && state !== 'resolved') {
      throw Object.assign(new Error("state deve ser 'firing' ou 'resolved'"), { statusCode: 400 });
    }
    return listAlerts(state);
  });
}
