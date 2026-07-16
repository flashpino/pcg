#pragma once
#include "net.h"
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

// UI (LVGL + TFT_eSPI + touch) — roda no core 1 (loop principal). Nunca chamada pela task
// de rede (net.cpp); só consome net::Event lido de uiEventQueue.
namespace ui {

void begin(QueueHandle_t netEventQueue);

// Chamado a cada volta do loop(): lv_timer_handler() + drena o evento de rede mais recente.
void tick();

// Chamado por main.cpp quando um net::Event novo chega na fila.
void onNetEvent(const net::Event& evt);

}  // namespace ui
