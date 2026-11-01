"""Config tests: key precedence, default endpoints (offline, hermetic)."""

import pytest

from app import config
from app.config import MODEL_API_URL_DEFAULT, VOICE_API_URL_DEFAULT, load_settings

_ENV_KEYS = (
    "MODEL_API_KEY",
    "META_API_KEY",
    "META_MODEL_API_URL",
    "META_VOICE_API_URL",
    "META_MODEL_NAME",
    "META_VOICE_MODEL",
    "META_REQUEST_TIMEOUT_S",
)


@pytest.fixture(autouse=True)
def _isolated_env(monkeypatch):
    monkeypatch.setattr(config, "_load_repo_dotenv", lambda: None)
    for key in _ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


def test_model_api_key_is_primary(monkeypatch):
    monkeypatch.setenv("MODEL_API_KEY", "primary")
    monkeypatch.setenv("META_API_KEY", "legacy")
    assert load_settings().meta_api_key == "primary"


def test_meta_api_key_is_fallback(monkeypatch):
    monkeypatch.setenv("META_API_KEY", "legacy")
    assert load_settings().meta_api_key == "legacy"


def test_default_official_endpoints():
    settings = load_settings()
    assert settings.meta_api_key is None
    assert settings.meta_model_api_url == MODEL_API_URL_DEFAULT
    assert settings.meta_voice_api_url == VOICE_API_URL_DEFAULT
    assert MODEL_API_URL_DEFAULT == "https://api.meta.ai/v1/chat/completions"
    assert VOICE_API_URL_DEFAULT == "https://api.meta.ai/v1/asr/transcribe"


def test_endpoint_overrides(monkeypatch):
    monkeypatch.setenv("META_MODEL_API_URL", "https://stub.invalid/model")
    monkeypatch.setenv("META_VOICE_API_URL", "https://stub.invalid/voice")
    settings = load_settings()
    assert settings.meta_model_api_url == "https://stub.invalid/model"
    assert settings.meta_voice_api_url == "https://stub.invalid/voice"
