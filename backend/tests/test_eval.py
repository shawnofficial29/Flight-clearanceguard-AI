"""Evaluation harness tests: thresholds plus determinism (offline)."""

from app.eval import run_eval
from app.eval_data import PAIRS


def test_eval_pairs_cover_minimum():
    assert len(PAIRS) >= 30


def test_eval_meets_thresholds():
    report = run_eval()
    assert report.failures == []
    assert report.field_accuracy == 1.0
    assert report.mismatch_detection_rate == 1.0
    assert report.gate_rate == 1.0
    assert report.false_warnings == 0
    assert report.resolution_rate == 1.0
    assert report.eval_ms >= 0.0


def test_eval_is_deterministic():
    first = run_eval()
    second = run_eval()
    assert first.signature == second.signature
    assert first.failures == second.failures == []
