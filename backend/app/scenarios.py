"""Scenario registry: the single ATC-vs-pilot altitude-sync arc.

The product runs one scenario (a misheard altitude). The extra geometry
constants below are shared engine fixtures for machinery tests, not scenarios.
"""

from __future__ import annotations

from dataclasses import dataclass

from .agents import atc_intent, explanation, pilot_intent
from .config import Settings
from .models import BADGE_LABELS, CorrectionResult, DemoResult, ScenarioGeometry, ScenarioResult
from .services import audit, comparison, conflict, fms
from .services.model_client import JsonTransport

DESCENT_GEOMETRY = ScenarioGeometry(own_init_alt_ft=12000.0, intruder_alt_ft=10000.0)
ARRIVAL_GEOMETRY = ScenarioGeometry(
    own_init_alt_ft=23000.0,
    intruder_alt_ft=15000.0,
    # -100/9 NM puts the intruder's MERIT-latitude crossing at exactly t=160 s,
    # well before META 452 arrives, keeping 5+ NM at the crossing either way.
    intruder_start_nm=(18.0, -100.0 / 9.0),
    intruder_vel_kt=(0.0, 250.0),
    descend_rate_fpm=2100.0,
    own_speed_kt=290.0,
)
SYNC_GEOMETRY = ScenarioGeometry(
    own_init_alt_ft=23000.0,
    intruder_alt_ft=22000.0,
    intruder_start_nm=(18.0, -100.0 / 9.0),
    intruder_vel_kt=(0.0, 250.0),
    descend_rate_fpm=2100.0,
    own_speed_kt=290.0,
    # Landing tail past MERIT toward the airport: hold the cleared level
    # through the encounter, then descend to 10,000 ft and slow to 175 kt.
    landing_alt_ft=10000.0,
    landing_speed_kt=175.0,
    landing_decel_kt_s=0.25,
)


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
    fms_drops_condition: bool = False


SCENARIOS: dict[str, Scenario] = {
    "altitude-sync": Scenario(
        id="altitude-sync",
        title="Altitude sync — pilot sets 22,000 ft, ATC cleared 23,000 ft",
        atc_text="META 452, maintain 23,000 feet.",
        pilot_text="META 452, maintain 22,000 feet.",
        corrected_text="META 452, maintain 23,000 feet.",
        geometry=SYNC_GEOMETRY,
        expect_overall="mismatch",
        expect_categories=frozenset({"CHANGED_VALUE"}),
        expect_conflict=True,
    ),
}

DEFAULT_SCENARIO_ID = "altitude-sync"


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
    audit.append(
        "parse_atc",
        {"callsign": atc.callsign, "actions": len(atc.actions), "scenario": scenario.id},
        provenance=atc.provenance,
        model=atc.model,
    )
    pilot = pilot_intent.parse_pilot(
        scenario.pilot_text, settings, transport, force_fixture=force_fixture
    )
    audit.append(
        "parse_pilot",
        {"callsign": pilot.callsign, "actions": len(pilot.actions), "scenario": scenario.id},
        provenance=pilot.provenance,
        model=pilot.model,
    )
    program = fms.program_from_intent(
        pilot, source="pilot", drop_condition=scenario.fms_drops_condition
    )
    audit.append("fms_program", {"summary": program.summary, "route": program.route})
    matrix = comparison.build_matrix(atc, pilot, program)
    audit.append(
        "compare",
        {"overall": matrix.overall, "categories": sorted({f.category for f in matrix.findings})},
    )
    prediction = conflict.predict(program, scenario.geometry)
    audit.append(
        "predict_conflict",
        {"conflict": prediction.conflict, "t_s": prediction.first_conflict_time_s},
    )
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
    audit.append(
        "correct_fms",
        {"summary": corrected_program.summary, "route": corrected_program.route},
        human_confirmation="simulated-pilot-confirmed",
    )
    corrected_matrix = comparison.build_matrix(atc, corrected_pilot, corrected_program)
    corrected_prediction = conflict.predict(corrected_program, scenario.geometry)
    audit.append(
        "verify_resolution",
        {"overall": corrected_matrix.overall, "conflict": corrected_prediction.conflict},
        human_confirmation="simulated-pilot-confirmed",
    )
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
    # The ATC plan trajectory rides along for before/after comparison.
    # The corrected profile flies the plan exactly.
    prediction.plan_profile = corrected_prediction.profile
    corrected = CorrectionResult(
        corrected_pilot=corrected_pilot,
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
