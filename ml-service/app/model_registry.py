"""Loads model artifacts once and hands them to the routers.

Every artifact is read at process start (or on first use after a failed start)
and cached for the life of the process — no per-request loading. A missing or
corrupt artifact is never fatal: the corresponding `available` flag stays False,
the router falls back to its rule-based path, and `/healthz` reports which
models are live.
"""

from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Any

from .config import settings

log = logging.getLogger("ml-service.registry")

CALORIE_ARTIFACT = "calorie_energy.json"
MEAL_CATALOG_ARTIFACT = "meal_catalog.pkl"
INJURY_ARTIFACT = "injury_risk_model.pkl"
TRAJECTORY_ARTIFACT = "transformer_model.pt"
TRAJECTORY_META_ARTIFACT = "transformer_meta.json"
RL_ARTIFACT = "fitfusion_rl_agent.zip"


class ModelRegistry:
    """Thread-safe, load-once holder for the five model artifacts."""

    def __init__(self, model_dir: Path | None = None) -> None:
        self.model_dir = Path(model_dir or settings.MODEL_DIR)
        self._lock = threading.Lock()
        self._loaded = False

        self.calorie: dict[str, Any] | None = None
        self.recommender: dict[str, Any] | None = None
        self.injury: dict[str, Any] | None = None
        self.trajectory_model: Any | None = None
        self.trajectory_meta: dict[str, Any] | None = None
        self.rl_agent: Any | None = None

        self.errors: dict[str, str] = {}

    # ── loading ───────────────────────────────────────────────────────────────
    def load_all(self) -> None:
        with self._lock:
            if self._loaded:
                return
            self._load_calorie()
            self._load_recommender()
            self._load_injury()
            self._load_trajectory()
            self._load_rl()
            self._loaded = True
            log.info("model registry ready: %s", self.status())

    def _path(self, name: str) -> Path:
        return self.model_dir / name

    def _load_calorie(self) -> None:
        path = self._path(CALORIE_ARTIFACT)
        if not path.exists():
            self.errors["calorie"] = f"{CALORIE_ARTIFACT} not found"
            return
        try:
            energy = json.loads(path.read_text(encoding="utf-8"))
            for key in ("intercept", "slope", "validated_hr_range_bpm", "expected_mae_kcal_per_min"):
                if key not in energy:
                    raise KeyError(f"{CALORIE_ARTIFACT} is missing '{key}'")
            self.calorie = energy
            log.info("loaded energy calibration (%s)", energy.get("model_version"))
        except Exception as exc:  # noqa: BLE001
            self.errors["calorie"] = str(exc)
            log.exception("failed to load %s", CALORIE_ARTIFACT)

    def _load_recommender(self) -> None:
        path = self._path(MEAL_CATALOG_ARTIFACT)
        if not path.exists():
            self.errors["recommender"] = f"{MEAL_CATALOG_ARTIFACT} not found"
            return
        try:
            import joblib

            bundle = joblib.load(path)
            if "catalog" not in bundle:
                raise KeyError(f"{MEAL_CATALOG_ARTIFACT} has no 'catalog'")
            self.recommender = bundle
            log.info("loaded meal catalog (%d recipes, %s)", len(bundle["catalog"]), bundle.get("method"))
        except Exception as exc:  # noqa: BLE001
            self.errors["recommender"] = str(exc)
            log.exception("failed to load %s", MEAL_CATALOG_ARTIFACT)

    def _load_injury(self) -> None:
        path = self._path(INJURY_ARTIFACT)
        if not path.exists():
            self.errors["injury"] = f"{INJURY_ARTIFACT} not found"
            return
        try:
            import joblib

            self.injury = joblib.load(path)
            log.info("loaded injury model (%s)", self.injury.get("model_version"))
        except Exception as exc:  # noqa: BLE001
            self.errors["injury"] = str(exc)
            log.exception("failed to load %s", INJURY_ARTIFACT)

    def _load_trajectory(self) -> None:
        path = self._path(TRAJECTORY_ARTIFACT)
        meta_path = self._path(TRAJECTORY_META_ARTIFACT)
        if not path.exists() or not meta_path.exists():
            self.errors["trajectory"] = (
                f"missing {TRAJECTORY_ARTIFACT} or {TRAJECTORY_META_ARTIFACT}"
            )
            return
        try:
            import torch

            from .trajectory_model import WorkoutTransformer

            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            model = WorkoutTransformer()
            model.load_state_dict(torch.load(path, map_location="cpu", weights_only=True))
            model.eval()
            self.trajectory_model = model
            self.trajectory_meta = meta
            log.info("loaded trajectory transformer (%s)", meta.get("model_version"))
        except Exception as exc:  # noqa: BLE001
            self.errors["trajectory"] = str(exc)
            log.exception("failed to load %s", TRAJECTORY_ARTIFACT)

    def _load_rl(self) -> None:
        path = self._path(RL_ARTIFACT)
        if not path.exists():
            self.errors["rl"] = f"{RL_ARTIFACT} not found"
            return
        try:
            from stable_baselines3 import PPO

            self.rl_agent = PPO.load(str(path), device="cpu")
            log.info("loaded PPO agent")
        except Exception as exc:  # noqa: BLE001
            self.errors["rl"] = str(exc)
            log.exception("failed to load %s", RL_ARTIFACT)

    # ── introspection ─────────────────────────────────────────────────────────
    def status(self) -> dict[str, bool]:
        return {
            "calorie": self.calorie is not None,
            "recommender": self.recommender is not None,
            "injury": self.injury is not None,
            "trajectory": self.trajectory_model is not None,
            "rl": self.rl_agent is not None,
        }

    def loaded_names(self) -> list[str]:
        return [name for name, ok in self.status().items() if ok]


registry = ModelRegistry()


def get_registry() -> ModelRegistry:
    """FastAPI dependency. Loads on first use if startup did not run."""
    if not registry._loaded:  # noqa: SLF001 - same module owns the flag
        registry.load_all()
    return registry
