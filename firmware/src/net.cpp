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
// KEY_INSIGHT: DHT22 retorna NaN em ~5% das leituras — retry 3x com 2.5s (não ler mais rápido
// que 2s trava o sensor).
static bool readDht(float& temp, float& hum) {
  for (int i = 0; i < 3; i++) {
    hum = dht.readHumidity();
    temp = dht.readTemperature();
    if (!isnan(temp) && !isnan(hum)) return true;
    esp_task_wdt_reset();
    delay(2500);
  }
  return false;
}

// --- WiFi ------------------------------------------------------------------------------------
static uint8_t consecutiveFailures = 0;

static bool ensureConnected() {
  if (WiFi.status() == WL_CONNECTED) return true;

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
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    return true;
  }

  consecutiveFailures++;
  if (consecutiveFailures >= 10) {
    ESP.restart();
  }
  static const uint32_t BACKOFF_MS[] = {5000, 10000, 30000};
  uint32_t backoff = BACKOFF_MS[min<uint8_t>(consecutiveFailures - 1, 2)];
  esp_task_wdt_reset();
  delay(backoff);
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
static void runOta(const String& url) {
  WiFiClientSecure client = makeSecureClient();
  httpUpdate.onProgress([](int, int) { esp_task_wdt_reset(); });
  String fullUrl = String(SERVER_URL) + url + "?token=" + storage::loadDeviceToken();
  t_httpUpdate_return ret = httpUpdate.update(client, fullUrl);
  if (ret == HTTP_UPDATE_FAILED) {
    Serial.printf("OTA falhou: %s\n", httpUpdate.getLastErrorString().c_str());
    // segue o loop normal — tenta de novo no próximo ingest que trouxer ota.url
  }
  // HTTP_UPDATE_OK reinicia o device sozinho (comportamento padrão da lib).
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
  doc["device_name"] = storage::loadDeviceName();

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
// Sem sincronizar interval_seconds do server (exigiria uma rota nova, fora do contrato do
// plano) — intervalo fixo de 60s, igual ao default de sensors.interval_seconds no schema.
static const uint32_t READ_INTERVAL_MS = 60000;

static void publish(QueueHandle_t uiQueue, Status status, bool hasReading, float temp, float hum, int16_t rssi) {
  Event evt{status, hasReading, temp, hum, rssi};
  xQueueOverwrite(uiQueue, &evt);  // fila de tamanho 1: só o estado mais recente importa pra UI
}

static void task(void* pvParameters) {
  QueueHandle_t uiQueue = static_cast<QueueHandle_t>(pvParameters);
  esp_task_wdt_add(NULL);

  bool provisioned = storage::hasDeviceToken();

  for (;;) {
    esp_task_wdt_reset();

    if (!ensureConnected()) {
      publish(uiQueue, Status::OFFLINE, false, 0, 0, 0);
      // Sem isso, "sem credencial WiFi" vira busy-loop lendo o NVS sem parar
      // (ensureConnected retorna na hora, sem esperar nada, enquanto o usuário
      // configura a rede pela tela — visto martelando o NVS a ~8ms/iteração em bancada).
      vTaskDelay(pdMS_TO_TICKS(500));
      continue;
    }

    if (!provisioned) {
      publish(uiQueue, Status::PROVISIONING, false, 0, 0, 0);
      String token;
      if (provision(token)) {
        storage::saveDeviceToken(token);
        provisioned = true;
      } else {
        publish(uiQueue, Status::PROVISION_FAILED, false, 0, 0, 0);
        vTaskDelay(pdMS_TO_TICKS(30000));
        continue;
      }
    }

    float temp = NAN, hum = NAN;
    bool hasReading = readDht(temp, hum);
    if (hasReading) {
      ringPush(Reading{temp, hum, static_cast<int16_t>(WiFi.RSSI()), millis()});
    }

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

    publish(uiQueue, Status::ONLINE, hasReading, temp, hum, static_cast<int16_t>(WiFi.RSSI()));
    vTaskDelay(pdMS_TO_TICKS(READ_INTERVAL_MS));
  }
}

void begin(QueueHandle_t uiQueue) {
  xTaskCreatePinnedToCore(task, "net", 8192, uiQueue, 1, nullptr, 0);
}

}  // namespace net
