import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

// schema.sql roda INTEIRO a cada boot, então cada statement precisa ser idempotente sozinho.
describe('schema.sql', () => {
  // Regressão de produção: o server entrou em crash loop com
  // "check constraint contact_alert_prefs_alert_type_check is violated by some row".
  // O arquivo tinha DOIS blocos DROP/ADD da mesma constraint — o antigo (sem 'daily') rodava
  // primeiro e, a partir do segundo boot, rejeitava as linhas 'daily' criadas pelo bloco novo.
  // Constraint alterada = editar a definição existente, nunca acrescentar outro ADD com o mesmo nome.
  it('não define a mesma constraint duas vezes', () => {
    const names = [...sql.matchAll(/ADD\s+CONSTRAINT\s+(\w+)/gi)].map((m) => m[1]);
    const duplicadas = names.filter((n, i) => names.indexOf(n) !== i);
    expect(duplicadas).toEqual([]);
  });

  // O INSERT de backfill de um tipo só é válido se a constraint em vigor já aceitar aquele tipo.
  it('a constraint de contact_alert_prefs aceita todos os tipos que o schema insere', () => {
    const check = sql.match(/ADD\s+CONSTRAINT\s+contact_alert_prefs_alert_type_check\s+CHECK\s*\([^)]*\)/i)?.[0] ?? '';
    const inseridos = [...sql.matchAll(/SELECT\s+id,\s*'(\w+)'[\s,]/gi)].map((m) => m[1]);
    expect(inseridos.length).toBeGreaterThan(0);
    for (const tipo of inseridos) expect(check).toContain(`'${tipo}'`);
  });
});
