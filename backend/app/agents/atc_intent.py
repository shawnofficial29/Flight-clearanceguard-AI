"""ATC Intent Agent: parses the controller's clearance via muse-spark-1.3."""

from __future__ import annotations

from ..config import Settings
from ..models import Clearance, ClearancePayload
from ..services.model_client import JsonTransport, MetaAPIError, MetaModelClient, ModelNotConfiguredError
from .fallback import parse_transcript as fallback_parse
from .fallback import short_error

SYSTEM_PROMPT = (
    "You are the ATC Intent Agent for ClearanceGuard AI. Extract the controller's "
    "clearance exactly as stated into the required JSON schema: callsign plus an "
    "ordered list of actions (DIRECT_TO, CLIMB, DESCEND, MAINTAIN, SPEED, HEADING, "
    "HOLD), each with target fix, numeric value, unit (FL, FT, KTS, DEG, NONE), "
    "trigger (IMMEDIATE, AFTER_WAYPOINT, AT_WAYPOINT, AT_TIME) and trigger value. "
    "Rules: strict JSON only; every key required; use null for anything not stated; "
    "keep actions in transcript order. NEVER infer an absent action, value, fix, or "
    "condition: an unstated trigger is IMMEDIATE with null trigger value. Quote the "
    "exact transcript span per field in evidence, or null. Confidence 0.9+ only for "
    "explicit spans; overall_confidence is the minimum over callsign and actions."
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
        role="atc",
        provenance="live_meta_api",
        model=settings.meta_model_name,
    )


def parse_atc(
    transcript: str,
    settings: Settings,
    transport: JsonTransport | None = None,
    *,
    force_fixture: bool = False,
    strict_live: bool = False,
) -> Clearance:
    """Parse the ATC clearance. strict_live never falls back; errors surface."""
    if strict_live:
        return _live(transcript, settings, transport)
    if not force_fixture:
        try:
            return _live(transcript, settings, transport)
        except ModelNotConfiguredError:
            reason = "no MODEL_API_KEY configured"
        except MetaAPIError as exc:
            reason = f"live call failed ({short_error(exc)})"
        return fallback_parse(transcript, "atc", reason=reason)
    return fallback_parse(transcript, "atc", reason="live mode not requested")
