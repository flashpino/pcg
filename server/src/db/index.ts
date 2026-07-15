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
