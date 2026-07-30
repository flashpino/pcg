import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectivityVars,
  decideBinaryTransition,
  decideTransition,
  evaluate,
  evaluateConnectivity,
  evaluateHardware,
  isBackInBounds,
  notifyAdminsFirmwareUpdate,
  renotifyValue,
  sendContactTest,
  sendDailyReport,
  sendTest,
  shouldRenotify,
  violatedBound,
} from './alertService.js';
import * as queries from '../db/queries.js';
import { queryLatestReadings } from './influx.js';
import { enqueueVoice, enqueueWhatsapp } from './notifier.js';

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
  listFiringAlertsByClient: vi.fn(async () => []),
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

  // O painel anuncia min/max/limite nas 3 mensagens de conectividade, mas elas não eram montadas:
  // quem editasse o template usando essas variáveis via o campo sair em branco.
  it('inclui min/max/limite, anunciados no painel para as mensagens de conectividade', () => {
    const sensor = { name: 'Sensor A', local: 'Sala 1', offline_after_seconds: 300, temp_min: 2, temp_max: 8 };
    const vars = connectivityVars(sensor, 'Cliente X', 5);
    expect(vars.min).toBe(2);
    expect(vars.max).toBe(8);
    expect(vars.limite).toBe(8); // dentro da faixa: cai no max, mesmo critério de violatedBound
  });

  it('sem limites configurados no sensor, min/max/limite viram "-" em vez de sumir', () => {
    const sensor = { name: 'Sensor A', local: null, offline_after_seconds: 300, temp_min: null, temp_max: null };
    const vars = connectivityVars(sensor, '', null);
    expect([vars.min, vars.max, vars.limite]).toEqual(['-', '-', '-']);
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
  // evaluateHardware guarda o streak de ingests saudáveis em memória, por sensor — cada teste usa
  // um id próprio pra não herdar contagem do teste anterior.
  const sensorId = (id: number) =>
    ({ id, name: 'proatus_B678', local: 'CPD', client_id: 2, offline_after_seconds: 300 }) as queries.Sensor;
  const sensor = sensorId(12);

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

  // Sensor moribundo (lê de vez em quando) alternava fire/resolve a cada ciclo de 60s, mandando
  // duas mensagens por minuto pra cada admin. Exigir uma sequência de ingests saudáveis mata o
  // flapping sem atrasar demais o resolve de uma recuperação de verdade (~3 min a 60s/ingest).
  it('não resolve no primeiro ingest saudável — evita flapping de sensor intermitente', async () => {
    const s = sensorId(21);
    vi.mocked(queries.getFiringAlert).mockResolvedValue({ id: 55 } as queries.Alert);
    vi.mocked(queries.listAdminsWithPhone).mockResolvedValue([]);

    await evaluateHardware(s, false);

    expect(queries.resolveAlert).not.toHaveBeenCalled();
  });

  it('resolve após 3 ingests saudáveis consecutivos', async () => {
    const s = sensorId(22);
    vi.mocked(queries.getFiringAlert).mockResolvedValue({ id: 55 } as queries.Alert);
    vi.mocked(queries.listAdminsWithPhone).mockResolvedValue([]);

    await evaluateHardware(s, false);
    await evaluateHardware(s, false);
    expect(queries.resolveAlert).not.toHaveBeenCalled();
    await evaluateHardware(s, false);

    expect(queries.resolveAlert).toHaveBeenCalledWith(55);
  });

  it('uma recaída no meio zera a contagem — não resolve por acúmulo', async () => {
    const s = sensorId(23);
    vi.mocked(queries.getFiringAlert).mockResolvedValue({ id: 55 } as queries.Alert);
    vi.mocked(queries.listAdminsWithPhone).mockResolvedValue([]);

    await evaluateHardware(s, false);
    await evaluateHardware(s, false);
    await evaluateHardware(s, true); // travou de novo
    await evaluateHardware(s, false);
    await evaluateHardware(s, false);

    expect(queries.resolveAlert).not.toHaveBeenCalled();
  });

  it('sensor saudável e sem alerta firing não faz nada', async () => {
    // rows[0] é tipado como Alert mas vem undefined quando não há alerta firing — o código de
    // produção já trata isso (Boolean(firing) / firing!), o cast só alinha o mock ao runtime.
    vi.mocked(queries.getFiringAlert).mockResolvedValue(undefined as unknown as queries.Alert);

    await evaluateHardware(sensor, false);

    expect(queries.createAlert).not.toHaveBeenCalled();
    expect(enqueueWhatsapp).not.toHaveBeenCalled();
  });

  // Regressão de campo (2026-07-29, sensor "casa pino"): alerta de hardware disparado, chip de
  // defeito no painel e nenhum WhatsApp. Sem admin com telefone cadastrado, notifyAdmins iterava
  // uma lista vazia e não gravava nada — o alerta ficava sem UMA linha de notification, exatamente
  // igual a "a fila nunca rodou" ou "o Evolution caiu". Ninguém consegue diagnosticar isso pelo
  // painel. O envio não tem pra onde ir, mas o motivo tem que ficar registrado.
  it('sem nenhum admin com telefone registra o motivo em vez de sumir em silêncio', async () => {
    const s = sensorId(24);
    vi.mocked(queries.getFiringAlert).mockResolvedValue(undefined as unknown as queries.Alert);
    vi.mocked(queries.createAlert).mockResolvedValue({ id: 56 } as queries.Alert);
    vi.mocked(queries.listAdminsWithPhone).mockResolvedValue([]);

    await evaluateHardware(s, true);

    expect(queries.createAdminNotification).toHaveBeenCalledWith(56, null, 'whatsapp', 'skipped_no_admin');
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

describe('evaluateConnectivity com defeito de hardware em curso', () => {
  beforeEach(() => vi.clearAllMocks());

  // Regressão introduzida pelo heartbeat: com last_seen_at fresco o sweep resolvia a conectividade
  // e mandava "Sensor X voltou a reportar" pros contatos do cliente — falsa tranquilização, já que
  // sem leitura não há monitoramento nenhum. O registro resolve (a comunicação voltou mesmo), mas
  // a mensagem de normalidade não pode sair enquanto o sensor estiver quebrado.
  it('resolve o registro mas não anuncia "voltou a reportar" aos contatos', async () => {
    const sensor = { id: 31, name: 'proatus_B678', local: 'CPD', client_id: 2, offline_after_seconds: 300 } as queries.Sensor;
    vi.mocked(queries.getFiringAlert).mockImplementation(
      async (_id, type) => ({ id: type === 'connectivity' ? 70 : 71 }) as queries.Alert,
    );
    vi.mocked(queries.listContacts).mockResolvedValue([]);
    vi.mocked(queries.listContactAlertPrefsByClient).mockResolvedValue([]);
    vi.mocked(queries.listAdminsWithPhone).mockResolvedValue([]);

    await evaluateConnectivity(sensor, false);

    expect(queries.resolveAlert).toHaveBeenCalledWith(70);
    expect(queries.getMessageTemplate).not.toHaveBeenCalledWith('connectivity_resolve');
  });

  it('sem defeito de hardware, o "voltou a reportar" sai normalmente', async () => {
    const sensor = { id: 32, name: 'proatus_C528', local: 'CPD', client_id: 2, offline_after_seconds: 300 } as queries.Sensor;
    vi.mocked(queries.getFiringAlert).mockImplementation(
      async (_id, type) => (type === 'connectivity' ? ({ id: 80 } as queries.Alert) : (undefined as unknown as queries.Alert)),
    );
    vi.mocked(queries.listContacts).mockResolvedValue([]);
    vi.mocked(queries.listContactAlertPrefsByClient).mockResolvedValue([]);
    vi.mocked(queries.listAdminsWithPhone).mockResolvedValue([]);

    await evaluateConnectivity(sensor, false);

    expect(queries.getMessageTemplate).toHaveBeenCalledWith('connectivity_resolve');
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

// Contato com os dois canais ligados e janela sempre aberta (sem dias/horário restritos), pra
// que o teste exercite o caminho de envio e não o de skipped_pref/skipped_window.
const contatoAtivo = {
  id: 5,
  client_id: 1,
  name: 'Fulano',
  phone: '+5511999999999',
  channel_voice: true,
  channel_whatsapp: true,
  timezone: 'America/Sao_Paulo',
  active: true,
  created_at: '2026-01-01',
} as queries.Contact;

const prefLiberada = (alert_type: queries.ContactAlertPref['alert_type'], renotify_minutes = 60) =>
  ({
    contact_id: 5,
    alert_type,
    enabled: true,
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    window_start: null,
    window_end: null,
    renotify_minutes,
  }) as queries.ContactAlertPref;

describe('evaluateConnectivity — fire e renotify', () => {
  const sensor = { id: 7, name: 'Sensor A', local: 'Sala 1', client_id: 1, offline_after_seconds: 300 } as queries.Sensor;

  beforeEach(() => vi.clearAllMocks());

  it('sensor offline sem alerta firing dispara alerta e avisa contato e admin', async () => {
    vi.mocked(queries.getFiringAlert).mockResolvedValue(undefined as unknown as queries.Alert);
    vi.mocked(queries.createAlert).mockResolvedValue({ id: 70 } as queries.Alert);
    vi.mocked(queries.listContacts).mockResolvedValue([contatoAtivo]);
    vi.mocked(queries.listContactAlertPrefsByClient).mockResolvedValue([prefLiberada('connectivity')]);
    vi.mocked(queries.createNotification).mockResolvedValue({ id: 1 } as never);
    vi.mocked(queries.listAdminsWithPhone).mockResolvedValue([{ id: 3, email: 'a@x', phone: '+5511888888888' }]);

    await evaluateConnectivity(sensor, true);

    expect(queries.createAlert).toHaveBeenCalledWith(7, 'connectivity', null, expect.any(String));
    // contato + admin
    expect(enqueueWhatsapp).toHaveBeenCalledTimes(2);
    // conectividade nunca liga — voz é exclusiva de temperatura
    expect(enqueueVoice).not.toHaveBeenCalled();
  });

  // createAlert devolve vazio quando já existe alerta firing pro par (sensor, tipo): sem esse
  // guard, uma corrida entre duas varreduras notificaria o cliente duas vezes pelo mesmo evento.
  it('não notifica ninguém quando createAlert não devolve alerta', async () => {
    vi.mocked(queries.getFiringAlert).mockResolvedValue(undefined as unknown as queries.Alert);
    vi.mocked(queries.createAlert).mockResolvedValue(undefined as unknown as queries.Alert);
    vi.mocked(queries.listContacts).mockResolvedValue([contatoAtivo]);
    vi.mocked(queries.listContactAlertPrefsByClient).mockResolvedValue([prefLiberada('connectivity')]);

    await evaluateConnectivity(sensor, true);

    expect(enqueueWhatsapp).not.toHaveBeenCalled();
  });

  it('continua offline com alerta já firing renotifica o contato, mas não o admin', async () => {
    vi.mocked(queries.getFiringAlert).mockResolvedValue({ id: 70 } as queries.Alert);
    vi.mocked(queries.listContacts).mockResolvedValue([contatoAtivo]);
    vi.mocked(queries.listContactAlertPrefsByClient).mockResolvedValue([prefLiberada('connectivity')]);
    vi.mocked(queries.getLastNotification).mockResolvedValue(undefined as never);
    vi.mocked(queries.createNotification).mockResolvedValue({ id: 2 } as never);

    await evaluateConnectivity(sensor, true);

    expect(queries.createAlert).not.toHaveBeenCalled();
    expect(enqueueWhatsapp).toHaveBeenCalledTimes(1);
  });

  // O cooldown do renotify (shouldRenotify) tem que valer também aqui: sensor offline há horas
  // não pode virar uma mensagem por varredura, ou seja, uma a cada 60s.
  it('renotify respeita o cooldown — notificação recente não repete', async () => {
    vi.mocked(queries.getFiringAlert).mockResolvedValue({ id: 70 } as queries.Alert);
    vi.mocked(queries.listContacts).mockResolvedValue([contatoAtivo]);
    vi.mocked(queries.listContactAlertPrefsByClient).mockResolvedValue([prefLiberada('connectivity')]);
    vi.mocked(queries.getLastNotification).mockResolvedValue({ created_at: new Date().toISOString() } as never);

    await evaluateConnectivity(sensor, true);

    expect(enqueueWhatsapp).not.toHaveBeenCalled();
  });
});

describe('sendTest', () => {
  const sensor = {
    id: 7,
    name: 'Sensor A',
    local: 'Sala 1',
    client_id: 1,
    last_seen_at: '2026-01-05T12:00:00Z',
  } as queries.Sensor;

  beforeEach(() => vi.clearAllMocks());

  it('sensor não reivindicado (sem cliente) não envia nada', async () => {
    await sendTest({ ...sensor, client_id: null } as queries.Sensor);

    expect(queries.createResolvedAlert).not.toHaveBeenCalled();
    expect(enqueueWhatsapp).not.toHaveBeenCalled();
  });

  // O aviso vem ANTES do teste: quem recebe uma ligação automática sem contexto acha que é
  // emergência real. Duas mensagens de WhatsApp, nessa ordem.
  it('manda o aviso antes do teste em si', async () => {
    vi.mocked(queries.listContacts).mockResolvedValue([contatoAtivo]);
    vi.mocked(queries.listContactAlertPrefsByClient).mockResolvedValue([prefLiberada('test')]);
    vi.mocked(queries.createNotification).mockResolvedValue({ id: 3 } as never);

    await sendTest(sensor);

    expect(queries.createResolvedAlert).toHaveBeenCalledWith(7, 'test', expect.any(String));
    expect(enqueueWhatsapp).toHaveBeenCalledTimes(2); // aviso + teste
  });

  // Só adiciona o canal de voz quando o template 'test' tem texto de voz — senão notifyContacts
  // enfileiraria uma ligação com texto undefined.
  it('só liga quando o template de teste tem texto de voz', async () => {
    vi.mocked(queries.listContacts).mockResolvedValue([contatoAtivo]);
    vi.mocked(queries.listContactAlertPrefsByClient).mockResolvedValue([prefLiberada('test')]);
    vi.mocked(queries.createNotification).mockResolvedValue({ id: 3 } as never);

    await sendTest(sensor);
    expect(enqueueVoice).not.toHaveBeenCalled(); // template padrão do mock tem voice: null

    vi.clearAllMocks();
    vi.mocked(queries.getMessageTemplate).mockResolvedValue({ whatsapp: 'oi', voice: 'alô' } as never);
    vi.mocked(queries.listContacts).mockResolvedValue([contatoAtivo]);
    vi.mocked(queries.listContactAlertPrefsByClient).mockResolvedValue([prefLiberada('test')]);
    vi.mocked(queries.createNotification).mockResolvedValue({ id: 3 } as never);

    await sendTest(sensor);
    expect(enqueueVoice).toHaveBeenCalledTimes(1);
  });

  it('contato inativo não recebe teste nenhum', async () => {
    vi.mocked(queries.listContacts).mockResolvedValue([{ ...contatoAtivo, active: false }]);
    vi.mocked(queries.listContactAlertPrefsByClient).mockResolvedValue([prefLiberada('test')]);

    await sendTest(sensor);

    expect(enqueueWhatsapp).not.toHaveBeenCalled();
  });

  // O aviso prévio era renderizado com vars = {} — qualquer {{$...}} nele saía vazio, inclusive
  // o {{$local}}, que é o que diz à pessoa QUAL ambiente vai ser testado.
  it('o aviso prévio também recebe as variáveis padrão', async () => {
    vi.mocked(queries.listContacts).mockResolvedValue([contatoAtivo]);
    vi.mocked(queries.listContactAlertPrefsByClient).mockResolvedValue([prefLiberada('test')]);
    vi.mocked(queries.createNotification).mockResolvedValue({ id: 3 } as never);
    vi.mocked(queries.getMessageTemplate).mockResolvedValue({ whatsapp: 'aviso [{{$local}}]', voice: null } as never);

    await sendTest(sensor);

    expect(vi.mocked(enqueueWhatsapp).mock.calls[0][0].text).toBe('aviso [Sala 1]');
  });

  // Relato de campo: o aviso "vai ser executado um teste" e a ligação saíam no mesmo instante —
  // o telefone tocava antes de a pessoa ter lido o WhatsApp, que é justamente o que o aviso
  // deveria evitar. O aviso sai na hora; o teste em si só 2 minutos depois.
  it('aguarda 2 minutos entre o aviso e o teste (WhatsApp e ligação)', async () => {
    vi.mocked(queries.listContacts).mockResolvedValue([contatoAtivo]);
    vi.mocked(queries.listContactAlertPrefsByClient).mockResolvedValue([prefLiberada('test')]);
    vi.mocked(queries.createNotification).mockResolvedValue({ id: 3 } as never);
    vi.mocked(queries.getMessageTemplate).mockResolvedValue({ whatsapp: 'oi', voice: 'alô' } as never);

    await sendTest(sensor);

    const [aviso, teste] = vi.mocked(enqueueWhatsapp).mock.calls;
    expect(aviso[1] ?? 0).toBe(0); // aviso imediato
    expect(teste[1]).toBe(120);
    expect(enqueueVoice).toHaveBeenCalledWith(expect.anything(), 120);
  });
});

describe('sendContactTest', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cliente sem sensor cadastrado falha com 400 em vez de estourar depois', async () => {
    vi.mocked(queries.listSensors).mockResolvedValue([]);

    await expect(sendContactTest(contatoAtivo)).rejects.toMatchObject({ statusCode: 400 });
  });

  // Regressão de comportamento: o botão "Testar canal" antes ignorava enabled/janela por
  // completo. Agora passa pela mesma engrenagem do alerta real.
  it('respeita a pref desligada do contato — grava skipped_pref e não enfileira', async () => {
    vi.mocked(queries.listSensors).mockResolvedValue([{ id: 7, name: 'Sensor A', local: null } as queries.Sensor]);
    vi.mocked(queries.listContactAlertPrefsByClient).mockResolvedValue([
      { ...prefLiberada('test'), enabled: false },
    ]);
    vi.mocked(queries.createNotification).mockResolvedValue({ id: 4 } as never);

    await sendContactTest(contatoAtivo);

    expect(queries.createNotification).toHaveBeenCalledWith(42, 5, 'whatsapp', 'skipped_pref');
    expect(enqueueWhatsapp).not.toHaveBeenCalled();
  });

  it('contato com pref liberada recebe aviso e teste', async () => {
    vi.mocked(queries.listSensors).mockResolvedValue([{ id: 7, name: 'Sensor A', local: null } as queries.Sensor]);
    vi.mocked(queries.listContactAlertPrefsByClient).mockResolvedValue([prefLiberada('test')]);
    vi.mocked(queries.createNotification).mockResolvedValue({ id: 4 } as never);

    await sendContactTest(contatoAtivo);

    expect(enqueueWhatsapp).toHaveBeenCalledTimes(2); // aviso + teste
    expect(enqueueWhatsapp).toHaveBeenCalledWith(expect.objectContaining({ phone: '+5511999999999' }), expect.anything());
  });

  // O painel anuncia {{$temperatura}} e {{$quando}} no template 'test', mas por este caminho elas
  // não eram montadas — o admin editava o texto e os campos saíam em branco.
  it('recebe as variáveis padrão anunciadas no painel, inclusive temperatura e quando', async () => {
    vi.mocked(queries.listSensors).mockResolvedValue([
      { id: 7, name: 'Sensor A', local: 'Sala 1', last_seen_at: '2026-01-05T12:00:00Z' } as queries.Sensor,
    ]);
    vi.mocked(queries.listContactAlertPrefsByClient).mockResolvedValue([prefLiberada('test')]);
    vi.mocked(queries.createNotification).mockResolvedValue({ id: 4 } as never);
    vi.mocked(queries.getMessageTemplate).mockResolvedValue({
      whatsapp: 'local=[{{$local}}] temp=[{{$temperatura}}] nome=[{{$nome}}]',
      voice: null,
    } as never);
    vi.mocked(queryLatestReadings).mockResolvedValue(new Map([[7, { temperature: 21.5 }]]) as never);

    await sendContactTest(contatoAtivo);

    expect(vi.mocked(enqueueWhatsapp).mock.calls[1][0].text).toBe('local=[Sala 1] temp=[21.5] nome=[Fulano]');
  });

  // Mesmo intervalo do teste por sensor: o botão "Testar canal" também precisa dar tempo de ler.
  it('aguarda 2 minutos entre o aviso e o teste', async () => {
    vi.mocked(queries.listSensors).mockResolvedValue([{ id: 7, name: 'Sensor A', local: null } as queries.Sensor]);
    vi.mocked(queries.listContactAlertPrefsByClient).mockResolvedValue([prefLiberada('test')]);
    vi.mocked(queries.createNotification).mockResolvedValue({ id: 4 } as never);

    await sendContactTest(contatoAtivo);

    const [aviso, teste] = vi.mocked(enqueueWhatsapp).mock.calls;
    expect(aviso[1] ?? 0).toBe(0);
    expect(teste[1]).toBe(120);
  });
});

// Mensagem diária de "está tudo bem": mesma engrenagem de notifyContacts (active/enabled/canal),
// mas com pref própria ('daily') e horário exato por contato em vez de janela.
describe('sendDailyReport', () => {
  const sensores = [
    { id: 7, name: 'Sensor A', local: 'Câmara fria 1', client_id: 1 },
    { id: 8, name: 'Sensor B', local: null, client_id: 1 },
  ] as queries.Sensor[];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(queries.listFiringAlertsByClient).mockResolvedValue([]);
    vi.mocked(queries.createNotification).mockResolvedValue({ id: 11 } as never);
  });

  it('cliente sem sensor cadastrado não envia nada (não tem o que reportar)', async () => {
    vi.mocked(queries.listSensors).mockResolvedValue([]);

    await sendDailyReport(contatoAtivo);

    expect(queries.createResolvedAlert).not.toHaveBeenCalled();
    expect(enqueueWhatsapp).not.toHaveBeenCalled();
  });

  it('tudo normal: um WhatsApp por contato, pendurado num alerta do tipo daily', async () => {
    vi.mocked(queries.listSensors).mockResolvedValue(sensores);
    vi.mocked(queries.listContactAlertPrefsByClient).mockResolvedValue([prefLiberada('daily')]);

    await sendDailyReport(contatoAtivo);

    expect(queries.createResolvedAlert).toHaveBeenCalledWith(7, 'daily', expect.any(String));
    expect(enqueueWhatsapp).toHaveBeenCalledTimes(1);
    expect(enqueueWhatsapp).toHaveBeenCalledWith(expect.objectContaining({ phone: '+5511999999999' }), 0); // sem atraso
  });

  it('{{$sensores}} lista cada sensor com a temperatura atual (local, ou nome quando sem local)', async () => {
    vi.mocked(queries.listSensors).mockResolvedValue(sensores);
    vi.mocked(queries.listContactAlertPrefsByClient).mockResolvedValue([prefLiberada('daily')]);
    vi.mocked(queries.getMessageTemplate).mockResolvedValue({ whatsapp: '{{$sensores}}', voice: null } as never);
    vi.mocked(queryLatestReadings).mockResolvedValue(
      new Map([[7, { temperature: 4.2 }]]) as never, // sensor 8 sem leitura recente
    );

    await sendDailyReport(contatoAtivo);

    const { text } = vi.mocked(enqueueWhatsapp).mock.calls[0][0];
    expect(text).toContain('Câmara fria 1: 4.2');
    expect(text).toContain('Sensor B: --');
  });

  // Relato do usuário: "na mensagem diária não tem as variáveis padrões, eu preciso do local e
  // não tem". renderTemplate troca variável desconhecida por string vazia, então o campo sumia da
  // mensagem sem erro nenhum. Todo template precisa receber o conjunto padrão.
  it('recebe as variáveis padrão — {{$local}}, {{$sensor}} e {{$temperatura}} não saem vazios', async () => {
    vi.mocked(queries.listSensors).mockResolvedValue([sensores[0]]);
    vi.mocked(queries.listContactAlertPrefsByClient).mockResolvedValue([prefLiberada('daily')]);
    vi.mocked(queries.getMessageTemplate).mockResolvedValue({
      whatsapp: 'local=[{{$local}}] sensor=[{{$sensor}}] temp=[{{$temperatura}}] cliente=[{{$cliente}}]',
      voice: null,
    } as never);
    vi.mocked(queryLatestReadings).mockResolvedValue(new Map([[7, { temperature: 4.2 }]]) as never);

    await sendDailyReport(contatoAtivo);

    const { text } = vi.mocked(enqueueWhatsapp).mock.calls[0][0];
    expect(text).toBe('local=[Câmara fria 1] sensor=[Sensor A] temp=[4.2] cliente=[Cliente X]');
  });

  // Com mais de um sensor a diária é uma mensagem só, então as variáveis de sensor viram lista —
  // melhor que escolher um sensor arbitrário e mentir sobre os outros.
  it('com vários sensores, {{$local}} e {{$sensor}} listam todos', async () => {
    vi.mocked(queries.listSensors).mockResolvedValue(sensores);
    vi.mocked(queries.listContactAlertPrefsByClient).mockResolvedValue([prefLiberada('daily')]);
    vi.mocked(queries.getMessageTemplate).mockResolvedValue({ whatsapp: '[{{$local}}]', voice: null } as never);

    await sendDailyReport(contatoAtivo);

    const { text } = vi.mocked(enqueueWhatsapp).mock.calls[0][0];
    expect(text).toBe('[Câmara fria 1, Sensor B]'); // Sensor B não tem local — cai pro nome
  });

  // Falsa tranquilização é pior que silêncio: mandar "está tudo bem com a climatização" com um
  // sensor fora do limite (ou offline) contradiz o alerta que o mesmo contato acabou de receber.
  it('com alerta disparado em curso não manda "tudo bem" — grava skipped_alert_firing', async () => {
    vi.mocked(queries.listSensors).mockResolvedValue(sensores);
    vi.mocked(queries.listContactAlertPrefsByClient).mockResolvedValue([prefLiberada('daily')]);
    vi.mocked(queries.listFiringAlertsByClient).mockResolvedValue([{ id: 1, type: 'temperature' } as queries.Alert]);

    await sendDailyReport(contatoAtivo);

    expect(queries.createNotification).toHaveBeenCalledWith(42, 5, 'whatsapp', 'skipped_alert_firing');
    expect(enqueueWhatsapp).not.toHaveBeenCalled();
  });

  it('pref daily desligada grava skipped_pref e não enfileira', async () => {
    vi.mocked(queries.listSensors).mockResolvedValue(sensores);
    vi.mocked(queries.listContactAlertPrefsByClient).mockResolvedValue([{ ...prefLiberada('daily'), enabled: false }]);

    await sendDailyReport(contatoAtivo);

    expect(queries.createNotification).toHaveBeenCalledWith(42, 5, 'whatsapp', 'skipped_pref');
    expect(enqueueWhatsapp).not.toHaveBeenCalled();
  });

  it('contato inativo não recebe a diária', async () => {
    vi.mocked(queries.listSensors).mockResolvedValue(sensores);
    vi.mocked(queries.listContactAlertPrefsByClient).mockResolvedValue([prefLiberada('daily')]);

    await sendDailyReport({ ...contatoAtivo, active: false });

    expect(enqueueWhatsapp).not.toHaveBeenCalled();
  });
});

// Relato de campo: "o sensor proatus_F794 tem um alerta disparado de temperatura mas não fez a
// ligação". O alerta existe e o WhatsApp saiu — só a ligação não. As duas razões possíveis pra
// isso saíam do sistema sem gravar linha nenhuma em notifications, e no painel "não ligou por
// configuração" ficava idêntico a "a fila de voz travou" / "a Twilio caiu".
// Fica por último no arquivo de propósito: vi.clearAllMocks() não restaura implementações, então
// o getMessageTemplate com voz definido aqui vazaria pros describes seguintes.
describe('evaluate — por que a ligação de temperatura não saiu', () => {
  const sensor = {
    id: 7,
    name: 'proatus_F794',
    local: 'Sala 1',
    client_id: 1,
    temp_min: null,
    temp_max: 30,
    hum_min: null,
    hum_max: null,
  } as unknown as queries.Sensor;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(queries.getFiringAlert).mockResolvedValue(undefined as unknown as queries.Alert);
    vi.mocked(queries.createAlert).mockResolvedValue({ id: 70 } as queries.Alert);
    vi.mocked(queries.listContacts).mockResolvedValue([contatoAtivo]);
    vi.mocked(queries.listContactAlertPrefsByClient).mockResolvedValue([prefLiberada('temperature')]);
    vi.mocked(queries.createNotification).mockResolvedValue({ id: 8 } as never);
    vi.mocked(queries.getMessageTemplate).mockResolvedValue({ whatsapp: 'fora do limite', voice: 'alô' } as never);
  });

  it('canal de voz desligado no contato registra skipped_channel em vez de sumir em silêncio', async () => {
    vi.mocked(queries.listContacts).mockResolvedValue([{ ...contatoAtivo, channel_voice: false }]);

    await evaluate(sensor, { temp: 31, hum: 50 });

    expect(queries.createNotification).toHaveBeenCalledWith(70, 5, 'voice', 'skipped_channel');
    expect(enqueueVoice).not.toHaveBeenCalled();
    expect(enqueueWhatsapp).toHaveBeenCalledTimes(1); // o WhatsApp saiu — é o que o operador viu
  });

  // Painel > Mensagens permite salvar temperature_fire com o campo de voz vazio; a partir daí
  // nenhum alerta de temperatura liga pra ninguém, e nada no painel diz isso.
  it('template de temperatura sem texto de voz registra skipped_no_voice_text', async () => {
    vi.mocked(queries.getMessageTemplate).mockResolvedValue({ whatsapp: 'fora do limite', voice: null } as never);

    await evaluate(sensor, { temp: 31, hum: 50 });

    expect(queries.createNotification).toHaveBeenCalledWith(70, 5, 'voice', 'skipped_no_voice_text');
    expect(enqueueVoice).not.toHaveBeenCalled();
  });

  // Guarda a regra que importa: com canal ligado e texto configurado a ligação continua saindo,
  // uma só, junto do WhatsApp.
  it('canal ligado e texto configurado dispara WhatsApp e ligação', async () => {
    await evaluate(sensor, { temp: 31, hum: 50 });

    expect(enqueueWhatsapp).toHaveBeenCalledTimes(1);
    expect(enqueueVoice).toHaveBeenCalledTimes(1);
    // Alerta real liga na hora — o atraso de 2 min é exclusivo do teste, que tem aviso prévio.
    expect(enqueueVoice).toHaveBeenCalledWith(expect.objectContaining({ phone: '+5511999999999', text: 'alô' }), 0);
  });
});
