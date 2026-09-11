"""Seed six months of realistic training history for one FitFusion user.

THIS WRITES SIMULATED DATA. Every row it creates is generated, not observed.
It exists so the ML layer has enough history to demonstrate: the Transformer
needs four ordered sessions, the RL agent needs a completion trend, and the
injury classifier needs sleep and volume signals.

The story it generates, over 26 weeks:

    weeks  1-6    strong start, completion 85-95%, weight falling
    weeks  7-10   peak consistency
    weeks 11-14   slump - completion collapses, sleep debt builds
    week  14      hamstring strain, volume cut
    weeks 15-18   cautious recovery
    weeks 19-26   comeback, completion climbs back above 90%

That arc is deliberate: it makes the Transformer produce REGRESS, PLATEAU and
IMPROVE at different points, and gives the RL agent a reason to choose REDUCE
and later INCREASE.

Existing rows are never overwritten. Every table with a uniqueness constraint
is inserted with `resolution=ignore-duplicates`, and dates that already hold a
workout are skipped.

Writes an undo file so the seed can be removed precisely:
    ml-service/data/seed_undo_<user>.sql

    .venv/Scripts/python.exe -m training.seed_demo_history --user <uuid>
    .venv/Scripts/python.exe -m training.seed_demo_history --user <uuid> --apply
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import random
import urllib.error
import urllib.request

from training.common import DATA_DIR, ML_SERVICE_ROOT, banner

SEED = 20260911
WEEKS = 26

# ── Narrative ────────────────────────────────────────────────────────────────
# (week_start, week_end, completion_mean, sleep_mean, sessions_per_week, label)
PHASES = [
    (1, 6, 0.90, 7.3, 5, "strong start"),
    (7, 10, 0.93, 7.5, 5, "peak consistency"),
    (11, 13, 0.62, 6.1, 4, "slump begins"),
    (14, 14, 0.38, 5.6, 2, "hamstring strain"),
    (15, 18, 0.58, 6.6, 3, "cautious recovery"),
    (19, 22, 0.78, 7.2, 4, "rebuilding"),
    (23, 26, 0.92, 7.6, 5, "comeback"),
]

INJURY_WEEK = 14

# Exercise pools by session type, with per-set minutes and a MET-ish rate.
SESSIONS = {
    "Push": [("Bench Press", 4, 8, 45), ("Shoulder Press", 3, 10, 25),
             ("Incline Dumbbell Press", 3, 10, 22), ("Tricep Extension", 3, 12, 15)],
    "Pull": [("Lat Pulldown", 4, 10, 30), ("Barbell Row", 4, 8, 40),
             ("Seated Row", 3, 12, 25), ("Bicep Curl", 3, 12, 15)],
    "Legs": [("Squats", 4, 8, 60), ("Leg Press", 3, 12, 40),
             ("Romanian Deadlift", 3, 10, 45), ("Calf Raise", 3, 15, 12)],
    "Cardio": [("Treadmill Run", 1, 30, 0), ("Cycling", 1, 20, 0),
               ("Rowing Machine", 1, 15, 0)],
    "Core": [("Plank", 3, 60, 10), ("Crunches", 3, 20, 10),
             ("Leg Raises", 3, 15, 12), ("Mountain Climbers", 3, 30, 15)],
}
# Sessions that load the hamstring — dropped while injured.
HAMSTRING_HEAVY = {"Romanian Deadlift", "Squats", "Treadmill Run"}

ROTATION = ["Push", "Pull", "Legs", "Cardio", "Core"]

MEALS = [
    ("breakfast", 420, 28, 45, 12),
    ("lunch", 650, 45, 60, 20),
    ("dinner", 580, 42, 48, 18),
    ("snacks", 220, 15, 22, 8),
]


def load_env() -> tuple[str, str]:
    env_path = ML_SERVICE_ROOT.parent / "web" / ".env.local"
    env = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/"), env["SUPABASE_SERVICE_ROLE_KEY"]


class Supa:
    def __init__(self, url: str, key: str):
        self.url, self.key = url, key

    def _headers(self, extra: dict | None = None) -> dict:
        h = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
        }
        h.update(extra or {})
        return h

    def get(self, path: str):
        req = urllib.request.Request(f"{self.url}/rest/v1/{path}", headers=self._headers())
        return json.loads(urllib.request.urlopen(req, timeout=45).read().decode())

    def insert(self, table: str, rows: list[dict], ignore_dupes: bool = True) -> int:
        """Insert in batches. Callers pre-filter duplicates (see skip_existing).

        PostgREST's `resolution=ignore-duplicates` only takes effect on an
        upsert with an explicit on_conflict target, so it silently does nothing
        here and the batch 409s on the first collision. Filtering in Python is
        both simpler and independent of which unique index a table happens to
        have.
        """
        if not rows:
            return 0
        prefer = "return=representation"
        sent = 0
        for i in range(0, len(rows), 200):
            chunk = rows[i : i + 200]
            req = urllib.request.Request(
                f"{self.url}/rest/v1/{table}",
                data=json.dumps(chunk).encode(),
                headers=self._headers({"Prefer": prefer}),
                method="POST",
            )
            try:
                body = json.loads(urllib.request.urlopen(req, timeout=90).read().decode())
                sent += len(body) if isinstance(body, list) else len(chunk)
            except urllib.error.HTTPError as e:
                raise RuntimeError(f"{table} insert failed: {e.read().decode()[:300]}") from e
        return sent

    def skip_existing(self, table: str, rows: list[dict], keys: tuple[str, ...],
                      user_id: str) -> list[dict]:
        """Drop rows whose unique key already exists for this user."""
        if not rows:
            return rows
        select = ",".join(keys)
        have = set()
        for chunk_start in range(0, 20000, 1000):
            page = self.get(
                f"{table}?select={select}&user_id=eq.{user_id}"
                f"&limit=1000&offset={chunk_start}"
            )
            if not page:
                break
            for r in page:
                have.add(tuple(str(r.get(k)) for k in keys))
            if len(page) < 1000:
                break
        return [r for r in rows if tuple(str(r.get(k)) for k in keys) not in have]

    def patch(self, table: str, filt: str, payload: dict) -> None:
        req = urllib.request.Request(
            f"{self.url}/rest/v1/{table}?{filt}",
            data=json.dumps(payload).encode(),
            headers=self._headers({"Prefer": "return=minimal"}),
            method="PATCH",
        )
        urllib.request.urlopen(req, timeout=45)


def phase_for(week: int):
    for lo, hi, comp, sleep, sessions, label in PHASES:
        if lo <= week <= hi:
            return comp, sleep, sessions, label
    return 0.8, 7.0, 4, "steady"


def build_top_up(user_id: str, profile: dict, rng: random.Random,
                 start_day: dt.date, until: dt.date, last_weight: float,
                 last_hr: int):
    """Continue an existing history forward, using the final phase's settings.

    The 26-week window lands on a week boundary, so it can stop a few days short
    of today. This fills that tail rather than regenerating everything.
    """
    comp_mean, sleep_mean, _sessions, label = PHASES[-1][2], PHASES[-1][3], PHASES[-1][4], PHASES[-1][5]
    out = {t: [] for t in (
        "workout_logs", "exercise_logs", "workout_execution", "sleep_logs",
        "weight_logs", "vitals_logs", "body_metrics", "meal_logs", "water_logs",
        "mood_logs",
    )}

    # Mon/Tue/Thu/Fri/Sat, matching the main generator's training rhythm
    TRAIN_WEEKDAYS = {0, 1, 3, 4, 5}
    done_total = attempted_total = 0
    day = start_day
    rotation_i = 0

    while day <= until:
        sleep_hours = round(max(4.0, min(9.5, rng.gauss(sleep_mean, 0.55))), 1)
        out["sleep_logs"].append({
            "user_id": user_id, "date": day.isoformat(), "sleep_hours": sleep_hours,
            "quality": "Good" if sleep_hours >= 7 else "Fair" if sleep_hours >= 6 else "Poor",
        })
        out["water_logs"].append({
            "user_id": user_id, "date": day.isoformat(),
            "amount_ml": int(rng.gauss(2400, 300)),
        })
        for meal_type, kcal, prot, carb, fat in MEALS:
            j = rng.uniform(0.85, 1.15)
            out["meal_logs"].append({
                "user_id": user_id, "date": day.isoformat(), "meal_type": meal_type,
                "total_calories": round(kcal * j), "total_protein": round(prot * j, 1),
                "total_carbs": round(carb * j, 1), "total_fat": round(fat * j, 1),
                "is_completed": True,
            })

        if day.weekday() == 0:  # Monday: weekly snapshots
            last_weight = round(last_weight - rng.uniform(0.15, 0.45), 1)
            last_hr = max(55, last_hr - rng.choice([0, 1, 1, 2]))
            out["weight_logs"].append({"user_id": user_id, "date": day.isoformat(),
                                       "weight": last_weight})
            out["vitals_logs"].append({
                "user_id": user_id, "date": day.isoformat(), "heart_rate": last_hr,
                "systolic": int(rng.gauss(119, 5)), "diastolic": int(rng.gauss(77, 4)),
                "spo2": int(rng.gauss(98, 1)),
            })
            out["mood_logs"].append({"user_id": user_id, "date": day.isoformat(),
                                     "mood": 4, "energy": 4, "stress": 2})

        if day.weekday() in TRAIN_WEEKDAYS:
            stype = ROTATION[rotation_i % len(ROTATION)]
            rotation_i += 1
            exercises = SESSIONS[stype]
            session_completion = max(0.05, min(1.0, rng.gauss(comp_mean, 0.08)))
            n_done = round(len(exercises) * session_completion)
            done_idx = set(rng.sample(range(len(exercises)), n_done)) if n_done else set()

            total_cal, log_rows = 0, []
            for i, (name, sets, reps, cal_per_set) in enumerate(exercises):
                done = i in done_idx
                attempted_total += 1
                done_total += int(done)
                out["workout_execution"].append({
                    "user_id": user_id, "date": day.isoformat(),
                    "exercise_name": name, "done": done,
                })
                if not done:
                    continue
                duration = sets * 3 if cal_per_set else reps
                calories = int(cal_per_set * sets) if cal_per_set else int(reps * 9)
                total_cal += calories
                log_rows.append({"exercise_name": name, "sets": sets, "reps": reps,
                                 "weight": None, "duration": duration,
                                 "calories": calories})
            if log_rows:
                out["workout_logs"].append({
                    "user_id": user_id, "date": day.isoformat(), "is_assigned": True,
                    "total_calories": total_cal, "_exercises": log_rows,
                })
        day += dt.timedelta(days=1)

    summary = [{
        "week": 0, "phase": f"top-up ({label})",
        "completion": round(done_total / attempted_total, 2) if attempted_total else 0.0,
        "weight": last_weight, "resting_hr": last_hr,
    }]
    return out, summary


def build(user_id: str, profile: dict, rng: random.Random):
    """Generate every row. Returns dict of table -> list[row], plus a summary."""
    today = dt.date.today()
    start = today - dt.timedelta(weeks=WEEKS)
    # start on a Monday so weeks line up
    start -= dt.timedelta(days=start.weekday())

    height_cm = float(profile.get("height") or 178)
    start_weight = float(profile.get("weight") or 86)
    # weight_loss goal: lose ~8kg across the 26 weeks, stalling during the slump
    end_weight = start_weight - 8.0

    out = {t: [] for t in (
        "workout_logs", "exercise_logs", "workout_execution", "sleep_logs",
        "weight_logs", "vitals_logs", "body_metrics", "meal_logs", "water_logs",
        "mood_logs",
    )}
    weekly = []

    for week in range(1, WEEKS + 1):
        comp_mean, sleep_mean, sessions_per_week, label = phase_for(week)
        week_start = start + dt.timedelta(weeks=week - 1)

        # weight: steady loss, stalls weeks 11-16, resumes after
        progress = (week - 1) / (WEEKS - 1)
        if 11 <= week <= 16:
            stall = (week - 10) * 0.012
            progress = (10 - 1) / (WEEKS - 1) + stall
        weight = round(start_weight - (start_weight - end_weight) * progress + rng.uniform(-0.3, 0.3), 1)

        # resting heart rate improves with fitness, worsens during the slump
        base_hr = 74 - 12 * progress
        if 11 <= week <= 16:
            base_hr += 5
        resting_hr = int(round(base_hr + rng.uniform(-2, 2)))

        # ── daily rows ────────────────────────────────────────────────────────
        for day_offset in range(7):
            day = week_start + dt.timedelta(days=day_offset)
            if day > today:
                continue

            sleep_hours = round(max(4.0, min(9.5, rng.gauss(sleep_mean, 0.55))), 1)
            out["sleep_logs"].append({
                "user_id": user_id, "date": day.isoformat(),
                "sleep_hours": sleep_hours,
                "quality": "Good" if sleep_hours >= 7 else "Fair" if sleep_hours >= 6 else "Poor",
            })
            out["water_logs"].append({
                "user_id": user_id, "date": day.isoformat(),
                "amount_ml": int(rng.gauss(2400 if comp_mean > 0.7 else 1800, 300)),
            })
            for meal_type, kcal, prot, carb, fat in MEALS:
                jitter = rng.uniform(0.85, 1.15)
                out["meal_logs"].append({
                    "user_id": user_id, "date": day.isoformat(), "meal_type": meal_type,
                    "total_calories": round(kcal * jitter),
                    "total_protein": round(prot * jitter, 1),
                    "total_carbs": round(carb * jitter, 1),
                    "total_fat": round(fat * jitter, 1),
                    "is_completed": True,
                })

        # weekly rows
        monday = week_start.isoformat()
        if week_start <= today:
            out["weight_logs"].append({"user_id": user_id, "date": monday, "weight": weight})
            out["vitals_logs"].append({
                "user_id": user_id, "date": monday,
                "heart_rate": resting_hr,
                "systolic": int(rng.gauss(120, 5)), "diastolic": int(rng.gauss(78, 4)),
                "spo2": int(rng.gauss(98, 1)),
            })
            out["mood_logs"].append({
                "user_id": user_id, "date": monday,
                "mood": 4 if comp_mean > 0.75 else 3 if comp_mean > 0.5 else 2,
                "energy": 4 if sleep_mean >= 7 else 2,
                "stress": 2 if comp_mean > 0.75 else 4,
            })

        # monthly body metrics
        if week % 4 == 1 and week_start <= today:
            bmi = round(weight / ((height_cm / 100) ** 2), 1)
            out["body_metrics"].append({
                "user_id": user_id, "date": monday, "weight": weight, "height": height_cm,
                "bmi": bmi,
                "estimated_body_fat_percent": round(1.2 * bmi + 0.23 * 22 - 16.2, 1),
                "target_bmi": 23.0, "target_body_fat_percent": 15.0,
                "status": "Overweight" if bmi >= 25 else "Fit",
                "goal": profile.get("goal") or "weight_loss",
            })

        # ── training sessions ─────────────────────────────────────────────────
        injured = week >= INJURY_WEEK and week <= INJURY_WEEK + 3
        day_slots = [0, 1, 3, 4, 5][:sessions_per_week]
        week_done = week_total = 0

        for idx, slot in enumerate(day_slots):
            day = week_start + dt.timedelta(days=slot)
            if day > today:
                continue

            stype = ROTATION[(week + idx) % len(ROTATION)]
            if injured and stype == "Legs":
                stype = "Core"  # avoid loading the hamstring while injured

            exercises = [e for e in SESSIONS[stype]
                         if not (injured and e[0] in HAMSTRING_HEAVY)]
            if not exercises:
                exercises = SESSIONS["Core"]

            session_completion = max(0.05, min(1.0, rng.gauss(comp_mean, 0.08)))
            # Pick how many of the session's exercises get ticked, rather than
            # flipping an independent coin per exercise. With only 3-4 exercises
            # a per-exercise draw swings a week from 40% to 100% on noise alone,
            # which buries the trend the models are meant to read.
            n_done = round(len(exercises) * session_completion)
            done_idx = set(rng.sample(range(len(exercises)), n_done)) if n_done else set()

            total_cal = 0
            log_rows = []
            for ex_i, (name, sets, reps, cal_per_set) in enumerate(exercises):
                done = ex_i in done_idx
                week_total += 1
                week_done += int(done)
                out["workout_execution"].append({
                    "user_id": user_id, "date": day.isoformat(),
                    "exercise_name": name, "done": done,
                })
                if not done:
                    continue
                duration = sets * 3 if cal_per_set else reps
                calories = int(cal_per_set * sets) if cal_per_set else int(reps * 9)
                total_cal += calories
                log_rows.append({
                    "exercise_name": name, "sets": sets, "reps": reps,
                    "weight": None, "duration": duration, "calories": calories,
                })

            if log_rows:
                out["workout_logs"].append({
                    "user_id": user_id, "date": day.isoformat(),
                    "is_assigned": True, "total_calories": total_cal,
                    "_exercises": log_rows,   # attached; split out before insert
                })

        weekly.append({
            "week": week, "phase": label,
            "completion": round(week_done / week_total, 2) if week_total else 0.0,
            "weight": weight, "resting_hr": resting_hr,
        })

    return out, weekly


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", required=True, help="profiles.id to seed")
    ap.add_argument("--apply", action="store_true", help="actually write (default is a dry run)")
    ap.add_argument("--top-up", metavar="YYYY-MM-DD", default=None,
                    help="instead of the full 26 weeks, extend existing history "
                         "forward to this date using the final phase's settings")
    args = ap.parse_args()

    banner(f"Seed 6 months of demo history for {args.user}")
    rng = random.Random(SEED)
    url, key = load_env()
    db = Supa(url, key)

    profiles = db.get(f"profiles?select=*&id=eq.{args.user}")
    if not profiles:
        raise SystemExit(f"No profile found with id {args.user}")
    profile = profiles[0]
    print(f"  profile: age {profile.get('age')}, {profile.get('height')}cm, "
          f"{profile.get('weight')}kg, goal {profile.get('goal')}\n")

    if args.top_up:
        until = dt.date.fromisoformat(args.top_up)
        # continue from the day after the newest sleep log, which is written daily
        latest = db.get(f"sleep_logs?select=date&user_id=eq.{args.user}"
                        f"&order=date.desc&limit=1")
        if not latest:
            raise SystemExit("No existing history to top up. Run without --top-up first.")
        start_day = dt.date.fromisoformat(latest[0]["date"]) + dt.timedelta(days=1)
        if start_day > until:
            print(f"  Already covered through {latest[0]['date']} — nothing to add.")
            return

        w = db.get(f"weight_logs?select=weight&user_id=eq.{args.user}"
                   f"&order=date.desc&limit=1")
        v = db.get(f"vitals_logs?select=heart_rate&user_id=eq.{args.user}"
                   f"&order=date.desc&limit=1")
        last_weight = float(w[0]["weight"]) if w else float(profile.get("weight") or 78)
        last_hr = int(v[0]["heart_rate"]) if v else 64

        print(f"  topping up {start_day} .. {until} "
              f"(continuing from {last_weight}kg, RHR {last_hr})")
        print()
        rows, weekly = build_top_up(args.user, profile, rng, start_day, until,
                                    last_weight, last_hr)
    else:
        rows, weekly = build(args.user, profile, rng)

    # Dates that already hold a workout — never double-log a day.
    existing = {r["date"] for r in db.get(
        f"workout_logs?select=date&user_id=eq.{args.user}&limit=5000")}
    kept = [r for r in rows["workout_logs"] if r["date"] not in existing]
    skipped = len(rows["workout_logs"]) - len(kept)
    rows["workout_logs"] = kept

    print("  week-by-week arc (bar = completion rate):")
    for w in weekly:
        bar = "#" * round(w["completion"] * 24)
        print(f"    w{w['week']:>2} {w['phase'][:17]:<17s} {w['completion']:>4.0%} "
              f"|{bar:<24s}| {w['weight']:>5.1f}kg  RHR {w['resting_hr']}")

    exercise_count = sum(len(r["_exercises"]) for r in rows["workout_logs"])
    print()
    print("  rows to write:")
    for table_name, rs in rows.items():
        n = exercise_count if table_name == "exercise_logs" else len(rs)
        print(f"    {table_name:20s} {n:5d}")
    if skipped:
        print(f"    (skipped {skipped} workout days that already have a log)")

    if not args.apply:
        print("\n  DRY RUN — nothing written. Re-run with --apply to commit.")
        return

    print("\n  writing...")
    # workout_logs first so exercise_logs can reference the returned ids
    workout_payload = [{k: v for k, v in r.items() if not k.startswith("_")}
                       for r in rows["workout_logs"]]
    # PostgREST rejects an empty array with 400, which is exactly what a re-run
    # produces once every generated date already has a log.
    if not workout_payload:
        print("    workout_logs             0  (all dates already logged)")
        created = []
    else:
        req = urllib.request.Request(
            f"{url}/rest/v1/workout_logs",
            data=json.dumps(workout_payload).encode(),
            headers={"apikey": key, "Authorization": f"Bearer {key}",
                     "Content-Type": "application/json",
                     "Prefer": "return=representation"},
            method="POST",
        )
        created = json.loads(urllib.request.urlopen(req, timeout=120).read().decode())
        print(f"    workout_logs         {len(created):5d}")

    by_date = {r["date"]: r["id"] for r in created}
    ex_rows = []
    for src in rows["workout_logs"]:
        log_id = by_date.get(src["date"])
        if not log_id:
            continue
        for e in src["_exercises"]:
            ex_rows.append({"workout_log_id": log_id, **e})
    print(f"    exercise_logs        {db.insert('exercise_logs', ex_rows, False):5d}")

    UNIQUE_KEYS = {
        "workout_execution": ("date", "exercise_name"),
        "sleep_logs": ("date",),
        "weight_logs": ("date",),
        "vitals_logs": ("date",),
        "water_logs": ("date",),
        "mood_logs": ("date",),
        "meal_logs": ("date", "meal_type"),
        "body_metrics": ("date",),
    }
    for table in ("workout_execution", "sleep_logs", "weight_logs", "vitals_logs",
                  "body_metrics", "meal_logs", "water_logs", "mood_logs"):
        pending = db.skip_existing(table, rows[table], UNIQUE_KEYS[table], args.user)
        skipped_here = len(rows[table]) - len(pending)
        n = db.insert(table, pending)
        note = f"  ({skipped_here} already present)" if skipped_here else ""
        print(f"    {table:20s} {n:5d}{note}")

    # keep the profile's weight consistent with the newest weight log
    # profiles.weight is an INTEGER column on the live table (the migration file
    # declares numeric), so a float here fails with 22P02.
    final_weight = round(weekly[-1]["weight"])
    db.patch("profiles", f"id=eq.{args.user}", {"weight": final_weight})
    print(f"    profiles.weight   -> {final_weight} kg (matches latest weight log)")

    # ── undo file ────────────────────────────────────────────────────────────
    first = min(r["date"] for r in rows["sleep_logs"])
    last_d = max(r["date"] for r in rows["sleep_logs"])
    undo = DATA_DIR / f"seed_undo_{args.user[:8]}.sql"
    undo.parent.mkdir(parents=True, exist_ok=True)
    undo.write_text(f"""-- Undo the seeded demo history for {args.user}
-- Seeded range: {first} .. {last_d}
-- WARNING: this deletes ALL rows for that user in that window, including any
-- real rows created in the same period. Review before running.

delete from exercise_logs where workout_log_id in (
  select id from workout_logs
  where user_id = '{args.user}' and date between '{first}' and '{last_d}'
);
delete from workout_logs      where user_id = '{args.user}' and date between '{first}' and '{last_d}';
delete from workout_execution where user_id = '{args.user}' and date between '{first}' and '{last_d}';
delete from sleep_logs        where user_id = '{args.user}' and date between '{first}' and '{last_d}';
delete from weight_logs       where user_id = '{args.user}' and date between '{first}' and '{last_d}';
delete from vitals_logs       where user_id = '{args.user}' and date between '{first}' and '{last_d}';
delete from body_metrics      where user_id = '{args.user}' and date between '{first}' and '{last_d}';
delete from meal_logs         where user_id = '{args.user}' and date between '{first}' and '{last_d}';
delete from water_logs        where user_id = '{args.user}' and date between '{first}' and '{last_d}';
delete from mood_logs         where user_id = '{args.user}' and date between '{first}' and '{last_d}';

update profiles set weight = {profile.get('weight')} where id = '{args.user}';
""", encoding="utf-8")
    print(f"\n  undo script: {undo}")
    print("\n  done.")


if __name__ == "__main__":
    main()
