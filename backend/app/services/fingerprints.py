"""Deterministic intent fingerprints (SHA-256 over canonical intent).

Fingerprints cover semantic intent only — callsign plus ordered actions —
never evidence spans, confidences, provenance, or model names. This is an
integrity fingerprint, not a digital signature.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from ..models import Clearance, ClearanceAction, Fingerprints, FMSProgram


def _norm(value: str | None) -> str | None:
    if value is None:
        return None
    return " ".join(value.strip().upper().split())


def _canonical_action(action: ClearanceAction) -> dict[str, Any]:
    return {
        "action_type": action.action_type,
        "target_fix": _norm(action.target_fix),
        "numeric_value": action.numeric_value,
        "unit": action.unit,
        "trigger_type": action.trigger_type,
        "trigger_value": _norm(action.trigger_value),
    }


def canonical_clearance(clearance: Clearance) -> dict[str, Any]:
    return {
        "callsign": _norm(clearance.callsign),
        "actions": [_canonical_action(a) for a in clearance.actions],
    }


def canonical_fms(program: FMSProgram) -> dict[str, Any]:
    return {
        "callsign": _norm(program.callsign),
        "actions": [_canonical_action(a) for a in program.loaded_actions],
    }


def _digest(canonical: dict[str, Any]) -> str:
    text = json.dumps(canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def fingerprint_clearance(clearance: Clearance) -> str:
    return _digest(canonical_clearance(clearance))


def fingerprint_fms(program: FMSProgram) -> str:
    return _digest(canonical_fms(program))


def fingerprints(atc: Clearance, pilot: Clearance, fms: FMSProgram) -> Fingerprints:
    atc_hash = fingerprint_clearance(atc)
    pilot_hash = fingerprint_clearance(pilot)
    fms_hash = fingerprint_fms(fms)
    return Fingerprints(
        atc=atc_hash,
        pilot=pilot_hash,
        fms=fms_hash,
        all_agree=atc_hash == pilot_hash == fms_hash,
        display_id=atc_hash[:8],
    )
