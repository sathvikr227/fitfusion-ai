"""Deploy the ML service to Hugging Face: private model repo + public Docker Space.

    .venv/Scripts/python.exe deploy/deploy_hf.py              # artifacts + Space + secrets
    .venv/Scripts/python.exe deploy/deploy_hf.py --code-only  # re-push code, keep artifacts

Status (2026-10-28): the private model repo tssr27/fitfusion-ml-models is uploaded. Creating
the Space failed with 402: Hugging Face now requires a PRO subscription for Docker Spaces on
cpu-basic. The owner chose not to host the ML service for now; the website runs on its
rule-based fallbacks. With PRO, run this script again and it completes as written.

Needs `hf auth login` (a write token). Never prints secret values:
  * ML_SERVICE_API_KEY is generated once into .deploy/ml_service_api_key (gitignored)
    and set as a Space secret; the same file is used to configure Vercel.
  * HF_TOKEN (the logged-in token) is set as a Space secret so the Space can read the
    private model repo.
"""

from __future__ import annotations

import secrets
import sys
from pathlib import Path

from huggingface_hub import HfApi, get_token

ROOT = Path(__file__).resolve().parent.parent           # ml-service/
SPACE_FILES = Path(__file__).resolve().parent / "hf_space"
SECRETS_DIR = ROOT / ".deploy"
KEY_FILE = SECRETS_DIR / "ml_service_api_key"
SERVED = [
    "calorie_energy.json", "calorie_hr_model.pkl", "meal_catalog.pkl", "meal_hybrid_serving.pkl",
    "exercise_index.pkl", "injury_load_model.pkl", "trajectory_runs.pt", "trajectory_runs_meta.json",
    "rl_ppo_agent.zip", "rl_ppo_meta.json",
]


def api_key() -> str:
    SECRETS_DIR.mkdir(exist_ok=True)
    if not KEY_FILE.exists():
        KEY_FILE.write_text(secrets.token_urlsafe(32), encoding="utf-8")
        print(f"[secret] generated a new ML_SERVICE_API_KEY in {KEY_FILE} (not shown)")
    return KEY_FILE.read_text(encoding="utf-8").strip()


def main() -> None:
    api = HfApi()
    user = api.whoami()["name"]
    space, models = f"{user}/fitfusion-ml", f"{user}/fitfusion-ml-models"
    code_only = "--code-only" in sys.argv

    if not code_only:
        missing = [n for n in SERVED if not (ROOT / "models" / n).exists()]
        if missing:
            raise SystemExit(f"missing artifacts: {missing}")
        api.create_repo(models, repo_type="model", private=True, exist_ok=True)
        for name in SERVED:
            api.upload_file(path_or_fileobj=str(ROOT / "models" / name), path_in_repo=name,
                            repo_id=models, repo_type="model", commit_message=f"upload {name}")
            print(f"[models] uploaded {name}")

    api.create_repo(space, repo_type="space", space_sdk="docker", private=False, exist_ok=True)
    api.upload_folder(folder_path=str(ROOT / "app"), path_in_repo="app", repo_id=space, repo_type="space",
                      ignore_patterns=["__pycache__/*", "*.pyc"], commit_message="app code")
    for name in ("Dockerfile", "README.md", "hf_entry.py"):
        api.upload_file(path_or_fileobj=str(SPACE_FILES / name), path_in_repo=name, repo_id=space, repo_type="space")
    api.upload_file(path_or_fileobj=str(ROOT / "requirements.txt"), path_in_repo="requirements.txt",
                    repo_id=space, repo_type="space", commit_message="requirements")
    print(f"[space] code pushed to {space}")

    if not code_only:
        api.add_space_variable(space, "MODEL_REPO", models)
        api.add_space_secret(space, "HF_TOKEN", get_token())
        api.add_space_secret(space, "ML_SERVICE_API_KEY", api_key())
        print("[space] set MODEL_REPO, HF_TOKEN and ML_SERVICE_API_KEY (values not shown)")
    print(f"[done] https://huggingface.co/spaces/{space}  ->  https://{user}-fitfusion-ml.hf.space")


if __name__ == "__main__":
    main()
