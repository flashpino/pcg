# Sessão Task 9 — connectivitySweep (2026-07-15)

## Feito
- `server/src/services/alertService.ts`:
  - `AlertType` estendido para `'temperature' | 'humidity' | 'connectivity'` — `contactPrefOk` já roteava qualquer tipo fora de temperature/humidity para `alert_connectivity`, então não precisou mudar.
  - `decideBinaryTransition(bad, firing)`: versão sem histerese de `decideTransition`, para condições binárias (offline/online) em vez de valor+limite.
  - `evaluateConnectivity(sensor, offline)`: mesma máquina de estados de `evaluateType` (fire → dedup via índice parcial + notifica whatsapp+voz 1x; resolve → notifica whatsapp; renotify → notifica whatsapp com cooldown), reaproveitando `notifyContacts` — nenhuma duplicação de lógica de enfileiramento/preferência/janela.
- `server/src/db/queries.ts`: `createAlert` aceita `value: number | null` (conectividade não tem valor numérico; a coluna já era nullable no schema, só a assinatura TS estava mais estrita).
- `server/src/services/connectivitySweep.ts`: `startConnectivitySweep(log)` — roda `sweepOnce()` uma vez no boot e depois a cada 60s (`setInterval`). `sweepOnce()` lista todos os sensores, pula os não reivindicados (`client_id === null`) e os que nunca reportaram (`last_seen_at === null`, mesma semântica do `WHERE last_seen_at < ...` do plano — NULL nunca compara true), calcula offline por `last_seen_at + offline_after_seconds < agora`, chama `evaluateConnectivity`. Erro de qualquer sensor é capturado com `log.error` e não derruba o interval nem afeta os outros sensores (GOTCHA da Task 9).
- `server/src/index.ts`: `startConnectivitySweep(app.log)` chamado após `startNotifier()`.
- `server/src/services/alertService.test.ts`: 4 novos casos para `decideBinaryTransition` (dispara, não duplica/renotify, resolve sem histerese, online sem alerta = none). 18/18 no total.

## Divergências do plano
- Nenhuma relevante. A única decisão de implementação foi filtrar em JS em vez de replicar o `WHERE last_seen_at < now() - (offline_after_seconds || ' seconds')::interval` do plano em SQL — com ~50 sensores (escala definida no plano), rodar `listSensors()` (já existente) e calcular offline em memória é mais simples que uma query nova, sem custo perceptível.

## Validações
- `npx tsc --noEmit` → zero erros ✔
- `npx vitest run` → 18/18 ✔
- **Pendência** (igual Tasks 1-8b): sem Postgres real nesta máquina, o teste end-to-end da VALIDATE da Task 9 (sensor com `last_seen_at` antigo gera alerta; ingest posterior resolve) não foi validado ao vivo.

## Contexto para a próxima sessão (Task 10 — rotas de leitura + alertas para o painel)
- `GET /api/alerts?state=firing` vai precisar de uma query nova em `queries.ts` (não existe ainda — só temos `getFiringAlert` por sensor+tipo, não uma listagem geral com join em `notifications`).
- `GET /sensors/:id/readings?range=` é a primeira vez que o server consulta o InfluxDB de volta (até agora só escreve, em `services/influx.ts`) — vai precisar de um client de leitura (Flux) separado do `writeApi` existente.
