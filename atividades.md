# 1️⃣ Tradução do README (o que esse projeto é, de verdade)

O **Carteira 4.9** é um **sistema de fidelidade digital** para restaurantes, onde:

- O cliente recebe um **cartão digital** (Apple Wallet / Google Wallet)
- Cada visita gera um registro (via QR Code)
- O restaurante vê métricas (visitas, recorrência etc.)
- A Khaos Omni controla tudo como **Superadmin**

Arquitetura simplificada:

- **Frontend**: site/painel (onde usuários clicam)
- **Supabase**:
  - cuida de login
  - banco de dados
  - regras de segurança
- **Edge Functions** (backend):
  - geram os cartões Apple/Google
  - criam usuários automaticamente
  - fazem ações sensíveis

Você não está “programando servidores”. O Supabase já é o servidor.

---

# 2️⃣ O que já está feito (confirmado pelo README)

## ✅ Autenticação e Segurança

- Login funcionando via Supabase Auth
- Sistema de **roles**:
  - `superadmin`
  - `restaurant`
- **RLS (Row Level Security)**:
  - restaurante só vê dados do próprio projeto
  - superadmin vê tudo

👉 Isso é **muito bom**. Segurança já está bem encaminhada.

---

## ✅ Funcionalidades do Restaurante (core do produto)

- Gerar QR Code para clientes
- Escanear QR Code com câmera
- Registrar visita via função RPC (`fn_scanner_visit`)
- Dashboard com KPIs via RPC (`fn_get_stats`)

👉 Ou seja: **o produto básico funciona sem Wallet**.

---

## ✅ Painel do Superadmin (parcial)

- CRUD de projetos
- Configuração de localizações
- Gestão de membros (associar usuários a projetos)

---

# 3️⃣ O que falta fazer (organizado de forma simples)

Aqui está o **mapa real do que falta**, sem maquiagem.

---

## 🔴 BLOCO A — Wallet (parte mais crítica)

Hoje:

- ❌ NÃO gera Apple Wallet
- ❌ NÃO gera Google Wallet
- ❌ NÃO cria link único de carteira

O README é explícito:

> “Edge Functions precisam ser criadas e deployadas”

### O que isso significa em português:

Você precisa criar **3 funções no Supabase**, que rodam no backend:

1. `wallet-google-save-link`  
   👉 Gera link “Salvar no Google Wallet”

2. `wallet-apple-pkpass`  
   👉 Gera o arquivo `.pkpass` (Apple Wallet)

3. `admin-create-user`  
   👉 Cria usuários automaticamente (ex: restaurante)

Essas funções usam **Node.js / Deno**, mas:

- você **não precisa dominar Node.js**
- você só precisa **seguir um passo a passo**

---

## 🔴 BLOCO B — Variáveis de Ambiente (obrigatório)

Sem isso, nada de Wallet funciona.

Você vai precisar:

- Certificado Apple (arquivo convertido em Base64)
- Conta Google Wallet Issuer
- Service Account do Google
- Service Role Key do Supabase

👉 Isso não é código. É **configuração**.

---

## 🟡 BLOCO C — Frontend (acabamento)

Segundo o README:

- ⚠️ Configuração de Wallet → não finalizada
- ⚠️ Visualização de clientes → não finalizada

Ou seja:

- UI ainda não conversa com as Edge Functions
- Falta botão tipo:

  > “Gerar cartão do cliente”

---

## 🟡 BLOCO D — Produto / Operação

Faltas comuns que **não estão explícitas**, mas são reais:

- Teste completo do fluxo:
  - cliente novo → QR → visita → Wallet
- Tratamento de erros (ex: Apple fora do ar)
- Documentação mínima para o cliente final
