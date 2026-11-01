"""Verified resolution candidates: deterministic, ATC-sourced only.

Every candidate copies values from the original ATC clearance — altitudes,
fixes, triggers, and times are restored, never invented. Each candidate is
verified by re-running FMS programming, comparison, and prediction.
"""

from __future__ import annotations

from ..models import (
    Clearance,
    ClearanceAction,
    ComparisonMatrix,
    Finding,
    FMSProgram,
    ResolutionCandidate,
    ScenarioGeometry,
    VerificationResult,
)
from . import comparison as comparison_service
from . import conflict as conflict_service
from . import fms as fms_service
from . import safety as safety_service


def _atc_action_for(atc: Clearance, action_type: str, index: int) -> ClearanceAction | None:
    matches = [a for a in atc.actions if a.action_type == action_type]
    if index < len(matches):
        return matches[index]
    return None


def _candidate_id(category: str, action: str, index: int) -> str:
    slug = category.lower().replace("_", "-")
    return f"{slug}-{action.lower()}-{index}"


def _human_text(category: str, atc_action: ClearanceAction | None, detail: str) -> str:
    if atc_action is None:
        return f"Remove extra readback item ({detail})."
    bits = [atc_action.action_type]
    if atc_action.target_fix:
        bits.append(atc_action.target_fix)
    if atc_action.numeric_value is not None:
        bits.append(f"{atc_action.numeric_value} {atc_action.unit}")
    if atc_action.trigger_type != "IMMEDIATE" and atc_action.trigger_value:
        readable = atc_action.trigger_type.replace("_", " ").title()
        bits.append(f"{readable} {atc_action.trigger_value}")
    return f"Restore ATC {' '.join(bits)} ({category})."


def _apply(
    pilot: Clearance, finding: Finding, atc: Clearance, atc_action: ClearanceAction | None
) -> Clearance:
    """Return a pilot clearance copy with one finding corrected from ATC."""
    data = pilot.model_dump()
    if finding.category == "CALLSIGN_MISMATCH":
        data["callsign"] = atc.callsign
        data["callsign_confidence"] = max(data["callsign_confidence"], 0.9)
        return Clearance.model_validate(data)
    actions = data["actions"]
    positions = [i for i, a in enumerate(actions) if a["action_type"] == finding.action]
    if finding.category == "EXTRA_ACTION":
        if positions:
            actions.pop(positions[0])
    elif finding.category == "MISSING_ACTION":
        if atc_action is not None:
            actions.append(atc_action.model_dump())
    elif positions and atc_action is not None:
        slot = actions[positions[0]]
        if finding.category == "CHANGED_VALUE":
            slot["numeric_value"] = atc_action.numeric_value
            slot["unit"] = atc_action.unit
        elif finding.category == "CHANGED_WAYPOINT":
            slot["target_fix"] = atc_action.target_fix
        elif finding.category in ("MISSING_CONDITION", "CHANGED_CONDITION", "INCORRECT_EXECUTION_TIME"):
            slot["trigger_type"] = atc_action.trigger_type
            slot["trigger_value"] = atc_action.trigger_value
        slot["confidence"] = max(slot["confidence"], 0.9)
    data["overall_confidence"] = min(
        [data["callsign_confidence"]] + [a["confidence"] for a in actions] or [0.5]
    )
    return Clearance.model_validate(data)


def _atc_evidence(atc: Clearance, action_type: str) -> str | None:
    if action_type == "CALLSIGN":
        return atc.callsign_evidence
    match = next((a for a in atc.actions if a.action_type == action_type), None)
    return match.evidence if match else None


def enumerate_candidates(
    atc: Clearance,
    pilot: Clearance,
    matrix: ComparisonMatrix,
    geometry: ScenarioGeometry,
) -> list[ResolutionCandidate]:
    candidates: list[ResolutionCandidate] = []
    seen: set[str] = set()
    for position, finding in enumerate(matrix.findings):
        if finding.scope != "atc_vs_pilot" and finding.category != "PARTIAL_FMS_LOAD":
            continue
        key = (finding.category, finding.action)
        if key in seen:
            continue
        seen.add(key)
        atc_action = _atc_action_for(atc, finding.action, 0)
        fixed_pilot = _apply(pilot, finding, atc, atc_action)
        fixed_fms = fms_service.program_from_intent(fixed_pilot, source="pilot")
        fixed_matrix = comparison_service.build_matrix(atc, fixed_pilot, fixed_fms)
        prediction = conflict_service.predict(fixed_fms, geometry)
        verified = fixed_matrix.overall == "agree" and not prediction.conflict
        if prediction.conflict:
            lateral = prediction.lateral_nm_at_conflict or 0.0
            vertical = prediction.vertical_ft_at_conflict or 0.0
        else:
            joint = safety_service.profile_minima(fixed_fms, geometry)
            lateral, vertical = joint.min_lateral_nm, joint.vertical_at_min_lateral_ft
        if verified:
            reason = (
                f"Restored ATC value removes the divergence; at closest lateral approach "
                f"({lateral} NM) vertical separation is {vertical:,.0f} ft with no conflict."
            )
        else:
            reason = (
                f"Applied ATC value but {fixed_matrix.overall} remains "
                f"(further findings open); conflict={prediction.conflict}."
            )
        candidates.append(
            ResolutionCandidate(
                id=_candidate_id(finding.category, finding.action, position),
                action_human=_human_text(finding.category, atc_action, finding.detail),
                source_evidence=_atc_evidence(atc, finding.action),
                conflict_after=prediction.conflict,
                min_lateral_nm=lateral,
                min_vertical_ft=vertical,
                verification="VERIFIED" if verified else "NOT_RESOLVED",
                safe_reason=reason,
            )
        )
    return candidates


def apply_candidate(
    pilot: Clearance, candidate_id: str, atc: Clearance, matrix: ComparisonMatrix
) -> Clearance:
    for position, finding in enumerate(matrix.findings):
        if _candidate_id(finding.category, finding.action, position) == candidate_id:
            return _apply(pilot, finding, atc, _atc_action_for(atc, finding.action, 0))
    raise ValueError(f"Unknown candidate '{candidate_id}'.")


def verify_candidate(
    candidate_id: str,
    atc: Clearance,
    pilot: Clearance,
    matrix: ComparisonMatrix,
    geometry: ScenarioGeometry,
) -> VerificationResult:
    fixed_pilot = apply_candidate(pilot, candidate_id, atc, matrix)
    fixed_fms = fms_service.program_from_intent(fixed_pilot, source="pilot")
    fixed_matrix = comparison_service.build_matrix(atc, fixed_pilot, fixed_fms)
    prediction = conflict_service.predict(fixed_fms, geometry)
    verified = fixed_matrix.overall == "agree" and not prediction.conflict
    if prediction.conflict:
        lateral = prediction.lateral_nm_at_conflict or 0.0
        vertical = prediction.vertical_ft_at_conflict or 0.0
    else:
        joint = safety_service.profile_minima(fixed_fms, geometry)
        lateral, vertical = joint.min_lateral_nm, joint.vertical_at_min_lateral_ft
    return VerificationResult(
        candidate_id=candidate_id,
        verified=verified,
        matrix_overall=fixed_matrix.overall,
        conflict_after=prediction.conflict,
        min_lateral_nm=lateral,
        min_vertical_ft=vertical,
        reason=f"Recomputed comparison is {fixed_matrix.overall}; conflict={prediction.conflict}.",
    )
