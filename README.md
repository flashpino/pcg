# PCG — Monitoramento de Temperatura/Umidade

Sistema multi-cliente: ESP32-2432S028 (CYD) + DHT22 → backend Node/TypeScript → InfluxDB (existente), com painel React, alertas por WhatsApp (Evolution API) e ligação (Twilio), e OTA remoto.

## Estrutura

```
server/    backend Fastify (API, alertas, filas, OTA)
web/       painel React (Vite)
firmware/  PlatformIO — ESP32 CYD + DHT22 (build/upload/variantes de tela: firmware/README.md)
```

## Documentação de trabalho

- Plano completo: `.claude/PRPs/plans/iot-monitoramento-temperatura.plan.md`
- Progresso: `STATUS.md` (1 task = 1 sessão)
- Histórico por sessão: `docs/sessions/`
- Knowledge graph: `graphify-out/` (use `/graphify query "..."`)

## Setup na VPS

Pré-requisitos: Docker + Docker Compose, e um InfluxDB já rodando (não é provisionado por este projeto).

```bash
git clone <repo> pcg && cd pcg
cp .env.example .env   # preencher todas as variáveis (ver seção Envs abaixo)
docker compose up -d
curl localhost:3000/health   # {"db":"ok","influx":"ok","evolution":"..."}
```

O `docker compose up -d` sobe `postgres` (volume `pgdata`) e `server` (build local do `Dockerfile` da raiz, que faz build do painel React e do backend em estágios separados e serve os dois no mesmo processo Fastify). Firmwares publicados ficam no volume nomeado `firmware-bin` — sobrevive a `docker compose down`/redeploy.

**EasyPanel**: use o "App Service" apontando pro repo (builda o `Dockerfile` direto) + o serviço "Postgres" nativo do EasyPanel. Não cole o `docker-compose.yml` no "Compose Service" do EasyPanel — ele roda em Swarm, que não suporta `build:`, `env_file:` nem `depends_on: condition: service_healthy` (ver comentário no topo do arquivo).

No primeiro boot, o servidor roda a migração idempotente (`schema.sql`) e semeia o usuário admin com `ADMIN_EMAIL`/`ADMIN_PASSWORD`.

### Envs

Ver `.env.example` para a lista completa e comentada. Resumo:

| Variável | Para quê |
|---|---|
| `POSTGRES_PASSWORD` | senha do Postgres do compose |
| `INFLUX_URL`, `INFLUX_TOKEN`, `INFLUX_ORG`, `INFLUX_BUCKET` | InfluxDB já existente na VPS |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VOICE_FROM` | ligações de voz (alerta inicial) |
| `EVOLUTION_URL`, `EVOLUTION_APIKEY`, `EVOLUTION_INSTANCE` | WhatsApp (alertas, boas-vindas, teste semanal) |
| `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | login do painel |
| `WELCOME_TEMPLATE` | texto de boas-vindas (placeholder `{{name}}`) |
| `PORT` | porta do servidor (padrão 3000) |

Todas são obrigatórias — o servidor recusa subir (`process.exit(1)`) se faltar alguma.

## Provisionamento de um device novo

1. **Flashar**: copie `firmware/src/config.h.example` para `firmware/src/config.h` e preencha `SERVER_URL` (URL pública do servidor, com HTTPS) e `FW_VERSION` (versão que vai bater com a que vier a ser cadastrada no painel). `cd firmware && pio run -t upload`. O binário é universal — nenhum device-token ou WiFi vai compilado; o mesmo `.bin` serve qualquer sensor.
2. **Na tela do CYD** (sem recompilar nada):
   - 1º boot roda a calibração de touch (4 pontos nos cantos).
   - Sem credencial WiFi salva → abre direto o scan de redes; escolher rede na lista, digitar senha no teclado touch.
   - Ao conectar, o device faz `POST /api/provision {mac}` sozinho, recebe um token novo e salva no NVS. Segue para o dashboard.
3. **No painel** (aba Sensores): o device aparece como "(não reivindicado)" assim que a primeira leitura chega. Atribuir a um cliente, definir limites de temp/umidade — a partir daí os alertas ficam ativos.
4. Se o NVS for apagado (perde o token) com o MAC já cadastrado, o `/api/provision` responde 404 e a tela mostra "contate o suporte" com o MAC — admin remove o sensor antigo no painel e o device re-provisiona no próximo boot.

## Publicação de firmware (OTA)

1. Builda o `.bin` (`pio run` em `firmware/`, arquivo fica em `firmware/.pio/build/esp32dev/firmware.bin`) com um `FW_VERSION` novo em `config.h` — incrementar sempre, senão o device entra em loop de OTA (ver GOTCHA da Task 12).
2. Painel → aba **Firmware** → escolher versão (semver, ex `1.2.0`) e o `.bin` → enviar. O servidor valida o magic byte (`0xE9`, primeiro byte de um binário ESP32 válido) antes de aceitar.
3. Painel → aba **Sensores** → escolher a versão no dropdown "Firmware alvo" (ou botão "aplicar a todos" para propagar a todo o cliente).
4. No próximo ciclo de ingest, o servidor responde com `ota.url`; o device baixa e aplica via `HTTPUpdate` **só depois de drenar o buffer offline** (nunca faz OTA com leituras pendentes). A tela mostra "Atualizando..." com progresso.
