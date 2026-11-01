"""Strict live coordinator smoke test on the MERIT scenario.

Usage: .\\.venv\\Scripts\\python backend\\scripts\\coordinator_smoke.py
Requires MODEL_API_KEY, live_meta_api provenance, native tool calls covering
all five analysis tools plus verification, and a deterministic VERIFIED final
candidate. Fails on fallback, invented candidate, override, or unsafe result.
Exit codes: 0 pass, 1 verification failure, 2 not configured.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents import atc_intent, coordinator, pilot_intent  # noqa: E402
from app.config import Settings, live_model_available, load_settings  # noqa: E402
from app.fixtures import DEMO_ATC_TRANSCRIPT, DEMO_PILOT_TRANSCRIPT  # noqa: E402
from app.scenarios import SCENARIOS  # noqa: E402
from app.services import comparison, fms, resolutions  # noqa: E402
from app.services.model_client import MetaAPIError, ModelNotConfiguredError  # noqa: E402

REQUIRED_TOOLS = {
    "compare_intents",
    "predict_conflict",
    "calculate_safety_window",
    "enumerate_verified_corrections",
    "verify_resolution",
}


def _redact(text: str, settings: Settings) -> str:
    key = settings.meta_api_key
    return text.replace(key, "***") if key else text


def main() -> int:
    settings = load_settings()
    print(f"model: {settings.meta_model_name} @ {settings.meta_model_api_url}")
    if not live_model_available(settings):
        print("COORD-SMOKE-ERROR: no API key. Set MODEL_API_KEY in .env.")
        return 2
    geometry = SCENARIOS["early-climb"].geometry
    try:
        result = coordinator.coordinate(
            DEMO_ATC_TRANSCRIPT,
            DEMO_PILOT_TRANSCRIPT,
            settings,
            geometry,
            strict_live=True,
        )
    except ModelNotConfiguredError:
        print("COORD-SMOKE-ERROR: no API key. Set MODEL_API_KEY in .env.")
        return 2
    except MetaAPIError as exc:
        print("COORD-SMOKE-FAIL: live coordinator call failed (no fallback in strict mode).")
        print(f"HTTP status: {exc.status_code}")
        print(f"response body: {_redact(exc.body or str(exc), settings)}")
        return 1

    print(f"provenance: {result.provenance} ({result.model})")
    print("native tool calls in order:")
    for record in result.tool_calls:
        print(f"  turn {record.turn}: {record.tool} ok={record.ok}")
    print(f"recommended: {result.recommended_candidate_id} overridden={result.overridden}")

    if result.provenance != "live_meta_api":
        print(f"COORD-SMOKE-FAIL: provenance is {result.provenance}; fixture refused.")
        return 1
    executed = {c.tool for c in result.tool_calls if c.ok}
    missing = REQUIRED_TOOLS - executed
    if missing:
        print(f"COORD-SMOKE-FAIL: required tools not executed ok: {sorted(missing)}.")
        return 1

    # Deterministic cross-check: the final id must be a VERIFIED candidate.
    atc = atc_intent.parse_atc(DEMO_ATC_TRANSCRIPT, settings, strict_live=True)
    pilot = pilot_intent.parse_pilot(DEMO_PILOT_TRANSCRIPT, settings, strict_live=True)
    program = fms.program_from_intent(pilot, source="pilot")
    matrix = comparison.build_matrix(atc, pilot, program)
    deterministic = {
        c.id: c for c in resolutions.enumerate_candidates(atc, pilot, matrix, geometry)
    }
    final = deterministic.get(result.recommended_candidate_id or "")
    if final is None:
        print(f"COORD-SMOKE-FAIL: invented candidate '{result.recommended_candidate_id}'.")
        return 1
    if result.overridden:
        print("COORD-SMOKE-FAIL: model recommendation was overridden.")
        return 1
    if final.verification != "VERIFIED" or final.conflict_after:
        print(f"COORD-SMOKE-FAIL: unsafe result ({final.verification}, conflict={final.conflict_after}).")
        return 1
    print(f"summary: {result.summary}")
    print("COORD-SMOKE-PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
