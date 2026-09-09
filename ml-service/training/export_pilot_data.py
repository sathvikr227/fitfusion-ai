"""Export real FitFusion pilot data from Supabase for model calibration.

Reads the live tables through PostgREST with the service-role key and writes
CSVs into `ml-service/data/pilot/`. Nothing here invents rows: if a table is
empty the CSV is empty and downstream trainers fall back to dataset defaults
and say so.

Credentials come from the environment, or from `web/.env.local` when running
locally. Nothing is printed except row counts.

    .venv/Scripts/python.exe -m training.export_pilot_data
"""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

from training.common import DATA_DIR, ML_SERVICE_ROOT, banner

PILOT_DIR = DATA_DIR / "pilot"

TABLES = {
    "workout_logs": "user_id,date,total_calories,is_assigned,plan_id,created_at",
    "workout_execution": "user_id,date,exercise_name,done",
    "sleep_logs": "user_id,date,sleep_hours,quality",
    "injuries": "user_id,body_part,severity,status,date_occurred",
    "profiles": "id,age,gender,height,weight,goal,activity_level,injuries,"
    "dietary_restrictions,training_style,sleep_hours,days_off,rest_days_per_week",
    "exercise_logs": "workout_log_id,exercise_name,sets,reps,weight,duration,calories",
}


def load_env() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not (url and key):
        env_path = ML_SERVICE_ROOT.parent / "web" / ".env.local"
        if env_path.exists():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                name, value = line.split("=", 1)
                value = value.strip().strip('"').strip("'")
                if name.strip() == "NEXT_PUBLIC_SUPABASE_URL" and not url:
                    url = value
                elif name.strip() == "SUPABASE_SERVICE_ROLE_KEY" and not key:
                    key = value

    if not (url and key):
        raise RuntimeError(
            "Supabase credentials not found. Set SUPABASE_URL and "
            "SUPABASE_SERVICE_ROLE_KEY, or run from a checkout with web/.env.local."
        )
    return url.rstrip("/"), key


def fetch(url: str, key: str, table: str, select: str, limit: int = 10000) -> pd.DataFrame:
    query = urllib.parse.urlencode({"select": select, "limit": limit})
    req = urllib.request.Request(
        f"{url}/rest/v1/{table}?{query}",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return pd.DataFrame(json.loads(resp.read().decode()))


def completion_rates(execution: pd.DataFrame) -> pd.DataFrame:
    """Per user-day completion rate from the real workout_execution table."""
    if execution.empty:
        return pd.DataFrame(columns=["user_id", "date", "completion_rate", "planned"])

    grouped = (
        execution.groupby(["user_id", "date"])["done"]
        .agg(["sum", "count"])
        .reset_index()
        .rename(columns={"sum": "done", "count": "planned"})
    )
    grouped["completion_rate"] = grouped["done"] / grouped["planned"].clip(lower=1)
    return grouped[["user_id", "date", "completion_rate", "planned"]]


def main() -> None:
    banner("Export FitFusion pilot data from Supabase")
    url, key = load_env()
    PILOT_DIR.mkdir(parents=True, exist_ok=True)

    frames: dict[str, pd.DataFrame] = {}
    for table, select in TABLES.items():
        try:
            df = fetch(url, key, table, select)
        except Exception as exc:  # noqa: BLE001
            print(f"  {table:20s} SKIPPED ({exc})")
            continue
        frames[table] = df
        df.to_csv(PILOT_DIR / f"{table}.csv", index=False)
        print(f"  {table:20s} {len(df):5d} rows → {table}.csv")

    execution = frames.get("workout_execution", pd.DataFrame())
    rates = completion_rates(execution)
    rates.to_csv(PILOT_DIR / "completion_rates.csv", index=False)
    print(f"  {'completion_rates':20s} {len(rates):5d} rows → completion_rates.csv")

    if not rates.empty:
        print(
            f"\n  Real completion rate: mean={rates['completion_rate'].mean():.3f} "
            f"std={rates['completion_rate'].std():.3f} "
            f"across {rates['user_id'].nunique()} users"
        )

    injuries = frames.get("injuries", pd.DataFrame())
    profiles = frames.get("profiles", pd.DataFrame())
    if not profiles.empty:
        active_users = (
            injuries[injuries["status"] == "active"]["user_id"].nunique()
            if not injuries.empty
            else 0
        )
        print(
            f"  Active-injury rate: {active_users}/{len(profiles)} users "
            f"= {active_users / len(profiles):.3f}"
        )

    print(f"\n[pilot] wrote {PILOT_DIR}")


if __name__ == "__main__":
    main()
