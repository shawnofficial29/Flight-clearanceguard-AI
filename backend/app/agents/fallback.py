"""Deterministic regex fallback parser. Never infers values not in the text."""

from __future__ import annotations

import re
from typing import Literal

from ..models import AFTER_PASSING, StructuredIntent
from ..services.model_client import MetaAPIError

_CALLSIGN = re.compile(r"\b([A-Z]{2,}\s?\d{2,4})\b")
_FL = re.compile(r"flight level\s*(\d{2,3})", re.IGNORECASE)
_AFTER_PASSING = re.compile(r"after passing\s+([A-Z][A-Z0-9]{2,5})", re.IGNORECASE)
_DIRECT = re.compile(r"direct\s+([A-Z][A-Z0-9]{2,5})", re.IGNORECASE)


def _normalize_callsign(raw: str) -> str:
    compact = re.sub(r"\s+", "", raw.upper())
    letters = re.match(r"[A-Z]+", compact)
    if not letters:
        return raw.upper()
    return f"{letters.group(0)} {compact[letters.end():]}".strip()


def short_error(exc: MetaAPIError) -> str:
    """One-line sanitized failure reason for fallback notes (never a secret)."""
    if exc.status_code is not None:
        return f"HTTP {exc.status_code}"
    return str(exc)[:160]


def parse_transcript(
    transcript: str, role: Literal["atc", "pilot"], *, reason: str | None = None
) -> StructuredIntent:
    text = transcript.strip()
    upper = text.upper()

    callsign: str | None = None
    callsign_ev: str | None = None
    match = _CALLSIGN.search(upper)
    if match:
        callsign = _normalize_callsign(match.group(1))
        callsign_ev = match.group(1).strip()

    climb_to_fl: int | None = None
    fl_ev: str | None = None
    match = _FL.search(text)
    if match:
        climb_to_fl = int(match.group(1))
        fl_ev = match.group(0)

    condition_type: Literal["after_passing"] | None = None
    condition_fix: str | None = None
    cond_ev: str | None = None
    match = _AFTER_PASSING.search(text)
    if match:
        condition_type = AFTER_PASSING  # type: ignore[assignment]
        condition_fix = match.group(1).upper()
        cond_ev = match.group(0)

    direct_to: str | None = None
    direct_ev: str | None = None
    match = _DIRECT.search(text)
    if match:
        direct_to = match.group(1).upper()
        direct_ev = match.group(0)

    found = sum(v is not None for v in (callsign, climb_to_fl, condition_fix, direct_to))
    confidence = round(min(0.95, 0.55 + 0.10 * found), 2)

    return StructuredIntent(
        callsign=callsign,
        climb_to_fl=climb_to_fl,
        climb_condition_type=condition_type,
        climb_condition_fix=condition_fix,
        direct_to=direct_to,
        evidence={
            "callsign": callsign_ev,
            "climb_to_fl": fl_ev,
            "climb_condition_type": cond_ev,
            "climb_condition_fix": condition_fix,
            "direct_to": direct_ev,
        },
        confidence=confidence,
        raw_text=text,
        role=role,
        provenance="fixture_fallback",
        model="deterministic-fallback",
        note=f"Fixture fallback ({reason or 'live Meta API unavailable or not requested'}).",
    )
