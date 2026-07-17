# Suporte SNMP (Zabbix) no firmware — design

**Data:** 2026-07-16
**Status:** Aprovado

## Contexto

O `.ino` antigo (`antigo/precog_cyd.ino`) já tinha um agente SNMP v2c somente leitura
(porta 161/UDP, community `public`) expondo temperatura, umidade, uptime e RSSI, usando
a lib `0neblock/Arduino_SNMP` (`SNMP_Agent.h`). O firmware novo (`firmware/`), reescrito
com LVGL e arquitetura em duas tasks FreeRTOS (rede no core 0, UI no core 1), não tem
esse recurso. O objetivo é portar o agente SNMP para o firmware novo, mantendo
compatibilidade total com qualquer template/dashboard Zabbix já configurado contra o
antigo.

## Decisão

Replicar exatamente o esquema SNMP do firmware antigo: mesma community, mesma base OID
enterprise, mesmas 6 variáveis. Nenhuma métrica nova (heap livre, versão de firmware
etc.) — escopo idêntico ao original, sem expandir superfície.

## Arquitetura

Novo módulo `firmware/src/snmp_agent.{h,cpp}`, namespace `snmp_agent`, seguindo o
mesmo padrão dos módulos existentes (`net::`, `storage::`, `ui::`).

```cpp
namespace snmp_agent {
  void begin();                                          // registra os 6 OIDs, snmp.begin()
  void update(const net::Event& evt, uint32_t uptimeS);   // atualiza os valores expostos
  void loop();                                            // processa pacotes UDP pendentes
}
```

### Onde roda

No `.ino` antigo, o `loop()` era único e chamava `snmp.loop()` a cada iteração. No
firmware novo, a rede (WiFi/HTTP/OTA) roda numa task própria pinada no core 0
(`net::task` em `net.cpp`) que pode bloquear por até ~8s conectando WiFi ou esperando
uma requisição HTTPS. Se o agente SNMP rodasse dentro dessa task, o Zabbix daria
timeout de poll toda vez que a task de rede estivesse bloqueada num request.

Por isso `snmp_agent::loop()` entra em `main.cpp::loop()` (core 1), que já roda em
~200Hz (`delay(5)` por iteração) e nunca bloqueia — é o mesmo loop que hoje só chama
`ui::tick()`. Ele reaproveita o `net::Event` que o `main.cpp` já lê de `uiEventQueue`
(mesmo dado consumido pela UI), sem precisar de fila nova nem de tocar em `net.cpp`.

### Dependência

`lib_deps` em `firmware/platformio.ini` ganha `0neblock/Arduino_SNMP` (mesma lib do
antigo).

## OIDs expostos

Base enterprise privada `.1.3.6.1.4.1.49551.1.x`, idêntica ao antigo:

| OID | Tipo | Conteúdo |
|---|---|---|
| `.1.3.6.1.4.1.49551.1.1.0` | INTEGER | temperatura × 10 (23.4°C → 234) |
| `.1.3.6.1.4.1.49551.1.2.0` | INTEGER | umidade × 10 (55.0% → 550) |
| `.1.3.6.1.4.1.49551.1.3.0` | INTEGER | uptime em segundos |
| `.1.3.6.1.4.1.49551.1.4.0` | INTEGER | RSSI em dBm (negativo) |
| `.1.3.6.1.4.1.49551.1.5.0` | STRING | temperatura como texto (`"23.4"`) |
| `.1.3.6.1.4.1.49551.1.6.0` | STRING | umidade como texto (`"55.0"`) |

Community `public`, SNMP v2c, somente leitura (os handlers de string são
read-write só porque a lib exige esse tipo de handler para strings — não há write
real vindo de lugar nenhum).

## Comportamento sem dado

Sem leitura válida do DHT22 ainda (`evt.hasReading == false`) ou sem rede: os inteiros
ficam em `0` e as strings em `"---"`, igual ao comportamento do antigo.

## Fora de escopo

- Métricas novas (heap, versão de firmware, status de provisionamento) — não pedidas,
  não entram.
- SNMP v3 / autenticação — antigo era v2c sem segurança, mantém-se assim.
- Qualquer alteração em `net.cpp` ou na arquitetura de filas existente.
