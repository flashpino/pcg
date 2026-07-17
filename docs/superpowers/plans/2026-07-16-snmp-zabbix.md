# Suporte SNMP (Zabbix) no firmware — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portar o agente SNMP v2c (somente leitura) do firmware antigo pro firmware novo, expondo temperatura, umidade, uptime e RSSI pro Zabbix via SNMP, sem quebrar nenhum template já apontado pro esquema antigo.

**Architecture:** Módulo novo `firmware/src/snmp_agent.{h,cpp}` (namespace `snmp_agent`), independente de `net.cpp`. `main.cpp::loop()` (core 1, roda a ~200Hz, nunca bloqueia) chama `snmp_agent::loop()` a cada iteração pra processar pacotes UDP, e `snmp_agent::update()` sempre que um `net::Event` novo estiver disponível na fila que a UI já consome. A task de rede (`net.cpp`, core 0) não é tocada — ela pode bloquear segundos num request HTTP, então não é lugar seguro pra servir polls SNMP.

**Tech Stack:** PlatformIO, Arduino framework (ESP32), lib `0neblock/SNMP_Agent` (SNMPv2c).

## Global Constraints

- Community SNMP: `public` (spec, idêntico ao antigo).
- Base OID enterprise: `.1.3.6.1.4.1.49551.1.x` (spec, idêntico ao antigo — não mudar, quebra compatibilidade com templates Zabbix existentes).
- Escopo fechado em 6 variáveis: temp x10, umid x10, uptime, rssi, temp texto, umid texto. Nenhuma métrica nova (spec: "fora de escopo").
- Sem SNMP v3/autenticação — v2c aberto, igual ao antigo (spec).
- `snmp_agent::loop()` só pode ser chamado de `main.cpp::loop()` (core 1) — nunca de dentro de `net::task` (core 0), que bloqueia até ~8s em WiFi/HTTP.
- **Nota sobre testes:** este é firmware embarcado (ESP32/Arduino) sem framework de teste em host — não existe `pytest`/harness rodando fora do hardware neste projeto (confirmado: nenhum diretório `test/` em `firmware/`). A verificação "automática" de cada task é a compilação via PlatformIO (`pio run`); a verificação funcional final é manual, com `snmpget`/`snmpwalk` contra o device na rede, documentada no Passo final da Task 2.

---

## File Structure

- **Create** `firmware/src/snmp_agent.h` — API pública do módulo (`begin`, `update`, `loop`).
- **Create** `firmware/src/snmp_agent.cpp` — estado do agente SNMP (instância `SNMPAgent`, `WiFiUDP`, variáveis expostas) e os 6 handlers de OID.
- **Modify** `firmware/platformio.ini` — adiciona `0neblock/SNMP_Agent` em `lib_deps`.
- **Modify** `firmware/src/main.cpp` — chama `snmp_agent::begin()` no `setup()` e `snmp_agent::update()`/`snmp_agent::loop()` no `loop()`.

---

### Task 1: Módulo `snmp_agent` — registro dos OIDs e lógica de atualização

**Files:**
- Modify: `firmware/platformio.ini`
- Create: `firmware/src/snmp_agent.h`
- Create: `firmware/src/snmp_agent.cpp`

**Interfaces:**
- Consumes: `net::Event` (já definido em `firmware/src/net.h:18-24` — campos `status`, `hasReading`, `temp`, `hum`, `rssi`).
- Produces (usado pela Task 2):
  - `void snmp_agent::begin()`
  - `void snmp_agent::update(const net::Event& evt, uint32_t uptimeSeconds)`
  - `void snmp_agent::loop()`

- [ ] **Step 1: Adicionar a dependência da lib SNMP**

Em `firmware/platformio.ini`, dentro do bloco `lib_deps`, adicionar a linha (mantendo as demais):

```ini
lib_deps =
    adafruit/DHT sensor library@^1.4.6
    adafruit/Adafruit Unified Sensor@^1.1.14
    bblanchon/ArduinoJson@^7.2.1
    lvgl/lvgl@^8.3.11
    bodmer/TFT_eSPI@^2.5.43
    paulstoffregen/XPT2046_Touchscreen
    0neblock/SNMP_Agent@^2.1.0
```

- [ ] **Step 2: Criar o header `firmware/src/snmp_agent.h`**

```cpp
#pragma once
#include <Arduino.h>

#include "net.h"

// Agente SNMPv2c somente leitura (porta 161/UDP) pro Zabbix. Base OID enterprise
// .1.3.6.1.4.1.49551.1.x — idêntica ao firmware antigo (antigo/precog_cyd.ino),
// pra manter compatibilidade com qualquer template Zabbix já configurado.
namespace snmp_agent {

// Abre o socket UDP na porta 161 e registra os 6 OIDs. Não espera WiFi conectar —
// pode (e deve) ser chamado no setup() antes da rede subir.
void begin();

// Atualiza os valores expostos via SNMP. RSSI é sempre atualizado a partir de
// evt.rssi; temperatura/umidade só são sobrescritas quando evt.hasReading é true
// (mantém a última leitura válida entre ciclos, igual ao firmware antigo).
void update(const net::Event& evt, uint32_t uptimeSeconds);

// Processa pacotes SNMP pendentes (GET/GETNEXT). Chamar em loop apertado e nunca
// bloqueante — nunca dentro da task de rede (net.cpp), que pode ficar segundos
// bloqueada num request HTTP.
void loop();

}  // namespace snmp_agent
```

- [ ] **Step 3: Criar a implementação `firmware/src/snmp_agent.cpp`**

```cpp
#include "snmp_agent.h"

#include <SNMP_Agent.h>
#include <WiFiUdp.h>

namespace snmp_agent {

// ─── OIDs (base enterprise privada, idêntica ao firmware antigo) ────────────
//   .1.3.6.1.4.1.49551.1.1.0  temperatura  (INTEGER, valor x10 -> 23.4C = 234)
//   .1.3.6.1.4.1.49551.1.2.0  umidade      (INTEGER, valor x10 -> 55.0% = 550)
//   .1.3.6.1.4.1.49551.1.3.0  uptime       (INTEGER, segundos)
//   .1.3.6.1.4.1.49551.1.4.0  rssi         (INTEGER, dBm, negativo)
//   .1.3.6.1.4.1.49551.1.5.0  temperatura  (STRING, ex. "23.4")
//   .1.3.6.1.4.1.49551.1.6.0  umidade      (STRING, ex. "55.0")
static const char* COMMUNITY = "public";

static WiFiUDP udp;
static SNMPAgent snmp(COMMUNITY);

static int tempX10 = 0;
static int humX10 = 0;
static int uptimeSVar = 0;
static int rssiVar = 0;
static char tempStr[8] = "---";
static char humStr[8] = "---";
static char* tempStrPtr = tempStr;
static char* humStrPtr = humStr;

void begin() {
  snmp.setUDP(&udp);
  snmp.addIntegerHandler(".1.3.6.1.4.1.49551.1.1.0", &tempX10);
  snmp.addIntegerHandler(".1.3.6.1.4.1.49551.1.2.0", &humX10);
  snmp.addIntegerHandler(".1.3.6.1.4.1.49551.1.3.0", &uptimeSVar);
  snmp.addIntegerHandler(".1.3.6.1.4.1.49551.1.4.0", &rssiVar);
  snmp.addReadWriteStringHandler(".1.3.6.1.4.1.49551.1.5.0", &tempStrPtr, sizeof(tempStr), false);
  snmp.addReadWriteStringHandler(".1.3.6.1.4.1.49551.1.6.0", &humStrPtr, sizeof(humStr), false);
  snmp.sortHandlers();  // necessário pra GETNEXT/walk funcionar
  snmp.begin();
}

void update(const net::Event& evt, uint32_t uptimeSeconds) {
  uptimeSVar = static_cast<int>(uptimeSeconds);
  rssiVar = evt.rssi;

  if (evt.hasReading) {
    tempX10 = lroundf(evt.temp * 10.0f);
    humX10 = lroundf(evt.hum * 10.0f);
    snprintf(tempStr, sizeof(tempStr), "%.1f", evt.temp);
    snprintf(humStr, sizeof(humStr), "%.1f", evt.hum);
  }
}

void loop() {
  snmp.loop();
}

}  // namespace snmp_agent
```

- [ ] **Step 4: Compilar pra verificar que o módulo novo não quebra a build**

Run: `python -m platformio run -d firmware` (usar o Python em `C:\Users\Anderson\AppData\Local\Python\bin\python.exe` se `python` não estiver no PATH)

Expected: `SUCCESS`, sem erros de compilação em `snmp_agent.cpp`. Nesse ponto o módulo ainda não é chamado por ninguém (Task 2 faz a integração), então nenhuma OID responde ainda — isso é esperado.

- [ ] **Step 5: Commit**

```bash
git add firmware/platformio.ini firmware/src/snmp_agent.h firmware/src/snmp_agent.cpp
git commit -m "feat: adiciona módulo snmp_agent com os OIDs do agente SNMP"
```

---

### Task 2: Integrar o agente SNMP no `main.cpp` e verificar end-to-end

**Files:**
- Modify: `firmware/src/main.cpp`

**Interfaces:**
- Consumes: `snmp_agent::begin()`, `snmp_agent::update(const net::Event&, uint32_t)`, `snmp_agent::loop()` (da Task 1).

- [ ] **Step 1: Incluir o header e chamar `begin()` no `setup()`**

Em `firmware/src/main.cpp`, adicionar o include no topo (junto aos demais):

```cpp
#include "net.h"
#include "snmp_agent.h"
#include "storage.h"
#include "ui.h"
```

E no `setup()`, logo após `net::begin(uiEventQueue);`:

```cpp
  uiEventQueue = xQueueCreate(1, sizeof(net::Event));
  net::begin(uiEventQueue);

  snmp_agent::begin();

  // LVGL/TFT_eSPI/touch — sempre no core 1 (este core), nunca tocado pela task de rede.
  ui::begin(uiEventQueue);
```

- [ ] **Step 2: Chamar `update()`/`loop()` no `loop()` principal**

Substituir o corpo de `loop()` em `firmware/src/main.cpp` por:

```cpp
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
```

- [ ] **Step 3: Compilar e checar o tamanho de flash**

Run: `python -m platformio run -d firmware`

Expected: `SUCCESS`. Anotar a linha `Flash:` do output — a lib `SNMP_Agent` é pequena (poucos KB); a build deve continuar folgada dentro dos ~697KB livres deixados pela mudança de partição (`min_spiffs`, já aplicada).

- [ ] **Step 4: Commit**

```bash
git add firmware/src/main.cpp
git commit -m "feat: liga o agente SNMP ao loop principal (core 1)"
```

- [ ] **Step 5: Verificação manual end-to-end (requer hardware na rede)**

Isso não é automatizável a partir daqui — precisa do device físico gravado e conectado no WiFi. Roteiro pra quem for validar:

1. Gravar o firmware no device (`pio run -t upload -d firmware`) e aguardar conectar no WiFi (LED/tela mostram status).
2. Descobrir o IP do device (tela de "Informações de rede" no menu, ou pelo roteador).
3. De uma máquina na mesma rede, com `net-snmp` instalado (`snmpget`/`snmpwalk`):

```bash
snmpwalk -v2c -c public <IP_DO_DEVICE> .1.3.6.1.4.1.49551.1
```

Expected: retorna as 6 variáveis. Logo após o boot (antes da primeira leitura do DHT chegar, ~10-60s), as INTEGER de temp/umidade vêm `0` e as STRING vêm `"---"` — depois da primeira leitura válida, passam a refletir os valores reais. `uptime` (`.1.3.6.1.4.1.49551.1.3.0`) deve estar sempre crescendo a cada `snmpwalk` sucessivo, mesmo sem leitura nova do sensor.

4. Cadastrar o device no Zabbix como host SNMP (community `public`, porta 161, os 6 OIDs acima) e confirmar que os itens coletam.

- [ ] **Step 6: Commit da verificação (se algum ajuste foi feito no roteiro acima)**

Só necessário se o Passo 5 revelar algum ajuste de código — nesse caso, voltar pra Task 1/2 conforme o caso, corrigir, recompilar (Step 3) e commitar.
