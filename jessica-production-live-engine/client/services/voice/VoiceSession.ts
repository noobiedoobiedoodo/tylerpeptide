/**
 * VoiceSession - Session Models & Immutable Turn Types
 * 
 * Defines immutable data contracts for turns, session metrics, error classifications,
 * and conversational outcomes.
 */

export interface UserTurn {
  sessionId: string;
  conversationId: string;
  turnId: string;
  transcript: string;
  startedAt: number;
  endedAt: number;
  confidence?: number;
  interrupted: boolean;
}

export interface TranscriptQuality {
  confidence?: number;
  durationMs: number;
  speechDetected: boolean;
  repeated: boolean;
  likelyEcho: boolean;
  likelyIncomplete: boolean;
}

export type VoiceError =
  | 'MICROPHONE_PERMISSION'
  | 'MICROPHONE_UNAVAILABLE'
  | 'VAD_FAILURE'
  | 'STT_FAILURE'
  | 'STT_EMPTY'
  | 'NETWORK_FAILURE'
  | 'API_HTTP_ERROR'
  | 'API_PARSE_ERROR'
  | 'LLM_FAILURE'
  | 'TTS_FAILURE'
  | 'AUDIO_PLAYBACK_FAILURE';

export interface TurnOutcome {
  turnId: string;
  inputQuality: number;
  transcriptionConfidence?: number;
  responseLatencyMs: number;
  ttsLatencyMs?: number;
  interrupted: boolean;
  repeatedByUser: boolean;
  userCorrectedWinston: boolean;
  conversationStage: string;
  outcome: 'SUCCESS' | 'RETRY' | 'INTERRUPTED' | 'CLARIFICATION' | 'ERROR';
  errorType?: VoiceError;
  errorMessage?: string;
}

export interface SessionHealthMetrics {
  totalTurns: number;
  successfulTurns: number;
  microphoneHealth: number; // 0-100%
  vadHealth: number; // 0-100%
  sttHealth: number; // 0-100%
  turnDetectionHealth: number; // 0-100%
  apiHealth: number; // 0-100%
  ttsHealth: number; // 0-100%
  conversationHealth: number; // 0-100%
  topFailureModes: Array<{ name: string; percentage: number }>;
}

export interface ConversationDecision {
  objective:
    | 'DISCOVER'
    | 'CLARIFY'
    | 'ACKNOWLEDGE'
    | 'ANSWER'
    | 'REASSURE'
    | 'QUALIFY'
    | 'HANDOFF'
    | 'WAIT'
    | 'COMPLETE';
  shouldSpeak: boolean;
  shouldAskQuestion: boolean;
  questionTopic?: string;
  confidence: number;
}
