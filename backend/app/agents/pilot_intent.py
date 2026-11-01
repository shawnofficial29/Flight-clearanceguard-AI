"""Pilot Understanding Agent: parses the pilot readback independently."""

from __future__ import annotations

from ..config import Settings
from ..models import Clearance, ClearancePayload
from ..services.model_client import JsonTransport, MetaAPIError, MetaModelClient, ModelNotConfiguredError
from .fallback import parse_transcript as fallback_parse
from .fallback import short_error

SYSTEM_PROMPT = (
    "You are the Pilot Understanding Agent for ClearanceGuard AI. Report ONLY what "
    "the pilot actually said in the readback, into the required JSON schema: "
    "callsign plus an ordered action list (DIRECT_TO, CLIMB, DESCEND, MAINTAIN, "
    "SPEED, HEADING, HOLD) with fix, value, unit, trigger, and trigger value. "
    "Rules: strict JSON only; every key required; null for anything not stated; "
    "transcript order. NEVER fill in an action or condition from the ATC clearance "
    "or from expectation — if the pilot omits 'after passing MERIT', the action "
    "trigger MUST be IMMEDIATE with null trigger value. Quote exact spans in "
    "evidence, or null. Confidence 0.9+ only for explicit spans; "
    "overall_confidence is the minimum over callsign and actions."
)


def _live(transcript: str, settings: Settings, transport: JsonTransport | None) -> Clearance:
    payload = MetaModelClient(settings, transport).complete_json(
        system=SYSTEM_PROMPT,
        user=transcript.strip(),
        schema_name="clearance",
        payload_model=ClearancePayload,
    )
    return Clearance(
        **payload.model_dump(),
        raw_text=transcript.strip(),
        role="pilot",
        provenance="live_meta_api",
        model=settings.meta_model_name,
    )


def parse_pilot(
    transcript: str,
    settings: Settings,
    transport: JsonTransport | None = None,
    *,
    force_fixture: bool = False,
    strict_live: bool = False,
) -> Clearance:
    """Parse the pilot readback. strict_live never falls back; errors surface."""
    if strict_live:
        return _live(transcript, settings, transport)
    if not force_fixture:
        try:
            return _live(transcript, settings, transport)
        except ModelNotConfiguredError:
            reason = "no MODEL_API_KEY configured"
        except MetaAPIError as exc:
            reason = f"live call failed ({short_error(exc)})"
        return fallback_parse(transcript, "pilot", reason=reason)
    return fallback_parse(transcript, "pilot", reason="live mode not requested")
