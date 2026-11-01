"""Coordinator agent tests: native tool loop, override, turn cap (stubbed)."""

import copy
import json

import pytest

from app.agents import coordinator
from app.config import Settings
from app.fixtures import (
    DEMO_ATC_TRANSCRIPT,
    DEMO_PILOT_TRANSCRIPT,
    FIXTURE_ATC_PAYLOAD,
    FIXTURE_PILOT_PAYLOAD,
)
from app.scenarios import SCENARIOS
from app.services.model_client import MetaAPIError

GEOMETRY = SCENARIOS["early-climb"].geometry
VERIFIED_ID = "missing-condition-climb-0"


def _scripted(responses: list):
    captured: list[dict] = []
    calls = {"n": 0}

    def _send(url, headers, body, timeout):
        captured.append(copy.deepcopy(body))
        response = responses[min(calls["n"], len(responses) - 1)]
        calls["n"] += 1
        if isinstance(response, Exception):
            raise response
        return response

    return _send, captured, calls


def _content(payload: dict) -> dict:
    return {"choices": [{"message": {"role": "assistant", "content": json.dumps(payload)}}]}


def _call(call_id: str, name: str, arguments: dict) -> dict:
    return {
        "id": call_id,
        "type": "function",
        "function": {"name": name, "arguments": json.dumps(arguments)},
    }


def _assistant(*calls: dict, content=None) -> dict:
    message: dict = {"role": "assistant", "content": content}
    if calls:
        message["tool_calls"] = list(calls)
    return {"choices": [{"message": message}]}


def _submit(call_id: str, candidate_id: str, extra: dict | None = None) -> dict:
    arguments = {
        "recommended_candidate_id": candidate_id,
        "summary": "Restore the omitted condition.",
        "rationale": "Deterministic verification passed.",
    }
    if extra:
        arguments.update(extra)
    return _call(call_id, "submit_verified_resolution", arguments)


def _parses() -> list[dict]:
    return [_content(FIXTURE_ATC_PAYLOAD), _content(FIXTURE_PILOT_PAYLOAD)]


def test_offline_coordination_recommends_verified(offline_settings: Settings):
    result = coordinator.coordinate(
        DEMO_ATC_TRANSCRIPT, DEMO_PILOT_TRANSCRIPT, offline_settings, GEOMETRY, use_live=False
    )
    assert result.provenance == "fixture_fallback"
    assert result.overridden is False
    assert [c.tool for c in result.tool_calls] == [
        "compare_intents",
        "predict_conflict",
        "calculate_safety_window",
        "enumerate_verified_corrections",
        "verify_resolution",
    ]
    assert result.recommended_candidate_id == VERIFIED_ID


def test_native_request_structure(live_settings: Settings):
    transport, captured, _ = _scripted(
        _parses()
        + [
            _assistant(_call("c1", "compare_intents", {}), _call("c2", "enumerate_verified_corrections", {})),
            _assistant(_submit("c9", VERIFIED_ID)),
        ]
    )
    coordinator.coordinate(
        DEMO_ATC_TRANSCRIPT, DEMO_PILOT_TRANSCRIPT, live_settings, GEOMETRY, transport, use_live=True
    )
    assert "response_format" in captured[0]  # live ATC parse
    assert "response_format" in captured[1]  # live pilot parse
    chat_body = captured[2]
    assert "response_format" not in chat_body
    assert [t["function"]["name"] for t in chat_body["tools"]] == [
        "compare_intents",
        "predict_conflict",
        "calculate_safety_window",
        "enumerate_verified_corrections",
        "verify_resolution",
        "submit_verified_resolution",
    ]
    submit_schema = chat_body["tools"][5]["function"]["parameters"]
    assert submit_schema["additionalProperties"] is False
    assert sorted(submit_schema["required"]) == ["rationale", "recommended_candidate_id", "summary"]
    assert [m["role"] for m in chat_body["messages"]] == ["system", "user"]


def test_parallel_calls_round_trip_messages(live_settings: Settings):
    first = _assistant(
        _call("c1", "compare_intents", {}),
        _call("c2", "predict_conflict", {}),
        _call("c3", "enumerate_verified_corrections", {}),
    )
    transport, captured, _ = _scripted(_parses() + [first, _assistant(_submit("c9", VERIFIED_ID))])
    result = coordinator.coordinate(
        DEMO_ATC_TRANSCRIPT, DEMO_PILOT_TRANSCRIPT, live_settings, GEOMETRY, transport, use_live=True
    )
    assert [c.tool for c in result.tool_calls] == [
        "compare_intents",
        "predict_conflict",
        "enumerate_verified_corrections",
        "submit_verified_resolution",
    ]
    assert result.recommended_candidate_id == VERIFIED_ID
    assert result.overridden is False
    second_chat = captured[3]
    roles = [m["role"] for m in second_chat["messages"]]
    assert roles == ["system", "user", "assistant", "tool", "tool", "tool"]
    assert second_chat["messages"][2] == first["choices"][0]["message"]
    assert [m["tool_call_id"] for m in second_chat["messages"][3:]] == ["c1", "c2", "c3"]


def test_unknown_tool_returns_error_and_continues(live_settings: Settings):
    transport, _, _ = _scripted(
        _parses()
        + [
            _assistant(_call("c1", "fly_plane", {}), _call("c2", "enumerate_verified_corrections", {})),
            _assistant(_submit("c9", VERIFIED_ID)),
        ]
    )
    result = coordinator.coordinate(
        DEMO_ATC_TRANSCRIPT, DEMO_PILOT_TRANSCRIPT, live_settings, GEOMETRY, transport, use_live=True
    )
    assert result.tool_calls[0].ok is False
    assert "Unknown tool" in result.tool_calls[0].summary
    assert result.recommended_candidate_id == VERIFIED_ID
    assert result.overridden is False


def test_submit_with_extra_key_rejected_then_recovered(live_settings: Settings):
    transport, _, _ = _scripted(
        _parses()
        + [
            _assistant(_call("c1", "enumerate_verified_corrections", {})),
            _assistant(_submit("c2", VERIFIED_ID, extra={"altitude": 230})),
            _assistant(_submit("c9", VERIFIED_ID)),
        ]
    )
    result = coordinator.coordinate(
        DEMO_ATC_TRANSCRIPT, DEMO_PILOT_TRANSCRIPT, live_settings, GEOMETRY, transport, use_live=True
    )
    submits = [c for c in result.tool_calls if c.tool == "submit_verified_resolution"]
    assert [s.ok for s in submits] == [False, True]
    assert result.recommended_candidate_id == VERIFIED_ID
    assert result.overridden is False


def test_invented_recommendation_overridden_at_cap(live_settings: Settings):
    transport, _, calls = _scripted(_parses() + [_assistant(_submit("cx", "climb-to-fl999"))])
    result = coordinator.coordinate(
        DEMO_ATC_TRANSCRIPT, DEMO_PILOT_TRANSCRIPT, live_settings, GEOMETRY, transport, use_live=True
    )
    assert calls["n"] == 2 + coordinator.MAX_TURNS
    assert result.overridden is True
    assert result.recommended_candidate_id == VERIFIED_ID


def test_turn_cap_forces_deterministic_finish(live_settings: Settings):
    transport, _, calls = _scripted(_parses() + [_assistant(_call("c1", "predict_conflict", {}))])
    result = coordinator.coordinate(
        DEMO_ATC_TRANSCRIPT, DEMO_PILOT_TRANSCRIPT, live_settings, GEOMETRY, transport, use_live=True
    )
    assert calls["n"] == 2 + coordinator.MAX_TURNS
    assert "Turn cap" in (result.note or "")
    assert result.recommended_candidate_id == VERIFIED_ID
    assert result.overridden is False


def test_strict_transport_error_surfaces(live_settings: Settings):
    transport, _, _ = _scripted(_parses() + [MetaAPIError("stub outage", status_code=500, body="err")])
    with pytest.raises(MetaAPIError, match="stub outage"):
        coordinator.coordinate(
            DEMO_ATC_TRANSCRIPT, DEMO_PILOT_TRANSCRIPT, live_settings, GEOMETRY, transport, strict_live=True
        )


def test_strict_content_only_reply_surfaces(live_settings: Settings):
    transport, _, _ = _scripted(_parses() + [_assistant(content="All good, no tools needed.")])
    with pytest.raises(MetaAPIError, match="no tool calls"):
        coordinator.coordinate(
            DEMO_ATC_TRANSCRIPT, DEMO_PILOT_TRANSCRIPT, live_settings, GEOMETRY, transport, strict_live=True
        )


def test_strict_cap_without_submit_surfaces(live_settings: Settings):
    transport, _, _ = _scripted(_parses() + [_assistant(_call("c1", "predict_conflict", {}))])
    with pytest.raises(MetaAPIError, match="No verified submission"):
        coordinator.coordinate(
            DEMO_ATC_TRANSCRIPT, DEMO_PILOT_TRANSCRIPT, live_settings, GEOMETRY, transport, strict_live=True
        )


def test_nonstrict_loop_error_falls_back_with_note(live_settings: Settings):
    transport, _, _ = _scripted(_parses() + [MetaAPIError("stub outage", status_code=500, body="err")])
    result = coordinator.coordinate(
        DEMO_ATC_TRANSCRIPT, DEMO_PILOT_TRANSCRIPT, live_settings, GEOMETRY, transport, use_live=True
    )
    assert result.provenance == "fixture_fallback"
    assert "deterministic fallback" in (result.note or "").lower()
    assert result.recommended_candidate_id == VERIFIED_ID
