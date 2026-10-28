# Model 5 — PPO adaptive-replan agent (teacher demo)

**What it does.** Each week, the adaptive replan decides whether to make a user's plan harder
(INCREASE), keep it (MAINTAIN) or ease off (REDUCE). It decides from 5 numbers: completion,
sleep, injury flag, Model 4's trajectory and the training streak. Model 5 tests whether a
reinforcement-learning agent (PPO) makes that call better than the simple rule the app used.

**Result.** It does not. The agent was trained and scored in a simulator calibrated on three
real datasets. In two pre-registered rounds it learned to push load until the simulated user
quits, scoring about −23 against about −9 for the rule. So the app keeps the rule, now
behind a **hard safety mask** that never allows INCREASE while injured or on < 5.5 h sleep.
**All results are simulated.**

| File | Contents |
|---|---|
| `PROTOCOL.md`, `PROTOCOL_ROUND2.md` | plans and serving rules, committed before results |
| `DATA_SOURCES.md` | what in the simulator is real (3 datasets) and what is assumed |
| `RESULTS.md` | both rounds, baselines, CIs, why PPO fails, deviations |
| `demo.py` | audit, calibration, a decision for the sample state, one simulated user coached by PPO vs the rule, API call, evaluation |
| `sample_input.json` | labelled (illustrative) state |
| `outputs/demo_output.txt`, `outputs/demo_output.json` | the actual output of `demo.py` |
| `outputs/test_results.txt`, `outputs/training_log_round{1,2}.txt` | tests and training logs |

Figures: `models/reports/rl_calibration.png`, `rl_ppo.png`, `rl_ppo_round2.png`.

| Code | Role |
|---|---|
| `training/calibrate_rl_env.py` | estimate the real-data curves |
| `app/rl_env.py` | the simulator, `safe_action`, the threshold rule (shared by training, tests, API) |
| `training/train_rl_ppo.py`, `training/train_rl_ppo_round2.py` | train, evaluate, apply the serving rule |
| `app/routers/rl_action.py` | `POST /rl/action` |
| `tests/test_model5_rl.py` | mask, rule, simulator, endpoint safety sweep, artifact |

## How to run (Windows, from `ml-service\`)

```powershell
.venv\Scripts\python.exe -u -m training.calibrate_rl_env      # ~5 min, needs the Model 3/4 data
.venv\Scripts\python.exe -u -m training.train_rl_ppo          # ~25 min (round 1)
.venv\Scripts\python.exe -u -m training.train_rl_ppo_round2   # ~50 min (round 2)
.venv\Scripts\python.exe demos\model5_rl\demo.py
.venv\Scripts\python.exe -m pytest -q tests\test_model5_rl.py
```

## How to present it (about 5 minutes)

1. **The old agent was broken** (section 1): it was paid for raising completion, so it always
   cut the plan, and its "pilot data" was test data.
2. **A simulator grounded in real data** (section 2, `DATA_SOURCES.md`). The injury data shows
   no strong load-spike effect, and the simulator says so instead of assuming one.
3. **Plans fixed first**: two protocols, the second committed before the first was scored.
4. **Watch it fail** (section 4): PPO pushes the same user to maximum load and loses them in
   week 7; the rule coaches them for 26 weeks.
5. **Honest outcome** (section 6, `RESULTS.md`): not served; why it failed; what would be tried
   next.
6. **Safety is guaranteed, not learned**: the mask, and the test that sweeps unsafe states.
