# TDD — sensor com DHT morto rotulado como "offline"

**Data:** 2026-07-28
**Origem:** incidente de campo no `proatus_B678` (cliente 2, CPD SP Supera), não um plano prévio.
As jornadas abaixo foram derivadas durante o diagnóstico.

## O incidente

Sensor aparecia "offline" no painel, mas estava com internet. Diagnóstico com evidência dos dois
lados:

| Evidência | Resultado |
|---|---|
| `sensors.last_seen_at` no Postgres | congelado às 17:00 UTC — 12605s (3h30) sem ingest |
| Sensor irmão `proatus_C528`, mesmo local | ingeriu há 30s — descarta queda de internet do site |
| SNMP `.1.3.6.1.4.1.49551.1.3.0` (uptime) | 396 → 404 → 412, avançando: device vivo |
| SNMP `.1.3.6.1.4.1.49551.1.4.0` (rssi) | −28 dBm: sinal excelente |
| SNMP `.1.3.6.1.4.1.49551.1.1.0` (temp ×10) | `0` em todas as amostras — nunca houve leitura válida |
| SNMP uptime ao longo de 13 min | 589s → TIMEOUT → **34s**: reboot aos ~600s |

O alerta disparado dizia *"Verificar: conexão com internet / equipamentos de rede / status do
provedor"* — mandando a equipe caçar um problema de rede inexistente. O defeito era o DHT22 no CN1.

### Causa raiz (duas, encadeadas)

1. **Hardware:** DHT22 do B678 parou de responder.
2. **Firmware:** sem leitura válida, `ringPush` nunca era chamado → `ringCount` ficava 0 → o laço
   `while (ringCount > 0)` de `net.cpp` nunca executava → `sendIngest()` **nunca** era chamado.
   Consequências: `last_seen_at` congelava (painel dizia "offline"), e `lastOkSendMs` — atualizado
   só dentro daquele laço — nunca avançava, fazendo o `ESP.restart()` de `INGEST_STALE_RESTART_MS`
   disparar a cada 10 min indefinidamente.

**Lacuna de design associada:** o server já tinha o template `hardware_fire` ("sem leitura válida
há mais de {{$segundos}}s. Verifique o dispositivo") — a mensagem certa —, mas ligado ao
`evaluateConnectivity`, virando cópia do alerta de conectividade. Não existia caminho para
"device online, sensor com defeito", porque `/api/ingest` exigia no mínimo 1 leitura válida.

## Jornadas

1. Como operador, quero que um sensor com o DHT quebrado apareça como **defeito de hardware**, não
   como "offline", para não mobilizar a equipe de rede à toa.
2. Como operador, quero que um device cujo sensor morreu **continue marcando presença**, para
   distinguir "device caiu" de "sensor caiu".
3. Como operador, quero que esse device **pare de reiniciar em loop**, já que reboot não conserta
   sensor queimado.
4. Como responsável pelo alerta, quero ser avisado **uma vez** por evento, não a cada heartbeat.

## Execução por tarefa

### Tarefa 1 — `evaluateHardware` no alertService

Novo caminho de alerta para "device vivo, sensor travado", espelhando `evaluateConnectivity`, com
fire/resolve apenas (sem renotify).

- **RED:** `npm test` → `TypeError: evaluateHardware is not a function` (4 testes)
- **GREEN:** `npm test` → 27/27 em `alertService.test.ts`

### Tarefa 2 — `isValidIngestReadings` na rota de ingest

Lote vazio passa a ser aceito **somente** com `sensor_stale: true`; teto de 400 preservado nos dois
casos; sem leituras não escreve no Influx nem avalia limites de temperatura/umidade.

- **RED:** `npx vitest run src/routes/ingest.test.ts` → 6 falhas,
  `TypeError: isValidIngestReadings is not a function`
- **GREEN:** 6/6 passando

### Tarefa 3 — heartbeat no firmware

`sendIngest(nullptr, 0, true)` quando o buffer está vazio e o sensor travado. OTA é permitido
nesse caminho (buffer vazio por definição, então o GOTCHA de "nunca OTA com buffer não-drenado"
está satisfeito) — é a única via de atualização que resta para um device com sensor morto.

- **Validação:** `py -m platformio run` nas duas variantes → SUCCESS
  (`dist/pcg-1.1.28-esp32dev.bin`, `dist/pcg-1.1.28-esp32dev-noinv.bin`)
- **Sem teste automatizado:** o firmware não tem harness de teste no projeto. Ver "Lacunas".

## Especificação de testes

| # | O que está garantido | Arquivo / teste | Tipo | Resultado |
|---|---|---|---|---|
| 1 | Sensor travado dispara alerta `hardware` (não `connectivity`) e notifica admin | `alertService.test.ts:dispara alerta de hardware...` | unit | PASS |
| 2 | Alerta resolve quando as leituras voltam | `alertService.test.ts:resolve o alerta quando as leituras voltam` | unit | PASS |
| 3 | Sensor saudável sem alerta firing não gera ruído | `alertService.test.ts:sensor saudável e sem alerta firing não faz nada` | unit | PASS |
| 4 | Já firing e ainda travado não re-notifica (sem spam a cada 60s) | `alertService.test.ts:já firing e ainda travado não re-notifica` | unit | PASS |
| 5 | Heartbeat sem leituras é aceito quando o device declara sensor travado | `ingest.test.ts:heartbeat sem leituras é aceito...` | unit | PASS |
| 6 | Lote vazio sem `sensor_stale` continua rejeitado | `ingest.test.ts:lote vazio sem declaração...` | unit | PASS |
| 7 | Leituras válidas passam normalmente | `ingest.test.ts:leituras válidas passam normalmente` | unit | PASS |
| 8 | Leitura fora de faixa é rejeitada | `ingest.test.ts:leitura fora de faixa é rejeitada` | unit | PASS |
| 9 | Teto de 400 vale mesmo com sensor travado | `ingest.test.ts:lote acima de 400 é rejeitado...` | unit | PASS |
| 10 | Sensor travado com leitura inválida junto é rejeitado | `ingest.test.ts:sensor travado com leitura inválida junto...` | unit | PASS |

**Comando de validação:** `npm test` em `server/` → **66/66 passando (7 arquivos)**.
**Typecheck:** `npx tsc --noEmit` → limpo (exit 0).

## Cobertura e lacunas conhecidas

- **Sem métrica de cobertura:** o projeto não tem script `test:coverage` nem `@vitest/coverage-*`
  instalado. Não rodei o gate de 80% do workflow — declarar um número aqui seria invenção.
- **`notifier.test.ts` exige `INFLUX_*` no ambiente.** Falha pré-existente, não introduzida por
  este trabalho: `influx.ts` instancia o cliente no load do módulo e lança `IllegalArgumentError:
  No url specified!`. Confirmado rodando com env dummy → 8/8 passam. `npm test` puro, sem env,
  falha nesse arquivo. Vale corrigir (lazy init, como `notifier.ts` já faz com o PgBoss).
- **Firmware sem teste automatizado.** A mudança em `net.cpp` foi validada só por compilação nas
  duas variantes. A prova comportamental veio do próprio incidente (SNMP capturando o reboot aos
  ~600s), não de um teste. Um harness nativo para a lógica de decisão de envio cobriria isso.
- **`FW_VERSION` mora em arquivo gitignored** (`firmware/src/config.h`, junto com a URL real do
  servidor). O bump 1.1.27 → 1.1.28 não vai no git; `config.h.example` está parado em 1.0.0. Quem
  clonar o repo não tem como saber qual versão está em produção.
- **Não testado end-to-end:** o heartbeat não foi exercitado contra o servidor real. O device
  precisa receber o 1.1.28 por OTA para isso ser verificado em campo.

## Checkpoints

| Commit | Estágio |
|---|---|
| `623869e` | RED — reprodução, 10 testes falhando pela causa pretendida |
| `c42dde3` | GREEN — server (66/66, tsc limpo) |
| `985cd85` | Firmware — heartbeat + bump de versão, compila nas duas variantes |
