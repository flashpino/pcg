# PCG — Monitoramento de Temperatura/Umidade

Sistema multi-cliente: ESP32-2432S028 (CYD) + DHT22 → backend Node/TypeScript → InfluxDB (existente), com painel React, alertas por WhatsApp (Evolution API) e ligação (Twilio), e OTA remoto.

## Estrutura

```
server/    backend Fastify (API, alertas, filas, OTA)
web/       painel React (Vite)
firmware/  PlatformIO — ESP32 CYD + DHT22
```

## Documentação de trabalho

- Plano completo: `.claude/PRPs/plans/iot-monitoramento-temperatura.plan.md`
- Progresso: `STATUS.md` (1 task = 1 sessão)
- Histórico por sessão: `docs/sessions/`
- Knowledge graph: `graphify-out/` (use `/graphify query "..."`)

## Setup rápido

```bash
cp .env.example .env   # preencher credenciais (Influx, Twilio, Evolution)
docker compose up -d
```

Detalhes de deploy, provisionamento de devices e publicação de firmware serão escritos na Task 15.
