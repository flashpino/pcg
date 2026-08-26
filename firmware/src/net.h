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

// --- Breadcrumb de crash -------------------------------------------------------------------
// O device reinicia sozinho varias vezes por dia (INT_WDT/TASK_WDT) e esp_reset_reason() so diz
// QUE travou, nunca ONDE: o backtrace do panic morre no serial e nao ha USB no cliente. Cada
// trecho bloqueante marca em que estava; o valor sobrevive ao reset (RTC RAM) e volta no
// primeiro ingest do boot seguinte, dentro de `diag`.
enum class Stage : uint8_t { IDLE, DHT, WIFI, INGEST, PROVISION, OTA, TEST, UI_TICK, UI_SCAN };
void mark(Stage s);    // task de rede (core 0)
void markUi(Stage s);  // UI (core 1)

}  // namespace net
