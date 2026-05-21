---
title: 'Tela de recompensas do restaurante'
type: 'feature'
created: '2026-05-19'
status: 'in-progress'
baseline_commit: 'fedc1f8664ac9c0c3302fd5de779a15024a42026'
context: []
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** O painel do restaurante ainda nao permite configurar recompensas resgataveis por pontos nem contabilizar um resgate usando o QR Code do cliente. Sem isso, o estabelecimento consegue somar pontos por visita, mas nao tem um fluxo operacional para debitar pontos, notificar o cliente e manter historico das recompensas entregues.

**Approach:** Adicionar uma aba/tela de Recompensas no dashboard do restaurante, com CRUD simples para criar recompensas por nome e custo em pontos. Cada recompensa tera uma acao de contabilizacao que abre um scanner, chama a Edge Function `scanner-reward`, debita pontos do `user_passes.metadata.points`, registra o resgate em nova tabela e chama `notifications-enqueue` para enfileirar a mensagem padrao: `Parabens! Voce resgatou sua recompensa. Obrigado pela preferencia.`

## Boundaries & Constraints

**Always:** Validar que o staff autenticado pertence ao `project_id`; validar que o QR pertence ao mesmo projeto; debitar pontos apenas quando o saldo atual for maior ou igual ao custo da recompensa; persistir historico do resgate com recompensa, projeto, `user_pass_id`, cliente quando disponivel, pontos debitados, saldo antes/depois e data/hora; manter a UX consistente com `AutomationsTab` e `ScannerTab`; usar Supabase migrations para tabelas/policies/indices; exibir erro amigavel quando o cliente nao tiver pontos suficientes.

**Ask First:** Alterar a regra de validade/ciclo de pontos, remover pontos de outro campo alem de `user_passes.metadata.points`, adicionar exibicao analitica do historico no site, ou mudar contratos existentes de `scanner-visit` e `notifications-enqueue`.

**Never:** Nao resgatar recompensa sem autenticacao do staff; nao permitir resgate cross-project; nao criar uma nova mecanica de notificacao paralela quando `notifications-enqueue` atender ao caso; nao misturar esse trabalho com refatoracao geral do dashboard ou com relatorios futuros.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Criar recompensa | Staff informa nome e pontos positivos | Recompensa aparece na lista do projeto e fica disponivel para contabilizacao | Campos vazios ou pontos invalidos bloqueiam salvar e mostram toast |
| Resgatar com saldo suficiente | QR de passe do mesmo projeto com pontos >= custo | Pontos sao debitados, resgate e registrado e notificacao e enfileirada para o passe | Se notificacao falhar depois do debito, resposta deve expor sucesso do resgate e aviso nao-bloqueante |
| Resgatar com saldo insuficiente | QR valido, mas pontos < custo | Nenhum debito ocorre e nenhum historico de resgate concluido e criado | UI mostra que o cliente nao tem pontos suficientes |
| QR de outro projeto | Token pertence a passe de outro `project_id` | Operacao bloqueada | Retornar erro `wrong_project` e mensagem amigavel |
| Recompensa inexistente/inativa | `rewardId` nao existe, e de outro projeto ou esta inativa | Operacao bloqueada | Retornar 404/403 conforme o caso |

</frozen-after-approval>

## Code Map

- `allinpass/frontend/src/pages/RestaurantDashboard.jsx` -- controla abas do painel do restaurante; deve importar e expor a nova aba de recompensas.
- `allinpass/frontend/src/components/restaurant/AutomationsTab.jsx` -- referencia visual/UX para criar configuracoes customizaveis por projeto.
- `allinpass/frontend/src/components/restaurant/ScannerTab.jsx` -- referencia de scanner QR, extracao de token, chamada autenticada a Edge Function e estados de sucesso/erro.
- `allinpass/supabase/functions/scanner-visit/index.ts` -- referencia de autorizacao staff, validacao de projeto, leitura/debito de pontos em `user_passes.metadata`.
- `allinpass/supabase/functions/notifications-enqueue/index.ts` -- contrato para enfileirar notificacao usando `projectId`, `title`, `message`, `user_pass_ids`, `channels` e `data`.
- `allinpass/supabase/functions/create-automation/index.ts` -- referencia de criacao autenticada de configuracao por projeto.
- `allinpass/supabase/migrations/*.sql` -- local das tabelas, indices, constraints, grants e RLS.

## Tasks & Acceptance

**Execution:**
- [ ] `allinpass/supabase/migrations/<timestamp>_restaurant_rewards.sql` -- criar tabela `rewards` para configuracao e tabela `reward_redemptions` para historico, com FKs, constraints, indices, grants e RLS por staff do projeto -- garante persistencia e controle.
- [ ] `allinpass/supabase/functions/scanner-reward/index.ts` -- criar Edge Function autenticada que valida staff/projeto/recompensa/token, verifica saldo, debita pontos, registra resgate e chama `notifications-enqueue` -- centraliza a operacao sensivel no backend.
- [ ] `allinpass/frontend/src/components/restaurant/RewardsTab.jsx` -- criar tela para listar/criar recompensas por nome e pontos e contabilizar uma recompensa com scanner QR -- entrega a experiencia operacional ao restaurante.
- [ ] `allinpass/frontend/src/pages/RestaurantDashboard.jsx` -- adicionar aba `rewards` com icone e persistencia em `restaurant_active_tab` -- torna a tela acessivel no login de restaurante.
- [ ] `allinpass/frontend/tests/integration/scanner-reward.test.js` -- cobrir casos de saldo suficiente, saldo insuficiente e projeto errado quando a suite de integracao local permitir -- protege o fluxo principal de regressao.

**Acceptance Criteria:**
- Given um restaurante autenticado e associado a um projeto, when ele cria uma recompensa com nome e pontos validos, then a recompensa aparece na lista do projeto.
- Given uma recompensa criada e um QR de cliente com pontos suficientes, when o staff contabiliza a recompensa, then o saldo do passe diminui pelo custo configurado, um registro de resgate e salvo e a notificacao e enfileirada.
- Given um QR de cliente com pontos insuficientes, when o staff tenta contabilizar a recompensa, then o saldo nao muda e a UI informa pontos insuficientes.
- Given um QR de outro projeto, when o staff tenta contabilizar a recompensa, then a operacao e bloqueada e nenhum debito e registrado.

## Spec Change Log

## Design Notes

`reward_redemptions` deve ser historico operacional, nao configuracao. A recompensa pode mudar de nome depois no futuro, entao o resgate deve guardar snapshots como `reward_name` e `points_spent` alem dos IDs relacionais. A mensagem enviada ao cliente nao e customizavel e deve ser sempre: `Parabens! Voce resgatou sua recompensa. Obrigado pela preferencia.`

## Verification

**Commands:**
- `npm run build` em `allinpass/frontend` -- expected: build React concluido sem erro.
- `npm test -- scanner-reward` em `allinpass/frontend`, se a suite estiver configurada para rodar testes de Edge Function localmente -- expected: cenarios principais verdes.
