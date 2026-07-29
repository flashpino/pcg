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

Antes de qualquer leitura válida, temperatura e umidade respondem `0` e as
versões STRING respondem `"---"`.

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
| Temperatura alta | High | `last(/Proatus-CPD/temp.proatus)>27` |
| Temperatura crítica | Disaster | `last(/Proatus-CPD/temp.proatus)>32` |
| Temperatura baixa | Warning | `last(/Proatus-CPD/temp.proatus)<15` |
| Umidade alta | High | `last(/Proatus-CPD/umid.proatus)>70` |
| Umidade baixa | Warning | `last(/Proatus-CPD/umid.proatus)<30` |
| Sensor sem resposta | High | `nodata(/Proatus-CPD/temp.proatus,5m)=1` |
| Sinal Wi-Fi fraco | Warning | `last(/Proatus-CPD/rssi.proatus)<-80` |
| **Leitura congelada** | High | `min(/Proatus-CPD/temp.proatus,45m)=max(/Proatus-CPD/temp.proatus,45m)` |
| Reinício inesperado | Information | `last(/Proatus-CPD/uptime.proatus)<300` |

### Por que o gatilho de "leitura congelada" é necessário

Quando o sensor de temperatura falha, o firmware **para de atualizar os valores
SNMP, mas continua respondendo às consultas** com a última leitura válida. Uptime
e RSSI seguem se atualizando normalmente.

Do ponto de vista do Zabbix, o host parece perfeitamente saudável: responde no
prazo, sem timeout, com um valor plausível. O gatilho `nodata` **não dispara**
nesse cenário — não há ausência de dados, há dado velho.

O gatilho de leitura congelada cobre exatamente esse caso: se a temperatura não
variar **nem 0,1 °C em 45 minutos**, algo está errado. Ambientes reais sempre
oscilam um pouco, mesmo refrigerados. A janela de 45 minutos é deliberadamente
maior que os 30 minutos que o firmware espera antes de tentar se recuperar
sozinho reiniciando — assim o alerta não dispara durante uma recuperação normal.

> O painel em `painel.proatus.app` detecta essa falha por conta própria e a
> exibe como alerta de hardware. Quem monitora **apenas** por Zabbix depende
> deste gatilho para não ficar cego.

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
| Valor `0` ou `"---"` | Ainda sem leitura válida desde o boot | Aguardar ~30 s; se persistir, verificar o sensor na tela do aparelho |
| Valor válido mas **sempre idêntico** | Sensor travado — SNMP serve a última leitura | Ver o gatilho de leitura congelada (seção 6); trocar o sensor se persistir |
| Sem dados após queda de Wi-Fi | Aparelho reconectando | Aguardar reconexão; conferir RSSI |
| IP mudou sozinho | Sem reserva de DHCP | Criar reserva pelo MAC do aparelho |

---

## 9. Resumo rápido

1. IP fixo no sensor (reserva de DHCP) e UDP 161 liberado.
2. Testar: `snmpget -v2c -c public <IP> .1.3.6.1.4.1.49551.1.1.0`
3. Criar host SNMPv2 no Zabbix (community `public`, porta 161).
4. Criar os itens de temperatura e umidade com multiplicador `0.1`.
5. Configurar os gatilhos — **incluindo o de leitura congelada**.
