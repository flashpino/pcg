# Integração do sensor Proatus com Zabbix (SNMP)

O sensor funciona como **agente SNMP v2c somente leitura** e responde na porta
**UDP 161**. Esta integração é opcional e independente do painel na nuvem — os
dois podem funcionar ao mesmo tempo, sobre a mesma leitura.

- **Protocolo:** SNMP v2c (somente leitura, sem escrita)
- **Porta:** UDP 161
- **Community:** `public`

> ⚠️ SNMP v2c não é criptografado. Mantenha o sensor em rede interna confiável e
> **nunca exponha a porta 161 à internet.**

---

## 1. Pré-requisitos

| Item | Descrição |
|------|-----------|
| IP do sensor | Visível na tela de informações de rede do aparelho. Use **IP fixo** (reserva de DHCP pelo MAC). |
| Servidor Zabbix | 6.0 LTS ou superior, com acesso de rede ao sensor. |
| Firewall | UDP **161** liberado do servidor Zabbix para o sensor. |
| Isolamento de AP | Desativado — com *client isolation* ligado o Zabbix não alcança o sensor. |
| Ferramenta de teste | `snmpget` (pacote `snmp` / `net-snmp`). |

Detalhes de rede no [documento de liberação de firewall](liberacao-firewall.md).

---

## 2. OIDs disponíveis

Base privada: `1.3.6.1.4.1.49551.1`

| OID completo | Dado | Tipo | Observação |
|--------------|------|------|------------|
| `.1.3.6.1.4.1.49551.1.1.0` | Temperatura | INTEGER | Valor **×10** (`234` = 23,4 °C) |
| `.1.3.6.1.4.1.49551.1.2.0` | Umidade | INTEGER | Valor **×10** (`550` = 55,0 %) |
| `.1.3.6.1.4.1.49551.1.3.0` | Uptime | INTEGER | Tempo ligado, em segundos |
| `.1.3.6.1.4.1.49551.1.4.0` | RSSI (sinal Wi-Fi) | INTEGER | dBm, valor negativo (`-62`) |
| `.1.3.6.1.4.1.49551.1.5.0` | Temperatura | STRING | Texto legível (`"23.4"`) |
| `.1.3.6.1.4.1.49551.1.6.0` | Umidade | STRING | Texto legível (`"55.0"`) |

Use os OIDs **INTEGER** no Zabbix, com multiplicador `0.1`. Eles permitem
gráficos e gatilhos numéricos. Os OIDs STRING servem para conferência manual.

**Temperatura e umidade respondem `0` (e `"---"` nas versões STRING) sempre que
não há leitura confiável** — seja antes da primeira medição após ligar, seja
porque o sensor falhou. O aparelho nunca repete a última leitura válida como se
fosse atual. Veja as implicações nos [gatilhos](#6-gatilhos-alertas).

---

## 3. Testar antes de configurar o Zabbix

```bash
# Temperatura (inteiro x10)
snmpget -v2c -c public <IP_DO_SENSOR> .1.3.6.1.4.1.49551.1.1.0

# Umidade como texto
snmpget -v2c -c public <IP_DO_SENSOR> .1.3.6.1.4.1.49551.1.6.0
```

Resposta esperada:

```
iso.3.6.1.4.1.49551.1.1.0 = INTEGER: 234
iso.3.6.1.4.1.49551.1.6.0 = STRING: "55.0"
```

Sem resposta? Verifique, nesta ordem: IP correto e aparelho conectado ao Wi-Fi;
UDP 161 liberado; isolamento de cliente desativado no AP; community exatamente
`public`.

---

## 4. Criar o host no Zabbix

**Data collection → Hosts → Create host**

| Campo | Valor |
|-------|-------|
| Host name | `Proatus-<local>` (ex.: `Proatus-CPD`) |
| Host groups | ex.: `Sensores Ambientais` |
| Interfaces → Add → **SNMP** | |
| ↳ IP address | IP do sensor |
| ↳ Port | `161` |
| ↳ SNMP version | `SNMPv2` |
| ↳ SNMP community | `public` |

---

## 5. Criar os itens

Em **Hosts → (seu host) → Items → Create item**.

### Temperatura

| Campo | Valor |
|-------|-------|
| Name | `Temperatura` |
| Type | `SNMP agent` |
| Key | `temp.proatus` |
| SNMP OID | `.1.3.6.1.4.1.49551.1.1.0` |
| Type of information | `Numeric (float)` |
| Units | `°C` |
| Update interval | `30s` |
| Preprocessing → Add | `Custom multiplier` = `0.1` |

### Umidade

| Campo | Valor |
|-------|-------|
| Name | `Umidade` |
| Type | `SNMP agent` |
| Key | `umid.proatus` |
| SNMP OID | `.1.3.6.1.4.1.49551.1.2.0` |
| Type of information | `Numeric (float)` |
| Units | `%` |
| Update interval | `30s` |
| Preprocessing → Add | `Custom multiplier` = `0.1` |

### Uptime

| Campo | Valor |
|-------|-------|
| Name | `Uptime` |
| Type | `SNMP agent` |
| Key | `uptime.proatus` |
| SNMP OID | `.1.3.6.1.4.1.49551.1.3.0` |
| Type of information | `Numeric (unsigned)` |
| Units | `s` |
| Update interval | `60s` |

### Sinal Wi-Fi (RSSI)

| Campo | Valor |
|-------|-------|
| Name | `Sinal WiFi (RSSI)` |
| Type | `SNMP agent` |
| Key | `rssi.proatus` |
| SNMP OID | `.1.3.6.1.4.1.49551.1.4.0` |
| Type of information | `Numeric (float)` |
| Units | `dBm` |
| Update interval | `60s` |

---

## 6. Gatilhos (alertas)

Em **Hosts → (seu host) → Triggers → Create trigger**. Substitua
`Proatus-CPD` pelo *Host name* real e ajuste os limites ao ambiente.

| Nome | Severidade | Expressão |
|------|-----------|-----------|
| **Sensor sem leitura** | High | `last(/Proatus-CPD/temp.proatus)=0` |
| Temperatura alta | High | `last(/Proatus-CPD/temp.proatus)>27` |
| Temperatura crítica | Disaster | `last(/Proatus-CPD/temp.proatus)>32` |
| Temperatura baixa | Warning | `last(/Proatus-CPD/temp.proatus)<15 and last(/Proatus-CPD/temp.proatus)<>0` |
| Umidade alta | High | `last(/Proatus-CPD/umid.proatus)>70` |
| Umidade baixa | Warning | `last(/Proatus-CPD/umid.proatus)<30 and last(/Proatus-CPD/umid.proatus)<>0` |
| Sensor sem resposta (rede) | High | `nodata(/Proatus-CPD/temp.proatus,5m)=1` |
| Sinal Wi-Fi fraco | Warning | `last(/Proatus-CPD/rssi.proatus)<-80` |
| Reinício inesperado | Information | `last(/Proatus-CPD/uptime.proatus)<300` |

### ⚠️ Os gatilhos de valor baixo precisam excluir o zero

Quando o sensor de temperatura falha, o firmware **zera** os OIDs de temperatura
e umidade (INTEGER `0`, STRING `"---"`) em vez de continuar servindo a última
leitura válida. É a garantia de que nenhum valor inventado sai do aparelho.

O efeito colateral é que `0` é uma temperatura *plausível*. Sem o `and ... <>0`,
o gatilho de temperatura baixa dispararia "Warning: 12 °C" toda vez que o sensor
quebrasse — escondendo a falha real de hardware atrás de um alerta ambiental
enganoso. Por isso os dois gatilhos de valor baixo carregam a exclusão, e o
gatilho de **sensor sem leitura** é quem reporta a falha, com a severidade certa.

### Os dois tipos de falha são diferentes

| Situação | O que o Zabbix vê | Gatilho que dispara |
|----------|-------------------|---------------------|
| Sensor de temperatura quebrado | Host responde; temperatura `0`, uptime e RSSI normais | Sensor sem leitura |
| Aparelho sem energia ou sem Wi-Fi | Host não responde, timeout | Sensor sem resposta (rede) |

> O painel em `painel.proatus.app` detecta as duas falhas por conta própria e as
> exibe como alerta de hardware. Estes gatilhos existem para quem monitora
> **apenas** por Zabbix não ficar cego.

---

## 7. Gráficos e painéis

- Temperatura e umidade geram histórico automaticamente.
- **Monitoring → Latest data**, filtrando pelo host, mostra os valores atuais.
- Para um painel: **Monitoring → Dashboards → Create dashboard**, adicione
  widgets do tipo *Graph* com os itens `Temperatura` e `Umidade`.

---

## 8. Resolução de problemas

| Sintoma | Causa provável | Solução |
|---------|----------------|---------|
| `Timeout` no `snmpget` | Firewall, IP errado ou isolamento de AP | Liberar UDP 161; conferir IP na tela do aparelho; desativar *client isolation* |
| Item em *Not supported* | OID ou community incorretos | Revisar o OID e a community `public` na interface SNMP |
| Temperatura aparece como `234` | Falta o multiplicador | Adicionar preprocessing `Custom multiplier = 0.1` |
| Valor `0` ou `"---"` logo após ligar | Ainda sem a primeira leitura | Aguardar ~30 s |
| Valor `0` ou `"---"` persistente | Sensor de temperatura com defeito | Verificar a tela do aparelho (mostra `--.-` e sinalização vermelha); acionar o suporte para troca |
| Alerta de "temperatura baixa" junto com valor `0` | Gatilho sem a exclusão `<>0` | Corrigir a expressão do gatilho (seção 6) |
| Sem dados após queda de Wi-Fi | Aparelho reconectando | Aguardar reconexão; conferir RSSI |
| IP mudou sozinho | Sem reserva de DHCP | Criar reserva pelo MAC do aparelho |

---

## 9. Resumo rápido

1. IP fixo no sensor (reserva de DHCP) e UDP 161 liberado.
2. Testar: `snmpget -v2c -c public <IP> .1.3.6.1.4.1.49551.1.1.0`
3. Criar host SNMPv2 no Zabbix (community `public`, porta 161).
4. Criar os itens de temperatura e umidade com multiplicador `0.1`.
5. Configurar os gatilhos — **incluindo o de leitura congelada**.
