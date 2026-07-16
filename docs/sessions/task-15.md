# Sessão Task 15 — Deploy + README (2026-07-15)

## Feito
- `README.md`: substituído o placeholder "detalhes serão escritos na Task 15" por seções completas:
  - **Setup na VPS**: pré-requisitos, comandos (`git clone` → `.env` → `docker compose up -d` → `curl /health`), o que cada serviço do compose faz, nota EasyPanel (já existia como comentário no `docker-compose.yml`, agora também no README).
  - **Envs**: tabela resumo apontando para `.env.example` (fonte da verdade).
  - **Provisionamento de device novo**: flash (`config.h` a partir do `.example`, `pio run -t upload`) → fluxo 100% na tela (calibração → scan WiFi → auto-provision) → atribuição no painel → caso de recuperação (NVS apagado → 404 → re-provisionamento).
  - **Publicação de firmware (OTA)**: build do `.bin` com `FW_VERSION` novo → upload na aba Firmware → seleção do alvo na aba Sensores (dropdown/"aplicar a todos", da Task 14) → ciclo de ingest aplica o OTA.

## Divergências do plano
- `Dockerfile` multi-stage e `docker-compose.yml` já existiam prontos desde a Task 1 (build web → build server → runtime `node:22-alpine` copiando `web/dist`, volume `firmware-bin` já mapeado desde antes da Task 14 precisar dele) — nada para criar/alterar nessa parte, só documentar o que já estava implementado.

## Validações
- `cd server && npx tsc --noEmit` → zero erros.
- `cd server && npx vitest run` → 18/18 passam.
- `docker-compose.yml`/`Dockerfile` revisados manualmente linha a linha (sintaxe YAML/Dockerfile válida a olho).
- **Pendência real, sem contorno possível nesta máquina**: não há Docker instalado neste ambiente, então o VALIDATE do plano ("`docker compose up` na VPS; ingest de teste externo chega no Influx") não foi executado de ponta a ponta. Fica como validação manual na primeira subida real — mesma pendência já registrada na Task 14 para o fluxo de OTA.

## Estado do projeto
Todas as 16 sessões do plano (`.claude/PRPs/plans/iot-monitoramento-temperatura.plan.md`) estão implementadas e documentadas (Tasks 1–15, incluindo 8b). Os `Acceptance Criteria` e `Manual Validation` do plano que dependem de hardware físico (CYD real, ligação Twilio real, WiFi da VPS) permanecem como checklist de bancada — não verificáveis por código/CI, só em campo.
