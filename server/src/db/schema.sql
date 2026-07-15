-- Migração idempotente: executada inteira a cada boot (tudo IF NOT EXISTS).
-- ponytail: sem ferramenta de migração — adicionar node-pg-migrate quando o schema mudar em produção.

CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

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
  target_firmware TEXT,                    -- versão OTA desejada (NULL = latest)
  last_seen_at TIMESTAMPTZ,
  last_firmware TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

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

CREATE TABLE IF NOT EXISTS alerts (
  id SERIAL PRIMARY KEY,
  sensor_id INT NOT NULL REFERENCES sensors(id),
  type TEXT NOT NULL CHECK (type IN ('temperature','humidity','connectivity','test')),
  state TEXT NOT NULL CHECK (state IN ('firing','resolved')),
  value NUMERIC, message TEXT NOT NULL,
  fired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
-- dedup no banco: só 1 alerta firing por sensor+tipo
CREATE UNIQUE INDEX IF NOT EXISTS alerts_one_firing ON alerts (sensor_id, type) WHERE state = 'firing';

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  alert_id INT NOT NULL REFERENCES alerts(id),
  contact_id INT NOT NULL REFERENCES contacts(id),
  channel TEXT NOT NULL,                   -- 'voice' | 'whatsapp'
  status TEXT NOT NULL DEFAULT 'queued',   -- queued|sent|failed|skipped_window|skipped_pref
  detail TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

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
