import { describe, expect, it } from 'vitest';
import { spNow, voiceTwiml } from './notifier.js';

describe('voiceTwiml', () => {
  it('põe pausa entre as frases do alerta', () => {
    const twiml = voiceTwiml('Atenção. A temperatura de Câmara 1 está fora do limite.');
    expect(twiml).toContain('Atenção.<break time="500ms"/>A temperatura de Câmara 1 está fora do limite.');
  });

  it('fala um pouco mais devagar', () => {
    expect(voiceTwiml('Teste.')).toContain('<prosody rate="92%">Teste.</prosody>');
  });

  it('não quebra em ponto decimal', () => {
    expect(voiceTwiml('Valor atual: 23.5 graus.')).not.toContain('23.5<break');
  });

  it('não manda SSML para voz Chirp3-HD, que não entende as tags', () => {
    const twiml = voiceTwiml('Atenção. Teste.', 'Google.pt-BR-Chirp3-HD-Aoede');
    expect(twiml).not.toContain('<break');
    expect(twiml).not.toContain('<prosody');
    expect(twiml).toContain('>Atenção. Teste.</Say>');
  });

  it('escapa o texto do template — admin não injeta TwiML pelo painel', () => {
    const twiml = voiceTwiml('Sensor <b>A</b> & B.');
    expect(twiml).toContain('Sensor &lt;b&gt;A&lt;/b&gt; &amp; B.');
  });
});

describe('spNow', () => {
  it('segunda 09:00 em São Paulo (UTC-3, sem horário de verão desde 2019)', () => {
    // 2026-01-05 12:00 UTC = 2026-01-05 09:00 -03:00 (segunda-feira)
    expect(spNow(new Date('2026-01-05T12:00:00Z'))).toEqual({ dow: '1', time: '09:00' });
  });

  it('vira o dia da semana ao cruzar meia-noite em São Paulo', () => {
    // 2026-01-05 02:30 UTC = 2026-01-04 23:30 -03:00 (domingo, dia anterior)
    expect(spNow(new Date('2026-01-05T02:30:00Z'))).toEqual({ dow: '0', time: '23:30' });
  });

  it('meia-noite exata em São Paulo', () => {
    // 2026-01-05 03:00 UTC = 2026-01-05 00:00 -03:00 (segunda-feira)
    expect(spNow(new Date('2026-01-05T03:00:00Z'))).toEqual({ dow: '1', time: '00:00' });
  });
});
