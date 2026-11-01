"""Live Meta smoke test: ATC + pilot parsing against muse-spark-1.3.

Reads MODEL_API_KEY (or legacy META_API_KEY) from the environment / repo .env.
Never touches fixtures silently: any fixture fallback is a hard failure.

Exit codes: 0 pass, 1 verification failure, 2 not configured.
Run from the repo root: .\\.venv\\Scripts\\python backend\\scripts\\live_smoke.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents import atc_intent, pilot_intent  # noqa: E402
from app.config import Settings, live_model_available, load_settings  # noqa: E402
from app.fixtures import DEMO_ATC_TRANSCRIPT, DEMO_PILOT_TRANSCRIPT, MISSING_PHRASE  # noqa: E402
from app.services import comparison, conflict, fms  # noqa: E402
from app.services.model_client import MetaAPIError, ModelNotConfiguredError  # noqa: E402

FAILURES: list[str] = []


def fail(message: str) -> None:
    FAILURES.append(message)
    print(f"SMOKE-FAIL: {message}")


def _redact(text: str, settings: Settings) -> str:
    key = settings.meta_api_key
    return text.replace(key, "***") if key else text


def main() -> int:
    settings = load_settings()
    print(f"model: {settings.meta_model_name} @ {settings.meta_model_api_url}")
    if not live_model_available(settings):
        print("SMOKE-ERROR: no API key. Set MODEL_API_KEY in .env (see .env.example).")
        return 2

    try:
        atc = atc_intent.parse_atc(DEMO_ATC_TRANSCRIPT, settings, strict_live=True)
        pilot = pilot_intent.parse_pilot(DEMO_PILOT_TRANSCRIPT, settings, strict_live=True)
    except ModelNotConfiguredError:
        print("SMOKE-ERROR: no API key. Set MODEL_API_KEY in .env (see .env.example).")
        return 2
    except MetaAPIError as exc:
        print("SMOKE-FAIL: live Meta call failed (no fixture fallback in strict mode).")
        print(f"HTTP status: {exc.status_code}")
        print(f"response body: {_redact(exc.body or str(exc), settings)}")
        return 1
    print(f"atc provenance: {atc.provenance} ({atc.model})")
    print(f"pilot provenance: {pilot.provenance} ({pilot.model})")
    if atc.provenance != "live_meta_api":
        fail(f"ATC parse used {atc.provenance}; expected live_meta_api.")
    if pilot.provenance != "live_meta_api":
        fail(f"Pilot parse used {pilot.provenance}; expected live_meta_api.")
    if FAILURES:
        return 1

    if atc.climb_condition_fix != "MERIT":
        fail(f"ATC condition fix is {atc.climb_condition_fix!r}; expected 'MERIT'.")
    if pilot.climb_condition_fix is not None or pilot.climb_condition_type is not None:
        fail(
            "Pilot readback must leave the unstated condition null; got "
            f"{pilot.climb_condition_type!r}/{pilot.climb_condition_fix!r}."
        )

    program = fms.program_from_intent(pilot, source="pilot")
    matrix = comparison.build_matrix(atc, pilot, program)
    print(f"comparison overall: {matrix.overall}; missing: {matrix.missing_phrase}")
    if not matrix.missing_condition or matrix.missing_phrase != MISSING_PHRASE:
        fail(f"Missing '{MISSING_PHRASE}' condition was not detected.")
    prediction = conflict.predict(program)
    print(
        f"conflict: {prediction.conflict} "
        f"(T+{prediction.first_conflict_time_s}s, "
        f"{prediction.lateral_nm_at_conflict} NM, "
        f"{prediction.vertical_ft_at_conflict} ft)"
    )

    if FAILURES:
        return 1
    print("SMOKE-PASS: live ATC + pilot parse, missing MERIT condition detected.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
