"""Optional read-only Supabase access for the injury endpoint.

The reference guide specifies `POST /predict/injury-risk {user_id}` with the
service fetching the rows itself. FitFusion's own convention is that Next.js
owns the database session, so this path is opt-in: it activates only when
SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set on the service. When they
are not, callers pass the features directly and nothing here runs.

Reads only. Never writes, and never touches auth — user identity is established
in Next.js before the call reaches this service.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

import httpx

from .config import settings

log = logging.getLogger("ml-service.supabase")

LOOKBACK_DAYS = 7


class SupabaseUnavailable(RuntimeError):
    """Raised when a caller wants a server-side fetch but it is not configured."""


def _headers() -> dict[str, str]:
    key = settings.SUPABASE_SERVICE_ROLE_KEY
    return {"apikey": key, "Authorization": f"Bearer {key}"}


def _get(client: httpx.Client, table: str, params: dict[str, str]) -> list[dict]:
    response = client.get(
        f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/{table}",
        params=params,
        headers=_headers(),
    )
    response.raise_for_status()
    payload = response.json()
    return payload if isinstance(payload, list) else []


def fetch_injury_features(user_id: str) -> dict:
    """Assemble the injury model's inputs from the live FitFusion tables.

    Returns whatever it can find; missing pieces come back as None and the
    router imputes them from the training-set medians.
    """
    if not settings.supabase_enabled:
        raise SupabaseUnavailable("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured")

    since = (datetime.now(timezone.utc).date() - timedelta(days=LOOKBACK_DAYS)).isoformat()
    result: dict = {
        "age": None,
        "bmi": None,
        "resting_bpm": None,
        "session_duration_hours": None,
        "workout_frequency": None,
        "experience_level": None,
        "sleep_avg_hours": None,
        "prior_injuries": [],
    }

    with httpx.Client(timeout=settings.SUPABASE_TIMEOUT_SECONDS) as client:
        profiles = _get(
            client,
            "profiles",
            {
                "select": "age,height,weight,training_style,activity_level",
                "id": f"eq.{user_id}",
                "limit": "1",
            },
        )
        if profiles:
            profile = profiles[0]
            result["age"] = _number(profile.get("age"))
            height = _number(profile.get("height"))
            weight = _number(profile.get("weight"))
            if height and weight:
                metres = height / 100.0 if height > 3 else height
                if metres > 0:
                    result["bmi"] = round(weight / (metres * metres), 2)
            result["experience_level"] = _experience_from_activity(profile.get("activity_level"))

        workouts = _get(
            client,
            "workout_logs",
            {"select": "date", "user_id": f"eq.{user_id}", "date": f"gte.{since}"},
        )
        if workouts:
            result["workout_frequency"] = float(len({row["date"] for row in workouts if row.get("date")}))

        sleep = _get(
            client,
            "sleep_logs",
            {"select": "sleep_hours", "user_id": f"eq.{user_id}", "date": f"gte.{since}"},
        )
        hours = [_number(row.get("sleep_hours")) for row in sleep]
        hours = [h for h in hours if h is not None]
        if hours:
            result["sleep_avg_hours"] = round(sum(hours) / len(hours), 2)

        vitals = _get(
            client,
            "vitals_logs",
            {
                "select": "resting_heart_rate",
                "user_id": f"eq.{user_id}",
                "order": "date.desc",
                "limit": "1",
            },
        )
        if vitals:
            result["resting_bpm"] = _number(vitals[0].get("resting_heart_rate"))

        injuries = _get(
            client,
            "injuries",
            {"select": "body_part", "user_id": f"eq.{user_id}", "status": "eq.active"},
        )
        result["prior_injuries"] = [
            str(row.get("body_part")) for row in injuries if row.get("body_part")
        ]

    return result


def _number(value) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _experience_from_activity(activity_level) -> int | None:
    """Map FitFusion's activity_level onto the dataset's 1-3 experience scale."""
    text = str(activity_level or "").strip().lower().replace("-", "_").replace(" ", "_")
    if not text:
        return None
    if text in {"sedentary", "lightly_active", "light"}:
        return 1
    if text in {"moderately_active", "moderate"}:
        return 2
    if text in {"very_active", "extremely_active", "athlete", "active"}:
        return 3
    return None
