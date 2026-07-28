import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectivityVars,
  decideBinaryTransition,
  decideTransition,
  evaluateHardware,
  isBackInBounds,
  notifyAdminsFirmwareUpdate,
  renotifyValue,
  shouldRenotify,
  violatedBound,
} from './alertService.js';
import * as queries from '../db/queries.js';
import { enqueueWhatsapp } from './notifier.js';

// Só o necessário pros caminhos de notificação de admin — o resto do arquivo testa função pura.
vi.mock('../db/queries.js', () => ({
  createAdminNotification: vi.fn(async () => ({ id: 99 })),
  createAlert: vi.fn(),
  createNotification: vi.fn(),
  createResolvedAlert: vi.fn(async () => ({ id: 42 })),
  getClient: vi.fn(async () => ({ name: 'Cliente X' })),
  getFiringAlert: vi.fn(),
  getLastNotification: vi.fn(),
  getMessageTemplate: vi.fn(async () => ({ whatsapp: 'Sensor {{$sensor}}: {{$de}} -> {{$para}}', voice: null })),
  listAdminsWithPhone: vi.fn(async () => []),
  listContactAlertPrefsByClient: vi.fn(),
  listContacts: vi.fn(),
  listSensors: vi.fn(),
  resolveAlert: vi.fn(),
}));
vi.mock('./notifier.js', () => ({ enqueueWhatsapp: vi.fn(), enqueueVoice: vi.fn() }));
vi.mock('./influx.js', () => ({ queryLatestReadings: vi.fn(async () => new Map()) }));

describe('isBackInBounds', () => {
  // Regressão: node-postgres devolve NUMERIC como string. "15" + 0.5 concatena ("150.5") em vez
  // de somar (15.5), fazendo o alerta nunca resolver quando havia um mínimo configurado.
  it('min chegando como string (NUMERIC do Postgres) ainda resolve corretamente', () => {
    const bound = { min: '15' as unknown as number, max: 27 };
    expect(isBackInBounds(23.8, bound)).toBe(true);
  });
});

describe('violatedBound', () => {
  it('valor acima do max retorna o max (violação por cima)', () => {
    expect(violatedBound(30, { min: 10, max: 27 })).toBe(27);
  });

  it('valor abaixo do min retorna o min (violação por baixo) — não o max', () => {
    expect(violatedBound(23.4, { min: 25, max: 27 })).toBe(25);
  });

  it('sem violação (dentro da faixa) cai no max como fallback', () => {
    expect(violatedBound(20, { min: 10, max: 27 })).toBe(27);
  });
});

describe('decideTransition', () => {
  it('dispara 1x ao sair do limite sem alerta firing', () => {
    expect(decideTransition(9, { min: null, max: 8 }, false)).toBe('fire');
  });

  it('não duplica: já firing e ainda fora do limite vira renotify, não fire de novo', () => {
    expect(decideTransition(9, { min: null, max: 8 }, true)).toBe('renotify');
  });

  it('resolve só com histerese: 7.8 continua firing, 7.4 resolve (max=8, histerese=0.5)', () => {
    expect(decideTransition(7.8, { min: null, max: 8 }, true)).toBe('renotify');
    expect(decideTransition(7.4, { min: null, max: 8 }, true)).toBe('resolve');
  });

  it('sem limites configurados nunca dispara', () => {
    expect(decideTransition(999, { min: null, max: null }, false)).toBe('none');
  });

  it('respeita limite inferior com histerese', () => {
    expect(decideTransition(1, { min: 2, max: null }, false)).toBe('fire');
    expect(decideTransition(2.3, { min: 2, max: null }, true)).toBe('renotify');
    expect(decideTransition(2.6, { min: 2, max: null }, true)).toBe('resolve');
  });
});

describe('renotifyValue', () => {
  // Regressão: contato recebeu "Temperatura: 29.6°C / Limite: 30°C" — a renotificação usava a
  // leitura atual, que na zona morta da histerese já está dentro do limite e contradiz o alarme.
  it('na zona morta da histerese usa o valor que disparou o alerta', () => {
    expect(renotifyValue(29.6, { min: null, max: 30 }, 31)).toBe(31);
  });

  it('ainda fora do limite usa a leitura atual (mais recente que o disparo)', () => {
    expect(renotifyValue(35, { min: null, max: 30 }, 31)).toBe(35);
  });

  it('alerta antigo sem valor gravado cai na leitura atual', () => {
    expect(renotifyValue(29.6, { min: null, max: 30 }, null)).toBe(29.6);
  });
});

describe('decideBinaryTransition', () => {
  it('dispara ao ficar offline sem alerta firing', () => {
    expect(decideBinaryTransition(true, false)).toBe('fire');
  });

  it('não duplica: já firing e ainda offline vira renotify', () => {
    expect(decideBinaryTransition(true, true)).toBe('renotify');
  });

  it('resolve assim que volta a reportar — sem histerese', () => {
    expect(decideBinaryTransition(false, true)).toBe('resolve');
  });

  it('online e sem alerta: nada a fazer', () => {
    expect(decideBinaryTransition(false, false)).toBe('none');
  });
});

describe('connectivityVars', () => {
  // Regressão: quando o sensor volta a reportar, a mensagem de "voltou a reportar" não trazia a
  // temperatura atual — evaluateConnectivity nunca buscava a leitura mais recente pra montar as vars.
  it('inclui a temperatura atual quando há leitura recente', () => {
    const sensor = { name: 'Sensor A', local: 'Sala 1', offline_after_seconds: 300 };
    expect(connectivityVars(sensor, 'Cliente X', 21.5)).toEqual({
      sensor: 'Sensor A',
      cliente: 'Cliente X',
      local: 'Sala 1',
      segundos: 300,
      temperatura: 21.5,
    });
  });

  it('usa "--" quando não há leitura recente (sensor mudo)', () => {
    const sensor = { name: 'Sensor A', local: null, offline_after_seconds: 300 };
    expect(connectivityVars(sensor, '', null).temperatura).toBe('--');
  });
});

describe('notifyAdminsFirmwareUpdate', () => {
  const sensor = { id: 7, name: 'Sensor A', local: 'Sala 1', client_id: 1 } as queries.Sensor;

  beforeEach(() => vi.clearAllMocks());

  it('enfileira WhatsApp pra cada admin com telefone', async () => {
    vi.mocked(queries.listAdminsWithPhone).mockResolvedValue([
      { id: 3, email: 'a@x', phone: '+5511999999999' },
      { id: 4, email: 'b@x', phone: '+5511888888888' },
    ]);

    await notifyAdminsFirmwareUpdate(sensor, '1.0.0', '1.1.0');

    expect(enqueueWhatsapp).toHaveBeenCalledTimes(2);
    expect(enqueueWhatsapp).toHaveBeenCalledWith(expect.objectContaining({ phone: '+5511999999999' }));
  });

  // Regressão: sem nenhum admin com telefone a função saía antes de gravar o alerta — a
  // atualização de firmware sumia sem rastro (nem WhatsApp, nem linha em Alertas pra diagnosticar).
  it('registra o alerta mesmo sem nenhum admin com telefone', async () => {
    vi.mocked(queries.listAdminsWithPhone).mockResolvedValue([]);

    await notifyAdminsFirmwareUpdate(sensor, '1.0.0', '1.1.0');

    expect(queries.createResolvedAlert).toHaveBeenCalledWith(7, 'firmware', expect.stringContaining('1.1.0'));
    expect(enqueueWhatsapp).not.toHaveBeenCalled();
  });
});

describe('evaluateHardware', () => {
  const sensor = {
    id: 12,
    name: 'proatus_B678',
    local: 'CPD',
    client_id: 2,
    offline_after_seconds: 300,
  } as queries.Sensor;

  beforeEach(() => vi.clearAllMocks());

  // Regressão de campo (2026-07-28): o proatus_B678 passou 3h30 rotulado como "offline" no painel
  // — com Wi-Fi a -28 dBm e o device respondendo SNMP — porque o DHT22 morreu e o firmware não
  // tinha como dizer "estou vivo, quem morreu foi o sensor". O alerta que saiu mandou a equipe
  // checar provedor/cabeamento; o problema era o sensor no CN1.
  it('dispara alerta de hardware (não de conectividade) quando o device reporta sensor travado', async () => {
    // rows[0] é tipado como Alert mas vem undefined quando não há alerta firing — o código de
    // produção já trata isso (Boolean(firing) / firing!), o cast só alinha o mock ao runtime.
    vi.mocked(queries.getFiringAlert).mockResolvedValue(undefined as unknown as queries.Alert);
    vi.mocked(queries.createAlert).mockResolvedValue({ id: 55 } as queries.Alert);
    vi.mocked(queries.listAdminsWithPhone).mockResolvedValue([{ id: 3, email: 'a@x', phone: '+5511999999999' }]);

    await evaluateHardware(sensor, true);

    expect(queries.createAlert).toHaveBeenCalledWith(12, 'hardware', null, expect.any(String));
    expect(enqueueWhatsapp).toHaveBeenCalledTimes(1);
  });

  it('resolve o alerta quando as leituras voltam', async () => {
    vi.mocked(queries.getFiringAlert).mockResolvedValue({ id: 55 } as queries.Alert);
    vi.mocked(queries.listAdminsWithPhone).mockResolvedValue([]);

    await evaluateHardware(sensor, false);

    expect(queries.resolveAlert).toHaveBeenCalledWith(55);
  });

  it('sensor saudável e sem alerta firing não faz nada', async () => {
    // rows[0] é tipado como Alert mas vem undefined quando não há alerta firing — o código de
    // produção já trata isso (Boolean(firing) / firing!), o cast só alinha o mock ao runtime.
    vi.mocked(queries.getFiringAlert).mockResolvedValue(undefined as unknown as queries.Alert);

    await evaluateHardware(sensor, false);

    expect(queries.createAlert).not.toHaveBeenCalled();
    expect(enqueueWhatsapp).not.toHaveBeenCalled();
  });

  // O heartbeat chega a cada 60s enquanto o sensor estiver travado — re-notificar a cada ingest
  // encheria o WhatsApp do time. Alerta de hardware é fire/resolve só, igual notifyAdminsHardware.
  it('já firing e ainda travado não re-notifica (evita spam a cada heartbeat)', async () => {
    vi.mocked(queries.getFiringAlert).mockResolvedValue({ id: 55 } as queries.Alert);
    vi.mocked(queries.listAdminsWithPhone).mockResolvedValue([{ id: 3, email: 'a@x', phone: '+5511999999999' }]);

    await evaluateHardware(sensor, true);

    expect(queries.createAlert).not.toHaveBeenCalled();
    expect(enqueueWhatsapp).not.toHaveBeenCalled();
  });
});

describe('shouldRenotify', () => {
  const now = new Date('2026-01-01T12:00:00Z');

  it('renotify_minutes=0 nunca repete', () => {
    expect(shouldRenotify(null, 0, now)).toBe(false);
    expect(shouldRenotify(new Date('2020-01-01'), 0, now)).toBe(false);
  });

  it('sem notificação anterior, sempre notifica', () => {
    expect(shouldRenotify(null, 60, now)).toBe(true);
  });

  it('re-dispara após cooldown: dentro da janela não repete, depois dela repete', () => {
    const dentroDoCooldown = new Date('2026-01-01T11:30:00Z');
    const foraDoCooldown = new Date('2026-01-01T10:59:00Z');
    expect(shouldRenotify(dentroDoCooldown, 60, now)).toBe(false);
    expect(shouldRenotify(foraDoCooldown, 60, now)).toBe(true);
  });
});
