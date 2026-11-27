"""Route demand forecasting on SYNTHETIC data (ADR 002).

There is no real Indian Railways booking data in this project. The generator below
produces a daily demand index per route (synthetic units) with weekly seasonality,
approximate festival and holiday windows, a gentle trend and noise. Every artefact
and API response produced from it is labelled synthetic.

Forecast horizon: 28 to 120 days ahead (how far ahead people plan train trips).
Leakage rule: a feature for day t only uses values from day t-28 or earlier, so a
model evaluated at a cutoff never sees anything on or after the cutoff.
"""

from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass
from datetime import date, timedelta

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import Ridge

MIN_LAG = 28
ROUTES = [
    ("MAS", "SBC", 100), ("NDLS", "BSB", 130), ("CSMT", "ADI", 110),
    ("HWH", "PNBE", 125), ("SBC", "ERS", 95), ("NDLS", "JP", 90),
]

# Approximate windows used only to shape synthetic demand. Not authoritative dates.
FESTIVALS = {
    "diwali": [date(2024, 11, 1), date(2025, 10, 20), date(2026, 11, 8)],
    "holi": [date(2024, 3, 25), date(2025, 3, 14), date(2026, 3, 4)],
    "pongal": [date(2024, 1, 14), date(2025, 1, 14), date(2026, 1, 14)],
}
FESTIVAL_BOOST = {"diwali": 0.55, "holi": 0.30, "pongal": 0.25}
WEEKLY = [0.92, 0.88, 0.90, 0.97, 1.18, 1.12, 1.03]  # Monday..Sunday


def generate(start: date = date(2024, 1, 1), end: date = date(2026, 10, 31), seed: int = 7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    days = pd.date_range(start, end, freq="D")
    rows = []
    for origin, dest, base in ROUTES:
        route = f"{origin}-{dest}"
        for i, d in enumerate(days):
            dd = d.date()
            v = base * WEEKLY[dd.weekday()] * (1 + 0.04 * i / 365)
            if dd.month in (5, 6):  # summer vacation
                v *= 1.18
            for fest, dates in FESTIVALS.items():
                for f in dates:
                    gap = (dd - f).days
                    if -7 <= gap <= 3:  # travel peaks in the days before a festival
                        v *= 1 + FESTIVAL_BOOST[fest] * math.exp(-abs(gap + 2) / 3)
            v *= rng.lognormal(0, 0.06)
            rows.append({"date": d, "route": route, "demand": round(v, 2)})
    return pd.DataFrame(rows)


def _festival_features(d: pd.Series) -> pd.DataFrame:
    out = {}
    all_dates = [f for dates in FESTIVALS.values() for f in dates]
    stamps = pd.to_datetime(pd.Series(all_dates))
    gaps = np.stack([(d - s).dt.days.to_numpy() for s in stamps], axis=1)
    nearest_before = np.where(gaps <= 0, -gaps, 999).min(axis=1)  # days until next festival
    out["days_to_festival"] = np.minimum(nearest_before, 60)
    out["festival_window"] = ((gaps >= -7) & (gaps <= 3)).any(axis=1).astype(int)
    return pd.DataFrame(out, index=d.index)


def features(df: pd.DataFrame) -> pd.DataFrame:
    """Leak-free features: calendar facts known in advance + lags of at least MIN_LAG days."""
    df = df.sort_values(["route", "date"]).copy()
    g = df.groupby("route")["demand"]
    df["lag_28"] = g.shift(MIN_LAG)
    df["lag_35"] = g.shift(MIN_LAG + 7)
    df["lag_364"] = g.shift(364)
    df["roll_28_56"] = g.transform(lambda s: s.shift(MIN_LAG).rolling(28, min_periods=14).mean())
    df["dow"] = df["date"].dt.weekday
    df["month"] = df["date"].dt.month
    doy = df["date"].dt.dayofyear
    df["doy_sin"], df["doy_cos"] = np.sin(2 * np.pi * doy / 365.25), np.cos(2 * np.pi * doy / 365.25)
    df = pd.concat([df, _festival_features(df["date"])], axis=1)
    return df


FEATURES = ["lag_28", "lag_35", "lag_364", "roll_28_56", "dow", "month", "doy_sin", "doy_cos",
            "days_to_festival", "festival_window"]


def _design(df: pd.DataFrame, routes: list[str]) -> pd.DataFrame:
    x = df[FEATURES].copy()
    for r in routes:
        x[f"route_{r}"] = (df["route"] == r).astype(int)
    for k in range(7):
        x[f"dow_{k}"] = (df["dow"] == k).astype(int)
    return x


def metrics(y: np.ndarray, pred: np.ndarray, naive_scale: float) -> dict:
    err = y - pred
    return {
        "mae": float(np.mean(np.abs(err))),
        "rmse": float(np.sqrt(np.mean(err**2))),
        "mase": float(np.mean(np.abs(err)) / naive_scale) if naive_scale else math.nan,
    }


@dataclass
class FoldResult:
    cutoff: str
    model: str
    mae: float
    rmse: float
    mase: float


def rolling_origin_evaluation(df: pd.DataFrame, cutoffs: list[date], horizon: int = 28) -> list[FoldResult]:
    feats = features(df).dropna(subset=["lag_364", "roll_28_56"])
    routes = sorted(df["route"].unique())
    results = []
    for c in cutoffs:
        cut = pd.Timestamp(c)
        train = feats[feats["date"] < cut]
        test = feats[(feats["date"] >= cut) & (feats["date"] < cut + pd.Timedelta(days=horizon))]
        scale = float(np.mean(np.abs(train["demand"] - train["lag_28"])))  # in-sample naive MAE
        y = test["demand"].to_numpy()
        preds = {
            "seasonal_naive": test["lag_28"].to_numpy(),
            "ridge": Ridge(alpha=1.0).fit(_design(train, routes), train["demand"]).predict(_design(test, routes)),
            "hist_gradient_boosting": HistGradientBoostingRegressor(random_state=0, max_iter=300)
            .fit(_design(train, routes), train["demand"]).predict(_design(test, routes)),
        }
        for name, p in preds.items():
            m = metrics(y, p, scale)
            results.append(FoldResult(c.isoformat(), name, round(m["mae"], 3), round(m["rmse"], 3), round(m["mase"], 3)))
    return results


@dataclass
class TrainedModel:
    point: HistGradientBoostingRegressor
    low: HistGradientBoostingRegressor
    high: HistGradientBoostingRegressor
    routes: list[str]
    history: pd.DataFrame
    card: dict


def train(df: pd.DataFrame, cutoffs: list[date] | None = None) -> TrainedModel:
    cutoffs = cutoffs or [date(2026, 5, 1), date(2026, 7, 1), date(2026, 9, 1)]
    evaluation = rolling_origin_evaluation(df, cutoffs)
    feats = features(df).dropna(subset=["lag_364", "roll_28_56"])
    routes = sorted(df["route"].unique())
    x, y = _design(feats, routes), feats["demand"]
    point = HistGradientBoostingRegressor(random_state=0, max_iter=300).fit(x, y)
    low = HistGradientBoostingRegressor(loss="quantile", quantile=0.1, random_state=0, max_iter=300).fit(x, y)
    high = HistGradientBoostingRegressor(loss="quantile", quantile=0.9, random_state=0, max_iter=300).fit(x, y)
    summary = pd.DataFrame([asdict(r) for r in evaluation]).groupby("model")[["mae", "rmse", "mase"]].mean().round(3)
    card = {
        "name": "payani-route-demand",
        "version": "1.0.0",
        "synthetic": True,
        "data": "Synthetic demand index generated by payani.domain.forecasting.generate (seed 7). "
                "Not real railway booking data.",
        "target": "Daily demand index per route (synthetic units; level is relative to the route's median over the last year)",
        "training_window": [str(df["date"].min().date()), str(df["date"].max().date())],
        "features": FEATURES + ["route one-hot", "weekday one-hot"],
        "leakage_rule": f"Every feature uses data from at least {MIN_LAG} days before the target day.",
        "evaluation": {"method": "rolling-origin, 28-day horizon", "cutoffs": [c.isoformat() for c in cutoffs],
                       "mean_by_model": summary.to_dict(orient="index")},
        "interval": "80% prediction interval from quantile models (10th and 90th percentiles)",
        "limitations": [
            "Trained on synthetic data; predictions describe the generator, not real travel demand.",
            "Festival windows are approximate and hand-entered.",
        ],
    }
    return TrainedModel(point, low, high, routes, df, card)


def forecast(model: TrainedModel, route: str, target: date) -> dict:
    """Predict demand for `route` on `target`, at least MIN_LAG days after the history ends."""
    if route not in model.routes:
        raise KeyError(f"No forecast model for route {route}")
    last = model.history["date"].max().date()
    if (target - last).days > 120:
        raise ValueError("Forecasts are available up to 120 days after the data ends.")
    hist = model.history[model.history["route"] == route][["date", "route", "demand"]]
    # Extend with unknown future rows; lags >= 28 days keep them from feeding back in
    # for targets up to 28 days out. Beyond that, fill with the seasonal pattern.
    filled = hist.copy()
    d = last + timedelta(days=1)
    while d <= target:
        same_dow_last_year = filled.loc[filled["date"] == pd.Timestamp(d - timedelta(days=364)), "demand"]
        filled = pd.concat([filled, pd.DataFrame([{
            "date": pd.Timestamp(d), "route": route,
            "demand": float(same_dow_last_year.iloc[0]) if len(same_dow_last_year) else float(hist["demand"].tail(28).mean()),
        }])], ignore_index=True)
        d += timedelta(days=1)
    row = features(filled)
    row = row[row["date"] == pd.Timestamp(target)]
    x = _design(row, model.routes)
    p, lo, hi = (float(m.predict(x)[0]) for m in (model.point, model.low, model.high))
    lo, hi = min(lo, p), max(hi, p)
    typical = float(hist["demand"].tail(365).median())  # this route's usual level
    return {
        "route": route, "date": target.isoformat(),
        "demand_index": round(p, 1), "interval_80": [round(lo, 1), round(hi, 1)],
        "typical": round(typical, 1),
        "level": "high" if p >= 1.15 * typical else "low" if p <= 0.9 * typical else "normal",
        "data": {"confidence": "simulated", "synthetic": True, "model": model.card["name"],
                 "model_version": model.card["version"]},
    }


def write_card(model: TrainedModel, path: str) -> None:
    with open(path, "w") as f:
        json.dump(model.card, f, indent=2, default=str)
