/** Frontend types mirroring backend/app/models.py and backend/app/main.py. */

export type Provenance = 'live_meta_api' | 'live_muse_voice' | 'fixture_fallback';

export type ActionType =
  | 'DIRECT_TO'
  | 'CLIMB'
  | 'DESCEND'
  | 'MAINTAIN'
  | 'SPEED'
  | 'HEADING'
  | 'HOLD';

export type Unit = 'FL' | 'FT' | 'KTS' | 'DEG' | 'NONE';

export type TriggerType = 'IMMEDIATE' | 'AFTER_WAYPOINT' | 'AT_WAYPOINT' | 'AT_TIME';

export type FindingCategory =
  | 'CALLSIGN_MISMATCH'
  | 'MISSING_ACTION'
  | 'EXTRA_ACTION'
  | 'CHANGED_VALUE'
  | 'CHANGED_WAYPOINT'
  | 'MISSING_CONDITION'
  | 'CHANGED_CONDITION'
  | 'INCORRECT_EXECUTION_TIME'
  | 'PARTIAL_FMS_LOAD';

export type FindingScope = 'atc_vs_pilot' | 'pilot_vs_fms';
export type OverallStatus = 'agree' | 'mismatch' | 'verify_required';
export type RowStatus = 'match' | 'mismatch' | 'info';

export interface ClearanceAction {
  action_type: ActionType;
  target_fix: string | null;
  numeric_value: number | null;
  unit: Unit;
  trigger_type: TriggerType;
  trigger_value: string | null;
  evidence: string | null;
  confidence: number;
}

export interface Clearance {
  callsign: string | null;
  callsign_evidence: string | null;
  callsign_confidence: number;
  actions: ClearanceAction[];
  overall_confidence: number;
  raw_text: string;
  role: 'atc' | 'pilot';
  provenance: Provenance;
  model: string;
  note: string | null;
}

export interface FMSProgram {
  callsign: string | null;
  cleared_fl: number | null;
  cleared_alt_ft: number | null;
  climb_start_fix: string | null;
  lateral_direct_to: string | null;
  route: string[];
  loaded: string[];
  held: string[];
  loaded_actions: ClearanceAction[];
  source: 'atc' | 'pilot' | 'corrected';
  provenance: Provenance;
  summary: string;
}

export interface Finding {
  category: FindingCategory;
  scope: FindingScope;
  action: string;
  detail: string;
}

export interface MatrixRow {
  aspect: string;
  atc: string;
  pilot: string;
  fms: string;
  predicted: string;
  status: RowStatus;
  category: string;
  note: string;
}

export interface ComparisonMatrix {
  rows: MatrixRow[];
  findings: Finding[];
  overall: OverallStatus;
  min_confidence: number;
  missing_condition: boolean;
  missing_phrase: string | null;
}

export interface ProfilePoint {
  t_s: number;
  meta_x_nm: number;
  meta_ft: number;
  intruder_x_nm: number;
  intruder_y_nm: number;
  intruder_ft: number;
}

export interface ConflictPrediction {
  conflict: boolean;
  first_conflict_time_s: number | null;
  lateral_nm_at_conflict: number | null;
  vertical_ft_at_conflict: number | null;
  closest_lateral_nm: number;
  min_vertical_ft: number;
  conflict_point_nm: Record<string, number> | null;
  lateral_threshold_nm: number;
  vertical_threshold_ft: number;
  basis: string;
  profile: ProfilePoint[];
}

export interface Explanation {
  summary: string;
  cause: string;
  evidence: string[];
  recommended_action: string;
  provenance: Provenance;
  model: string;
}

export interface VoiceTranscript {
  transcript: string;
  provenance: Provenance;
  model: string;
  source_file: string;
  note: string | null;
}

export interface DemoResult {
  atc_transcript: string;
  pilot_transcript: string;
  atc: Clearance;
  pilot: Clearance;
  fms: FMSProgram;
  comparison: ComparisonMatrix;
  conflict: ConflictPrediction;
  explanation: Explanation;
  badges: Record<string, string>;
}

export interface CorrectionResult {
  corrected_pilot: Clearance;
  fms: FMSProgram;
  comparison: ComparisonMatrix;
  conflict: ConflictPrediction;
  explanation: Explanation;
  resolved: boolean;
  badges: Record<string, string>;
}

export interface SeparationMinima {
  min_lateral_nm: number;
  vertical_at_min_lateral_ft: number;
  min_vertical_ft: number;
  lateral_at_min_vertical_nm: number;
}

export interface CausalStep {
  step: number;
  stage: string;
  detail: string;
}

export interface SafetyWindow {
  conflict_time_s: number | null;
  first_warning_time_s: number;
  last_safe_correction_s: number | null;
  seconds_remaining_s: number | null;
  position_at_last_safe: Record<string, number> | null;
  min_sep_no_correction: SeparationMinima;
  min_sep_after_correction: SeparationMinima;
  causal_chain: CausalStep[];
  basis: string;
}

export interface ResolutionCandidate {
  id: string;
  action_human: string;
  source_evidence: string | null;
  conflict_after: boolean;
  min_lateral_nm: number;
  min_vertical_ft: number;
  verification: 'VERIFIED' | 'NOT_RESOLVED';
  safe_reason: string;
}

export interface VerificationResult {
  candidate_id: string;
  verified: boolean;
  matrix_overall: OverallStatus;
  conflict_after: boolean;
  min_lateral_nm: number;
  min_vertical_ft: number;
  reason: string;
}

export interface Fingerprints {
  atc: string;
  pilot: string;
  fms: string;
  all_agree: boolean;
  display_id: string;
}

export interface AuditEvent {
  seq: number;
  type: string;
  provenance: string;
  model: string | null;
  result: Record<string, unknown>;
  human_confirmation: string;
  prev_hash: string;
  hash: string;
}

export interface AuditVerify {
  valid: boolean;
  length: number;
  head: string | null;
  first_bad_seq: number | null;
}

export interface ToolCallRecord {
  turn: number;
  tool: string;
  ok: boolean;
  summary: string;
}

export interface CoordinationResult {
  recommended_candidate_id: string | null;
  summary: string;
  rationale: string;
  tool_calls: ToolCallRecord[];
  provenance: Provenance;
  model: string;
  overridden: boolean;
  note: string | null;
}

export interface Health {
  status: string;
  model: string;
  voice_model: string;
  meta_api_configured: boolean;
  voice_configured: boolean;
}

export interface ScenarioInfo {
  id: string;
  title: string;
}

export const PROVENANCE_LABELS: Record<Provenance, string> = {
  live_meta_api: 'Live Meta API',
  live_muse_voice: 'Live Muse Voice',
  fixture_fallback: 'Fixture fallback',
};
