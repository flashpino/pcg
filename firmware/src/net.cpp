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

// --- Breadcrumb de crash (ver net.h) -------------------------------------------------------
// RTC_NOINIT_ATTR nao e zerada por reset de watchdog/panic — so o power-on chega com lixo, dai
// o magic. bootCount conta TODO reboot, inclusive os que o servidor nao registra (ele dedupe
// por motivo, entao uma sequencia de INT_WDT iguais aparece la como um evento so).
static const uint32_t CRASH_MAGIC = 0xC0FFEE01;
static RTC_NOINIT_ATTR uint32_t crashMagic;
static RTC_NOINIT_ATTR uint32_t bootCount;
static RTC_NOINIT_ATTR uint8_t stageNet, stageUi;
// Congelados no boot: o que cada core estava fazendo quando o device morreu.
static uint8_t prevStageNet = 0, prevStageUi = 0;

void mark(Stage s) { stageNet = static_cast<uint8_t>(s); }
void markUi(Stage s) { stageUi = static_cast<uint8_t>(s); }

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
    if (scanPaused) {
      // UI pediu o rádio no meio da tentativa de conexão — aborta e larga, senão o scan
      // da tela de WiFi disputa o rádio com este WiFi.begin() em andamento e volta vazio
      // (bug real: sensor já configurado e offline nunca soltava o rádio a tempo).
      WiFi.disconnect();
      return false;
    }
    esp_task_wdt_reset();
    delay(250);
    waited += 250;
  }
  // Conectou tem precedência sobre o pedido de scan: se a guarda de scanPaused viesse antes
  // desta checagem, uma conexão que acabou de fechar seria jogada fora — consecutiveFailures
  // ficaria travado no valor antigo (a chamada seguinte retorna logo no topo, em WL_CONNECTED,
  // e nunca mais zera) e o configTime nunca rodaria. Bastava o usuário abrir a tela de WiFi no
  // tick em que o WiFi.begin() completou pra o device reiniciar sozinho depois, na 10ª falha.
  if (WiFi.status() == WL_CONNECTED) {
    consecutiveFailures = 0;
    configTime(-3 * 3600, 0, "pool.ntp.org", "time.nist.gov");  // America/Sao_Paulo, sem DST desde 2019
    return true;
  }
  // Não conectou e a UI quer o rádio: larga explicitamente, senão o WiFi.begin() que estourou
  // os 8s continua segurando o rádio e o scan volta vazio — mesmo motivo do aborto lá em cima.
  if (scanPaused) {
    WiFi.disconnect();
    return false;
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
    if (scanPaused) return false;  // idem — não segura o backoff se a UI quer escanear
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
  // O default do handshake TLS e 30s — exatamente o timeout do watchdog. Um aperto de mao
  // lento (WiFi ruim) segurava a task de rede tempo suficiente pro WDT reiniciar o device no
  // meio do envio: e o "watchdog (tarefa travada)" que aparece no painel.
  client.setHandshakeTimeout(8);
  return client;
}

static void sendDeviceTest() {
  WiFiClientSecure client = makeSecureClient();
  HTTPClient http;
  if (!http.begin(client, String(SERVER_URL) + "/api/device/test")) {
    testState = TestState::FAILED;
    return;
  }
  http.setConnectTimeout(8000);
  http.setTimeout(8000);
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
  http.setConnectTimeout(8000);
  http.setTimeout(8000);
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

// count == 0 é o heartbeat de sensor travado: o POST vai com readings vazio e sensor_stale=true,
// e o server aceita só nessa condição. É o que mantém last_seen_at fresco (device aparece online,
// com alerta de hardware) em vez de sumir do painel como se fosse queda de rede.
static IngestResult sendIngest(const Reading* batch, size_t count, bool sensorStale) {
  IngestResult result{false, ""};

  WiFiClientSecure client = makeSecureClient();
  HTTPClient http;
  if (!http.begin(client, String(SERVER_URL) + "/api/ingest")) return result;
  // Teto explicito por POST: connect + leitura somam no maximo ~16s, bem abaixo dos 30s do
  // watchdog. Sem isso um unico POST pendurado derrubava a task inteira.
  http.setConnectTimeout(8000);
  http.setTimeout(8000);
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
  doc["sensor_stale"] = sensorStale;
  // b=boots desde o ultimo power-on, n/u=stage de cada core no crash anterior, h=heap livre,
  // s=folga da stack desta task (o handshake TLS e o maior consumidor), up=uptime deste boot.
  char diag[80];
  snprintf(diag, sizeof(diag), "b%lu n%u u%u h%uk s%u up%lus", (unsigned long)bootCount,
           prevStageNet, prevStageUi, (unsigned)(ESP.getFreeHeap() / 1024),
           (unsigned)uxTaskGetStackHighWaterMark(nullptr), (unsigned long)(millis() / 1000));
  doc["diag"] = diag;
  doc["boot_id"] = bootCount;

  String body;
  serializeJson(doc, body);
  int code = http.POST(body);

  // 401 = o sensor foi deletado no painel (DELETE físico leva o device_token junto). O token
  // gravado aqui nunca mais vai valer, e o servidor não tem como reemitir: o corpo do ingest
  // não carrega o MAC, então ele nem sabe quem está batendo. Apagar o token é o que devolve o
  // device pro caminho de provisionamento — sem isso ele fica em 401 pra sempre, reiniciando
  // de 10 em 10 min, e só volta com USB (foi o que aconteceu com o proatus_C528).
  if (code == 401) {
    Serial.println("[ingest] 401 — token invalido, apagando pra reprovisionar");
    storage::saveDeviceToken("");
  }

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

// ensureConnected() só enxerga associação Wi-Fi local (WL_CONNECTED) — não prova que o ingest
// chega no servidor. Sensor fica "conectado" na tela enquanto o /api/ingest falha silenciosamente
// (DNS, rota até a nuvem caída, etc.), e como o dispositivo é remoto, ninguém consegue reiniciar
// fisicamente. INGEST_STALE_UI_MS marca a tela como offline mais cedo (2 ciclos perdidos, tolera
// 1 falha isolada); INGEST_STALE_RESTART_MS força um reboot automático bem depois do
// offline_after_seconds do painel (300s padrão) — reconectar do zero é o único self-heal possível
// sem acesso físico ao device.
static const uint32_t INGEST_STALE_UI_MS = 3 * SEND_INTERVAL_MS;
static const uint32_t INGEST_STALE_RESTART_MS = 10 * 60 * 1000;

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

  // ponytail: log temporário de diagnóstico — remover depois de confirmar a causa do bug
  // "offset não sobrevive ao restart em sensor já configurado" (ver conversa/relato).
  Serial.printf("[offset] boot: temp_offset=%.2f\n", storage::loadTempOffset());

  uint32_t lastSendMs = 0;  // primeiro envio acontece ~60s depois do boot, igual antes
  uint32_t lastOkSendMs = millis();  // início "saudável" — só o 1º ciclo de envio real confirma
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
    mark(Stage::DHT);
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

    mark(Stage::WIFI);
    bool connected = ensureConnected();
    int16_t rssi = connected ? static_cast<int16_t>(WiFi.RSSI()) : 0;

    if (!connected) {
      publish(uiQueue, Status::OFFLINE, hasReading, sensorStale, temp, hum, rssi);
      vTaskDelay(pdMS_TO_TICKS(READ_INTERVAL_MS));
      continue;
    }

    // Relido da NVS a cada volta, nunca travado numa variável do boot: o sendIngest apaga o
    // token ao tomar 401, e é esta releitura que faz o device voltar sozinho pro provisionamento
    // no ciclo seguinte. Com o valor latcheado, deletar o sensor no painel deixava o device
    // inalcançável até alguém ir lá com um cabo USB.
    if (!storage::hasDeviceToken()) {
      String token;
      mark(Stage::PROVISION);
      if (provision(token)) {
        storage::saveDeviceToken(token);
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
      mark(Stage::TEST);
      sendDeviceTest();
    }

    if (millis() - lastSendMs >= SEND_INTERVAL_MS) {
      lastSendMs = millis();
      // Buffer vazio com sensor travado: manda heartbeat pra marcar presença. Sem isso o device
      // com DHT morto não tinha o que enviar, nunca chamava /api/ingest, e o painel o dava como
      // offline — e o ESP.restart() de INGEST_STALE_RESTART_MS reiniciava de 10 em 10 min pra
      // sempre, já que lastOkSendMs só era atualizado dentro do laço de drenagem abaixo.
      if (ringCount == 0 && sensorStale) {
        mark(Stage::INGEST);
        IngestResult hb = sendIngest(nullptr, 0, true);
        if (hb.ok) {
          lastOkSendMs = millis();
          // Buffer vazio por definição aqui, então o GOTCHA do OTA já está satisfeito — e este é
          // o único caminho de atualização que sobra pra um device cujo sensor morreu.
          if (hb.otaUrl.length() > 0) { mark(Stage::OTA); runOta(hb.otaUrl); }
        }
      }
      // Drena o buffer em lotes de 20 até esvaziar ou até um POST falhar (fica pro próximo ciclo).
      while (ringCount > 0) {
        // Um POST por lote de 20: depois de uma queda longa o buffer tem centenas de leituras e
        // este laco fazia varios POSTs seguidos sem alimentar o watchdog uma vez sequer — o
        // device reiniciava justamente ao voltar do offline, e reiniciar o punha offline de novo.
        esp_task_wdt_reset();
        mark(Stage::INGEST);
        Reading batch[20];
        size_t n = ringPeekBatch(batch, 20);
        IngestResult result = sendIngest(batch, n, false);
        if (!result.ok) break;
        lastOkSendMs = millis();
        ringPop(n);
        if (result.otaUrl.length() > 0 && ringCount == 0) {
          // Nunca OTA com buffer não-drenado (GOTCHA da Task 12).
          mark(Stage::OTA);
          runOta(result.otaUrl);
        }
      }
    }

    // Wi-Fi local pode seguir "conectado" (WL_CONNECTED) mesmo com a nuvem inalcançável —
    // por isso o reboot automático olha pro sucesso real do ingest, não pro rádio.
    if (millis() - lastOkSendMs >= INGEST_STALE_RESTART_MS) ESP.restart();

    bool ingestHealthy = millis() - lastOkSendMs < INGEST_STALE_UI_MS;
    publish(uiQueue, ingestHealthy ? Status::ONLINE : Status::OFFLINE, hasReading, sensorStale, temp, hum, rssi);
    mark(Stage::IDLE);
    vTaskDelay(pdMS_TO_TICKS(READ_INTERVAL_MS));
  }
}

void begin(QueueHandle_t uiQueue) {
  if (crashMagic != CRASH_MAGIC) {  // power-on: RTC RAM vem com lixo
    crashMagic = CRASH_MAGIC;
    bootCount = 0;
    stageNet = stageUi = 0;
  }
  prevStageNet = stageNet;  // guarda o estado do boot que morreu antes de zerar
  prevStageUi = stageUi;
  bootCount++;
  stageNet = stageUi = 0;
  xTaskCreatePinnedToCore(task, "net", 8192, uiQueue, 1, nullptr, 0);
}

}  // namespace net
