# Model 1 — data sources

Three public datasets are used. None contains FitFusion user data. Raw files live in
`ml-service/data/` (gitignored: download them with the links below).

Publisher pages re-checked on **2026-10-27**. Files were downloaded on 2026-09-09 (Gym Members)
and 2026-09-16 (Malaga, WEEE).

---

## 1. Training data — Malaga treadmill calorimetry (served model)

| | |
|---|---|
| Title | Treadmill Maximal Exercise Tests from the Exercise Physiology and Human Performance Lab of the University of Malaga |
| Publisher | PhysioNet. Authors: Denis Mongin, Jeronimo García Romero, José Ramón Alvero Cruz (published 10 Dec 2021) |
| URL | https://physionet.org/content/treadmill-exercise-cardioresp/1.0.1/ |
| DOI | 10.13026/7ezk-j442 (v1.0.1) |
| Licence | The `LICENSE.txt` in the v1.0.1 download (SHA-256 verified against `SHA256SUMS.txt`) is **Creative Commons Attribution-NonCommercial-ShareAlike 4.0**: non-commercial use with attribution, which covers a college project. When the web page was fetched on 2026-10-27, its summary showed "PhysioNet Contributor Review Health Data License 1.5.0". **Please confirm the licence shown on the page before the viva.** |
| Type | Real lab measurements: breath-by-breath gas analysis (VO2, VCO2) with heart rate during graded treadmill tests |
| Files | `subject-info.csv` (992 tests: Age, Weight, Height, Humidity, Temperature, Sex, ID, ID_test); `test_measure.csv` (575,087 rows: time, Speed, HR, VO2, VCO2, RR, VE, ID_test, ID) |
| Inputs used | age, sex, height (cm), weight (kg), heart rate (bpm) |
| Target | energy expenditure in kcal/min, from the **Weir equation** (3.941·VO2 + 1.106·VCO2, in L/min) |
| Loader | `training/data_malaga.py` |

**Cleaning funnel.** Every step is printed by `demo.py --samples` and saved to
`outputs/malaga_cleaning_funnel.json`.

| Step | Rows | Tests | People |
|---|---|---|---|
| raw breath-by-breath rows | 575,087 | 992 | 857 |
| HR 40–220 bpm, VO2 and VCO2 present | 569,128 | 981 | 846 |
| drop first 60 s (analyser settling) | 549,376 | 981 | 846 |
| exercise phase only (recovery walk removed) | 427,664 | 981 | 846 |
| sub-maximal only, RER ≤ 1.0 (Weir assumes aerobic steady state) | 279,822 | 980 | 845 |
| **60-second windows with ≥ 10 samples (training rows)** | **10,186** | 973 | **840** |

Sample of the cleaned rows: `outputs/sample_cleaned_malaga_training_windows.csv`.

**Limitations**
- About 85% of tests are from men, and most participants are trained athletes.
- Only ramp treadmill running and walking.
- Resting values are barely covered (5th percentile is 3.8 kcal/min).
- 116 people did more than one test, so cross-validation is grouped by person.

---

## 2. External test and calibration data — WEEE

| | |
|---|---|
| Title | WEEE, A Multi-Device and Multi-Modal Dataset for Wearable Human Energy Expenditure Estimation |
| Publisher | Zenodo. Authors: Shkurta Gashi, Chulhong Min, Alessandro Montanari, Silvia Santini, Fahim Kawsar (7 Apr 2022, v1) |
| URL | https://zenodo.org/records/6420886 |
| DOI | 10.5281/zenodo.6420886 |
| Licence | Creative Commons Attribution 4.0 International |
| Type | Real lab protocol: 17 adults performed sit, stand, cycle ×2 and run ×2, with a VO2 Master calorimeter and a Wahoo chest-strap heart-rate monitor |
| Files | `dataset.zip` (651.6 MB) containing `Demographics.csv` and per-participant folders `P01`…`P17` (`DataAverage.csv` per activity) |
| Target | kcal/min = VO2 × 5.0 kcal/L. The VO2 Master measures no VCO2, so Weir cannot be used; on Malaga this approximation differs from Weir by a median 2.7%. |
| Loader | `training/data_weee.py` |

**Use.** 40 exercise segments from 16 participants. 33 segments were excluded, each with a stated reason:
- 22 for VO2 coverage under 80%
- 6 because participant P14's data are unusable
- 4 for exercise heart rate below the participant's own sitting heart rate
- 1 for a researcher-noted event

The full list is in `models/reports/calorie_hr.json` under `test_data.excluded_segments`.
Sample: `outputs/sample_cleaned_weee_test_segments.csv`.

**Limitations.** It is small (16 people). The Run2 activity is almost entirely missing (1 segment).
The same data are used for both the external test and the leave-one-participant-out calibration
experiment. These are reported separately, and the calibration is never scored on the person it
was fitted on.

---

## 3. Comparison only — Gym Members Exercise Dataset (the slide design)

| | |
|---|---|
| Title | Gym Members Exercise Dataset |
| Publisher | Kaggle, owner "vala khorasani" (v1, "Initial release", updated 2024-10-06) |
| URL | https://www.kaggle.com/datasets/valakhorasani/gym-members-exercise-dataset |
| Licence | Apache 2.0 (from Kaggle's dataset metadata) |
| Type | **Not stated by the publisher.** The page says only "It contains 973 samples of gym data", with no collection method. |
| File | `gym_members_exercise_tracking.csv`: 973 rows × 15 columns |
| Slide inputs | Age, Weight (kg), BMI, Resting_BPM, Session_Duration (hours), Workout_Type |
| Target | `Calories_Burned` (kcal per session) |
| Script | `training/train_calorie_gym_comparison.py` |

**Quality checks** (all in `models/reports/calorie_gym_comparison.json`)
- No missing values and no duplicate rows. BMI matches weight/height² to within 0.005.
- **The labels fail a physiological check.** kcal per hour is 716–724 for every workout type,
  with yoga (716.5) equal to HIIT (716.5). Measured energy cost differs about 3× between them
  (MET 2.5 vs 8.0). Avg_BPM is about 144 for every type, yoga included.
- A linear model of the Keytel (2005) form, `(HR, weight, age, sex) × duration`, explains
  **R² = 0.991** of the labels. That is consistent with the labels being computed from a formula
  on Avg_BPM rather than measured. The slide feature set omits Avg_BPM and sex.

**Use.** A comparison model only; it is never served (see `RESULTS.md`).

---

## FitFusion data

Model 1 is not trained on any FitFusion user records. In the app it receives the logged session's
average heart rate and duration, plus the user's age, sex, height and weight from their profile.
