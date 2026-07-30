# Alerta de temperatura disparado que não virou ligação

**Data:** 2026-07-30
**Origem:** relato de campo — sensor **`proatus_F794`**
**Commits:** `9cfe6b2` (RED) → `fc244a7` (GREEN)

## Relato

> "o sensor proatus_F794 tem um alerta disparado de temperatura mas nao fez a ligacao"

## O que o código faz (e o que não fazia)

O alerta existe e o WhatsApp saiu — só a ligação não. Todo envio a contato passa por um ponto
único, `notifyContacts` em `alertService.ts`, e ali havia **duas saídas mudas** exclusivas do canal
de voz:

```ts
if (!channelEnabled) continue;   // contato com "voz" desmarcado — nada gravado
```

```ts
// em evaluateType, antes de chamar notifyContacts:
const channels = type === 'temperature' && texts.voice ? ['whatsapp', 'voice'] : ['whatsapp'];
//                                          ^ template sem texto de voz: 'voice' nem entra no laço
```

Nos dois casos a tela de Alertas mostrava o alerta disparado com **uma única linha de WhatsApp**.
Para o operador isso é indistinguível de:

- fila `notify-voice` do pg-boss travada,
- Twilio fora do ar ou credencial inválida,
- ou simplesmente o canal desligado no cadastro.

É a mesma classe de defeito já corrigida em `notifyAdmins` (ver
[defeito-sensor-sem-alerta.tdd.md](defeito-sensor-sem-alerta.tdd.md), `skipped_no_admin`): o envio
não sair é configuração; **o bug é o silêncio**.

O terceiro cenário — a ligação foi enfileirada e a Twilio recusou (telefone fora do formato E.164,
por exemplo) — **já era auditável**: a linha aparece como `failed` com o erro em Detalhe. É
justamente dele que os outros dois passam a poder ser distinguidos.

## Correção

Um guard no ponto único por onde todos os canais passam, gravando o motivo com o mesmo vocabulário
de `skipped_pref`/`skipped_window`/`skipped_no_admin`:

| Situação | Status gravado | Rótulo no painel |
|----------|----------------|------------------|
| Contato com o canal desmarcado no cadastro | `skipped_channel` | canal desligado no cadastro do contato |
| Template sem texto de voz | `skipped_no_voice_text` | sem texto de voz no template (Mensagens) |

A decisão sobre o texto de voz **saiu de quem monta `channels`** (três ternários duplicados, agora
deletados: `evaluateType`, `sendTest`, `sendContactTest`) e foi para dentro de `notifyContacts` —
o mesmo lugar que já auditava os outros motivos. Um guard cobre alerta de temperatura, teste de
dispositivo e teste de contato de uma vez; e como ele vale para os dois canais, WhatsApp
desmarcado também passa a deixar rastro.

Nada muda em quem recebe o quê: voz continua exclusiva de temperatura, só no disparo inicial
(nunca em renotify/resolve), e só com texto configurado.

## Jornadas de usuário

1. Como operador, quero saber **por que** um alerta de temperatura não virou ligação, sem abrir o
   banco nem os logs do servidor.
2. Como operador, quero que a ligação continue saindo normalmente quando o canal está ligado e o
   texto configurado — o rastro novo não pode custar a ligação.

## Especificação de testes

Runner: `npm test` (`vitest run` 3.2.7) em `server/`.

| # | O que fica garantido | Teste | Tipo | Resultado |
|---|----------------------|-------|------|-----------|
| 1 | Contato com o canal de voz desligado grava `skipped_channel` em vez de sumir em silêncio, não liga, e o WhatsApp continua saindo | `alertService.test.ts:canal de voz desligado no contato registra skipped_channel em vez de sumir em silêncio` | unit | PASS |
| 2 | Template de temperatura sem texto de voz grava `skipped_no_voice_text` e não liga | `alertService.test.ts:template de temperatura sem texto de voz registra skipped_no_voice_text` | unit | PASS |
| 3 | Canal ligado + texto configurado dispara WhatsApp e **uma** ligação, com o telefone e o texto certos | `alertService.test.ts:canal ligado e texto configurado dispara WhatsApp e ligação` | unit | PASS |

Regressões mantidas verdes pela suíte existente: histerese e transições fire/resolve/renotify,
`skipped_pref`/`skipped_window`, dedup de `createAlert`, cooldown de renotify, conectividade sem
voz, aviso antes do teste, e `skipped_no_admin`.

## Evidência RED → GREEN

**RED** (`9cfe6b2`, antes de tocar produção) — 2 falhas, ambas pelo motivo pretendido:

```
× evaluate — por que a ligação de temperatura não saiu > canal de voz desligado no contato
  registra skipped_channel em vez de sumir em silêncio
  → expected "spy" to be called with arguments: [ 70, 5, 'voice', 'skipped_channel' ]
     Number of calls: 1        (só a linha do whatsapp/queued)
× evaluate — por que a ligação de temperatura não saiu > template de temperatura sem texto de voz
  registra skipped_no_voice_text
  → expected "spy" to be called with arguments: [ 70, 5, 'voice', …(1) ]
     Number of calls: 1

Test Files  1 failed | 6 passed (7)
     Tests  2 failed | 93 passed (95)
```

O teste 3 (caminho feliz) já passava no RED — é guarda de regressão, não reprodutor.

**GREEN** (`fc244a7`):

```
Test Files  7 passed (7)
     Tests  95 passed (95)
```

Builds: `npm run build` (tsc) verde em `server/` e em `web/`.

## Cobertura

`npx vitest run --coverage` (v8), `server/`:

```
File               | % Stmts | % Branch | % Funcs | % Lines
alertService.ts    |   90.69 |    85.71 |   95.65 |   90.69
All files          |   31.72 |    87.38 |   39.68 |   31.72
```

O arquivo alterado está acima do limiar de 80% nas quatro métricas. O total global (31,72%) reflete
rotas e camada de banco sem teste — precede este trabalho e não foi ampliado aqui.

## Ação de campo necessária

O rastro novo só existe a partir do **próximo disparo**: o alerta que já está firing no
`proatus_F794` não ganha a linha retroativamente, e a ligação só sai no disparo inicial (nunca em
re-alerta). Para diagnosticar o caso atual, conferir na ordem:

1. **Clientes → contato → checkbox "voz"** — se estiver desmarcado, é `skipped_channel`.
2. **Mensagens → "Temperatura — disparo (e re-alerta)" → campo de voz** — se estiver vazio, é
   `skipped_no_voice_text`. O texto padrão é semeado no primeiro boot, mas `seedMessageTemplates`
   usa `ON CONFLICT DO NOTHING` e não tem backfill para `temperature_fire`: salvar esse template
   com o campo de voz em branco zera a ligação de todos os alertas de temperatura, para sempre.
3. **Alertas → linha de voz `failed`** — se existir, o problema é a Twilio; o erro está em Detalhe
   (telefone fora do E.164 é o mais comum: o WhatsApp tolera `(11) 99999-8888`, a Twilio não).

Para validar sem esperar a temperatura subir de novo, use **Clientes → contato → "Testar canal"**:
passa exatamente pela mesma engrenagem (`notifyContacts`), incluindo os dois guards novos.

## Lacunas conhecidas

- **Sem backfill de `temperature_fire.voice`**: um banco cujo template foi salvo com o campo de voz
  vazio continua sem ligar até alguém preencher no painel. Não foi adicionado backfill porque campo
  vazio também é uma escolha legítima do admin ("não quero ligação") — o que faltava era isso
  aparecer, e agora aparece.
- **Telefone não é validado como E.164** em `POST/PATCH /api/contacts` (só o placeholder do form
  pede o formato). Continua sendo detectado depois do fato, via `failed` da Twilio.
- **Validação em campo pendente**: confirmar no painel do `proatus_F794`, no próximo disparo de
  temperatura, qual das linhas aparece.
