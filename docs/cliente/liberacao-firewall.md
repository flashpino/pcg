# Liberação de rede para os sensores Proatus

Documento para a equipe de TI da rede onde os sensores serão instalados.

O sensor é um dispositivo de temperatura e umidade que envia leituras para um
servidor na nuvem. Ele **inicia todas as conexões de dentro para fora** — nenhuma
porta precisa ser aberta vindo da internet.

---

## 1. Liberação de saída (obrigatório)

| O quê | Destino | Protocolo / Porta |
|-------|---------|-------------------|
| Telemetria, provisionamento e atualização de firmware | `painel.proatus.app` | TCP **443** (HTTPS) |
| Resolução de nome | servidor DNS da rede | UDP/TCP **53** |
| Sincronismo de relógio | `pool.ntp.org`, `time.nist.gov` | UDP **123** |

**Libere por nome (FQDN), não por IP.** O servidor é hospedado em nuvem e o
endereço IP muda sem aviso prévio. Se a política exigir liberação por IP, o
pedido correto é o wildcard `*.proatus.app`.

O NTP serve apenas para exibir a hora correta na tela do aparelho. Se não for
liberado, o sensor continua funcionando e enviando dados normalmente.

---

## 2. Liberação de entrada (apenas se houver Zabbix)

Necessária somente se o cliente quiser monitorar o sensor pelo Zabbix local.
Consulte também o [manual de integração com Zabbix](zabbix.md).

| O quê | Origem → Destino | Protocolo / Porta |
|-------|------------------|-------------------|
| Consulta SNMP | servidor Zabbix → IP do sensor | UDP **161** |

Nesse cenário também é necessário:

- **Desativar isolamento de cliente** (*client isolation* / *AP isolation*) no
  ponto de acesso Wi-Fi — com ele ligado, o Zabbix não enxerga o sensor.
- **Reservar IP fixo por DHCP** para o MAC do sensor. O MAC aparece na tela de
  informações de rede do próprio aparelho.

---

## 3. Requisitos da rede Wi-Fi

| Requisito | Detalhe |
|-----------|---------|
| **Banda 2,4 GHz** | O hardware não opera em 5 GHz. Se a rede usa o mesmo SSID nas duas bandas, funciona normalmente — desde que 2,4 GHz esteja ativo. |
| **WPA2-PSK** | Autenticação por senha simples. |
| **Sem proxy explícito** | O aparelho não suporta configuração de proxy HTTP; precisa sair direto na porta 443. |

**Não é compatível com:**

- WPA2/WPA3-Enterprise (802.1X, autenticação por usuário e senha)
- Portal cativo (tela de aceite de termos no navegador)
- Redes exclusivamente WPA3

Se houver filtro de MAC, os endereços de cada sensor precisam ser cadastrados.

---

## 4. Volume de tráfego

| Item | Valor |
|------|-------|
| Envio de leituras | 1 requisição a cada 60 segundos, poucos KB |
| Consumo mensal | ~2 MB por sensor |
| Atualização de firmware | ~1,5 MB, ocasional (algumas vezes ao ano) |

---

## 5. Perguntas frequentes de segurança

**O sensor acessa algum recurso da rede interna?**
Não. Ele fala exclusivamente com `painel.proatus.app`. Não varre a rede, não
acessa compartilhamentos, não consulta serviços internos.

**Que dados trafegam?**
Temperatura, umidade, intensidade do sinal Wi-Fi, tempo ligado, versão do
firmware e o nome atribuído ao sensor. Nenhum dado do ambiente do cliente.

**A comunicação é criptografada?**
Sim, TLS na porta 443. Observação técnica: o firmware atual não valida a cadeia
de certificados do servidor, o que significa que ele opera normalmente em redes
com inspeção TLS transparente. Caso a política de segurança exija validação
estrita de certificado, entre em contato — há uma variante do firmware com o
certificado fixado.

**Precisamos abrir alguma porta de entrada vinda da internet?**
Não. Nenhuma.

---

## 6. Resumo para copiar e colar

```
Liberação de saída para o dispositivo (IP do sensor ou VLAN de IoT):

  - HTTPS  TCP 443  ->  painel.proatus.app
  - DNS    UDP 53   ->  DNS interno
  - NTP    UDP 123  ->  pool.ntp.org, time.nist.gov

Wi-Fi: 2,4 GHz, WPA2-PSK, sem portal cativo, sem 802.1X.

Se houver monitoramento via Zabbix, adicionar:
  - SNMP   UDP 161  ->  do servidor Zabbix para o IP do sensor
  - Desativar isolamento de cliente no AP
  - Reserva de DHCP para o MAC do sensor
```
