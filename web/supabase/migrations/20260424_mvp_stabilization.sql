-- FitFusion AI: MVP stabilization schema
-- Idempotent tables, policies, storage bucket, and RAG RPC expected by the app.

create extension if not exists pgcrypto;
create extension if not exists vector;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  email text,
  full_name text,
  name text,
  age integer,
  gender text,
  height numeric,
  weight numeric,
  goal text,
  activity_level text,
  diet_preference text,
  training_style text,
  injuries text,
  workout_time text,
  daily_time_available text,
  sleep_hours text,
  days_off integer,
  rest_days_per_week integer,
  onboarding_completed boolean default false,
  calorie_target integer,
  protein_target integer,
  carbs_target integer,
  fat_target integer,
  dietary_restrictions jsonb default '[]'::jsonb,
  share_token uuid unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table profiles
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists email text,
  add column if not exists full_name text,
  add column if not exists name text,
  add column if not exists age integer,
  add column if not exists gender text,
  add column if not exists height numeric,
  add column if not exists weight numeric,
  add column if not exists goal text,
  add column if not exists activity_level text,
  add column if not exists diet_preference text,
  add column if not exists training_style text,
  add column if not exists injuries text,
  add column if not exists workout_time text,
  add column if not exists daily_time_available text,
  add column if not exists sleep_hours text,
  add column if not exists days_off integer,
  add column if not exists rest_days_per_week integer,
  add column if not exists onboarding_completed boolean default false,
  add column if not exists calorie_target integer,
  add column if not exists protein_target integer,
  add column if not exists carbs_target integer,
  add column if not exists fat_target integer,
  add column if not exists dietary_restrictions jsonb default '[]'::jsonb,
  add column if not exists share_token uuid unique,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create table if not exists workout_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date,
  plan jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists body_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  bmi numeric,
  estimated_body_fat_percent numeric,
  target_bmi numeric,
  target_body_fat_percent numeric,
  status text,
  weight numeric,
  height numeric,
  goal text,
  created_at timestamptz default now()
);

create table if not exists weight_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  weight numeric not null,
  notes text,
  created_at timestamptz default now(),
  unique(user_id, date)
);

create table if not exists workout_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  is_assigned boolean not null default false,
  plan_id uuid references workout_plans(id) on delete set null,
  total_calories numeric default 0,
  created_at timestamptz default now()
);

create table if not exists exercise_logs (
  id uuid primary key default gen_random_uuid(),
  workout_log_id uuid not null references workout_logs(id) on delete cascade,
  exercise_name text not null,
  sets numeric,
  reps numeric,
  weight numeric,
  duration numeric,
  calories numeric,
  created_at timestamptz default now()
);

create table if not exists meal_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  meal_type text,
  meal_name text,
  total_calories numeric default 0,
  total_protein numeric default 0,
  total_carbs numeric default 0,
  total_fat numeric default 0,
  protein numeric default 0,
  carbs numeric default 0,
  fat numeric default 0,
  is_completed boolean default false,
  source text,
  items jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

create table if not exists meal_items (
  id uuid primary key default gen_random_uuid(),
  meal_log_id uuid not null references meal_logs(id) on delete cascade,
  food_name text not null,
  quantity text,
  calories numeric default 0,
  protein numeric default 0,
  carbs numeric default 0,
  fat numeric default 0,
  created_at timestamptz default now()
);

create table if not exists sleep_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  sleep_hours numeric,
  duration_hours numeric,
  quality text,
  notes text,
  created_at timestamptz default now(),
  unique(user_id, date)
);

create table if not exists body_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  waist_cm numeric,
  chest_cm numeric,
  hips_cm numeric,
  left_arm_cm numeric,
  right_arm_cm numeric,
  left_thigh_cm numeric,
  right_thigh_cm numeric,
  neck_cm numeric,
  notes text,
  created_at timestamptz default now(),
  unique(user_id, date)
);

create table if not exists cardio_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  activity text not null,
  duration_minutes numeric not null,
  distance_km numeric,
  calories_burned numeric,
  avg_heart_rate numeric,
  notes text,
  created_at timestamptz default now()
);

create table if not exists progress_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  log_type text,
  weight numeric,
  completed boolean default false,
  calories_burned numeric default 0,
  calories_consumed numeric default 0,
  data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists vitals_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  systolic numeric,
  diastolic numeric,
  resting_heart_rate numeric,
  blood_sugar_mg_dl numeric,
  oxygen_saturation numeric,
  notes text,
  created_at timestamptz default now(),
  unique(user_id, date)
);

create table if not exists supplements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  dosage numeric not null,
  unit text not null,
  timing text not null,
  notes text,
  created_at timestamptz default now()
);

create table if not exists supplement_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  supplement_id uuid not null references supplements(id) on delete cascade,
  date date not null,
  taken boolean not null default false,
  created_at timestamptz default now(),
  unique(supplement_id, date)
);

create table if not exists habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  icon text not null default '',
  color text not null default 'violet',
  created_at timestamptz default now()
);

create table if not exists habit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid not null references habits(id) on delete cascade,
  date date not null,
  completed boolean not null default false,
  created_at timestamptz default now(),
  unique(habit_id, date)
);

create table if not exists injuries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  body_part text not null,
  severity text not null default 'mild',
  status text not null default 'active',
  date_occurred date not null,
  notes text,
  created_at timestamptz default now()
);

create table if not exists user_achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_id text not null,
  earned_at timestamptz default now(),
  created_at timestamptz default now(),
  unique(user_id, achievement_id)
);

create table if not exists chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  created_at timestamptz default now()
);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references chat_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz default now()
);

create table if not exists workouts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  body_part text,
  target text,
  equipment text,
  gif_url text,
  instructions jsonb default '[]'::jsonb,
  secondary_muscles jsonb default '[]'::jsonb,
  raw jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists mood_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  mood integer not null default 3 check (mood between 1 and 5),
  energy integer default 3,
  stress integer default 3,
  notes text,
  created_at timestamptz default now(),
  unique(user_id, date)
);

create table if not exists water_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  amount_ml integer not null default 0,
  created_at timestamptz default now(),
  unique(user_id, date)
);

create table if not exists workout_execution (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  exercise_name text not null,
  done boolean default false,
  created_at timestamptz default now(),
  unique(user_id, date, exercise_name)
);

create table if not exists meal_execution (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  meal_name text not null,
  eaten boolean default false,
  created_at timestamptz default now(),
  unique(user_id, date, meal_name)
);

create table if not exists assistant_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz default now()
);

create table if not exists fitness_knowledge (
  id bigserial primary key,
  content text not null,
  category text,
  embedding vector(1536),
  created_at timestamptz default now()
);

alter table mood_logs
  add column if not exists energy integer default 3,
  add column if not exists stress integer default 3,
  add column if not exists notes text;

alter table meal_logs
  add column if not exists meal_type text,
  add column if not exists meal_name text,
  add column if not exists total_calories numeric default 0,
  add column if not exists total_protein numeric default 0,
  add column if not exists total_carbs numeric default 0,
  add column if not exists total_fat numeric default 0,
  add column if not exists protein numeric default 0,
  add column if not exists carbs numeric default 0,
  add column if not exists fat numeric default 0,
  add column if not exists is_completed boolean default false,
  add column if not exists source text,
  add column if not exists items jsonb default '[]'::jsonb;

alter table fitness_knowledge
  add column if not exists category text;

create unique index if not exists meal_logs_user_date_type_idx
  on meal_logs(user_id, date, meal_type)
  where meal_type is not null;

create index if not exists body_metrics_user_date_idx on body_metrics(user_id, date desc);
create index if not exists workout_logs_user_date_idx on workout_logs(user_id, date desc);
create index if not exists exercise_logs_workout_idx on exercise_logs(workout_log_id);
create index if not exists meal_items_log_idx on meal_items(meal_log_id);
create index if not exists sleep_logs_user_date_idx on sleep_logs(user_id, date desc);
create index if not exists progress_logs_user_type_idx on progress_logs(user_id, log_type);
create index if not exists chat_messages_session_created_idx on chat_messages(session_id, created_at);
create index if not exists fitness_knowledge_embedding_idx
  on fitness_knowledge using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

insert into storage.buckets (id, name, public)
values ('progress-photos', 'progress-photos', true)
on conflict (id) do nothing;

drop function if exists match_fitness_knowledge(vector(1536), int);
drop function if exists match_fitness_knowledge(vector(1536), double precision, int);

create or replace function match_fitness_knowledge(
  query_embedding vector(1536),
  match_threshold double precision default 0.4,
  match_count int default 5
)
returns table (id bigint, content text, category text, similarity double precision)
language sql stable as $$
  select
    fitness_knowledge.id,
    fitness_knowledge.content,
    fitness_knowledge.category,
    1 - (fitness_knowledge.embedding <=> query_embedding) as similarity
  from fitness_knowledge
  where fitness_knowledge.embedding is not null
    and 1 - (fitness_knowledge.embedding <=> query_embedding) >= match_threshold
  order by fitness_knowledge.embedding <=> query_embedding
  limit match_count;
$$;

alter table profiles enable row level security;
alter table workout_plans enable row level security;
alter table body_metrics enable row level security;
alter table weight_logs enable row level security;
alter table workout_logs enable row level security;
alter table exercise_logs enable row level security;
alter table meal_logs enable row level security;
alter table meal_items enable row level security;
alter table sleep_logs enable row level security;
alter table body_measurements enable row level security;
alter table cardio_logs enable row level security;
alter table progress_logs enable row level security;
alter table vitals_logs enable row level security;
alter table supplements enable row level security;
alter table supplement_logs enable row level security;
alter table habits enable row level security;
alter table habit_logs enable row level security;
alter table injuries enable row level security;
alter table user_achievements enable row level security;
alter table chat_sessions enable row level security;
alter table chat_messages enable row level security;
alter table mood_logs enable row level security;
alter table water_logs enable row level security;
alter table workout_execution enable row level security;
alter table meal_execution enable row level security;
alter table assistant_messages enable row level security;

drop policy if exists "Users can manage own profiles" on profiles;
create policy "Users can manage own profiles" on profiles
  for all using (auth.uid() = id or auth.uid() = user_id)
  with check (auth.uid() = id or auth.uid() = user_id);

drop policy if exists "Users can manage own workout_plans" on workout_plans;
create policy "Users can manage own workout_plans" on workout_plans
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage own body_metrics" on body_metrics;
create policy "Users can manage own body_metrics" on body_metrics
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage own weight_logs" on weight_logs;
create policy "Users can manage own weight_logs" on weight_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage own workout_logs" on workout_logs;
create policy "Users can manage own workout_logs" on workout_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage own exercise_logs" on exercise_logs;
create policy "Users can manage own exercise_logs" on exercise_logs
  for all using (
    exists (
      select 1 from workout_logs
      where workout_logs.id = exercise_logs.workout_log_id
        and workout_logs.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from workout_logs
      where workout_logs.id = exercise_logs.workout_log_id
        and workout_logs.user_id = auth.uid()
    )
  );

drop policy if exists "Users can manage own meal_logs" on meal_logs;
create policy "Users can manage own meal_logs" on meal_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage own meal_items" on meal_items;
create policy "Users can manage own meal_items" on meal_items
  for all using (
    exists (
      select 1 from meal_logs
      where meal_logs.id = meal_items.meal_log_id
        and meal_logs.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from meal_logs
      where meal_logs.id = meal_items.meal_log_id
        and meal_logs.user_id = auth.uid()
    )
  );

drop policy if exists "Users can manage own sleep_logs" on sleep_logs;
create policy "Users can manage own sleep_logs" on sleep_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage own body_measurements" on body_measurements;
create policy "Users can manage own body_measurements" on body_measurements
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage own cardio_logs" on cardio_logs;
create policy "Users can manage own cardio_logs" on cardio_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage own progress_logs" on progress_logs;
create policy "Users can manage own progress_logs" on progress_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage own vitals_logs" on vitals_logs;
create policy "Users can manage own vitals_logs" on vitals_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage own supplements" on supplements;
create policy "Users can manage own supplements" on supplements
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage own supplement_logs" on supplement_logs;
create policy "Users can manage own supplement_logs" on supplement_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage own habits" on habits;
create policy "Users can manage own habits" on habits
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage own habit_logs" on habit_logs;
create policy "Users can manage own habit_logs" on habit_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage own injuries" on injuries;
create policy "Users can manage own injuries" on injuries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage own user_achievements" on user_achievements;
create policy "Users can manage own user_achievements" on user_achievements
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage own chat_sessions" on chat_sessions;
create policy "Users can manage own chat_sessions" on chat_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage own chat_messages" on chat_messages;
create policy "Users can manage own chat_messages" on chat_messages
  for all using (
    exists (
      select 1 from chat_sessions
      where chat_sessions.id = chat_messages.session_id
        and chat_sessions.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from chat_sessions
      where chat_sessions.id = chat_messages.session_id
        and chat_sessions.user_id = auth.uid()
    )
  );

drop policy if exists "Users can manage own mood_logs" on mood_logs;
create policy "Users can manage own mood_logs" on mood_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage own water_logs" on water_logs;
create policy "Users can manage own water_logs" on water_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage own workout_execution" on workout_execution;
create policy "Users can manage own workout_execution" on workout_execution
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage own meal_execution" on meal_execution;
create policy "Users can manage own meal_execution" on meal_execution
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage own assistant_messages" on assistant_messages;
create policy "Users can manage own assistant_messages" on assistant_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can manage own progress photos" on storage.objects;
create policy "Users can manage own progress photos" on storage.objects
  for all using (
    bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Public can read progress photos" on storage.objects;
create policy "Public can read progress photos" on storage.objects
  for select using (bucket_id = 'progress-photos');
