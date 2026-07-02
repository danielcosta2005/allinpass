# Meta Pixel — Tracking de eventos da landing page e cadastro

Este documento descreve quais eventos do Meta Pixel são disparados na landing page pública da Allin Pass ([allinpass/frontend/src/pages/LandingPage.jsx](../frontend/src/pages/LandingPage.jsx)) e no fluxo de cadastro/checkout ([allinpass/frontend/src/pages/SignupPage.jsx](../frontend/src/pages/SignupPage.jsx)), em quais interações cada um dispara, e quais parâmetros são enviados.

## 1. Configuração base

- **Pixel ID:** `1890317175016680`
- **Inicialização:** em [allinpass/frontend/index.html](../frontend/index.html) — `<script>` no `<head>` + `<noscript>` no topo do `<body>` (fallback pra clientes sem JavaScript).
- **Helper:** todo acesso ao `window.fbq` passa por [allinpass/frontend/src/lib/metaPixel.js](../frontend/src/lib/metaPixel.js), que faz guard defensivo de `window`/`fbq` e silencia falhas — se o pixel for bloqueado por adblocker, o app continua 100% funcional.

O helper expõe duas funções:

```js
import { trackStandard, trackCustom } from '@/lib/metaPixel';

trackStandard(eventName, params); // eventos padrão da Meta (ads optimization)
trackCustom(eventName, params);   // eventos customizados (analytics interno)
```

## 2. Eventos padrão da Meta (camada de otimização de ads)

Estes são os nomes oficiais que o algoritmo da Meta entende e usa pra otimizar campanhas. Cada um é mapeado pra um objetivo de campanha no Ads Manager.

### 2.1 `PageView`

- **Quando dispara:** automaticamente, no carregamento de qualquer página (inclusive a landing). Chamada feita inline em `index.html`.
- **Parâmetros:** nenhum.
- **Uso:** cobertura base de audiência. Métrica de tráfego total no Ads Manager.

### 2.2 `ViewContent`

- **Quando dispara:** quando a seção `#planos` entra no viewport pela primeira vez na sessão (IntersectionObserver com `threshold: 0.1`).
- **Dedup:** uma única vez por sessão (memória de componente via `useRef`).
- **Parâmetros:**
  ```json
  {
    "content_name": "pricing_section",
    "content_category": "landing_page"
  }
  ```
- **Uso:** sinal de "consideração de produto". Permite criar audiências de pessoas que olharam os planos mas não converteram, pra remarketing.

### 2.3 `Lead`

- **Quando dispara:** clique em qualquer CTA genérico de início de cadastro ("Começar agora"). Cobre 3 pontos: Header (desktop e mobile), Hero, FinalCTA.
- **Parâmetros:**
  ```json
  { "source": "header" | "header_mobile" | "hero" | "final_cta" }
  ```
- **Uso:** topo de funil. O parâmetro `source` permite filtrar no Ads Manager qual seção converte mais leads.

### 2.4 `InitiateCheckout`

- **Quando dispara:** clique no botão CTA de um plano específico (Free Trial, Starter, Pro, Premium) no card de pricing.
- **Parâmetros:**
  ```json
  {
    "value": 297.7,
    "currency": "BRL",
    "content_name": "Pro",
    "content_ids": ["pro"]
  }
  ```
- **Uso:** este é o evento de **maior valor** pra otimização de ads. A Meta otimiza campanhas pra esse evento e usa `value`/`currency` pra calcular ROAS automaticamente. Permite criar audiência de alta intenção (escolheu um plano mas não finalizou).
- **Nota conhecida:** Free Trial atualmente dispara com `value: 0`, o que polui parcialmente o cálculo de ROAS. Tratamento diferenciado está registrado em [_bmad-output/implementation-artifacts/deferred-work.md](../../_bmad-output/implementation-artifacts/deferred-work.md).

### 2.5 `Contact`

- **Quando dispara:** clique no link "Fale com a gente" abaixo da grade de planos.
- **Parâmetros:**
  ```json
  { "source": "pricing_custom_plan" }
  ```
- **Uso:** lead qualificado de plano customizado. Audiência separada de leads genéricos.

### 2.6 `AddPaymentInfo`

- **Quando dispara:** depois que o backend cria ou reutiliza uma sessão de checkout paga com sucesso, imediatamente antes do redirect para o checkout seguro do Asaas. Cobre o fluxo de pagamento em `/cadastro` e a recuperação de pagamento pelo `/org`.
- **Dedup:** chave local por sessão de checkout, armazenada no navegador por 30 dias. A chave não é enviada para a Meta.
- **Parâmetros:**
  ```json
  {
    "value": 297.7,
    "currency": "BRL",
    "content_name": "Pro",
    "content_ids": ["pro"],
    "content_type": "product",
    "contents": [
      {
        "id": "pro",
        "quantity": 1,
        "item_price": 297.7
      }
    ],
    "plan_code": "pro",
    "plan_name": "Pro",
    "payment_provider": "asaas",
    "source": "signup_payment_step"
  }
  ```
- **Uso:** sinal intermediário de checkout pago aberto com sucesso. Bom para remarketing de pessoas que chegaram ao Asaas mas não tiveram pagamento confirmado.

### 2.7 `CompleteRegistration`

- **Quando dispara:** depois que `signup-finalize` confirma a criação/ativação do projeto. Cobre Free Trial, retorno de magic link, retorno de checkout pago e recuperação de ativação no `/org`.
- **Dedup:** chave local por projeto/assinatura/checkout, armazenada no navegador por 30 dias. A chave não é enviada para a Meta.
- **Parâmetros:**
  ```json
  {
    "value": 0,
    "currency": "BRL",
    "content_name": "Free Trial",
    "content_ids": ["free_trial"],
    "plan_code": "free_trial",
    "plan_name": "Free Trial",
    "registration_method": "email",
    "signup_flow": "free_trial",
    "source": "signup_email_confirmation"
  }
  ```
- **Uso:** conversão de finalização de cadastro. É o evento principal para medir quantos cadastros chegaram ao ponto em que o projeto existe de fato.

### 2.8 `StartTrial`

- **Quando dispara:** junto da finalização real do Free Trial, depois que `signup-finalize` cria/ativa o projeto com plano `free_trial`.
- **Dedup:** chave local por projeto/assinatura, armazenada no navegador por 30 dias. A chave não é enviada para a Meta.
- **Parâmetros:**
  ```json
  {
    "value": 0,
    "currency": "BRL",
    "content_name": "Free Trial",
    "content_ids": ["free_trial"],
    "plan_code": "free_trial",
    "plan_name": "Free Trial",
    "source": "signup_email_confirmation"
  }
  ```
- **Uso:** conversão específica de início de trial. Mantemos `CompleteRegistration` para medir cadastro finalizado e `StartTrial` para medir o início do teste gratuito.

### 2.9 `Purchase`

- **Quando dispara:** depois que um plano pago é confirmado e `signup-finalize` conclui a ativação. Cobre retorno `/cadastro?checkout=success` e recuperação de ativação no `/org`.
- **Dedup:** chave local por checkout/projeto/assinatura, armazenada no navegador por 30 dias. A chave não é enviada para a Meta.
- **Separação por plano:** o evento continua sendo o padrão `Purchase`; Starter/Pro/Premium são identificados por `content_ids`, `plan_code` e `plan_name`. Isso preserva otimização/ROAS da Meta e permite criar conversões ou audiências filtradas por plano.
- **Parâmetros:**
  ```json
  {
    "value": 297.7,
    "currency": "BRL",
    "content_name": "Pro",
    "content_ids": ["pro"],
    "content_type": "product",
    "contents": [
      {
        "id": "pro",
        "quantity": 1,
        "item_price": 297.7
      }
    ],
    "num_items": 1,
    "plan_code": "pro",
    "plan_name": "Pro",
    "source": "signup_paid_checkout_return"
  }
  ```
- **Uso:** conversão de compra e cálculo de ROAS. Este é o evento de maior valor para campanhas otimizadas para receita.

## 3. Eventos customizados (camada de analytics interno)

Prefixo `LP_` pra todos os customizados. Usar pra dashboards internos no Ads Manager (Eventos Customizados) e análise granular de funil. Não otimizam campanhas, mas são reportados normalmente.

### 3.1 `LP_PlanCardCTA`

- **Quando:** dispara junto com `InitiateCheckout` no clique de um plano.
- **Parâmetros:**
  ```json
  {
    "plan_key": "pro",
    "plan_code": "pro",
    "plan_name": "Pro",
    "plan_price": 297.7
  }
  ```
- **Uso:** breakdown por plano. Saber qual plano performa melhor no funil.

### 3.2 `LP_FAQOpen`

- **Quando:** dispara quando o usuário **abre** uma pergunta do FAQ. Não dispara ao fechar.
- **Parâmetros:**
  ```json
  {
    "question": "O que é a Allin Pass?",
    "position": 1
  }
  ```
- **Uso:** identifica objeções principais. Perguntas muito abertas indicam dúvidas frequentes — sinal pra melhorar copy de outras seções ou criar conteúdo de marketing direcionado.

### 3.3 `LP_NavClick`

- **Quando:** clique em qualquer link da navegação (`#recursos`, `#como-funciona`, `#planos`, `#faq`) — tanto no header desktop quanto no menu mobile, e também no CTA secundário "Ver como funciona" do Hero.
- **Parâmetros:**
  ```json
  {
    "section": "recursos" | "como-funciona" | "planos" | "faq",
    "location": "header_desktop" | "header_mobile" | "hero"
  }
  ```
- **Uso:** heatmap de interesse por seção da landing.

### 3.4 `LP_ScrollDepth`

- **Quando:** o usuário cruza os marcos de **50%** e **90%** da altura total do documento.
- **Dedup:** cada marco dispara no máximo 1x por sessão.
- **Parâmetros:**
  ```json
  { "depth": 50 | 90 }
  ```
- **Uso:** qualidade de engajamento. Distingue bounce (saiu antes de 50%) de leitor engajado (chegou a 90%).

### 3.5 `LP_LoginClick`

- **Quando:** clique em "Entrar" (Header desktop, menu mobile, FinalCTA).
- **Parâmetros:**
  ```json
  { "source": "header" | "header_mobile" | "final_cta" }
  ```
- **Uso:** distingue **aquisição de novo cliente** de **retorno de cliente existente** dentro do tráfego.

### 3.6 `LP_DashboardAccess`

- **Quando:** clique em "Acessar painel" quando o usuário já está autenticado (substitui o CTA "Começar agora" pra usuários logados). Cobre Header desktop, menu mobile, Hero e FinalCTA.
- **Parâmetros:**
  ```json
  { "source": "header" | "header_mobile" | "hero" | "final_cta" }
  ```
- **Uso:** medir tráfego de usuários autenticados na landing — útil pra entender se a landing pública também serve como entrada secundária pro dashboard.

## 4. Resumo de matriz por interação

| Interação do usuário | Eventos padrão | Eventos customizados |
|---|---|---|
| Carrega a landing | `PageView` | — |
| Rola até a seção de planos | `ViewContent` | — |
| Rola até 50% e 90% do documento | — | `LP_ScrollDepth` (×2) |
| Clica em link da nav (`#recursos`, etc.) | — | `LP_NavClick` |
| Clica "Começar agora" (Hero, Header, FinalCTA) | `Lead` | — |
| Clica no card de um plano | `InitiateCheckout` | `LP_PlanCardCTA` |
| Clica "Fale com a gente" | `Contact` | — |
| Abre checkout pago no Asaas | `AddPaymentInfo` | — |
| Finaliza cadastro Free Trial | `CompleteRegistration`, `StartTrial` | — |
| Finaliza ativação de plano pago | `CompleteRegistration`, `Purchase` | — |
| Abre uma pergunta no FAQ | — | `LP_FAQOpen` |
| Clica "Entrar" (visitante anônimo) | — | `LP_LoginClick` |
| Clica "Acessar painel" (usuário logado) | — | `LP_DashboardAccess` |

## 5. Como verificar manualmente

1. **DevTools → Network → filtro `facebook.com/tr`** — cada disparo gera um GET pra esse endpoint. `ev=<NomeDoEvento>` no query string indica qual evento foi.
2. **Extensão [Meta Pixel Helper](https://chromewebstore.google.com/detail/meta-pixel-helper/fdgfkebogiimcoedlicjlajpkdmockpc) (Chrome)** — lista todos os eventos disparados na aba atual com seus parâmetros formatados.
3. **Ads Manager → Gerenciador de Eventos → Pixel `Allin Pass`** — eventos aparecem em "Atividade do Pixel" com latência de até 20 minutos. Customizados aparecem em "Eventos Personalizados".

## 6. Garantias de segurança e privacidade

- **Sem PII**: nenhum evento envia email, telefone, nome ou identificador de usuário. Apenas dados técnicos (`source`, `section`, `plan_key`, `depth`, etc.) e textos estáticos públicos (perguntas do FAQ).
- **Resiliente a adblock**: o helper detecta ausência do `fbq` e descarta chamadas silenciosamente. Nenhuma exceção propaga pro app.
- **Resiliente a SSR/build**: guard de `typeof window === 'undefined'` evita crash em ambientes sem `window`.

## 7. Trabalho pendente conhecido

Itens fora do escopo desta primeira instrumentação, registrados em [_bmad-output/implementation-artifacts/deferred-work.md](../../_bmad-output/implementation-artifacts/deferred-work.md):

- Gating de consentimento LGPD/GDPR antes do `PageView`.
- Pixel ID via variável de ambiente (separar dev/staging/prod).
- Tratamento diferenciado pro Free Trial em `InitiateCheckout` (atualmente envia `value: 0`).
- Conversions API (CAPI) server-side com `eventID` pra dedup de sinais perdidos por adblock/ITP.
- CSP nonce no `<script>` inline (preparação pra hardening de CSP).
