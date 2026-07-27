import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import pg from 'pg';

// node-postgres devolve NUMERIC (temp_min/max, hum_min/max, alerts.value) como STRING por
// padrão, pra não arriscar perda de precisão — mas isso quebra aritmética (ex. "15" + 0.5 vira
// "150.5" por concatenação, não 15.5). OID 1700 = numeric. Corrige globalmente, pro app inteiro.
pg.types.setTypeParser(1700, (val) => parseFloat(val));

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
  hardware_fire: {
    whatsapp: '⚠️ Alerta de hardware: sensor {{$sensor}} ({{$cliente}} / {{$local}}) sem leitura válida há mais de {{$segundos}}s. Verifique o dispositivo.',
  },
  hardware_resolve: { whatsapp: 'Sensor {{$sensor}} ({{$cliente}} / {{$local}}) voltou a reportar normalmente.' },
  reboot_fire: {
    whatsapp: '🔄 Sensor {{$sensor}} ({{$cliente}} / {{$local}}) reiniciou sozinho em {{$quando}}. Motivo: {{$motivo}}.',
  },
  firmware_update: {
    whatsapp: '✅ Sensor {{$sensor}} ({{$cliente}} / {{$local}}) atualizou o firmware: {{$de}} → {{$para}}.',
  },
  welcome: { whatsapp: 'Olá {{$nome}}! Você foi cadastrado no monitoramento PCG.' },
  // Voz igual à de temperature_fire — o teste manual (botão "Testar canal") precisa validar a
  // ligação de voz do contato do mesmo jeito que o alerta real faz, não só o WhatsApp.
  test: {
    whatsapp: 'Teste PCG — {{$sensor}} ({{$local}}): temperatura atual {{$temperatura}}°C ({{$quando}}).',
    voice: 'Atenção. A temperatura de {{$sensor}} está fora do limite. Valor atual: {{$temperatura}} graus.',
  },
  // Enviado por WhatsApp antes de qualquer teste (sensor ou contato) — avisa quem está inscrito
  // pra receber teste que a ligação que vem a seguir não é uma emergência real.
  test_warning: {
    whatsapp:
      '📢 Informamos que será realizado um *teste periódico do sistema de monitoramento de temperatura*.\n\nDurante o teste, você poderá receber uma *ligação telefônica automática* referente ao disparo de alerta. *Não é uma situação de emergência*; trata-se apenas de um teste para verificar o funcionamento do sistema de monitoramento e comunicação.\n\nAgradecemos pela compreensão.',
  },
};

// Idempotente (ON CONFLICT DO NOTHING) — não sobrescreve customização já salva pelo admin.
export async function seedMessageTemplates(): Promise<void> {
  for (const [key, t] of Object.entries(DEFAULT_MESSAGE_TEMPLATES)) {
    await pool.query(
      'INSERT INTO message_templates (key, whatsapp, voice) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING',
      [key, t.whatsapp, t.voice ?? null],
    );
  }
  // Backfill: instalações que já tinham a linha 'test' sem voz (antes desta ligação de teste
  // existir) ganham o texto padrão agora — só se o admin não tiver customizado (voice ainda NULL).
  await pool.query("UPDATE message_templates SET voice = $1 WHERE key = 'test' AND voice IS NULL", [
    DEFAULT_MESSAGE_TEMPLATES.test.voice,
  ]);
  // Backfill do texto de test_warning: só troca se ainda for exatamente o texto antigo (menção a
  // "CPD"), pra não sobrescrever customização feita pelo admin em Painel > Mensagens.
  await pool.query("UPDATE message_templates SET whatsapp = $1 WHERE key = 'test_warning' AND whatsapp LIKE '%CPD%'", [
    DEFAULT_MESSAGE_TEMPLATES.test_warning.whatsapp,
  ]);
}

// Defaults do agendamento do teste automático — idempotente, não sobrescreve o que o admin salvou.
export async function seedSettings(): Promise<void> {
  const defaults: Record<string, string> = { test_schedule_dow: '1', test_schedule_time: '09:00' };
  for (const [key, value] of Object.entries(defaults)) {
    await pool.query(
      'INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
      [key, value],
    );
  }
}
