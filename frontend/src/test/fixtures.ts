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

const DESCENT_TEXT =
  'META 452, reduce speed to 250 knots now. After MERIT, descend and maintain 15,000 feet.';

function action(overrides: Partial<ClearanceAction> = {}): ClearanceAction {
  return {
    action_type: 'DESCEND',
    target_fix: null,
    numeric_value: 15000,
    unit: 'FT',
    trigger_type: 'AFTER_WAYPOINT',
    trigger_value: 'MERIT',
    evidence: 'after MERIT, descend to 15,000 feet',
    confidence: 0.95,
    ...overrides,
  };
}

function speedAction(overrides: Partial<ClearanceAction> = {}): ClearanceAction {
  return {
    action_type: 'SPEED',
    target_fix: null,
    numeric_value: 250,
    unit: 'KTS',
    trigger_type: 'IMMEDIATE',
    trigger_value: null,
    evidence: 'reduce speed to 250 knots now',
    confidence: 0.95,
    ...overrides,
  };
}

function clearance(overrides: Partial<Clearance> = {}): Clearance {
  return {
    callsign: 'META 452',
    callsign_evidence: 'META 452',
    callsign_confidence: 0.95,
    actions: [speedAction(), action()],
    overall_confidence: 0.95,
    raw_text: DESCENT_TEXT,
    role: 'pilot',
    provenance: 'fixture_fallback',
    model: 'deterministic-fallback',
    note: null,
    ...overrides,
  };
}

function fms(overrides: Partial<FMSProgram> = {}): FMSProgram {
  const dropped = action({
    trigger_type: 'IMMEDIATE',
    trigger_value: null,
    evidence: 'descend to 15,000 feet',
  });
  return {
    callsign: 'META 452',
    cleared_fl: null,
    cleared_alt_ft: 15000,
    target_speed_kts: 250,
    climb_start_fix: null,
    lateral_direct_to: null,
    route: [],
    loaded: ['SPEED 250KTS', 'DESCEND 15000FT'],
    held: [],
    loaded_actions: [speedAction(), dropped],
    source: 'pilot',
    provenance: 'fixture_fallback',
    summary: 'Descend to 15,000 ft immediate, 250 kt immediate',
    ...overrides,
  };
}

/** Along-track distance (NM) under the 290→250 kt gradual slowdown. */
/** META 452 along-track position (NM) under the gradual slowdown. */
export function gradualX(t: number): number {
  if (t <= 40) return (290 * t - (t * t) / 2) / 3600;
  return 3 + (250 * (t - 40)) / 3600;
}

/** Programmed speed (kt) under the gradual slowdown. */
function gradualKt(t: number): number {
  return Math.max(290 - t, 250);
}

/** Intruder track: constant 250 kt north along x=18 NM. */
export function intruderTrack(t: number): { x: number; y: number } {
  return { x: 18, y: -100 / 9 + (t / 3600) * 250 };
}

function point(t: number, alt: number): ProfilePoint {
  const tfc = intruderTrack(t);
  return {
    t_s: t,
    meta_x_nm: gradualX(t),
    meta_ft: alt,
    meta_kt: gradualKt(t),
    intruder_x_nm: tfc.x,
    intruder_y_nm: tfc.y,
    intruder_ft: 15000,
    intruder_kt: 250,
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
    { id: 'altitude-sync', title: 'Altitude sync — pilot sets 22,000 ft, ATC cleared 23,000 ft' },
  ];
}

export function makeMismatchMatrix(): ComparisonMatrix {
  return {
    rows: [
      {
        aspect: 'DESCEND',
        atc: 'DESCEND 15000 FT After Waypoint MERIT',
        pilot: 'DESCEND 15000 FT After Waypoint MERIT',
        fms: 'Immediate change to 15,000 ft',
        predicted: 'Immediate change to 15,000 ft',
        status: 'mismatch',
        category: 'MISSING_CONDITION',
        note: 'ATC condition omitted downstream.',
      },
      {
        aspect: 'SPEED',
        atc: '250 kt now',
        pilot: '250 kt now',
        fms: '250 kt now',
        predicted: '250 kt now',
        status: 'match',
        category: 'CONSISTENT',
        note: 'Consistent across sources.',
      },
    ],
    findings: [
      {
        category: 'MISSING_CONDITION',
        scope: 'pilot_vs_fms',
        action: 'DESCEND',
        detail: 'DESCEND condition after passing MERIT omitted in FMS entry.',
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
        aspect: 'DESCEND',
        atc: 'DESCEND 15000 FT After Waypoint MERIT',
        pilot: 'DESCEND 15000 FT After Waypoint MERIT',
        fms: 'Level, then change at MERIT to 15,000 ft',
        predicted: 'Level, then change at MERIT to 15,000 ft',
        status: 'match',
        category: 'CONSISTENT',
        note: 'Consistent across sources.',
      },
      {
        aspect: 'SPEED',
        atc: '250 kt now',
        pilot: '250 kt now',
        fms: '250 kt now',
        predicted: '250 kt now',
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
    first_conflict_time_s: 205,
    lateral_nm_at_conflict: 4.72,
    vertical_ft_at_conflict: 825,
    closest_lateral_nm: 4.72,
    min_vertical_ft: 650,
    conflict_point_nm: { x_nm: 14.46, y_nm: 0 },
    lateral_threshold_nm: 5,
    vertical_threshold_ft: 1000,
    basis: 'test basis',
    merit_time_s: 284.8,
    merit_vertical_gap_ft: 0,
    plan_merit_time_s: 284.8,
    intruder_merit_time_s: 160.0,
    profile: [point(0, 23000), point(40, 21600), point(200, 16000), point(432, 15000)],
    plan_profile: [point(0, 23000), point(40, 23000), point(200, 23000), point(432, 16168)],
  };
}

export function makeClearConflict(): ConflictPrediction {
  return {
    conflict: false,
    first_conflict_time_s: null,
    lateral_nm_at_conflict: null,
    vertical_ft_at_conflict: null,
    closest_lateral_nm: 4.72,
    min_vertical_ft: 8000,
    conflict_point_nm: null,
    lateral_threshold_nm: 5,
    vertical_threshold_ft: 1000,
    basis: 'test basis',
    merit_time_s: 284.8,
    merit_vertical_gap_ft: 8000,
    plan_merit_time_s: 284.8,
    intruder_merit_time_s: 160.0,
    profile: [point(0, 23000), point(40, 23000), point(200, 23000), point(432, 16168)],
    plan_profile: [point(0, 23000), point(40, 23000), point(200, 23000), point(432, 16168)],
  };
}

export function makeDemoResult(): DemoResult {
  return {
    atc_transcript: DESCENT_TEXT,
    pilot_transcript: DESCENT_TEXT,
    atc: clearance({
      role: 'atc',
      raw_text: DESCENT_TEXT,
      callsign_confidence: 0.97,
      overall_confidence: 0.97,
      actions: [
        speedAction({ confidence: 0.97 }),
        action({ confidence: 0.97 }),
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
    raw_text: DESCENT_TEXT,
    actions: [speedAction({ confidence: 0.97 }), action({ confidence: 0.97 })],
  });
  const entered = action({ confidence: 0.97 });
  const enteredSpeed = speedAction({ confidence: 0.97 });
  return {
    corrected_pilot: correctedPilot,
    fms: fms({
      climb_start_fix: 'MERIT',
      source: 'corrected',
      route: ['MERIT'],
      loaded: ['SPEED 250KTS', 'DESCEND 15000FT AFTER_WAYPOINT MERIT'],
      loaded_actions: [enteredSpeed, entered],
      summary: 'Descend 15,000 ft after MERIT, 250 kt immediate',
    }),
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
    conflict_time_s: 205,
    first_warning_time_s: 0,
    last_safe_correction_s: 187,
    seconds_remaining_s: 187,
    position_at_last_safe: { x_nm: 15.42, alt_ft: 16525 },
    min_sep_no_correction: {
      min_lateral_nm: 4.72,
      vertical_at_min_lateral_ft: 650,
      min_vertical_ft: 0,
      lateral_at_min_vertical_nm: 5.19,
    },
    min_sep_after_correction: {
      min_lateral_nm: 4.72,
      vertical_at_min_lateral_ft: 8000,
      min_vertical_ft: 0,
      lateral_at_min_vertical_nm: 30.52,
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
      id: 'missing-condition-descend-0',
      action_human: 'Restore ATC DESCEND 15000 FT After Waypoint MERIT.',
      source_evidence: 'After MERIT, descend to 15,000 feet',
      conflict_after: false,
      min_lateral_nm: 4.72,
      min_vertical_ft: 8000,
      verification: 'VERIFIED',
      safe_reason:
        'Restored ATC value removes the divergence; at closest lateral approach ' +
        '(4.72 NM) vertical separation is 8,000 ft with no conflict.',
    },
  ];
}

export function makeVerification(): VerificationResult {
  return {
    candidate_id: 'missing-condition-descend-0',
    verified: true,
    matrix_overall: 'agree',
    conflict_after: false,
    min_lateral_nm: 4.72,
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
    recommended_candidate_id: 'missing-condition-descend-0',
    summary: 'Deterministic coordination complete. Comparison is mismatch.',
    rationale: 'First verified correction selected.',
    tool_calls: [
      { turn: 1, tool: 'compare_intents', ok: true, summary: '{"overall": "mismatch"}' },
      { turn: 2, tool: 'predict_conflict', ok: true, summary: '{"conflict": true}' },
      {
        turn: 3,
        tool: 'enumerate_verified_corrections',
        ok: true,
        summary: '{"candidates": [{"id": "missing-condition-descend-0"}]}',
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

const SYNC_ATC_TEXT = 'META 452, maintain 23,000 feet.';
const SYNC_PILOT_TEXT = 'META 452, maintain 22,000 feet.';

function syncAction(value: number): ClearanceAction {
  return {
    action_type: 'MAINTAIN',
    target_fix: null,
    numeric_value: value,
    unit: 'FT',
    trigger_type: 'IMMEDIATE',
    trigger_value: null,
    evidence: `maintain ${value.toLocaleString('en-US')} feet`,
    confidence: 0.9,
  };
}

const SYNC_MERIT_T_S = 248.28;
const SYNC_DESCENT_FPS = 2100 / 60;
const SYNC_LANDING_FT = 10000;

/** Landing descent past MERIT: hold the cleared level until past the
 * traffic, then descend to 15,000 ft and slow to 250 kt for the airport. */
function syncTailAlt(t: number, baseFt: number): number {
  if (t <= SYNC_MERIT_T_S) return baseFt;
  return Math.max(SYNC_LANDING_FT, baseFt - SYNC_DESCENT_FPS * (t - SYNC_MERIT_T_S));
}

function syncKt(t: number): number {
  if (t <= SYNC_MERIT_T_S) return 290;
  return Math.max(175, 290 - 0.25 * (t - SYNC_MERIT_T_S));
}

function syncPoint(t: number, alt: number): ProfilePoint {
  const tfc = intruderTrack(t);
  return {
    t_s: t,
    meta_x_nm: (290 * t) / 3600,
    meta_ft: alt,
    meta_kt: syncKt(t),
    intruder_x_nm: tfc.x,
    intruder_y_nm: tfc.y,
    intruder_ft: 22000,
    intruder_kt: 250,
  };
}

/** Numbers mirror the verified backend altitude-sync arc (conflict at T+165 s). */
export function makeSyncConflict(): ConflictPrediction {
  return {
    conflict: true,
    first_conflict_time_s: 165.0,
    lateral_nm_at_conflict: 4.72,
    vertical_ft_at_conflict: 0.0,
    closest_lateral_nm: 3.34,
    min_vertical_ft: 0.0,
    conflict_point_nm: { x_nm: 13.29, y_nm: 0.0 },
    lateral_threshold_nm: 5,
    vertical_threshold_ft: 1000,
    basis: 'test basis',
    merit_time_s: 248.28,
    merit_vertical_gap_ft: 0.0,
    plan_merit_time_s: 248.28,
    intruder_merit_time_s: 160.0,
    profile: [syncPoint(0, 23000), syncPoint(30, 22000), syncPoint(165, 22000), syncPoint(432, syncTailAlt(432, 22000))],
    plan_profile: [syncPoint(0, 23000), syncPoint(30, 23000), syncPoint(165, 23000), syncPoint(432, syncTailAlt(432, 23000))],
  };
}

export function makeSyncClearConflict(): ConflictPrediction {
  return {
    conflict: false,
    first_conflict_time_s: null,
    lateral_nm_at_conflict: null,
    vertical_ft_at_conflict: null,
    closest_lateral_nm: 3.34,
    min_vertical_ft: 1000.0,
    conflict_point_nm: null,
    lateral_threshold_nm: 5,
    vertical_threshold_ft: 1000,
    basis: 'test basis',
    merit_time_s: 248.28,
    merit_vertical_gap_ft: 1000.0,
    plan_merit_time_s: 248.28,
    intruder_merit_time_s: 160.0,
    profile: [syncPoint(0, 23000), syncPoint(30, 23000), syncPoint(165, 23000), syncPoint(432, syncTailAlt(432, 23000))],
    plan_profile: [syncPoint(0, 23000), syncPoint(30, 23000), syncPoint(165, 23000), syncPoint(432, syncTailAlt(432, 23000))],
  };
}

function makeSyncMismatchMatrix(): ComparisonMatrix {
  return {
    rows: [
      {
        aspect: 'Callsign',
        atc: 'META 452',
        pilot: 'META 452',
        fms: 'META 452',
        predicted: 'META 452',
        status: 'match',
        category: 'CONSISTENT',
        note: 'All sources agree.',
      },
      {
        aspect: 'MAINTAIN',
        atc: 'MAINTAIN 23000 FT',
        pilot: 'MAINTAIN 22000 FT',
        fms: 'Immediate change to 22,000 ft',
        predicted: 'Immediate change to 22,000 ft',
        status: 'mismatch',
        category: 'CHANGED_VALUE',
        note: 'Value differs from ATC.',
      },
    ],
    findings: [
      {
        category: 'CHANGED_VALUE',
        scope: 'atc_vs_pilot',
        action: 'MAINTAIN',
        detail: 'MAINTAIN value 23000 FT vs 22000 FT.',
      },
    ],
    overall: 'mismatch',
    min_confidence: 0.9,
    missing_condition: false,
    missing_phrase: null,
  };
}

function makeSyncAgreeMatrix(): ComparisonMatrix {
  return {
    rows: [
      {
        aspect: 'Callsign',
        atc: 'META 452',
        pilot: 'META 452',
        fms: 'META 452',
        predicted: 'META 452',
        status: 'match',
        category: 'CONSISTENT',
        note: 'All sources agree.',
      },
      {
        aspect: 'MAINTAIN',
        atc: 'MAINTAIN 23000 FT',
        pilot: 'MAINTAIN 23000 FT',
        fms: 'Immediate change to 23,000 ft',
        predicted: 'Immediate change to 23,000 ft',
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

export function makeSyncDemo(): DemoResult {
  return {
    atc_transcript: SYNC_ATC_TEXT,
    pilot_transcript: SYNC_PILOT_TEXT,
    atc: clearance({
      role: 'atc',
      raw_text: SYNC_ATC_TEXT,
      callsign_confidence: 0.9,
      overall_confidence: 0.9,
      actions: [syncAction(23000)],
    }),
    pilot: clearance({ raw_text: SYNC_PILOT_TEXT, actions: [syncAction(22000)] }),
    fms: fms({
      cleared_alt_ft: 22000,
      target_speed_kts: null,
      loaded: ['MAINTAIN 22000FT'],
      loaded_actions: [syncAction(22000)],
      summary: 'Maintain 22,000 ft immediate',
    }),
    comparison: makeSyncMismatchMatrix(),
    conflict: makeSyncConflict(),
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

/** Safety window mirroring the backend altitude-sync arc (conflict at T+165 s). */
export function makeSyncSafetyWindow(): SafetyWindow {
  return {
    conflict_time_s: 165,
    first_warning_time_s: 0,
    last_safe_correction_s: 0,
    seconds_remaining_s: 0,
    position_at_last_safe: { x_nm: 0, alt_ft: 23000 },
    min_sep_no_correction: {
      min_lateral_nm: 3.34,
      vertical_at_min_lateral_ft: 0,
      min_vertical_ft: 0,
      lateral_at_min_vertical_nm: 3.34,
    },
    min_sep_after_correction: {
      min_lateral_nm: 3.34,
      vertical_at_min_lateral_ft: 1000,
      min_vertical_ft: 1000,
      lateral_at_min_vertical_nm: 3.34,
    },
    causal_chain: [
      { step: 1, stage: 'MISMATCH', detail: 'ATC cleared 23,000 ft; pilot set 22,000 ft.' },
      { step: 2, stage: 'FMS', detail: 'FMS holds the misheard 22,000 ft.' },
      { step: 3, stage: 'TRAJECTORY', detail: 'Wrong setting descends into traffic altitude.' },
      { step: 4, stage: 'CONFLICT', detail: 'Loss of separation at T+165 s.' },
    ],
    basis: 'test basis',
  };
}

export function makeSyncResolvedSafetyWindow(): SafetyWindow {
  return {
    ...makeSyncSafetyWindow(),
    conflict_time_s: null,
    last_safe_correction_s: null,
    seconds_remaining_s: null,
    position_at_last_safe: null,
    causal_chain: [{ step: 1, stage: 'PREDICTION', detail: 'No conflict predicted.' }],
  };
}

export function makeSyncCandidates(): ResolutionCandidate[] {
  return [
    {
      id: 'changed-value-maintain-0',
      action_human: 'Restore ATC MAINTAIN 23000 FT (CHANGED_VALUE).',
      source_evidence: 'maintain 23,000 feet',
      conflict_after: false,
      min_lateral_nm: 3.34,
      min_vertical_ft: 1000,
      verification: 'VERIFIED',
      safe_reason:
        'Restored ATC value removes the divergence; at closest lateral approach ' +
        '(3.34 NM) vertical separation is 1,000 ft with no conflict.',
    },
  ];
}

export function makeSyncVerification(): VerificationResult {
  return {
    candidate_id: 'changed-value-maintain-0',
    verified: true,
    matrix_overall: 'agree',
    conflict_after: false,
    min_lateral_nm: 3.34,
    min_vertical_ft: 1000,
    reason: 'Recomputed comparison is agree; conflict=false.',
  };
}

export function makeSyncCoordination(): CoordinationResult {
  return {
    recommended_candidate_id: 'changed-value-maintain-0',
    summary: 'Deterministic coordination complete. Comparison is mismatch.',
    rationale: 'First verified correction selected.',
    tool_calls: [
      { turn: 1, tool: 'compare_intents', ok: true, summary: '{"overall": "mismatch"}' },
      { turn: 2, tool: 'predict_conflict', ok: true, summary: '{"conflict": true}' },
      {
        turn: 3,
        tool: 'enumerate_verified_corrections',
        ok: true,
        summary: '{"candidates": [{"id": "changed-value-maintain-0"}]}',
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

export function makeSyncLiveCoordination(): CoordinationResult {
  return {
    ...makeSyncCoordination(),
    provenance: 'live_meta_api',
    model: 'muse-spark-1.3',
    note: null,
  };
}

export function makeSyncCorrection(): CorrectionResult {
  return {
    corrected_pilot: clearance({ raw_text: SYNC_ATC_TEXT, actions: [syncAction(23000)] }),
    fms: fms({
      cleared_alt_ft: 23000,
      target_speed_kts: null,
      source: 'corrected',
      loaded: ['MAINTAIN 23000FT'],
      loaded_actions: [syncAction(23000)],
      summary: 'Maintain 23,000 ft immediate',
    }),
    comparison: makeSyncAgreeMatrix(),
    conflict: makeSyncClearConflict(),
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
