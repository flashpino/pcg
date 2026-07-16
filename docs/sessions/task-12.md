# Sessão Task 12 — Firmware ESP32 (CYD) — núcleo de rede e sensor (2026-07-15)

## Feito
- **PlatformIO Core instalado nesta máquina** (`py -m pip install --user platformio`, v6.1.19) — nenhuma sessão anterior tinha isso disponível; a partir de agora `pio run` valida compilação de verdade.
- `firmware/platformio.ini`: board `esp32dev`, framework Arduino. Libs desta task: `DHT sensor library`, `Adafruit Unified Sensor`, `ArduinoJson`. `build_flags`: só `DHT_PIN=27`.
- `firmware/src/config.h.example`: `SERVER_URL`/`FW_VERSION` (binário universal — WiFi/token vivem no NVS).
- `firmware/src/storage.h/.cpp`: NVS (`Preferences`) — credenciais WiFi, `device_token`, `device_name` (default derivado do MAC até a Task 13 dar uma UI pra trocar), config de IP estático opcional.
- `firmware/src/net.h/.cpp`: task FreeRTOS de rede (core 0, pinada via `xTaskCreatePinnedToCore`), publicando `net::Event` numa fila de tamanho 1 (`xQueueOverwrite` — só o estado mais recente importa) pra Task 13 consumir na UI. Dentro do ciclo:
  - `readDht()`: retry 3x com 2.5s (KEY_INSIGHT do plano — DHT22 falha ~5% das leituras).
  - `ensureConnected()`: WiFi com backoff 5s→10s→30s; 10 falhas consecutivas → `ESP.restart()`; aplica IP estático do NVS antes de `WiFi.begin()`; sem credencial no NVS retorna `false` (Task 13 abre o scan).
  - `provision()`: `POST /api/provision {mac}` — TOFU, token salvo no NVS.
  - Ring buffer RAM de 200 leituras (`ponytail:` comentado — perde no reboot, mover pra LittleFS se doer).
  - Drena o buffer em lotes de 20 via `sendIngest()` (`POST /api/ingest`), para no primeiro lote que falhar (buffer segura o resto pro próximo ciclo).
  - `runOta()`: dispara só quando o buffer estiver 100% drenado (GOTCHA — nunca OTA com leituras pendentes).
  - Watchdog alimentado em todo ponto de espera bloqueante (`esp_task_wdt_reset()`).
- `firmware/src/main.cpp`: `esp_task_wdt_init(30, true)`, `storage::begin()`, cria a fila de evento + a task de rede. `loop()` (core 1, implícito no Arduino-ESP32) só alimenta o watchdog e drena a fila — sem UI ainda (Task 13).

## Divergências do plano
- **LVGL/TFT_eSPI/XPT2046_Touchscreen tiradas do `platformio.ini` desta task** — o plano listava essas libs (com todo o pinout do CYD em `build_flags`) numa linha só da tabela "Files to Change", mas isso é **Task 13's escopo** (a UI). Tentei incluir do jeito que o plano descreve e a compilação real quebrou: LVGL exige um `lv_conf.h` que só faz sentido escrever quando a UI é desenhada de verdade — sem ele, a lib nem compila, mesmo sem nenhum código desta task usá-la. Removido por ora; volta na Task 13 junto com `lv_conf.h`. O pinout do TFT (`TFT_MISO=12, MOSI=13, SCLK=14, CS=15, DC=2, RST=-1, BL=21`) foi confirmado por busca web (Random Nerd Tutorials + esp32s.com, consistentes entre si) — guardado aqui pra Task 13 reaproveitar, já que saiu do `platformio.ini`.
- **Versão da lib `paulstoffregen/XPT2046_Touchscreen`**: o plano/minha tentativa inicial pediu `@^1.4`, mas o registro do PlatformIO só tem uma tag alpha (`0.0.0-alpha+sha...`) — sem constraint de versão. Já que a lib nem entrou no build desta task, isso só fica registrado aqui pra Task 13 não tropeçar na mesma coisa.
- **OTA: token via querystring, não header** — `HTTPUpdate::update()` não tem uma API simples pra header customizado tipo `X-Device-Token`. Resolvido enviando `?token=` na URL do `.bin`. **Isso é uma decisão que a Task 14 (server-side OTA) precisa honrar**: a rota `GET /api/ota/firmware/:version.bin` vai precisar aceitar o token por querystring como alternativa ao header (o header continua valendo pro resto da API).
- **`interval_seconds` do sensor não é sincronizado do server** — o contrato da API não tem uma rota pro device buscar sua própria config; o firmware usa um intervalo fixo de 60s (igual ao default da coluna no schema). Sincronizar isso exigiria uma rota nova, fora do que o plano especificou.
- **`device_name` sem UI ainda** — default `"esp32-" + 4 últimos hex do MAC`, gravável via `storage::saveDeviceName()` mas sem tela pra chamar isso (Task 13).

## Validações
- **`pio run` → SUCCESS** ✔ (RAM 15.4%, Flash 72.9% de um esp32dev genérico — a placa real (CYD) tem specs equivalentes). Essa é a primeira validação de compilação de verdade em todo o projeto — todas as tasks anteriores só tinham `tsc`/`vitest` porque não havia Postgres/Docker disponíveis; aqui o "compilador" (PlatformIO) estava genuinamente ausente até esta sessão instalá-lo.
- `firmware/src/config.h` criado localmente (gitignored) só com valores de placeholder pra validar a compilação — não é o `config.h` de produção.
- **Pendência real, sem contorno possível nesta máquina**: bancada com hardware (ESP32-2432S028R físico, DHT22, rede WiFi) — a VALIDATE da Task 12 ("desligar WiFi 10min e religar: leituras aparecem no Influx com timestamps corretos") exige o device físico rodando. Nenhuma sessão remota resolve isso.

## Contexto para a próxima sessão (Task 13 — UI touch LVGL)
- Devolver `lvgl`, `TFT_eSPI`, `XPT2046_Touchscreen` ao `platformio.ini` (pinout do TFT já documentado acima) + criar `firmware/src/lv_conf.h`.
- `net::Event` (em `net.h`) já carrega `status`/`hasReading`/`temp`/`hum`/`rssi` — a Task 13 só precisa consumir a fila (`uiEventQueue`, criada em `main.cpp`) dentro do loop da UI, nunca tocar em widgets a partir da task de rede.
- `storage::hasWifiCredentials()` já existe — a Task 13 usa isso pra decidir se abre a tela de scan direto no boot.
- `storage.h` já tem `loadDeviceName`/`saveDeviceName`/`loadStaticIp`/`saveStaticIp` prontos pra UI consumir — só falta a tela.
