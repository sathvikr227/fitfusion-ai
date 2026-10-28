"""Model 4 — Transformer running-trajectory predictor on Strava logs.

Implements demos/model4_trajectory/PROTOCOL.md exactly (committed before training):

  * athletes split 70/15/15 (seed 42); test scored once at the end;
  * labels from Riegel-equivalent 10 km pace, tertiles of training athletes;
  * Transformer (2 layers, 4 heads, d_model 32), best epoch by validation macro-F1;
  * baselines: majority, last-delta rule, logistic regression, HistGradientBoosting;
  * athlete-cluster bootstrap CIs; serving rule fixed in advance.

    .venv/Scripts/python.exe -u -m training.train_trajectory_runs

Writes models/trajectory_runs.pt + trajectory_runs_meta.json,
models/reports/trajectory_runs.json and figures.
"""

from __future__ import annotations

import json
import time

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import torch  # noqa: E402
import torch.nn as nn  # noqa: E402
from sklearn.ensemble import HistGradientBoostingClassifier  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402
from sklearn.metrics import confusion_matrix  # noqa: E402
from sklearn.preprocessing import StandardScaler  # noqa: E402

from app.trajectory_runs import CLASSES, SESSION_FEATURES, RunTransformer  # noqa: E402
from training.common import MODEL_DIR, RANDOM_SEED, REPORT_DIR, banner, ensure_dirs, write_report  # noqa: E402
from training.data_strava import FILES, build_windows, label, load_runs, verify  # noqa: E402

ARTIFACT = "trajectory_runs.pt"
META = "trajectory_runs_meta.json"
MODEL_VERSION = "trajectory-runs-transformer-v1"
EPOCHS, BATCH, LR = 20, 512, 1e-3
EXTRA_SEEDS = [0, 1, 2]
BOOTSTRAP_RESAMPLES = 1000


def split_athletes(athletes: np.ndarray) -> dict[str, np.ndarray]:
    unique = np.unique(athletes)
    rng = np.random.default_rng(RANDOM_SEED)
    rng.shuffle(unique)
    n_train, n_val = int(0.70 * len(unique)), int(0.15 * len(unique))
    groups = {"train": unique[:n_train], "val": unique[n_train:n_train + n_val], "test": unique[n_train + n_val:]}
    return {name: np.isin(athletes, ids) for name, ids in groups.items()}


def macro_f1_from_cm(cm: np.ndarray) -> float:
    tp = np.diag(cm).astype(float)
    precision = tp / np.clip(cm.sum(axis=0), 1, None)
    recall = tp / np.clip(cm.sum(axis=1), 1, None)
    f1 = 2 * precision * recall / np.clip(precision + recall, 1e-12, None)
    return float(f1.mean())


def summary(y: np.ndarray, pred: np.ndarray) -> dict:
    cm = confusion_matrix(y, pred, labels=[0, 1, 2])
    tp = np.diag(cm)
    return {
        "accuracy": round(float(tp.sum() / cm.sum()), 4),
        "macro_f1": round(macro_f1_from_cm(cm), 4),
        "per_class": {
            CLASSES[i]: {"precision": round(float(tp[i] / max(cm[:, i].sum(), 1)), 4),
                         "recall": round(float(tp[i] / max(cm[i].sum(), 1)), 4)}
            for i in range(3)
        },
        "confusion_matrix": cm.tolist(),
    }


def train_transformer(seed: int, data: dict, log_every: bool = True) -> tuple[RunTransformer, list[dict]]:
    torch.manual_seed(seed)
    np.random.seed(seed)
    model = RunTransformer()
    optimiser = torch.optim.Adam(model.parameters(), lr=LR)
    loss_fn = nn.CrossEntropyLoss()
    xtr, ytr = torch.from_numpy(data["xtr"]), torch.from_numpy(data["ytr"])
    xva = torch.from_numpy(data["xva"])
    best_state, best_f1, history = None, -1.0, []
    gen = torch.Generator().manual_seed(seed)
    for epoch in range(1, EPOCHS + 1):
        start = time.time()
        model.train()
        order = torch.randperm(len(xtr), generator=gen)
        total = 0.0
        for i in range(0, len(order), BATCH):
            idx = order[i:i + BATCH]
            optimiser.zero_grad()
            loss = loss_fn(model(xtr[idx]), ytr[idx])
            loss.backward()
            optimiser.step()
            total += loss.item() * len(idx)
        model.eval()
        with torch.no_grad():
            pred = torch.cat([model(xva[i:i + 8192]).argmax(1) for i in range(0, len(xva), 8192)]).numpy()
        val = summary(data["yva"], pred)
        history.append({"epoch": epoch, "train_loss": round(total / len(xtr), 4),
                        "val_accuracy": val["accuracy"], "val_macro_f1": val["macro_f1"]})
        if val["macro_f1"] > best_f1:
            best_f1 = val["macro_f1"]
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
        if log_every:
            print(f"    seed {seed} epoch {epoch:2d}  loss {total / len(xtr):.4f}  val acc {val['accuracy']:.4f}  "
                  f"macro-F1 {val['macro_f1']:.4f}  ({time.time() - start:.0f}s)", flush=True)
    model.load_state_dict(best_state)
    model.eval()
    return model, history


def predict(model: RunTransformer, x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    xt = torch.from_numpy(x)
    with torch.no_grad():
        probs = torch.cat([torch.softmax(model(xt[i:i + 8192]), 1) for i in range(0, len(xt), 8192)]).numpy()
    return probs.argmax(1), probs


def athlete_counts(athletes: np.ndarray, y: np.ndarray, pred: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Per-athlete 3x3 confusion counts, flattened to 9 columns."""
    ids, inverse = np.unique(athletes, return_inverse=True)
    counts = np.zeros((len(ids), 9))
    np.add.at(counts, (inverse, y * 3 + pred), 1)
    return ids, counts


def bootstrap(athletes, y, preds: dict[str, np.ndarray]) -> tuple[dict, dict]:
    rng = np.random.default_rng(RANDOM_SEED)
    ids = np.unique(athletes)
    weights = np.stack([np.bincount(rng.integers(0, len(ids), len(ids)), minlength=len(ids))
                        for _ in range(BOOTSTRAP_RESAMPLES)])
    acc_samples, cis = {}, {}
    for name, pred in preds.items():
        _, counts = athlete_counts(athletes, y, pred)
        cms = (weights @ counts).reshape(-1, 3, 3)
        acc = np.trace(cms, axis1=1, axis2=2) / cms.sum(axis=(1, 2))
        f1 = np.array([macro_f1_from_cm(cm) for cm in cms])
        acc_samples[name] = acc
        cis[name] = {"accuracy": [round(float(np.percentile(acc, 2.5)), 4), round(float(np.percentile(acc, 97.5)), 4)],
                     "macro_f1": [round(float(np.percentile(f1, 2.5)), 4), round(float(np.percentile(f1, 97.5)), 4)]}
    return cis, acc_samples


def draw(history: list[dict], cm: np.ndarray, test: dict, cis: dict) -> dict:
    fig, axes = plt.subplots(1, 3, figsize=(16, 4.6))
    epochs = [h["epoch"] for h in history]
    axes[0].plot(epochs, [h["train_loss"] for h in history], label="train loss")
    ax2 = axes[0].twinx()
    ax2.plot(epochs, [h["val_macro_f1"] for h in history], color="#dc2626", label="val macro-F1")
    axes[0].set(title="Transformer training (seed 42)", xlabel="epoch", ylabel="cross-entropy")
    ax2.set_ylabel("validation macro-F1")
    axes[1].imshow(cm, cmap="Blues")
    for (i, j), v in np.ndenumerate(cm):
        axes[1].text(j, i, f"{v:,}", ha="center", va="center", color="white" if v > cm.max() / 2 else "black")
    axes[1].set(xticks=range(3), yticks=range(3), xticklabels=CLASSES, yticklabels=CLASSES,
                xlabel="Predicted", ylabel="Actual", title="Transformer — test athletes")
    names = list(test)
    acc = [test[n]["accuracy"] for n in names]
    err = np.array([[a - cis[n]["accuracy"][0], cis[n]["accuracy"][1] - a] for n, a in zip(names, acc)]).T
    axes[2].bar(names, acc, yerr=err, capsize=4, color=["#7c3aed"] + ["#94a3b8"] * (len(names) - 1))
    axes[2].axhline(0.65, color="#dc2626", ls="--", lw=1, label="slide target 0.65")
    axes[2].set(title="Test accuracy with 95% CI", ylim=(0, 0.75))
    axes[2].tick_params(axis="x", rotation=20)
    axes[2].legend()
    fig.tight_layout()
    path = REPORT_DIR / "trajectory_runs.png"
    fig.savefig(path, dpi=130)
    plt.close(fig)
    return {"summary": path.name}


def main() -> None:
    banner("Model 4 — running trajectory Transformer (Strava logs)")
    ensure_dirs()
    verify()
    runs, funnel = load_runs()
    w = build_windows(runs)
    del runs
    masks = split_athletes(w["athlete"])
    tr, va, te = masks["train"], masks["val"], masks["test"]
    q1, q2 = (float(q) for q in np.quantile(w["change"][tr], [1 / 3, 2 / 3]))
    y = label(w["change"], q1, q2)
    funnel.update(windows=w["windows"], windows_before_span_filter=w["windows_before_span_filter"])
    split = {name: {"windows": int(m.sum()), "athletes": int(np.unique(w["athlete"][m]).size),
                    "class_counts": {CLASSES[c]: int((y[m] == c).sum()) for c in range(3)}}
             for name, m in masks.items()}
    print(f"[data] {funnel}")
    print(f"[labels] q1 {q1:+.4f}  q2 {q2:+.4f}  (change in 10 km-equivalent pace, training athletes)")
    for name, s in split.items():
        print(f"[split] {name}: {s}")

    mean = w["x"][tr].reshape(-1, len(SESSION_FEATURES)).mean(0)
    std = w["x"][tr].reshape(-1, len(SESSION_FEATURES)).std(0)
    norm = lambda x: ((x - mean) / np.where(std == 0, 1, std)).astype(np.float32)  # noqa: E731
    data = {"xtr": norm(w["x"][tr]), "ytr": y[tr], "xva": norm(w["x"][va]), "yva": y[va]}
    xte, yte = norm(w["x"][te]), y[te]

    banner("Transformer — seed 42")
    model, history = train_transformer(RANDOM_SEED, data)
    stability = {}
    for seed in EXTRA_SEEDS:
        print(f"[stability] training seed {seed}", flush=True)
        m, h = train_transformer(seed, data, log_every=False)
        stability[seed] = {"best_val_macro_f1": max(x["val_macro_f1"] for x in h),
                           "test_accuracy": summary(yte, predict(m, xte)[0])["accuracy"]}
        print(f"    seed {seed}: {stability[seed]}", flush=True)

    banner("Baselines")
    flat = lambda x: x.reshape(len(x), -1)  # noqa: E731
    majority = int(np.bincount(y[tr]).argmax())
    preds = {"Transformer": predict(model, xte)[0], "Majority": np.full(len(yte), majority)}
    preds["Last-delta rule"] = label(w["last_delta"][te], q1, q2)
    scaler = StandardScaler().fit(flat(data["xtr"]))
    logreg = LogisticRegression(max_iter=1000).fit(scaler.transform(flat(data["xtr"])), data["ytr"])
    preds["Logistic regression"] = logreg.predict(scaler.transform(flat(xte)))
    gbm = HistGradientBoostingClassifier(early_stopping=True, validation_fraction=0.1, random_state=RANDOM_SEED)
    gbm.fit(flat(data["xtr"]), data["ytr"])
    preds["Gradient boosting"] = gbm.predict(flat(xte))

    banner("Test athletes — scored once")
    test = {name: summary(yte, p) for name, p in preds.items()}
    cis, acc_samples = bootstrap(w["athlete"][te], yte, preds)
    for name in test:
        test[name]["ci95"] = cis[name]
        print(f"  {name:20s} acc {test[name]['accuracy']:.4f} {cis[name]['accuracy']}  "
              f"macro-F1 {test[name]['macro_f1']:.4f} {cis[name]['macro_f1']}")
    differences = {}
    for name in preds:
        if name == "Transformer":
            continue
        d = acc_samples["Transformer"] - acc_samples[name]
        differences[f"Transformer minus {name}"] = {
            "difference": round(test["Transformer"]["accuracy"] - test[name]["accuracy"], 4),
            "ci95": [round(float(np.percentile(d, 2.5)), 4), round(float(np.percentile(d, 97.5)), 4)]}
        print(f"  Transformer − {name:20s} Δacc {differences[f'Transformer minus {name}']}")

    serve = cis["Transformer"]["accuracy"][0] > test["Majority"]["accuracy"]
    better_baselines = [k.replace("Transformer minus ", "") for k, v in differences.items() if v["ci95"][1] < 0]
    decision = {
        "rule": "serve iff the lower bound of the transformer's test accuracy CI > majority-class accuracy",
        "transformer_accuracy_ci_low": cis["Transformer"]["accuracy"][0],
        "majority_accuracy": test["Majority"]["accuracy"],
        "serve": bool(serve),
        "baselines_significantly_better": better_baselines,
        "slide_target_accuracy_over_0_65_met": bool(test["Transformer"]["accuracy"] > 0.65),
    }
    print(f"\n[decision] {decision}")

    figures = draw(history, np.array(test["Transformer"]["confusion_matrix"]), test, cis)
    torch.save(model.state_dict(), MODEL_DIR / ARTIFACT)
    meta = {"model_version": MODEL_VERSION, "serve": bool(serve), "features": SESSION_FEATURES,
            "feature_mean": mean.tolist(), "feature_std": std.tolist(), "classes": CLASSES,
            "label_thresholds": {"q1": q1, "q2": q2}, "test_accuracy": test["Transformer"]["accuracy"],
            "test_accuracy_ci95": cis["Transformer"]["accuracy"]}
    (MODEL_DIR / META).write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"[artifact] wrote {MODEL_DIR / ARTIFACT} and {META}")

    write_report("trajectory_runs", {
        "artifact": [ARTIFACT, META], "model_version": MODEL_VERSION,
        "protocol": "demos/model4_trajectory/PROTOCOL.md (committed a2de032 before training)",
        "dataset": {"title": "A public dataset on long-distance running training in 2019 and 2020",
                    "doi": "10.6084/m9.figshare.16620238", "version": 5, "licence": "CC BY 4.0",
                    "files_md5": FILES, "funnel": funnel},
        "label": {"measure": "median Riegel 10 km-equivalent pace, sessions 5-8 vs 1-4",
                  "q1": q1, "q2": q2, "improve": "change < q1", "regress": "change > q2"},
        "split": split,
        "transformer": {"config": {"d_model": 32, "heads": 4, "layers": 2, "ff": 128, "dropout": 0.1,
                                   "epochs": EPOCHS, "batch": BATCH, "lr": LR, "seed": RANDOM_SEED},
                        "history": history, "stability_other_seeds": stability},
        "test": test, "accuracy_differences": differences, "decision": decision, "figures": figures,
    })


if __name__ == "__main__":
    main()
