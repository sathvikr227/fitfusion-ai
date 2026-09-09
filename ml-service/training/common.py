"""Shared plumbing for the five training scripts.

Handles dataset acquisition, paths, and the metrics report that every trainer
writes next to its artifact. Import this from every `train_*.py` so the scripts
stay reproducible and free of copy-pasted setup.

Run any trainer from the `ml-service/` directory:

    .venv/Scripts/python.exe -m training.train_calorie
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

# Windows consoles default to cp1252 and raise on the arrows and dashes these
# scripts print. Force UTF-8 so a trainer never dies on its own progress output.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001 - cosmetic only, never fatal
            pass

# Repo layout: ml-service/training/common.py → ml-service/
ML_SERVICE_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("FITFUSION_DATA_DIR", ML_SERVICE_ROOT / "data"))
MODEL_DIR = Path(os.environ.get("MODEL_DIR", ML_SERVICE_ROOT / "models"))
REPORT_DIR = MODEL_DIR / "reports"

# Kaggle's public dataset endpoint serves these two without credentials.
KAGGLE_DATASETS = {
    "gym": (
        "valakhorasani/gym-members-exercise-dataset",
        "gym_members_exercise_tracking.csv",
    ),
    "food": ("shrutisaxena/food-nutrition-dataset", "food.csv"),
}

RANDOM_SEED = 42


def ensure_dirs() -> None:
    for d in (DATA_DIR, MODEL_DIR, REPORT_DIR):
        d.mkdir(parents=True, exist_ok=True)


def download_dataset(key: str) -> Path:
    """Return the local CSV for a Kaggle dataset, downloading it once if absent."""
    if key not in KAGGLE_DATASETS:
        raise KeyError(f"Unknown dataset key: {key}")

    slug, csv_name = KAGGLE_DATASETS[key]
    ensure_dirs()
    csv_path = DATA_DIR / csv_name
    if csv_path.exists():
        return csv_path

    zip_path = DATA_DIR / f"{key}.zip"
    url = f"https://www.kaggle.com/api/v1/datasets/download/{slug}"
    print(f"[data] downloading {slug} → {zip_path.name}")

    req = urllib.request.Request(url, headers={"User-Agent": "fitfusion-ml/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=180) as resp, open(zip_path, "wb") as fh:
            fh.write(resp.read())
    except Exception as exc:  # noqa: BLE001 - surfaced to the operator verbatim
        raise RuntimeError(
            f"Could not download {slug} from Kaggle ({exc}). "
            f"Download it manually and place {csv_name} in {DATA_DIR}."
        ) from exc

    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(DATA_DIR)

    if not csv_path.exists():
        raise FileNotFoundError(f"{csv_name} not found inside {slug} archive")

    print(f"[data] ready: {csv_path}")
    return csv_path


def load_gym_dataset() -> pd.DataFrame:
    """Gym Members Exercise Dataset — 973 rows, 15 columns, no nulls."""
    df = pd.read_csv(download_dataset("gym"))
    before = len(df)
    df = df.dropna().reset_index(drop=True)
    if len(df) != before:
        print(f"[data] dropped {before - len(df)} rows containing nulls")
    print(f"[data] gym dataset: {df.shape[0]} rows × {df.shape[1]} cols")
    return df


def load_food_dataset() -> pd.DataFrame:
    df = pd.read_csv(download_dataset("food"))
    print(f"[data] food dataset: {df.shape[0]} rows × {df.shape[1]} cols")
    return df


def load_pilot_csv(name: str) -> pd.DataFrame | None:
    """Load a FitFusion pilot export written by `training/export_pilot_data.py`.

    Returns None when the export has not been run — callers fall back to
    dataset-derived defaults rather than failing.
    """
    path = DATA_DIR / "pilot" / name
    if not path.exists():
        return None
    try:
        return pd.read_csv(path)
    except Exception as exc:  # noqa: BLE001
        print(f"[pilot] could not read {path.name}: {exc}")
        return None


def write_report(name: str, payload: dict) -> Path:
    """Persist a trainer's real metrics so the numbers are auditable later."""
    ensure_dirs()
    payload = {
        "model": name,
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "python": sys.version.split()[0],
        **payload,
    }
    path = REPORT_DIR / f"{name}.json"
    path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    print(f"[report] wrote {path}")
    return path


def banner(title: str) -> None:
    print()
    print("=" * 72)
    print(f"  {title}")
    print("=" * 72)
