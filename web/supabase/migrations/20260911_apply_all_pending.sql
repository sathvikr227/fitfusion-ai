-- FitFusion AI — consolidated pending migration
-- Run this ONCE in the Supabase SQL Editor. Safe to run again.
--
-- Everything here is additive: no table is dropped, no column changes type,
-- and no existing data is touched. It brings the live database in line with
-- what the application code expects.

-- ── 1. ML intelligence layer audit columns ───────────────────────────────────
-- Stores the injury-risk scores that drove a replan and the full decision
-- record behind it (trajectory class, RL action, removed exercises, rest day).
-- /api/adaptive-replan works with or without these: without them it retries the
-- insert and keeps the same payload inside plan.ml_meta.

alter table workout_plans
  add column if not exists injury_risk jsonb,
  add column if not exists ml_meta     jsonb;

comment on column workout_plans.injury_risk is
  'Per-muscle-group proxy injury-risk scores (0-1) from the multi-label XGBoost '
  'classifier at the time this plan was generated. Proxy risk from biomechanical '
  'thresholds, NOT a clinical diagnosis.';

comment on column workout_plans.ml_meta is
  'Full ML decision record: completion rate, sleep average, streak, trajectory '
  'class, RL action and state, and the injury adjustments applied to the plan.';

create index if not exists workout_plans_user_created_idx
  on workout_plans(user_id, created_at desc);

-- ── 2. pose_sessions ─────────────────────────────────────────────────────────
-- The pose tracker writes here when a user opts to save a session. The table
-- was never created, so /api/pose-coach silently skips persistence today (the
-- insert is already wrapped in a try/catch, so nothing errors for the user).

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

drop policy if exists "Users can manage own pose_sessions" on pose_sessions;
create policy "Users can manage own pose_sessions" on pose_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists pose_sessions_user_created_idx
  on pose_sessions(user_id, created_at desc);

-- ── 3. Refresh the API schema cache ──────────────────────────────────────────
-- Without this, PostgREST keeps serving the old column list for a few minutes.
notify pgrst, 'reload schema';
