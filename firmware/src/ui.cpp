#include "ui.h"
#include "config.h"
#include "net.h"
#include "storage.h"

#include <SPI.h>
#include <TFT_eSPI.h>
#include <WiFi.h>
#include <XPT2046_Touchscreen.h>
#include <lvgl.h>
#include <string.h>
#include <time.h>

namespace ui {

// --- Display + touch drivers -----------------------------------------------------------------
static TFT_eSPI tft;
static const uint16_t SCREEN_W = 320, SCREEN_H = 240;  // rotation 1 = paisagem

static XPT2046_Touchscreen touchCtrl(XPT2046_CS, XPT2046_IRQ);
static storage::TouchCalibration calib;

static lv_disp_draw_buf_t drawBuf;
static lv_color_t lvBuf[SCREEN_W * 20];

static void dispFlush(lv_disp_drv_t* drv, const lv_area_t* area, lv_color_t* colorP) {
  uint32_t w = area->x2 - area->x1 + 1;
  uint32_t h = area->y2 - area->y1 + 1;
  tft.startWrite();
  tft.setAddrWindow(area->x1, area->y1, w, h);
  tft.pushColors((uint16_t*)&colorP->full, w * h, true);
  tft.endWrite();
  lv_disp_flush_ready(drv);
}

static void touchRead(lv_indev_drv_t* drv, lv_indev_data_t* data) {
  if (touchCtrl.touched()) {
    TS_Point p = touchCtrl.getPoint();
    // BUG real: os alvos de calibração ficam a 20px da borda (CALIB_TARGETS), não em
    // 0/SCREEN_W — mapear xMin/xMax pra 0/SCREEN_W introduzia um erro de escala
    // sistemático (pior quanto mais longe do centro), explicando o desvio tipo
    // "clico numa tecla e sai a vizinha" relatado em bancada.
    data->point.x = constrain(map(p.x, calib.xMin, calib.xMax, 20, SCREEN_W - 20), 0, SCREEN_W - 1);
    data->point.y = constrain(map(p.y, calib.yMin, calib.yMax, 20, SCREEN_H - 20), 0, SCREEN_H - 1);
    data->state = LV_INDEV_STATE_PRESSED;
  } else {
    data->state = LV_INDEV_STATE_RELEASED;
  }
}

// --- Estado compartilhado das telas ------------------------------------------------------------
static net::Event lastNetEvent{net::Status::CONNECTING, false, 0, 0, 0};
static int dayOfYearAtReset = -1;
static float dayMinTemp = NAN, dayMaxTemp = NAN, dayMinHum = NAN, dayMaxHum = NAN;

static lv_obj_t* scrDashboard;
static lv_obj_t* scrPin;
static lv_obj_t* scrMenu;
static lv_obj_t* scrWifiList;
static lv_obj_t* scrTextInput;
static lv_obj_t* scrIpConfig;
static lv_obj_t* scrNetInfo;
static lv_obj_t* scrCalibration;

// dashboard widgets
static lv_obj_t* statusDot;
static lv_obj_t* clockLabel;
static lv_obj_t* dateLabel;
static lv_obj_t* deviceNameLabel;
static lv_obj_t* rssiLabel;
static lv_obj_t* tempValueLabel;
static lv_obj_t* tempMinMaxLabel;
static lv_obj_t* tempChart;
static lv_chart_series_t* tempSeries;
static lv_obj_t* humValueLabel;
static lv_obj_t* humMinMaxLabel;
static lv_obj_t* humChart;
static lv_chart_series_t* humSeries;

// pin screen
static lv_obj_t* pinDisplay;
static String pinBuffer;
static void (*pinSuccessCb)() = nullptr;

// text input screen (reusado: senha wifi, nome do device, novo pin)
static lv_obj_t* textInputArea;
static lv_obj_t* textInputTitle;
static void (*textInputSubmitCb)(const String&) = nullptr;

// wifi list
static lv_obj_t* wifiListWidget;
static String pendingSsid;
static bool wifiScanInProgress = false;

// calibração
static uint8_t calibStep = 0;
static uint16_t calibRawX[4], calibRawY[4];

// forward decls
static void showDashboard();
static void showMenu();
static void showPin(void (*onSuccess)());
static void showWifiList();
static void showTextInput(const char* title, const char* placeholder, void (*onSubmit)(const String&));
static void showIpConfig();
static void showNetInfo();
static void showCalibration();

// --- Helpers de estilo ---------------------------------------------------------------------
static lv_obj_t* makeBackButton(lv_obj_t* parent, lv_event_cb_t cb) {
  lv_obj_t* btn = lv_btn_create(parent);
  lv_obj_align(btn, LV_ALIGN_TOP_LEFT, 4, 4);
  lv_obj_t* lbl = lv_label_create(btn);
  lv_label_set_text(lbl, LV_SYMBOL_LEFT " voltar");
  lv_obj_add_event_cb(btn, cb, LV_EVENT_CLICKED, nullptr);
  return btn;
}

// --- Dashboard ---------------------------------------------------------------------------------
static void onClockClicked(lv_event_t* e) {
  showPin(showMenu);
}

static void onSignalClicked(lv_event_t* e) {
  showNetInfo();
}

static void buildDashboard() {
  scrDashboard = lv_obj_create(NULL);

  lv_obj_t* header = lv_obj_create(scrDashboard);
  lv_obj_set_size(header, SCREEN_W, 28);
  lv_obj_align(header, LV_ALIGN_TOP_MID, 0, 0);
  lv_obj_set_flex_flow(header, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(header, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

  lv_obj_t* clockGroup = lv_obj_create(header);
  lv_obj_set_size(clockGroup, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(clockGroup, LV_FLEX_FLOW_ROW);
  lv_obj_add_flag(clockGroup, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_add_event_cb(clockGroup, onClockClicked, LV_EVENT_CLICKED, nullptr);

  statusDot = lv_obj_create(clockGroup);
  lv_obj_set_size(statusDot, 10, 10);
  lv_obj_set_style_radius(statusDot, LV_RADIUS_CIRCLE, 0);
  lv_obj_set_style_bg_color(statusDot, lv_palette_main(LV_PALETTE_GREY), 0);

  clockLabel = lv_label_create(clockGroup);
  lv_label_set_text(clockLabel, "--:--");

  dateLabel = lv_label_create(clockGroup);
  lv_label_set_text(dateLabel, "");

  // Escondido a pedido — header só com relógio/status à esquerda e sinal à direita.
  // O label continua existindo (não usado no header) porque a tela de renomear device
  // ainda escreve nele; mantém o ponteiro válido sem precisar mexer nesse outro fluxo.
  deviceNameLabel = lv_label_create(header);
  lv_label_set_text(deviceNameLabel, storage::loadDeviceName().c_str());
  lv_obj_add_flag(deviceNameLabel, LV_OBJ_FLAG_HIDDEN);

  lv_obj_t* signalGroup = lv_obj_create(header);
  lv_obj_set_size(signalGroup, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_add_flag(signalGroup, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_add_event_cb(signalGroup, onSignalClicked, LV_EVENT_CLICKED, nullptr);
  rssiLabel = lv_label_create(signalGroup);
  lv_label_set_text(rssiLabel, LV_SYMBOL_WIFI);

  // dois painéis lado a lado
  lv_obj_t* tempPanel = lv_obj_create(scrDashboard);
  lv_obj_set_size(tempPanel, SCREEN_W / 2 - 2, SCREEN_H - 32);
  lv_obj_align(tempPanel, LV_ALIGN_BOTTOM_LEFT, 0, 0);
  lv_obj_set_style_bg_color(tempPanel, lv_color_hex(0xFFF3E0), 0);

  lv_obj_t* tempLabel = lv_label_create(tempPanel);
  lv_label_set_text(tempLabel, "TEMPERATURA");
  lv_obj_set_style_text_color(tempLabel, lv_color_hex(0xFB8C00), 0);
  lv_obj_align(tempLabel, LV_ALIGN_TOP_MID, 0, 2);

  // ponytail: transform_zoom pra aumentar o número foi tentado e revertido — no LVGL
  // ele amplia o desenho mas não expande a área de recorte/redesenho do widget, e o
  // conteúdo simplesmente sumiu na tela real. 32pt é o maior tamanho de fonte já
  // compilado (Flash em 95%, Task 13) — aumentar de verdade exige habilitar mais um
  // LV_FONT_MONTSERRAT_* no lv_conf.h e checar se ainda cabe no particionamento.
  tempValueLabel = lv_label_create(tempPanel);
  lv_obj_set_style_text_font(tempValueLabel, &lv_font_montserrat_32, 0);
  lv_label_set_text(tempValueLabel, "--.-");
  lv_obj_align(tempValueLabel, LV_ALIGN_TOP_MID, 0, 20);

  tempChart = lv_chart_create(tempPanel);
  lv_obj_set_size(tempChart, SCREEN_W / 2 - 20, 60);
  lv_obj_align(tempChart, LV_ALIGN_CENTER, 0, 10);
  lv_chart_set_type(tempChart, LV_CHART_TYPE_LINE);
  lv_chart_set_point_count(tempChart, 50);
  lv_obj_set_style_size(tempChart, 0, LV_PART_INDICATOR);  // sparkline: sem "bolinhas"
  lv_chart_set_div_line_count(tempChart, 0, 0);            // sem grade — sparkline limpa (referência)
  lv_obj_set_style_border_width(tempChart, 0, 0);
  lv_obj_set_style_bg_opa(tempChart, LV_OPA_TRANSP, 0);
  lv_obj_set_style_pad_all(tempChart, 0, 0);
  tempSeries = lv_chart_add_series(tempChart, lv_color_hex(0xFB8C00), LV_CHART_AXIS_PRIMARY_Y);

  tempMinMaxLabel = lv_label_create(tempPanel);
  lv_label_set_text(tempMinMaxLabel, "max -.- / min -.-");
  lv_obj_align(tempMinMaxLabel, LV_ALIGN_BOTTOM_MID, 0, -4);

  lv_obj_t* humPanel = lv_obj_create(scrDashboard);
  lv_obj_set_size(humPanel, SCREEN_W / 2 - 2, SCREEN_H - 32);
  lv_obj_align(humPanel, LV_ALIGN_BOTTOM_RIGHT, 0, 0);
  lv_obj_set_style_bg_color(humPanel, lv_color_hex(0xE3F2FD), 0);

  lv_obj_t* humLabel = lv_label_create(humPanel);
  lv_label_set_text(humLabel, "UMIDADE");
  lv_obj_set_style_text_color(humLabel, lv_color_hex(0x1E88E5), 0);
  lv_obj_align(humLabel, LV_ALIGN_TOP_MID, 0, 2);

  humValueLabel = lv_label_create(humPanel);
  lv_obj_set_style_text_font(humValueLabel, &lv_font_montserrat_32, 0);
  lv_label_set_text(humValueLabel, "--.-");
  lv_obj_align(humValueLabel, LV_ALIGN_TOP_MID, 0, 20);

  humChart = lv_chart_create(humPanel);
  lv_obj_set_size(humChart, SCREEN_W / 2 - 20, 60);
  lv_obj_align(humChart, LV_ALIGN_CENTER, 0, 10);
  lv_chart_set_type(humChart, LV_CHART_TYPE_LINE);
  lv_chart_set_point_count(humChart, 50);
  lv_obj_set_style_size(humChart, 0, LV_PART_INDICATOR);
  lv_chart_set_div_line_count(humChart, 0, 0);
  lv_obj_set_style_border_width(humChart, 0, 0);
  lv_obj_set_style_bg_opa(humChart, LV_OPA_TRANSP, 0);
  lv_obj_set_style_pad_all(humChart, 0, 0);
  humSeries = lv_chart_add_series(humChart, lv_color_hex(0x1E88E5), LV_CHART_AXIS_PRIMARY_Y);

  humMinMaxLabel = lv_label_create(humPanel);
  lv_label_set_text(humMinMaxLabel, "max -.- / min -.-");
  lv_obj_align(humMinMaxLabel, LV_ALIGN_BOTTOM_MID, 0, -4);
}

static void showDashboard() {
  lv_scr_load(scrDashboard);
}

// Chamado a cada net::Event ONLINE com leitura nova — atualiza valores, sparkline e max/min do dia.
static void updateDashboardReading(float temp, float hum) {
  char buf[16];
  snprintf(buf, sizeof(buf), "%.1f", temp);
  lv_label_set_text(tempValueLabel, buf);
  snprintf(buf, sizeof(buf), "%.0f", hum);
  lv_label_set_text(humValueLabel, buf);

  lv_chart_set_next_value(tempChart, tempSeries, (lv_coord_t)(temp * 10));
  lv_chart_set_next_value(humChart, humSeries, (lv_coord_t)(hum * 10));

  time_t now = time(nullptr);
  struct tm tmNow;
  localtime_r(&now, &tmNow);
  if (tmNow.tm_yday != dayOfYearAtReset) {
    dayOfYearAtReset = tmNow.tm_yday;
    dayMinTemp = dayMaxTemp = temp;
    dayMinHum = dayMaxHum = hum;
  } else {
    dayMinTemp = min(dayMinTemp, temp);
    dayMaxTemp = max(dayMaxTemp, temp);
    dayMinHum = min(dayMinHum, hum);
    dayMaxHum = max(dayMaxHum, hum);
  }

  char minMaxBuf[32];
  snprintf(minMaxBuf, sizeof(minMaxBuf), "max %.1f / min %.1f", dayMaxTemp, dayMinTemp);
  lv_label_set_text(tempMinMaxLabel, minMaxBuf);
  snprintf(minMaxBuf, sizeof(minMaxBuf), "max %.0f%% / min %.0f%%", dayMaxHum, dayMinHum);
  lv_label_set_text(humMinMaxLabel, minMaxBuf);
}

static void updateHeader() {
  time_t now = time(nullptr);
  struct tm tmNow;
  localtime_r(&now, &tmNow);
  char buf[16];
  if (tmNow.tm_year >= 120) {  // NTP sincronizado (ano >= 2020)
    strftime(buf, sizeof(buf), "%H:%M", &tmNow);
    lv_label_set_text(clockLabel, buf);
    static const char* DIAS[] = {"dom", "seg", "ter", "qua", "qui", "sex", "sab"};
    static const char* MESES[] = {"jan", "fev", "mar", "abr", "mai", "jun",
                                   "jul", "ago", "set", "out", "nov", "dez"};
    snprintf(buf, sizeof(buf), "%s %02d %s", DIAS[tmNow.tm_wday], tmNow.tm_mday, MESES[tmNow.tm_mon]);
    lv_label_set_text(dateLabel, buf);
  } else {
    lv_label_set_text(clockLabel, "--:--");
    lv_label_set_text(dateLabel, "");
  }

  bool online = lastNetEvent.status == net::Status::ONLINE;
  lv_obj_set_style_bg_color(statusDot, online ? lv_palette_main(LV_PALETTE_GREEN) : lv_palette_main(LV_PALETTE_GREY), 0);

  // Referência mostra o SSID conectado, não o nome do device — cai pro nome do device
  // (configurável no menu) enquanto não há WiFi, pra não ficar em branco.
  lv_label_set_text(deviceNameLabel,
                     WiFi.status() == WL_CONNECTED ? WiFi.SSID().c_str() : storage::loadDeviceName().c_str());

  char rssiBuf[12];
  snprintf(rssiBuf, sizeof(rssiBuf), "%d dBm", lastNetEvent.rssi);
  lv_label_set_text(rssiLabel, rssiBuf);
}

// --- Tela de PIN -------------------------------------------------------------------------------
static const char* PIN_MAP[] = {"1", "2", "3", "\n", "4", "5", "6", "\n", "7", "8", "9", "\n", "C", "0", LV_SYMBOL_OK, ""};

static void onPinBtn(lv_event_t* e) {
  lv_obj_t* btnm = (lv_obj_t*)lv_event_get_target(e);
  uint16_t id = lv_btnmatrix_get_selected_btn(btnm);
  const char* txt = lv_btnmatrix_get_btn_text(btnm, id);

  if (strcmp(txt, "C") == 0) {
    pinBuffer = "";
  } else if (strcmp(txt, LV_SYMBOL_OK) == 0) {
    if (pinBuffer == storage::loadPin()) {
      pinBuffer = "";
      if (pinSuccessCb) pinSuccessCb();
    } else {
      pinBuffer = "";
      lv_label_set_text(pinDisplay, "PIN errado");
      return;
    }
  } else if (pinBuffer.length() < 8) {
    pinBuffer += txt;
  }

  String masked;
  for (size_t i = 0; i < pinBuffer.length(); i++) masked += "*";
  lv_label_set_text(pinDisplay, masked.length() ? masked.c_str() : "digite o PIN");
}

static void buildPinScreen() {
  scrPin = lv_obj_create(NULL);
  pinDisplay = lv_label_create(scrPin);
  lv_label_set_text(pinDisplay, "digite o PIN");
  lv_obj_align(pinDisplay, LV_ALIGN_TOP_MID, 0, 20);

  lv_obj_t* btnm = lv_btnmatrix_create(scrPin);
  lv_btnmatrix_set_map(btnm, PIN_MAP);
  lv_obj_set_size(btnm, 200, 160);
  lv_obj_align(btnm, LV_ALIGN_BOTTOM_MID, 0, -10);
  lv_obj_add_event_cb(btnm, onPinBtn, LV_EVENT_VALUE_CHANGED, nullptr);
}

static void showPin(void (*onSuccess)()) {
  pinBuffer = "";
  lv_label_set_text(pinDisplay, "digite o PIN");
  pinSuccessCb = onSuccess;
  lv_scr_load(scrPin);
}

// --- Menu de configurações -----------------------------------------------------------------
static void onMenuBack(lv_event_t* e) {
  showDashboard();
}

static void onMenuWifi(lv_event_t* e) {
  showWifiList();
}

static void onMenuDeviceName(lv_event_t* e) {
  showTextInput("Nome do dispositivo", storage::loadDeviceName().c_str(), [](const String& name) {
    storage::saveDeviceName(name);
    lv_label_set_text(deviceNameLabel, name.c_str());
    showMenu();
  });
}

static void onMenuIp(lv_event_t* e) {
  showIpConfig();
}

static void onMenuChangePin(lv_event_t* e) {
  showTextInput("Novo PIN", "", [](const String& pin) {
    if (pin.length() >= 4) storage::savePin(pin);
    showMenu();
  });
}

static void onMenuCalibrate(lv_event_t* e) {
  showCalibration();
}

static void onMenuRestart(lv_event_t* e) {
  ESP.restart();
}

static void buildMenu() {
  scrMenu = lv_obj_create(NULL);
  makeBackButton(scrMenu, onMenuBack);

  lv_obj_t* list = lv_list_create(scrMenu);
  lv_obj_set_size(list, SCREEN_W - 20, SCREEN_H - 40);
  lv_obj_align(list, LV_ALIGN_BOTTOM_MID, 0, -4);

  lv_obj_add_event_cb(lv_list_add_btn(list, LV_SYMBOL_WIFI, "Redes WiFi"), onMenuWifi, LV_EVENT_CLICKED, nullptr);
  lv_obj_add_event_cb(lv_list_add_btn(list, LV_SYMBOL_EDIT, "Nome do dispositivo"), onMenuDeviceName, LV_EVENT_CLICKED, nullptr);
  lv_obj_add_event_cb(lv_list_add_btn(list, LV_SYMBOL_SETTINGS, "Configurar IP"), onMenuIp, LV_EVENT_CLICKED, nullptr);
  lv_obj_add_event_cb(lv_list_add_btn(list, LV_SYMBOL_KEYBOARD, "Trocar PIN"), onMenuChangePin, LV_EVENT_CLICKED, nullptr);
  lv_obj_add_event_cb(lv_list_add_btn(list, LV_SYMBOL_EYE_OPEN, "Calibrar touch"), onMenuCalibrate, LV_EVENT_CLICKED, nullptr);
  lv_obj_add_event_cb(lv_list_add_btn(list, LV_SYMBOL_REFRESH, "Reiniciar"), onMenuRestart, LV_EVENT_CLICKED, nullptr);
}

static void showMenu() {
  lv_scr_load(scrMenu);
}

// --- Scan de WiFi ------------------------------------------------------------------------------
// GOTCHA: WiFi.scanNetworks() bloqueia ~2s — usar scanNetworks(true) (assíncrono) e
// preencher a lista quando o resultado ficar pronto (checado em ui::tick()).
static void onWifiBack(lv_event_t* e) {
  showMenu();
}

static void onWifiNetworkClicked(lv_event_t* e) {
  lv_obj_t* btn = (lv_obj_t*)lv_event_get_target(e);
  const char* ssid = lv_list_get_btn_text(wifiListWidget, btn);
  pendingSsid = ssid;
  showTextInput("Senha WiFi", "", [](const String& password) {
    storage::saveWifiCredentials(pendingSsid, password);
    WiFi.disconnect();
    showDashboard();
  });
}

static void buildWifiListScreen() {
  scrWifiList = lv_obj_create(NULL);
  makeBackButton(scrWifiList, onWifiBack);
  wifiListWidget = lv_list_create(scrWifiList);
  lv_obj_set_size(wifiListWidget, SCREEN_W - 20, SCREEN_H - 40);
  lv_obj_align(wifiListWidget, LV_ALIGN_BOTTOM_MID, 0, -4);
}

static void showWifiList() {
  lv_obj_clean(wifiListWidget);
  lv_list_add_text(wifiListWidget, "escaneando...");
  WiFi.scanNetworks(true);
  wifiScanInProgress = true;
  lv_scr_load(scrWifiList);
}

static void pollWifiScan() {
  if (!wifiScanInProgress) return;
  int16_t n = WiFi.scanComplete();
  if (n == WIFI_SCAN_RUNNING || n == WIFI_SCAN_FAILED) return;

  wifiScanInProgress = false;
  lv_obj_clean(wifiListWidget);
  for (int16_t i = 0; i < n; i++) {
    lv_obj_t* btn = lv_list_add_btn(wifiListWidget, LV_SYMBOL_WIFI, WiFi.SSID(i).c_str());
    lv_obj_add_event_cb(btn, onWifiNetworkClicked, LV_EVENT_CLICKED, nullptr);
  }
  WiFi.scanDelete();
}

// --- Tela de texto genérica (senha wifi / nome / pin) -------------------------------------
static void onTextInputCancel(lv_event_t* e) {
  showMenu();
}

static void onTextInputReady(lv_event_t* e) {
  String value = lv_textarea_get_text(textInputArea);
  if (textInputSubmitCb) textInputSubmitCb(value);
}

static void buildTextInputScreen() {
  scrTextInput = lv_obj_create(NULL);
  textInputTitle = lv_label_create(scrTextInput);
  lv_obj_align(textInputTitle, LV_ALIGN_TOP_MID, 0, 4);

  textInputArea = lv_textarea_create(scrTextInput);
  lv_obj_set_size(textInputArea, SCREEN_W - 20, 30);
  lv_obj_align(textInputArea, LV_ALIGN_TOP_MID, 0, 24);
  lv_textarea_set_one_line(textInputArea, true);

  lv_obj_t* kb = lv_keyboard_create(scrTextInput);
  lv_keyboard_set_textarea(kb, textInputArea);
  lv_obj_add_event_cb(kb, onTextInputReady, LV_EVENT_READY, nullptr);
  lv_obj_add_event_cb(kb, onTextInputCancel, LV_EVENT_CANCEL, nullptr);
}

static void showTextInput(const char* title, const char* placeholder, void (*onSubmit)(const String&)) {
  lv_label_set_text(textInputTitle, title);
  lv_textarea_set_text(textInputArea, placeholder);
  textInputSubmitCb = onSubmit;
  lv_scr_load(scrTextInput);
}

// --- Config de IP --------------------------------------------------------------------------
static lv_obj_t* ipDhcpSwitch;
static lv_obj_t* ipAddrArea;
static lv_obj_t* ipGwArea;
static lv_obj_t* ipMaskArea;
static lv_obj_t* ipDnsArea;

static void onIpBack(lv_event_t* e) {
  showMenu();
}

static void onIpSave(lv_event_t* e) {
  storage::StaticIpConfig cfg;
  cfg.enabled = !lv_obj_has_state(ipDhcpSwitch, LV_STATE_CHECKED);
  if (cfg.enabled) {
    cfg.ip.fromString(lv_textarea_get_text(ipAddrArea));
    cfg.gateway.fromString(lv_textarea_get_text(ipGwArea));
    cfg.subnet.fromString(lv_textarea_get_text(ipMaskArea));
    cfg.dns.fromString(lv_textarea_get_text(ipDnsArea));
  }
  storage::saveStaticIp(cfg);
  showMenu();
}

static lv_obj_t* makeIpField(lv_obj_t* parent, const char* label) {
  lv_obj_t* lbl = lv_label_create(parent);
  lv_label_set_text(lbl, label);
  lv_obj_t* ta = lv_textarea_create(parent);
  lv_obj_set_size(ta, SCREEN_W - 20, 24);
  lv_textarea_set_one_line(ta, true);
  return ta;
}

static void buildIpConfigScreen() {
  scrIpConfig = lv_obj_create(NULL);
  makeBackButton(scrIpConfig, onIpBack);

  ipDhcpSwitch = lv_switch_create(scrIpConfig);
  lv_obj_align(ipDhcpSwitch, LV_ALIGN_TOP_RIGHT, -8, 8);
  lv_obj_add_state(ipDhcpSwitch, LV_STATE_CHECKED);  // DHCP por padrão

  lv_obj_t* col = lv_obj_create(scrIpConfig);
  lv_obj_set_size(col, SCREEN_W - 20, SCREEN_H - 60);
  lv_obj_align(col, LV_ALIGN_BOTTOM_MID, 0, -30);
  lv_obj_set_flex_flow(col, LV_FLEX_FLOW_COLUMN);

  ipAddrArea = makeIpField(col, "IP");
  ipGwArea = makeIpField(col, "Gateway");
  ipMaskArea = makeIpField(col, "Máscara");
  ipDnsArea = makeIpField(col, "DNS");

  lv_obj_t* saveBtn = lv_btn_create(scrIpConfig);
  lv_obj_align(saveBtn, LV_ALIGN_BOTTOM_MID, 0, -4);
  lv_obj_t* saveLbl = lv_label_create(saveBtn);
  lv_label_set_text(saveLbl, "Salvar");
  lv_obj_add_event_cb(saveBtn, onIpSave, LV_EVENT_CLICKED, nullptr);
}

static void showIpConfig() {
  lv_scr_load(scrIpConfig);
}

// --- Info de rede (só leitura, sem PIN) ---------------------------------------------------------
static lv_obj_t* netInfoLabel;

static void onNetInfoBack(lv_event_t* e) {
  showDashboard();
}

static void buildNetInfoScreen() {
  scrNetInfo = lv_obj_create(NULL);
  makeBackButton(scrNetInfo, onNetInfoBack);
  netInfoLabel = lv_label_create(scrNetInfo);
  lv_obj_align(netInfoLabel, LV_ALIGN_TOP_LEFT, 8, 32);
}

static void showNetInfo() {
  char buf[320];
  snprintf(buf, sizeof(buf),
           "SSID: %s\nIP: %s\nMascara: %s\nGateway: %s\nDNS: %s\nMAC: %s\nRSSI: %d dBm\nFW: %s\nUptime: %lus",
           WiFi.SSID().c_str(), WiFi.localIP().toString().c_str(), WiFi.subnetMask().toString().c_str(),
           WiFi.gatewayIP().toString().c_str(), WiFi.dnsIP().toString().c_str(), WiFi.macAddress().c_str(),
           WiFi.RSSI(), FW_VERSION, millis() / 1000);
  lv_label_set_text(netInfoLabel, buf);
  lv_scr_load(scrNetInfo);
}

// --- Calibração de touch (4 pontos) ----------------------------------------------------------
// Simplificada: 4 alvos nos cantos, min/max por eixo (sem correção de rotação — ver storage.h).
static lv_obj_t* calibTarget;
static lv_obj_t* calibLabel;

static const lv_point_t CALIB_TARGETS[4] = {{20, 20}, {SCREEN_W - 20, 20}, {20, SCREEN_H - 20}, {SCREEN_W - 20, SCREEN_H - 20}};

static void placeCalibTarget() {
  lv_obj_align(calibTarget, LV_ALIGN_TOP_LEFT, CALIB_TARGETS[calibStep].x - 8, CALIB_TARGETS[calibStep].y - 8);
  char buf[32];
  snprintf(buf, sizeof(buf), "toque no alvo (%d/4)", calibStep + 1);
  lv_label_set_text(calibLabel, buf);
}

static void buildCalibrationScreen() {
  scrCalibration = lv_obj_create(NULL);
  calibLabel = lv_label_create(scrCalibration);
  lv_obj_align(calibLabel, LV_ALIGN_TOP_MID, 0, 8);
  calibTarget = lv_obj_create(scrCalibration);
  lv_obj_set_size(calibTarget, 16, 16);
  lv_obj_set_style_radius(calibTarget, LV_RADIUS_CIRCLE, 0);
  lv_obj_set_style_bg_color(calibTarget, lv_palette_main(LV_PALETTE_RED), 0);
}

static void showCalibration() {
  calibStep = 0;
  placeCalibTarget();
  lv_scr_load(scrCalibration);
}

// Chamado do touchRead cru (antes de aplicar a calibração) enquanto a tela de calibração
// está ativa — precisa das coordenadas RAW do controller, não das mapeadas pra tela.
static void feedCalibrationRaw(uint16_t rawX, uint16_t rawY) {
  calibRawX[calibStep] = rawX;
  calibRawY[calibStep] = rawY;
  calibStep++;
  if (calibStep >= 4) {
    storage::TouchCalibration cal;
    // esquerda = alvos 0 e 2; direita = alvos 1 e 3; topo = alvos 0 e 1; baixo = alvos 2 e 3
    cal.xMin = (calibRawX[0] + calibRawX[2]) / 2;
    cal.xMax = (calibRawX[1] + calibRawX[3]) / 2;
    cal.yMin = (calibRawY[0] + calibRawY[1]) / 2;
    cal.yMax = (calibRawY[2] + calibRawY[3]) / 2;
    storage::saveTouchCalibration(cal);
    calib = cal;
    // Mesma checagem do boot (begin(), linha ~646) — sem isso, calibrar sempre caía
    // direto no dashboard vazio, mesmo sem WiFi configurado ainda.
    if (!storage::hasWifiCredentials()) {
      showWifiList();
    } else {
      showDashboard();
    }
  } else {
    placeCalibTarget();
  }
}

// --- Ciclo público -------------------------------------------------------------------------------
void begin(QueueHandle_t netEventQueue) {
  (void)netEventQueue;  // guardado só pra assinatura simétrica com net::begin — lido via tick()

  tft.init();
  tft.setRotation(1);

  // XPT2046_Touchscreen (versão instalada) usa sempre o objeto SPI global, sem suportar
  // SPIClass própria — inicializamos o SPI global com os pinos de touch do CYD antes.
  SPI.begin(XPT2046_CLK, XPT2046_MISO, XPT2046_MOSI, XPT2046_CS);
  touchCtrl.begin();
  touchCtrl.setRotation(1);

  calib = storage::loadTouchCalibration();

  lv_init();
  lv_disp_draw_buf_init(&drawBuf, lvBuf, NULL, SCREEN_W * 20);

  static lv_disp_drv_t dispDrv;
  lv_disp_drv_init(&dispDrv);
  dispDrv.hor_res = SCREEN_W;
  dispDrv.ver_res = SCREEN_H;
  dispDrv.flush_cb = dispFlush;
  dispDrv.draw_buf = &drawBuf;
  lv_disp_drv_register(&dispDrv);

  static lv_indev_drv_t indevDrv;
  lv_indev_drv_init(&indevDrv);
  indevDrv.type = LV_INDEV_TYPE_POINTER;
  indevDrv.read_cb = touchRead;
  lv_indev_drv_register(&indevDrv);

  buildDashboard();
  buildPinScreen();
  buildMenu();
  buildWifiListScreen();
  buildTextInputScreen();
  buildIpConfigScreen();
  buildNetInfoScreen();
  buildCalibrationScreen();

  if (!storage::hasTouchCalibration()) {
    showCalibration();
  } else if (!storage::hasWifiCredentials()) {
    showWifiList();
  } else {
    showDashboard();
  }
}

void tick() {
  lv_timer_handler();

  if (scrCalibration && lv_scr_act() == scrCalibration && touchCtrl.touched()) {
    TS_Point p = touchCtrl.getPoint();
    feedCalibrationRaw(p.x, p.y);
    delay(300);  // debounce simples — evita registrar o mesmo toque várias vezes
  }

  pollWifiScan();

  // updateHeader() reescreve relógio/data/sinal (invalida e redesenha widgets) — chamar
  // isso a ~200Hz (tick() roda a cada 5ms no loop principal) causava o piscar visível na
  // tela real. Granularidade de 1s já é mais que suficiente (relógio é HH:MM).
  static uint32_t lastHeaderUpdate = 0;
  if (millis() - lastHeaderUpdate >= 1000) {
    lastHeaderUpdate = millis();
    updateHeader();
  }
}

// Chamado por main.cpp a cada net::Event novo lido da fila.
void onNetEvent(const net::Event& evt) {
  lastNetEvent = evt;
  if (evt.hasReading) updateDashboardReading(evt.temp, evt.hum);
}

}  // namespace ui
