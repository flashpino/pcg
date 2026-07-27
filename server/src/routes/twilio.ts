import type { FastifyInstance } from 'fastify';
import { parse as parseQs } from 'node:querystring';
import twilio from 'twilio';
import { updateNotificationStatus } from '../db/queries.js';

// CallStatus final que a Twilio manda no evento 'completed' de statusCallback:
// completed (atendeu) | no-answer | busy | failed | canceled — cobre "atendeu ou não" sem
// precisar assinar múltiplos eventos (ringing/answered) e sem duplicar webhook por ligação.
export async function twilioRoutes(app: FastifyInstance): Promise<void> {
  // Twilio manda application/x-www-form-urlencoded; só essa rota precisa disso, então o
  // parser fica escopado aqui (encapsulamento do fastify) em vez de global no app inteiro.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, parseQs(body as string));
  });

  app.post<{ Params: { notificationId: string }; Body: Record<string, string> }>(
    '/api/twilio/voice-status/:notificationId',
    async (req, reply) => {
      const signature = req.headers['x-twilio-signature'];
      const url = `${process.env.PUBLIC_URL}/api/twilio/voice-status/${req.params.notificationId}`;
      const valid =
        typeof signature === 'string' &&
        twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN!, signature, url, req.body);
      if (!valid) return reply.status(403).send();

      await updateNotificationStatus(Number(req.params.notificationId), req.body.CallStatus, req.body.AnsweredBy ?? null);
      reply.send();
    },
  );
}
