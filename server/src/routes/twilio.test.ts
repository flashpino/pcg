import { describe, expect, it } from 'vitest';
import { answeredByLabel } from './twilio.js';

// Regressão: CallStatus 'completed' só diz que a ligação terminou — celular não atendido cai na
// caixa postal da operadora, que ATENDE, e o painel mostrava "atendeu". Quem sabe se foi gente
// ou secretária é o AMD da Twilio (AnsweredBy), que só chega no asyncAmdStatusCallback.
describe('answeredByLabel', () => {
  it('human = atendida por uma pessoa', () => {
    expect(answeredByLabel('human')).toBe('atendida por pessoa');
  });

  it('machine_start = caixa postal, não atendimento', () => {
    expect(answeredByLabel('machine_start')).toBe('caixa postal/secretária');
  });

  // DetectMessageEnd devolve as variantes machine_end_*; todas são secretária, não pessoa.
  it('variantes machine_end_* também são caixa postal', () => {
    expect(answeredByLabel('machine_end_beep')).toBe('caixa postal/secretária');
    expect(answeredByLabel('machine_end_silence')).toBe('caixa postal/secretária');
    expect(answeredByLabel('machine_end_other')).toBe('caixa postal/secretária');
  });

  it('fax e unknown ficam explícitos em vez de virar "atendeu"', () => {
    expect(answeredByLabel('fax')).toBe('fax');
    expect(answeredByLabel('unknown')).toBe('não identificado');
  });

  // Sem AMD no callback não há o que registrar — não inventa resultado.
  it('ausente vira null', () => {
    expect(answeredByLabel(undefined)).toBeNull();
    expect(answeredByLabel('')).toBeNull();
  });
});
