import os

os.environ.setdefault("ML_SERVICE_API_KEY", "test-key")

from fastapi.testclient import TestClient  # noqa: E402

from app.config import settings  # noqa: E402
from app.main import app  # noqa: E402

settings.ML_SERVICE_API_KEY = "test-key"
client = TestClient(app)
AUTH = {"Authorization": "Bearer test-key"}


def test_healthz_open():
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_auth_required():
    r = client.post("/predict/calorie", json={"exercise": "running", "duration_min": 30, "weight_kg": 70})
    assert r.status_code == 401


def test_calorie_stub():
    r = client.post(
        "/predict/calorie",
        json={"exercise": "running", "duration_min": 30, "weight_kg": 70, "intensity": "moderate"},
        headers=AUTH,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["stub"] is True
    assert body["calories"] > 0


def test_recommend_stub():
    r = client.post(
        "/recommend",
        json={"user_id": "u1", "kind": "workout", "top_k": 3},
        headers=AUTH,
    )
    assert r.status_code == 200
    assert len(r.json()["items"]) == 3


def test_injury_stub():
    r = client.post(
        "/predict/injury",
        json={"user_id": "u1", "prior_injuries": ["knee"], "sleep_avg_hours": 5.5},
        headers=AUTH,
    )
    assert r.status_code == 200
    risk = r.json()["risk"]
    assert risk["knee"] > risk["shoulder"]


def test_trajectory_stub():
    r = client.post(
        "/predict/trajectory",
        json={
            "user_id": "u1",
            "sessions": [
                {"date": "2026-05-20", "completed_pct": 0.6, "total_volume": 1000},
                {"date": "2026-05-22", "completed_pct": 0.8, "total_volume": 1100},
                {"date": "2026-05-24", "completed_pct": 0.9, "total_volume": 1300},
                {"date": "2026-05-26", "completed_pct": 1.0, "total_volume": 1500},
            ],
        },
        headers=AUTH,
    )
    assert r.status_code == 200
    assert r.json()["label"] == "improve"


def test_rl_action_stub():
    r = client.post(
        "/rl/action",
        json={
            "user_id": "u1",
            "completion_rate": 0.5,
            "sleep_avg": 7.0,
            "injury_flag": 0.0,
            "trajectory_score": -0.3,
        },
        headers=AUTH,
    )
    assert r.status_code == 200
    assert r.json()["action"] == "REDUCE"
