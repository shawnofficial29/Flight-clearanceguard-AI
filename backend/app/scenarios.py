"""Scenario registry: three complete clearance arcs with resolution paths."""

from __future__ import annotations

from dataclasses import dataclass

from .agents import atc_intent, explanation, pilot_intent
from .config import Settings
from .fixtures import DEMO_ATC_TRANSCRIPT, DEMO_PILOT_TRANSCRIPT
from .models import BADGE_LABELS, CorrectionResult, DemoResult, ScenarioGeometry, ScenarioResult
from .services import comparison, conflict, fms
from .services.model_client import JsonTransport

DEFAULT_GEOMETRY = ScenarioGeometry()
DESCENT_GEOMETRY = ScenarioGeometry(own_init_alt_ft=12000.0, intruder_alt_ft=10000.0)


@dataclass(frozen=True)
class Scenario:
    id: str
    title: str
    atc_text: str
    pilot_text: str
    corrected_text: str
    geometry: ScenarioGeometry
    expect_overall: str
    expect_categories: frozenset[str]
    expect_conflict: bool


SCENARIOS: dict[str, Scenario] = {
    "early-climb": Scenario(
        id="early-climb",
        title="Missing AFTER MERIT condition causes early-climb conflict",
        atc_text=DEMO_ATC_TRANSCRIPT,
        pilot_text=DEMO_PILOT_TRANSCRIPT,
        corrected_text=DEMO_ATC_TRANSCRIPT,
        geometry=DEFAULT_GEOMETRY,
        expect_overall="mismatch",
        expect_categories=frozenset({"MISSING_CONDITION"}),
        expect_conflict=True,
    ),
    "altitude-value": Scenario(
        id="altitude-value",
        title="ATC assigns 11,000 ft while pilot/FMS uses 10,000 ft",
        atc_text="META 452, descend to 11,000 feet.",
        pilot_text="META 452, descend to 10,000 feet.",
        corrected_text="META 452, descend to 11,000 feet.",
        geometry=DESCENT_GEOMETRY,
        expect_overall="mismatch",
        expect_categories=frozenset({"CHANGED_VALUE"}),
        expect_conflict=True,
    ),
    "wrong-direct": Scenario(
        id="wrong-direct",
        title="Incorrect direct-to waypoint (MERIT instead of PONCT)",
        atc_text="META 452, proceed direct PONCT.",
        pilot_text="META 452, proceed direct MERIT.",
        corrected_text="META 452, proceed direct PONCT.",
        geometry=DEFAULT_GEOMETRY,
        expect_overall="mismatch",
        expect_categories=frozenset({"CHANGED_WAYPOINT"}),
        expect_conflict=False,
    ),
}

DEFAULT_SCENARIO_ID = "early-climb"


def get_scenario(scenario_id: str | None) -> Scenario:
    if not scenario_id:
        return SCENARIOS[DEFAULT_SCENARIO_ID]
    try:
        return SCENARIOS[scenario_id]
    except KeyError as exc:
        known = ", ".join(sorted(SCENARIOS))
        raise ValueError(f"Unknown scenario '{scenario_id}'. Known: {known}.") from exc


def run_scenario(
    scenario: Scenario,
    settings: Settings,
    transport: JsonTransport | None = None,
    *,
    use_live: bool = False,
) -> ScenarioResult:
    force_fixture = not use_live
    atc = atc_intent.parse_atc(scenario.atc_text, settings, transport, force_fixture=force_fixture)
    pilot = pilot_intent.parse_pilot(
        scenario.pilot_text, settings, transport, force_fixture=force_fixture
    )
    program = fms.program_from_intent(pilot, source="pilot")
    matrix = comparison.build_matrix(atc, pilot, program)
    prediction = conflict.predict(program, scenario.geometry)
    narrative = explanation.explain(
        matrix,
        prediction,
        settings,
        transport,
        atc_text=scenario.atc_text,
        pilot_text=scenario.pilot_text,
        force_fixture=force_fixture,
    )
    initial = DemoResult(
        atc_transcript=scenario.atc_text,
        pilot_transcript=scenario.pilot_text,
        atc=atc,
        pilot=pilot,
        fms=program,
        comparison=matrix,
        conflict=prediction,
        explanation=narrative,
        badges={step: BADGE_LABELS[prov] for step, prov in (("atc", atc.provenance), ("pilot", pilot.provenance), ("explanation", narrative.provenance))},
    )

    corrected_pilot = pilot_intent.parse_pilot(
        scenario.corrected_text, settings, transport, force_fixture=force_fixture
    )
    corrected_program = fms.program_corrected(atc)
    corrected_matrix = comparison.build_matrix(atc, corrected_pilot, corrected_program)
    corrected_prediction = conflict.predict(corrected_program, scenario.geometry)
    corrected_narrative = explanation.explain(
        corrected_matrix,
        corrected_prediction,
        settings,
        transport,
        atc_text=scenario.atc_text,
        pilot_text=scenario.corrected_text,
        force_fixture=force_fixture,
    )
    resolved = corrected_matrix.overall == "agree" and not corrected_prediction.conflict
    corrected = CorrectionResult(
        fms=corrected_program,
        comparison=corrected_matrix,
        conflict=corrected_prediction,
        explanation=corrected_narrative,
        resolved=resolved,
        badges={
            "correction": BADGE_LABELS[corrected_program.provenance],
            "explanation": BADGE_LABELS[corrected_narrative.provenance],
        },
    )
    return ScenarioResult(
        scenario_id=scenario.id, initial=initial, corrected=corrected, resolved=resolved
    )
