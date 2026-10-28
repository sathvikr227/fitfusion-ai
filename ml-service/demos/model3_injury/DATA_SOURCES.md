# Model 3 — data sources

Two public datasets with **real, observed injuries** are used. Neither contains FitFusion
user data. Raw files live in `ml-service/data/` (gitignored). Each folder has a `SOURCE.txt`
with the DOI, licence, access date and SHA-256 of every file, and the loaders refuse files
whose checksum differs.

Both were downloaded on **2026-10-28**, without a login.

---

## 1. Served model — competitive runners (Lövdal, den Hartigh & Azzopardi 2021)

| | |
|---|---|
| Title | Replication Data for: Injury Prediction In Competitive Runners With Machine Learning |
| Publisher | DataverseNL (University of Groningen). Authors: Sofie Lövdal, Ruud den Hartigh, George Azzopardi |
| URL | https://doi.org/10.34894/UWU9PV (dataset version 2, 2024) |
| Paper | Lövdal, Azzopardi & den Hartigh (2021), *Int J Sports Physiol Perform* 16(10):1522–1531 |
| Licence | **CC0-1.0** (public domain dedication) |
| Type | Real training logs and injury records of a Dutch high-level running team, 2012–2019 |
| File used | `day_approach_maskedID_timeseries.csv` (13.5 MB, SHA-256 `9c06ecefae9caa4ca831c08c7ebe4d25b0b01e8aa285df526a4e6791c673b6e8`) |
| Rows | 42,766 athlete-days · 74 athletes (27 women, 47 men) · 583 injury days (1.36%) · 63 athletes injured at least once |
| Columns | 10 variables × 7 days (70), plus `Athlete ID`, `injury`, `Date` |
| Label | `injury` = 1 if the athlete got injured on the event day. **No body part.** |
| Loader | `training/data_runners.py` |

**The 10 daily variables** (from the dataset README):
nr. sessions · total km · km in zones 3–4 · km in zone 5 / track intervals · km sprinting ·
strength training (yes/no) · hours of alternative (cross) training · perceived exertion ·
perceived training success · perceived recovery.

**Column order trap.** The suffix counts *up* towards the event: `total km.6` is the day before
the event and plain `total km` is seven days before (README v2 corrected the original paper).
The loader renames them to `total_km_d1` … `total_km_d7`, and a test checks `d1 == ".6"`.

**Cleaning.** None needed: no missing values, and injury days for the same athlete are at
least 22 days apart, so one injury is never counted twice. Rest days carry −0.01 in the
three perceived ratings (the authors' sentinel); it is left as is.

**What FitFusion can supply.** Four of the ten variables have the same meaning in FitFusion,
and only those four (the `APP` set) are used by the served model:

| Runners variable | FitFusion source |
|---|---|
| nr. sessions | 1 if any `workout_logs` row that day (duplicate rows collapsed) + each `cardio_logs` row; capped at 2 |
| total km | `cardio_logs.distance_km` for running, jogging and treadmill |
| strength training | 1 if that day's logged exercises include a strength exercise |
| hours alternative | `cardio_logs.duration_minutes / 60` for non-running cardio |

**Limitations**
- Competitive middle- and long-distance runners, not gym members. The deployed model
  applies their load-injury pattern to FitFusion users, which is a population shift.
- The label has no body part, so knee/back/shoulder/hamstring cannot be learned from it.
- FitFusion records no zones, sprinting or perceived ratings, so the served model uses 4 of
  the 10 variables. `RESULTS.md` reports what that costs (`FULL` vs `APP`).
- The authors' injury definition is in the paper, not the files.

---

## 2. Exploratory knee analysis — SoccerMon (not served)

| | |
|---|---|
| Title | SoccerMon: A Large-Scale Multivariate Soccer Athlete Health, Performance, and Position Monitoring Dataset |
| Publisher | Zenodo. Authors: Cise Midoglu, Matthias Boeker, Andreas Kjæreng Winther, Svein Arne Pettersen, Dag Johansen, Michael Riegler, Pål Halvorsen, Steven Hicks |
| URL | https://zenodo.org/records/10033832 (v1) |
| Paper | Midoglu et al. (2024), *Scientific Data* 11, doi:10.1038/s41597-024-03386-x |
| Licence | **CC BY 4.0** |
| Type | Real self-reports from two elite Norwegian women's football teams, 2020–2021 |
| File used | `subjective.zip` only (706 kB). The four GPS archives (about 99 GB) are not needed. |
| Contents | `injury/injury.csv` (162 reports, 306 location entries, each `{"right_knee": "minor"}`), daily wellness (soreness, fatigue, sleep duration and quality, readiness, stress, mood), daily training load (sRPE load, ACWR, ATL, CTL28, monotony, strain) for 50 players × 731 days |
| Loader | `training/data_soccermon.py` |

**Episodes.** Players re-report the same complaint daily, so rows are not injuries. An
episode starts at the first report of a region (left and right merged) after 14 or more days
without one:

| Region | Episodes | Players |
|---|---|---|
| thigh | 20 | 9 |
| knee | **10** | **5** |
| foot | 10 | 9 |
| leg | 8 | 4 |
| groin / hip | 7 | 3 |
| stomach / back | 7 | 2 |
| head / neck | 2 | 2 |
| shoulder | **0** | **0** |

**Why it can't train the four-label model.** Only 15 of the 50 players ever report an injury,
and 151 of the 162 reports come from one team. There is no shoulder location at all, "thigh"
does not separate hamstring from quadriceps, and back has 2 players. A knee classifier is
trained for exploration only (`RESULTS.md`, Part B).

---

## 3. Retired — Gym Members proxy labels

The previous Model 3 trained on `valakhorasani/gym-members-exercise-dataset` (Kaggle, 973 rows)
with labels created by if-rules over its own inputs (e.g. knee = resting BPM > 68 AND frequency
≥ 4). Its F1 of 1.0 is the model re-learning those rules: it never saw an injury.
`training/train_injury.py` and `models/reports/injury_risk.json` are kept only as the record
of that design. Nothing loads its artifact any more.
