Replaces the step-1 stub endpoints with five trained models and wires each into the route it was designed for. Every ML call keeps a fallback, so the app behaves exactly as it does today whenever the Python service is unreachable.

> **Note:** `origin/main` was one commit behind local `main`, so this PR also carries the previously unpushed step-1 skeleton commit (`6c86292`).

## What's in here

| Model | Endpoint | Consumed by | Headline metric |
|---|---|---|---|
| 1 · Calorie predictor (XGBoost + SHAP) | `POST /predict/calories` | `/api/workout-log` | MAE 87.9 kcal, R² 0.845 |
| 2 · Hybrid recommender (CF + content) | `POST /recommend` | `/api/generate-plan` | Precision@3 **0.747** |
| 3 · Injury risk (multi-label XGBoost) | `POST /predict/injury-risk` | `/api/adaptive-replan` | F1 1.00 / 0.95 / 1.00 / 0.29 |
| 4 · Trajectory (TransformerEncoder) | `POST /predict/trajectory` | `/api/adaptive-replan` | 46.0% 3-class accuracy |
| 5 · PPO agent (`FitFusionEnv`) | `POST /rl/action` | `/api/adaptive-replan` | 14% fewer injury events |

Artifacts load once at startup into a shared registry — no per-request loading. `/predict/calorie` and `/predict/injury` stay as aliases so anything written against the step-1 paths keeps working.

## Orchestration

`/api/adaptive-replan` reads the user's week **once** through a shared history builder, then runs injury risk to trajectory to RL agent. The agent's action becomes the LLaMA directive *and* is then applied deterministically after the model responds: the ±15% delta is scaled into sets and projected burn, exercises loading flagged muscle groups are stripped by name, and the emptiest remaining workout day becomes a rest day. The LLM shapes the plan; it doesn't get to decide whether the safety rules were followed.

`/api/ml-insights` serves that same history to the analytics dashboard, so the readout can't disagree with the decision that was actually made.

## Honest results — 4 targets not met

Worth a reviewer's attention, since these are documented targets the implementation does **not** hit:

- **Calorie MAE 87.9 vs a <25 kcal target.** Dataset calories average 905 ± 273, so 25 would mean explaining 99% of variance from six coarse features. Still cuts the MET table's error by 79%.
- **Shoulder F1 0.286.** Its label keys on `Workout_Type == Strength`, which the documented feature list excludes — the label isn't identifiable from the given inputs. An ablation is included showing F1 rising to **1.000** once that feature is added. The shipped model keeps the documented features.
- **Transformer 46.0% vs a 65% target.** A gradient-boosted tree on the same flattened windows gets only 40.0% and majority-class is 38.9%, so the ceiling is the pseudo-sequence construction rather than the architecture.
- **PPO doesn't beat the rule baseline on reward** (3.771 vs 3.878 over 500 episodes, identical seeds). It does cut injury events 14%. The policy is 86.7% REDUCE, which follows directly from a reward that pays +1 whenever completion improves.

Also: **the documented knee label rule matches zero rows.** `Resting_BPM > 80 AND Workout_Frequency > 5` is unsatisfiable here (BPM tops out at 74, frequency at 5). The trainer detects the degenerate rule and substitutes a quantile-calibrated form of the same two signals, recording the substitution in both the artifact and the metrics report.

Real metrics for every model are committed under `ml-service/models/reports/*.json`.

## Bugs fixed along the way

- **`/api/adaptive-replan` selected `sleep_logs.duration_hours`**, a column that exists in the migration file but not on the live table. The select was erroring, so average sleep had been permanently `null` in the replan prompt. Now reads `sleep_hours`.
- **Vegetarian/vegan diets leaked animal foods** — seal, whale, sea cucumber, then Ling and Orange Roughy — past a keyword blocklist. Switched to an allow-list matched on the food's leading identity, so unrecognised foods are dropped rather than served.
- **Weight-loss diets returned diet soda and black coffee**, since "lowest calorie" is technically correct and useless. Nutrition floors added.
- Resting a whole day discarded healthy exercises; the rest day now lands on the emptiest remaining day.

## Testing

28 service tests, 22 orchestration checks, zero TypeScript errors, clean `next build`, and a live Next.js to FastAPI to XGBoost to SHAP round trip. The ML service was stopped mid-session to confirm the fallback path: the app switched to the MET calculation and kept working.

Exercised end-to-end against a real Supabase user with an active left-hamstring injury: the classifier flagged **hamstring at 0.99** with the other three groups at 0.001, the recommender excluded HIIT, the Transformer read REGRESS, and the agent returned REDUCE at 0.81 confidence.

Not tested through a signed-in browser session. Routes were verified via auth guards (401 on missing and invalid tokens), the live round trip, direct model calls on real data, and orchestration unit checks.

## Reviewer notes

- **New dependencies are Python-only.** `ml-service/requirements.txt` gains xgboost, shap, torch (CPU index), stable-baselines3, gymnasium and friends. **No new npm packages.**
- **The migration is additive and non-blocking.** `20260909_ml_audit_columns.sql` adds `injury_risk` and `ml_meta` to `workout_plans`. The replan route inserts with those columns and retries without them if absent, writing the same payload into `plan.ml_meta` either way.
- **Model artifacts are gitignored**, so a plain deploy starts with no models and every endpoint serves its fallback. Getting the eight files onto Render is a deploy step, not a code change.
- **The muscle-group keyword list is duplicated** across `app/features.py` and `lib/ml-service/injury-rules.ts`, because the service scores risk but never sees the plan while Next.js edits the plan but never scores risk. Both carry a sync comment.
- **Open question:** adding `Workout_Type` to the injury feature set would fix shoulder risk outright but deviates from the documented spec. Flagging rather than deciding.

Full write-up with all metrics, confusion matrices and the remaining manual steps: `docs/ml-implementation-report.html`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
