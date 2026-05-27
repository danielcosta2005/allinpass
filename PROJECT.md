# PROJECT.md — Referência de Design do AllinPass

> Documento de referência para manter consistência visual, experiência de uso e padrões de implementação no AllinPass.
>
> Use este arquivo como contexto para humanos, Codex, agentes de IA e novos desenvolvedores antes de alterar telas, componentes ou fluxos de interface.

---

## 1. Visão do Produto

O **AllinPass** é uma plataforma SaaS de fidelidade digital baseada em passes, QR Codes, Apple Wallet, Google Wallet e gestão por projetos/estabelecimentos.

O produto deve transmitir:

- **Confiança**: aparência profissional, clara e segura.
- **Velocidade**: fluxos simples para criar, distribuir, escanear e acompanhar passes.
- **Modernidade**: interface compatível com um SaaS atual, limpo e responsivo.
- **Controle operacional**: dashboards, KPIs, gestão de projetos, clientes, membros e localizações.
- **Praticidade para o estabelecimento**: poucos cliques para gerar QR Codes, registrar visitas e consultar resultados.

### Personas principais

#### Superadmin

Usuário interno da plataforma, responsável por administrar projetos, localizações, membros, configurações de wallet e dados globais.

Prioridades de UX:

- Visão ampla do sistema.
- Ações administrativas claras.
- Baixa ambiguidade em formulários críticos.
- Feedback visual forte em ações destrutivas ou sensíveis.

#### Estabelecimento / Restaurante

Usuário operacional vinculado a um projeto específico, responsável por gerar QR Codes, escanear passes e acompanhar KPIs.

Prioridades de UX:

- Interface direta e sem excesso de opções.
- Acesso rápido ao scanner e ao QR Code.
- Indicadores fáceis de entender.
- Fluxo otimizado para uso em balcão, atendimento ou caixa.

#### Cliente final

Pessoa que recebe ou utiliza o passe digital.

Prioridades de UX:

- Experiência mobile-first.
- Clareza sobre benefício, validade e funcionamento do passe.
- Botões evidentes para salvar na Apple Wallet ou Google Wallet.
- Confiança para fornecer dados básicos quando necessário.

---

## 2. Princípios de Design

### 2.1 Clareza acima de decoração

A interface deve priorizar leitura, hierarquia e entendimento rápido. Elementos visuais devem apoiar a decisão do usuário, não competir com ela.

**Aplicar em:**

- Dashboards.
- Telas de scanner.
- Formulários administrativos.
- Páginas de configuração.
- Landing pages.

### 2.2 Mobile-first quando houver contato com cliente final

Fluxos públicos, páginas de resgate, visualização de passe e links compartilháveis devem ser pensados primeiro para celular.

**Regra prática:** se o cliente final pode abrir pelo WhatsApp, QR Code ou navegador mobile, a tela precisa funcionar perfeitamente em telas pequenas.

### 2.3 Admin eficiente, não chamativo

Áreas administrativas devem ter layout mais funcional, com navegação previsível, tabelas legíveis, filtros e ações consistentes.

### 2.4 Estado visível do sistema

Toda ação relevante deve informar claramente o resultado:

- Carregando.
- Salvando.
- Sucesso.
- Erro.
- Sem dados.
- Sem permissão.
- Ação concluída parcialmente.

### 2.5 Consistência entre Wallet e plataforma

Sempre que o usuário estiver configurando um passe, a interface deve aproximar o preview visual da aparência real do Apple Wallet/Google Wallet.

---

## 3. Identidade Visual

### 3.1 Tom visual

O AllinPass deve parecer:

- SaaS moderno.
- Premium, mas acessível.
- Tecnológico, sem parecer complexo.
- Confiável para empresas, redes, restaurantes, eventos e campanhas públicas.

### 3.2 Paleta recomendada

> Ajuste os tokens conforme a identidade oficial da marca evoluir. Evite cores hardcoded nos componentes.

```css
:root {
  /* Base */
  --color-background: #f8fafc;
  --color-surface: #ffffff;
  --color-surface-muted: #f1f5f9;

  /* Texto */
  --color-text-primary: #0f172a;
  --color-text-secondary: #475569;
  --color-text-muted: #64748b;
  --color-text-inverse: #ffffff;

  /* Marca */
  --color-brand-primary: #2563eb;
  --color-brand-primary-hover: #1d4ed8;
  --color-brand-soft: #dbeafe;

  /* Estados */
  --color-success: #16a34a;
  --color-success-soft: #dcfce7;
  --color-warning: #f59e0b;
  --color-warning-soft: #fef3c7;
  --color-danger: #dc2626;
  --color-danger-soft: #fee2e2;
  --color-info: #0284c7;
  --color-info-soft: #e0f2fe;

  /* Bordas */
  --color-border: #e2e8f0;
  --color-border-strong: #cbd5e1;
}
```

### 3.3 Uso de cores

- **Primária**: ações principais, links importantes, botões de avanço.
- **Verde**: sucesso, pagamento aprovado, passe ativo, visita registrada.
- **Amarelo/Laranja**: alerta, pendência, limite próximo, trial terminando.
- **Vermelho**: erro, exclusão, falha de pagamento, passe inválido.
- **Cinza/Azul escuro**: textos, navegação, áreas administrativas.

Evite usar vermelho para ações que não sejam críticas. Evite usar verde para botões genéricos que não indiquem confirmação positiva.

---

## 4. Tipografia

### 4.1 Fonte recomendada

Use uma fonte sans-serif moderna e legível.

Sugestões:

- `Inter`
- `Geist`
- `Plus Jakarta Sans`
- `system-ui` como fallback

```css
body {
  font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
```

### 4.2 Escala tipográfica

```txt
Display / Hero:       40px–56px / 700–800
Título de página:     28px–36px / 700
Título de seção:      20px–24px / 600–700
Título de card:       16px–18px / 600
Texto padrão:         14px–16px / 400–500
Texto auxiliar:       12px–14px / 400
Label:                12px–14px / 500–600
```

### 4.3 Regras

- Use títulos curtos e descritivos.
- Evite parágrafos longos dentro de cards administrativos.
- Labels de formulário devem ser explícitas.
- Textos de erro devem dizer o que aconteceu e, quando possível, como resolver.

---

## 5. Layout e Espaçamento

### 5.1 Grid

Use layouts em grid para dashboards e páginas administrativas.

```txt
Mobile:  1 coluna
Tablet:  2 colunas quando fizer sentido
Desktop: 3 a 4 colunas para cards/KPIs
```

### 5.2 Espaçamento

Adote escala baseada em múltiplos de 4px.

```txt
4px   micro espaçamento
8px   espaçamento interno pequeno
12px  distância entre label e input
16px  padding padrão de card compacto
24px  padding padrão de seção/card
32px  separação entre blocos
48px+ separação de seções grandes
```

### 5.3 Bordas e radius

```css
--radius-sm: 8px;
--radius-md: 12px;
--radius-lg: 16px;
--radius-xl: 24px;
```

Recomendação:

- Inputs: `8px–12px`.
- Cards: `16px`.
- Modais: `20px–24px`.
- Botões: `10px–14px`.

---

## 6. Componentes Base

### 6.1 Botões

#### Variantes

- `primary`: ação principal da tela.
- `secondary`: ação alternativa.
- `ghost`: ações discretas.
- `danger`: exclusão ou ação irreversível.
- `success`: confirmação operacional, como visita registrada.

#### Regras

- Cada tela deve ter uma ação primária evidente.
- Não use dois botões primários competindo no mesmo bloco.
- Ações destrutivas devem pedir confirmação.
- Botões em loading devem impedir duplo clique.

Exemplo:

```tsx
<button
  type="submit"
  disabled={salvando}
  className="inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60"
>
  {salvando ? "Salvando..." : "Salvar alterações"}
</button>
```

### 6.2 Cards

Use cards para agrupar informações relacionadas.

Tipos comuns:

- Card de KPI.
- Card de projeto.
- Card de localização.
- Card de configuração de Wallet.
- Card de status de assinatura/faturamento.

Um card deve ter:

- Título.
- Conteúdo principal.
- Ações secundárias quando necessário.
- Estado vazio se não houver dados.

### 6.3 Formulários

Todos os formulários devem ter:

- Labels visíveis.
- Placeholder apenas como ajuda, não como substituto do label.
- Mensagem de erro próxima ao campo.
- Validação no frontend e backend.
- Feedback de sucesso.

Campos sensíveis devem evitar exposição desnecessária.

Exemplo de erro bom:

```txt
Informe uma latitude válida entre -90 e 90.
```

Exemplo de erro ruim:

```txt
Valor inválido.
```

### 6.4 Tabelas

Use tabelas para listas administrativas com muitos registros.

Devem ter:

- Busca quando houver muitos itens.
- Filtros por status quando aplicável.
- Paginação ou carregamento incremental.
- Estado vazio.
- Estado de erro.
- Ações alinhadas à direita.

### 6.5 Badges de status

Estados recomendados:

```txt
Ativo        verde
Inativo      cinza
Pendente     amarelo
Erro         vermelho
Trial        azul
Cancelado    cinza/vermelho discreto
Expirado     vermelho
```

### 6.6 Modais

Use modal para:

- Confirmações destrutivas.
- Criação/edição curta.
- Visualização rápida de detalhes.

Evite modal para fluxos longos. Fluxos complexos devem ter página própria.

---

## 7. Padrões de Tela

### 7.1 Dashboard do Restaurante

Objetivo: permitir que o estabelecimento entenda rapidamente sua operação.

Deve conter:

- KPIs principais.
- Número de clientes/passes.
- Visitas registradas.
- Atividade recente.
- Atalho para scanner.
- Atalho para gerar QR Code.

Prioridade visual:

1. Ações operacionais rápidas.
2. KPIs de alto impacto.
3. Histórico e detalhes.

### 7.2 Scanner de QR Code

Objetivo: registrar visita ou validar passe com mínimo atrito.

Requisitos de UX:

- Botão claro para iniciar câmera.
- Estado de permissão negada.
- Estado de câmera indisponível.
- Feedback forte em sucesso/erro.
- Evitar que a mesma leitura seja registrada múltiplas vezes por acidente.

Estados esperados:

```txt
Aguardando câmera
Lendo QR Code
Validando passe
Visita registrada
Passe inválido
Passe expirado
Erro de conexão
```

### 7.3 Gestão de Projetos

Objetivo: permitir ao superadmin criar e administrar projetos.

Deve conter:

- Lista de projetos.
- Busca por nome.
- Status do projeto.
- Quantidade de localizações.
- Quantidade de membros/clientes quando disponível.
- Ações: ver, editar, configurar, desativar.

### 7.4 Gestão de Localizações

Objetivo: configurar endereços físicos vinculados a projetos.

Deve conter:

- Nome/label da localização.
- Endereço.
- Latitude/longitude.
- Mapa ou preview quando possível.
- Validação de coordenadas.
- Integração com geocoding quando disponível.

### 7.5 Configuração de Wallet

Objetivo: configurar identidade visual e comportamento dos passes digitais.

Deve conter:

- Preview aproximado do passe.
- Upload de imagens com instruções de proporção.
- Campos principais: nome, descrição, cores, logo, strip/banner.
- Indicação de compatibilidade Apple Wallet/Google Wallet.
- Mensagens claras para assets ausentes ou inválidos.

### 7.6 Página pública de resgate

Objetivo: converter um visitante em usuário do passe.

Deve conter:

- Benefício principal do passe.
- Nome da empresa/campanha.
- Formulário curto.
- Botões de salvar na Wallet.
- Confirmação de sucesso.
- Termos de uso/privacidade quando houver coleta de dados.

---

## 8. Wallet Pass Design

### 8.1 Apple Wallet

A interface de configuração deve respeitar a ideia de que o Apple Wallet é compacto e altamente visual.

Boas práticas:

- Logo legível mesmo pequeno.
- Evitar excesso de texto na frente do passe.
- Usar campos curtos.
- Priorizar benefício, saldo/pontos/status e validade.
- Usar verso do passe para informações longas.

Campos típicos:

```txt
Header: validade, pontos ou status
Primary: nome do benefício/campanha
Secondary: nome do cliente, plano ou categoria
Auxiliary: unidade, código, data ou saldo
Back fields: regras, descrição, termos e dados de contato
```

### 8.2 Google Wallet

Boas práticas:

- Manter consistência com Apple Wallet, mas respeitar diferenças de layout.
- Usar imagens otimizadas.
- Evitar textos longos em áreas principais.
- Garantir contraste entre fundo e texto.

### 8.3 Assets de imagem

Regras gerais:

- Usar PNG quando houver transparência.
- Usar imagens otimizadas para web.
- Evitar arquivos grandes sem necessidade.
- Validar dimensões antes de salvar quando possível.
- Mostrar instruções de proporção na interface.

---

## 9. Estados e Feedback

### 9.1 Loading

Use skeletons para conteúdo estrutural e spinners apenas para ações rápidas.

Exemplos:

- Dashboard carregando: skeleton nos cards.
- Botão salvando: texto `Salvando...`.
- Scanner validando: estado textual claro.

### 9.2 Empty state

Todo empty state deve responder:

1. O que está vazio?
2. Por que isso importa?
3. Qual é o próximo passo?

Exemplo:

```txt
Nenhuma localização cadastrada ainda.
Cadastre uma localização para permitir geofencing e organizar os passes por unidade.
[Adicionar localização]
```

### 9.3 Erros

Erros devem ser acionáveis.

Exemplo bom:

```txt
Não foi possível registrar a visita. Verifique sua conexão e tente novamente.
```

Exemplo ruim:

```txt
Erro 500.
```

### 9.4 Sucesso

Mensagens de sucesso devem ser curtas.

```txt
Projeto criado com sucesso.
Visita registrada.
Passe gerado com sucesso.
Alterações salvas.
```

---

## 10. Acessibilidade

### Regras mínimas

- Todo botão deve ter texto ou `aria-label`.
- Inputs devem ter `label` associado.
- Contraste suficiente entre texto e fundo.
- Foco visível em elementos interativos.
- Não depender apenas de cor para indicar status.
- Modais devem permitir navegação por teclado.

### Textos

Prefira linguagem direta:

- Use `Salvar alterações`, não apenas `OK`.
- Use `Excluir projeto`, não apenas `Excluir` quando houver risco.
- Use `Gerar QR Code`, não `Processar`.

---

## 11. Responsividade

### Mobile

- Navegação compacta.
- Cards em coluna única.
- Botões com área de toque confortável.
- Evitar tabelas largas; usar cards/listas responsivas.
- Scanner deve ocupar área central e clara.

### Desktop

- Sidebar ou navegação lateral para admin.
- Dashboards em grid.
- Tabelas completas.
- Ações secundárias em menus ou coluna à direita.

---

## 12. Conteúdo e Tom de Voz

### Tom

- Claro.
- Profissional.
- Direto.
- Levemente consultivo.

### Evitar

- Termos excessivamente técnicos para usuários operacionais.
- Mensagens genéricas.
- Frases longas em botões.
- Excesso de emojis em área administrativa.

### Exemplos

```txt
Bom: Gere um QR Code para cadastrar novos clientes.
Ruim: Inicie o processo de provisionamento de identificador público.
```

```txt
Bom: Este projeto ainda não possui localizações.
Ruim: Nenhum dado encontrado.
```

---

## 13. Segurança no Design

### 13.1 Permissões visíveis

A interface deve respeitar roles e permissões.

- Superadmin pode visualizar e administrar todos os projetos.
- Usuários de estabelecimento devem acessar apenas dados do próprio projeto.
- A UI não deve exibir ações que o usuário não pode executar.

Mesmo assim, a segurança real deve estar no backend/RLS, não apenas escondida no frontend.

### 13.2 Ações críticas

Ações como excluir projeto, remover membro, desativar passe ou alterar configurações de wallet devem ter confirmação explícita.

Exemplo:

```txt
Tem certeza que deseja desativar este projeto?
Usuários vinculados podem perder acesso às funcionalidades operacionais.
```

### 13.3 Dados sensíveis

- Não expor tokens, secrets ou chaves no frontend.
- Não mostrar identificadores internos sem necessidade.
- Mascarar dados pessoais quando fizer sentido.
- Evitar logs visíveis com informações sensíveis.

---

## 14. Performance percebida

### Prioridades

- Primeira renderização rápida.
- Feedback imediato após clique.
- Evitar telas brancas durante carregamento.
- Carregar dados pesados sob demanda.
- Otimizar imagens dos passes.

### Recomendações

- Skeleton em dashboards.
- Lazy loading em imagens e páginas secundárias.
- Paginação em listas grandes.
- Cache de dados pouco voláteis, como projetos e configurações.
- Evitar chamadas repetidas ao Supabase em componentes filhos sem necessidade.

---

## 15. Padrões de Implementação Frontend

### 15.1 Organização sugerida

```txt
src/
  components/
    ui/                 # componentes base reutilizáveis
    layout/             # sidebar, header, shell
    wallet/             # preview e componentes específicos de wallet
    dashboard/          # cards e gráficos
  pages/
    admin/
    restaurant/
    public/
  hooks/
  lib/
    supabase/
    validators/
    formatters/
  styles/
```

### 15.2 Regra para componentes

Componentes devem ser pequenos, nomeados por responsabilidade e fáceis de reutilizar.

```tsx
// Bom: nome descreve a responsabilidade
<ProjectStatusBadge status={project.status} />

// Ruim: nome genérico demais
<Badge2 value={project.status} />
```

### 15.3 Separação de responsabilidades

Evite misturar:

- Fetch de dados.
- Regra de negócio.
- Renderização visual.
- Formatação.

Quando possível:

- Hooks cuidam de dados.
- Componentes cuidam de UI.
- Utils cuidam de formatação.
- Backend/RPC cuida de regra crítica.

---

## 16. Padrões para Supabase e Dados na UI

### 16.1 Tratamento de erro

Toda chamada ao Supabase deve tratar erro e estado de loading.

```tsx
const { data, error } = await supabase
  .from("projects")
  .select("id, name, status");

if (error) {
  // Mostre mensagem amigável para o usuário
  // Registre detalhes técnicos apenas em ambiente seguro
  throw new Error("Não foi possível carregar os projetos.");
}
```

### 16.2 RLS e interface

A UI pode adaptar a experiência por role, mas não deve ser a fonte de segurança.

```txt
Frontend: melhora experiência escondendo ações indisponíveis.
RLS/backend: garante segurança real dos dados.
```

---

## 17. Checklist antes de criar uma nova tela

Antes de finalizar uma tela, verifique:

- [ ] A tela tem uma ação principal clara?
- [ ] Há estado de loading?
- [ ] Há estado vazio?
- [ ] Há tratamento de erro?
- [ ] O layout funciona no mobile?
- [ ] Os textos são claros para o usuário real?
- [ ] As permissões foram consideradas?
- [ ] A ação crítica tem confirmação?
- [ ] Os componentes seguem padrões existentes?
- [ ] Dados sensíveis não aparecem indevidamente?

---

## 18. Checklist para componentes novos

- [ ] Nome do componente é descritivo.
- [ ] Props são simples e tipadas.
- [ ] Não possui regra de negócio pesada embutida.
- [ ] Trata variações de estado.
- [ ] É responsivo quando necessário.
- [ ] Usa tokens/classes padronizadas.
- [ ] Tem acessibilidade básica.
- [ ] Pode ser reutilizado sem depender de página específica.

---

## 19. Priorização de Qualidade

### Crítico

- Segurança por role/RLS.
- Fluxo de scanner confiável.
- Geração e validação de passes.
- Tratamento de erros em ações operacionais.
- Não expor secrets no frontend.

### Importante

- Design consistente entre telas.
- Responsividade mobile.
- Empty states claros.
- Feedback de loading/sucesso/erro.
- Preview fiel dos passes.

### Nice-to-have

- Microinterações.
- Animações leves.
- Personalização avançada de tema por projeto.
- Gráficos mais sofisticados.
- Assistentes guiados de configuração.

---

## 20. Glossário Contextual

- **Passe digital**: cartão digital usado pelo cliente para acessar benefícios, fidelidade ou campanhas.
- **Wallet**: carteira digital do celular, como Apple Wallet ou Google Wallet.
- **RLS**: Row Level Security; mecanismo do Supabase/Postgres para restringir acesso a linhas do banco.
- **RPC**: função executada no banco/Supabase para encapsular uma operação crítica.
- **Geofencing**: recurso que usa localização para ativar contexto quando o cliente está perto de uma unidade.
- **KPI**: indicador-chave de performance, como visitas, clientes ativos ou passes gerados.
- **Empty state**: estado visual quando uma tela/lista ainda não possui dados.
- **Skeleton**: placeholder visual usado enquanto dados reais carregam.

---

## 21. Como usar este arquivo com agentes de IA/Codex

Ao pedir alterações de interface, inclua este arquivo como contexto e exija que a solução respeite:

- Componentes existentes.
- Padrões de cor, tipografia e espaçamento.
- Estados de loading, erro e vazio.
- Responsividade.
- Segurança por role e RLS.
- Clareza operacional para restaurante e superadmin.

Exemplo de prompt:

```txt
Use o PROJECT.md como referência de design.
Refatore a tela de scanner para seguir os padrões de UX, estados visuais, acessibilidade e feedback definidos no projeto.
Não altere regras de negócio sem justificar.
```

---

## 22. Próximas melhorias recomendadas

- Criar `DESIGN_TOKENS.md` com tokens oficiais de cor, espaçamento, radius e sombra.
- Criar biblioteca interna de componentes base.
- Documentar screenshots das principais telas.
- Criar guidelines específicas para Apple Wallet e Google Wallet.
- Criar mapa de permissões por role.
- Criar padrões para landing pages e páginas públicas de campanhas.
