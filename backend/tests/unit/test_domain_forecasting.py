from datetime import date

import numpy as np
import pandas as pd
import pytest

from payani.domain import forecasting as fc


@pytest.fixture(scope="module")
def data():
    return fc.generate()


def test_generator_is_deterministic(data):
    pd.testing.assert_frame_equal(data, fc.generate())


def test_features_do_not_leak_future_values(data):
    cutoff = pd.Timestamp("2026-07-01")
    before = fc.features(data)
    tampered = data.copy()
    tampered.loc[tampered["date"] >= cutoff, "demand"] *= 50
    after = fc.features(tampered)
    window = (before["date"] >= cutoff) & (before["date"] < cutoff + pd.Timedelta(days=fc.MIN_LAG))
    cols = ["lag_28", "lag_35", "lag_364", "roll_28_56"]
    pd.testing.assert_frame_equal(before.loc[window, cols], after.loc[window, cols])


@pytest.fixture(scope="module")
def evaluation(data):
    return pd.DataFrame([r.__dict__ for r in fc.rolling_origin_evaluation(
        data, [date(2026, 5, 1), date(2026, 7, 1), date(2026, 9, 1)])])


def test_learned_models_beat_seasonal_naive(evaluation):
    mean = evaluation.groupby("model")["mae"].mean()
    assert mean["hist_gradient_boosting"] < mean["seasonal_naive"]
    assert mean["ridge"] < mean["seasonal_naive"]


def test_metrics_are_finite(evaluation):
    assert np.isfinite(evaluation[["mae", "rmse", "mase"]].to_numpy()).all()


def test_forecast_is_labelled_synthetic_with_interval(data):
    model = fc.train(data)
    assert model.card["synthetic"] is True
    out = fc.forecast(model, "MAS-SBC", date(2026, 11, 20))
    lo, hi = out["interval_80"]
    assert lo <= out["demand_index"] <= hi
    assert out["data"]["confidence"] == "simulated" and out["data"]["synthetic"] is True
    with pytest.raises(ValueError):
        fc.forecast(model, "MAS-SBC", date(2027, 6, 1))
    with pytest.raises(KeyError):
        fc.forecast(model, "XXX-YYY", date(2026, 11, 20))
