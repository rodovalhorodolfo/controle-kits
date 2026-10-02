-- Schema compatível com o Controle de Kits V4.
-- O banco definitivo já foi criado no projeto Supabase.
-- Este arquivo é apenas uma referência/reprodução do modelo.

create extension if not exists pgcrypto;

drop table if exists public.sales cascade;
drop table if exists public.kit_items cascade;
drop table if exists public.kits cascade;
drop table if exists public.allowed_users cascade;

create table public.allowed_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.kits (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ativo boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.kit_items (
  id uuid primary key default gen_random_uuid(),
  kit_id uuid not null references public.kits(id) on delete cascade,
  item text not null,
  quantidade numeric(14,3) not null check (quantidade > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  data date not null default current_date,
  produto text not null,
  tipo text not null check (tipo in ('kit','item')),
  quantidade numeric(14,3) not null check (quantidade > 0),
  composicao jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_allowed_users_ativo on public.allowed_users(ativo);
create index if not exists idx_kits_created_by on public.kits(created_by);
create index if not exists idx_kit_items_kit_id on public.kit_items(kit_id);
create index if not exists idx_sales_data on public.sales(data);
create index if not exists idx_sales_created_by on public.sales(created_by);

alter table public.allowed_users enable row level security;
alter table public.kits enable row level security;
alter table public.kit_items enable row level security;
alter table public.sales enable row level security;

create or replace function public.is_allowed_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.allowed_users
    where user_id = auth.uid() and ativo = true
  );
$$;

revoke all on function public.is_allowed_user() from public;
grant execute on function public.is_allowed_user() to authenticated;

grant select, insert, update, delete on public.allowed_users to authenticated;
grant select, insert, update, delete on public.kits to authenticated;
grant select, insert, update, delete on public.kit_items to authenticated;
grant select, insert, update, delete on public.sales to authenticated;

create policy "allowed_users_select_own"
on public.allowed_users for select to authenticated
using (user_id = auth.uid());

create policy "kits_shared_access"
on public.kits for all to authenticated
using (public.is_allowed_user())
with check (public.is_allowed_user());

create policy "kit_items_shared_access"
on public.kit_items for all to authenticated
using (public.is_allowed_user())
with check (public.is_allowed_user());

create policy "sales_shared_access"
on public.sales for all to authenticated
using (public.is_allowed_user())
with check (public.is_allowed_user());
