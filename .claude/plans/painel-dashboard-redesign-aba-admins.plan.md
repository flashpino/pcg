# Plan: Aba Admins

**Source PRD**: `.claude/prds/painel-dashboard-redesign.prd.md`
**Selected Milestone**: #3 — Aba Admins
**Complexity**: Small

## Summary
CRUD de usuários administradores pelo painel. Hoje só existe 1 admin, semeado via `ADMIN_EMAIL`/`ADMIN_PASSWORD` (`server/src/db/index.ts:seedAdmin`), sem rota de gestão. Todo admin tem acesso total (decisão já registrada no PRD, seção Out of scope: "Permissões granulares por admin... não pedido") — não existe conceito de super-admin, então qualquer admin pode criar/remover outro. Única regra de negócio nova: nunca deixar o sistema sem nenhum admin (bloqueio de auto-lockout).

## Patterns to Mirror
| Category | Source | Pattern |
|---|---|---|
| Hash de senha | `server/src/db/index.ts:seedAdmin` (`bcrypt.hash(password, 10)`) | Mesmo custo de hash, mesma lib (`bcryptjs`) |
| Rota CRUD simples | `server/src/routes/clients.ts` | Handler fino, validação de campo obrigatório com `Object.assign(new Error(...), {statusCode})` |
| Página CRUD (lista + form) | `web/src/pages/ClientsPage.tsx` | `useEffect`+`api.get`, form inline, tabela com ação de remover |

## Files to Change
| File | Action | Why |
|---|---|---|
| `server/src/db/queries.ts` | UPDATE | `listUsers()` (só id/email, nunca `password_hash`), `createUserRecord(email, passwordHash)`, `deleteUser(id)`, `countUsers()` |
| `server/src/routes/admins.ts` | CREATE | `GET/POST/DELETE /api/admins` — POST faz `bcrypt.hash`, DELETE bloqueia se `countUsers() <= 1` (não pode remover o último admin) |
| `server/src/index.ts` | UPDATE | Registrar `adminsRoutes` |
| `web/src/pages/AdminsPage.tsx` | CREATE | Lista de admins (email) + form de criação (email/senha) + remover, mirror de `ClientsPage.tsx` |
| `web/src/App.tsx` | UPDATE | Nova aba "Admins" |

## Tasks
1. Queries novas em `queries.ts` (nunca selecionar `password_hash` de volta).
2. `routes/admins.ts`: `POST` valida email+senha (mínimo 8 chars), 409 se email já existe (`ON CONFLICT` ou catch de unique violation); `DELETE` recusa com 400 se for o último admin.
3. Registrar em `index.ts`.
4. `AdminsPage.tsx` + aba em `App.tsx`.
5. Validar: `npm test`/`tsc --noEmit`/`npm run build` no server e no web.

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| Admin remove a própria conta e perde acesso, mas ainda sobra ≥1 admin | Baixa | Aceitável — sem super-admin, é decisão do próprio admin; só o *último* é bloqueado |
