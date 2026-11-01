"""Resolution Coordinator Agent: native Chat Completions tool calling.

The agent coordinates deterministic tools and explains results. It can never
issue a correction the tools did not return: submit_verified_resolution only
accepts a tool-returned VERIFIED candidate id, anything else is rejected or
overridden deterministically. The tool loop is capped at MAX_TURNS.
"""

from __future__ import annotations

import json
from typing import Any

from ..config import Settings
from ..models import (
    Clearance,
    ComparisonMatrix,
    CoordinationResult,
    FMSProgram,
    ResolutionCandidate,
    ScenarioGeometry,
    ToolCallRecord,
)
from ..services import comparison as comparison_service
from ..services import conflict as conflict_service
from ..services import fms as fms_service
from ..services import resolutions as resolution_service
from ..services import safety as safety_service
from ..services.model_client import JsonTransport, MetaAPIError, MetaModelClient, ModelNotConfiguredError
from . import atc_intent, pilot_intent

MAX_TURNS = 6


def _function_tool(name: str, description: str, properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
    schema: dict[str, Any] = {"type": "object", "properties": properties, "additionalProperties": False}
    if required:
        schema["required"] = required
    return {"type": "function", "function": {"name": name, "description": description, "parameters": schema}}


TOOL_SCHEMAS: list[dict[str, Any]] = [
    _function_tool("compare_intents", "Compare ATC, pilot, and FMS intent deterministically.", {}, []),
    _function_tool("predict_conflict", "Predict the two-aircraft trajectory conflict.", {}, []),
    _function_tool("calculate_safety_window", "Compute the counterfactual safety window.", {}, []),
    _function_tool(
        "enumerate_verified_corrections", "List deterministic ATC-sourced correction candidates.", {}, []
    ),
    _function_tool(
        "verify_resolution",
        "Verify one candidate by id with deterministic re-computation.",
        {"candidate_id": {"type": "string", "description": "Candidate id from enumeration."}},
        ["candidate_id"],
    ),
    _function_tool(
        "submit_verified_resolution",
        "Submit the final verified correction. Candidate id must come from enumeration.",
        {
            "recommended_candidate_id": {"type": "string"},
            "summary": {"type": "string"},
            "rationale": {"type": "string"},
        },
        ["recommended_candidate_id", "summary", "rationale"],
    ),
]

TOOL_NAMES = tuple(tool["function"]["name"] for tool in TOOL_SCHEMAS)

SYSTEM_PROMPT = (
    "You are the Resolution Coordinator for ClearanceGuard AI. Use the native "
    "tools to verify the clearance mismatch, then submit exactly one verified "
    "correction. Protocol: first call compare_intents, predict_conflict, "
    "calculate_safety_window, and enumerate_verified_corrections; then call "
    "verify_resolution for the chosen candidate; finally call "
    "submit_verified_resolution with a candidate id returned by enumeration. "
    "Never invent altitudes, fixes, commands, or candidate ids. Keep summary "
    "and rationale to two sentences each."
)


class _Case:
    def __init__(self, atc_text: str, pilot_text: str, geometry: ScenarioGeometry, settings: Settings) -> None:
        self.atc_text = atc_text
        self.pilot_text = pilot_text
        self.geometry = geometry
        self.settings = settings
        self.atc: Clearance | None = None
        self.pilot: Clearance | None = None
        self.fms: FMSProgram | None = None
        self.matrix: ComparisonMatrix | None = None
        self.candidate_ids: list[str] = []
        self.candidates: list[ResolutionCandidate] = []
        self.submission: dict[str, str] | None = None
        self.saw_invalid_submit = False


def _ensure_matrix(case: _Case) -> ComparisonMatrix:
    assert case.atc is not None and case.pilot is not None
    if case.fms is None:
        case.fms = fms_service.program_from_intent(case.pilot, source="pilot")
    if case.matrix is None:
        case.matrix = comparison_service.build_matrix(case.atc, case.pilot, case.fms)
    return case.matrix


def _tool_compare(case: _Case, arguments: dict) -> dict:
    matrix = _ensure_matrix(case)
    return {
        "overall": matrix.overall,
        "categories": sorted({f.category for f in matrix.findings}),
        "min_confidence": matrix.min_confidence,
    }


def _tool_predict(case: _Case, arguments: dict) -> dict:
    _ensure_matrix(case)
    assert case.fms is not None
    prediction = conflict_service.predict(case.fms, case.geometry)
    return {
        "conflict": prediction.conflict,
        "t_s": prediction.first_conflict_time_s,
        "lateral_nm": prediction.lateral_nm_at_conflict,
        "vertical_ft": prediction.vertical_ft_at_conflict,
    }


def _tool_safety(case: _Case, arguments: dict) -> dict:
    matrix = _ensure_matrix(case)
    assert case.atc is not None and case.fms is not None
    window = safety_service.calculate(case.atc, case.fms, matrix.findings, case.geometry)
    return window.model_dump()


def _tool_enumerate(case: _Case, arguments: dict) -> dict:
    matrix = _ensure_matrix(case)
    assert case.atc is not None and case.pilot is not None
    candidates = resolution_service.enumerate_candidates(case.atc, case.pilot, matrix, case.geometry)
    case.candidate_ids = [c.id for c in candidates]
    case.candidates = candidates
    return {"candidates": [c.model_dump() for c in candidates]}


def _tool_verify(case: _Case, arguments: dict) -> dict:
    candidate_id = (arguments or {}).get("candidate_id")
    if not isinstance(candidate_id, str):
        raise ValueError("verify_resolution requires a candidate_id string.")
    matrix = _ensure_matrix(case)
    assert case.atc is not None and case.pilot is not None
    result = resolution_service.verify_candidate(candidate_id, case.atc, case.pilot, matrix, case.geometry)
    return result.model_dump()


def _tool_submit(case: _Case, arguments: dict) -> dict:
    if not isinstance(arguments, dict) or set(arguments) != {
        "recommended_candidate_id",
        "summary",
        "rationale",
    }:
        raise ValueError("submit requires exactly recommended_candidate_id, summary, rationale.")
    candidate_id = arguments["recommended_candidate_id"]
    summary = arguments["summary"]
    rationale = arguments["rationale"]
    if not all(isinstance(v, str) and v.strip() for v in (candidate_id, summary, rationale)):
        raise ValueError("submit fields must be non-empty strings.")
    verified_ids = {c.id for c in case.candidates if c.verification == "VERIFIED"}
    if candidate_id not in verified_ids:
        raise ValueError(f"Candidate '{candidate_id}' is unknown or unverified.")
    case.submission = {"recommended_candidate_id": candidate_id, "summary": summary, "rationale": rationale}
    return {"accepted": True, "candidate_id": candidate_id}


_TOOLS = {
    "compare_intents": _tool_compare,
    "predict_conflict": _tool_predict,
    "calculate_safety_window": _tool_safety,
    "enumerate_verified_corrections": _tool_enumerate,
    "verify_resolution": _tool_verify,
    "submit_verified_resolution": _tool_submit,
}


def _run_tool(case: _Case, turn: int, tool: str, arguments: dict | None) -> tuple[ToolCallRecord, dict]:
    try:
        if tool not in _TOOLS:
            raise ValueError(f"Unknown tool '{tool}'.")
        output = _TOOLS[tool](case, arguments or {})
        summary = json.dumps(output, sort_keys=True, default=str)[:800]
        return ToolCallRecord(turn=turn, tool=tool, ok=True, summary=summary), output
    except (ValueError, KeyError) as exc:
        return ToolCallRecord(turn=turn, tool=tool, ok=False, summary=str(exc)[:300]), {"error": str(exc)}


def _first_verified(case: _Case) -> str | None:
    for candidate in case.candidates:
        if candidate.verification == "VERIFIED":
            return candidate.id
    return None


def _deterministic_finish(
    case: _Case, records: list[ToolCallRecord], note: str | None, *, overridden: bool = False
) -> CoordinationResult:
    if not case.candidate_ids:
        record, _ = _run_tool(case, len(records) + 1, "enumerate_verified_corrections", {})
        records.append(record)
    recommended = _first_verified(case)
    detail = ""
    if case.matrix is not None:
        detail = f"Comparison is {case.matrix.overall}."
    return CoordinationResult(
        recommended_candidate_id=recommended,
        summary=f"Deterministic coordination complete. {detail}".strip(),
        rationale=(
            f"First verified correction selected ({recommended})."
            if recommended
            else "No verified correction available."
        ),
        tool_calls=records,
        provenance="fixture_fallback",
        model="deterministic-coordinator",
        overridden=overridden,
        note=note,
    )


def _parse_live(
    case: _Case, transport: JsonTransport | None
) -> None:
    case.atc = atc_intent.parse_atc(case.atc_text, case.settings, transport, strict_live=True)
    case.pilot = pilot_intent.parse_pilot(case.pilot_text, case.settings, transport, strict_live=True)
    case.fms = fms_service.program_from_intent(case.pilot, source="pilot")


def _parse_fixture(case: _Case) -> None:
    case.atc = atc_intent.parse_atc(case.atc_text, case.settings, force_fixture=True)
    case.pilot = pilot_intent.parse_pilot(case.pilot_text, case.settings, force_fixture=True)
    case.fms = fms_service.program_from_intent(case.pilot, source="pilot")


def _offline_coordinate(case: _Case, note: str | None) -> CoordinationResult:
    records: list[ToolCallRecord] = []
    for tool in (
        "compare_intents",
        "predict_conflict",
        "calculate_safety_window",
        "enumerate_verified_corrections",
    ):
        record, _ = _run_tool(case, len(records) + 1, tool, {})
        records.append(record)
    if case.candidate_ids:
        target = _first_verified(case) or case.candidate_ids[0]
        record, _ = _run_tool(case, len(records) + 1, "verify_resolution", {"candidate_id": target})
        records.append(record)
    return _deterministic_finish(case, records, note)


def coordinate(
    atc_text: str,
    pilot_text: str,
    settings: Settings,
    geometry: ScenarioGeometry,
    transport: JsonTransport | None = None,
    *,
    use_live: bool = False,
    strict_live: bool = False,
) -> CoordinationResult:
    case = _Case(atc_text, pilot_text, geometry, settings)
    live = use_live or strict_live
    if not live:
        _parse_fixture(case)
        return _offline_coordinate(case, note="Offline deterministic coordination.")
    try:
        _parse_live(case, transport)
    except (ModelNotConfiguredError, MetaAPIError) as exc:
        if strict_live:
            raise
        _parse_fixture(case)
        return _offline_coordinate(case, note=f"Live parsing failed ({exc}); deterministic fallback.")
    return _native_loop(case, settings, transport, strict_live=strict_live)


def _native_loop(
    case: _Case, settings: Settings, transport: JsonTransport | None, *, strict_live: bool
) -> CoordinationResult:
    client = MetaModelClient(settings, transport)
    records: list[ToolCallRecord] = []
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"ATC: {case.atc_text}\nPilot: {case.pilot_text}"},
    ]
    try:
        for turn in range(1, MAX_TURNS + 1):
            reply = client.chat_with_tools(messages=messages, tools=TOOL_SCHEMAS)
            messages.append(reply.raw)
            if not reply.tool_calls:
                if strict_live:
                    raise MetaAPIError("Model returned no tool calls; submit_verified_resolution required.")
                return _deterministic_finish(
                    case, records, "Model stopped calling tools; deterministic finish.",
                    overridden=case.saw_invalid_submit,
                )
            for call in reply.tool_calls:
                record, output = _run_tool(case, turn, call.name, call.arguments)
                records.append(record)
                messages.append(
                    {"role": "tool", "tool_call_id": call.id, "content": json.dumps(output, sort_keys=True, default=str)}
                )
                if call.name == "submit_verified_resolution" and not record.ok:
                    case.saw_invalid_submit = True
            if case.submission is not None:
                submission = case.submission
                return CoordinationResult(
                    recommended_candidate_id=submission["recommended_candidate_id"],
                    summary=submission["summary"],
                    rationale=submission["rationale"],
                    tool_calls=records,
                    provenance="live_meta_api",
                    model=settings.meta_model_name,
                    overridden=False,
                    note=None,
                )
        if strict_live:
            raise MetaAPIError(f"No verified submission within {MAX_TURNS} turns.")
        return _deterministic_finish(
            case, records, "Turn cap reached; deterministic finish.", overridden=case.saw_invalid_submit
        )
    except (ModelNotConfiguredError, MetaAPIError):
        if strict_live:
            raise
        return _deterministic_finish(
            case, records, "Live tool loop failed; deterministic fallback.",
            overridden=case.saw_invalid_submit,
        )


__all__ = ["MAX_TURNS", "TOOL_NAMES", "TOOL_SCHEMAS", "coordinate"]
