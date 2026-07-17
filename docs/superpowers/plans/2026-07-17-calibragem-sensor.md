# Calibragem de Sensor (wizard de offset) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um offset de calibragem de temperatura por sensor, calculado por um wizard onde o usuário informa a temperatura real (termômetro de referência) e o sistema calcula a diferença em relação à última leitura.

**Architecture:** Novo campo `sensors.temp_offset` (Postgres). Aplicado uma única vez, na borda de entrada (`/api/ingest`), somado a cada leitura antes de gravar no InfluxDB e antes de avaliar alertas — o resto do sistema (gráfico, alertas, mensagens) já lida com valor calibrado sem mudanças. Dois endpoints novos (`GET /api/sensors/:id/latest`, `POST /api/sensors/:id/calibrate`) e uma UI de wizard inline em `SensorsPage.tsx`, reaproveitando o padrão de card já usado pelo gráfico de leituras.

**Tech Stack:** Fastify + TypeScript (server), React + TypeScript (web), Postgres (`pg`), InfluxDB (`@influxdata/influxdb-client`), Vitest.

## Global Constraints

- Só temperatura (sem umidade) — fora de escopo por decisão do spec.
- Offset fixo, sem fator de escala/multiplicador.
- Migração de schema idempotente: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, seguindo o padrão já usado em `schema.sql` (ex. `contacts.active`).
- Sem framework de teste novo — Vitest, mesmo padrão de `messageTemplates.test.ts` e `scheduleWindow.test.ts`.
- Nenhum endpoint de rota tem teste automatizado hoje neste projeto (nenhum arquivo `routes/*.test.ts` existe) — as tasks de rota são verificadas por typecheck + leitura manual do diff, consistente com o padrão existente.

---

### Task 1: Coluna `temp_offset` e tipos

**Files:**
- Modify: `server/src/db/schema.sql`
- Modify: `server/src/db/queries.ts:99-116` (interface `Sensor`)
- Modify: `server/src/db/queries.ts:142-155` (interface `SensorUpdate`)

**Interfaces:**
- Produces: `Sensor.temp_offset: number` e `SensorUpdate.temp_offset?: number` — usados por todas as tasks seguintes.

- [ ] **Step 1: Adicionar a coluna no schema**

Em `server/src/db/schema.sql`, logo após a linha do comentário sobre `local` (linha 27-28: `-- Texto livre (...) ALTER TABLE sensors ADD COLUMN IF NOT EXISTS local TEXT;`), adicionar:

```sql
-- Ajuste fixo somado à leitura crua na ingestão, pra compensar erro sistemático do sensor
-- físico — calculado pelo wizard de calibragem (painel > Sensores), não editado à mão.
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS temp_offset NUMERIC NOT NULL DEFAULT 0;
```

- [ ] **Step 2: Adicionar o campo na interface `Sensor`**

Em `server/src/db/queries.ts`, dentro da interface `Sensor` (linhas 99-116), adicionar após `temp_max: number | null;`:

```typescript
export interface Sensor {
  id: number;
  client_id: number | null;
  name: string;
  mac: string;
  device_token: string;
  temp_min: number | null;
  temp_max: number | null;
  temp_offset: number;
  hum_min: number | null;
  hum_max: number | null;
  interval_seconds: number;
  offline_after_seconds: number;
  target_firmware: string | null;
  last_seen_at: string | null;
  last_firmware: string | null;
  local: string | null;
  created_at: string;
}
```

- [ ] **Step 3: Adicionar o campo na interface `SensorUpdate`**

Em `server/src/db/queries.ts`, dentro da interface `SensorUpdate` (linhas 142-155), adicionar após `temp_max?: number | null;`:

```typescript
export interface SensorUpdate {
  client_id?: number | null;
  name?: string;
  temp_min?: number | null;
  temp_max?: number | null;
  temp_offset?: number;
  hum_min?: number | null;
  hum_max?: number | null;
  interval_seconds?: number;
  offline_after_seconds?: number;
  target_firmware?: string | null;
  last_seen_at?: string;
  last_firmware?: string;
  local?: string | null;
}
```

`updateSensor` (linhas 157-165) já monta o `UPDATE` dinamicamente a partir das chaves do patch — não precisa de nenhuma mudança.

- [ ] **Step 4: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: sem erros (o resto do código usava `SELECT *`, então a coluna nova só amplia o tipo — nenhum outro arquivo quebra).

- [ ] **Step 5: Commit**

```bash
git add server/src/db/schema.sql server/src/db/queries.ts
git commit -m "feat: adiciona coluna temp_offset em sensors"
```

---

### Task 2: Função pura `calcOffset` (TDD)

**Files:**
- Create: `server/src/services/calibration.ts`
- Test: `server/src/services/calibration.test.ts`

**Interfaces:**
- Consumes: nenhuma (função pura, sem dependências).
- Produces: `calcOffset(currentOffset: number, reference: number, latestTemp: number): number` — usado pela Task 5 (endpoint `POST /calibrate`).

- [ ] **Step 1: Escrever o teste que falha**

Criar `server/src/services/calibration.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { calcOffset } from './calibration.js';

describe('calcOffset', () => {
  it('calibração inicial (offset atual 0)', () => {
    expect(calcOffset(0, 5, 4.2)).toBeCloseTo(0.8);
  });

  it('recalibração em cima de offset já existente', () => {
    expect(calcOffset(0.8, 5, 5.3)).toBeCloseTo(0.5);
  });

  it('leitura já bate com a referência: offset não muda', () => {
    expect(calcOffset(1.2, 10, 10)).toBeCloseTo(1.2);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd server && npx vitest run src/services/calibration.test.ts`
Expected: FAIL — `Cannot find module './calibration.js'` (o arquivo `calibration.ts` ainda não existe).

- [ ] **Step 3: Implementar `calcOffset`**

Criar `server/src/services/calibration.ts`:

```typescript
// Offset por sensor: soma-se à leitura crua na ingestão pra compensar erro sistemático do
// sensor físico. A conta é sempre relativa ao offset atual, então recalibrar um sensor que
// já tem offset aplicado continua correto (não duplica nem zera a correção anterior).
export function calcOffset(currentOffset: number, reference: number, latestTemp: number): number {
  return currentOffset + (reference - latestTemp);
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd server && npx vitest run src/services/calibration.test.ts`
Expected: `3 tests passed`

- [ ] **Step 5: Commit**

```bash
git add server/src/services/calibration.ts server/src/services/calibration.test.ts
git commit -m "feat: adiciona calcOffset para calibragem de sensor"
```

---

### Task 3: Aplicar o offset na ingestão

**Files:**
- Modify: `server/src/routes/ingest.ts`

**Interfaces:**
- Consumes: `Sensor.temp_offset: number` (Task 1); `Reading` de `server/src/services/influx.ts` (`{ temp: number; hum: number; rssi: number; ago_ms: number }`, sem mudança de forma — só o valor de `temp` muda antes de ser usado).
- Produces: nenhuma interface nova — o efeito é observável no Influx e nos alertas gerados a partir daqui.

- [ ] **Step 1: Somar o offset antes de gravar e avaliar**

Em `server/src/routes/ingest.ts`, o handler atual (linhas 25-59) grava `readings` cru e usa a leitura mais recente crua pra avaliar alerta. Substituir o trecho entre a validação de `fw` (linha 39) e o `return` final (linha 58) por:

```typescript
    if (typeof req.body.fw !== 'string' || !req.body.fw) {
      throw Object.assign(new Error('fw obrigatório'), { statusCode: 400 });
    }

    const calibrated = readings.map((r) => ({ ...r, temp: r.temp + sensor.temp_offset }));

    writeReadings(sensor.client_id, sensor.id, calibrated);
    try {
      await flushInflux();
    } catch (err) {
      throw Object.assign(new Error('falha ao escrever no influx'), { statusCode: 500, cause: err });
    }

    await updateSensor(sensor.id, { last_seen_at: new Date().toISOString(), last_firmware: req.body.fw });

    // Reading mais recente = menor ago_ms (o device manda em ordem, mas não assumir sem checar).
    const latest = calibrated.reduce((a, b) => (a.ago_ms <= b.ago_ms ? a : b));
    await evaluate(sensor, { temp: latest.temp, hum: latest.hum });

    const ota = sensor.target_firmware && sensor.target_firmware !== req.body.fw
      ? { version: sensor.target_firmware, url: `/api/ota/firmware/${sensor.target_firmware}.bin` }
      : undefined;

    return { ok: true, ota };
  });
}
```

A única mudança de comportamento: `writeReadings` e `evaluate` agora recebem `calibrated` (com offset somado) em vez de `readings` (cru). `isValidReading` continua validando o valor bruto vindo do device — a validação de faixa (`-60` a `100`) deve barrar leitura absurda antes do offset, não depois.

- [ ] **Step 2: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/ingest.ts
git commit -m "feat: aplica temp_offset na ingestao antes de gravar e avaliar alertas"
```

---

### Task 4: Endpoint `GET /api/sensors/:id/latest`

**Files:**
- Modify: `server/src/routes/sensors.ts`

**Interfaces:**
- Consumes: `queryLatestReadings(sensorIds: number[]): Promise<Map<number, LatestReading>>` de `server/src/services/influx.ts` (já existe, `LatestReading = { temperature: number | null; humidity: number | null; rssi: number | null; time: string }`).
- Produces: `GET /api/sensors/:id/latest` → `{ temperature: number | null; humidity: number | null; time: string | null }` — consumido pela UI na Task 6.

- [ ] **Step 1: Importar `queryLatestReadings` e adicionar a rota**

Em `server/src/routes/sensors.ts`, trocar o import de `influx.js` (linha 3) e adicionar a rota nova antes do fechamento da função (depois da rota `/readings`, linhas 30-34):

```typescript
import type { FastifyInstance } from 'fastify';
import { deleteSensor, getSensor, listSensors, updateSensor, type SensorUpdate } from '../db/queries.js';
import { queryLatestReadings, queryReadings } from '../services/influx.js';
```

```typescript
  app.get<{ Params: { id: string }; Querystring: { range?: string } }>('/api/sensors/:id/readings', async (req) => {
    const sensor = await getSensor(Number(req.params.id));
    if (!sensor) throw Object.assign(new Error('sensor não encontrado'), { statusCode: 404 });
    return queryReadings(sensor.id, req.query.range ?? '24h');
  });

  app.get<{ Params: { id: string } }>('/api/sensors/:id/latest', async (req) => {
    const sensor = await getSensor(Number(req.params.id));
    if (!sensor) throw Object.assign(new Error('sensor não encontrado'), { statusCode: 404 });
    const latest = (await queryLatestReadings([sensor.id])).get(sensor.id);
    return {
      temperature: latest?.temperature ?? null,
      humidity: latest?.humidity ?? null,
      time: latest?.time ?? null,
    };
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/sensors.ts
git commit -m "feat: adiciona GET /api/sensors/:id/latest"
```

---

### Task 5: Endpoint `POST /api/sensors/:id/calibrate`

**Files:**
- Modify: `server/src/routes/sensors.ts`

**Interfaces:**
- Consumes: `calcOffset` (Task 2); `Sensor.temp_offset`, `SensorUpdate.temp_offset` (Task 1); `queryLatestReadings` (já importado na Task 4).
- Produces: `POST /api/sensors/:id/calibrate` body `{ reference: number }` → `Sensor` atualizado — consumido pela UI na Task 6.

- [ ] **Step 1: Importar `calcOffset` e adicionar a rota**

Em `server/src/routes/sensors.ts`, adicionar o import e a rota nova logo após `/latest` (Task 4):

```typescript
import { calcOffset } from '../services/calibration.js';
```

```typescript
  app.post<{ Params: { id: string }; Body: { reference: number } }>('/api/sensors/:id/calibrate', async (req) => {
    const sensor = await getSensor(Number(req.params.id));
    if (!sensor) throw Object.assign(new Error('sensor não encontrado'), { statusCode: 404 });

    const reference = req.body?.reference;
    if (typeof reference !== 'number' || !Number.isFinite(reference)) {
      throw Object.assign(new Error('reference deve ser um número'), { statusCode: 400 });
    }

    const latest = (await queryLatestReadings([sensor.id])).get(sensor.id);
    if (latest?.temperature == null) {
      throw Object.assign(
        new Error('sensor sem leitura recente — calibragem exige pelo menos uma leitura'),
        { statusCode: 400 },
      );
    }

    const temp_offset = calcOffset(sensor.temp_offset, reference, latest.temperature);
    return updateSensor(sensor.id, { temp_offset });
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Rodar a suíte inteira do server**

Run: `cd server && npm test`
Expected: todos os testes existentes continuam passando (nenhum foi alterado, só arquivos novos/aditivos).

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/sensors.ts
git commit -m "feat: adiciona POST /api/sensors/:id/calibrate"
```

---

### Task 6: Wizard de calibragem em `SensorsPage.tsx`

**Files:**
- Modify: `web/src/pages/SensorsPage.tsx`

**Interfaces:**
- Consumes: `GET /api/sensors/:id/latest` → `{ temperature: number | null; humidity: number | null; time: string | null }` (Task 4); `POST /api/sensors/:id/calibrate` body `{ reference: number }` → `Sensor` (Task 5); `api.get`/`api.post` de `web/src/api.ts` (já existe).
- Produces: nenhuma — ponta final da feature.

- [ ] **Step 1: Adicionar `temp_offset` na interface `Sensor` do frontend**

Em `web/src/pages/SensorsPage.tsx`, na interface `Sensor` (linhas 10-25), adicionar após `temp_max: number | null;`:

```typescript
interface Sensor {
  id: number;
  client_id: number | null;
  name: string;
  mac: string;
  local: string | null;
  temp_min: number | null;
  temp_max: number | null;
  temp_offset: number;
  hum_min: number | null;
  hum_max: number | null;
  interval_seconds: number;
  offline_after_seconds: number;
  target_firmware: string | null;
  last_firmware: string | null;
  last_seen_at: string | null;
}
```

- [ ] **Step 2: Adicionar o tipo da leitura mais recente e o state do wizard**

Logo após a interface `Firmware` (linhas 33-35), adicionar:

```typescript
interface LatestReading {
  temperature: number | null;
  humidity: number | null;
  time: string | null;
}
```

Dentro do componente `SensorsPage`, após a declaração de `readings` (linha 49), adicionar:

```typescript
  const [calibrating, setCalibrating] = useState<number | null>(null);
  const [calibLatest, setCalibLatest] = useState<LatestReading | null>(null);
  const [calibReference, setCalibReference] = useState('');
```

- [ ] **Step 3: Buscar a leitura atual quando o wizard abre**

Logo após o `useEffect` que busca `readings` (linhas 59-65), adicionar:

```typescript
  useEffect(() => {
    if (calibrating === null) return;
    setCalibLatest(null);
    setCalibReference('');
    api
      .get<LatestReading>(`/api/sensors/${calibrating}/latest`)
      .then(setCalibLatest)
      .catch((err) => setError(err.message));
  }, [calibrating]);
```

- [ ] **Step 4: Handler de aplicar calibragem**

Logo após a função `applyToClient` (linhas 90-96), adicionar:

```typescript
  async function applyCalibration(sensor: Sensor) {
    setError(null);
    setMessage(null);
    try {
      const updated = await api.post<Sensor>(`/api/sensors/${sensor.id}/calibrate`, {
        reference: Number(calibReference),
      });
      setMessage(`Offset ajustado para ${updated.temp_offset}°C.`);
      setCalibrating(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'falha ao calibrar');
    }
  }
```

- [ ] **Step 5: Coluna "Calibragem" na tabela**

No `<thead>` (linhas 131-144), adicionar `<th>Calibragem</th>` depois de `<th>Hum min/max</th>`:

```tsx
            <th>Hum min/max</th>
            <th>Calibragem</th>
            <th>Firmware atual</th>
```

No `<tbody>`, depois do `<td>` de Hum min/max (linhas 194-208), adicionar a nova célula. O botão "Calibrar" abre o wizard e fecha o card de gráfico (mutuamente exclusivos); o botão "Gráfico" (linha 241-243) passa a fechar o wizard também:

```tsx
              <td>
                {s.temp_offset ? `${s.temp_offset > 0 ? '+' : ''}${s.temp_offset}°C` : '—'}{' '}
                <button
                  className="secondary"
                  onClick={() => {
                    setCalibrating(s.id);
                    setSelected(null);
                  }}
                >
                  Calibrar
                </button>
              </td>
```

Trocar o botão "Gráfico" existente:

```tsx
                <button
                  className="secondary"
                  onClick={() => {
                    setSelected(s.id);
                    setCalibrating(null);
                  }}
                >
                  Gráfico
                </button>{' '}
```

- [ ] **Step 6: Card inline do wizard**

Logo depois do bloco `{selected !== null && (...)}` (linhas 253-267), adicionar:

```tsx
      {calibrating !== null && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h3>Calibrar — {sensors.find((s) => s.id === calibrating)?.name}</h3>
          {calibLatest === null ? (
            <p>Carregando leitura atual…</p>
          ) : calibLatest.temperature === null ? (
            <p className="error">Sensor sem leitura recente — aguarde o próximo envio.</p>
          ) : (
            <>
              <p>Leitura atual: {calibLatest.temperature}°C</p>
              <label>
                Temperatura real (termômetro de referência):{' '}
                <input
                  type="number"
                  step="0.1"
                  value={calibReference}
                  onChange={(e) => setCalibReference(e.target.value)}
                />
              </label>{' '}
              <button
                disabled={calibReference === '' || Number.isNaN(Number(calibReference))}
                onClick={() => applyCalibration(sensors.find((s) => s.id === calibrating)!)}
              >
                Aplicar
              </button>{' '}
            </>
          )}
          <button className="secondary" onClick={() => setCalibrating(null)}>
            Cancelar
          </button>
        </div>
      )}
```

- [ ] **Step 7: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 8: Verificação manual na aplicação rodando**

Suba o server (`cd server && npm run dev`) e o web (`cd web && npm run dev`), abra a página Sensores, clique em "Calibrar" num sensor com leitura recente no Influx:
- Confirme que "Leitura atual" aparece.
- Digite uma temperatura de referência diferente e clique "Aplicar".
- Confirme a mensagem de sucesso, que a coluna "Calibragem" mostra o offset calculado, e que o card fecha.
- Clique "Calibrar" de novo no mesmo sensor e confirme que "Leitura atual" já reflete o offset aplicado (valor deslocado em relação à leitura crua anterior).

- [ ] **Step 9: Commit**

```bash
git add web/src/pages/SensorsPage.tsx
git commit -m "feat: wizard de calibragem de sensor na tela de Sensores"
```
