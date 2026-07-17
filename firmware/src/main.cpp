#include <Arduino.h>
#include <esp_task_wdt.h>

#include "net.h"
#include "zabbix_snmp.h"
#include "storage.h"
#include "ui.h"

// Watchdog de 30s sempre armado — robustez em local remoto de difícil acesso (requisito
// explícito do plano). Alimentado pela task de rede (net.cpp) e por este loop.
static const uint32_t WDT_TIMEOUT_S = 30;

static QueueHandle_t uiEventQueue;

void setup() {
  Serial.begin(115200);

  esp_task_wdt_init(WDT_TIMEOUT_S, true);
  esp_task_wdt_add(NULL);  // task do loop() (core 1)

  storage::begin();

  // Fila de tamanho 1 com overwrite: só o estado mais recente da rede importa pra UI —
  // não faz sentido enfileirar histórico de status de conexão.
  uiEventQueue = xQueueCreate(1, sizeof(net::Event));
  net::begin(uiEventQueue);

  snmp_agent::begin();

  // LVGL/TFT_eSPI/touch — sempre no core 1 (este core), nunca tocado pela task de rede.
  ui::begin(uiEventQueue);
}

void loop() {
  esp_task_wdt_reset();

  net::Event evt;
  if (xQueuePeek(uiEventQueue, &evt, 0) == pdTRUE) {
    ui::onNetEvent(evt);
    snmp_agent::update(evt, millis() / 1000);
  }
  snmp_agent::loop();
  ui::tick();

  delay(5);  // ~200Hz — LVGL recomenda lv_timer_handler a cada poucos ms
}
