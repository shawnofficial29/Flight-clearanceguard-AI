"""ATC Intent Agent: parses the controller's clearance via muse-spark-1.3."""

from __future__ import annotations

from ..config import Settings
from ..models import ClearancePayload, StructuredIntent
from ..services.model_client import JsonTransport, MetaAPIError, MetaModelClient, ModelNotConfiguredError
from .fallback import parse_transcript as fallback_parse
from .fallback import short_error

SYSTEM_PROMPT = (
    "You are the ATC Intent Agent for ClearanceGuard AI. Extract the controller's "
    "clearance exactly as stated into the required JSON schema. Rules: output strict "
    "JSON only; every key required; use null for anything not stated. NEVER infer a "
    "missing callsign, level, condition, or fix. Quote the exact transcript span for "
    "each field in 'evidence', or null when absent."
)


def _live(transcript: str, settings: Settings, transport: JsonTransport | None) -> StructuredIntent:
    payload = MetaModelClient(settings, transport).complete_json(
        system=SYSTEM_PROMPT,
        user=transcript.strip(),
        schema_name="clearance",
        payload_model=ClearancePayload,
    )
    return StructuredIntent(
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
) -> StructuredIntent:
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
