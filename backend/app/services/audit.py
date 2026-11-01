"""Replayable audit event chain (in-memory, hash-linked).

Each event stores a deterministic sequence number, type, provenance, optional
model name, a sanitized structured result, human-confirmation state, and the
prev/current hashes. No chain-of-thought and no credentials are ever stored.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from ..models import AuditEvent, AuditVerify

GENESIS = "GENESIS"
_CHAIN: list[AuditEvent] = []

_SECRET_KEYS = {"api_key", "meta_api_key", "model_api_key", "authorization", "secret", "token"}


def sanitize(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: "***" if str(key).lower() in _SECRET_KEYS else sanitize(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [sanitize(item) for item in value]
    if isinstance(value, str):
        return value
    return value


def _event_hash(
    seq: int, type: str, provenance: str, model: str | None,
    result: dict, human_confirmation: str, prev_hash: str,
) -> str:
    canonical = json.dumps(
        {
            "seq": seq,
            "type": type,
            "provenance": provenance,
            "model": model,
            "result": result,
            "human_confirmation": human_confirmation,
            "prev_hash": prev_hash,
        },
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def reset_chain() -> None:
    _CHAIN.clear()


def append(
    type: str,
    result: dict[str, Any],
    *,
    provenance: str = "deterministic",
    model: str | None = None,
    human_confirmation: str = "not_required",
) -> AuditEvent:
    clean = sanitize(result)
    assert isinstance(clean, dict)
    prev = _CHAIN[-1].hash if _CHAIN else GENESIS
    seq = len(_CHAIN) + 1
    event = AuditEvent(
        seq=seq,
        type=type,
        provenance=provenance,
        model=model,
        result=clean,
        human_confirmation=human_confirmation,
        prev_hash=prev,
        hash=_event_hash(seq, type, provenance, model, clean, human_confirmation, prev),
    )
    _CHAIN.append(event)
    return event


def events() -> list[AuditEvent]:
    return list(_CHAIN)


def verify() -> AuditVerify:
    prev = GENESIS
    for event in _CHAIN:
        if event.prev_hash != prev:
            return AuditVerify(valid=False, length=len(_CHAIN), head=_CHAIN[-1].hash, first_bad_seq=event.seq)
        recomputed = _event_hash(
            event.seq, event.type, event.provenance, event.model,
            event.result, event.human_confirmation, event.prev_hash,
        )
        if recomputed != event.hash:
            return AuditVerify(valid=False, length=len(_CHAIN), head=_CHAIN[-1].hash, first_bad_seq=event.seq)
        prev = event.hash
    return AuditVerify(
        valid=True, length=len(_CHAIN), head=_CHAIN[-1].hash if _CHAIN else None, first_bad_seq=None
    )
