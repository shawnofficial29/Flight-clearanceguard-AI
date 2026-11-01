"""Deterministic clearance comparison with categorized findings.

Aligns ATC actions with pilot actions and pilot actions with the FMS load,
emits one of nine finding categories per divergence, and enforces the
uncertainty gate: any required field below 0.85 confidence forces
VERIFY_REQUIRED instead of a silent confirmation.
"""

from __future__ import annotations

from ..models import (
    CONFIDENCE_GATE,
    ComparisonMatrix,
    Clearance,
    ClearanceAction,
    Finding,
    FindingCategory,
    FMSProgram,
    MatrixRow,
)

DASH = "—"
CONSISTENT = "CONSISTENT"


def _same(left: str | None, right: str | None) -> bool:
    return (left or "").strip().upper() == (right or "").strip().upper()


def _action_text(action: ClearanceAction) -> str:
    parts = [action.action_type]
    if action.target_fix:
        parts.append(action.target_fix)
    if action.numeric_value is not None:
        parts.append(f"{action.numeric_value} {action.unit}")
    if action.trigger_type != "IMMEDIATE":
        trigger = action.trigger_type.replace("_", " ").title()
        parts.append(f"{trigger} {action.trigger_value}" if action.trigger_value else trigger)
    return " ".join(parts)


def _align(
    base: list[ClearanceAction], other: list[ClearanceAction]
) -> tuple[list[tuple[int, int | None]], list[int]]:
    """Greedy in-order alignment by action type. Returns pairs + other extras."""
    pairs: list[tuple[int, int | None]] = []
    used: set[int] = set()
    for i, action in enumerate(base):
        match = next(
            (j for j, cand in enumerate(other) if j not in used and cand.action_type == action.action_type),
            None,
        )
        if match is not None:
            used.add(match)
        pairs.append((i, match))
    extras = [j for j in range(len(other)) if j not in used]
    return pairs, extras


def _trigger_phrase(trigger_type: str, trigger_value: str | None) -> str:
    if trigger_type == "AFTER_WAYPOINT":
        return f"after passing {trigger_value}"
    if trigger_type == "AT_WAYPOINT":
        return f"at {trigger_value}"
    if trigger_type == "AT_TIME":
        return f"at {trigger_value}"
    return "immediate"


def build_matrix(atc: Clearance, pilot: Clearance, fms: FMSProgram) -> ComparisonMatrix:
    findings: list[Finding] = []
    rows: list[MatrixRow] = []

    callsign_ok = _same(atc.callsign, pilot.callsign) and _same(atc.callsign, fms.callsign)
    if not callsign_ok:
        findings.append(
            Finding(
                category="CALLSIGN_MISMATCH",
                scope="atc_vs_pilot",
                action="CALLSIGN",
                detail=f"ATC '{atc.callsign}' vs pilot '{pilot.callsign}' vs FMS '{fms.callsign}'.",
            )
        )
    rows.append(
        MatrixRow(
            aspect="Callsign",
            atc=atc.callsign or DASH,
            pilot=pilot.callsign or DASH,
            fms=fms.callsign or DASH,
            predicted=fms.callsign or DASH,
            status="match" if callsign_ok else "mismatch",
            category=CONSISTENT if callsign_ok else "CALLSIGN_MISMATCH",
            note="All sources agree." if callsign_ok else "Callsign differs between sources.",
        )
    )

    pairs, extras = _align(atc.actions, pilot.actions)
    for i, j in pairs:
        atc_action = atc.actions[i]
        label = atc_action.action_type
        if j is None:
            findings.append(
                Finding(
                    category="MISSING_ACTION",
                    scope="atc_vs_pilot",
                    action=label,
                    detail=f"ATC {_action_text(atc_action)} absent from pilot readback.",
                )
            )
            rows.append(
                MatrixRow(
                    aspect=label,
                    atc=_action_text(atc_action),
                    pilot="Not stated",
                    fms="Not loaded",
                    predicted="Not executed",
                    status="mismatch",
                    category="MISSING_ACTION",
                    note="Pilot omitted this ATC action.",
                )
            )
            continue
        pilot_action = pilot.actions[j]
        row_findings = _compare_pair(atc_action, pilot_action, label, findings)
        held = pilot_action.confidence < CONFIDENCE_GATE
        if held:
            findings.append(
                Finding(
                    category="PARTIAL_FMS_LOAD",
                    scope="pilot_vs_fms",
                    action=label,
                    detail=f"{label} held below confidence gate ({pilot_action.confidence:.2f}).",
                )
            )
            row_findings.append("PARTIAL_FMS_LOAD")
        fms_text = "Held for verification" if held else _predicted_execution(pilot_action, fms)
        status = "mismatch" if row_findings else "match"
        rows.append(
            MatrixRow(
                aspect=label,
                atc=_action_text(atc_action),
                pilot=_action_text(pilot_action),
                fms=fms_text,
                predicted=_predicted_execution(pilot_action, fms) if not held else "Not executed",
                status=status,
                category=row_findings[0] if row_findings else CONSISTENT,
                note="Consistent across sources." if not row_findings else "; ".join(
                    _finding_note(c) for c in row_findings
                ),
            )
        )

    for j in extras:
        extra = pilot.actions[j]
        findings.append(
            Finding(
                category="EXTRA_ACTION",
                scope="atc_vs_pilot",
                action=extra.action_type,
                detail=f"Pilot {_action_text(extra)} not present in ATC clearance.",
            )
        )
        rows.append(
            MatrixRow(
                aspect=f"EXTRA {extra.action_type}",
                atc=DASH,
                pilot=_action_text(extra),
                fms=_predicted_execution(extra, fms),
                predicted=_predicted_execution(extra, fms),
                status="mismatch",
                category="EXTRA_ACTION",
                note="Pilot added an action ATC never issued.",
            )
        )

    confidences = [
        atc.callsign_confidence,
        pilot.callsign_confidence,
        atc.overall_confidence,
        pilot.overall_confidence,
    ]
    confidences += [a.confidence for a in atc.actions + pilot.actions]
    min_conf = min(confidences) if confidences else 0.0
    gate_tripped = min_conf < CONFIDENCE_GATE
    if gate_tripped:
        rows.append(
            MatrixRow(
                aspect="Confidence gate",
                atc=f"{atc.overall_confidence:.2f}",
                pilot=f"{pilot.overall_confidence:.2f}",
                fms=DASH,
                predicted="VERIFY_REQUIRED",
                status="info",
                category=CONSISTENT,
                note=f"Required field below {CONFIDENCE_GATE:.2f}; human verification required.",
            )
        )

    overall: str = "agree"
    if gate_tripped:
        overall = "verify_required"
    elif findings:
        overall = "mismatch"

    missing = next(
        (f for f in findings if f.category == "MISSING_CONDITION" and f.scope == "atc_vs_pilot"),
        None,
    )
    missing_phrase = None
    if missing:
        action = next(a for a in atc.actions if a.action_type == missing.action)
        missing_phrase = _trigger_phrase(action.trigger_type, action.trigger_value)

    return ComparisonMatrix(
        rows=rows,
        findings=findings,
        overall=overall,  # type: ignore[arg-type]
        min_confidence=round(min_conf, 2),
        missing_condition=missing is not None,
        missing_phrase=missing_phrase,
    )


def _compare_pair(
    atc_action: ClearanceAction,
    pilot_action: ClearanceAction,
    label: str,
    findings: list[Finding],
) -> list[str]:
    cats: list[str] = []
    if (atc_action.numeric_value, atc_action.unit) != (pilot_action.numeric_value, pilot_action.unit):
        findings.append(
            Finding(
                category="CHANGED_VALUE",
                scope="atc_vs_pilot",
                action=label,
                detail=f"{label} value {atc_action.numeric_value} {atc_action.unit} "
                f"vs {pilot_action.numeric_value} {pilot_action.unit}.",
            )
        )
        cats.append("CHANGED_VALUE")
    if not _same(atc_action.target_fix, pilot_action.target_fix):
        findings.append(
            Finding(
                category="CHANGED_WAYPOINT",
                scope="atc_vs_pilot",
                action=label,
                detail=f"{label} fix {atc_action.target_fix} vs {pilot_action.target_fix}.",
            )
        )
        cats.append("CHANGED_WAYPOINT")
    cats += _compare_triggers(atc_action, pilot_action, label, findings)
    return cats


def _compare_triggers(
    atc_action: ClearanceAction,
    pilot_action: ClearanceAction,
    label: str,
    findings: list[Finding],
) -> list[str]:
    atc_trig = (atc_action.trigger_type, (atc_action.trigger_value or "").upper())
    pilot_trig = (pilot_action.trigger_type, (pilot_action.trigger_value or "").upper())
    if atc_trig == pilot_trig:
        return []
    if atc_action.trigger_type != "IMMEDIATE" and pilot_action.trigger_type == "IMMEDIATE":
        findings.append(
            Finding(
                category="MISSING_CONDITION",
                scope="atc_vs_pilot",
                action=label,
                detail=f"{label} condition "
                f"{_trigger_phrase(atc_action.trigger_type, atc_action.trigger_value)} omitted.",
            )
        )
        return ["MISSING_CONDITION"]
    if atc_action.trigger_type == "AT_TIME" and pilot_action.trigger_type == "AT_TIME":
        findings.append(
            Finding(
                category="INCORRECT_EXECUTION_TIME",
                scope="atc_vs_pilot",
                action=label,
                detail=f"{label} execution time {atc_action.trigger_value} vs {pilot_action.trigger_value}.",
            )
        )
        return ["INCORRECT_EXECUTION_TIME"]
    findings.append(
        Finding(
            category="CHANGED_CONDITION",
            scope="atc_vs_pilot",
            action=label,
            detail=f"{label} condition "
            f"{_trigger_phrase(atc_action.trigger_type, atc_action.trigger_value)} vs "
            f"{_trigger_phrase(pilot_action.trigger_type, pilot_action.trigger_value)}.",
        )
    )
    return ["CHANGED_CONDITION"]


def _predicted_execution(action: ClearanceAction, fms: FMSProgram) -> str:
    if action.action_type in ("CLIMB", "DESCEND", "MAINTAIN") and fms.cleared_alt_ft:
        if fms.climb_start_fix:
            return f"Level, then change at {fms.climb_start_fix} to {fms.cleared_alt_ft:,} ft"
        return f"Immediate change to {fms.cleared_alt_ft:,} ft"
    if action.action_type == "DIRECT_TO":
        return " → ".join(fms.route) if fms.route else DASH
    label = next((line for line in fms.loaded if line.startswith(action.action_type)), None)
    return label or DASH


def _finding_note(category: str) -> str:
    return {
        "CHANGED_VALUE": "Value differs from ATC.",
        "CHANGED_WAYPOINT": "Waypoint differs from ATC.",
        "MISSING_CONDITION": "ATC condition omitted downstream.",
        "CHANGED_CONDITION": "Condition differs from ATC.",
        "INCORRECT_EXECUTION_TIME": "Execution time differs from ATC.",
        "PARTIAL_FMS_LOAD": "Held below confidence gate; not loaded.",
    }.get(category, category)
