#include <Arduino.h>
#include <WiFi.h>
#include <esp_task_wdt.h>
#include "esp_bt.h"

#include "net.h"
#include "zabbix_snmp.h"
#include "storage.h"
#include "ui.h"

// Watchdog de 30s sempre armado — robustez em local remoto de difícil acesso (requisito
// explícito do plano). Alimentado pela task de rede (net.cpp) e por este loop.
static const uint32_t WDT_TIMEOUT_S = 30;

static QueueHandle_t uiEventQueue;

void setup() {
  // GOTCHA achado comparando com o firmware antigo (que via as redes normalmente na mesma
  // placa): sem isso, o controlador BT do ESP32 fica de pé disputando o mesmo rádio
  // 2.4GHz do WiFi, mesmo sem nenhuma lib de BT em uso — scanNetworks() completa mas
  // sempre retorna 0 redes. Precisa ser a primeiríssima coisa no boot.
  esp_bt_controller_disable();
  esp_bt_mem_release(ESP_BT_MODE_BTDM);

  Serial.begin(115200);

  esp_task_wdt_init(WDT_TIMEOUT_S, true);
  esp_task_wdt_add(NULL);  // task do loop() (core 1)

  storage::begin();

  // Fila de tamanho 1 com overwrite: só o estado mais recente da rede importa pra UI —
  // não faz sentido enfileirar histórico de status de conexão.
  uiEventQueue = xQueueCreate(1, sizeof(net::Event));
  // WiFi.mode() sobe a pilha lwIP (tcpip_task) de forma síncrona. Sem isso, o
  // snmp_agent::begin() abaixo (WiFiUDP::begin) roda antes da pilha de rede existir —
  // crash fatal confirmado em bancada: "assert failed: tcpip_send_msg_wait_sem ...
  // Invalid mbox", reset em loop, tela nunca chega a acender. net::begin() só cria a
  // task de rede (roda em paralelo, no core 0) — não dá pra contar com ela já ter
  // rodado WiFi.begin() nesse ponto.
  WiFi.mode(WIFI_STA);

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
