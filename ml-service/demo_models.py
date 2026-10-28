"""Presentation demo for Model 1 (session energy) and Model 2 (meal recommender).

Runs the real FastAPI endpoints in-process (no server, no network), prints the
input, the intermediate steps, and the output of each model.

    .venv/Scripts/python.exe demo_models.py 1      # Model 1 only
    .venv/Scripts/python.exe demo_models.py 2      # Model 2 only
    .venv/Scripts/python.exe demo_models.py        # both
"""

from __future__ import annotations

import json
import logging
import math
import sys

from fastapi.testclient import TestClient

from app.config import settings
from app.energy import keytel_kcal_per_min
from app.main import app
from app.model_registry import registry

logging.disable(logging.CRITICAL)

# One demo user, used by both models.
PROFILE = {
    "age": 22, "gender": "Male", "height_cm": 175, "weight_kg": 70,
    "activity_level": "moderately_active", "goal": "weight_loss",
    "dietary_restrictions": ["vegetarian"],
}
AUTH = {"Authorization": f"Bearer {settings.ML_SERVICE_API_KEY}"}


def show(title: str, payload) -> None:
    print(f"\n--- {title} ---")
    print(json.dumps(payload, indent=2))


def model_1(client: TestClient) -> None:
    print("\n" + "=" * 70)
    print("MODEL 1 - session energy expenditure   POST /predict/calories")
    print("=" * 70)
    energy = registry.calorie

    request = {"weight_kg": PROFILE["weight_kg"], "age": PROFILE["age"], "sex": PROFILE["gender"],
               "avg_hr": 150, "duration_min": 30, "workout_type": "Cardio"}
    show("INPUT (a 30-minute cardio session at 150 bpm)", request)

    raw = float(keytel_kcal_per_min(150, 70, 22, False))
    print("\n--- PROCESSING ---")
    print(f"1. Keytel (2005) male equation -> {raw:.2f} kcal/min (uncalibrated)")
    if energy:
        per_min = energy["intercept"] + energy["slope"] * raw
        print(f"2. Calibration {energy['intercept']} + {energy['slope']} x {raw:.2f} = {per_min:.2f} kcal/min")
        print(f"3. x 30 minutes = {per_min * 30:.1f} kcal")

    response = client.post("/predict/calories", json=request, headers=AUTH)
    show(f"OUTPUT (HTTP {response.status_code})", response.json())

    print("\n--- FALLBACK CASES (the method switches to the MET table and says why) ---")
    cases = [
        ("no heart rate", {**request, "avg_hr": None}),
        ("strength session", {**request, "workout_type": "Strength"}),
        ("HR outside validated range", {**request, "avg_hr": 200}),
    ]
    for label, body in cases:
        out = client.post("/predict/calories", json=body, headers=AUTH).json()
        print(f"  {label:<28} -> {out['calories']:>6} kcal  method={out['method']}  reason={out['reason']}")

    bad = client.post("/predict/calories", json={"weight_kg": -5, "duration_min": 30}, headers=AUTH)
    print(f"  {'invalid input (weight -5)':<28} -> HTTP {bad.status_code}: {bad.json()['detail'][0]['msg']}")
    noauth = client.post("/predict/calories", json=request)
    print(f"  {'no bearer token':<28} -> HTTP {noauth.status_code}: {noauth.json()['detail']}")


def meal_targets() -> list[dict]:
    """Same arithmetic as web/src/lib/meal-targets.ts, for this demo profile only."""
    bmr = 10 * PROFILE["weight_kg"] + 6.25 * PROFILE["height_cm"] - 5 * PROFILE["age"] + 5  # male
    tdee = bmr * 1.55                                                                      # moderately active
    daily = max(1500, math.floor(tdee * (1 - 0.2) + 0.5))                                 # weight loss -20%
    split = {"breakfast": 0.25, "lunch": 0.35, "dinner": 0.30, "snack": 0.10}
    print("\n--- STEP BEFORE MODEL 2 (Next.js, web/src/lib/meal-targets.ts) ---")
    print(f"BMR (Mifflin-St Jeor) = {bmr:.0f} kcal   TDEE = BMR x 1.55 = {tdee:.0f} kcal")
    print(f"Daily target (weight loss, -20%) = {daily} kcal")
    return [{"slot": s, "kcal_target": math.floor(daily * f + 0.5), "min_protein_g": 0} for s, f in split.items()]


def model_2(client: TestClient) -> None:
    print("\n" + "=" * 70)
    print("MODEL 2 - meal recommender   POST /recommend")
    print("=" * 70)
    request = {"meals": meal_targets(), "dietary_restrictions": PROFILE["dietary_restrictions"], "per_meal": 3}
    show("INPUT", request)

    print("\n--- PROCESSING (per slot) ---")
    print("1. keep recipes whose Food.com course tag fits the slot")
    print("2. keep recipes whose ingredient-based flag allows every restriction")
    print("3. keep recipes within +/-25% of the slot calories (widen to +/-50% if too few)")
    print("4. take the top N by likes in the last 365 days of the data")

    response = client.post("/recommend", json=request, headers=AUTH)
    data = response.json()
    print(f"\n--- OUTPUT (HTTP {response.status_code}) ---")
    print(f"method={data['method']}  version={data['model_version']}  restrictions={data['applied_restrictions']}")
    for meal in data["meals"]:
        print(f"\n  {meal['slot'].upper()}  band {meal['kcal_min']:.0f}-{meal['kcal_max']:.0f} kcal  widened={meal['widened']}")
        for r in meal["recipes"]:
            print(f"    - {r['name']:<50} {r['kcal']:>6} kcal  {r['protein_g']:>5} g protein  "
                  f"{r['likes_last_year']:>3} likes last year")

    print("\n--- SAFETY CASE: a restriction the flags cannot verify ---")
    halal = client.post("/recommend", json={**request, "dietary_restrictions": ["halal"]}, headers=AUTH).json()
    print(f"  halal -> {len(halal['meals'])} meals returned, reason: {halal['reason']}")


def main() -> None:
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    with TestClient(app) as client:
        health = client.get("/healthz").json()
        print(f"Service loaded: calorie={health['models_status']['calorie']}  "
              f"recommender={health['models_status']['recommender']}")
        if which in ("1", "all"):
            model_1(client)
        if which in ("2", "all"):
            model_2(client)


if __name__ == "__main__":
    main()
