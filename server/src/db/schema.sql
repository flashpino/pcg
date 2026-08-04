-- Migração idempotente: executada inteira a cada boot (tudo IF NOT EXISTS).
-- ponytail: sem ferramenta de migração — adicionar node-pg-migrate quando o schema mudar em produção.

CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
-- Login do portal do cliente final (Milestone 4) — opcional; NULL até o admin setar credenciais.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS password_hash TEXT;

CREATE TABLE IF NOT EXISTS sensors (
  id SERIAL PRIMARY KEY,
  client_id INT REFERENCES clients(id),    -- NULL = não reivindicado (auto-provisionado)
  name TEXT NOT NULL,                      -- default: 'novo-' || mac
  mac TEXT UNIQUE NOT NULL,                -- identidade física do device
  device_token TEXT UNIQUE NOT NULL,       -- auth do device (emitido no provision)
  temp_min NUMERIC, temp_max NUMERIC,      -- limites de alerta
  hum_min NUMERIC, hum_max NUMERIC,        -- opcionais
  interval_seconds INT NOT NULL DEFAULT 60,
  offline_after_seconds INT NOT NULL DEFAULT 300,
  target_firmware TEXT,                    -- versão OTA desejada (NULL = não atualizar)
  last_seen_at TIMESTAMPTZ,
  last_firmware TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
-- Texto livre (ex. "câmara fria 2", "sala do servidor") — disponível como {{$local}} nas mensagens.
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS local TEXT;
-- Ajuste fixo somado à leitura crua na ingestão, pra compensar erro sistemático do sensor
-- físico — calculado pelo wizard de calibragem (painel > Sensores), não editado à mão.
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS temp_offset NUMERIC NOT NULL DEFAULT 0;
-- Último reset_reason já notificado (ver ingest.ts) — evita reenviar o alerta de reboot a
-- cada ingest, já que o motivo fica constante durante todo o boot atual do device.
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS last_reset_reason TEXT;
-- Variante de firmware reportada no ingest ('inv' | 'noinv') — distingue as duas revisões
-- de tela CYD (ver firmware/platformio.ini), mostrado no card e na tela de info do device.
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS last_variant TEXT;
-- Agendamento do teste automático deste sensor (dow '0'-'6', time 'HH:MM'); NULL = usa o
-- padrão global em app_settings (test_schedule_dow/test_schedule_time).
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS test_schedule_dow TEXT;
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS test_schedule_time TEXT;
-- Força o reenvio do OTA no próximo ingest mesmo se target_firmware == last_firmware (ex.
-- reverter pra uma versão já instalada antes). Consumido uma vez só (ver ingest.ts).
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS force_ota BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,                     -- E.164
  alert_temperature BOOLEAN NOT NULL DEFAULT true,
  alert_connectivity BOOLEAN NOT NULL DEFAULT true,
  channel_voice BOOLEAN NOT NULL DEFAULT true,
  channel_whatsapp BOOLEAN NOT NULL DEFAULT true,
  renotify_minutes INT NOT NULL DEFAULT 60,          -- re-alerta por whatsapp enquanto firing; 0 = só o disparo inicial
  days_of_week INT[] NOT NULL DEFAULT '{1,2,3,4,5}', -- 0=dom..6=sab
  window_start TIME NOT NULL DEFAULT '07:00',
  window_end TIME NOT NULL DEFAULT '18:00',
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  created_at TIMESTAMPTZ DEFAULT now()
);
-- Liga/desliga geral do contato (independente das prefs por tipo abaixo).
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

-- Config independente por tipo de alerta (dias/horário/re-alerta e liga/desliga próprios),
-- substituindo os campos únicos e compartilhados de `contacts` (que ficam pra trás, sem uso
-- no código novo, mas não removidos — sem ferramenta de migração pra isso com segurança).
-- window_start/end NULL = sem restrição de horário (notifica a qualquer hora).
CREATE TABLE IF NOT EXISTS contact_alert_prefs (
  contact_id INT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('temperature', 'humidity', 'connectivity')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  days_of_week INT[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',
  window_start TIME,
  window_end TIME,
  renotify_minutes INT NOT NULL DEFAULT 60,
  PRIMARY KEY (contact_id, alert_type)
);

-- Backfill idempotente: contato existente ganha as 3 prefs a partir da config antiga
-- compartilhada, uma vez só (ON CONFLICT DO NOTHING não repete em boots seguintes).
INSERT INTO contact_alert_prefs (contact_id, alert_type, enabled, days_of_week, window_start, window_end, renotify_minutes)
  SELECT id, 'temperature', alert_temperature, days_of_week, window_start, window_end, renotify_minutes FROM contacts
  ON CONFLICT (contact_id, alert_type) DO NOTHING;
INSERT INTO contact_alert_prefs (contact_id, alert_type, enabled, days_of_week, window_start, window_end, renotify_minutes)
  SELECT id, 'humidity', alert_temperature, days_of_week, window_start, window_end, renotify_minutes FROM contacts
  ON CONFLICT (contact_id, alert_type) DO NOTHING;
INSERT INTO contact_alert_prefs (contact_id, alert_type, enabled, days_of_week, window_start, window_end, renotify_minutes)
  SELECT id, 'connectivity', alert_connectivity, days_of_week, window_start, window_end, renotify_minutes FROM contacts
  ON CONFLICT (contact_id, alert_type) DO NOTHING;

-- Tipos aceitos, DEFINIÇÃO ÚNICA no arquivo: este SQL roda inteiro a cada boot, então um segundo
-- DROP/ADD com o mesmo nome e uma lista menor derruba o server assim que existir uma linha do tipo
-- mais novo (foi o crash loop "is violated by some row" ao adicionar 'daily'). Tipo novo = editar
-- a lista abaixo, nunca acrescentar outro ADD CONSTRAINT.
--   'test'  = pref dedicada do botão "Testar canal" (cadastro do contato) e do teste agendado do
--             sensor — antes o botão ignorava liga/desliga e janela de horário por completo.
--   'daily' = mensagem diária de "está tudo bem com a climatização". Aqui window_start é o HORÁRIO
--             DO ENVIO (não o início de uma janela) e window_end/renotify_minutes não são usados —
--             ver isDailySendTime em services/scheduleWindow.ts.
-- NOT VALID: a constraint vale pra toda escrita nova, mas o Postgres não varre as linhas que já
-- estão lá. Sem isso, UMA linha legada com tipo desconhecido derruba o migrate() e o servidor
-- inteiro não sobe — e o app não sobe justamente pra deixar alguém consertar a linha. Linha de
-- tipo desconhecido é inerte (todo caminho de leitura filtra pelos tipos acima), então tolerá-la
-- é mais barato que um boot em crash loop.
ALTER TABLE contact_alert_prefs DROP CONSTRAINT IF EXISTS contact_alert_prefs_alert_type_check;
ALTER TABLE contact_alert_prefs ADD CONSTRAINT contact_alert_prefs_alert_type_check
  CHECK (alert_type IN ('temperature', 'humidity', 'connectivity', 'test', 'daily')) NOT VALID;

INSERT INTO contact_alert_prefs (contact_id, alert_type)
  SELECT id, 'test' FROM contacts
  ON CONFLICT (contact_id, alert_type) DO NOTHING;

-- A diária nasce desligada: ligar a rotina pra toda a base instalada sem o admin pedir seria
-- disparar WhatsApp diário pra todo contato já cadastrado.
INSERT INTO contact_alert_prefs (contact_id, alert_type, enabled, days_of_week, window_start)
  SELECT id, 'daily', false, '{1,2,3,4,5}', '08:00' FROM contacts
  ON CONFLICT (contact_id, alert_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS alerts (
  id SERIAL PRIMARY KEY,
  sensor_id INT NOT NULL REFERENCES sensors(id),
  type TEXT NOT NULL CHECK (type IN ('temperature','humidity','connectivity','test')),
  state TEXT NOT NULL CHECK (state IN ('firing','resolved')),
  value NUMERIC, message TEXT NOT NULL,
  fired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
-- 'reboot' = evento pontual de reinício fora do normal (watchdog/panic/brownout/self-heal),
-- reportado pelo device no 1º ingest pós-boot. Sem estado firing real (sempre nasce resolved,
-- via createResolvedAlert) — é só um pendurador de notification, igual 'test'.
-- 'hardware' = device vivo (heartbeat chegando) mas sem leitura válida: DHT travado/desconectado.
-- Distinto de 'connectivity', que é ausência de ingest. Sem esse tipo, sensor com DHT morto era
-- rotulado "offline" e o alerta mandava a equipe caçar problema de rede que não existia.
ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_type_check;
-- 'daily' = mensagem diária de "está tudo bem" (sem estado firing real, igual 'test'/'reboot':
-- nasce resolved via createResolvedAlert, só pra pendurar a notification e deixar rastro).
ALTER TABLE alerts ADD CONSTRAINT alerts_type_check CHECK (type IN ('temperature','humidity','connectivity','test','reboot','firmware','hardware','daily'));
-- dedup no banco: só 1 alerta firing por sensor+tipo
CREATE UNIQUE INDEX IF NOT EXISTS alerts_one_firing ON alerts (sensor_id, type) WHERE state = 'firing';

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  alert_id INT NOT NULL REFERENCES alerts(id),
  contact_id INT REFERENCES contacts(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,                   -- 'voice' | 'whatsapp'
  status TEXT NOT NULL DEFAULT 'queued',   -- queued|sent|failed|skipped_window|skipped_pref|skipped_channel|skipped_no_voice_text|skipped_no_admin|skipped_alert_firing|skipped_already_sent
  detail TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
-- Alerta de hardware (Task: telefone de admin) vai pra um admin (users), não pra um contato
-- de cliente — contact_id vira opcional e admin_id é o outro lado dessa notification.
ALTER TABLE notifications ALTER COLUMN contact_id DROP NOT NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS admin_id INT REFERENCES users(id);
-- Regressão de produção: excluir um contato com histórico de notificações (welcome/test/alerta)
-- batia em "violates foreign key constraint notifications_contact_id_fkey" porque a FK não tinha
-- ON DELETE. contact_id já é opcional (linha acima) — SET NULL mantém o histórico e libera o DELETE.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_contact_id_fkey;
ALTER TABLE notifications ADD CONSTRAINT notifications_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS firmware (
  id SERIAL PRIMARY KEY,
  version TEXT UNIQUE NOT NULL,            -- semver "1.2.0"
  filename TEXT NOT NULL,                  -- caminho em server/firmware-bin/
  sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL              -- bcrypt; admin only no MVP
);
-- Telefone opcional (E.164) — só admins com phone preenchido recebem alerta de hardware
-- (sensor sem leitura/travado), disparado por evaluateConnectivity em alertService.ts.
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;

-- Textos de alerta configuráveis pelo painel (Mensagens) — {{$var}} substituído em runtime.
-- voice só é usado em temperature_fire (ligação é exclusiva de alerta de temperatura).
CREATE TABLE IF NOT EXISTS message_templates (
  key TEXT PRIMARY KEY,
  whatsapp TEXT NOT NULL,
  voice TEXT
);

-- Configurações globais chave-valor (ex. agendamento do teste automático).
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
