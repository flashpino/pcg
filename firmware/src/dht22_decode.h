#pragma once

#include <math.h>
#include <stdint.h>

// Decodificação pura do quadro do DHT22 (AM2302), separada da captura de propósito: é a única
// parte com lógica de verdade (ordem dos bits, checksum, sinal, escala) e assim dá pra conferir
// sem hardware. O protocolo codifica cada bit na duração do nível ALTO — ~27µs = 0, ~70µs = 1 —
// sempre precedido de ~50µs em nível baixo, que por isso não carrega informação nenhuma.
struct Dht22Sample {
  float temp;
  float hum;
  bool ok;
};

// Usa os ÚLTIMOS 40 pulsos altos, não os primeiros: antes dos dados vêm o eco do nosso próprio
// release da linha e os ~80µs de resposta do sensor, e quantos deles a captura pega varia de
// leitura pra leitura. Os 40 finais são sempre os dados.
inline Dht22Sample decodeDht22(const uint16_t* highs, int count) {
  if (count < 40) return {0.0f, 0.0f, false};
  const uint16_t* bits = highs + (count - 40);

  uint8_t data[5] = {0, 0, 0, 0, 0};
  for (int i = 0; i < 40; i++) {
    data[i / 8] = static_cast<uint8_t>((data[i / 8] << 1) | (bits[i] > 45 ? 1 : 0));
  }
  if (data[4] != static_cast<uint8_t>(data[0] + data[1] + data[2] + data[3])) {
    return {0.0f, 0.0f, false};
  }

  float hum = static_cast<float>((data[0] << 8) | data[1]) / 10.0f;
  float temp = static_cast<float>(((data[2] & 0x7F) << 8) | data[3]) / 10.0f;
  if (data[2] & 0x80) temp = -temp;  // câmara fria opera abaixo de zero: sinal é caminho quente aqui
  if (hum < 0.0f || hum > 100.0f || temp < -40.0f || temp > 80.0f) return {0.0f, 0.0f, false};
  return {temp, hum, true};
}

// Autoteste de boot: monta dois quadros conhecidos (um acima e um abaixo de zero) e confere o
// que o decodificador devolve. É a verificação automática possível aqui — não há compilador de
// host pra um teste nativo, e gnu++11 não aceita laço em constexpr/static_assert.
inline bool dht22SelfTest() {
  struct Local {
    static bool check(uint8_t b0, uint8_t b1, uint8_t b2, uint8_t b3, float wantTemp, float wantHum) {
      const uint8_t bytes[5] = {b0, b1, b2, b3, static_cast<uint8_t>(b0 + b1 + b2 + b3)};
      uint16_t highs[40];
      for (int i = 0; i < 40; i++) highs[i] = ((bytes[i / 8] >> (7 - i % 8)) & 1) ? 70 : 27;
      Dht22Sample s = decodeDht22(highs, 40);
      return s.ok && fabsf(s.temp - wantTemp) < 0.05f && fabsf(s.hum - wantHum) < 0.05f;
    }
  };
  return Local::check(0x02, 0x37, 0x00, 0xEA, 23.4f, 56.7f) &&
         Local::check(0x02, 0x37, 0x80, 0x69, -10.5f, 56.7f);
}
