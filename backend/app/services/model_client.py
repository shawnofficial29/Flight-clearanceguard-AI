"""Meta Model API client with strict structured-output parsing.

Contract: POSTs a chat-completions-style body with an explicit JSON schema to
the full endpoint URL from META_MODEL_API_URL, then validates the returned
object against the caller's Pydantic model. Transport is injectable so tests
can stub the network. Only status, structured outputs, and tool results are
surfaced — never model chain-of-thought.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from ..config import Settings, live_model_available

T = TypeVar("T", bound=BaseModel)

# Transport: (url, headers, json_body, timeout_s) -> decoded JSON response.
JsonTransport = Callable[[str, dict[str, str], dict[str, Any], float], dict[str, Any]]


class ModelNotConfiguredError(Exception):
    """Raised when no API key or endpoint URL is configured."""


BODY_SNIPPET_LIMIT = 2000


class MetaAPIError(Exception):
    """Raised for transport failures, bad HTTP status, or unparsable replies.

    Sanitized by construction: carries only the HTTP status and response body
    text, never the Authorization header or API key.
    """

    def __init__(
        self, message: str, *, status_code: int | None = None, body: str | None = None
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.body = body


def httpx_post_json(url: str, headers: dict[str, str], body: dict[str, Any], timeout_s: float) -> dict[str, Any]:
    import httpx

    try:
        response = httpx.post(url, headers=headers, json=body, timeout=timeout_s)
    except httpx.TimeoutException as exc:
        raise MetaAPIError(f"Meta API request timed out after {timeout_s:g}s.") from exc
    except httpx.RequestError as exc:
        raise MetaAPIError(f"Meta API request failed: {exc}.") from exc
    if response.status_code >= 400:
        snippet = response.text[:BODY_SNIPPET_LIMIT]
        raise MetaAPIError(
            f"Meta API HTTP {response.status_code}: {snippet}",
            status_code=response.status_code,
            body=snippet,
        )
    try:
        decoded = response.json()
    except ValueError as exc:
        raise MetaAPIError(
            "Meta API returned a non-JSON response.", status_code=response.status_code
        ) from exc
    if not isinstance(decoded, dict):
        raise MetaAPIError(
            "Meta API returned an unexpected response shape.", status_code=response.status_code
        )
    return decoded


def extract_json_payload(body: dict[str, Any]) -> dict[str, Any]:
    """Pull the model's JSON object out of common response envelopes."""
    if "choices" in body:
        try:
            content = body["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise MetaAPIError("Meta API response had no usable choice content.") from exc
        if isinstance(content, dict):
            return content
        if isinstance(content, str):
            try:
                parsed = json.loads(content)
            except json.JSONDecodeError as exc:
                raise MetaAPIError("Model choice content was not valid JSON.") from exc
            if not isinstance(parsed, dict):
                raise MetaAPIError("Model choice content was not a JSON object.")
            return parsed
        raise MetaAPIError("Model choice content had an unexpected type.")
    for key in ("output_text", "text", "content"):
        value = body.get(key)
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict):
                return parsed
    return body


class MetaModelClient:
    def __init__(self, settings: Settings, transport: JsonTransport | None = None) -> None:
        self._settings = settings
        self._transport = transport or httpx_post_json

    @property
    def model_name(self) -> str:
        return self._settings.meta_model_name

    def complete_json(
        self,
        *,
        system: str,
        user: str,
        schema_name: str,
        payload_model: type[T],
    ) -> T:
        if not live_model_available(self._settings):
            raise ModelNotConfiguredError("META_API_KEY/META_MODEL_API_URL are not set.")
        assert self._settings.meta_model_api_url
        assert self._settings.meta_api_key
        body = {
            "model": self._settings.meta_model_name,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": schema_name,
                    "schema": payload_model.model_json_schema(),
                },
            },
        }
        headers = {
            "Authorization": f"Bearer {self._settings.meta_api_key}",
            "Content-Type": "application/json",
        }
        raw = self._transport(
            self._settings.meta_model_api_url, headers, body, self._settings.request_timeout_s
        )
        payload = extract_json_payload(raw)
        try:
            return payload_model.model_validate(payload)
        except ValidationError as exc:
            raise MetaAPIError(f"Model output failed strict validation: {exc.errors()}.") from exc
