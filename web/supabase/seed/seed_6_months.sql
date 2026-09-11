-- ============================================================================
-- FitFusion AI - 6 months of demo history
-- ============================================================================
-- Generates ~183 days of realistic, self-consistent training / nutrition /
-- recovery data for ONE user, ending today.
--
-- Safe to re-run: the CLEANUP block removes only rows for this user inside the
-- seeded date window before inserting fresh ones.
--
-- Run it in the Supabase SQL editor (it runs as the service role, so RLS does
-- not block the inserts).
--
-- Every column used here was checked against supabase/migrations/. Note that
-- sleep_logs.duration_hours is deliberately NOT written - the live table only
-- has sleep_hours.
-- ============================================================================

begin;

select setseed(0.42);   -- deterministic "random": same data every run

-- -- config -------------------------------------------------------------------
-- By default this picks your OLDEST auth user. If you have more than one
-- account, replace the subquery with your literal uuid, e.g.
--   '00000000-1111-2222-3333-444444444444'::uuid as user_id,
create temporary table _cfg on commit drop as
select
  (select id from auth.users order by created_at limit 1)::uuid as user_id,
  (current_date - 182)::date                                    as start_date,
  current_date                                                  as end_date;

-- one row per day, with a day index and day-of-week (0 = Sunday)
create temporary table _days on commit drop as
select
  g::date                                        as d,
  (g::date - (select start_date from _cfg))::int as idx,
  extract(dow from g)::int                       as dow,
  ((g::date - (select start_date from _cfg))::numeric / 182.0) as t  -- 0.0 -> 1.0
from generate_series(
  (select start_date from _cfg),
  (select end_date   from _cfg),
  interval '1 day'
) g;

-- training split, keyed by day of week
create temporary table _split on commit drop as
select * from (values
  -- dow, exercise,                sets, reps, base_kg, minutes, base_kcal
  (1, 'Bench Press',                  4,  8,  60.0, 14, 110),
  (1, 'Overhead Press',               3, 10,  35.0, 11,  85),
  (1, 'Tricep Pushdown',              3, 12,  25.0,  9,  60),
  (2, 'Deadlift',                     4,  5, 100.0, 16, 150),
  (2, 'Barbell Row',                  4, 10,  55.0, 13, 105),
  (2, 'Bicep Curl',                   3, 12,  16.0,  9,  55),
  (4, 'Back Squat',                   4,  8,  85.0, 16, 145),
  (4, 'Romanian Deadlift',            3, 10,  70.0, 12, 110),
  (4, 'Leg Press',                    3, 12, 120.0, 12, 100),
  (4, 'Walking Lunge',                3, 20,  20.0, 10,  90),
  (5, 'Incline Dumbbell Press',       4, 10,  24.0, 13, 100),
  (5, 'Pull-Up',                      4,  8,   0.0, 11,  95),
  (5, 'Lateral Raise',                3, 15,  10.0,  8,  50),
  (5, 'Face Pull',                    3, 15,  20.0,  8,  45),
  (6, 'Kettlebell Swing',             4, 20,  24.0, 12, 130),
  (6, 'Plank',                        3,  1,   0.0,  6,  40),
  (6, 'Burpee',                       3, 15,   0.0, 10, 120)
) as s(dow, exercise_name, sets, reps, base_kg, minutes, base_kcal);

-- days actually trained: Mon/Tue/Thu/Fri/Sat, minus ~12% missed sessions
create temporary table _train_days on commit drop as
select d.d, d.idx, d.dow, d.t
from _days d
where d.dow in (1, 2, 4, 5, 6)
  and (d.idx * 7919) % 100 >= 12;   -- deterministic ~88% adherence

-- -- CLEANUP (makes the script re-runnable) -----------------------------------
delete from exercise_logs where workout_log_id in (
  select id from workout_logs
  where user_id = (select user_id from _cfg)
    and date between (select start_date from _cfg) and (select end_date from _cfg));

delete from meal_items where meal_log_id in (
  select id from meal_logs
  where user_id = (select user_id from _cfg)
    and date between (select start_date from _cfg) and (select end_date from _cfg));

delete from workout_logs      w using _cfg c where w.user_id = c.user_id and w.date between c.start_date and c.end_date;
delete from workout_execution x using _cfg c where x.user_id = c.user_id and x.date between c.start_date and c.end_date;
delete from meal_logs         m using _cfg c where m.user_id = c.user_id and m.date between c.start_date and c.end_date;
delete from meal_execution    m using _cfg c where m.user_id = c.user_id and m.date between c.start_date and c.end_date;
delete from weight_logs       l using _cfg c where l.user_id = c.user_id and l.date between c.start_date and c.end_date;
delete from sleep_logs        l using _cfg c where l.user_id = c.user_id and l.date between c.start_date and c.end_date;
delete from water_logs        l using _cfg c where l.user_id = c.user_id and l.date between c.start_date and c.end_date;
delete from vitals_logs       l using _cfg c where l.user_id = c.user_id and l.date between c.start_date and c.end_date;
delete from mood_logs         l using _cfg c where l.user_id = c.user_id and l.date between c.start_date and c.end_date;
delete from cardio_logs       l using _cfg c where l.user_id = c.user_id and l.date between c.start_date and c.end_date;
delete from body_measurements l using _cfg c where l.user_id = c.user_id and l.date between c.start_date and c.end_date;

-- -- 1. weight: 78.5 kg -> 72.0 kg, weighed every other day --------------------
insert into weight_logs (user_id, date, weight)
select c.user_id, d.d,
       round((78.5 - d.t * 6.5 + (random() - 0.5) * 0.7)::numeric, 1)
from _days d cross join _cfg c
where d.idx % 2 = 0;

-- -- 2. sleep: drifts from ~6.6 h to ~7.6 h, logged ~92% of nights -------------
insert into sleep_logs (user_id, date, sleep_hours, quality)
select c.user_id, d.d, h.v,
       case when h.v >= 7.5 then 'good'
            when h.v >= 6.5 then 'fair'
            else 'poor' end
from _days d
cross join _cfg c
cross join lateral (
  select round((6.6 + d.t * 1.0 + (random() - 0.5) * 1.6)::numeric, 1) as v
) h
where (d.idx * 5387) % 100 >= 8;

-- -- 3. water: 1.9 L -> 2.9 L --------------------------------------------------
insert into water_logs (user_id, date, amount_ml)
select c.user_id, d.d,
       round((1900 + d.t * 1000 + (random() - 0.5) * 700)::numeric)::int
from _days d cross join _cfg c
where (d.idx * 3301) % 100 >= 10;

-- -- 4. vitals: resting HR 73 -> 61 bpm, logged weekly ------------------------
insert into vitals_logs (user_id, date, systolic, diastolic, resting_heart_rate, oxygen_saturation)
select c.user_id, d.d,
       round((122 - d.t * 6  + (random() - 0.5) * 5)::numeric),
       round(( 80 - d.t * 4  + (random() - 0.5) * 4)::numeric),
       round(( 73 - d.t * 12 + (random() - 0.5) * 4)::numeric),
       round(( 96 + random() * 3)::numeric)
from _days d cross join _cfg c
where d.dow = 0;

-- -- 5. mood: 1-5, mildly better over time -------------------------------------
insert into mood_logs (user_id, date, mood)
select c.user_id, d.d,
       greatest(1, least(5, round((3.2 + d.t * 0.8 + (random() - 0.5) * 1.6)::numeric)::int))
from _days d cross join _cfg c
where (d.idx * 6151) % 100 >= 15;

-- -- 6. workouts + the exercises inside them -----------------------------------
with logs as (
  insert into workout_logs (user_id, date, is_assigned, total_calories)
  select c.user_id, t.d, true, 0
  from _train_days t cross join _cfg c
  returning id, date
)
insert into exercise_logs (workout_log_id, exercise_name, sets, reps, weight, duration, calories)
select
  l.id,
  s.exercise_name,
  s.sets,
  s.reps,
  -- load climbs ~22% across the six months, with +/-3% session noise
  case when s.base_kg = 0 then 0
       else round((s.base_kg * (1 + t.t * 0.22) * (1 + (random() - 0.5) * 0.06))::numeric, 1)
  end,
  round((s.minutes   * (1 + (random() - 0.5) * 0.20))::numeric),
  round((s.base_kcal * (1 + (random() - 0.5) * 0.18))::numeric)
from logs l
join _train_days t on t.d = l.date
join _split      s on s.dow = t.dow;

-- keep the header total honest
update workout_logs w
set total_calories = coalesce(
  (select sum(e.calories) from exercise_logs e where e.workout_log_id = w.id), 0)
where w.user_id = (select user_id from _cfg)
  and w.date between (select start_date from _cfg) and (select end_date from _cfg);

-- -- 7. per-exercise completion signal (~88% of assigned work finished) --------
insert into workout_execution (user_id, date, exercise_name, done)
select w.user_id, w.date, e.exercise_name,
       (('x' || md5(w.date::text || e.exercise_name))::bit(24)::int % 100) >= 12
from workout_logs w
join exercise_logs e on e.workout_log_id = w.id
where w.user_id = (select user_id from _cfg)
  and w.date between (select start_date from _cfg) and (select end_date from _cfg)
on conflict (user_id, date, exercise_name) do nothing;

-- -- 8. cardio on the two non-lifting days ------------------------------------
insert into cardio_logs (user_id, date, activity, duration_minutes, distance_km, calories_burned, avg_heart_rate)
select c.user_id, d.d,
       case when d.dow = 3 then 'Running' else 'Cycling' end,
       round((28 + d.t * 14 + (random() - 0.5) * 8)::numeric),
       round((4.5 + d.t * 2.5 + (random() - 0.5) * 1.2)::numeric, 2),
       round((280 + d.t * 90 + (random() - 0.5) * 70)::numeric),
       round((152 - d.t * 8 + (random() - 0.5) * 10)::numeric)
from _days d cross join _cfg c
where d.dow in (3, 0) and (d.idx * 4409) % 100 >= 20;

-- -- 9. meals: 3 a day, plus a snack on ~40% of days ---------------------------
with planned as (
  select c.user_id, d.d, d.idx, m.meal_type, m.meal_name, m.kcal, m.p, m.cb, m.f
  from _days d
  cross join _cfg c
  cross join (values
    ('breakfast', 'Oats, whey and banana',        460, 32, 62, 10),
    ('lunch',     'Grilled chicken, rice, salad', 680, 52, 70, 18),
    ('dinner',    'Paneer curry with roti',       620, 34, 58, 26),
    ('snack',     'Greek yoghurt and almonds',    280, 20, 16, 14)
  ) as m(meal_type, meal_name, kcal, p, cb, f)
  where m.meal_type <> 'snack'
     or (d.idx * 2711) % 100 < 40
),
ins as (
  insert into meal_logs (user_id, date, meal_type, meal_name,
                         total_calories, total_protein, total_carbs, total_fat,
                         protein, carbs, fat, is_completed, source)
  select
    p.user_id, p.d, p.meal_type, p.meal_name,
    k.kcal, k.prot, k.carb, k.fat,
    k.prot, k.carb, k.fat,
    (p.idx * 31 + length(p.meal_type)) % 100 >= 12,   -- ~88% actually eaten
    'seed'
  from planned p
  cross join lateral (
    select round((p.kcal * (1 + (random() - 0.5) * 0.16))::numeric) as kcal,
           round((p.p    * (1 + (random() - 0.5) * 0.16))::numeric) as prot,
           round((p.cb   * (1 + (random() - 0.5) * 0.20))::numeric) as carb,
           round((p.f    * (1 + (random() - 0.5) * 0.24))::numeric) as fat
  ) k
  returning id, meal_type, total_calories, total_protein, total_carbs, total_fat
)
insert into meal_items (meal_log_id, food_name, quantity, calories, protein, carbs, fat)
select i.id, f.food_name, f.quantity,
       round(i.total_calories * f.share),
       round(i.total_protein  * f.share),
       round(i.total_carbs    * f.share),
       round(i.total_fat      * f.share)
from ins i
join (values
  ('breakfast', 'Rolled oats',      '80 g',    0.55),
  ('breakfast', 'Whey protein',     '1 scoop', 0.45),
  ('lunch',     'Chicken breast',   '200 g',   0.50),
  ('lunch',     'Basmati rice',     '150 g',   0.50),
  ('dinner',    'Paneer',           '150 g',   0.60),
  ('dinner',    'Whole wheat roti', '2 pcs',   0.40),
  ('snack',     'Greek yoghurt',    '200 g',   0.60),
  ('snack',     'Almonds',          '20 g',    0.40)
) as f(meal_type, food_name, quantity, share) on f.meal_type = i.meal_type;

-- -- 10. meal adherence signal -------------------------------------------------
insert into meal_execution (user_id, date, meal_name, eaten)
select m.user_id, m.date, m.meal_name, m.is_completed
from meal_logs m
where m.user_id = (select user_id from _cfg)
  and m.date between (select start_date from _cfg) and (select end_date from _cfg)
on conflict (user_id, date, meal_name) do nothing;

-- -- 11. body measurements, taken monthly --------------------------------------
insert into body_measurements (user_id, date, waist_cm, chest_cm, hips_cm,
                               left_arm_cm, right_arm_cm, left_thigh_cm,
                               right_thigh_cm, neck_cm)
select c.user_id, d.d,
       round((92.0 - d.t * 9.0)::numeric, 1),
       round((99.0 + d.t * 3.5)::numeric, 1),
       round((98.0 - d.t * 5.0)::numeric, 1),
       round((33.0 + d.t * 2.2)::numeric, 1),
       round((33.3 + d.t * 2.2)::numeric, 1),
       round((56.0 + d.t * 2.0)::numeric, 1),
       round((56.2 + d.t * 2.0)::numeric, 1),
       round((38.5 - d.t * 1.0)::numeric, 1)
from _days d cross join _cfg c
where d.idx % 30 = 0;

commit;

-- -- what landed ---------------------------------------------------------------
select 'workout_logs' as table_name, count(*) from workout_logs where date >= current_date - 182
union all select 'exercise_logs',     count(*) from exercise_logs
union all select 'workout_execution', count(*) from workout_execution where date >= current_date - 182
union all select 'meal_logs',         count(*) from meal_logs         where date >= current_date - 182
union all select 'meal_items',        count(*) from meal_items
union all select 'weight_logs',       count(*) from weight_logs       where date >= current_date - 182
union all select 'sleep_logs',        count(*) from sleep_logs        where date >= current_date - 182
union all select 'water_logs',        count(*) from water_logs        where date >= current_date - 182
union all select 'vitals_logs',       count(*) from vitals_logs       where date >= current_date - 182
union all select 'mood_logs',         count(*) from mood_logs         where date >= current_date - 182
union all select 'cardio_logs',       count(*) from cardio_logs       where date >= current_date - 182
union all select 'body_measurements', count(*) from body_measurements where date >= current_date - 182;
