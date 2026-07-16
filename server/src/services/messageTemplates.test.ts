import { describe, expect, it } from 'vitest';
import { renderTemplate } from './messageTemplates.js';

describe('renderTemplate', () => {
  it('substitui variáveis conhecidas', () => {
    expect(renderTemplate('A temp atual é {{$temperatura}}', { temperatura: 25.5 })).toBe('A temp atual é 25.5');
  });

  it('variável ausente vira string vazia, sem quebrar', () => {
    expect(renderTemplate('{{$sensor}}: {{$foo}}', { sensor: 'S1' })).toBe('S1: ');
  });

  it('texto sem variáveis passa direto', () => {
    expect(renderTemplate('texto fixo', {})).toBe('texto fixo');
  });

  it('mesma variável repetida é substituída em todas as ocorrências', () => {
    expect(renderTemplate('{{$sensor}} e {{$sensor}}', { sensor: 'S1' })).toBe('S1 e S1');
  });

  it('aceita a variável sem o $ também', () => {
    expect(renderTemplate('{{cliente}}', { cliente: 'Acme' })).toBe('Acme');
  });
});
