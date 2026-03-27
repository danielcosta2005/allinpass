# 🚀 Padrão de Commits do Projeto

Este documento define o padrão oficial de commits do projeto, baseado no **Conventional Commits**, com o objetivo de manter consistência, facilitar o versionamento e melhorar a colaboração entre desenvolvedores.

---

## 📌 Estrutura do Commit

```
<tipo>(<escopo>): <mensagem curta>

<descrição opcional>

<footer opcional>
```

---

## 🧩 Tipos de Commit

| Tipo       | Descrição |
|------------|----------|
| feat       | Nova funcionalidade |
| fix        | Correção de bug |
| refactor   | Refatoração sem alteração de comportamento |
| style      | Formatação de código (indentação, etc) |
| docs       | Documentação |
| test       | Testes |
| chore      | Configurações, dependências |
| perf       | Melhoria de performance |
| ci         | Integração contínua / pipelines |

---

## 🧭 Escopos do Projeto

| Escopo     | Uso |
|------------|-----|
| frontend   | React / UI |
| backend    | Node.js |
| database   | PostgreSQL / Supabase |
| auth       | Autenticação |
| api        | Rotas / controllers |
| ui         | Componentes visuais |
| config     | Configurações (.env, etc) |
| docker     | Docker |
| infra      | Deploy / cloud |

---

## 🔥 Exemplos

### Frontend
```
feat(frontend): cria layout base com react + tailwind
```

```
fix(ui): corrige bug no botão de login
```

### Backend
```
feat(api): cria rota de cadastro de usuário
```

```
fix(backend): corrige validação de senha
```

### Banco de Dados
```
feat(database): cria tabela de usuários com RLS
```

```
refactor(database): otimiza query de busca
```

### Infraestrutura
```
chore(docker): adiciona docker-compose com postgres
```

---

## 📏 Boas Práticas

### ✅ Mensagem curta e objetiva
- Máximo ~50 caracteres
- Direta ao ponto

❌ Evite:
```
feat: fiz várias coisas no sistema
```

✅ Prefira:
```
feat(auth): implementa login com JWT
```

---

### ✅ Use verbo no presente
- adiciona
- corrige
- remove

---

### ✅ Commits pequenos

❌ Evite:
```
feat: sistema completo
```

✅ Prefira:
```
feat(auth): cria endpoint de login
feat(auth): adiciona middleware de autenticação
feat(frontend): cria tela de login
```

---

### ✅ Consistência
Todos os desenvolvedores devem seguir o mesmo padrão.

---

## 🧪 Avançado

### ⚠️ Breaking Changes
```
feat(api)!: altera estrutura da resposta
```

### 🔗 Referência de Issue
```
fix(api): corrige erro de autenticação (#23)
```

---

## 🧱 Template

```
<tipo>(<escopo>): <mensagem>

- detalhe 1
- detalhe 2
- detalhe 3
```

---

## 📌 Recomendação para este projeto

Utilizar prioritariamente:

**Tipos:**
- feat
- fix
- refactor
- chore

**Escopos:**
- frontend
- backend
- database
- docker

---

## 🔗 Repositório

Referência do projeto:

fileciteturn0file0

---

## ✅ Objetivo

Este padrão garante:
- Histórico de commits organizado
- Facilidade de leitura
- Melhor integração com CI/CD
- Versionamento semântico mais eficiente

