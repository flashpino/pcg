#include "snmp_agent.h"

#include "../.pio/libdeps/esp32dev/SNMP_Agent/src/SNMP_Agent.h"
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

static int tempX10 = 0;
static int humX10 = 0;
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
  }
}

void loop() {
  snmp.loop();
}

}  // namespace snmp_agent
