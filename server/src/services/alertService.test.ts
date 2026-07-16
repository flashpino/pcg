import { describe, expect, it } from 'vitest';
import { decideBinaryTransition, decideTransition, isBackInBounds, shouldRenotify, violatedBound } from './alertService.js';

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
