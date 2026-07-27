#include "net.h"
#include "config.h"
#include "storage.h"

#include <ArduinoJson.h>
#include <DHT.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_task_wdt.h>
#include <esp_system.h>
#include <time.h>

namespace net {

static DHT dht(DHT_PIN, DHT22);

// --- Buffer offline (ring buffer em RAM) --------------------------------------------------
// ponytail: RAM only — leituras se perdem em reboot; mover para LittleFS se isso doer.
struct Reading {
  float temp;
  float hum;
  int16_t rssi;
  uint32_t ts_ms;  // millis() no momento da leitura — ago_ms calculado na hora do envio
};

static const size_t RING_CAPACITY = 200;  // ~3h a 1 leitura/60s
static Reading ring[RING_CAPACITY];
static size_t ringTail = 0, ringHead = 0, ringCount = 0;

static void ringPush(const Reading& r) {
  ring[ringHead] = r;
  ringHead = (ringHead + 1) % RING_CAPACITY;
  if (ringCount < RING_CAPACITY) {
    ringCount++;
  } else {
    ringTail = (ringTail + 1) % RING_CAPACITY;  // buffer cheio: sobrescreve a mais antiga
  }
}

static size_t ringPeekBatch(Reading* out, size_t maxCount) {
  size_t n = min(maxCount, ringCount);
  for (size_t i = 0; i < n; i++) out[i] = ring[(ringTail + i) % RING_CAPACITY];
  return n;
}

static void ringPop(size_t n) {
  ringTail = (ringTail + n) % RING_CAPACITY;
  ringCount -= n;
}

// --- Leitura do sensor ---------------------------------------------------------------------
// KEY_INSIGHT: DHT22 retorna NaN em ~5% das leituras, e às vezes um valor "válido" mas
// espúrio (glitch, não NaN) — por isso colhemos 3 amostras boas e usamos a mediana de
// cada uma: se uma amostra destoar das outras duas, ela é descartada.
static float median3(float a, float b, float c) {
  return max(min(a, b), min(max(a, b), c));
}

static bool readDht(float& temp, float& hum) {
  float temps[3], hums[3];
  int n = 0;
  // ponytail: até 5 tentativas p/ conseguir 3 amostras válidas (NaN some ~5% das vezes).
  for (int attempt = 0; attempt < 5 && n < 3; attempt++) {
    float h = dht.readHumidity();
    float t = dht.readTemperature();
    if (!isnan(t) && !isnan(h)) {
      temps[n] = t;
      hums[n] = h;
      n++;
    }
    esp_task_wdt_reset();
    if (n < 3) delay(2500);
  }
  if (n < 3) return false;
  temp = median3(temps[0], temps[1], temps[2]) + storage::loadTempOffset();
  hum = median3(hums[0], hums[1], hums[2]);
  return true;
}

// --- WiFi ------------------------------------------------------------------------------------
static uint8_t consecutiveFailures = 0;
static volatile bool scanPaused = false;

void pauseForScan(bool pause) {
  scanPaused = pause;
}

// --- Teste de dispositivo (disparado pela UI) ------------------------------------------------
static volatile bool testRequested = false;
static volatile TestState testState = TestState::IDLE;

void requestDeviceTest() {
  testState = TestState::PENDING;
  testRequested = true;
}

TestState consumeTestResult() {
  TestState s = testState;
  if (s == TestState::SENT || s == TestState::FAILED) testState = TestState::IDLE;
  return s;
}

static bool ensureConnected() {
  if (WiFi.status() == WL_CONNECTED) return true;
  if (scanPaused) return false;  // UI escaneando — não disputa o rádio com WiFi.begin()

  storage::WifiCredentials creds = storage::loadWifiCredentials();
  if (creds.ssid.isEmpty()) return false;  // sem credencial — Task 13 abre o scan na tela

  storage::StaticIpConfig ip = storage::loadStaticIp();
  if (ip.enabled) WiFi.config(ip.ip, ip.gateway, ip.subnet, ip.dns);

  WiFi.begin(creds.ssid.c_str(), creds.password.c_str());

  uint32_t waited = 0;
  while (WiFi.status() != WL_CONNECTED && waited < 8000) {
    esp_task_wdt_reset();
    delay(250);
    waited += 250;
  }

  if (WiFi.status() == WL_CONNECTED) {
    consecutiveFailures = 0;
    configTime(-3 * 3600, 0, "pool.ntp.org", "time.nist.gov");  // America/Sao_Paulo, sem DST desde 2019
    return true;
  }

  consecutiveFailures++;
  if (consecutiveFailures >= 10) {
    ESP.restart();
  }
  static const uint32_t BACKOFF_MS[] = {5000, 10000, 30000};
  uint32_t backoff = BACKOFF_MS[min<uint8_t>(consecutiveFailures - 1, 2)];
  // BUG real achado em bancada: delay(backoff) de até 30s inteiros, com um único
  // esp_task_wdt_reset() antes — o watchdog (30s) disparava NO MEIO desse delay
  // bloqueante e reiniciava o device (abort + reboot), toda vez que dava 3 falhas
  // seguidas de WiFi. Por isso "piscava"/reiniciava sozinho. Fatiado em passos de
  // 250ms com reset a cada um, igual ao loop de espera de conexão logo acima.
  for (uint32_t waitedBackoff = 0; waitedBackoff < backoff; waitedBackoff += 250) {
    esp_task_wdt_reset();
    delay(250);
  }
  return false;
}

// --- HTTPS client (sem pinning de certificado) ----------------------------------------------
// ponytail: setInsecure() — sem CA fixa. Trocar por certificado pinado se a ameaça de
// MITM na rede do cliente importar mais que a simplicidade do binário universal.
static WiFiClientSecure makeSecureClient() {
  WiFiClientSecure client;
  client.setInsecure();
  return client;
}

static void sendDeviceTest() {
  WiFiClientSecure client = makeSecureClient();
  HTTPClient http;
  if (!http.begin(client, String(SERVER_URL) + "/api/device/test")) {
    testState = TestState::FAILED;
    return;
  }
  http.addHeader("X-Device-Token", storage::loadDeviceToken());
  int code = http.POST("");
  http.end();
  testState = (code == 200) ? TestState::SENT : TestState::FAILED;
}

// --- Provisionamento ---------------------------------------------------------------------
// TOFU: 1º boot sem token -> POST /api/provision {mac}. 404 = MAC já provisionado (NVS
// apagado) -> Task 13 mostra "contate o suporte" com o MAC; admin deleta o sensor e o
// device re-provisiona no próximo boot.
static bool provision(String& tokenOut) {
  WiFiClientSecure client = makeSecureClient();
  HTTPClient http;
  if (!http.begin(client, String(SERVER_URL) + "/api/provision")) return false;
  http.addHeader("Content-Type", "application/json");

  JsonDocument doc;
  doc["mac"] = WiFi.macAddress();
  String body;
  serializeJson(doc, body);

  int code = http.POST(body);
  bool ok = false;
  if (code == 200) {
    JsonDocument resp;
    if (deserializeJson(resp, http.getString()) == DeserializationError::Ok) {
      tokenOut = resp["token"].as<String>();
      ok = tokenOut.length() > 0;
    }
  }
  http.end();
  return ok;
}

// --- OTA -------------------------------------------------------------------------------------
// HTTPUpdate não tem API simples pra header customizado — token vai por querystring.
// Task 14 (server) precisa aceitar ?token= como alternativa ao header X-Device-Token no
// download do .bin (o header continua valendo pro resto da API).
static volatile bool otaUpdating = false;

bool isOtaUpdating() {
  return otaUpdating;
}

static void runOta(const String& url) {
  otaUpdating = true;
  WiFiClientSecure client = makeSecureClient();
  httpUpdate.onProgress([](int, int) { esp_task_wdt_reset(); });
  String fullUrl = String(SERVER_URL) + url + "?token=" + storage::loadDeviceToken();
  t_httpUpdate_return ret = httpUpdate.update(client, fullUrl);
  if (ret == HTTP_UPDATE_FAILED) {
    Serial.printf("OTA falhou: %s\n", httpUpdate.getLastErrorString().c_str());
    // segue o loop normal — tenta de novo no próximo ingest que trouxer ota.url
  }
  otaUpdating = false;
  // HTTP_UPDATE_OK reinicia o device sozinho (comportamento padrão da lib) — o flag acima só
  // importa mesmo pro caso de falha, onde a UI precisa voltar ao normal sem reboot.
}

// Motivo do reset atual (constante durante todo o boot) — visibilidade remota de reboots
// que não são queda de energia (watchdog, panic, brownout), sem precisar de USB no device.
static const char* resetReasonStr() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "poweron";
    case ESP_RST_SW: return "sw_restart";
    case ESP_RST_PANIC: return "panic";
    case ESP_RST_INT_WDT: return "watchdog_interrupt";
    case ESP_RST_TASK_WDT: return "watchdog_task";
    case ESP_RST_WDT: return "watchdog_other";
    case ESP_RST_BROWNOUT: return "brownout";
    default: return "outro";
  }
}

// --- Ingest ------------------------------------------------------------------------------------
struct IngestResult {
  bool ok;
  String otaUrl;  // vazio se não houver OTA pendente
};

static IngestResult sendIngest(const Reading* batch, size_t count) {
  IngestResult result{false, ""};

  WiFiClientSecure client = makeSecureClient();
  HTTPClient http;
  if (!http.begin(client, String(SERVER_URL) + "/api/ingest")) return result;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Token", storage::loadDeviceToken());

  JsonDocument doc;
  JsonArray readings = doc["readings"].to<JsonArray>();
  uint32_t now = millis();
  for (size_t i = 0; i < count; i++) {
    JsonObject o = readings.add<JsonObject>();
    o["temp"] = batch[i].temp;
    o["hum"] = batch[i].hum;
    o["rssi"] = batch[i].rssi;
    o["ago_ms"] = now - batch[i].ts_ms;
  }
  doc["fw"] = FW_VERSION;
  doc["variant"] = FW_VARIANT;
  doc["device_name"] = storage::loadDeviceName();
  doc["reset_reason"] = resetReasonStr();

  String body;
  serializeJson(doc, body);
  int code = http.POST(body);

  if (code == 200) {
    JsonDocument resp;
    if (deserializeJson(resp, http.getString()) == DeserializationError::Ok) {
      result.ok = true;
      if (resp["ota"].is<JsonObject>()) {
        result.otaUrl = resp["ota"]["url"].as<String>();
      }
    }
  }
  http.end();
  return result;
}

// --- Task principal ---------------------------------------------------------------------------
// Amostra o DHT22 a cada 10s (dashboard/sparkline mais responsivos) mas só envia pro
// servidor a cada 60s (igual ao default de sensors.interval_seconds no schema) — as
// leituras entre um envio e outro ficam no ring buffer e vão todas no próximo lote.
static const uint32_t READ_INTERVAL_MS = 10000;
static const uint32_t SEND_INTERVAL_MS = 60000;

static void publish(QueueHandle_t uiQueue, Status status, bool hasReading, bool sensorStale, float temp, float hum, int16_t rssi) {
  Event evt{status, hasReading, sensorStale, temp, hum, rssi};
  xQueueOverwrite(uiQueue, &evt);  // fila de tamanho 1: só o estado mais recente importa pra UI
}

// 3 ciclos de leitura seguidos sem sucesso (~30s+, já contando os 5 retries internos de
// readDht) — sensor realmente travado, não um glitch isolado que a mediana já filtra.
static const uint8_t SENSOR_STALE_STREAK = 3;

// ponytail: DHT22 às vezes trava retornando sempre o último valor latched (não dá NaN, passa
// no isnan — a leitura "parece" válida). Em campo, sem acesso físico ao device, a única forma
// de tentar destravar é reiniciar. 30min com valor idêntico é tempo suficiente pra ambientes
// refrigerados estáveis não disparar restart à toa, mas curto o bastante pra recuperar rápido.
static const uint32_t STUCK_RESTART_MS = 30 * 60 * 1000;

static void task(void* pvParameters) {
  QueueHandle_t uiQueue = static_cast<QueueHandle_t>(pvParameters);
  esp_task_wdt_add(NULL);
  dht.begin();  // faltava — sem isso a lib nunca configura o pino, toda leitura dá NaN

  bool provisioned = storage::hasDeviceToken();
  uint32_t lastSendMs = 0;  // primeiro envio acontece ~60s depois do boot, igual antes
  uint8_t sensorFailStreak = 0;
  float stuckTemp = NAN, stuckHum = NAN;
  uint32_t stuckSinceMs = 0;

  for (;;) {
    esp_task_wdt_reset();

    // Leitura do DHT SEMPRE no topo do loop — a tela mostra temp/umidade independente de
    // rede ou provisionamento (requisito: funciona normal mesmo sem internet). Provisionar e
    // enviar são efeitos à parte que NUNCA podem impedir a leitura de aparecer na tela.
    // readDht() já bloqueia ~7,5s (3 amostras) resetando o WDT, então ele também é o "ritmo"
    // do loop — sem precisar de delays extras nos caminhos de erro.
    float temp = NAN, hum = NAN;
    bool hasReading = readDht(temp, hum);
    sensorFailStreak = hasReading ? 0 : min<uint16_t>(sensorFailStreak + 1, 255);
    bool sensorStale = sensorFailStreak >= SENSOR_STALE_STREAK;
    if (hasReading) {
      ringPush(Reading{temp, hum, static_cast<int16_t>(WiFi.RSSI()), millis()});

      if (temp == stuckTemp && hum == stuckHum) {
        if (millis() - stuckSinceMs >= STUCK_RESTART_MS) ESP.restart();
      } else {
        stuckTemp = temp;
        stuckHum = hum;
        stuckSinceMs = millis();
      }
    }

    bool connected = ensureConnected();
    int16_t rssi = connected ? static_cast<int16_t>(WiFi.RSSI()) : 0;

    if (!connected) {
      publish(uiQueue, Status::OFFLINE, hasReading, sensorStale, temp, hum, rssi);
      vTaskDelay(pdMS_TO_TICKS(READ_INTERVAL_MS));
      continue;
    }

    if (!provisioned) {
      String token;
      if (provision(token)) {
        storage::saveDeviceToken(token);
        provisioned = true;
      } else {
        // MAC já cadastrado (404) → admin deleta o sensor no painel e ele reprovisiona.
        // Segue mostrando a leitura na tela — não some com temp/umidade por causa disso.
        publish(uiQueue, Status::PROVISION_FAILED, hasReading, sensorStale, temp, hum, rssi);
        vTaskDelay(pdMS_TO_TICKS(READ_INTERVAL_MS));
        continue;
      }
    }

    // Teste pedido pela UI — só chega aqui já conectado e provisionado.
    if (testRequested) {
      testRequested = false;
      sendDeviceTest();
    }

    if (millis() - lastSendMs >= SEND_INTERVAL_MS) {
      lastSendMs = millis();
      // Drena o buffer em lotes de 20 até esvaziar ou até um POST falhar (fica pro próximo ciclo).
      while (ringCount > 0) {
        Reading batch[20];
        size_t n = ringPeekBatch(batch, 20);
        IngestResult result = sendIngest(batch, n);
        if (!result.ok) break;
        ringPop(n);
        if (result.otaUrl.length() > 0 && ringCount == 0) {
          // Nunca OTA com buffer não-drenado (GOTCHA da Task 12).
          runOta(result.otaUrl);
        }
      }
    }

    publish(uiQueue, Status::ONLINE, hasReading, sensorStale, temp, hum, rssi);
    vTaskDelay(pdMS_TO_TICKS(READ_INTERVAL_MS));
  }
}

void begin(QueueHandle_t uiQueue) {
  xTaskCreatePinnedToCore(task, "net", 8192, uiQueue, 1, nullptr, 0);
}

}  // namespace net
