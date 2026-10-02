# Controle de Kits V6

V6 separa cadastro mestre de itens, kits e composição de kits.

## Banco

1. Faça backup JSON antes da migração.
2. No Supabase SQL Editor, execute `sql/migrate_v6.sql`.
3. Confira o resultado final e as composições.
4. O SQL preserva `sales` e suas composições históricas.

## Aplicativo

Depois da migração, substitua no GitHub os arquivos:
- `index.html`
- `css/styles.css`
- `js/app.js`
- `js/db.js`
- `js/localdb.js`

Os demais arquivos de autenticação/configuração permanecem iguais.
