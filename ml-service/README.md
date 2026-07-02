# ml-service

FastAPI microservice that serves the 5-model ML layer for FitFusion AI. Step 1 ships **stub endpoints** — real models land in later steps.

## Endpoints

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET  | `/healthz` | liveness probe | none |
| POST | `/predict/calorie` | XGBoost + SHAP calorie estimate | bearer |
| POST | `/recommend` | hybrid recommender (workout/diet) | bearer |
| POST | `/predict/injury` | multi-label injury risk | bearer |
| POST | `/predict/trajectory` | transformer 3-class trajectory | bearer |
| POST | `/rl/action` | PPO intensity action | bearer |

Auth header: `Authorization: Bearer <ML_SERVICE_API_KEY>`.

## Local dev

```bash
cd ml-service
python -m venv .venv
.venv\Scripts\activate         # PowerShell on Windows
pip install -r requirements.txt
copy .env.example .env         # then edit .env, set ML_SERVICE_API_KEY
uvicorn app.main:app --reload --port 8000
```

Smoke test:

```bash
pytest -q
```

## Deploy (Render)

`render.yaml` is committed. In the Render dashboard, set `ML_SERVICE_API_KEY` to a long random string (must match the one in `web/.env.local` / Vercel).

## Notes

- The service refuses requests with 503 if `ML_SERVICE_API_KEY` is unset — fail closed, not open.
- All endpoints currently return `"stub": true`. Real models replace these one at a time in Steps 2–6.
- Saved model artifacts go in `models/` and are gitignored; trained offline and uploaded out-of-band.
