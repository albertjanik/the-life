-- The Life — database schema
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables

create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  email        text,
  display_name text,
  created_at   timestamptz not null default now()
);

create table if not exists public.boards (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  invite_code text not null unique,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.board_members (
  board_id     uuid not null references public.boards on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  role         text not null default 'member' check (role in ('owner','member')),
  display_name text,
  hue          int  not null default 163,
  joined_at    timestamptz not null default now(),
  primary key (board_id, user_id)
);

create table if not exists public.sections (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.boards on delete cascade,
  key         text not null,
  name        text not null,
  code        text not null,
  hue         int  not null default 163,
  description text not null default '',
  position    int  not null default 0,
  unique (board_id, key)
);

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.boards on delete cascade,
  section_id  uuid references public.sections on delete set null,
  title       text not null,
  due_date    date not null default current_date,
  recurrence  text check (recurrence in ('daily','weekly','biweekly','monthly','quarterly','yearly')),
  assignee_id uuid references auth.users on delete set null,   -- null = shared
  important   boolean not null default false,
  done        boolean not null default false,
  done_at     timestamptz,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.notes (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references public.boards on delete cascade,
  section_id uuid references public.sections on delete set null,
  title      text not null,
  body       text not null default '',
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.habits (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.boards on delete cascade,
  section_id  uuid references public.sections on delete set null,
  name        text not null,
  target      text not null default 'every day',
  assignee_id uuid references auth.users on delete set null,   -- null = shared
  created_at  timestamptz not null default now()
);

create table if not exists public.habit_days (
  habit_id uuid not null references public.habits on delete cascade,
  day      date not null,
  board_id uuid not null references public.boards on delete cascade,
  user_id  uuid references auth.users on delete set null,
  primary key (habit_id, day)
);

-- Added later: when true, ticking a repeating task off starts the next period
-- from that moment instead of keeping the fixed schedule.
alter table public.tasks
  add column if not exists recur_from_completion boolean not null default false;

-- Added later: a small profile picture, stored inline as a data URL
-- (resized to 128x128 in the browser before it is saved).
alter table public.profiles
  add column if not exists avatar_url text;

-- Added later: notes on a task, and its checklist.
alter table public.tasks
  add column if not exists description text not null default '';

create table if not exists public.subtasks (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks on delete cascade,
  board_id   uuid not null references public.boards on delete cascade,
  title      text not null,
  done       boolean not null default false,
  position   int  not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists subtasks_task_idx on public.subtasks (task_id, position);

create index if not exists tasks_board_due_idx  on public.tasks (board_id, done, due_date);
create index if not exists notes_board_idx      on public.notes (board_id, section_id);
create index if not exists habits_board_idx     on public.habits (board_id);
create index if not exists habit_days_board_idx on public.habit_days (board_id, day);

-- ------------------------------------------------------------- helpers

-- Membership check used by every policy. SECURITY DEFINER so the policy on
-- board_members cannot recurse into itself.
create or replace function public.is_board_member(b uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.board_members m
    where m.board_id = b and m.user_id = auth.uid()
  );
$$;

create or replace function public.shares_board_with(u uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from public.board_members me
    join public.board_members them on them.board_id = me.board_id
    where me.user_id = auth.uid() and them.user_id = u
  );
$$;

-- New auth user -> profile row.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------ row level security

alter table public.profiles      enable row level security;
alter table public.boards        enable row level security;
alter table public.board_members enable row level security;
alter table public.sections      enable row level security;
alter table public.tasks         enable row level security;
alter table public.notes         enable row level security;
alter table public.habits        enable row level security;
alter table public.habit_days    enable row level security;
alter table public.subtasks      enable row level security;

drop policy if exists profiles_read   on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_read on public.profiles for select
  using (id = auth.uid() or public.shares_board_with(id));
create policy profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists boards_read   on public.boards;
drop policy if exists boards_update on public.boards;
drop policy if exists boards_delete on public.boards;
create policy boards_read on public.boards for select
  using (public.is_board_member(id));
create policy boards_update on public.boards for update
  using (public.is_board_member(id)) with check (public.is_board_member(id));
create policy boards_delete on public.boards for delete
  using (created_by = auth.uid());

drop policy if exists members_read   on public.board_members;
drop policy if exists members_leave  on public.board_members;
drop policy if exists members_update on public.board_members;
create policy members_read on public.board_members for select
  using (public.is_board_member(board_id));
create policy members_leave on public.board_members for delete
  using (user_id = auth.uid());
-- Your own row: your name on the board and your colour. (Without this the
-- update silently touched zero rows and the change came back on the next read.)
create policy members_update on public.board_members for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Everything inside a board: any member may read and write.
do $$
declare t text;
begin
  foreach t in array array['sections','tasks','notes','habits','habit_days','subtasks'] loop
    execute format('drop policy if exists %I_all on public.%I', t, t);
    execute format(
      'create policy %I_all on public.%I for all
         using (public.is_board_member(board_id))
         with check (public.is_board_member(board_id))', t, t);
  end loop;
end $$;

-- --------------------------------------------------------------- rpc

create or replace function public.gen_invite_code()
returns text language plpgsql as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  i int;
begin
  loop
    code := '';
    for i in 1..4 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    code := 'HOME-' || code;
    exit when not exists (select 1 from public.boards b where b.invite_code = code);
  end loop;
  return code;
end;
$$;

-- Creates a board, adds the caller as owner and seeds the default sections.
create or replace function public.create_board(p_name text, p_display_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  b_id uuid;
  uid  uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;

  insert into public.boards (name, invite_code, created_by)
  values (coalesce(nullif(trim(p_name), ''), 'Our board'), public.gen_invite_code(), uid)
  returning id into b_id;

  insert into public.board_members (board_id, user_id, role, display_name, hue)
  values (b_id, uid, 'owner',
          coalesce(nullif(trim(p_display_name), ''),
                   (select display_name from public.profiles where id = uid), 'Me'),
          163);

  insert into public.sections (board_id, key, name, code, hue, description, position) values
    (b_id,'learning','Learning','LE',230,'Courses, exams, reading and everything you are studying right now.',1),
    (b_id,'dreams','Dreams','DR',295,'Things with no deadline that you keep coming back to.',2),
    (b_id,'travel','Travel','TR',196,'Where you want to go, when, for how much, and what has to be booked first.',3),
    (b_id,'household','Household','HO',120,'Cleaning, servicing, repairs and the rhythm of the house.',4),
    (b_id,'car','Car','CA',210,'Deadlines, servicing, running costs and vehicle paperwork.',5),
    (b_id,'finances','Finances','FI',38,'Household budget, bills, savings and money goals.',6),
    (b_id,'health','Health & Fitness','HF',345,'Appointments, check-ups and the training plan.',7),
    (b_id,'work','Work & Career','WC',262,'Career goals, reviews, certifications and formalities.',8),
    (b_id,'family','Family & Friends','FF',16,'Birthdays, anniversaries, gifts, visits and shared plans.',9),
    (b_id,'shopping','Shopping & Pantry','SP',76,'Shopping list, supplies and one-off things to buy.',10),
    (b_id,'documents','Documents & Renewals','DO',170,'Contracts, insurance, expiry dates and subscriptions.',11);

  return b_id;
end;
$$;

-- Joins the board with the given invite code. Returns the board id.
create or replace function public.join_board(p_code text, p_display_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  b_id uuid;
  uid  uuid := auth.uid();
  n    int;
begin
  if uid is null then raise exception 'not authenticated'; end if;

  select id into b_id from public.boards
   where upper(invite_code) = upper(trim(p_code));
  if b_id is null then raise exception 'invite code not found'; end if;

  select count(*) into n from public.board_members where board_id = b_id;

  insert into public.board_members (board_id, user_id, role, display_name, hue)
  values (b_id, uid, 'member',
          coalesce(nullif(trim(p_display_name), ''),
                   (select display_name from public.profiles where id = uid), 'Me'),
          case when n = 1 then 288 else 30 + (n * 47) % 330 end)
  on conflict (board_id, user_id) do nothing;

  return b_id;
end;
$$;

-- Owner can roll the invite code.
create or replace function public.rotate_invite_code(p_board uuid)
returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not exists (select 1 from public.board_members
                  where board_id = p_board and user_id = auth.uid() and role = 'owner')
  then raise exception 'only the owner can change the invite code'; end if;
  c := public.gen_invite_code();
  update public.boards set invite_code = c where id = p_board;
  return c;
end;
$$;

-- Table privileges (row level security above still decides which rows).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant usage on schema public to authenticated;
    grant select, insert, update, delete on
      public.profiles, public.boards, public.board_members, public.sections,
      public.tasks, public.notes, public.habits, public.habit_days, public.subtasks
      to authenticated;
  end if;
end $$;

grant execute on function public.create_board(text, text)      to authenticated;
grant execute on function public.join_board(text, text)        to authenticated;
grant execute on function public.rotate_invite_code(uuid)      to authenticated;

-- --------------------------------------------------------- realtime

do $$
declare t text;
begin
  foreach t in array array['boards','board_members','sections','tasks','notes','habits','habit_days','subtasks'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
