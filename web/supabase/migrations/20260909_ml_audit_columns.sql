-- FitFusion AI — ML intelligence layer audit columns
-- Run this in the Supabase SQL Editor.
--
-- Adds traceability for the adaptive-replan pipeline: the injury-risk scores
-- that drove a replan and the full decision record behind it (trajectory class,
-- RL action, removed exercises, rest day inserted).
--
-- Safe to run more than once. /api/adaptive-replan works with or without these
-- columns: without them the same payload is still written inside plan.ml_meta,
-- and the route logs that the audit columns are missing.

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

-- Lets the analytics dashboard pull a user's recent ML decisions cheaply.
create index if not exists workout_plans_user_created_idx
  on workout_plans(user_id, created_at desc);

-- Force PostgREST to refresh its schema cache so the REST API sees the columns.
notify pgrst, 'reload schema';
