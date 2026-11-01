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


class ToolCall:
    """One native assistant tool call with parsed arguments."""

    def __init__(self, call_id: str, name: str, arguments: dict[str, Any]) -> None:
        self.id = call_id
        self.name = name
        self.arguments = arguments


class AssistantMessage:
    """Assistant reply: optional content, native tool calls, raw round-trip dict."""

    def __init__(self, content: str | None, tool_calls: list[ToolCall], raw: dict[str, Any]) -> None:
        self.content = content
        self.tool_calls = tool_calls
        self.raw = raw


def parse_assistant_message(message: dict[str, Any]) -> AssistantMessage:
    if not isinstance(message, dict):
        raise MetaAPIError("Model message had an unexpected shape.")
    content = message.get("content")
    if content is not None and not isinstance(content, str):
        raise MetaAPIError("Model message content had an unexpected type.")
    tool_calls: list[ToolCall] = []
    raw_calls = message.get("tool_calls") or []
    if not isinstance(raw_calls, list):
        raise MetaAPIError("Model tool_calls had an unexpected shape.")
    for raw in raw_calls:
        try:
            call_id = raw["id"]
            name = raw["function"]["name"]
            raw_args = raw["function"].get("arguments", "{}")
        except (KeyError, TypeError) as exc:
            raise MetaAPIError("Model tool call was missing id, name, or arguments.") from exc
        if not isinstance(call_id, str) or not isinstance(name, str):
            raise MetaAPIError("Model tool call id/name had an unexpected type.")
        try:
            arguments = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
        except json.JSONDecodeError as exc:
            raise MetaAPIError(f"Tool call '{name}' arguments were not valid JSON.") from exc
        if not isinstance(arguments, dict):
            raise MetaAPIError(f"Tool call '{name}' arguments were not a JSON object.")
        tool_calls.append(ToolCall(call_id, name, arguments))
    return AssistantMessage(content, tool_calls, message)


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
            raise ModelNotConfiguredError("MODEL_API_KEY is not set.")
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

    def chat_with_tools(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
    ) -> AssistantMessage:
        """Send messages plus native function tools; parse tool_calls strictly."""
        if not live_model_available(self._settings):
            raise ModelNotConfiguredError("MODEL_API_KEY is not set.")
        assert self._settings.meta_model_api_url
        assert self._settings.meta_api_key
        body = {
            "model": self._settings.meta_model_name,
            "messages": messages,
            "tools": tools,
        }
        headers = {
            "Authorization": f"Bearer {self._settings.meta_api_key}",
            "Content-Type": "application/json",
        }
        raw = self._transport(
            self._settings.meta_model_api_url, headers, body, self._settings.request_timeout_s
        )
        try:
            message = raw["choices"][0]["message"]
        except (KeyError, IndexError, TypeError) as exc:
            raise MetaAPIError("Model response had no usable choice message.") from exc
        return parse_assistant_message(message)
