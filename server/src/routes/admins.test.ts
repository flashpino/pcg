import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminsRoutes } from './admins.js';

const mocks = vi.hoisted(() => ({
  getUserById: vi.fn(),
  setAdminTelegramLinkToken: vi.fn(async () => undefined),
}));

vi.mock('../db/queries.js', () => ({
  getUserById: mocks.getUserById,
  setAdminTelegramLinkToken: mocks.setAdminTelegramLinkToken,
}));

describe('POST /api/admins/:id/telegram-link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TELEGRAM_BOT_USERNAME', 'ProatusBot');
  });

  it('gera token, grava e devolve a URL de convite', async () => {
    mocks.getUserById.mockResolvedValue({ id: 9, email: 'admin@x' });
    const app = Fastify();
    await app.register(adminsRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/admins/9/telegram-link' });

    expect(res.statusCode).toBe(200);
    expect(mocks.setAdminTelegramLinkToken).toHaveBeenCalledWith(9, expect.any(String));
    expect(res.json().url).toMatch(/^https:\/\/t\.me\/ProatusBot\?start=.+$/);
  });

  it('admin inexistente devolve 404', async () => {
    mocks.getUserById.mockResolvedValue(undefined);
    const app = Fastify();
    await app.register(adminsRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/admins/999/telegram-link' });

    expect(res.statusCode).toBe(404);
  });

  it('sem TELEGRAM_BOT_USERNAME configurado devolve 400', async () => {
    vi.unstubAllEnvs();
    mocks.getUserById.mockResolvedValue({ id: 9, email: 'admin@x' });
    const app = Fastify();
    await app.register(adminsRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/admins/9/telegram-link' });

    expect(res.statusCode).toBe(400);
    expect(mocks.setAdminTelegramLinkToken).not.toHaveBeenCalled();
  });
});
