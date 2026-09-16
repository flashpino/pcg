import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { contactsRoutes } from './contacts.js';

const mocks = vi.hoisted(() => ({
  getContact: vi.fn(),
  setTelegramLinkToken: vi.fn(async () => undefined),
  createNotification: vi.fn(async () => ({ id: 1 })),
  createResolvedAlert: vi.fn(async () => ({ id: 42 })),
  listSensors: vi.fn(async () => [{ id: 7, name: 'Sensor A', local: 'Sala 1' }]),
  getMessageTemplate: vi.fn(async () => ({ whatsapp: 'Olá {{$nome}}!', voice: null })),
  getClient: vi.fn(async () => ({ name: 'Cliente X' })),
  enqueueWhatsapp: vi.fn(),
  enqueueTelegram: vi.fn(),
}));

vi.mock('../db/queries.js', () => ({
  getContact: mocks.getContact,
  setTelegramLinkToken: mocks.setTelegramLinkToken,
  createNotification: mocks.createNotification,
  createResolvedAlert: mocks.createResolvedAlert,
  listSensors: mocks.listSensors,
  getMessageTemplate: mocks.getMessageTemplate,
  getClient: mocks.getClient,
}));
vi.mock('../services/influx.js', () => ({ queryLatestReadings: vi.fn(async () => new Map()) }));
vi.mock('../services/notifier.js', () => ({ enqueueWhatsapp: mocks.enqueueWhatsapp, enqueueTelegram: mocks.enqueueTelegram }));

const contatoBase = {
  id: 5,
  client_id: 1,
  name: 'Fulano',
  phone: '+5511999999999',
  channel_voice: true,
  channel_whatsapp: true,
  channel_telegram: false,
  telegram_chat_id: null,
  telegram_link_token: null,
  timezone: 'America/Sao_Paulo',
  active: true,
  created_at: '2026-01-01',
};

describe('POST /api/contacts/:id/telegram-link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TELEGRAM_BOT_USERNAME', 'ProatusBot');
  });

  it('gera token, grava e devolve a URL de convite', async () => {
    mocks.getContact.mockResolvedValue(contatoBase);
    const app = Fastify();
    await app.register(contactsRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/contacts/5/telegram-link' });

    expect(res.statusCode).toBe(200);
    expect(mocks.setTelegramLinkToken).toHaveBeenCalledWith(5, expect.any(String));
    expect(res.json().url).toMatch(/^https:\/\/t\.me\/ProatusBot\?start=.+$/);
  });

  it('contato inexistente devolve 404', async () => {
    mocks.getContact.mockResolvedValue(undefined);
    const app = Fastify();
    await app.register(contactsRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/contacts/999/telegram-link' });

    expect(res.statusCode).toBe(404);
  });

  it('sem TELEGRAM_BOT_USERNAME configurado devolve 400', async () => {
    vi.unstubAllEnvs();
    mocks.getContact.mockResolvedValue(contatoBase);
    const app = Fastify();
    await app.register(contactsRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/contacts/5/telegram-link' });

    expect(res.statusCode).toBe(400);
    expect(mocks.setTelegramLinkToken).not.toHaveBeenCalled();
  });
});

describe('POST /api/contacts/:id/welcome', () => {
  beforeEach(() => vi.clearAllMocks());

  it('contato sem telegram vinculado manda só WhatsApp', async () => {
    mocks.getContact.mockResolvedValue(contatoBase);
    const app = Fastify();
    await app.register(contactsRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/contacts/5/welcome' });

    expect(res.statusCode).toBe(200);
    expect(mocks.enqueueWhatsapp).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueTelegram).not.toHaveBeenCalled();
  });

  it('contato com telegram ligado e vinculado manda WhatsApp e Telegram', async () => {
    mocks.getContact.mockResolvedValue({ ...contatoBase, channel_telegram: true, telegram_chat_id: '999888777' });
    const app = Fastify();
    await app.register(contactsRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/contacts/5/welcome' });

    expect(res.statusCode).toBe(200);
    expect(mocks.enqueueWhatsapp).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueTelegram).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueTelegram).toHaveBeenCalledWith(expect.objectContaining({ phone: '999888777' }));
  });

  it('canal ligado mas sem chat_id ainda (link pendente) não manda Telegram', async () => {
    mocks.getContact.mockResolvedValue({ ...contatoBase, channel_telegram: true, telegram_chat_id: null });
    const app = Fastify();
    await app.register(contactsRoutes);

    await app.inject({ method: 'POST', url: '/api/contacts/5/welcome' });

    expect(mocks.enqueueTelegram).not.toHaveBeenCalled();
  });
});
