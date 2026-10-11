-- 家庭账本 数据库初始化脚本
-- 用法：Supabase 控制台 → SQL Editor → New query → 粘贴全部内容 → Run
-- 可以重复运行（会跳过已存在的对象）

create extension if not exists pgcrypto;

-- ========== 表 ==========

-- 账本
create table if not exists public.ledgers (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  initial_balance numeric(14,2) not null default 0,
  invite_code     text not null unique default upper(substr(md5(random()::text), 1, 8)),
  owner_id        uuid not null references auth.users(id) on delete cascade,
  created_at      timestamptz not null default now()
);

-- 账本成员
create table if not exists public.ledger_members (
  ledger_id  uuid not null references public.ledgers(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  nickname   text not null,
  joined_at  timestamptz not null default now(),
  primary key (ledger_id, user_id)
);

-- 收支流水（余额不单独存，由流水实时计算）
create table if not exists public.transactions (
  id           uuid primary key default gen_random_uuid(),
  ledger_id    uuid not null references public.ledgers(id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users(id),
  type         text not null check (type in ('income', 'expense')),
  amount       numeric(14,2) not null check (amount > 0),
  category     text not null default '其他',
  note         text not null default '',
  occurred_on  date not null default current_date,
  receipt_path text,
  created_at   timestamptz not null default now()
);
create index if not exists transactions_ledger_date_idx
  on public.transactions (ledger_id, occurred_on desc);

-- ========== 权限辅助函数 ==========

create or replace function public.is_member(p_ledger uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from ledger_members
    where ledger_id = p_ledger and user_id = auth.uid()
  );
$$;

-- ========== 行级安全（只有账本成员能看到/修改账本数据） ==========

alter table public.ledgers        enable row level security;
alter table public.ledger_members enable row level security;
alter table public.transactions   enable row level security;

drop policy if exists "成员可查看账本" on public.ledgers;
create policy "成员可查看账本" on public.ledgers
  for select using (public.is_member(id));
drop policy if exists "创建者可修改账本" on public.ledgers;
create policy "创建者可修改账本" on public.ledgers
  for update using (owner_id = auth.uid());
drop policy if exists "创建者可删除账本" on public.ledgers;
create policy "创建者可删除账本" on public.ledgers
  for delete using (owner_id = auth.uid());

drop policy if exists "成员可查看成员" on public.ledger_members;
create policy "成员可查看成员" on public.ledger_members
  for select using (public.is_member(ledger_id));
drop policy if exists "可修改自己的昵称" on public.ledger_members;
create policy "可修改自己的昵称" on public.ledger_members
  for update using (user_id = auth.uid());
drop policy if exists "可退出账本" on public.ledger_members;
create policy "可退出账本" on public.ledger_members
  for delete using (user_id = auth.uid());

drop policy if exists "成员可查看流水" on public.transactions;
create policy "成员可查看流水" on public.transactions
  for select using (public.is_member(ledger_id));
drop policy if exists "成员可记账" on public.transactions;
create policy "成员可记账" on public.transactions
  for insert with check (public.is_member(ledger_id) and user_id = auth.uid());
drop policy if exists "成员可修改流水" on public.transactions;
create policy "成员可修改流水" on public.transactions
  for update using (public.is_member(ledger_id)) with check (public.is_member(ledger_id));
drop policy if exists "成员可删除流水" on public.transactions;
create policy "成员可删除流水" on public.transactions
  for delete using (public.is_member(ledger_id));

-- ========== 业务函数 ==========

-- 创建账本并把自己加为成员
create or replace function public.create_ledger(p_name text, p_initial numeric, p_nickname text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception '未登录'; end if;
  insert into ledgers (name, initial_balance, owner_id)
    values (coalesce(nullif(trim(p_name), ''), '我家账本'), coalesce(p_initial, 0), auth.uid())
    returning id into v_id;
  insert into ledger_members (ledger_id, user_id, nickname)
    values (v_id, auth.uid(), coalesce(nullif(trim(p_nickname), ''), '我'));
  return v_id;
end $$;

-- 用邀请码加入账本
create or replace function public.join_ledger(p_code text, p_nickname text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception '未登录'; end if;
  select id into v_id from ledgers where invite_code = upper(trim(p_code));
  if v_id is null then raise exception '邀请码不存在'; end if;
  insert into ledger_members (ledger_id, user_id, nickname)
    values (v_id, auth.uid(), coalesce(nullif(trim(p_nickname), ''), '家人'))
    on conflict (ledger_id, user_id) do update set nickname = excluded.nickname;
  return v_id;
end $$;

-- 账本累计收支（security invoker：受上面的行级安全约束）
create or replace function public.ledger_totals(p_ledger uuid)
returns table (income numeric, expense numeric)
language sql stable
as $$
  select
    coalesce(sum(amount) filter (where type = 'income'), 0),
    coalesce(sum(amount) filter (where type = 'expense'), 0)
  from public.transactions
  where ledger_id = p_ledger;
$$;

-- ========== 实时同步 ==========

do $$
begin
  alter publication supabase_realtime add table public.transactions;
exception when duplicate_object then null;
end $$;

-- ========== 小票照片存储 ==========
-- 路径格式：<账本id>/<随机id>.jpg，只有该账本成员能读写

insert into storage.buckets (id, name, public)
  values ('receipts', 'receipts', false)
  on conflict (id) do nothing;

drop policy if exists "成员可查看小票" on storage.objects;
create policy "成员可查看小票" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "成员可上传小票" on storage.objects;
create policy "成员可上传小票" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "成员可删除小票" on storage.objects;
create policy "成员可删除小票" on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts' and public.is_member(((storage.foldername(name))[1])::uuid));
