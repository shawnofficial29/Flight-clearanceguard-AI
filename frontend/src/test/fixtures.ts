/** Minimal typed fixtures for frontend tests (mirrors backend fixture shapes). */

import type {
  AuditEvent,
  AuditVerify,
  Clearance,
  ClearanceAction,
  ComparisonMatrix,
  ConflictPrediction,
  CoordinationResult,
  CorrectionResult,
  DemoResult,
  Fingerprints,
  FMSProgram,
  Health,
  ProfilePoint,
  ResolutionCandidate,
  SafetyWindow,
  ScenarioInfo,
  VerificationResult,
} from '../api/types';

function action(overrides: Partial<ClearanceAction> = {}): ClearanceAction {
  return {
    action_type: 'CLIMB',
    target_fix: null,
    numeric_value: 230,
    unit: 'FL',
    trigger_type: 'IMMEDIATE',
    trigger_value: null,
    evidence: 'climb to flight level 230',
    confidence: 0.95,
    ...overrides,
  };
}

function clearance(overrides: Partial<Clearance> = {}): Clearance {
  return {
    callsign: 'META 452',
    callsign_evidence: 'META 452',
    callsign_confidence: 0.95,
    actions: [action()],
    overall_confidence: 0.95,
    raw_text: 'META 452, climb to flight level 230.',
    role: 'pilot',
    provenance: 'fixture_fallback',
    model: 'deterministic-fallback',
    note: null,
    ...overrides,
  };
}

function fms(overrides: Partial<FMSProgram> = {}): FMSProgram {
  return {
    callsign: 'META 452',
    cleared_fl: 230,
    cleared_alt_ft: 23000,
    climb_start_fix: null,
    lateral_direct_to: 'PONCT',
    route: ['PONCT'],
    loaded: ['CLIMB 230FL'],
    held: [],
    loaded_actions: [action()],
    source: 'pilot',
    provenance: 'fixture_fallback',
    summary: 'Climb 23,000 ft immediate, direct PONCT',
    ...overrides,
  };
}

function point(t: number, alt: number): ProfilePoint {
  return {
    t_s: t,
    meta_x_nm: (t / 3600) * 300,
    meta_ft: alt,
    intruder_x_nm: 18,
    intruder_y_nm: -18 + (t / 3600) * 300,
    intruder_ft: 23000,
  };
}

export function makeHealth(configured: boolean): Health {
  return {
    status: 'ok',
    model: 'muse-spark-1.3',
    voice_model: 'muse-voice-transcribe-1.0',
    meta_api_configured: configured,
    voice_configured: configured,
  };
}

export function makeScenarios(): ScenarioInfo[] {
  return [
    { id: 'early-climb', title: 'Missing AFTER MERIT condition' },
    { id: 'altitude-value', title: 'Altitude value changed' },
  ];
}

export function makeMismatchMatrix(): ComparisonMatrix {
  return {
    rows: [
      {
        aspect: 'CLIMB',
        atc: 'CLIMB 230 FL After Waypoint MERIT',
        pilot: 'CLIMB 230 FL',
        fms: 'Immediate change to 23,000 ft',
        predicted: 'Immediate change to 23,000 ft',
        status: 'mismatch',
        category: 'MISSING_CONDITION',
        note: 'ATC condition omitted downstream.',
      },
    ],
    findings: [
      {
        category: 'MISSING_CONDITION',
        scope: 'atc_vs_pilot',
        action: 'CLIMB',
        detail: 'CLIMB condition after passing MERIT omitted.',
      },
    ],
    overall: 'mismatch',
    min_confidence: 0.9,
    missing_condition: true,
    missing_phrase: 'after passing MERIT',
  };
}

export function makeAgreeMatrix(): ComparisonMatrix {
  return {
    rows: [
      {
        aspect: 'CLIMB',
        atc: 'CLIMB 230 FL After Waypoint MERIT',
        pilot: 'CLIMB 230 FL After Waypoint MERIT',
        fms: 'Level, then change at MERIT to 23,000 ft',
        predicted: 'Level, then change at MERIT to 23,000 ft',
        status: 'match',
        category: 'CONSISTENT',
        note: 'Consistent across sources.',
      },
    ],
    findings: [],
    overall: 'agree',
    min_confidence: 0.9,
    missing_condition: false,
    missing_phrase: null,
  };
}

export function makeMismatchConflict(): ConflictPrediction {
  return {
    conflict: true,
    first_conflict_time_s: 215,
    lateral_nm_at_conflict: 0.5,
    vertical_ft_at_conflict: 500,
    closest_lateral_nm: 0.5,
    min_vertical_ft: 500,
    conflict_point_nm: { x_nm: 17.92, y_nm: 0 },
    lateral_threshold_nm: 5,
    vertical_threshold_ft: 1000,
    basis: 'test basis',
    profile: [point(0, 15000), point(215, 22500), point(430, 23000)],
  };
}

export function makeClearConflict(): ConflictPrediction {
  return {
    conflict: false,
    first_conflict_time_s: null,
    lateral_nm_at_conflict: null,
    vertical_ft_at_conflict: null,
    closest_lateral_nm: 12.4,
    min_vertical_ft: 8000,
    conflict_point_nm: null,
    lateral_threshold_nm: 5,
    vertical_threshold_ft: 1000,
    basis: 'test basis',
    profile: [point(0, 15000), point(240, 15000), point(480, 19000)],
  };
}

export function makeDemoResult(): DemoResult {
  return {
    atc_transcript: 'META 452, after passing MERIT, climb to flight level 230.',
    pilot_transcript: 'META 452, climb to flight level 230.',
    atc: clearance({
      role: 'atc',
      raw_text: 'META 452, after passing MERIT, climb to flight level 230.',
      actions: [
        action({ trigger_type: 'AFTER_WAYPOINT', trigger_value: 'MERIT', confidence: 0.97 }),
      ],
    }),
    pilot: clearance(),
    fms: fms(),
    comparison: makeMismatchMatrix(),
    conflict: makeMismatchConflict(),
    explanation: {
      summary: 'test summary',
      cause: 'test cause',
      evidence: ['test evidence'],
      recommended_action: 'test action',
      provenance: 'fixture_fallback',
      model: 'deterministic-fixture',
    },
    badges: { atc: 'Fixture fallback' },
  };
}

export function makeCorrectionResult(): CorrectionResult {
  const correctedPilot = clearance({
    raw_text: 'META 452, after passing MERIT, climb to flight level 230.',
    actions: [
      action({ trigger_type: 'AFTER_WAYPOINT', trigger_value: 'MERIT', confidence: 0.97 }),
    ],
  });
  return {
    corrected_pilot: correctedPilot,
    fms: fms({ climb_start_fix: 'MERIT', source: 'corrected' }),
    comparison: makeAgreeMatrix(),
    conflict: makeClearConflict(),
    explanation: {
      summary: 'resolved',
      cause: 'resolved',
      evidence: [],
      recommended_action: 'none',
      provenance: 'fixture_fallback',
      model: 'deterministic-fixture',
    },
    resolved: true,
    badges: { correction: 'Fixture fallback' },
  };
}

export function makeSafetyWindow(): SafetyWindow {
  return {
    conflict_time_s: 215,
    first_warning_time_s: 0,
    last_safe_correction_s: 197,
    seconds_remaining_s: 197,
    position_at_last_safe: { x_nm: 16.25, alt_ft: 21500 },
    min_sep_no_correction: {
      min_lateral_nm: 0.5,
      vertical_at_min_lateral_ft: 500,
      min_vertical_ft: 500,
      lateral_at_min_vertical_nm: 0.5,
    },
    min_sep_after_correction: {
      min_lateral_nm: 12.4,
      vertical_at_min_lateral_ft: 8000,
      min_vertical_ft: 8000,
      lateral_at_min_vertical_nm: 12.4,
    },
    causal_chain: [
      { step: 1, stage: 'MISMATCH', detail: 'divergence' },
      { step: 2, stage: 'FMS', detail: 'programmed' },
      { step: 3, stage: 'TRAJECTORY', detail: 'reaches geometry' },
      { step: 4, stage: 'CONFLICT', detail: 'loss of separation' },
    ],
    basis: 'test basis',
  };
}

export function makeResolvedSafetyWindow(): SafetyWindow {
  return {
    ...makeSafetyWindow(),
    conflict_time_s: null,
    last_safe_correction_s: null,
    seconds_remaining_s: null,
    position_at_last_safe: null,
    causal_chain: [{ step: 1, stage: 'PREDICTION', detail: 'No conflict predicted.' }],
  };
}

export function makeCandidates(): ResolutionCandidate[] {
  return [
    {
      id: 'missing-condition-climb-0',
      action_human: 'Restore ATC CLIMB 230 FL After Waypoint MERIT.',
      source_evidence: 'after passing MERIT, climb to flight level 230',
      conflict_after: false,
      min_lateral_nm: 12.4,
      min_vertical_ft: 8000,
      verification: 'VERIFIED',
      safe_reason: 'Restored ATC value removes the divergence.',
    },
  ];
}

export function makeVerification(): VerificationResult {
  return {
    candidate_id: 'missing-condition-climb-0',
    verified: true,
    matrix_overall: 'agree',
    conflict_after: false,
    min_lateral_nm: 12.4,
    min_vertical_ft: 8000,
    reason: 'Recomputed comparison is agree; conflict=false.',
  };
}

export function makeFingerprints(allAgree: boolean): Fingerprints {
  const atc = 'aaaabbbbccccdddd';
  const other = allAgree ? atc : 'eeeffff00001111';
  return { atc, pilot: other, fms: other, all_agree: allAgree, display_id: atc.slice(0, 8) };
}

export function makeCoordination(): CoordinationResult {
  return {
    recommended_candidate_id: 'missing-condition-climb-0',
    summary: 'Deterministic coordination complete. Comparison is mismatch.',
    rationale: 'First verified correction selected.',
    tool_calls: [
      { turn: 1, tool: 'compare_intents', ok: true, summary: '{"overall": "mismatch"}' },
      { turn: 2, tool: 'predict_conflict', ok: true, summary: '{"conflict": true}' },
      {
        turn: 3,
        tool: 'enumerate_verified_corrections',
        ok: true,
        summary: '{"candidates": [{"id": "missing-condition-climb-0"}]}',
      },
      {
        turn: 4,
        tool: 'verify_resolution',
        ok: true,
        summary: '{"verified": true}',
      },
    ],
    provenance: 'fixture_fallback',
    model: 'deterministic-coordinator',
    overridden: false,
    note: 'Offline deterministic coordination.',
  };
}

export function makeLiveCoordination(): CoordinationResult {
  return {
    ...makeCoordination(),
    provenance: 'live_meta_api',
    model: 'muse-spark-1.3',
    note: null,
  };
}

export function makeAuditVerify(length: number): AuditVerify {
  return {
    valid: true,
    length,
    head: length === 0 ? null : 'headhash12345678',
    first_bad_seq: null,
  };
}

export function makeAuditEvents(): AuditEvent[] {
  return [
    {
      seq: 1,
      type: 'compare',
      provenance: 'deterministic',
      model: null,
      result: { overall: 'mismatch' },
      human_confirmation: 'not_required',
      prev_hash: 'GENESIS',
      hash: 'hash1',
    },
    {
      seq: 2,
      type: 'correct_fms',
      provenance: 'deterministic',
      model: null,
      result: { summary: 'corrected' },
      human_confirmation: 'simulated-pilot-confirmed',
      prev_hash: 'hash1',
      hash: 'hash2',
    },
  ];
}
