"""Verification Explanation Agent: plain-language warning from tool results.

The model only explains deterministic comparison/conflict outputs; it never
edits the aircraft. Fallback template covers outages.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from ..config import Settings
from ..models import ComparisonMatrix, ConflictPrediction, Explanation
from ..services.model_client import JsonTransport, MetaAPIError, MetaModelClient, ModelNotConfiguredError

SYSTEM_PROMPT = (
    "You are the Verification Explanation Agent for ClearanceGuard AI. Explain the "
    "provided deterministic comparison and conflict results in short, plain "
    "aviation language. Use ONLY the supplied tool results and transcripts — never "
    "invent values. Output strict JSON only. The recommended action must be framed "
    "as a simulated pilot action ('Pilot confirms corrected FMS entry'), never as "
    "AI controlling the aircraft."
)


class ExplanationPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str
    cause: str
    evidence: list[str]
    recommended_action: str


def _fallback(comparison: ComparisonMatrix, conflict: ConflictPrediction) -> ExplanationPayload:
    if comparison.overall == "agree" and not conflict.conflict:
        return ExplanationPayload(
            summary="Clearance verified: readback, FMS, and predicted trajectory agree.",
            cause="All clearance fields match across ATC, pilot, FMS, and prediction.",
            evidence=["Integrity matrix shows match on every aspect."],
            recommended_action="No action required.",
        )
    if comparison.overall == "verify_required":
        return ExplanationPayload(
            summary="Verification required: a clearance field is below the confidence gate.",
            cause="One or more required fields parsed below 0.85 confidence.",
            evidence=[f.detail for f in comparison.findings] or ["Low-confidence parse."],
            recommended_action="Pilot confirms each clearance value by voice before FMS entry.",
        )
    categories = sorted({f.category for f in comparison.findings})
    mismatches = [r for r in comparison.rows if r.status == "mismatch"]
    aspects = ", ".join(r.aspect for r in mismatches) or "clearance"
    summary = f"Mismatch on {aspects} ({', '.join(categories) or 'unclassified'})."
    cause = (
        "; ".join(f.detail for f in comparison.findings[:2])
        or "The pilot readback diverges from the ATC clearance."
    )
    evidence = [f.detail for f in comparison.findings]
    if conflict.conflict and conflict.first_conflict_time_s is not None:
        t = conflict.first_conflict_time_s
        evidence.append(
            f"Predicted conflict at T+{t:,.0f}s: lateral "
            f"{conflict.lateral_nm_at_conflict:.1f} NM, vertical "
            f"{conflict.vertical_ft_at_conflict:,.0f} ft."
        )
    return ExplanationPayload(
        summary=summary,
        cause=cause,
        evidence=evidence or ["See integrity matrix rows."],
        recommended_action=(
            "Pilot confirms corrected FMS entry matching the ATC clearance."
        ),
    )


def explain(
    comparison: ComparisonMatrix,
    conflict: ConflictPrediction,
    settings: Settings,
    transport: JsonTransport | None = None,
    *,
    atc_text: str = "",
    pilot_text: str = "",
    force_fixture: bool = False,
) -> Explanation:
    if not force_fixture:
        user = (
            f"ATC transcript: {atc_text}\nPilot transcript: {pilot_text}\n"
            f"Comparison: {comparison.model_dump_json()}\n"
            f"Conflict: {conflict.model_dump_json()}"
        )
        try:
            payload = MetaModelClient(settings, transport).complete_json(
                system=SYSTEM_PROMPT,
                user=user,
                schema_name="explanation",
                payload_model=ExplanationPayload,
            )
            return Explanation(
                **payload.model_dump(), provenance="live_meta_api", model=settings.meta_model_name
            )
        except (ModelNotConfiguredError, MetaAPIError):
            pass
    payload = _fallback(comparison, conflict)
    return Explanation(
        **payload.model_dump(),
        provenance="fixture_fallback",
        model="deterministic-fallback",
    )
