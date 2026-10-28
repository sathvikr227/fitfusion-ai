-- FitFusion AI — server-side range checks for user-entered health data
-- Run this in the Supabase SQL Editor.
--
-- The forms validate the same ranges (web/src/lib/validation.ts); these
-- constraints stop impossible values arriving any other way (an old client,
-- a direct API call). Keep the two in sync.
--
-- NOT VALID: existing rows are not checked, so rows saved before validation
-- (e.g. a -1900/-15 blood pressure from QA) don't block the migration. New
-- inserts and updates are checked. Delete bad rows from the app, then run
-- `alter table ... validate constraint ...` if you want them enforced fully.
--
-- Safe to run more than once.

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_age_range') then
    alter table profiles add constraint profiles_age_range
      check (age is null or age between 13 and 100) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_height_range') then
    alter table profiles add constraint profiles_height_range
      check (height is null or height between 100 and 250) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_weight_range') then
    alter table profiles add constraint profiles_weight_range
      check (weight is null or weight between 25 and 300) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'weight_logs_weight_range') then
    alter table weight_logs add constraint weight_logs_weight_range
      check (weight is null or weight between 25 and 300) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'sleep_logs_hours_range') then
    alter table sleep_logs add constraint sleep_logs_hours_range
      check (sleep_hours is null or sleep_hours between 0 and 24) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'vitals_logs_ranges') then
    alter table vitals_logs add constraint vitals_logs_ranges check (
      (systolic is null or systolic between 70 and 250)
      and (diastolic is null or diastolic between 40 and 150)
      and (systolic is null or diastolic is null or systolic > diastolic)
      and (heart_rate is null or heart_rate between 30 and 220)
      and (blood_sugar is null or blood_sugar between 20 and 600)
      and (spo2 is null or spo2 between 70 and 100)
    ) not valid;
  end if;
end $$;
