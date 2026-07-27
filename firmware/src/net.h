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

// A UI (core 1) chama com true antes de WiFi.scanNetworks() e false depois — sem isso a
// task de rede (core 0) chama WiFi.begin() no ciclo seguinte com a credencial salva e
// briga pelo rádio bem no meio do scan (WIFI_SCAN_FAILED ou 0 redes encontradas).
void pauseForScan(bool pause);

// Resultado do teste disparado pela UI (core 1) e executado pela task de rede (core 0).
enum class TestState : uint8_t { IDLE, PENDING, SENT, FAILED };

// A UI chama para pedir um envio de teste (thread-safe, só seta um flag).
void requestDeviceTest();

// A UI faz poll do resultado; ao ler SENT/FAILED, o estado volta a IDLE (consumido).
TestState consumeTestResult();

// A UI (core 1) faz poll pra mostrar "atualizando firmware..." na tela enquanto o OTA
// roda (bloqueia a task de rede inteira — sem evento de fila pra isso, só um flag).
bool isOtaUpdating();

}  // namespace net
