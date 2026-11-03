"""Demo scenario, one-click deterministic sequence, and in-memory session."""

from __future__ import annotations

from typing import Any

from .config import Settings
from .models import CorrectionResult, DemoResult
from .scenarios import get_scenario, run_scenario
from .services import audit
from .services.model_client import JsonTransport

CORRECTED_PILOT_TRANSCRIPT = (
    "META 452, reduce speed to 250 knots now. "
    "After MERIT, descend and maintain 15,000 feet."
)

_SESSION: dict[str, Any] = {}


def reset_session() -> dict[str, str]:
    """Start a clean demonstration session, including the audit chain."""
    _SESSION.clear()
    audit.reset_chain()
    return {"status": "reset"}


def run_demo(
    settings: Settings,
    transport: JsonTransport | None = None,
    *,
    use_live: bool = False,
    scenario_id: str | None = None,
) -> DemoResult:
    scenario = get_scenario(scenario_id)
    result = run_scenario(scenario, settings, transport, use_live=use_live)
    _SESSION["last_demo"] = result.initial.model_dump()
    _SESSION["corrected"] = False
    _SESSION["scenario_id"] = scenario.id
    return result.initial


def run_correction(
    settings: Settings,
    transport: JsonTransport | None = None,
    *,
    use_live: bool = False,
    scenario_id: str | None = None,
) -> CorrectionResult:
    """Simulated pilot action: reprogram the FMS from the ATC clearance."""
    scenario = get_scenario(scenario_id or _SESSION.get("scenario_id"))
    result = run_scenario(scenario, settings, transport, use_live=use_live)
    _SESSION["last_correction"] = result.corrected.model_dump()
    _SESSION["corrected"] = True
    return result.corrected
