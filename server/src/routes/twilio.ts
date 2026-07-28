import type { FastifyInstance } from 'fastify';
import { parse as parseQs } from 'node:querystring';
import twilio from 'twilio';
import { updateNotificationStatus } from '../db/queries.js';

// CallStatus final que a Twilio manda no evento 'completed' de statusCallback:
// completed | no-answer | busy | failed | canceled. CUIDADO: 'completed' NÃO quer dizer que
// alguém atendeu — celular fora de área/sem resposta cai na caixa postal da operadora, que
// atende e completa a ligação. Separar pessoa de secretária exigiria o AMD da Twilio (pago,
// ver notifier.ts); por ora o painel mostra "ligação completada", sem afirmar que atendeu.
export async function twilioRoutes(app: FastifyInstance): Promise<void> {
  // Twilio manda application/x-www-form-urlencoded; só essa rota precisa disso, então o
  // parser fica escopado aqui (encapsulamento do fastify) em vez de global no app inteiro.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, parseQs(body as string));
  });

  app.post<{ Params: { notificationId: string }; Body: Record<string, string> }>(
    '/api/twilio/voice-status/:notificationId',
    async (req, reply) => {
      // Assinatura da Twilio é a única autenticação desta rota (ver isPublic em index.ts): sem
      // ela, qualquer um marcaria uma ligação como concluída com um POST.
      const signature = req.headers['x-twilio-signature'];
      const url = `${process.env.PUBLIC_URL}/api/twilio/voice-status/${req.params.notificationId}`;
      const valid =
        typeof signature === 'string' &&
        twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN!, signature, url, req.body);
      if (!valid) return reply.status(403).send();

      await updateNotificationStatus(Number(req.params.notificationId), req.body.CallStatus);
      reply.send();
    },
  );
}
