/** Typed client for the ClearanceGuard FastAPI backend. */

import type {
  AuditEvent,
  AuditVerify,
  Clearance,
  CoordinationResult,
  CorrectionResult,
  DemoResult,
  Fingerprints,
  FMSProgram,
  Health,
  ResolutionCandidate,
  SafetyWindow,
  ScenarioInfo,
  VerificationResult,
  VoiceTranscript,
} from './types';

const BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function toMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'object' && payload !== null && 'detail' in payload) {
    const detail = (payload as { detail: unknown }).detail;
    if (typeof detail === 'string') return detail;
    return JSON.stringify(detail);
  }
  return fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, init);
  } catch {
    throw new ApiError(0, `Backend unreachable at ${BASE_URL}. Is it running?`);
  }
  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    throw new ApiError(
      response.status,
      toMessage(payload, `Request failed: ${response.status} ${response.statusText}`),
    );
  }
  return (await response.json()) as T;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export interface IntentTriple {
  atc: Clearance;
  pilot: Clearance;
  fms: FMSProgram;
}

export const api = {
  health(): Promise<Health> {
    return request<Health>('/health');
  },
  scenarios(): Promise<{ scenarios: ScenarioInfo[] }> {
    return request<{ scenarios: ScenarioInfo[] }>('/api/scenarios');
  },
  runDemo(useLive: boolean, scenarioId: string | null): Promise<DemoResult> {
    return post<DemoResult>('/api/demo/run', {
      use_live: useLive,
      scenario_id: scenarioId,
    });
  },
  runCorrection(useLive: boolean, scenarioId: string | null): Promise<CorrectionResult> {
    return post<CorrectionResult>('/api/demo/correct', {
      use_live: useLive,
      scenario_id: scenarioId,
    });
  },
  resetSession(): Promise<{ status: string }> {
    return post<{ status: string }>('/api/session/reset', {});
  },
  safetyWindow(triple: IntentTriple, scenarioId: string | null): Promise<SafetyWindow> {
    return post<SafetyWindow>('/api/safety/window', { ...triple, scenario_id: scenarioId });
  },
  enumerateCandidates(
    triple: IntentTriple,
    scenarioId: string | null,
  ): Promise<ResolutionCandidate[]> {
    return post<ResolutionCandidate[]>('/api/resolutions/enumerate', {
      ...triple,
      scenario_id: scenarioId,
    });
  },
  verifyCandidate(
    triple: IntentTriple,
    candidateId: string,
    scenarioId: string | null,
  ): Promise<VerificationResult> {
    return post<VerificationResult>('/api/resolutions/verify', {
      ...triple,
      candidate_id: candidateId,
      scenario_id: scenarioId,
    });
  },
  fingerprints(triple: IntentTriple): Promise<Fingerprints> {
    return post<Fingerprints>('/api/fingerprints', triple);
  },
  auditEvents(): Promise<AuditEvent[]> {
    return request<AuditEvent[]>('/api/audit/events');
  },
  auditVerify(): Promise<AuditVerify> {
    return request<AuditVerify>('/api/audit/verify');
  },
  coordinate(
    atcText: string,
    pilotText: string,
    scenarioId: string | null,
    useLive: boolean,
  ): Promise<CoordinationResult> {
    return post<CoordinationResult>('/api/coordinate', {
      atc_text: atcText,
      pilot_text: pilotText,
      scenario_id: scenarioId,
      use_live: useLive,
    });
  },
  transcribeWav(file: File, useLive: boolean): Promise<VoiceTranscript> {
    const form = new FormData();
    form.append('file', file, file.name);
    // use_live is a query parameter on POST /api/voice/transcribe.
    return request<VoiceTranscript>(
      `/api/voice/transcribe?use_live=${useLive ? 'true' : 'false'}`,
      { method: 'POST', body: form },
    );
  },
};

export { BASE_URL };
