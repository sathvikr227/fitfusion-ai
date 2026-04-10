-- FitFusion AI: Additional tables and columns
-- Run this in Supabase SQL Editor

-- ── mood_logs ─────────────────────────────────────────────────────────────────
create table if not exists mood_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  date        date not null,
  mood        integer not null check (mood between 1 and 5),
  created_at  timestamptz default now(),
  unique(user_id, date)
);
alter table mood_logs enable row level security;
create policy "Users can manage own mood_logs" on mood_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── water_logs ────────────────────────────────────────────────────────────────
create table if not exists water_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  date        date not null,
  amount_ml   integer not null default 0,
  created_at  timestamptz default now(),
  unique(user_id, date)
);
alter table water_logs enable row level security;
create policy "Users can manage own water_logs" on water_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── workout_execution ─────────────────────────────────────────────────────────
create table if not exists workout_execution (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  date          date not null,
  exercise_name text not null,
  done          boolean default false,
  created_at    timestamptz default now(),
  unique(user_id, date, exercise_name)
);
alter table workout_execution enable row level security;
create policy "Users can manage own workout_execution" on workout_execution
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── meal_execution ────────────────────────────────────────────────────────────
create table if not exists meal_execution (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  date        date not null,
  meal_name   text not null,
  eaten       boolean default false,
  created_at  timestamptz default now(),
  unique(user_id, date, meal_name)
);
alter table meal_execution enable row level security;
create policy "Users can manage own meal_execution" on meal_execution
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── assistant_messages ────────────────────────────────────────────────────────
create table if not exists assistant_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  created_at  timestamptz default now()
);
alter table assistant_messages enable row level security;
create policy "Users can manage own assistant_messages" on assistant_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Add new profile columns ───────────────────────────────────────────────────
alter table profiles
  add column if not exists calorie_target     integer,
  add column if not exists protein_target     integer,
  add column if not exists carbs_target       integer,
  add column if not exists fat_target         integer,
  add column if not exists dietary_restrictions jsonb default '[]'::jsonb;

-- ── fitness_knowledge (RAG) ───────────────────────────────────────────────────
create table if not exists fitness_knowledge (
  id          bigserial primary key,
  content     text not null,
  embedding   vector(1536),
  created_at  timestamptz default now()
);
create index if not exists fitness_knowledge_embedding_idx
  on fitness_knowledge using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- match_fitness_knowledge RPC
create or replace function match_fitness_knowledge(
  query_embedding vector(1536),
  match_count     int default 5
)
returns table (id bigint, content text, similarity float)
language sql stable as $$
  select id, content, 1 - (embedding <=> query_embedding) as similarity
  from fitness_knowledge
  order by embedding <=> query_embedding
  limit match_count;
$$;
