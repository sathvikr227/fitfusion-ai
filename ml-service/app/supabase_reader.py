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
from datetime import datetime, timedelta, timezone

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
    """Assemble the injury endpoint's inputs from the live FitFusion tables.

    Returns the 7 days before today in runners units (see
    app.injury_load.build_recent_days), the exercise names logged in those
    days, and the user's recorded injuries as free text.
    """
    if not settings.supabase_enabled:
        raise SupabaseUnavailable("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured")

    from .injury_load import build_recent_days

    today = datetime.now(timezone.utc).date()
    since = (today - timedelta(days=LOOKBACK_DAYS)).isoformat()
    user = f"eq.{user_id}"

    with httpx.Client(timeout=settings.SUPABASE_TIMEOUT_SECONDS) as client:
        workouts = _get(client, "workout_logs", {"select": "id,date", "user_id": user, "date": f"gte.{since}"})
        exercises_by_log: dict[str, list[str]] = {}
        ids = [str(row["id"]) for row in workouts if row.get("id")]
        if ids:
            rows = _get(client, "exercise_logs",
                        {"select": "workout_log_id,exercise_name", "workout_log_id": f"in.({','.join(ids)})"})
            for row in rows:
                exercises_by_log.setdefault(str(row.get("workout_log_id")), []).append(str(row.get("exercise_name") or ""))
        cardio = _get(client, "cardio_logs",
                      {"select": "date,activity,distance_km,duration_minutes", "user_id": user, "date": f"gte.{since}"})
        profiles = _get(client, "profiles", {"select": "injuries", "id": user, "limit": "1"})
        injuries = _get(client, "injuries", {"select": "body_part,name", "user_id": user, "status": "eq.active"})

    prior: list[str] = []
    if profiles and profiles[0].get("injuries"):
        prior.append(str(profiles[0]["injuries"]))
    for row in injuries:
        prior.extend(str(row[k]) for k in ("body_part", "name") if row.get(k))

    return {
        "recent_days": build_recent_days(workouts, exercises_by_log, cardio, today),
        "recent_exercises": [name for names in exercises_by_log.values() for name in names if name],
        "prior_injuries": prior,
    }
