"""Pytest bootstrap: make `app` importable when running from backend/."""

import json
import sys
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import (  # noqa: E402
    MODEL_API_URL_DEFAULT,
    VOICE_API_URL_DEFAULT,
    Settings,
)


@pytest.fixture
def offline_settings() -> Settings:
    """No key (default URLs): every agent must take the deterministic fallback."""
    return Settings(
        meta_api_key=None,
        meta_model_api_url=MODEL_API_URL_DEFAULT,
        meta_voice_api_url=VOICE_API_URL_DEFAULT,
    )


@pytest.fixture
def live_settings() -> Settings:
    """Configured settings for stubbed-transport live-path tests (no network)."""
    return Settings(
        meta_api_key="test-key",
        meta_model_api_url="https://stub.invalid/v1/chat/completions",
        meta_voice_api_url="https://stub.invalid/v1/transcribe",
    )


def choices_transport(payload: dict[str, Any]):
    """Build a stub model transport returning payload in a choices envelope."""

    def _send(url: str, headers: dict, body: dict, timeout: float) -> dict[str, Any]:
        assert body["model"] == "muse-spark-1.3"
        fmt = body["response_format"]
        assert fmt["type"] == "json_schema"
        assert set(fmt["json_schema"]) == {"name", "schema"}
        return {"choices": [{"message": {"content": json.dumps(payload)}}]}

    return _send
