# ClearanceGuard AI

Shared 4D ATC clearance verification prototype. Compares ATC intent, pilot
readback, simulated FMS programming, and predicted trajectory — and explains
any mismatch in plain language.

Status: **Day 1 backend complete** (API + agents + deterministic core + tests).
Frontend follows on Day 2.

## Architecture

```text
ATC clearance ──► ATC Intent Agent ──┐
  (typed / WAV)   muse-spark-1.3     │
                                     ▼
Pilot readback ─► Pilot Agent ──► FMS simulator ──► Deterministic ──► 4D conflict
  (Muse Voice /     muse-spark-1.3    (route/level)    comparison      predictor
   typed fallback)                                     (matrix)       (2 aircraft)
                                                                              │
                                                                              ▼
                                                    Verification Explanation Agent
                                                        (plain-language warning)
```

- AI interprets language and explains. Deterministic Python compares and
  predicts. Nothing edits or controls the aircraft.
- State is in-memory only; every result carries a provenance badge: Live Meta
  API, Live Muse Voice, or Fixture fallback.

## Setup

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
copy .env.example .env   # set MODEL_API_KEY for live APIs; optional for fixtures
```

`.env` stays ignored; only `MODEL_API_KEY` is required — model and voice
endpoints default to the official Meta URLs.

## Run

```powershell
.venv\Scripts\Activate.ps1
cd backend
uvicorn app.main:app --port 8000
```

Health: `GET http://127.0.0.1:8000/health`

## Demo script (backend)

1. `POST /api/demo/run {"use_live": false}` — one-click deterministic demo.
   Expect: comparison `mismatch` on Climb condition (`after passing MERIT`
   omitted), FMS immediate climb, predicted conflict (~T+210s, lateral < 5 NM,
   vertical < 1000 ft), plain-language explanation.
2. `POST /api/demo/correct {"use_live": false}` — simulated action
   "Pilot confirms corrected FMS entry". Expect: matrix `agree`, no conflict,
   `resolved: true`.
3. `POST /api/session/reset` — clear in-memory state.
4. Live mode: set `MODEL_API_KEY` in `.env` and repeat with
   `{"use_live": true}`.

Demo clearance: `META 452, after passing MERIT, climb to flight level 230 and
proceed direct PONCT.` Pilot readback omits `after passing MERIT`.

## Meta model usage

- `muse-spark-1.3`: ATC Intent Agent, Pilot Understanding Agent, Verification
  Explanation Agent. Strict JSON schemas (`ClearancePayload`,
  `ExplanationPayload`) validated with Pydantic; missing values stay null —
  never inferred. Source text, evidence spans, and confidence are preserved.
- `muse-voice-transcribe-1.0`: prerecorded WAV transcription; typed input
  remains as fallback. Audio must be mono 16-bit PCM WAV at 16 or 24 kHz.
  The live request sends a `request` JSON part (model, audioEncoding,
  mode, keywords) plus the `audio` WAV part.
- Only `MODEL_API_KEY` is required (`META_API_KEY` still works as a legacy
  fallback); endpoints default to `https://api.meta.ai/v1/...` with
  `.env`/environment overrides (see `.env.example`). Requests have a 20 s
  default timeout with clear errors; any failure degrades to labelled
  fixtures.

## Safety limitations

Prototype for demonstration only: flat-plane demo geography, constant speeds,
simplified FMS and separation minima. Not for operational use. The AI never
commands the aircraft; correction is an explicit simulated pilot action.

## Tests

```powershell
.venv\Scripts\Activate.ps1
cd backend
python -m pytest tests -q
```

Covers parsing fallback, strict validation, FMS behavior, comparison, conflict
prediction, voice fallback, demo end to end, and HTTP routes. All tests run
offline with fixed fixtures and stubbed transports.

Live smoke test (needs `MODEL_API_KEY` in `.env`; fails loudly on any
fixture fallback instead of passing silently):

```powershell
.\.venv\Scripts\Activate.ps1
.\.venv\Scripts\python backend\scripts\live_smoke.py
```

## Public-deployment preparation

- No credentials in the repo (`.env.example` only; `.env` ignored).
- CORS restricted to local frontend origins; tighten for hosting.
- Serve the API behind TLS, set real Meta endpoints via environment, and keep
  fixture mode as the outage fallback.
- No external copyrighted assets; map/chart UI is hand-drawn SVG (Day 2).
