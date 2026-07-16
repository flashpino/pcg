# Plan: Contatos como sub-seção de Clientes

**Source PRD**: `.claude/prds/painel-dashboard-redesign.prd.md`
**Selected Milestone**: #2 — Contatos como sub-seção de Clientes
**Complexity**: Small

## Summary
Remove a aba top-level "Contatos" e move toda a UI de CRUD de contato pra dentro da tela de Clientes, como uma seção expansível por cliente. Nenhuma mudança de backend é necessária: `GET /api/contacts?clientId=`, `POST/PATCH /api/contacts` (já recebem `client_id` no body) e as rotas de `welcome`/`test` já existem e já são escopadas por cliente (`server/src/routes/contacts.ts`) — o milestone é 100% reorganização de frontend.

## Patterns to Mirror
| Category | Source | Pattern |
|---|---|---|
| Form + tabela CRUD | `web/src/pages/ContactsPage.tsx` (form controlado por `useState`, `EMPTY_FORM`, `edit`/`cancelEdit`/`submit`) | Reaproveitar a lógica inteira, só removendo o `<select>` de cliente (o `clientId` passa a vir de prop, fixo) |
| Fetch escopado por cliente | `server/src/routes/contacts.ts:25-28` (`GET /api/contacts?clientId=`) já existe | Usar com `clientId` fixo em vez de carregar todos os contatos |
| Estado local de expand/collapse | Nenhum precedente direto no código — `SensorsPage.tsx` usa `selected: number | null` pra mostrar/esconder o gráfico de um sensor (`SensorsPage.tsx:45,193`) | Mesmo padrão: `expandedClientId: number | null` em `ClientsPage.tsx`, um por vez |
| Estilo industrial | `web/src/index.css` (`.card`, `.inline`, tokens `--steel`/`--amber`) | Reusar, sem CSS novo além de um toggle simples |

## Files to Change
| File | Action | Why |
|---|---|---|
| `web/src/pages/ClientContacts.tsx` | CREATE | Extrai o form+tabela de `ContactsPage.tsx`, escopado a um `clientId` fixo (prop), sem o `<select>` de cliente e sem a coluna "Cliente" na tabela. Importado por `ClientsPage.tsx`. |
| `web/src/pages/ClientsPage.tsx` | UPDATE | Adiciona botão "▸ Contatos" por linha de cliente que expande `<ClientContacts clientId={c.id} />` abaixo da tabela (um cliente expandido por vez, via `expandedClientId`). |
| `web/src/pages/ContactsPage.tsx` | DELETE | Toda a funcionalidade foi absorvida por `ClientContacts.tsx`; página top-level deixa de existir. |
| `web/src/App.tsx` | UPDATE | Remove o import de `ContactsPage` e a entry `{ id: 'contacts', ... }` de `TABS`. |

Confirmado por Grep: `ContactsPage` só é importado em `web/src/App.tsx:6,14` — nenhum outro arquivo depende dela, seguro remover. `/api/contacts` (backend) continua igual — usado também por `alertService.ts`/`notifier.ts` via `listContacts(clientId)`, que não muda.

## Tasks

### Task 1: `ClientContacts.tsx`
- **Action**: Copiar a lógica de `ContactsPage.tsx` (form controlado, `EMPTY_FORM`, `edit`/`cancelEdit`/`submit`/`remove`/`sendWelcome`/`sendTest`) para um componente `ClientContacts({ clientId }: { clientId: number })`. Remover do form o `<select>` de cliente (client_id vem fixo da prop) e da tabela a coluna "Cliente". `load()` passa a chamar `api.get<Contact[]>('/api/contacts?clientId=' + clientId)`.
- **Mirror**: `ContactsPage.tsx` inteiro — só corta o que depende do cliente ser escolhível.
- **Validate**: `cd web && npx tsc --noEmit` sem erros de tipo.

### Task 2: Expand/collapse em `ClientsPage.tsx`
- **Action**: Adicionar `const [expandedClientId, setExpandedClientId] = useState<number | null>(null)`; na linha de cada cliente, um botão que faz `setExpandedClientId(expandedClientId === c.id ? null : c.id)`; abaixo da `<table>`, se `expandedClientId !== null`, renderizar `<ClientContacts clientId={expandedClientId} />` dentro de um `.card`.
- **Mirror**: `SensorsPage.tsx:45,193-207` (mesmo padrão de `selected`/render condicional abaixo da tabela).
- **Validate**: manual — clicar em "Contatos" de um cliente abre a seção, clicar de novo fecha.

### Task 3: Remover `ContactsPage.tsx` e a aba
- **Action**: Apagar `web/src/pages/ContactsPage.tsx`; em `App.tsx`, remover o import e a entry de `TABS`.
- **Mirror**: `App.tsx` já tem o padrão de lista `TABS` — só remover uma entry.
- **Validate**: `npm run build` no `web/` sem erro de import quebrado.

## Validation
```bash
cd web && npx tsc --noEmit
cd web && npm run build
```
Manual: logar no painel, ir em Clientes, expandir "Contatos" de um cliente existente, criar/editar/remover um contato, conferir que ele só existe dentro do cliente certo (testar com 2 clientes diferentes) e que a aba "Contatos" sumiu do menu.

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| Usuário tinha o hábito de ver todos os contatos de todos os clientes numa lista só (antiga aba Contatos sem filtro) | Baixa | PRD pede explicitamente essa mudança de hierarquia; se fizer falta, dá pra adicionar uma busca global depois — fora de escopo agora |
| `expandedClientId` compartilhado entre re-renders da lista de clientes pode conflitar se `ClientsPage` recarregar a lista (`load()`) enquanto uma seção está aberta | Baixa | `expandedClientId` guarda só o `id`, não o objeto `Client` — sobrevive a um `load()` que recria a lista |

## Acceptance
- [ ] Todas as tasks completas
- [ ] `web` builda sem erro
- [ ] Aba "Contatos" não existe mais no menu; contato só é criado/editado a partir da tela de um cliente específico
- [ ] Padrões mirrorados (form reaproveitado de `ContactsPage.tsx`, expand/collapse no estilo de `SensorsPage.tsx`)
