# Sessão Task 14 — OTA server-side (2026-07-15)

## Feito
- `server/src/db/queries.ts`: `Firmware`, `listFirmwares`, `getFirmwareByVersion`, `createFirmware` (a tabela `firmware` já existia em `schema.sql` desde as tasks iniciais).
- `server/src/routes/firmware.ts` (novo):
  - `GET /api/firmware` — lista (admin, JWT — não está em `PUBLIC_API_ROUTES`).
  - `POST /api/firmware` — upload multipart (`version` + `file`), valida magic byte ESP32 (`0xE9`), grava em `server/firmware-bin/<filename>` (cwd do processo — mesma pasta que o volume Docker `firmware-bin:/app/server/firmware-bin` já montava desde o `docker-compose.yml`), calcula sha256, `INSERT` em `firmware`. Rejeita versão duplicada (409).
  - `GET /api/ota/firmware/:version.bin` — pública (`index.ts` já tratava `/api/ota/*` como público desde a Task 12), autentica por `X-Device-Token` **ou** `?token=` (o firmware manda por querystring, decisão registrada em `net.cpp` na Task 13), valida contra `getSensorByToken`, faz stream do arquivo do disco.
- `server/src/index.ts`: registra `@fastify/multipart` (limite de 4MB — a partição do CYD é 1.25MB, ver Task 13) e `firmwareRoutes`.
- `server/package.json`: nova dependência `@fastify/multipart`.
- `web/src/pages/SensorsPage.tsx`: `target_firmware` virou `<select>` (populado por `GET /api/firmware`) em vez de `<input>` de texto livre; botão "aplicar a todos" faz `PATCH` em todos os sensores do mesmo `client_id` (sem endpoint novo no server — poucos sensores por cliente não justificam uma rota em lote).
- `web/src/pages/FirmwarePage.tsx`: já existia pronta desde a Task 11 esperando o backend; removido o aviso "endpoint ainda não existe" e o `load()` agora recarrega a lista após upload.

## Divergências do plano
- Nenhuma real. O plano já previa exatamente essa superfície (`GET/POST /api/firmware`, `GET /api/ota/firmware/:version.bin`); o trabalho desta sessão foi só implementar o que as Tasks 11/12/13 já haviam deixado como contrato (comentários no código, `isPublic()`, volume Docker, UI da página).

## Validações
- `cd server && npx tsc --noEmit` → **zero erros**.
- `cd server && npx vitest run` → **18/18 passam** (suites existentes, nada quebrado).
- `cd web && npx tsc --noEmit && npm run build` → **build ok**.
- **Pendência real, sem contorno possível nesta máquina**: não há Docker disponível neste ambiente (`docker`/`docker compose` não encontrados), então o VALIDATE de ponta a ponta do plano ("upload + curl do download com token confere sha256") não foi executado contra um servidor rodando de verdade. A rota foi revisada manualmente linha a linha contra o contrato já estabelecido pelo firmware (`net.cpp`) e pelo painel (`FirmwarePage.tsx`), mas fica como validação manual pendente na primeira subida real (local ou VPS).

## Contexto para a próxima sessão (Task 15 — Deploy + README)
- `Dockerfile` (raiz) e `docker-compose.yml` já existem e já cobrem o volume de firmware (`firmware-bin`) — não deveriam precisar de mudança para a Task 14 funcionar.
- Ao validar a Task 14 em ambiente real: `curl -F version=1.0.1 -F file=@build/firmware.bin -b cookie.txt localhost:3000/api/firmware`, depois `curl "localhost:3000/api/ota/firmware/1.0.1.bin?token=<device_token>" -o out.bin` e comparar sha256 com o retornado pelo POST.
- README (Task 15) deve documentar o fluxo de publicação de firmware: aba Firmware → upload → aba Sensores → escolher versão no dropdown (ou "aplicar a todos") → device pega no próximo ingest.
