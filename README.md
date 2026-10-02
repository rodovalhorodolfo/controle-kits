# Controle de Kits — V4

Aplicativo web/PWA para cadastro de kits, registro de vendas e consolidação de itens.

## Arquitetura

- Frontend: HTML/CSS/JavaScript
- Hospedagem: GitHub Pages
- Autenticação: Supabase Auth + Google OAuth
- Banco compartilhado: Supabase/PostgreSQL
- Autorização: `allowed_users` + Row Level Security (RLS)
- Cache local: IndexedDB
- Backup: JSON
- PWA: manifest + service worker

## Configuração

Edite `js/config.js`:

```js
export const SUPABASE_URL = "https://SEU-PROJETO.supabase.co";
export const SUPABASE_ANON_KEY = "SUA_CHAVE_PUBLICA";
```

Use somente a chave pública/anon/publishable. **Nunca coloque `service_role` no frontend.**

Depois configure:

1. Google OAuth no Google Cloud.
2. Provider Google no Supabase.
3. Site URL e Redirect URL no Supabase.
4. GitHub Pages.
5. Faça login com a conta do operador.
6. Em Supabase → Authentication → Users, copie o UUID.
7. Cadastre esse UUID em `public.allowed_users`.

## Importante sobre backup

A importação JSON nesta V4 restaura o cache local do navegador; ela não sobrescreve automaticamente o banco compartilhado. Isso evita que um backup antigo substitua os dados atuais de todos os operadores.

## Histórico de kits

Ao registrar uma venda de kit, a composição atual é copiada para `sales.composicao`. Assim, alterar o cadastro do kit posteriormente não altera o histórico das vendas anteriores.
