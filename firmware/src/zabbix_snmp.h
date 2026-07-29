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

// Atualiza os valores expostos via SNMP. RSSI e uptime são sempre atualizados.
// Temperatura/umidade seguem três estados, nunca um número inventado:
//   evt.hasReading   -> valor novo
//   evt.sensorStale  -> sentinela de "sem leitura" (INTEGER -9999, STRING "---"),
//                       igual ao pré-boot — valor impossível, nunca um plausível
//   nenhum dos dois  -> mantém o último valor (falha isolada de leitura, <30s)
void update(const net::Event& evt, uint32_t uptimeSeconds);

// Processa pacotes SNMP pendentes (GET/GETNEXT). Chamar em loop apertado e nunca
// bloqueante — nunca dentro da task de rede (net.cpp), que pode ficar segundos
// bloqueada num request HTTP.
void loop();

}  // namespace snmp_agent
