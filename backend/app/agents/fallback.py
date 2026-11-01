"""Deterministic regex fallback parser. Never infers values not in the text."""

from __future__ import annotations

import re
from typing import Literal

from ..models import Clearance, ClearanceAction, TriggerType, Unit
from ..services.model_client import MetaAPIError

_CALLSIGN = re.compile(r"\b([A-Z]{2,}\s?\d{2,4})\b")
_FL = re.compile(r"flight level\s*(\d{2,3})", re.IGNORECASE)
_FEET = re.compile(r"(\d[\d,]*)\s*feet", re.IGNORECASE)
_CLIMB = re.compile(r"\bclimb\b", re.IGNORECASE)
_DESCEND = re.compile(r"\bdescend\b", re.IGNORECASE)
_MAINTAIN_ALT = re.compile(r"\bmaintain\b", re.IGNORECASE)
_DIRECT = re.compile(r"\bdirect\s+([A-Z][A-Z0-9]{2,5})", re.IGNORECASE)
_SPEED = re.compile(r"(?:reduce\s+speed\s+to|speed)\s+(\d{2,3})\s*knots?", re.IGNORECASE)
_MAINTAIN_SPEED = re.compile(r"\bmaintain\s+(\d{2,3})\s*knots?", re.IGNORECASE)
_HEADING = re.compile(r"(?:fly\s+heading|heading|turn\s+(?:left|right)\s+heading)\s+(\d{3})", re.IGNORECASE)
_HOLD = re.compile(r"\bhold\s+(?:at|over)\s+([A-Z][A-Z0-9]{2,5})", re.IGNORECASE)
_AFTER = re.compile(r"after passing\s+([A-Z][A-Z0-9]{2,5})", re.IGNORECASE)
_AT_TIME = re.compile(r"\bat\s+(\d{1,2}:\d{2})\b")
_AT_FIX = re.compile(r"\bat\s+([A-Z][A-Z0-9]{2,5})\b", re.IGNORECASE)

_MATCH_CONF = 0.9


def short_error(exc: MetaAPIError) -> str:
    """One-line sanitized failure reason for fallback notes (never a secret)."""
    if exc.status_code is not None:
        return f"HTTP {exc.status_code}"
    return str(exc)[:160]


def _normalize_callsign(raw: str) -> str:
    compact = re.sub(r"\s+", "", raw.upper())
    letters = re.match(r"[A-Z]+", compact)
    if not letters:
        return raw.upper()
    return f"{letters.group(0)} {compact[letters.end():]}".strip()


def _number(raw: str) -> int:
    return int(raw.replace(",", ""))


def _blank_spans(text: str, spans: list[tuple[int, int]]) -> str:
    chars = list(text)
    for start, end in spans:
        for i in range(start, end):
            chars[i] = " "
    return "".join(chars)


def _level_value(text: str) -> tuple[int | None, Unit, str | None]:
    match = _FL.search(text)
    if match:
        return _number(match.group(1)), "FL", match.group(0)
    match = _FEET.search(text)
    if match:
        return _number(match.group(1)), "FT", match.group(0)
    return None, "NONE", None


def _collect_actions(text: str) -> tuple[list[tuple[int, ClearanceAction]], list[tuple[int, int]]]:
    found: list[tuple[int, ClearanceAction]] = []

    def add(match: re.Match, action: ClearanceAction) -> None:
        found.append((match.start(), action))

    if _CLIMB.search(text):
        value, unit, span = _level_value(text)
        if value is not None:
            match = _CLIMB.search(text)
            assert match is not None
            evidence = f"{match.group(0)} to {span}" if span else match.group(0)
            add(
                match,
                ClearanceAction(
                    action_type="CLIMB",
                    target_fix=None,
                    numeric_value=value,
                    unit=unit,
                    trigger_type="IMMEDIATE",
                    trigger_value=None,
                    evidence=evidence,
                    confidence=_MATCH_CONF,
                ),
            )
    if _DESCEND.search(text):
        value, unit, span = _level_value(text)
        if value is not None:
            match = _DESCEND.search(text)
            assert match is not None
            evidence = f"{match.group(0)} to {span}" if span else match.group(0)
            add(
                match,
                ClearanceAction(
                    action_type="DESCEND",
                    target_fix=None,
                    numeric_value=value,
                    unit=unit,
                    trigger_type="IMMEDIATE",
                    trigger_value=None,
                    evidence=evidence,
                    confidence=_MATCH_CONF,
                ),
            )
    for match in _MAINTAIN_SPEED.finditer(text):
        add(
            match,
            ClearanceAction(
                action_type="MAINTAIN",
                target_fix=None,
                numeric_value=_number(match.group(1)),
                unit="KTS",
                trigger_type="IMMEDIATE",
                trigger_value=None,
                evidence=match.group(0),
                confidence=_MATCH_CONF,
            ),
        )
    if _MAINTAIN_ALT.search(text) and "knot" not in text.lower():
        value, unit, span = _level_value(text)
        if value is not None:
            match = _MAINTAIN_ALT.search(text)
            assert match is not None
            add(
                match,
                ClearanceAction(
                    action_type="MAINTAIN",
                    target_fix=None,
                    numeric_value=value,
                    unit=unit,
                    trigger_type="IMMEDIATE",
                    trigger_value=None,
                    evidence=f"{match.group(0)} {span}",
                    confidence=_MATCH_CONF,
                ),
            )
    for match in _DIRECT.finditer(text):
        add(
            match,
            ClearanceAction(
                action_type="DIRECT_TO",
                target_fix=match.group(1).upper(),
                numeric_value=None,
                unit="NONE",
                trigger_type="IMMEDIATE",
                trigger_value=None,
                evidence=match.group(0),
                confidence=_MATCH_CONF,
            ),
        )
    for match in _SPEED.finditer(text):
        add(
            match,
            ClearanceAction(
                action_type="SPEED",
                target_fix=None,
                numeric_value=_number(match.group(1)),
                unit="KTS",
                trigger_type="IMMEDIATE",
                trigger_value=None,
                evidence=match.group(0),
                confidence=_MATCH_CONF,
            ),
        )
    for match in _HEADING.finditer(text):
        add(
            match,
            ClearanceAction(
                action_type="HEADING",
                target_fix=None,
                numeric_value=_number(match.group(1)),
                unit="DEG",
                trigger_type="IMMEDIATE",
                trigger_value=None,
                evidence=match.group(0),
                confidence=_MATCH_CONF,
            ),
        )
    hold_spans: list[tuple[int, int]] = []
    for match in _HOLD.finditer(text):
        hold_spans.append(match.span())
        add(
            match,
            ClearanceAction(
                action_type="HOLD",
                target_fix=match.group(1).upper(),
                numeric_value=None,
                unit="NONE",
                trigger_type="IMMEDIATE",
                trigger_value=None,
                evidence=match.group(0),
                confidence=_MATCH_CONF,
            ),
        )
    return found, hold_spans


def _collect_triggers(text: str, hold_spans: list[tuple[int, int]]) -> list[tuple[int, TriggerType, str]]:
    triggers: list[tuple[int, TriggerType, str]] = []
    after_spans: list[tuple[int, int]] = []
    for match in _AFTER.finditer(text):
        after_spans.append(match.span())
        triggers.append((match.start(), "AFTER_WAYPOINT", match.group(1).upper()))
    for match in _AT_TIME.finditer(text):
        triggers.append((match.start(), "AT_TIME", match.group(1)))
    scrubbed = _blank_spans(text, hold_spans + after_spans)
    for match in _AT_FIX.finditer(scrubbed):
        triggers.append((match.start(), "AT_WAYPOINT", match.group(1).upper()))
    return triggers


def _attach_triggers(
    actions: list[tuple[int, ClearanceAction]], triggers: list[tuple[int, TriggerType, str]]
) -> None:
    for tpos, ttype, tvalue in triggers:
        if not actions:
            return
        best = min(actions, key=lambda item: (abs(item[0] - tpos), item[0] > tpos))
        best[1].trigger_type = ttype
        best[1].trigger_value = tvalue


def parse_transcript(
    transcript: str, role: Literal["atc", "pilot"], *, reason: str | None = None
) -> Clearance:
    text = transcript.strip()
    upper = text.upper()

    callsign: str | None = None
    callsign_ev: str | None = None
    callsign_conf = 0.4
    match = _CALLSIGN.search(upper)
    if match:
        callsign = _normalize_callsign(match.group(1))
        callsign_ev = match.group(1).strip()
        callsign_conf = _MATCH_CONF

    actions, hold_spans = _collect_actions(text)
    triggers = _collect_triggers(text, hold_spans)
    _attach_triggers(actions, triggers)
    ordered = [action for _, action in sorted(actions, key=lambda item: item[0])]

    if ordered:
        overall = min([callsign_conf] + [a.confidence for a in ordered])
    else:
        overall = 0.5 if text else 0.0

    return Clearance(
        callsign=callsign,
        callsign_evidence=callsign_ev,
        callsign_confidence=callsign_conf,
        actions=ordered,
        overall_confidence=round(overall, 2),
        raw_text=text,
        role=role,
        provenance="fixture_fallback",
        model="deterministic-fallback",
        note=f"Fixture fallback ({reason or 'live Meta API unavailable or not requested'}).",
    )
