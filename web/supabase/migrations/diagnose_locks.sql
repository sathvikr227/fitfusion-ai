-- FitFusion AI — connection / lock diagnostics
--
-- Run these in the Supabase SQL Editor when a migration reports
-- "Connection terminated due to connection timeout" or
-- "canceling statement due to lock timeout".
--
-- Run them ONE BLOCK AT A TIME, top to bottom. The first block that fails or
-- hangs tells you where the problem is.


-- ── STEP 1. Is the database reachable at all? ────────────────────────────────
-- If this times out, the problem is NOT your SQL. The instance is unresponsive
-- or paused. Check https://status.supabase.com and your project dashboard for
-- a "Project paused" banner. Nothing below will work until this returns 1.

select 1 as reachable;


-- ── STEP 2. How long has this connection been alive, and who am I? ───────────

select
  current_user,
  current_database(),
  version()               as postgres_version,
  now() - pg_postmaster_start_time() as server_uptime;


-- ── STEP 3. Sessions stuck idle inside a transaction ─────────────────────────
-- This is the usual culprit. A session left "idle in transaction" holds its
-- locks indefinitely, so any ALTER TABLE on the same table waits forever.
-- The dashboard's Table Editor can do this if left open on a table.

select
  pid,
  state,
  now() - state_change  as idle_for,
  now() - xact_start    as in_transaction_for,
  left(query, 120)      as last_query
from pg_stat_activity
where state in ('idle in transaction', 'idle in transaction (aborted)')
  and pid <> pg_backend_pid()
order by xact_start;


-- ── STEP 4. Who is actually blocking whom? ───────────────────────────────────
-- Any row here is a real lock conflict. "blocked_by" is the session to deal
-- with; "blocking_query" usually makes the cause obvious.

select
  blocked.pid                           as blocked_pid,
  left(blocked.query, 80)               as blocked_query,
  blocking.pid                          as blocked_by,
  blocking.state                        as blocker_state,
  now() - blocking.state_change         as blocker_idle_for,
  left(blocking.query, 80)              as blocking_query
from pg_stat_activity blocked
join lateral unnest(pg_blocking_pids(blocked.pid)) as blocker_pid on true
join pg_stat_activity blocking on blocking.pid = blocker_pid
where cardinality(pg_blocking_pids(blocked.pid)) > 0;


-- ── STEP 5. Anything currently holding a lock on our two tables ──────────────

select
  a.pid,
  a.state,
  now() - a.state_change as state_age,
  c.relname              as table_name,
  l.mode                 as lock_mode,
  l.granted,
  left(a.query, 100)     as query
from pg_locks l
join pg_class c          on c.oid = l.relation
join pg_stat_activity a  on a.pid = l.pid
where c.relname in ('workout_plans', 'pose_sessions')
  and a.pid <> pg_backend_pid()
order by l.granted, a.state_change;


-- ── STEP 6. Terminate a stuck session (ONLY if steps 3-5 found one) ──────────
-- Replace 12345 with the pid you want to stop. pg_cancel_backend is the polite
-- option: it cancels the running statement. pg_terminate_backend drops the whole
-- connection and is the one that clears an "idle in transaction" holder.
--
-- Safe to run: it affects one connection, not your data. Any uncommitted work
-- in that session rolls back, which is exactly what you want from a stuck one.

-- select pg_cancel_backend(12345);
-- select pg_terminate_backend(12345);


-- ── STEP 7. Confirm the migration actually applied ───────────────────────────
-- Run this AFTER 20260911_apply_all_pending.sql succeeds.
-- Expect: two rows for the columns, one row for the table, two index rows.

select 'column' as kind, column_name as name
from information_schema.columns
where table_name = 'workout_plans'
  and column_name in ('injury_risk', 'ml_meta')

union all
select 'table', table_name
from information_schema.tables
where table_name = 'pose_sessions'

union all
select 'index', indexname
from pg_indexes
where indexname in ('workout_plans_user_created_idx', 'pose_sessions_user_created_idx')

order by kind, name;
