# Defeito de sensor: temperatura fantasma no painel e alerta mudo

**Data:** 2026-07-29
**Origem:** relato de campo — sensor **"casa pino"**
**Commits:** `744c9f3` (RED) → `ae17d5e` (GREEN)

## Relato

> "o sensor casa pino esta falando que esta com erro de sensor no painel porem exibindo a
> temperatura, nao foi disparado nenhum alerta via whatsapp a informacao esta somente no painel"

Três sintomas num relato só, com **duas causas raiz independentes** no servidor.

## Causa raiz 1 — temperatura fantasma ao lado do chip de defeito

`readingForDisplay` só mascarava a leitura quando o sensor estava **offline**. Mas defeito de
hardware é exatamente o caso em que o device **não** está offline: desde `985cd85` o firmware manda
heartbeat com `sensor_stale: true` e lote vazio, o que mantém `last_seen_at` fresco de propósito
(pra ele não sumir do painel como se fosse queda de rede). Resultado: `online = true`, o Influx
devolve a última leitura gravada **antes** de o DHT calar, e o painel exibia esse valor como se
fosse a medição de agora — ao lado do banner "Sensor com defeito".

É o mesmo dado fantasma que já tinha sido eliminado nas outras duas saídas do sistema e só
sobreviveu nesta:

| Saída | Estado "sem leitura" | Corrigido em |
|-------|----------------------|--------------|
| Tela do device | `clearDashboardReading()` | `f4d0662` |
| SNMP / Zabbix | sentinela `-9999` / `"---"` | `7bbaa57` |
| **Painel web** | **exibia a última leitura válida** | **este trabalho** |

Corrigido na origem (`readingForDisplay`), não em cada tela: qualquer consumidor futuro da API
herda o mascaramento sem precisar lembrar de checar `hardware_fault`.

## Causa raiz 2 — o alerta não tinha como ser diagnosticado

O alerta de hardware **foi** criado (é o que acende o chip no painel), e `evaluateHardware` chamou
`notifyAdminsHardware` normalmente. O envio morre em `notifyAdmins`:

```ts
for (const admin of await listAdminsWithPhone()) { ... }   // lista vazia = laço não roda
```

Sem nenhum admin com telefone preenchido em **Admins**, o laço iterava vazio e **nada era gravado**.
No painel, um alerta com zero notifications é indistinguível de:

- fila do pg-boss travada,
- Evolution/WhatsApp fora do ar,
- ou simplesmente ninguém cadastrado pra receber.

O envio de fato não tem pra onde ir — isso é configuração, não bug. O bug é o silêncio: agora grava
`skipped_no_admin` (mesmo padrão de auditoria de `skipped_pref`/`skipped_window`), e a tela de
Alertas mostra "nenhum admin com telefone cadastrado". Vale para os três avisos operacionais que
passam por `notifyAdmins`: hardware, reinício e firmware.

**Ação de campo necessária:** preencher o telefone (E.164) de ao menos um admin em **Admins**. O
código não tem como suprir isso. Se já houver telefone cadastrado, o novo registro passa a
distinguir os outros dois cenários — a linha vai aparecer como `queued`/`failed` com o detalhe do
erro do Evolution, em vez de não aparecer.

## Jornadas de usuário

1. Como operador, quero que um sensor com defeito **não exiba temperatura nenhuma** no painel — um
   número velho ao lado de "sensor com defeito" é pior que nenhum número, porque parece medição.
2. Como operador, quero saber **por que** um alerta não virou WhatsApp, sem abrir o banco nem os
   logs do servidor.

## Especificação de testes

| # | O que fica garantido | Teste | Tipo | Resultado |
|---|----------------------|-------|------|-----------|
| 1 | Sensor com defeito de hardware não expõe temperatura, umidade, sinal nem horário — mesmo online por heartbeat e com leitura no Influx | `dashboardService.test.ts:defeito de hardware não entrega leitura, mesmo com o device online (heartbeat)` | unit | PASS |
| 2 | Alerta operacional sem nenhum admin com telefone grava `skipped_no_admin` em vez de sumir sem rastro, e não enfileira envio | `alertService.test.ts:sem nenhum admin com telefone registra o motivo em vez de sumir em silêncio` | unit | PASS |

Regressões cobertas pela suíte já existente e mantidas verdes: mascaramento por offline,
fire/resolve de hardware, streak de 3 ingests saudáveis contra flapping, e o não-anúncio de
"voltou a reportar" com defeito em curso.

## Evidência RED → GREEN

Runner: `npm test` (vitest 3.2.7) em `server/`.

**RED** (`744c9f3`, antes de tocar produção) — 2 falhas, ambas pelo motivo pretendido:

```
× readingForDisplay > defeito de hardware não entrega leitura, mesmo com o device online (heartbeat)
  → expected { temperature: 23.4, …(3) } to deeply equal { temperature: null, …(3) }
× evaluateHardware > sem nenhum admin com telefone registra o motivo em vez de sumir em silêncio
  → expected "spy" to be called with arguments: [ 56, null, 'whatsapp', …(1) ]
     Number of calls: 0

Test Files  3 failed | 4 passed (7)
     Tests  2 failed | 65 passed (67)
```

**GREEN** (`ae17d5e`):

```
Test Files  1 failed | 6 passed (7)
     Tests  67 passed (67)
```

Builds: `npm run build` (tsc) verde em `server/` e em `web/`.

## Lacunas conhecidas

- **`notifier.test.ts` falha na coleta**, não nos testes: `influx.ts` instancia o cliente no
  carregamento do módulo e `INFLUX_URL` não existe fora do `--env-file`. Verificado por `git stash`:
  falha idêntica no HEAD anterior (`7bbaa57`), sem relação com esta mudança. Fica como pendência à
  parte — o conserto é injetar/adiar o cliente do Influx, não mexer no teste.
- **Sem relatório de cobertura**: o projeto não tem script `test:coverage` nem `@vitest/coverage-*`
  instalado. Não foi adicionada dependência só para preencher este passo.
- **`healthyStreak` continua em memória** (ver comentário em `alertService.ts`): reinício do servidor
  atrasa um resolve em até ~3 min. Erra pro lado seguro, sem mudança aqui.
- **Validação em campo pendente**: confirmar no painel do "casa pino" que (a) a temperatura sumiu do
  card enquanto o defeito persistir e (b) a tela de Alertas mostra a linha do motivo. Requer o
  device físico com o DHT ainda defeituoso.
