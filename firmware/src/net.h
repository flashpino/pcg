#pragma once
#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

// Task de rede (core 0) — nunca toca em widgets LVGL diretamente. Publica NetEvent na fila
// pra Task 13 (UI, core 1) consumir. NetEvent cabe por valor na fila (sem ponteiros/alocação).
namespace net {

enum class Status : uint8_t {
  CONNECTING,
  ONLINE,
  OFFLINE,
  PROVISIONING,
  PROVISION_FAILED,
};

struct Event {
  Status status;
  bool hasReading;
  bool sensorStale;  // DHT22 sem leitura válida há várias tentativas seguidas (travado)
  float temp;
  float hum;
  int16_t rssi;
};

// Cria a task de rede pinada no core 0. uiQueue recebe Event a cada ciclo (não bloqueante —
// se a fila estiver cheia, o evento mais antigo é descartado, a UI não pode travar a rede).
void begin(QueueHandle_t uiQueue);

}  // namespace net
