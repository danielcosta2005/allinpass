# Carteira 4.9 - Programa de Fidelidade Digital com Supabase

Sistema completo de fidelidade com integração Apple Wallet e Google Wallet, agora com backend via Supabase.

## 🚀 Funcionalidades

### Superadmin
- ✅ Gerenciamento de projetos (CRUD completo)
- ✅ Configuração de localizações por projeto
- ✅ Gestão de membros (associação de usuários a projetos)
- 🚧 Configuração de Wallet
- 🚧 Visualização de clientes

### Restaurante
- ✅ Geração de QR Codes para clientes
- ✅ Scanner de QR Code com câmera e registro de visita via RPC
- ✅ Dashboard com KPIs em tempo real via RPC
- ✅ Acesso restrito apenas ao seu projeto via RLS

## 📋 Configuração com Supabase

O frontend está totalmente integrado com o Supabase para autenticação e banco de dados.

### Variáveis de Ambiente Necessárias
Para o deploy e funcionamento das Edge Functions (próximo passo), você precisará configurar as seguintes variáveis de ambiente no seu projeto Supabase:

```env
# Segredos da Apple Wallet
APPLE_PASS_CERT_P12_BASE64=...
APPLE_PASS_CERT_PASSWORD=...
APPLE_TEAM_ID=...
APPLE_KEY_ID=...
APPLE_PASS_TYPE_IDENTIFIER=pass.com.suaempresa.carteira49

# Segredos do Google Wallet
GOOGLE_WALLET_SERVICE_ACCOUNT_JSON=...
GOOGLE_WALLET_ISSUER_ID=...

# Chave de Serviço do Supabase (para funções administrativas)
SUPABASE_SERVICE_ROLE_KEY=...
```

### Setup Inicial

1. **Criar Usuário Superadmin:**
   - Cadastre um novo usuário no seu app.
   - Execute o seguinte comando SQL no editor do Supabase para torná-lo superadmin (substitua pelo ID do usuário recém-criado):
     ```sql
     -- Encontre o ID com: select id, email from auth.users;
     insert into public.profiles (id, role) values ('SEU_USER_ID_AQUI', 'superadmin');
     ```

2. **Criar Projeto e Usuário Restaurante:**
   - Use o painel de Superadmin no aplicativo para criar um novo projeto.
   - (Próximo passo) Use o painel para criar um novo usuário com a role "restaurant" e associá-lo ao projeto.

## 🔐 Segurança Implementada com Supabase

- ✅ **Autenticação:** Gerenciada pelo Supabase Auth.
- ✅ **Autorização (RLS):** Políticas de Segurança a Nível de Linha garantem que:
  - Superadmins tenham acesso total.
  - Usuários "restaurant" só possam ler/escrever dados de seus próprios projetos.
- ✅ **Funções Seguras (RPC):** Ações críticas como registrar visitas (`fn_scanner_visit`) e calcular estatísticas (`fn_get_stats`) são feitas por funções `SECURITY DEFINER` que validam permissões internamente.

## 📱 Próximos Passos: Integração Wallet (Edge Functions)

As Edge Functions para gerar passes para Apple Wallet e Google Wallet precisam ser criadas e deployadas:

- `wallet-google-save-link`
- `wallet-apple-pkpass`
- `admin-create-user`

Estas funções usarão as variáveis de ambiente para acessar os segredos e certificados necessários.

## 📝 Licença

Proprietary - Todos os direitos reservados