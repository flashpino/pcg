import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { telegramWebhookRoutes } from './telegramWebhook.js';

const mocks = vi.hoisted(() => ({
  getContactByTelegramToken: vi.fn(),
  linkTelegramChat: vi.fn(),
}));

vi.mock('../db/queries.js', () => ({
  getContactByTelegramToken: mocks.getContactByTelegramToken,
  linkTelegramChat: mocks.linkTelegramChat,
}));

const SECRET = 'segredo-teste';

describe('POST /api/telegram/webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', SECRET);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('secret header errado responde 403 e não toca o banco', async () => {
    const app = Fastify();
    await app.register(telegramWebhookRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'errado' },
      payload: { message: { text: '/start tok123', chat: { id: 999 } } },
    });

    expect(res.statusCode).toBe(403);
    expect(mocks.linkTelegramChat).not.toHaveBeenCalled();
  });

  it('sem TELEGRAM_WEBHOOK_SECRET configurado, rejeita mesmo sem header (nunca abre)', async () => {
    vi.unstubAllEnvs();
    const app = Fastify();
    await app.register(telegramWebhookRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/telegram/webhook', payload: {} });

    expect(res.statusCode).toBe(403);
  });

  it('token não encontrado responde 200 sem alterar nada', async () => {
    mocks.getContactByTelegramToken.mockResolvedValue(undefined);
    const app = Fastify();
    await app.register(telegramWebhookRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': SECRET },
      payload: { message: { text: '/start tok-invalido', chat: { id: 999 } } },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.linkTelegramChat).not.toHaveBeenCalled();
  });

  it('token válido vincula o chat_id do contato', async () => {
    mocks.getContactByTelegramToken.mockResolvedValue({ id: 5 });
    const app = Fastify();
    await app.register(telegramWebhookRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': SECRET },
      payload: { message: { text: '/start tok-valido', chat: { id: 999888777 } } },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.getContactByTelegramToken).toHaveBeenCalledWith('tok-valido');
    expect(mocks.linkTelegramChat).toHaveBeenCalledWith(5, '999888777');
  });

  it('mensagem sem /start é ignorada (200, sem tocar o banco)', async () => {
    const app = Fastify();
    await app.register(telegramWebhookRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': SECRET },
      payload: { message: { text: 'oi', chat: { id: 999 } } },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.getContactByTelegramToken).not.toHaveBeenCalled();
  });

  it('payload sem chat_id (valid secret + token match) responde 200 sem chamar linkTelegramChat', async () => {
    mocks.getContactByTelegramToken.mockResolvedValue({ id: 5 });
    const app = Fastify();
    await app.register(telegramWebhookRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': SECRET },
      payload: { message: { text: '/start tok-valido' } }, // sem chat key
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.linkTelegramChat).not.toHaveBeenCalled();
  });
});
