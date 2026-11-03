# ClearanceGuard AI — Claude Continuation Handoff

**Date:** 2 November 2026
**Author:** Shawn D. Souza, independent developer
**Hackathon:** Meta Global AI Developer Hackathon (Cerebral Valley)
**Track:** Indie Developer
**Deadline:** Wednesday, 4 November 2026, 9:00 PM Eastern
**Repository:** https://github.com/shawnofficial29/Flight-clearanceguard-AI
**Local path:** `C:\Users\DSU\Documents\HACKATON'26\Flight-clearanceguard-AI`

This file is the primary continuation context for Claude. Read it before changing any code. A matching Word copy lives at `docs/ClearanceGuard_AI_Handoff.docx`.

Do not invent missing secrets, aviation certifications, or live air-traffic data. Do not commit environment files or API keys.

---

## Immediate continuation prompt

Paste this into Claude at the start of the next session:

```text
Continue ClearanceGuard AI from CLAUDE_HANDOFF.md.

This is a Meta Global AI Developer Hackathon prototype. Backend is
complete and frozen except for required contract-preserving bug fixes.
Frontend is a React + Vite operations UI with Leaflet/CARTO map overlays.

Current local work is uncommitted: the SFO Leaflet map, playback overlay,
CARTO key support, compact transport controls, and display projection
that places PONCT at SFO.

Priority:

1. Confirm the CARTO key is loaded from frontend/.env.local and that
   the map shows real SFO geography with synthetic overlays.
2. Keep all aircraft, routes, and conflicts labelled
   SIMULATION — NOT LIVE TRAFFIC.
3. Preserve backend safety calculations. Map projection is display-only.
4. Run frontend and backend tests before larger UI changes.
5. Do not commit secrets. Do not start a major new feature until the
   map, playback, and Live Meta demo are visually solid.

Read CLAUDE_HANDOFF.md, then inspect git status and the latest map
files before proposing the next edit.
```

---

## What this product is

ClearanceGuard AI is a simulated aviation operations system. It detects disagreement between:

1. ATC intent
2. Pilot readback
3. Simulated FMS programming
4. Predicted aircraft trajectory

It then calculates a Safety Window, enumerates a verified correction from the original ATC clearance, and waits for an explicit simulated pilot confirmation. It never edits or flies the aircraft.

**Pitch:**

> Detects when ATC intent, pilot readback, and FMS programming disagree before execution.

The product is an advisory prototype, not certified avionics.

---

## Hackathon constraints

- Public GitHub repository required.
- Must use Meta models: Muse Spark and Muse Voice Transcribe.
- Demo video: 3 minutes.
- Team size: 1.
- New work during the event only; original contributions must be obvious.
- Avoid banned generic projects: RAG chatbots, medical advice, simple analyzers.
- Do not claim the system would have prevented a specific accident.
- Do not copy FlightRadar24 branding, icons, or proprietary assets.

Judging weights:

- Impact 30%
- Use of Meta AI tooling 25%
- Demo 25%
- Technical depth 20%

---

## Current git state

Latest pushed commits:

```text
376bb3e feat: redesign ClearanceGuard operations interface
0e1ad2a feat: add verified resolution workflow and functional frontend
b879cda feat: add safety window and native resolution coordinator
d1036da feat: add generalized clearance verification and scenarios
857d4c0 feat: complete verified ClearanceGuard backend core
```

Uncommitted local frontend work as of 2 November 2026:

- Leaflet/CARTO simulated SFO map
- Playback overlay and compact Play/Pause/Replay controls
- CARTO key support via `VITE_CARTO_BASEMAP_KEY`
- Display projection that maps PONCT (`x = 60 NM`) onto SFO
- Yellow aircraft silhouettes and simulated overlays
- New tests in `frontend/src/MapPlayback.test.tsx` and `frontend/src/geo/`

Do not commit:

- `.env`
- `frontend/.env.local`
- `node_modules/`
- `.venv/`
- `.tools/`
- `frontend/dist/`
- `frontend/tsconfig.app.tsbuildinfo` unless needed

---

## Architecture

```text
React + Vite frontend  (localhost:5173)
        |
        | JSON over HTTP
        v
FastAPI backend        (localhost:8000)
        |
        +-- muse-spark-1.3  ATC intent
        +-- muse-spark-1.3  Pilot understanding
        +-- muse-spark-1.3  Explanation
        +-- muse-spark-1.3  Native tool-calling coordinator
        +-- muse-voice-transcribe-1.0
        +-- Deterministic FMS, comparison, conflict, safety,
            resolutions, fingerprints, audit
```

Rule: Meta models interpret language and coordinate tools. Deterministic Python performs comparison, trajectory, Safety Window, and correction verification.

---

## Meta models

| Role | Model | Job |
|---|---|---|
| ATC Intent Agent | `muse-spark-1.3` | Parse ATC clearance into structured actions |
| Pilot Understanding Agent | `muse-spark-1.3` | Parse only what the pilot actually said |
| Explanation Agent | `muse-spark-1.3` | Explain mismatches already found by Python |
| Resolution Coordinator | `muse-spark-1.3` | Native Chat Completions tool calling |
| Voice | `muse-voice-transcribe-1.0` | Transcribe ATC or pilot WAV files |

Official endpoints:

- Model: `https://api.meta.ai/v1/chat/completions`
- Voice: `https://api.meta.ai/v1/asr/transcribe`

Environment:

```text
MODEL_API_KEY=
# optional legacy fallback: META_API_KEY=
```

Voice requirements:

- Mono
- 16-bit PCM WAV
- 16 or 24 kHz
- Multipart parts: `request` JSON and `audio` WAV
- Keywords: `META452`, `MERIT`, `PONCT`

Provenance badges:

- `live_meta_api`
- `live_muse_voice`
- `fixture_fallback`

Strict live tests must fail if provenance is fallback.

Coordinator native tools:

1. `compare_intents`
2. `predict_conflict`
3. `calculate_safety_window`
4. `enumerate_verified_corrections`
5. `verify_resolution`
6. `submit_verified_resolution`

Turn cap: 6. Unknown or unverified candidate IDs are overridden by deterministic verified candidates.

After Pilot Correction, do **not** rerun `/api/coordinate`. Preserve the original live coordinator result, provenance, and tool-call trace.

---

## Backend capabilities

### Clearance schema

Non-recursive `ClearanceAction` list:

- `DIRECT_TO`, `CLIMB`, `DESCEND`, `MAINTAIN`, `SPEED`, `HEADING`, `HOLD`
- Units: `FL`, `FT`, `KTS`, `DEG`, `NONE`
- Triggers: `IMMEDIATE`, `AFTER_WAYPOINT`, `AT_WAYPOINT`, `AT_TIME`
- Evidence span and confidence
- Missing values stay `null`; never inferred
- Confidence below 0.85 produces `VERIFY_REQUIRED`

### Comparison categories

- `CALLSIGN_MISMATCH`
- `MISSING_ACTION`
- `EXTRA_ACTION`
- `CHANGED_VALUE`
- `CHANGED_WAYPOINT`
- `MISSING_CONDITION`
- `CHANGED_CONDITION`
- `INCORRECT_EXECUTION_TIME`
- `PARTIAL_FMS_LOAD`

### Safety Window

Counterfactual simulation. No LLM.

Returns:

- Conflict time
- Last safe correction time
- Safety margin
- Position at last safe correction
- Minimum separation with and without correction
- Causal chain: mismatch → FMS → trajectory → conflict

### Verified resolution

Candidates are restored from the original ATC clearance. The model cannot invent altitudes, headings, or routes.

### Fingerprints and audit

- SHA-256 intent fingerprints over canonical ATC, pilot, and FMS intent
- Hash-linked in-memory audit chain
- `POST /api/session/reset` clears session **and** audit chain

### Scenarios

| ID | Error | Expected result |
|---|---|---|
| `altitude-sync` | Pilot mishears 23,000 ft as 22,000 ft | Mismatch; conflict at T+165 s; correction holds 23,000 ft |

Demo ATC clearance:

```text
META 452, maintain 23,000 feet.
```

Incorrect pilot readback:

```text
META 452, maintain 22,000 feet.
```

Altitude-sync expected display:

- Before: ATC 23,000 ft, Pilot 22,000 ft, FMS 22,000 ft
- After: ATC 23,000 ft, Pilot 23,000 ft, FMS 23,000 ft (1,000 ft above traffic)

---

## Backend API

Base URL: `http://127.0.0.1:8000`

- `GET /health`
- `GET /api/scenarios`
- `POST /api/atc/parse`
- `POST /api/pilot/parse`
- `POST /api/voice/transcribe`
- `POST /api/fms/program`
- `POST /api/compare`
- `POST /api/conflict/predict`
- `POST /api/explain`
- `POST /api/demo/run`
- `POST /api/demo/correct`
- `POST /api/session/reset`
- `POST /api/safety/window`
- `POST /api/resolutions/enumerate`
- `POST /api/resolutions/verify`
- `POST /api/fingerprints`
- `GET /api/audit/events`
- `GET /api/audit/verify`
- `POST /api/coordinate`

CORS currently allows `http://localhost:5173` and `http://127.0.0.1:5173`.

Important models:

- `CorrectionResult` includes `corrected_pilot`
- Frontend correction refresh uses the corrected triple for safety, fingerprints, and audit
- Frontend must not replace live coordinator output after correction

---

## Frontend

Stack: React 19, TypeScript, Vite 6, Leaflet 1.9, react-leaflet 5.

Local URL: `http://localhost:5173`

### Layout

- Compact operations header
- Value proposition: “Detects when ATC intent, pilot readback, and FMS programming disagree before execution.”
- Three-step story: Mismatch Detected → Conflict Predicted → Verified Resolution
- Dominant map and compact altitude-versus-time chart
- Right rail: alert, intent comparison, Safety Window, human confirmation
- Collapsed Evidence drawer: full matrix, transcripts, tool trace, fingerprints, audit, audio

### Map

- Leaflet + CARTO Positron raster tiles
- Attribution: `© OpenStreetMap contributors © CARTO`
- Persistent badge: `SIMULATION — NOT LIVE TRAFFIC`
- SFO anchor: `37.6213, -122.3790`
- Display conversion: `scenarioNmToLatLng(x, y) = nmToLatLng(x - 60, y, SFO_ANCHOR)`
- PONCT (`x = 60`) sits at SFO; META 452 approaches from the west
- Overlay colors:
  - Cyan ATC
  - Magenta FMS
  - Gray intruder
  - Red conflict
  - Green corrected
- Compact overlay transport: Play/Pause, Replay, scrubber, `SIM ×30`
- Keyboard: Space play/pause, arrows scrub
- Reduced-motion supported
- Do not invent heading, speed, or live telemetry

### CARTO key

CARTO raster tiles require a free key from https://carto.com/basemaps/apikey/

Frontend env:

```text
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_CARTO_BASEMAP_KEY=
```

Store the real key only in ignored `frontend/.env.local`.

If the key is missing, do not request unauthenticated CARTO tiles. Use the dark vector fallback and show `Basemap key not configured.`

Never log or display the key.

Vite reads env files only at startup. Restart `npm run dev` after changing `.env.local`, then hard-refresh the browser.

---

## File map

```text
backend/app/main.py
backend/app/models.py
backend/app/config.py
backend/app/demo.py
backend/app/scenarios.py
backend/app/eval.py
backend/app/eval_data.py
backend/app/agents/atc_intent.py
backend/app/agents/pilot_intent.py
backend/app/agents/explanation.py
backend/app/agents/coordinator.py
backend/app/agents/fallback.py
backend/app/services/fms.py
backend/app/services/comparison.py
backend/app/services/conflict.py
backend/app/services/safety.py
backend/app/services/resolutions.py
backend/app/services/fingerprints.py
backend/app/services/audit.py
backend/app/services/voice.py
backend/app/services/model_client.py
backend/scripts/live_smoke.py
backend/scripts/voice_smoke.py
backend/scripts/coordinator_smoke.py
backend/scripts/run_eval.py

frontend/src/App.tsx
frontend/src/components/Header.tsx
frontend/src/components/AlertCard.tsx
frontend/src/components/IntentCompare.tsx
frontend/src/components/RouteView.tsx
frontend/src/components/SimMap.tsx
frontend/src/components/AirspaceMap.tsx
frontend/src/components/MapTransport.tsx
frontend/src/components/ClearanceSummary.tsx
frontend/src/components/EvidencePanel.tsx
frontend/src/geo/conversion.ts
frontend/src/geo/tiles.ts
frontend/src/hooks/usePlayback.ts
```

---

## How to run

### Backend

```powershell
cd "C:\Users\DSU\Documents\HACKATON'26\Flight-clearanceguard-AI"

$secure = Read-Host "Paste your Meta API key" -AsSecureString
$env:MODEL_API_KEY = [System.Net.NetworkCredential]::new("", $secure).Password

.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

### Frontend

```powershell
$root = "C:\Users\DSU\Documents\HACKATON'26\Flight-clearanceguard-AI"
$env:PATH = "$root\.tools\node;$env:PATH"
$env:npm_config_cache = "$root\.tools\npm-cache"
cd "$root\frontend"
npm run dev -- --host 127.0.0.1 --port 5173
```

If port 5173 is already in use, identify and stop the existing Vite process before restarting.

Health check: `GET http://127.0.0.1:8000/health`

Expected configured fields:

- `meta_api_configured: true`
- `voice_configured: true`
- `model: muse-spark-1.3`

---

## Tests and verified results

As of 2 November 2026:

- Backend: **95 passed**
- Frontend: **78 passed**
- Offline eval: 30 pairs, 100% field extraction, 100% mismatch detection, 0 false warnings, 3/3 scenario resolution
- Live Spark parse: `SMOKE-PASS`
- Native coordinator: `COORD-SMOKE-PASS`
  - Tools: `compare_intents`, `predict_conflict`, `calculate_safety_window`, `enumerate_verified_corrections`, `verify_resolution`, `submit_verified_resolution`
  - Recommended: `missing-condition-climb-0`
  - No override, no fallback

Commands:

```powershell
.\.venv\Scripts\python.exe -m pytest backend\tests -q
.\.venv\Scripts\python.exe backend\scripts\run_eval.py
.\.venv\Scripts\python.exe backend\scripts\live_smoke.py
.\.venv\Scripts\python.exe backend\scripts\coordinator_smoke.py

cd frontend
npm test
npm run typecheck
npm run build
```

Treat eval numbers as an offline regression suite, not real-world model accuracy.

---

## Safety and legal limits

- Simulation only
- Advisory only
- No aircraft control
- No invented emergency procedures
- No copied FlightRadar24 assets
- No live traffic
- No medical, political, or banned hackathon topics
- Keep OSM/CARTO attribution visible
- Keep `SIMULATION — NOT LIVE TRAFFIC` visible

---

## Remaining work

Priority order:

1. Visually confirm CARTO basemap at SFO with the local key.
2. Confirm PONCT is at SFO and META 452 approaches from the west.
3. Confirm compact playback overlay and yellow aircraft icons.
4. Confirm Live Meta correction still shows `live_meta_api` coordinator provenance.
5. Commit the uncommitted map work **without** `.env.local`.
6. Final UI polish: readable error sentences, map-dominant layout, Evidence drawer.
7. Optional: airport selector. Do not start this until SFO is solid.
8. Deployment: public frontend plus backend, CORS for the deployed origin, TLS.
9. README update, architecture diagram, 3-minute demo video.
10. Submit several hours before 9:00 PM ET on 4 November 2026.

Do not add:

- Login or accounts
- Database
- Real ADS-B
- Certified FMS integration
- Muse Image as the operational map
- Extra models without a necessary function

---

## 3-minute demo script

1. **0:00–0:20** Clearance mismatches can reach the FMS before anyone notices.
2. **0:20–0:40** Architecture: Spark, Voice, deterministic safety layer.
3. **0:40–1:50** Live MERIT scenario: missing AFTER MERIT, early climb, predicted conflict.
4. **1:50–2:20** Safety Window and native tool-call coordinator.
5. **2:20–2:40** Pilot confirms verified correction; conflict clears; fingerprints agree.
6. **2:40–3:00** Safety boundary: advisory, simulated, human remains in control.

Keep a typed-input fallback if live audio fails.

---

## Environment names only

Never paste real values into chat, git, or this file.

```text
MODEL_API_KEY
META_API_KEY                  # optional legacy
META_MODEL_API_URL            # optional override
META_VOICE_API_URL            # optional override
VITE_API_BASE_URL
VITE_CARTO_BASEMAP_KEY
```
