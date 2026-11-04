"""FastAPI application: agent routes, deterministic tools, demo sequence."""

from __future__ import annotations

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .agents import atc_intent, coordinator, explanation, pilot_intent
from .config import live_model_available, live_voice_available, load_settings
from .demo import reset_session, run_correction, run_demo
from .models import (
    AuditEvent,
    AuditVerify,
    Clearance,
    CompareRequest,
    ComparisonMatrix,
    ConflictPrediction,
    ConflictRequest,
    CoordinateRequest,
    CoordinationResult,
    CorrectionResult,
    CustomDemoRequest,
    DemoRequest,
    DemoResult,
    EnumerateRequest,
    ExplainRequest,
    Explanation,
    FingerprintRequest,
    Fingerprints,
    FMSProgram,
    FMSRequest,
    ParseRequest,
    ResolutionCandidate,
    SafetyWindow,
    SafetyWindowRequest,
    VerificationResult,
    VerifyRequest,
    VoiceTranscript,
)
from .scenarios import CUSTOM_SCENARIO_ID, SCENARIOS, get_scenario, register_custom_scenario
from .services import audit, comparison, conflict, fingerprints, fms, resolutions, safety, voice
from .services.conflict import DEFAULT_GEOMETRY
from .services.voice import VoiceAPIError

app = FastAPI(title="ClearanceGuard AI", version="0.2.0-depth")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:5175",
        "http://127.0.0.1:5175",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, object]:
    settings = load_settings()
    return {
        "status": "ok",
        "model": settings.meta_model_name,
        "voice_model": settings.meta_voice_model,
        "meta_api_configured": live_model_available(settings),
        "voice_configured": live_voice_available(settings),
    }


@app.get("/api/scenarios")
def list_scenarios() -> dict[str, object]:
    return {
        "scenarios": [
            {"id": scenario.id, "title": scenario.title} for scenario in SCENARIOS.values()
        ]
    }


@app.post("/api/atc/parse", response_model=Clearance)
def parse_atc(request: ParseRequest) -> Clearance:
    return atc_intent.parse_atc(request.transcript, load_settings(), force_fixture=not request.use_live)


@app.post("/api/pilot/parse", response_model=Clearance)
def parse_pilot(request: ParseRequest) -> Clearance:
    return pilot_intent.parse_pilot(
        request.transcript, load_settings(), force_fixture=not request.use_live
    )


@app.post("/api/voice/transcribe", response_model=VoiceTranscript)
async def transcribe(file: UploadFile = File(...), use_live: bool = False) -> VoiceTranscript:
    audio = await file.read()
    try:
        return voice.transcribe_wav(
            file.filename or "audio.wav", audio, load_settings(), force_fixture=not use_live
        )
    except VoiceAPIError as exc:
        return VoiceTranscript(
            transcript="",
            provenance="fixture_fallback",
            model="none",
            source_file=file.filename or "audio.wav",
            note=str(exc),
        )


@app.post("/api/fms/program", response_model=FMSProgram)
def program_fms(request: FMSRequest) -> FMSProgram:
    drop = get_scenario(request.scenario_id).fms_drops_condition if request.scenario_id else False
    return fms.program_from_intent(request.intent, source=request.source, drop_condition=drop)


@app.post("/api/compare", response_model=ComparisonMatrix)
def compare(request: CompareRequest) -> ComparisonMatrix:
    return comparison.build_matrix(request.atc, request.pilot, request.fms)


@app.post("/api/conflict/predict", response_model=ConflictPrediction)
def predict_conflict(request: ConflictRequest) -> ConflictPrediction:
    geometry = get_scenario(request.scenario_id).geometry if request.scenario_id else None
    return conflict.predict(request.fms, geometry)


@app.post("/api/explain", response_model=Explanation)
def explain(request: ExplainRequest) -> Explanation:
    return explanation.explain(
        request.comparison,
        request.conflict,
        load_settings(),
        atc_text=request.atc_text,
        pilot_text=request.pilot_text,
        force_fixture=not request.use_live,
    )


@app.post("/api/demo/run", response_model=DemoResult)
def demo_run(request: DemoRequest) -> DemoResult:
    return run_demo(load_settings(), use_live=request.use_live, scenario_id=request.scenario_id)


@app.post("/api/demo/run-custom", response_model=DemoResult)
def demo_run_custom(request: CustomDemoRequest) -> DemoResult:
    try:
        register_custom_scenario(request.atc_text)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return run_demo(load_settings(), use_live=request.use_live, scenario_id=CUSTOM_SCENARIO_ID)


@app.post("/api/demo/correct", response_model=CorrectionResult)
def demo_correct(request: DemoRequest) -> CorrectionResult:
    return run_correction(load_settings(), use_live=request.use_live, scenario_id=request.scenario_id)


@app.post("/api/session/reset")
def session_reset() -> dict[str, str]:
    return reset_session()


@app.post("/api/safety/window", response_model=SafetyWindow)
def safety_window(request: SafetyWindowRequest) -> SafetyWindow:
    geometry = get_scenario(request.scenario_id).geometry if request.scenario_id else DEFAULT_GEOMETRY
    matrix = comparison.build_matrix(request.atc, request.pilot, request.fms)
    return safety.calculate(request.atc, request.fms, matrix.findings, geometry)


@app.post("/api/resolutions/enumerate", response_model=list[ResolutionCandidate])
def enumerate_resolutions(request: EnumerateRequest) -> list[ResolutionCandidate]:
    geometry = get_scenario(request.scenario_id).geometry if request.scenario_id else DEFAULT_GEOMETRY
    matrix = comparison.build_matrix(request.atc, request.pilot, request.fms)
    return resolutions.enumerate_candidates(request.atc, request.pilot, matrix, geometry)


@app.post("/api/resolutions/verify", response_model=VerificationResult)
def verify_resolution(request: VerifyRequest) -> VerificationResult:
    geometry = get_scenario(request.scenario_id).geometry if request.scenario_id else DEFAULT_GEOMETRY
    matrix = comparison.build_matrix(request.atc, request.pilot, request.fms)
    return resolutions.verify_candidate(request.candidate_id, request.atc, request.pilot, matrix, geometry)


@app.post("/api/fingerprints", response_model=Fingerprints)
def intent_fingerprints(request: FingerprintRequest) -> Fingerprints:
    return fingerprints.fingerprints(request.atc, request.pilot, request.fms)


@app.get("/api/audit/events", response_model=list[AuditEvent])
def audit_events() -> list[AuditEvent]:
    return audit.events()


@app.get("/api/audit/verify", response_model=AuditVerify)
def audit_verify() -> AuditVerify:
    return audit.verify()


@app.post("/api/coordinate", response_model=CoordinationResult)
def coordinate_resolution(request: CoordinateRequest) -> CoordinationResult:
    scenario = get_scenario(request.scenario_id) if request.scenario_id else None
    geometry = scenario.geometry if scenario else DEFAULT_GEOMETRY
    drop = scenario.fms_drops_condition if scenario else False
    return coordinator.coordinate(
        request.atc_text,
        request.pilot_text,
        load_settings(),
        geometry,
        use_live=request.use_live,
        drop_fms_condition=drop,
    )
