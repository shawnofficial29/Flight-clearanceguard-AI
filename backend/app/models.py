"""Pydantic data models: strict agent outputs, FMS, comparison, conflict."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Provenance = Literal["live_meta_api", "live_muse_voice", "fixture_fallback"]

BADGE_LABELS: dict[str, str] = {
    "live_meta_api": "Live Meta API",
    "live_muse_voice": "Live Muse Voice",
    "fixture_fallback": "Fixture fallback",
}

AFTER_PASSING = "after_passing"


class ClearancePayload(BaseModel):
    """Exact strict-JSON contract for the language models.

    Every key is required; unknown or unstated values must be explicit null.
    The model must never infer a missing value.
    """

    model_config = ConfigDict(extra="forbid")

    callsign: str | None = Field(description="Aircraft callsign exactly as stated, else null.")
    climb_to_fl: int | None = Field(description="Cleared flight level as integer, e.g. 230, else null.")
    climb_condition_type: Literal["after_passing"] | None = Field(
        description="'after_passing' only if a passing condition is stated, else null."
    )
    climb_condition_fix: str | None = Field(description="Condition fix such as MERIT, else null.")
    direct_to: str | None = Field(description="Direct-to fix such as PONCT, else null.")
    evidence: dict[str, str | None] = Field(
        description="Quoted transcript span supporting each field, or null."
    )
    confidence: float = Field(ge=0.0, le=1.0, description="Overall parse confidence 0..1.")


class StructuredIntent(ClearancePayload):
    """A clearance payload plus source text and provenance for display."""

    raw_text: str
    role: Literal["atc", "pilot"]
    provenance: Provenance
    model: str
    note: str | None = None


class FMSProgram(BaseModel):
    """Simulated FMS state. climb_start_fix None means an immediate climb."""

    model_config = ConfigDict(extra="forbid")

    callsign: str | None
    cleared_fl: int | None
    climb_start_fix: str | None
    lateral_direct_to: str | None
    route: list[str]
    source: Literal["atc", "pilot", "corrected"]
    provenance: Provenance
    summary: str


class MatrixRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    aspect: str
    atc: str
    pilot: str
    fms: str
    predicted: str
    status: Literal["match", "mismatch", "info"]
    note: str


class ComparisonMatrix(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rows: list[MatrixRow]
    overall: Literal["agree", "mismatch"]
    missing_condition: bool
    missing_phrase: str | None


class ProfilePoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    t_s: float
    meta_x_nm: float
    meta_ft: float
    intruder_x_nm: float
    intruder_y_nm: float
    intruder_ft: float


class ConflictPrediction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conflict: bool
    first_conflict_time_s: float | None
    lateral_nm_at_conflict: float | None
    vertical_ft_at_conflict: float | None
    closest_lateral_nm: float
    min_vertical_ft: float
    conflict_point_nm: dict[str, float] | None
    lateral_threshold_nm: float
    vertical_threshold_ft: float
    basis: str
    profile: list[ProfilePoint]


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
    atc_intent: StructuredIntent
    pilot_intent: StructuredIntent
    fms: FMSProgram
    comparison: ComparisonMatrix
    conflict: ConflictPrediction
    explanation: Explanation
    badges: dict[str, str]


class CorrectionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fms: FMSProgram
    comparison: ComparisonMatrix
    conflict: ConflictPrediction
    explanation: Explanation
    resolved: bool
    badges: dict[str, str]


class ParseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    transcript: str
    use_live: bool = False


class FMSRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    intent: StructuredIntent
    source: Literal["atc", "pilot"] = "pilot"


class CompareRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    atc: StructuredIntent
    pilot: StructuredIntent
    fms: FMSProgram


class ConflictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fms: FMSProgram


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
