import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSetting: vi.fn(async (_key: string) => null as string | null),
}));

// getEvolutionConnectionState agora consulta app_settings (instância trocável pelo painel sem
// redeploy) antes de cair pra env — precisa mockar pra não bater no banco real neste teste.
vi.mock('../db/queries.js', () => ({ getSetting: mocks.getSetting }));

import { getEvolutionConnectionState, registerTelegramWebhook, spNow, voiceTwiml } from './notifier.js';

// Sem mock de fetch/env fora do necessário: este arquivo testa só função pura, e desde que
// influx.ts passou a construir o cliente sob demanda (getApis) importar a cadeia notifier ->
// alertService -> influx não dispara mais conexão alguma. Se voltar a exigir mock aqui, é sinal de
// que alguém pôs efeito colateral no corpo de um módulo de novo.

describe('voiceTwiml', () => {
  it('põe pausa entre as frases do alerta', () => {
    const twiml = voiceTwiml('Atenção. A temperatura de Câmara 1 está fora do limite.');
    expect(twiml).toContain('Atenção.<break time="500ms"/>A temperatura de Câmara 1 está fora do limite.');
  });

  it('fala um pouco mais devagar', () => {
    expect(voiceTwiml('Teste.')).toContain('<prosody rate="92%">Teste.</prosody>');
  });

  it('não quebra em ponto decimal', () => {
    expect(voiceTwiml('Valor atual: 23.5 graus.')).not.toContain('23.5<break');
  });

  it('não manda SSML para voz Chirp3-HD, que não entende as tags', () => {
    const twiml = voiceTwiml('Atenção. Teste.', 'Google.pt-BR-Chirp3-HD-Aoede');
    expect(twiml).not.toContain('<break');
    expect(twiml).not.toContain('<prosody');
    expect(twiml).toContain('>Atenção. Teste.</Say>');
  });

  it('escapa o texto do template — admin não injeta TwiML pelo painel', () => {
    const twiml = voiceTwiml('Sensor <b>A</b> & B.');
    expect(twiml).toContain('Sensor &lt;b&gt;A&lt;/b&gt; &amp; B.');
  });
});

describe('spNow', () => {
  it('segunda 09:00 em São Paulo (UTC-3, sem horário de verão desde 2019)', () => {
    // 2026-01-05 12:00 UTC = 2026-01-05 09:00 -03:00 (segunda-feira)
    expect(spNow(new Date('2026-01-05T12:00:00Z'))).toEqual({ dow: '1', time: '09:00' });
  });

  it('vira o dia da semana ao cruzar meia-noite em São Paulo', () => {
    // 2026-01-05 02:30 UTC = 2026-01-04 23:30 -03:00 (domingo, dia anterior)
    expect(spNow(new Date('2026-01-05T02:30:00Z'))).toEqual({ dow: '0', time: '23:30' });
  });

  it('meia-noite exata em São Paulo', () => {
    // 2026-01-05 03:00 UTC = 2026-01-05 00:00 -03:00 (segunda-feira)
    expect(spNow(new Date('2026-01-05T03:00:00Z'))).toEqual({ dow: '1', time: '00:00' });
  });
});

// Alimenta o indicador de WhatsApp do painel. Evolution fora do ar não pode derrubar a rota que
// chama isto — qualquer falha vira 'error', que a UI mostra como desconectado.
describe('getEvolutionConnectionState', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    mocks.getSetting.mockReset().mockResolvedValue(null);
  });

  it('devolve o corpo da Evolution quando ela responde ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ state: 'open' }) })));

    expect(await getEvolutionConnectionState()).toEqual({ state: 'open' });
  });

  it('HTTP de erro vira state error em vez de estourar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));

    expect(await getEvolutionConnectionState()).toEqual({ state: 'error' });
  });

  it('Evolution inalcançável (fetch rejeita) vira state error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));

    expect(await getEvolutionConnectionState()).toEqual({ state: 'error' });
  });

  // Troca de instância pelo painel (sem mexer em código/env) — caso de uso: número bloqueado pela
  // Meta, admin troca pra outra instância já configurada na Evolution.
  it('usa a instância salva em app_settings, ignorando a env, quando existe', async () => {
    vi.stubEnv('EVOLUTION_URL', 'http://evolution.local');
    vi.stubEnv('EVOLUTION_INSTANCE', 'instancia-env-antiga');
    mocks.getSetting.mockResolvedValue('instancia-nova');
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ state: 'open' }) }));
    vi.stubGlobal('fetch', fetchMock);

    await getEvolutionConnectionState();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://evolution.local/instance/connectionState/instancia-nova',
      expect.anything(),
    );
  });

  it('cai para EVOLUTION_INSTANCE (env) quando não há instância salva no banco', async () => {
    vi.stubEnv('EVOLUTION_URL', 'http://evolution.local');
    vi.stubEnv('EVOLUTION_INSTANCE', 'instancia-env');
    mocks.getSetting.mockResolvedValue(null);
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ state: 'open' }) }));
    vi.stubGlobal('fetch', fetchMock);

    await getEvolutionConnectionState();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://evolution.local/instance/connectionState/instancia-env',
      expect.anything(),
    );
  });
});

describe('registerTelegramWebhook', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('não chama a Bot API quando TELEGRAM_BOT_TOKEN não está setado', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await registerTelegramWebhook();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('não chama a Bot API quando TELEGRAM_WEBHOOK_SECRET não está setado (webhook sem secret seria rejeitado por si mesmo)', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '123:abc');
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await registerTelegramWebhook();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('registra o webhook na Bot API com a URL e o secret certos', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '123:abc');
    vi.stubEnv('PUBLIC_URL', 'https://proatus.app');
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 'segredo');
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => '' }));
    vi.stubGlobal('fetch', fetchMock);

    await registerTelegramWebhook();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.telegram.org/bot123:abc/setWebhook',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ url: 'https://proatus.app/api/telegram/webhook', secret_token: 'segredo' }),
      }),
    );
  });
});
