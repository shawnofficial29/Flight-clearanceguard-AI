"""Environment-only configuration. No credentials are hardcoded or committed."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

MODEL_NAME = "muse-spark-1.3"
VOICE_MODEL_NAME = "muse-voice-transcribe-1.0"
MODEL_API_URL_DEFAULT = "https://api.meta.ai/v1/chat/completions"
VOICE_API_URL_DEFAULT = "https://api.meta.ai/v1/asr/transcribe"
DEFAULT_TIMEOUT_S = 20.0


@dataclass(frozen=True)
class Settings:
    """Secrets come from the environment; endpoints default to official URLs."""

    meta_api_key: str | None
    meta_model_api_url: str
    meta_voice_api_url: str
    meta_model_name: str = MODEL_NAME
    meta_voice_model: str = VOICE_MODEL_NAME
    request_timeout_s: float = DEFAULT_TIMEOUT_S


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _load_repo_dotenv() -> None:
    """Load the repository .env for local dev; real environment wins."""
    try:
        from dotenv import load_dotenv
    except ImportError:  # pragma: no cover - dotenv is a declared dependency
        return
    repo_env = Path(__file__).resolve().parents[2] / ".env"
    if repo_env.is_file():
        load_dotenv(repo_env, override=False)


def load_settings() -> Settings:
    _load_repo_dotenv()
    timeout_raw = _clean(os.environ.get("META_REQUEST_TIMEOUT_S"))
    try:
        timeout = float(timeout_raw) if timeout_raw else DEFAULT_TIMEOUT_S
    except ValueError:
        timeout = DEFAULT_TIMEOUT_S
    key = _clean(os.environ.get("MODEL_API_KEY")) or _clean(os.environ.get("META_API_KEY"))
    return Settings(
        meta_api_key=key,
        meta_model_api_url=_clean(os.environ.get("META_MODEL_API_URL")) or MODEL_API_URL_DEFAULT,
        meta_voice_api_url=_clean(os.environ.get("META_VOICE_API_URL")) or VOICE_API_URL_DEFAULT,
        meta_model_name=_clean(os.environ.get("META_MODEL_NAME")) or MODEL_NAME,
        meta_voice_model=_clean(os.environ.get("META_VOICE_MODEL")) or VOICE_MODEL_NAME,
        request_timeout_s=timeout,
    )


def live_model_available(settings: Settings) -> bool:
    return bool(settings.meta_api_key and settings.meta_model_api_url)


def live_voice_available(settings: Settings) -> bool:
    return bool(settings.meta_api_key and settings.meta_voice_api_url)
