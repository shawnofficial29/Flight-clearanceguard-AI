"""Demo scenario, one-click deterministic sequence, and in-memory session."""

from __future__ import annotations

from typing import Any

from .agents import atc_intent, explanation, pilot_intent
from .config import Settings
from .fixtures import DEMO_ATC_TRANSCRIPT, DEMO_PILOT_TRANSCRIPT
from .models import BADGE_LABELS, CorrectionResult, DemoResult
from .services import comparison, conflict, fms
from .services.model_client import JsonTransport

CORRECTED_PILOT_TRANSCRIPT = (
    "META 452, after passing MERIT, climb to flight level 230 and proceed direct PONCT."
)

_SESSION: dict[str, Any] = {}


def reset_session() -> dict[str, str]:
    _SESSION.clear()
    return {"status": "reset"}


def _badges(*provenances: tuple[str, str]) -> dict[str, str]:
    return {step: BADGE_LABELS[prov] for step, prov in provenances}


def run_demo(
    settings: Settings,
    transport: JsonTransport | None = None,
    *,
    use_live: bool = False,
) -> DemoResult:
    force_fixture = not use_live
    atc = atc_intent.parse_atc(DEMO_ATC_TRANSCRIPT, settings, transport, force_fixture=force_fixture)
    pilot = pilot_intent.parse_pilot(
        DEMO_PILOT_TRANSCRIPT, settings, transport, force_fixture=force_fixture
    )
    program = fms.program_from_intent(pilot, source="pilot")
    matrix = comparison.build_matrix(atc, pilot, program)
    prediction = conflict.predict(program)
    narrative = explanation.explain(
        matrix,
        prediction,
        settings,
        transport,
        atc_text=DEMO_ATC_TRANSCRIPT,
        pilot_text=DEMO_PILOT_TRANSCRIPT,
        force_fixture=force_fixture,
    )
    result = DemoResult(
        atc_transcript=DEMO_ATC_TRANSCRIPT,
        pilot_transcript=DEMO_PILOT_TRANSCRIPT,
        atc_intent=atc,
        pilot_intent=pilot,
        fms=program,
        comparison=matrix,
        conflict=prediction,
        explanation=narrative,
        badges=_badges(
            ("atc", atc.provenance),
            ("pilot", pilot.provenance),
            ("explanation", narrative.provenance),
        ),
    )
    _SESSION["last_demo"] = result.model_dump()
    _SESSION["corrected"] = False
    return result


def run_correction(
    settings: Settings,
    transport: JsonTransport | None = None,
    *,
    use_live: bool = False,
) -> CorrectionResult:
    """Simulated pilot action: reprogram the FMS from the ATC clearance."""
    force_fixture = not use_live
    atc = atc_intent.parse_atc(DEMO_ATC_TRANSCRIPT, settings, transport, force_fixture=force_fixture)
    pilot = pilot_intent.parse_pilot(
        CORRECTED_PILOT_TRANSCRIPT, settings, transport, force_fixture=force_fixture
    )
    program = fms.program_corrected(atc)
    matrix = comparison.build_matrix(atc, pilot, program)
    prediction = conflict.predict(program)
    narrative = explanation.explain(
        matrix,
        prediction,
        settings,
        transport,
        atc_text=DEMO_ATC_TRANSCRIPT,
        pilot_text=CORRECTED_PILOT_TRANSCRIPT,
        force_fixture=force_fixture,
    )
    resolved = not prediction.conflict
    result = CorrectionResult(
        fms=program,
        comparison=matrix,
        conflict=prediction,
        explanation=narrative,
        resolved=resolved,
        badges=_badges(("correction", program.provenance), ("explanation", narrative.provenance)),
    )
    _SESSION["last_correction"] = result.model_dump()
    _SESSION["corrected"] = True
    return result
