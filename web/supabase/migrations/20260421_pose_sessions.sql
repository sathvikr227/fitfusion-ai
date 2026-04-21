-- FitFusion AI: Pose tracking sessions
-- Run this in Supabase SQL Editor

create table if not exists pose_sessions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  exercise_id        text not null,
  exercise_name      text not null,
  total_reps         integer not null default 0,
  rejected_reps      integer not null default 0,
  avg_rom_pct        integer not null default 0,
  avg_tempo_sec      numeric(6,2) not null default 0,
  hold_seconds       integer,
  form_error_counts  jsonb not null default '{}'::jsonb,
  ai_feedback        text,
  created_at         timestamptz default now()
);

alter table pose_sessions enable row level security;

create policy "Users can manage own pose_sessions" on pose_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists pose_sessions_user_created_idx
  on pose_sessions(user_id, created_at desc);
