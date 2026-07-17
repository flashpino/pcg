# Calibragem de sensor (wizard de offset por referência)

## Problema

Sensores físicos de temperatura leem sistematicamente errado por alguns décimos de grau
(variação de fabricação do DHT22/sensor equivalente usado no firmware). Hoje não há como
compensar isso — o valor bruto do device vai direto pro histórico, pros alertas e pras
mensagens de WhatsApp.

## Solução

Um offset fixo por sensor (`temp_offset`), calculado por um wizard: o usuário informa a
temperatura real medida por um termômetro de referência, e o sistema calcula a diferença
em relação à última leitura do sensor.

Fora de escopo por ora: umidade (só temperatura, que é o que dispara alerta crítico) e
fator de escala/multiplicador (offset fixo cobre o caso real — sensor com erro
proporcional à faixa pode ser adicionado depois se aparecer).

## Dados

Nova coluna em `sensors` (schema.sql, migração idempotente `ALTER TABLE ... ADD COLUMN IF
NOT EXISTS`, seguindo o padrão já usado no arquivo):

```sql
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS temp_offset NUMERIC NOT NULL DEFAULT 0;
```

## Onde o offset é aplicado

Na ingestão (`server/src/routes/ingest.ts`), antes de gravar no Influx e antes de avaliar
alertas: cada leitura do lote recebido tem `temp_offset` somado ao `temp` bruto. A partir
daí, todo o resto do sistema (histórico no Influx, gráfico, `alertService`, variável
`{{$temperatura}}` nas mensagens) já lida com o valor calibrado sem nenhuma mudança —
o offset é aplicado uma única vez, na borda de entrada.

## API

Dois endpoints novos em `server/src/routes/sensors.ts`:

- **`GET /api/sensors/:id/latest`** — wrapper fino sobre `queryLatestReadings` (já existe
  em `influx.ts`). Retorna `{ temperature: number | null, humidity: number | null, time:
  string | null }` da leitura mais recente do sensor. Usado pelo wizard pra mostrar a
  leitura atual antes de calibrar.

- **`POST /api/sensors/:id/calibrate`** — body `{ reference: number }`.
  1. Busca a leitura mais recente do sensor (fresca, direto do Influx — não confia em
     valor que o cliente já tinha em tela, evita usar leitura desatualizada).
  2. Se não houver leitura, erro 400: "sensor sem leitura recente — calibragem exige
     pelo menos uma leitura".
  3. Calcula `newOffset = sensor.temp_offset + (reference - latest.temperature)` — função
     pura extraída (`calcOffset(currentOffset, reference, latest)`) pra poder testar sem
     subir servidor. A conta é relativa ao offset atual, então recalibrar um sensor que já
     tem offset aplicado continua correto (não duplica nem zera a correção anterior).
  4. Salva via `updateSensor(id, { temp_offset: newOffset })`.
  5. Retorna o sensor atualizado.

## UI

Em `web/src/pages/SensorsPage.tsx`:

- Nova coluna "Calibragem" na tabela: mostra o offset atual (`-0.5°C` ou `—` quando 0) e
  um botão "Calibrar".
- Ao clicar, abre um card inline (mesmo padrão do card de gráfico existente — novo state
  `calibrating: number | null`, mutuamente exclusivo com `selected` do gráfico pra não
  abrir os dois ao mesmo tempo):
  1. Busca e mostra "Leitura atual: 4.2°C" via `GET /latest`.
  2. Campo numérico "Temperatura real (termômetro de referência)".
  3. Botão "Aplicar" (desabilitado até o campo ter um número válido) → `POST /calibrate`
     → mensagem de sucesso "Offset ajustado para -0.5°C", fecha o card, recarrega a
     tabela de sensores.

### Erros

- Sem leitura recente: mensagem de erro no lugar do card, sem campo de input.
- Falha de rede/patch: mesmo padrão de erro já usado no resto da página
  (`runMutation` / `error` state).

## Teste

Um `it()` (Vitest, sem framework novo, mesmo padrão de `messageTemplates.test.ts`) cobrindo
`calcOffset`:

- calibração inicial (offset atual 0): `calcOffset(0, 5, 4.2)` → `0.8`.
- recalibração em cima de offset já existente: `calcOffset(0.8, 5, 5.3)` → `0.5`.

Não há teste de UI automatizado — mesmo padrão do resto do projeto (sem E2E configurado).
