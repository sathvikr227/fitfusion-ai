"""Start-up for the Hugging Face Space: fetch the served artifacts, then run the API.

Artifacts live in a private model repo (MODEL_REPO) so trained files derived from
licensed datasets are not republished by the public Space. HF_TOKEN (a Space
secret) grants read access. If the download fails the API still starts and every
endpoint serves its documented fallback, exactly as when a file is missing locally.
"""

from __future__ import annotations

import logging
import os

logging.basicConfig(level="INFO")
log = logging.getLogger("hf_entry")

model_dir = os.environ.get("MODEL_DIR", "/home/user/app/models")
repo = os.environ.get("MODEL_REPO", "")
if repo:
    try:
        from huggingface_hub import snapshot_download

        snapshot_download(repo_id=repo, repo_type="model", local_dir=model_dir,
                          token=os.environ.get("HF_TOKEN") or None)
        log.info("artifacts downloaded from %s into %s", repo, model_dir)
    except Exception:  # noqa: BLE001 - start anyway; endpoints fall back
        log.exception("could not download artifacts from %s", repo)
else:
    log.warning("MODEL_REPO not set; starting without artifacts (fallbacks only)")

import uvicorn  # noqa: E402

uvicorn.run("app.main:app", host="0.0.0.0", port=int(os.environ.get("PORT", "7860")))
