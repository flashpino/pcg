import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { telegramWebhookRoutes } from './telegramWebhook.js';

const mocks = vi.hoisted(() => ({
  getContactByTelegramToken: vi.fn(),
  linkTelegramChat: vi.fn(),
  getAdminByTelegramToken: vi.fn(),
  linkAdminTelegramChat: vi.fn(),
  notifyAdminsTelegramLinked: vi.fn(async () => undefined),
  sendWelcomeToChannel: vi.fn(async () => undefined),
}));

vi.mock('../db/queries.js', () => ({
  getContactByTelegramToken: mocks.getContactByTelegramToken,
  linkTelegramChat: mocks.linkTelegramChat,
  getAdminByTelegramToken: mocks.getAdminByTelegramToken,
  linkAdminTelegramChat: mocks.linkAdminTelegramChat,
}));
vi.mock('../services/alertService.js', () => ({ notifyAdminsTelegramLinked: mocks.notifyAdminsTelegramLinked }));
vi.mock('./contacts.js', () => ({ sendWelcomeToChannel: mocks.sendWelcomeToChannel }));

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

  it('token válido vincula o chat_id do contato, avisa os admins e manda boas-vindas por Telegram', async () => {
    mocks.getContactByTelegramToken.mockResolvedValue({ id: 5 });
    mocks.linkTelegramChat.mockResolvedValue({ id: 5, name: 'Fulano' });
    const app = Fastify();
    await app.register(telegramWebhookRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': SECRET },
      payload: { message: { text: '/start tok-valido', chat: { id: 999888777 } } },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.sendWelcomeToChannel).toHaveBeenCalledWith({ id: 5, name: 'Fulano' }, 'telegram');
    expect(mocks.getContactByTelegramToken).toHaveBeenCalledWith('tok-valido');
    expect(mocks.linkTelegramChat).toHaveBeenCalledWith(5, '999888777');
    expect(mocks.notifyAdminsTelegramLinked).toHaveBeenCalledWith({ id: 5, name: 'Fulano' });
  });

  it('aviso ao admin falhando não derruba a resposta 200 (vínculo já está gravado)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getContactByTelegramToken.mockResolvedValue({ id: 5 });
    mocks.linkTelegramChat.mockResolvedValue({ id: 5, name: 'Fulano' });
    mocks.notifyAdminsTelegramLinked.mockRejectedValueOnce(new Error('cliente sem sensor'));
    const app = Fastify();
    await app.register(telegramWebhookRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': SECRET },
      payload: { message: { text: '/start tok-valido', chat: { id: 999888777 } } },
    });

    expect(res.statusCode).toBe(200);
    errorSpy.mockRestore();
  });

  it('boas-vindas por Telegram falhando não derruba a resposta 200 (vínculo já está gravado)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getContactByTelegramToken.mockResolvedValue({ id: 5 });
    mocks.linkTelegramChat.mockResolvedValue({ id: 5, name: 'Fulano' });
    mocks.sendWelcomeToChannel.mockRejectedValueOnce(new Error('cliente sem sensor'));
    const app = Fastify();
    await app.register(telegramWebhookRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': SECRET },
      payload: { message: { text: '/start tok-valido', chat: { id: 999888777 } } },
    });

    expect(res.statusCode).toBe(200);
    errorSpy.mockRestore();
  });

  it('token de admin (não é contato) vincula o chat_id do admin', async () => {
    mocks.getContactByTelegramToken.mockResolvedValue(undefined);
    mocks.getAdminByTelegramToken.mockResolvedValue({ id: 9, email: 'admin@x' });
    const app = Fastify();
    await app.register(telegramWebhookRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': SECRET },
      payload: { message: { text: '/start tok-admin', chat: { id: 111222333 } } },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.getAdminByTelegramToken).toHaveBeenCalledWith('tok-admin');
    expect(mocks.linkAdminTelegramChat).toHaveBeenCalledWith(9, '111222333');
    expect(mocks.linkTelegramChat).not.toHaveBeenCalled();
    expect(mocks.notifyAdminsTelegramLinked).not.toHaveBeenCalled();
  });

  it('token não bate com contato nem admin responde 200 sem vincular nada', async () => {
    mocks.getContactByTelegramToken.mockResolvedValue(undefined);
    mocks.getAdminByTelegramToken.mockResolvedValue(undefined);
    const app = Fastify();
    await app.register(telegramWebhookRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': SECRET },
      payload: { message: { text: '/start tok-nenhum', chat: { id: 999 } } },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.linkTelegramChat).not.toHaveBeenCalled();
    expect(mocks.linkAdminTelegramChat).not.toHaveBeenCalled();
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
