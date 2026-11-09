# Model 5 — PPO adaptive-replan agent (teacher demo)

**What it does.** Each week, the adaptive replan decides whether to make a user's plan harder
(INCREASE), keep it (MAINTAIN) or ease off (REDUCE). It decides from completion, sleep, the
injury flag, Model 4's trajectory and the training streak. Round 3 adds the plan's current
intensity and the previous action. Model 5 tests whether a reinforcement-learning agent (PPO)
makes that call better than the simple rule the app used. **All results are simulated.**

**Result**

- **Rounds 1–2:** PPO always pushed load until the simulated user quit (−23 vs −9 for the rule).
- **Round 3 found why.** It was a training-setup bug: week 26 was "truncated", so PPO valued a
  user who stays as an endless stream of slightly negative weeks, and quitting looked better.
  With that fixed, PPO learns a sensible policy:
  - it beats always-MAINTAIN, +0.12 [+0.05, +0.21] per user;
  - it beats the app's threshold rule, +0.38 [+0.26, +0.51];
  - it keeps 99.9% of users.
- **Served since 2026-11-09, as the owner's documented override.** The pre-registered rule said
  not served, because it has slightly more injuries per user than the rule (+0.014). A post-hoc
  check showed the cause: it keeps users the rule loses. Per week trained, its injury rate is the
  same. Both facts are recorded (`RESULTS.md`, `models/rl_ppo_meta.json`).
- **The gain is small, and a one-line rule matches it.** Whatever answers, a **hard safety mask**
  never allows INCREASE while injured or on < 5.5 h sleep.

| File | Contents |
|---|---|
| `PROTOCOL.md`, `PROTOCOL_ROUND2.md`, `PROTOCOL_ROUND3.md` | plans and serving rules, each committed before its results |
| `DATA_SOURCES.md` | what in the simulator is real (3 datasets) and what is assumed, including round 3's smooth injury curve |
| `RESULTS.md` | round 3 first (bug, validation, test, decision, post-hoc), then rounds 1–2 |
| `demo.py` | audit, calibration, the bug computed live, a decision for the sample state, one user coached by the round-1 agent, the round-3 agent and the rule, API call, evaluation |
| `sample_input.json` | labelled (illustrative) state |
| `outputs/demo_output.txt`, `outputs/demo_output.json` | the actual output of `demo.py` |
| `outputs/test_results.txt`, `outputs/training_log_round{1,2,3}.txt` | tests and training logs |

Figures: `models/reports/rl_calibration.png`, `rl_ppo.png`, `rl_ppo_round2.png`, and
**`rl_ppo_round3.png`**. The last shows training no longer collapsing, validation by checkpoint,
and test returns.

| Code | Role |
|---|---|
| `training/calibrate_rl_env.py` | estimate the real-data curves (`--smooth-only` adds round 3's injury fit) |
| `app/rl_env.py` | the simulator, `safe_action`, the threshold rule (shared by training, tests, API) |
| `training/train_rl_ppo.py`, `train_rl_ppo_round2.py`, `train_rl_ppo_round3.py` | train, evaluate, apply the serving rule |
| `app/routers/rl_action.py` | `POST /rl/action` (5 or 7 inputs, masked) |
| `tests/test_model5_rl.py` | mask, rule, simulator, round-3 options and wrappers, endpoint safety sweep, artifact |

## How to run (Windows, from `ml-service\`)

```powershell
.venv\Scripts\python.exe -u -m training.calibrate_rl_env                 # ~5 min, needs the Model 3/4 data
.venv\Scripts\python.exe -u -m training.calibrate_rl_env --smooth-only   # round 3's injury curve, seconds
.venv\Scripts\python.exe -u -m training.train_rl_ppo_round3              # ~1 h+, runs 3 trainings in parallel
.venv\Scripts\python.exe demos\model5_rl\demo.py
.venv\Scripts\python.exe -m pytest -q tests\test_model5_rl.py
```

Rounds 1 and 2 (`train_rl_ppo`, `train_rl_ppo_round2`) still reproduce: the round-3 options are
off by default.

## How to present it (about 6 minutes)

1. **The old agent was broken** (section 1). It was paid for raising completion, so it always cut
   the plan.
2. **A simulator grounded in real data** (section 2). The injury data shows only a slight
   load-spike effect, and round 3 uses a smooth fit so no agent can game noisy bins.
3. **Finding the bug** (section 3, computed live). A user who stays is worth −37.6 to PPO; one who
   quits costs −20. That is why rounds 1–2 failed, and it is an RL lesson in itself:
   time-limit truncation must be handled correctly.
4. **Watch it work** (section 5). On the same simulated user, the round-1 agent pushes until they
   quit in week 7. The round-3 agent coaches them for all 26 weeks, slightly better than the rule.
5. **Honest outcome** (section 7, `RESULTS.md`). It beats both baselines, but the pre-registered
   injury criterion said not served. The post-hoc check explains why, and the owner chose to serve
   it as a documented override. A one-line rule does as well.
6. **Safety is guaranteed, not learned.** The mask, and the test that sweeps unsafe states.
