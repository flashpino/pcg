import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsRoutes } from './settings.js';

const mocks = vi.hoisted(() => ({
  getSetting: vi.fn(async (_key: string) => null as string | null),
  setSetting: vi.fn(async (_key: string, _value: string) => undefined),
}));

vi.mock('../db/queries.js', () => ({ getSetting: mocks.getSetting, setSetting: mocks.setSetting }));

// Instância Evolution trocável pelo painel: caso de uso é o admin trocar o número/instância
// depois de um bloqueio da Meta, sem precisar mexer em env/código/redeploy.
describe('GET /api/settings/evolution-instance', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devolve a instância salva em app_settings', async () => {
    mocks.getSetting.mockResolvedValue('instancia-nova');
    const app = Fastify();
    await app.register(settingsRoutes);

    const res = await app.inject({ method: 'GET', url: '/api/settings/evolution-instance' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ instance: 'instancia-nova' });
  });

  it('sem valor salvo, devolve o default da env EVOLUTION_INSTANCE', async () => {
    mocks.getSetting.mockResolvedValue(null);
    vi.stubEnv('EVOLUTION_INSTANCE', 'instancia-env');
    const app = Fastify();
    await app.register(settingsRoutes);

    const res = await app.inject({ method: 'GET', url: '/api/settings/evolution-instance' });

    expect(res.json()).toEqual({ instance: 'instancia-env' });
    vi.unstubAllEnvs();
  });
});

describe('PUT /api/settings/evolution-instance', () => {
  beforeEach(() => vi.clearAllMocks());

  it('salva a nova instância', async () => {
    const app = Fastify();
    await app.register(settingsRoutes);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/evolution-instance',
      payload: { instance: 'instancia-nova' },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.setSetting).toHaveBeenCalledWith('evolution_instance', 'instancia-nova');
  });

  it('rejeita instância vazia', async () => {
    const app = Fastify();
    await app.register(settingsRoutes);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/evolution-instance',
      payload: { instance: '  ' },
    });

    expect(res.statusCode).toBe(400);
    expect(mocks.setSetting).not.toHaveBeenCalled();
  });
});
