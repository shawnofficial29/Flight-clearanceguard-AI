"""FastAPI application: agent routes, deterministic tools, demo sequence."""

from __future__ import annotations

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .agents import atc_intent, explanation, pilot_intent
from .config import live_model_available, live_voice_available, load_settings
from .demo import reset_session, run_correction, run_demo
from .models import (
    Clearance,
    CompareRequest,
    ComparisonMatrix,
    ConflictPrediction,
    ConflictRequest,
    CorrectionResult,
    DemoRequest,
    DemoResult,
    ExplainRequest,
    Explanation,
    FMSProgram,
    FMSRequest,
    ParseRequest,
    VoiceTranscript,
)
from .scenarios import SCENARIOS, get_scenario
from .services import comparison, conflict, fms, voice
from .services.voice import VoiceAPIError

app = FastAPI(title="ClearanceGuard AI", version="0.2.0-depth")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
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
    return fms.program_from_intent(request.intent, source=request.source)


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


@app.post("/api/demo/correct", response_model=CorrectionResult)
def demo_correct(request: DemoRequest) -> CorrectionResult:
    return run_correction(load_settings(), use_live=request.use_live, scenario_id=request.scenario_id)


@app.post("/api/session/reset")
def session_reset() -> dict[str, str]:
    return reset_session()
