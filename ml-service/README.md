# ml-service

FastAPI microservice serving the five-model ML layer for FitFusion AI.

Artifacts load **once at startup** into a shared registry; no request ever loads
a model. A missing or broken artifact is not fatal — its endpoint falls back to
the rule it replaced, flags `"stub": true`, and `/healthz` reports why.

## Endpoints

| Method | Path | Model | Auth |
|---|---|---|---|
| GET  | `/healthz` | liveness + per-model load status | none |
| POST | `/predict/calories` | 1 — XGBoost + SHAP calorie predictor | bearer |
| POST | `/recommend` | 2 — hybrid CF + content recommender | bearer |
| POST | `/predict/injury-risk` | 3 — multi-label injury risk | bearer |
| POST | `/predict/trajectory` | 4 — Transformer progression | bearer |
| POST | `/rl/action` | 5 — PPO adaptive replan agent | bearer |

`/predict/calorie` and `/predict/injury` remain as aliases for the Step 1
skeleton's paths. Auth header: `Authorization: Bearer <ML_SERVICE_API_KEY>`.

Interactive schema at `/docs` when the service is running.

## Local dev

```bash
cd ml-service
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
cp .env.example .env          # then set ML_SERVICE_API_KEY
.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000
```

Train the models before starting, or every endpoint will serve its fallback —
see [training/README.md](training/README.md).

```bash
.venv/Scripts/python.exe -m pytest -q
```

## Layout

```
app/
  main.py              FastAPI app, startup model loading, /healthz
  config.py            env-driven settings
  auth.py              shared-bearer verification (fails closed)
  schemas.py           request/response contracts
  features.py          feature contract shared by training and serving
  model_registry.py    load-once, thread-safe artifact holder
  rl_env.py            FitFusionEnv — the PPO training environment
  trajectory_model.py  Transformer architecture (shared with training)
  supabase_reader.py   optional read-only Supabase access for injury risk
  routers/             one router per model
training/              five reproducible trainers + pilot export
models/                artifacts (gitignored, produced by training)
```

`app/features.py`, `app/rl_env.py` and `app/trajectory_model.py` live under
`app/` rather than `training/` because the deployed image ships only `app/` and
`models/` — serving must be able to rebuild a model class without the training
package.

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `ML_SERVICE_API_KEY` | yes | shared bearer; must match the web app's value |
| `MODEL_DIR` | no | artifact directory, default `./models` |
| `LOG_LEVEL` | no | default `info` |
| `SUPABASE_URL` | no | enables server-side fetch for `/predict/injury-risk` |
| `SUPABASE_SERVICE_ROLE_KEY` | no | as above |

The two Supabase variables are optional by design. Next.js owns the database
session and normally sends the injury model's features in the request body, so
the ML service holds no database credentials. Set them only if you want the
documented `{user_id}`-only contract to read Supabase itself.

## Deploy (Render)

`render.yaml` is committed. In the Render dashboard set `ML_SERVICE_API_KEY` to
a long random string matching the web app's value.

Model artifacts are gitignored, so a plain deploy starts with **no models** and
every endpoint serves its fallback. Ship the artifacts one of these ways:

1. Commit them to a private release / object store and fetch them in
   `buildCommand` into `MODEL_DIR`, or
2. Attach a Render persistent disk at `/opt/render/project/src/ml-service/models`
   and upload the files once, or
3. Build the Docker image locally (the `Dockerfile` copies `models/`) and deploy
   that image.

Confirm with `GET /healthz` — `models_loaded` lists what is actually live.

## Behaviour when a model is missing

| Endpoint | Fallback |
|---|---|
| `/predict/calories` | MET formula (the rule the model replaces) |
| `/recommend` | empty seed; the plan prompt is left unchanged |
| `/predict/injury-risk` | sleep/frequency/BMI heuristic, sub-threshold |
| `/predict/trajectory` | completion-rate slope |
| `/rl/action` | the original three completion-rate thresholds |

The Next.js client passes its own fallback on every call too, so the app also
survives the whole service being unreachable.
