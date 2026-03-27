
# Guia Supabase CLI

## 1. Contexto e Análise Inicial

O Supabase CLI permite gerenciar banco de dados, autenticação, storage e mais, tudo pelo terminal. Vamos passar por comandos principais e também como integrar Edge Functions ao seu fluxo.

---

## 2. Comandos Principais

### 1. **Instalação do Supabase CLI**

Se você ainda não tem o Supabase CLI instalado, rode o comando abaixo para instalar globalmente:

```bash
npm install -g supabase
```

Ou use o comando `npx` (sem precisar de instalação global):

```bash
npx supabase --version
```

---

### 2. **Login no Supabase**

Para fazer login com sua conta Supabase (usando o navegador):

```bash
npx supabase login
```

Isso abrirá uma URL no navegador para você autorizar.

---

### 3. **Conectar ao Projeto Supabase**

Para conectar seu CLI a um projeto Supabase:

```bash
npx supabase link --project-ref <YOUR_PROJECT_REF>
```

Substitua `<YOUR_PROJECT_REF>` pelo seu identificador de projeto, que pode ser encontrado na URL do seu projeto.

---

### 4. **Gerenciar Migrations**

#### **Criar uma nova Migration**

Para criar uma migration (um arquivo SQL) para mudanças no banco de dados:

```bash
npx supabase migration new <NOME_DA_MIGRATION>
```

Exemplo:

```bash
npx supabase migration new create_table_clients
```

Esse comando cria um arquivo de SQL na pasta `supabase/migrations/`, onde você pode adicionar o código SQL para a modificação que deseja aplicar no banco de dados.

#### **Aplicar Migrations no Banco**

Para aplicar as migrations locais no banco de dados remoto:

```bash
npx supabase db push
```

Esse comando executa as migrations que ainda não foram aplicadas no banco.

#### **Reverter a última Migration**

Se você quiser desfazer a última migration, use:

```bash
npx supabase db rollback
```

#### **Listar Migrations**

Para ver o histórico de migrations (tanto locais quanto remotas):

```bash
npx supabase migration list
```

Esse comando vai mostrar o histórico de migrations aplicadas, e você pode ver se há discrepâncias entre o banco remoto e o local.

#### **Reparar Histórico de Migrations**

Se houver problemas de sincronização no histórico de migrations, você pode usar o comando:

```bash
npx supabase migration repair --status reverted <MIGRATION_ID>
```

Onde `<MIGRATION_ID>` é o ID da migration que você deseja reparar. Esse comando ajuda a corrigir inconsistências no banco de dados, revertendo ou aplicando migrations.

---

### 5. **Trabalhando com Banco de Dados**

#### **Puxar o Schema Remoto (DB Pull)**

Para gerar migrations locais baseadas no estado atual do banco remoto:

```bash
npx supabase db pull
```

Esse comando gera um arquivo de migration que reflete o banco remoto. Ideal para quando você começa um projeto e deseja garantir que o estado do banco remoto seja refletido localmente.

#### **Empurrar o Banco Local (DB Push)**

Para enviar suas alterações de schema (migrations locais) para o banco remoto:

```bash
npx supabase db push
```

Esse comando aplica as migrations no banco remoto, criando ou modificando tabelas conforme o código SQL nas migrations locais.

---

### 6. **Gerenciar Storage**

#### **Subir Arquivos no Storage**

Para interagir com o storage do Supabase (para upload de arquivos):

```bash
npx supabase storage upload <BUCKET_NAME> <LOCAL_PATH> <REMOTE_PATH>
```

Exemplo:

```bash
npx supabase storage upload my_bucket ./my_file.txt remote_file.txt
```

#### **Baixar Arquivos do Storage**

Para baixar arquivos do Supabase Storage:

```bash
npx supabase storage download <BUCKET_NAME> <REMOTE_PATH> <LOCAL_PATH>
```

---

### 7. **Gerenciar Autenticação (Auth)**

#### **Criar uma Nova Tabela de Autenticação**

Se você estiver criando um sistema de autenticação manual, pode usar o comando para configurar um novo serviço de autenticação:

```bash
npx supabase auth new
```

Isso cria as tabelas necessárias para a autenticação no Supabase.

---

### 8. **Configurações do Projeto**

#### **Obter Referência do Projeto (Project Ref)**

Para obter a referência do seu projeto, você pode usar:

```bash
npx supabase status
```

Esse comando mostra o status atual do seu projeto, incluindo a referência do projeto (`PROJECT_REF`), o banco de dados e o ambiente.

---

### 9. **Subir Ambiente Local**

Para rodar o Supabase localmente, você pode usar Docker com o comando:

```bash
npx supabase start
```

Isso inicia o Supabase localmente usando Docker, permitindo que você desenvolva sem precisar de um ambiente remoto.

---

## 3. Edge Functions

### O que são Edge Functions?

As **Edge Functions** do Supabase são funções serverless que rodam **próximas do usuário**, permitindo baixa latência e desempenho de alto nível. Elas são executadas na borda da rede, usando a infraestrutura do **Cloudflare Workers**, que oferece escalabilidade e proximidade geográfica.

### Como Criar uma Edge Function

Para criar uma Edge Function, use o comando:

```bash
npx supabase functions new <nome_da_funcao>
```

Isso criará um esqueleto de função que você pode editar. O código da função fica em `supabase/functions/`.

### Como Rodar uma Edge Function

Para rodar uma Edge Function localmente:

```bash
npx supabase functions serve
```

Isso permite testar suas funções no ambiente local antes de enviar para o Supabase.

### Como Implantar uma Edge Function

Depois de desenvolver sua função, para implantá-la no Supabase, basta usar:

```bash
npx supabase functions deploy <nome_da_funcao>
```

---