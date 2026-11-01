"""FastAPI application: agent routes, deterministic tools, demo sequence."""

from __future__ import annotations

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .agents import atc_intent, explanation, pilot_intent
from .config import live_model_available, live_voice_available, load_settings
from .demo import reset_session, run_correction, run_demo
from .models import (
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
    StructuredIntent,
    VoiceTranscript,
)
from .services import comparison, conflict, fms, voice
from .services.voice import VoiceAPIError

app = FastAPI(title="ClearanceGuard AI", version="0.1.0-day1")

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


@app.post("/api/atc/parse", response_model=StructuredIntent)
def parse_atc(request: ParseRequest) -> StructuredIntent:
    return atc_intent.parse_atc(request.transcript, load_settings(), force_fixture=not request.use_live)


@app.post("/api/pilot/parse", response_model=StructuredIntent)
def parse_pilot(request: ParseRequest) -> StructuredIntent:
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
    return conflict.predict(request.fms)


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
    return run_demo(load_settings(), use_live=request.use_live)


@app.post("/api/demo/correct", response_model=CorrectionResult)
def demo_correct(request: DemoRequest) -> CorrectionResult:
    return run_correction(load_settings(), use_live=request.use_live)


@app.post("/api/session/reset")
def session_reset() -> dict[str, str]:
    return reset_session()
