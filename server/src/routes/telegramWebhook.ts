import type { FastifyInstance } from 'fastify';
import { getAdminByTelegramToken, getContactByTelegramToken, linkAdminTelegramChat, linkTelegramChat } from '../db/queries.js';
import { notifyAdminsTelegramLinked } from '../services/alertService.js';
import { sendWelcomeToChannel } from './contacts.js';

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

    const chatId = req.body?.message?.chat?.id;
    if (!chatId) return reply.send();

    // Token pode ser de contato (Clientes > Contatos) ou de admin (Admins) — mesmo mecanismo de
    // link, tabelas diferentes. Contato primeiro, é o caso mais comum.
    const contact = await getContactByTelegramToken(match[1]);
    if (contact) {
      const linked = await linkTelegramChat(contact.id, String(chatId));
      // Nem o aviso ao admin nem a boas-vindas podem derrubar a resposta 200 pro Telegram — se
      // um dos dois falhar (ex. cliente sem sensor cadastrado pra pendurar o alerta sintético),
      // o vínculo em si já está gravado.
      notifyAdminsTelegramLinked(linked).catch((err) => console.error('aviso de vínculo Telegram falhou', err));
      // Confirmação pro próprio contato de que o vínculo deu certo — sem isso ele não tem
      // nenhum retorno no chat depois de dar /start.
      sendWelcomeToChannel(linked, 'telegram').catch((err) => console.error('boas-vindas por Telegram falhou', err));
      return reply.send();
    }

    const admin = await getAdminByTelegramToken(match[1]);
    if (admin) {
      await linkAdminTelegramChat(admin.id, String(chatId));
      return reply.send();
    }

    reply.send();
  });
}
