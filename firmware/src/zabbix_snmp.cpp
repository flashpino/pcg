#include "zabbix_snmp.h"

#include <SNMP_Agent.h>
#include <WiFiUdp.h>

// ─── OIDs (base enterprise privada, idêntica ao firmware antigo) ────────────
//   .1.3.6.1.4.1.49551.1.1.0  temperatura  (INTEGER, valor x10 -> 23.4C = 234)
//   .1.3.6.1.4.1.49551.1.2.0  umidade      (INTEGER, valor x10 -> 55.0% = 550)
//   .1.3.6.1.4.1.49551.1.3.0  uptime       (INTEGER, segundos)
//   .1.3.6.1.4.1.49551.1.4.0  rssi         (INTEGER, dBm, negativo)
//   .1.3.6.1.4.1.49551.1.5.0  temperatura  (STRING, ex. "23.4")
//   .1.3.6.1.4.1.49551.1.6.0  umidade      (STRING, ex. "55.0")
static const char* SNMP_COMMUNITY = "public";

static WiFiUDP udp;
static SNMPAgent snmp(SNMP_COMMUNITY);

// Sentinela de "sem leitura". -999.9 (depois do multiplicador 0.1 no Zabbix) é impossível
// pra temperatura e umidade reais, então nenhum gatilho de faixa confunde defeito com
// medição. 0 não serve: 0°C é plausível e dispararia "temperatura baixa", trocando um
// alerta de hardware por um alerta ambiental enganoso — exatamente o dado falso que o
// aparelho não pode emitir. Vale também no pré-boot, antes da primeira leitura.
static const int NO_DATA_X10 = -9999;

static int tempX10 = NO_DATA_X10;
static int humX10 = NO_DATA_X10;
static int uptimeSVar = 0;
static int rssiVar = 0;
static char tempStr[8] = "---";
static char humStr[8] = "---";
static char* tempStrPtr = tempStr;
static char* humStrPtr = humStr;

namespace snmp_agent {

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
  } else if (evt.sensorStale) {
    // Sensor declarado travado. Antes daqui o agente seguia respondendo a última leitura
    // válida indefinidamente — e como uptime/RSSI continuam se atualizando, o Zabbix via
    // um host perfeitamente saudável servindo uma temperatura de horas atrás como se fosse
    // atual (nodata() nunca dispara: não falta dado, o dado é velho). Volta pro mesmo
    // estado "sem leitura" do pré-boot: nunca servir número inventado.
    tempX10 = NO_DATA_X10;
    humX10 = NO_DATA_X10;
    snprintf(tempStr, sizeof(tempStr), "---");
    snprintf(humStr, sizeof(humStr), "---");
  }
}

void loop() {
  snmp.loop();
}

}  // namespace snmp_agent
