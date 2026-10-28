# Model 4 — data sources

One public dataset of **real, chronological training logs** is used. It contains no FitFusion
user data. Raw files live in `ml-service/data/strava_runners/` (gitignored), with a `SOURCE.txt`
recording the DOI, licence, access date and checksums. The loader refuses files whose MD5
differs from Figshare's published value.

Downloaded on **2026-10-28**, without a login.

---

## Strava running logs (Afonseca, Watanabe & Duarte 2022)

| | |
|---|---|
| Title | A public dataset on long-distance running training in 2019 and 2020 |
| Publisher | Figshare. Authors: Leonardo dos Santos Afonseca, Renato Naville Watanabe, Marcos Duarte (BMClab, Federal University of ABC, Brazil) |
| URL / DOI | https://doi.org/10.6084/m9.figshare.16620238 (version 5, 2022-07-03) |
| Paper | Afonseca, Watanabe & Duarte (2022), *PeerJ* 10:e13192 (open access, PMC8958962) |
| Licence | **CC BY 4.0** (from the Figshare record, saved as `_metadata.json`) |
| Collection | Public Strava activities of runners who had completed a World Marathon Major by 2019, gathered by the authors. Anonymised integer athlete IDs; the university's ethics committee exempted the study. |
| Files used | `run_ww_2019_d.parquet` (154.7 MB), `run_ww_2020_d.parquet` (154.1 MB): one row per athlete per day, 0 km on rest days |
| Columns | datetime, athlete, distance (km), duration (min), gender, age_group, country, major |
| Loader | `training/data_strava.py` |

**Funnel** (printed by `python -m training.data_strava` and stored in the report):

| Step | Count |
|---|---|
| athlete-days, 2019 + 2020 | 26,617,172 |
| days with a run | 9,259,153 (36,412 athletes) |
| kept after cleaning (1–60 km, 3–15 min/km) | 9,186,630 (36,397 athletes) |
| 8-session windows (stride 8) | 1,127,942 |
| **windows whose 8 sessions fall within 56 days** | **1,091,424 (34,753 athletes)** |
| train / validation / test (by athlete) | 763,342 / 164,174 / 163,908 windows; 24,327 / 5,212 / 5,214 athletes |

The paper counts 10.7M *activities*; the daily file sums same-day runs into one day, which is
why there are fewer run-days.

**Performance measure.** Each run-day is converted to an equivalent 10 km pace with Riegel's
published formula (T₁₀ = T × (10/D)^1.06), so a slow long run and a fast short run are compared
fairly. The label compares the median of sessions 5–8 with sessions 1–4. The thresholds
(−2.23% / +2.11%) are the training athletes' tertiles.

**What FitFusion can supply.** Running `cardio_logs` rows (activity matching run/jog/treadmill,
with `distance_km` and `duration_minutes`), summed per day, give the same five session features:
distance, duration, 10 km-equivalent pace, days since the previous run, and weekday.

**Limitations**
- The athletes are marathon runners, far fitter and more consistent than a typical FitFusion
  member.
- Strava pace reflects terrain, weather and effort choice, not only fitness. That noise is real
  and limits any model.
- Self-reported, public activities only. 2020 includes COVID-19 lockdowns.
- **The slides' inputs (completion rate, workout type) do not exist in running logs.** The model
  therefore applies only to FitFusion users' running sessions; everyone else gets the
  completion-slope rule, labelled as such.

---

## Not used

- **FitFusion's Supabase history.** 40 of 43 users' logs sit within the same three weeks, some
  bulk-created in one instant. The owner confirmed on 2026-10-28 that it is seeded/test data, so
  it is never presented as pilot data.
- **Endomondo / FitRec** (UCSD). Academic-use-only licence and several GB; considered and not
  chosen.
- **Gym Members** pseudo-sequences (the old model). Cross-sectional, so it has no real sequences.
  Retired.
