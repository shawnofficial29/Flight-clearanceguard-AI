"""Pydantic data models: generalized clearance schema, FMS, comparison, conflict."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Provenance = Literal["live_meta_api", "live_muse_voice", "fixture_fallback"]

BADGE_LABELS: dict[str, str] = {
    "live_meta_api": "Live Meta API",
    "live_muse_voice": "Live Muse Voice",
    "fixture_fallback": "Fixture fallback",
}

ActionType = Literal["DIRECT_TO", "CLIMB", "DESCEND", "MAINTAIN", "SPEED", "HEADING", "HOLD"]
Unit = Literal["FL", "FT", "KTS", "DEG", "NONE"]
TriggerType = Literal["IMMEDIATE", "AFTER_WAYPOINT", "AT_WAYPOINT", "AT_TIME"]
FindingCategory = Literal[
    "CALLSIGN_MISMATCH",
    "MISSING_ACTION",
    "EXTRA_ACTION",
    "CHANGED_VALUE",
    "CHANGED_WAYPOINT",
    "MISSING_CONDITION",
    "CHANGED_CONDITION",
    "INCORRECT_EXECUTION_TIME",
    "PARTIAL_FMS_LOAD",
]
FindingScope = Literal["atc_vs_pilot", "pilot_vs_fms"]
OverallStatus = Literal["agree", "mismatch", "verify_required"]
RowStatus = Literal["match", "mismatch", "info"]

CONFIDENCE_GATE = 0.85


class ClearanceAction(BaseModel):
    """One ordered clearance action. Flat and non-recursive by design."""

    model_config = ConfigDict(extra="forbid")

    action_type: ActionType
    target_fix: str | None = Field(description="Fix for DIRECT_TO/HOLD, else null.")
    numeric_value: int | None = Field(description="Level/speed/heading number, else null.")
    unit: Unit = Field(description="FL, FT, KTS, DEG, or NONE.")
    trigger_type: TriggerType = Field(description="IMMEDIATE unless a condition is stated.")
    trigger_value: str | None = Field(description="Fix for waypoint triggers, HH:MM for AT_TIME.")
    evidence: str | None = Field(description="Exact transcript span, or null.")
    confidence: float = Field(ge=0.0, le=1.0)


class ClearancePayload(BaseModel):
    """Exact strict-JSON contract for the language models.

    Every key is required; unknown or unstated values must be explicit null.
    Actions stay in transcript order. The model must never infer an absent
    action, value, fix, or condition.
    """

    model_config = ConfigDict(extra="forbid")

    callsign: str | None = Field(description="Aircraft callsign exactly as stated, else null.")
    callsign_evidence: str | None = Field(description="Exact callsign span, or null.")
    callsign_confidence: float = Field(ge=0.0, le=1.0)
    actions: list[ClearanceAction] = Field(description="Ordered actions, possibly empty.")
    overall_confidence: float = Field(
        ge=0.0, le=1.0, description="Minimum over callsign and action confidences."
    )


class Clearance(ClearancePayload):
    """A clearance payload plus source text and provenance for display."""

    raw_text: str
    role: Literal["atc", "pilot"]
    provenance: Provenance
    model: str
    note: str | None = None


class FMSProgram(BaseModel):
    """Simulated FMS state. climb_start_fix None means an immediate altitude change."""

    model_config = ConfigDict(extra="forbid")

    callsign: str | None
    cleared_fl: int | None
    cleared_alt_ft: int | None
    target_speed_kts: int | None
    climb_start_fix: str | None
    lateral_direct_to: str | None
    route: list[str]
    loaded: list[str]
    held: list[str]
    loaded_actions: list[ClearanceAction]
    source: Literal["atc", "pilot", "corrected"]
    provenance: Provenance
    summary: str


class Finding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: FindingCategory
    scope: FindingScope
    action: str
    detail: str


class MatrixRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    aspect: str
    atc: str
    pilot: str
    fms: str
    predicted: str
    status: RowStatus
    category: str
    note: str


class ComparisonMatrix(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rows: list[MatrixRow]
    findings: list[Finding]
    overall: OverallStatus
    min_confidence: float
    missing_condition: bool
    missing_phrase: str | None


class ScenarioGeometry(BaseModel):
    """Flat-plane demo airspace. Prototype simplification, documented."""

    model_config = ConfigDict(extra="forbid")

    own_start_nm: tuple[float, float] = (0.0, 0.0)
    own_speed_kt: float = 300.0
    own_init_alt_ft: float = 15000.0
    climb_rate_fpm: float = 2000.0
    descend_rate_fpm: float = 1500.0
    # Optional landing tail past MERIT (arrival procedure): the clearance
    # holds level through the encounter, then the aircraft descends toward
    # landing_alt_ft and slows toward landing_speed_kt for the airport.
    landing_alt_ft: float | None = None
    landing_speed_kt: float | None = None
    # Landing slowdown rate (kt/s): gentle so the speed keeps easing down
    # alongside the descent instead of finishing in seconds.
    landing_decel_kt_s: float = 1.0
    merit_nm: tuple[float, float] = (20.0, 0.0)
    intruder_start_nm: tuple[float, float] = (18.0, -18.0)
    intruder_vel_kt: tuple[float, float] = (0.0, 300.0)
    intruder_alt_ft: float = 23000.0
    lateral_threshold_nm: float = 5.0
    vertical_threshold_ft: float = 1000.0
    horizon_s: float = 720.0
    step_s: float = 5.0


class ProfilePoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    t_s: float
    meta_x_nm: float
    meta_ft: float
    meta_kt: float
    intruder_x_nm: float
    intruder_y_nm: float
    intruder_ft: float
    intruder_kt: float


class ConflictPrediction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conflict: bool
    first_conflict_time_s: float | None
    lateral_nm_at_conflict: float | None
    vertical_ft_at_conflict: float | None
    closest_lateral_nm: float
    min_vertical_ft: float
    merit_time_s: float | None
    merit_vertical_gap_ft: float | None
    plan_merit_time_s: float | None = None
    intruder_merit_time_s: float | None = None
    conflict_point_nm: dict[str, float] | None
    lateral_threshold_nm: float
    vertical_threshold_ft: float
    basis: str
    profile: list[ProfilePoint]
    plan_profile: list[ProfilePoint] | None = None


class Explanation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str
    cause: str
    evidence: list[str]
    recommended_action: str
    provenance: Provenance
    model: str


class VoiceTranscript(BaseModel):
    model_config = ConfigDict(extra="forbid")

    transcript: str
    provenance: Provenance
    model: str
    source_file: str
    note: str | None = None


class DemoResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    atc_transcript: str
    pilot_transcript: str
    atc: Clearance
    pilot: Clearance
    fms: FMSProgram
    comparison: ComparisonMatrix
    conflict: ConflictPrediction
    explanation: Explanation
    badges: dict[str, str]


class CorrectionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    corrected_pilot: Clearance
    fms: FMSProgram
    comparison: ComparisonMatrix
    conflict: ConflictPrediction
    explanation: Explanation
    resolved: bool
    badges: dict[str, str]


class ScenarioResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenario_id: str
    initial: DemoResult
    corrected: CorrectionResult
    resolved: bool


class ParseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    transcript: str
    use_live: bool = False


class FMSRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    intent: Clearance
    source: Literal["atc", "pilot"] = "pilot"
    scenario_id: str | None = None


class CompareRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    atc: Clearance
    pilot: Clearance
    fms: FMSProgram


class ConflictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fms: FMSProgram
    scenario_id: str | None = None


class ExplainRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    comparison: ComparisonMatrix
    conflict: ConflictPrediction
    atc_text: str = ""
    pilot_text: str = ""
    use_live: bool = False


class DemoRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    use_live: bool = False
    scenario_id: str | None = None


class SeparationMinima(BaseModel):
    model_config = ConfigDict(extra="forbid")

    min_lateral_nm: float
    vertical_at_min_lateral_ft: float
    min_vertical_ft: float
    lateral_at_min_vertical_nm: float


class CausalStep(BaseModel):
    model_config = ConfigDict(extra="forbid")

    step: int
    stage: str
    detail: str


class SafetyWindow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conflict_time_s: float | None
    first_warning_time_s: float
    last_safe_correction_s: float | None
    seconds_remaining_s: float | None
    position_at_last_safe: dict[str, float] | None
    min_sep_no_correction: SeparationMinima
    min_sep_after_correction: SeparationMinima
    causal_chain: list[CausalStep]
    basis: str


class ResolutionCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    action_human: str
    source_evidence: str | None
    conflict_after: bool
    min_lateral_nm: float
    min_vertical_ft: float
    verification: Literal["VERIFIED", "NOT_RESOLVED"]
    safe_reason: str


class VerificationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    candidate_id: str
    verified: bool
    matrix_overall: OverallStatus
    conflict_after: bool
    min_lateral_nm: float
    min_vertical_ft: float
    reason: str


class Fingerprints(BaseModel):
    model_config = ConfigDict(extra="forbid")

    atc: str
    pilot: str
    fms: str
    all_agree: bool
    display_id: str


class AuditEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    seq: int
    type: str
    provenance: str
    model: str | None
    result: dict
    human_confirmation: str
    prev_hash: str
    hash: str


class AuditVerify(BaseModel):
    model_config = ConfigDict(extra="forbid")

    valid: bool
    length: int
    head: str | None
    first_bad_seq: int | None


class ToolCallRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    turn: int
    tool: str
    ok: bool
    summary: str


class CoordinationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recommended_candidate_id: str | None
    summary: str
    rationale: str
    tool_calls: list[ToolCallRecord]
    provenance: Provenance
    model: str
    overridden: bool
    note: str | None = None


class SafetyWindowRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    atc: Clearance
    pilot: Clearance
    fms: FMSProgram
    scenario_id: str | None = None


class EnumerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    atc: Clearance
    pilot: Clearance
    fms: FMSProgram
    scenario_id: str | None = None


class VerifyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    atc: Clearance
    pilot: Clearance
    fms: FMSProgram
    candidate_id: str
    scenario_id: str | None = None


class FingerprintRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    atc: Clearance
    pilot: Clearance
    fms: FMSProgram


class CoordinateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    atc_text: str
    pilot_text: str
    scenario_id: str | None = None
    use_live: bool = False
