# Instância do Evolution API trocável pelo painel

**Data:** 2026-09-16
**Origem:** pedido do usuário — "preciso que tenha uma opcao para eu trocar a instancia do
evolution api, caso tenha algum bloqueio pelo whatsapp eu trocar a instancia sem mexer no codigo"
**Commits:** `e15d3f4` (RED) → `411af62` (GREEN) → `a30e57a` (RED) → `1aa8da4` (GREEN) →
`5114172` (UI)

## Contexto

Antes: `EVOLUTION_URL`, `EVOLUTION_INSTANCE` e `EVOLUTION_APIKEY` eram lidos direto de
`process.env` em dois lugares (`sendWhatsapp` e `getEvolutionConnectionState`,
`server/src/services/notifier.ts`). Trocar de instância (ex. número bloqueado pela Meta) exigia
mudar a env e fazer redeploy.

Depois: a instância passa a ser resolvida por `evolutionInstance()`, que prioriza o valor salvo em
`app_settings` (chave `evolution_instance`, mesma tabela genérica já usada para
`test_schedule_dow`/`test_schedule_time`) e cai para `EVOLUTION_INSTANCE` (env) quando não há
valor salvo. `EVOLUTION_URL`/`EVOLUTION_APIKEY` continuam vindo só da env (não fazem parte do
pedido — trocar de instância dentro da mesma conta/servidor Evolution).

## User journeys

- Como admin, quero ver no painel qual instância do WhatsApp está configurada agora.
- Como admin, quero trocar a instância pelo painel (sem mexer em código/env/redeploy) quando o
  número atual é bloqueado pela Meta.
- Como sistema, ao enviar mensagem ou consultar o status de conexão, devo usar a instância salva
  no banco quando ela existir, e só cair para a env quando não houver nada salvo — para não quebrar
  instalações que nunca usaram o campo novo.

## Task report

| Tarefa | Validação | Resultado |
|---|---|---|
| `evolutionInstance()` prioriza `app_settings` sobre env em `getEvolutionConnectionState`/`sendWhatsapp` | `npx vitest run src/services/notifier.test.ts` | RED em `e15d3f4` (URL montada ainda usava a env antiga), GREEN em `411af62` |
| Rota `GET/PUT /api/settings/evolution-instance` | `npx vitest run src/routes/settings.test.ts` | RED em `a30e57a` (404, rota não existia), GREEN em `1aa8da4` |
| Campo no painel (`SensorsPage.tsx`) pra ler/salvar a instância | `npx esbuild src/pages/SensorsPage.tsx --bundle=false --outfile=scratch_check.js` (sintaxe) + `npx vitest run` do server passando (17 testes novos entre os 151) | OK, sem framework de teste no `web/` (só Playwright e2e e `tsc`/`vite build`) |

## Test specification

| # | O que é garantido | Teste | Tipo | Resultado |
|---|---|---|---|---|
| 1 | `getEvolutionConnectionState` usa a instância salva em `app_settings`, ignorando a env, quando existe | `server/src/services/notifier.test.ts:"usa a instância salva em app_settings, ignorando a env, quando existe"` | unit | PASS |
| 2 | Sem instância salva, cai para `EVOLUTION_INSTANCE` (env) | `server/src/services/notifier.test.ts:"cai para EVOLUTION_INSTANCE (env) quando não há instância salva no banco"` | unit | PASS |
| 3 | `GET /api/settings/evolution-instance` devolve o valor salvo | `server/src/routes/settings.test.ts:"devolve a instância salva em app_settings"` | integration | PASS |
| 4 | `GET` sem valor salvo devolve o default da env | `server/src/routes/settings.test.ts:"sem valor salvo, devolve o default da env EVOLUTION_INSTANCE"` | integration | PASS |
| 5 | `PUT` salva a nova instância via `setSetting('evolution_instance', ...)` | `server/src/routes/settings.test.ts:"salva a nova instância"` | integration | PASS |
| 6 | `PUT` com instância vazia/só espaço é rejeitado com 400, sem gravar | `server/src/routes/settings.test.ts:"rejeita instância vazia"` | integration | PASS |

Evidência: `cd server && npx vitest run` → `Test Files 10 passed (10)` / `Tests 151 passed (151)`
(rodado com `--exclude '**/authz.test.ts'`, ver gap abaixo).

## Cobertura e gaps conhecidos

- `sendWhatsapp` (privada, worker da fila) reusa a mesma função `evolutionInstance()` validada por
  `getEvolutionConnectionState` — não tem teste unitário direto porque não é exportada; validado
  por leitura de código (mesma chamada, mesmo helper).
- **Gap pré-existente, fora de escopo:** `server/src/authz.test.ts` tem um erro de sintaxe
  (`Unterminated template literal`) que já existia antes desta mudança (não tocado neste commit) e
  quebra `npx tsc --noEmit` / `vitest run` sem `--exclude`. Não foi corrigido aqui.
- **Achado à parte, fora de escopo:** `web/src/pages/SupervisorsPage.tsx` está com conteúdo binário
  corrompido no disco local (hash do working tree diferente do commit em HEAD; `git status`/`git
  diff` não detectam a diferença), o que quebra `npm run build` (`tsc --noEmit`) no `web/`. Não
  editado nem corrigido — sinalizado ao usuário na sessão, não neste relatório de teste.
- Sem teste automatizado da UI (não há Vitest/RTL configurado em `web/`, só Playwright e2e e
  `tsc`/`vite build`); validado por `esbuild` isolado no arquivo editado.
