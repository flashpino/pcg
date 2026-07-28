import type { FastifyInstance } from 'fastify';
import { parse as parseQs } from 'node:querystring';
import twilio from 'twilio';
import { updateNotificationDetail, updateNotificationStatus } from '../db/queries.js';

// CallStatus final que a Twilio manda no evento 'completed' de statusCallback:
// completed | no-answer | busy | failed | canceled. CUIDADO: 'completed' NÃO quer dizer que
// alguém atendeu — celular fora de área/sem resposta cai na caixa postal da operadora, que
// atende e completa a ligação. Quem separa pessoa de secretária é o AMD (answeredByLabel).
export function answeredByLabel(answeredBy: string | undefined): string | null {
  if (!answeredBy) return null;
  // machine_start (MachineDetection=Enable) e machine_end_* (DetectMessageEnd) = secretária.
  if (answeredBy.startsWith('machine')) return 'caixa postal/secretária';
  if (answeredBy === 'human') return 'atendida por pessoa';
  if (answeredBy === 'fax') return 'fax';
  return 'não identificado';
}

export async function twilioRoutes(app: FastifyInstance): Promise<void> {
  // Twilio manda application/x-www-form-urlencoded; só essa rota precisa disso, então o
  // parser fica escopado aqui (encapsulamento do fastify) em vez de global no app inteiro.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, parseQs(body as string));
  });

  // Assinatura da Twilio é a única autenticação destas rotas (ver isPublic em index.ts): sem
  // ela, qualquer um marcaria uma ligação como atendida com um POST.
  const signatureValid = (req: { headers: Record<string, unknown>; body: unknown }, path: string) => {
    const signature = req.headers['x-twilio-signature'];
    return (
      typeof signature === 'string' &&
      twilio.validateRequest(
        process.env.TWILIO_AUTH_TOKEN!,
        signature,
        `${process.env.PUBLIC_URL}${path}`,
        req.body as Record<string, string>,
      )
    );
  };

  app.post<{ Params: { notificationId: string }; Body: Record<string, string> }>(
    '/api/twilio/voice-status/:notificationId',
    async (req, reply) => {
      if (!signatureValid(req, `/api/twilio/voice-status/${req.params.notificationId}`)) {
        return reply.status(403).send();
      }
      // detail fica de fora: quem escreve nele é o callback do AMD, que chega em outro momento
      // (assíncrono) e não tem ordem garantida em relação a este.
      await updateNotificationStatus(Number(req.params.notificationId), req.body.CallStatus);
      reply.send();
    },
  );

  // Resultado do AMD (asyncAmd em notifier.ts) — é o que diz se quem atendeu foi gente ou a
  // caixa postal. Chega separado do status final da ligação, por isso a rota própria.
  app.post<{ Params: { notificationId: string }; Body: Record<string, string> }>(
    '/api/twilio/amd-status/:notificationId',
    async (req, reply) => {
      if (!signatureValid(req, `/api/twilio/amd-status/${req.params.notificationId}`)) {
        return reply.status(403).send();
      }
      const label = answeredByLabel(req.body.AnsweredBy);
      if (label) await updateNotificationDetail(Number(req.params.notificationId), label);
      reply.send();
    },
  );
}
