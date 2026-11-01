"""Offline evaluation harness: fixed pairs, metrics, determinism signature."""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field

from .agents import atc_intent, pilot_intent
from .config import MODEL_API_URL_DEFAULT, VOICE_API_URL_DEFAULT, Settings
from .eval_data import PAIRS
from .models import Clearance
from .scenarios import SCENARIOS, run_scenario
from .services import comparison, fms

_ACTION_FIELDS = ("action_type", "target_fix", "numeric_value", "unit", "trigger_type", "trigger_value")

_OFFLINE = Settings(
    meta_api_key=None,
    meta_model_api_url=MODEL_API_URL_DEFAULT,
    meta_voice_api_url=VOICE_API_URL_DEFAULT,
)


@dataclass
class EvalReport:
    total_pairs: int = 0
    field_accuracy: float = 0.0
    mismatch_detection_rate: float = 0.0
    gate_rate: float = 0.0
    false_warnings: int = 0
    resolution_rate: float = 0.0
    resolved_scenarios: int = 0
    total_scenarios: int = 0
    eval_ms: float = 0.0
    signature: str = ""
    failures: list[str] = field(default_factory=list)


def _score_parse(parsed: Clearance, truth: tuple) -> tuple[int, int]:
    expected_callsign, expected_actions = truth
    correct = 1 if parsed.callsign == expected_callsign else 0
    total = 1
    for index, expected in enumerate(expected_actions):
        total += len(_ACTION_FIELDS)
        if index >= len(parsed.actions):
            continue
        actual = parsed.actions[index]
        for pos, field in enumerate(_ACTION_FIELDS):
            if getattr(actual, field) == expected[pos]:
                correct += 1
    total += max(0, len(parsed.actions) - len(expected_actions)) * len(_ACTION_FIELDS)
    return correct, total


def run_eval() -> EvalReport:
    started = time.perf_counter()
    report = EvalReport(total_pairs=len(PAIRS))
    correct = total = 0
    mismatch_expected = mismatch_found = 0
    verify_expected = verify_found = 0

    for pair in PAIRS:
        atc = atc_intent.parse_atc(pair["atc"], _OFFLINE, force_fixture=True)
        pilot = pilot_intent.parse_pilot(pair["pilot"], _OFFLINE, force_fixture=True)
        program = fms.program_from_intent(pilot, source="pilot")
        matrix = comparison.build_matrix(atc, pilot, program)

        for parsed, truth in ((atc, pair["atc_truth"]), (pilot, pair["pilot_truth"])):
            pair_correct, pair_total = _score_parse(parsed, truth)
            correct += pair_correct
            total += pair_total
            if pair_correct != pair_total:
                report.failures.append(f"{pair['id']}: extraction {pair_correct}/{pair_total}")

        expected_overall = pair["expected_overall"]
        expected_cats = set(pair["expected_categories"])
        found_cats = {f.category for f in matrix.findings}
        if expected_overall == "agree":
            if matrix.overall != "agree":
                report.false_warnings += 1
                report.failures.append(f"{pair['id']}: expected agree, got {matrix.overall}")
        elif expected_overall == "mismatch":
            mismatch_expected += 1
            if matrix.overall in ("mismatch", "verify_required"):
                mismatch_found += 1
            else:
                report.failures.append(f"{pair['id']}: expected mismatch, got {matrix.overall}")
        else:
            verify_expected += 1
            if matrix.overall == "verify_required":
                verify_found += 1
            else:
                report.failures.append(f"{pair['id']}: expected verify_required, got {matrix.overall}")
        if found_cats != expected_cats:
            report.failures.append(
                f"{pair['id']}: categories {sorted(found_cats)} != {sorted(expected_cats)}"
            )

    report.field_accuracy = round(correct / total, 4) if total else 0.0
    report.mismatch_detection_rate = round(mismatch_found / mismatch_expected, 4) if mismatch_expected else 0.0
    report.gate_rate = round(verify_found / verify_expected, 4) if verify_expected else 0.0

    resolved = 0
    for scenario in SCENARIOS.values():
        if run_scenario(scenario, _OFFLINE, use_live=False).resolved:
            resolved += 1
    report.resolved_scenarios = resolved
    report.total_scenarios = len(SCENARIOS)
    report.resolution_rate = round(resolved / len(SCENARIOS), 4)

    report.eval_ms = round((time.perf_counter() - started) * 1000, 1)
    canonical = json.dumps(
        {
            "accuracy": report.field_accuracy,
            "detection": report.mismatch_detection_rate,
            "gate": report.gate_rate,
            "false": report.false_warnings,
            "resolution": report.resolution_rate,
            "failures": sorted(report.failures),
        },
        sort_keys=True,
    )
    report.signature = hashlib.sha256(canonical.encode()).hexdigest()[:16]
    return report
