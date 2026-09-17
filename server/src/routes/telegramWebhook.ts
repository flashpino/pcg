import type { FastifyInstance } from 'fastify';
import { getContactByTelegramToken, linkTelegramChat } from '../db/queries.js';
import { notifyAdminsTelegramLinked } from '../services/alertService.js';

interface TelegramUpdate {
  message?: {
    text?: string;
    chat: { id: number };
  };
}

// Único endpoint público do Telegram (ver isPublicRoute em authz.ts). A única autenticação é o
// secret_token que a própria Bot API devolve no header — configurado em registerTelegramWebhook
// (notifier.ts). Sem TELEGRAM_WEBHOOK_SECRET setado, rejeita tudo (nunca cai em "aberto").
export async function telegramWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: TelegramUpdate }>('/api/telegram/webhook', async (req, reply) => {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
    const secret = req.headers['x-telegram-bot-api-secret-token'];
    if (!expected || secret !== expected) return reply.status(403).send();

    // Telegram espera 200 mesmo pra updates que não são sobre nós (ex. token velho/inválido) —
    // devolver erro faria a Bot API ficar reenviando o mesmo update.
    const match = /^\/start (\S+)/.exec(req.body?.message?.text ?? '');
    if (!match) return reply.send();

    const contact = await getContactByTelegramToken(match[1]);
    if (!contact) return reply.send();

    if (!req.body?.message?.chat?.id) return reply.send();

    const linked = await linkTelegramChat(contact.id, String(req.body.message!.chat.id));
    // Aviso ao admin não pode derrubar a resposta 200 pro Telegram — se falhar (ex. cliente sem
    // sensor cadastrado pra pendurar o alerta sintético), o vínculo em si já está gravado.
    notifyAdminsTelegramLinked(linked).catch((err) => console.error('aviso de vínculo Telegram falhou', err));
    reply.send();
  });
}
