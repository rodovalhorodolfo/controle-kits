-- ============================================================
-- CONTROLE DE KITS - MIGRAÇÃO V6
-- Nova estrutura: items -> kit_items -> kits
-- Preserva integralmente a tabela sales e suas composições históricas.
-- Execute somente depois de conferir/backup dos dados atuais.
-- ============================================================

begin;

-- 1) Tabela mestre de itens
create table if not exists public.items (
    id uuid primary key default gen_random_uuid(),
    nome text not null,
    ativo boolean not null default true,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Unicidade lógica do nome, ignorando maiúsculas/minúsculas e espaços laterais.
create unique index if not exists items_nome_unique
on public.items (lower(trim(nome)));

-- 2) Popular items a partir das composições atuais de kit_items
insert into public.items (nome, ativo, created_by)
select distinct trim(ki.item), true, min(ki.created_by)
from public.kit_items ki
where nullif(trim(ki.item), '') is not null
  and not exists (
      select 1 from public.items i
      where lower(trim(i.nome)) = lower(trim(ki.item))
  )
group by trim(ki.item);

-- Também importar nomes presentes nas composições históricas de vendas.
insert into public.items (nome, ativo)
select distinct trim(x.item), true
from public.sales s
cross join lateral jsonb_to_recordset(coalesce(s.composicao, '[]'::jsonb))
    as x(item text, quantidade numeric)
where s.composicao is not null
  and nullif(trim(x.item), '') is not null
  and not exists (
      select 1 from public.items i
      where lower(trim(i.nome)) = lower(trim(x.item))
  );

-- 3) Adicionar item_id à tabela de composição atual.
alter table public.kit_items
add column if not exists item_id uuid;

-- 4) Vincular as composições atuais aos itens mestre.
update public.kit_items ki
set item_id = i.id
from public.items i
where ki.item_id is null
  and lower(trim(ki.item)) = lower(trim(i.nome));

-- 5) Segurança: não deve existir composição sem item correspondente.
do $$
begin
  if exists (select 1 from public.kit_items where item_id is null) then
    raise exception 'Existem registros em kit_items sem item_id após a migração.';
  end if;
end $$;

-- 6) Se houver o mesmo item repetido dentro do mesmo kit, consolidar.
-- Mantemos o registro de menor UUID e somamos as quantidades.
with grupos as (
  select
    min(id) as manter_id,
    kit_id,
    item_id,
    sum(quantidade) as quantidade_total,
    array_agg(id) as ids
  from public.kit_items
  group by kit_id, item_id
  having count(*) > 1
), atualizar as (
  update public.kit_items ki
  set quantidade = g.quantidade_total
  from grupos g
  where ki.id = g.manter_id
  returning ki.id
)
delete from public.kit_items ki
using grupos g
where ki.id = any(g.ids)
  and ki.id <> g.manter_id;

-- 7) FK e unicidade: um item aparece uma única vez em cada kit.
alter table public.kit_items
drop constraint if exists kit_items_item_id_fkey;

alter table public.kit_items
add constraint kit_items_item_id_fkey
foreign key (item_id) references public.items(id) on delete restrict;

create unique index if not exists kit_items_kit_item_unique
on public.kit_items (kit_id, item_id);

-- 8) Agora que item_id está preenchido, o texto antigo deixa de ser necessário.
alter table public.kit_items
drop column if exists item;

-- 9) RLS para items.
alter table public.items enable row level security;

drop policy if exists "items_select_allowed" on public.items;
drop policy if exists "items_insert_allowed" on public.items;
drop policy if exists "items_update_allowed" on public.items;
drop policy if exists "items_delete_allowed" on public.items;

create policy "items_select_allowed"
on public.items for select to authenticated
using (public.is_allowed_user());

create policy "items_insert_allowed"
on public.items for insert to authenticated
with check (public.is_allowed_user());

create policy "items_update_allowed"
on public.items for update to authenticated
using (public.is_allowed_user())
with check (public.is_allowed_user());

create policy "items_delete_allowed"
on public.items for delete to authenticated
using (public.is_allowed_user());

-- 10) Reforçar RLS de kit_items com a nova estrutura.
drop policy if exists "kit_items_select_allowed" on public.kit_items;
drop policy if exists "kit_items_insert_allowed" on public.kit_items;
drop policy if exists "kit_items_update_allowed" on public.kit_items;
drop policy if exists "kit_items_delete_allowed" on public.kit_items;

create policy "kit_items_select_allowed"
on public.kit_items for select to authenticated
using (public.is_allowed_user());

create policy "kit_items_insert_allowed"
on public.kit_items for insert to authenticated
with check (public.is_allowed_user());

create policy "kit_items_update_allowed"
on public.kit_items for update to authenticated
using (public.is_allowed_user())
with check (public.is_allowed_user());

create policy "kit_items_delete_allowed"
on public.kit_items for delete to authenticated
using (public.is_allowed_user());

-- 11) RPC para criar kit já com seu primeiro item.
-- Assim não existe, pela operação normal da interface, um kit vazio.
create or replace function public.create_kit_with_item(
    p_nome text,
    p_item_id uuid,
    p_quantidade numeric
)
returns public.kits
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_kit public.kits;
begin
    if not public.is_allowed_user() then
        raise exception 'Usuário não autorizado.';
    end if;

    if nullif(trim(p_nome), '') is null then
        raise exception 'Nome do kit é obrigatório.';
    end if;

    if p_quantidade is null or p_quantidade <= 0 then
        raise exception 'Quantidade deve ser maior que zero.';
    end if;

    if not exists (select 1 from public.items where id = p_item_id and ativo = true) then
        raise exception 'Item não encontrado ou inativo.';
    end if;

    if exists (
        select 1 from public.kits
        where lower(trim(nome)) = lower(trim(p_nome))
          and ativo = true
    ) then
        raise exception 'Já existe um kit com este nome.';
    end if;

    insert into public.kits (nome, ativo, created_by)
    values (trim(p_nome), true, auth.uid())
    returning * into v_kit;

    insert into public.kit_items (kit_id, item_id, quantidade, created_by)
    values (v_kit.id, p_item_id, p_quantidade, auth.uid());

    return v_kit;
end;
$$;

revoke all on function public.create_kit_with_item(text, uuid, numeric) from public;
grant execute on function public.create_kit_with_item(text, uuid, numeric) to authenticated;

commit;

-- Conferência final
select 'items' as tabela, count(*) as registros from public.items
union all
select 'kits', count(*) from public.kits
union all
select 'kit_items', count(*) from public.kit_items
union all
select 'sales', count(*) from public.sales;
