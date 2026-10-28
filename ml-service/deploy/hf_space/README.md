---
title: FitFusion ML
emoji: 🏃
colorFrom: purple
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
license: other
---

# FitFusion ML service

The FastAPI service behind the FitFusion AI web app's five-model intelligence layer. Every
endpoint except `/healthz` requires the shared bearer token. Source:
https://github.com/sathvikr227/fitfusion-ai (`ml-service/`).

| Endpoint | Model |
|---|---|
| `POST /predict/calories` | 1. Calibrated XGBoost heart-rate energy model with SHAP |
| `POST /recommend`, `POST /recommend/exercises` | 2. Hybrid meal recommender; content-based exercises |
| `POST /predict/injury-risk` | 3. Training-load injury risk with rule-based body regions |
| `POST /predict/trajectory` | 4. Transformer running trajectory |
| `POST /rl/action` | 5. PPO adaptive-replan agent behind a hard safety mask |

Model artifacts are downloaded at start-up from a private model repository. Outputs are
informational and are not medical advice.
