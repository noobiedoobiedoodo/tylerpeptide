/**
 * DiagnosticTypes.ts
 * 
 * Production telemetry and diagnostic types for JARVIS Sales Desk.
 */

export type DiagnosticLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export type DiagnosticCategory =
  | 'SESSION'
  | 'WEBSOCKET'
  | 'GEMINI'
  | 'AUDIO_INPUT'
  | 'AUDIO_OUTPUT'
  | 'STT'
  | 'TTS'
  | 'TURN'
  | 'CRM'
  | 'LEAD'
  | 'SYSTEM'
  | 'CLIENT'
  | 'ERROR';

export interface DiagnosticEvent {
  id: string;
  timestamp: number;
  level: DiagnosticLevel;
  category: DiagnosticCategory;
  event: string;
  conversationId: string;
  sessionGeneration: number;
  socketId: string;
  details?: any;
}

export interface SystemHealthState {
  websocket: 'CONNECTED' | 'CONNECTING' | 'CLOSED' | 'ERROR';
  gemini: 'READY' | 'ERROR' | 'UNKNOWN';
  webaudio: 'RUNNING' | 'SUSPENDED' | 'CLOSED' | 'UNINITIALIZED';
  microphone: 'ACTIVE' | 'INACTIVE' | 'DENIED' | 'UNAVAILABLE';
  geminiApiKey: 'PRESENT' | 'MISSING' | 'SECURED_GATEWAY';
  sessionGeneration: number;
  conversationId: string;
  voiceState: string;
  crm: 'SYNCED' | 'PENDING' | 'ERROR' | 'IDLE';
  activeSocketCount: number;
}

export interface AudioQueueTelemetryDetails {
  responseId?: string;
  audioItemId?: string;
  playbackId?: string;
  generation?: number;
  queueLength?: number;
  activePlaybackId?: string;
  audioContextState?: string;
  reason?: string;
  attemptedAudioItemId?: string;
  startTime?: number;
  duration?: number;
  method?: string;
  [key: string]: any;
}

export const INITIAL_SYSTEM_HEALTH: SystemHealthState = {
  websocket: 'CLOSED',
  gemini: 'UNKNOWN',
  webaudio: 'UNINITIALIZED',
  microphone: 'INACTIVE',
  geminiApiKey: 'MISSING',
  sessionGeneration: 0,
  conversationId: '',
  voiceState: 'DISCONNECTED',
  crm: 'IDLE',
  activeSocketCount: 0
};
