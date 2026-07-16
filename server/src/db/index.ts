import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import pg from 'pg';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Migração idempotente: executa schema.sql (tudo IF NOT EXISTS) a cada boot.
export async function migrate(): Promise<void> {
  const sql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  await pool.query(sql);
}

// Seed do admin no primeiro boot: ON CONFLICT DO NOTHING, então trocar ADMIN_PASSWORD
// depois exige update manual no banco (fora de escopo do MVP single-admin).
export async function seedAdmin(email: string, password: string): Promise<void> {
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    'INSERT INTO users (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING',
    [email, hash],
  );
}

// Texto padrão (idêntico ao que era hardcoded no alertService antes deste template). Renotify
// de temperatura/umidade reusa o texto de _fire (mesmo comportamento de antes); conectividade
// tem os 3 (fire/resolve/renotify) por terem textos distintos entre si.
const DEFAULT_MESSAGE_TEMPLATES: Record<string, { whatsapp: string; voice?: string }> = {
  temperature_fire: {
    whatsapp: 'Temperatura de {{$sensor}} fora do limite: {{$temperatura}}°C (min {{$min}} / max {{$max}})',
    voice: 'Atenção. A temperatura de {{$sensor}} está fora do limite. Valor atual: {{$temperatura}} graus.',
  },
  temperature_resolve: { whatsapp: 'Temperatura de {{$sensor}} voltou ao normal.' },
  humidity_fire: { whatsapp: 'Umidade de {{$sensor}} fora do limite: {{$umidade}}% (min {{$min}} / max {{$max}})' },
  humidity_resolve: { whatsapp: 'Umidade de {{$sensor}} voltou ao normal.' },
  connectivity_fire: { whatsapp: 'Sensor {{$sensor}} sem comunicação há mais de {{$segundos}}s.' },
  connectivity_resolve: { whatsapp: 'Sensor {{$sensor}} voltou a reportar.' },
  connectivity_renotify: { whatsapp: 'Sensor {{$sensor}} continua sem comunicação.' },
};

// Idempotente (ON CONFLICT DO NOTHING) — não sobrescreve customização já salva pelo admin.
export async function seedMessageTemplates(): Promise<void> {
  for (const [key, t] of Object.entries(DEFAULT_MESSAGE_TEMPLATES)) {
    await pool.query(
      'INSERT INTO message_templates (key, whatsapp, voice) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING',
      [key, t.whatsapp, t.voice ?? null],
    );
  }
}
