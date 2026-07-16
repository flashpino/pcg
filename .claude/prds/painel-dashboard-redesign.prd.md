# Painel Web — Dashboard Consolidado e Reestruturação de Navegação

## Problem
O painel web hoje (Task 11) é só 6 abas de CRUD isoladas (Clients, Sensors, Contacts, Alerts, Firmware) sem nenhuma visão consolidada — pra saber se um sensor está OK, o admin precisa navegar entre abas. Contatos vive como aba própria, separada de Clientes, apesar de todo contato pertencer sempre a um cliente — a IA não reflete a hierarquia real dos dados. O visual atual é genérico/amador, sem identidade.

## Evidence
Assumption — decisão direta do dono do produto após ver um painel de referência (PrecogSystem) que resolve isso melhor. Uso interno (só admins), sem processo formal de validação com terceiros.

## Users
- **Primary**: Admins operacionais (mais de um vai existir — hoje só há 1 usuário seed via `ADMIN_EMAIL`/`ADMIN_PASSWORD`, sem CRUD de admins) que monitoram todos os clientes/sensores no dia a dia e precisam identificar rapidamente o status de qualquer sensor.
- **Secondary** (novo, dentro do escopo desta atualização): o cliente final (dono do sensor), que hoje não tem acesso a nada — vai ganhar uma tela própria, restrita aos seus próprios dados.
- **Not for**: qualquer usuário sem papel definido (público geral) — o portal do cliente é autenticado e restrito ao próprio cliente.

## Hypothesis
Acreditamos que um **Dashboard consolidado** (KPIs + cards de dispositivo em tempo real com status/WiFi/uptime + feed de eventos/alertas) somado a **mover Contatos para dentro de Clientes** vai reduzir o tempo pra diagnosticar um sensor para os admins que operam o sistema diariamente.
Saberemos que acertamos quando um admin conseguir identificar se qualquer sensor está OK em poucos segundos, direto do Dashboard, sem trocar de aba.

## Success Metrics
| Metric | Target | How measured |
|---|---|---|
| Tempo até identificar status de um sensor | ≤ poucos segundos, sem trocar de aba | Observação qualitativa de uso (sem instrumentação formal — ferramenta interna) |

## Scope

**MVP** — as 4 mudanças abaixo, na ordem dos Delivery Milestones:
1. Dashboard: KPIs (clientes ativos, sensores online/offline, alertas 7d) + cards por device (cliente, MAC, temp/umidade atual, status online/offline, sinal WiFi em dBm, uptime) + feed de eventos recentes + últimos alertas — réplica funcional da referência visual fornecida.
2. Contatos deixa de ser aba top-level e vira sub-seção dentro da tela de Clientes.
3. Nova aba **Admins**: CRUD de usuários administradores (hoje o sistema só tem 1 admin fixo via env, sem rota de gestão).
4. Novo **portal do cliente final**: login e visão restrita aos próprios sensores/leituras/alertas.

**Out of scope**
- Permissões granulares por admin (todo admin tem acesso total) — não pedido, complexidade sem necessidade agora.
- Tema claro/escuro alternável — não mencionado; visual industrial (já aplicado) fica fixo.
- Uptime "de hardware" garantidamente preciso — pode entrar como aproximação se o firmware não mandar uptime real ainda (ver Open Questions).

## Delivery Milestones
<!-- Business outcomes, not engineering tasks. /plan turns each into a plan. -->
<!-- Status: pending | in-progress | complete -->

| # | Milestone | Outcome | Status | Plan |
|---|---|---|---|---|
| 1 | Dashboard consolidado | Admin abre o painel e já vê KPIs + status de todo sensor + eventos recentes, sem navegar | in-progress | `.claude/plans/painel-dashboard-redesign.plan.md` |
| 2 | Contatos como sub-seção de Clientes | Contato só é criado/editado a partir da tela do cliente ao qual pertence | in-progress | `.claude/plans/painel-dashboard-redesign-contatos-em-clientes.plan.md` |
| 3 | Aba Admins | Admin com acesso consegue criar/remover outros usuários admin pelo painel | pending | — |
| 4 | Portal do cliente final | Cliente faz login e vê só os próprios sensores, leituras e alertas | pending | — |

## Open Questions
- [ ] O "Uptime" do card de device é o uptime real do firmware (exige novo campo no `POST /api/ingest`, que hoje não manda isso) ou uma aproximação calculada no servidor a partir de `last_seen_at`/histórico de conectividade?
- [ ] O portal do cliente reaproveita o mesmo mecanismo de login do admin (JWT com role diferenciando admin/cliente) ou é um sistema de auth totalmente separado?
- [ ] Na aba Admins, qualquer admin pode criar/remover outros admins, ou existe um "super admin" com privilégio exclusivo pra isso?

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Escopo ficou grande (4 milestones) pra uma "atualização" | Média | Médio | `/plan` decompõe e prioriza um milestone por vez, começando pelo Dashboard (#1) |
| Portal do cliente introduz superfície de autenticação nova | Média | Alto | Tratar como milestone isolado (#4) com plano de segurança próprio, não misturar com o resto |
| Uptime real exige mudança no firmware (já validado em bancada, evitar retrabalho) | Média | Baixo | Resolver a Open Question antes do `/plan` do Milestone 1, decidir aproximação vs. campo novo |

---
*Status: DRAFT — requirements only. Implementation planning pending via /plan.*
