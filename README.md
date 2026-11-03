# ClearanceGuard AI

Shared 4D ATC clearance verification prototype. Compares ATC intent, pilot
readback, simulated FMS programming, and predicted trajectory — and explains
any mismatch in plain language.

Status: **Safety Window and Verified Resolution complete** (counterfactual
simulation, verified candidates, coordinator agent, fingerprints, audit
chain). Frontend follows next.

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
- Clearances use a fixed, non-recursive `ClearanceAction` list (DIRECT_TO,
  CLIMB, DESCEND, MAINTAIN, SPEED, HEADING, HOLD) with triggers
  (IMMEDIATE, AFTER_WAYPOINT, AT_WAYPOINT, AT_TIME). Comparison emits
  categorized findings across nine categories; any required field below
  0.85 confidence forces VERIFY_REQUIRED.

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

Demo clearance: `META 452, maintain 23,000 feet.` The pilot mishears it as
22,000 ft and sets that instead.

One registry scenario (`GET /api/scenarios`, `scenario_id` on demo and
conflict calls): `altitude-sync` — ATC clears 23,000 ft, the pilot sets
22,000 ft (changed value, conflict at T+165 s). The run goes
parse → FMS → compare → predict → correct → resolve: ATC confirms 23,000
first, then the pilot verifies, ending 1,000 ft above traffic.

Differentiation services (all deterministic except the coordinator's
explanations): counterfactual Safety Window (`POST /api/safety/window`),
verified resolution candidates (`POST /api/resolutions/enumerate` and
`/verify`), SHA-256 intent fingerprints (`POST /api/fingerprints`), a
hash-linked audit chain (`GET /api/audit/events`, `/verify`), and the
Resolution Coordinator Agent (`POST /api/coordinate`) using native Chat
Completions tool calling (6 tools, 6-turn cap, submit-only-verified).

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

Live smoke tests (need `MODEL_API_KEY` in `.env`; fail loudly on any
fixture fallback instead of passing silently):

```powershell
.\.venv\Scripts\Activate.ps1
.\.venv\Scripts\python backend\scripts\live_smoke.py
.\.venv\Scripts\python backend\scripts\voice_smoke.py <path-to-24khz-mono-wav>
.\.venv\Scripts\python backend\scripts\coordinator_smoke.py
```

Offline evaluation (30 fixed pairs plus 3 scenarios; reproducible):

```powershell
.\.venv\Scripts\python backend\scripts\run_eval.py
```

## Public-deployment preparation

- No credentials in the repo (`.env.example` only; `.env` ignored).
- CORS restricted to local frontend origins; tighten for hosting.
- Serve the API behind TLS, set real Meta endpoints via environment, and keep
  fixture mode as the outage fallback.
- No external copyrighted assets; map/chart UI is hand-drawn SVG (Day 2).
