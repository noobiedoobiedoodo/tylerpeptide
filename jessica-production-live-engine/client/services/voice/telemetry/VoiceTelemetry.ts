export type TelemetryEventType =
  | 'ENGINE_START'
  | 'ENGINE_STOP'
  | 'LISTENING'
  | 'MIC_AUDIO_DETECTED'
  | 'VAD_SPEECH_START'
  | 'VAD_SPEECH_ENDED'
  | 'STT_START'
  | 'STT_INTERIM'
  | 'STT_FINAL'
  | 'STT_END'
  | 'STT_ERROR'
  | 'VAD_POSSIBLE_END'
  | 'TURN_CREATED'
  | 'MIC_OPENED'
  | 'USER_SPEECH_STARTED'
  | 'USER_SPEECH_ENDED'
  | 'TURN_END_CONFIRMED'
  | 'TURN_COMPLETED'
  | 'TURN_SETTLED'
  | 'TURN_FAILED'
  | 'TURN_DEGRADED'
  | 'TURN_INTERRUPTED_BY_USER'
  | 'TURN_SUPERSEDED'
  | 'TURN_FAILED_STT'
  | 'TURN_FAILED_LLM'
  | 'TURN_FAILED_TTS'
  | 'TURN_FAILED_AUDIO_CONTEXT'
  | 'TURN_FAILED_NETWORK'
  | 'TURN_TIMEOUT'
  | 'COMMIT'
  | 'LLM_REQUEST_STARTED'
  | 'LLM_RESPONSE_RECEIVED'
  | 'API_REQUEST'
  | 'API_RESPONSE'
  | 'API_ERROR'
  | 'OUTPUT_VALIDATED'
  | 'TTS_START'
  | 'TTS_GENERATION_STARTED'
  | 'TTS_FIRST_AUDIO_READY'
  | 'TTS_PLAYBACK_STARTED'
  | 'TTS_SEGMENT_COMPLETED'
  | 'TTS_PLAYBACK_COMPLETED'
  | 'TTS_COMPLETE'
  | 'TTS_ERROR'
  | 'TTS_CANCELLED'
  | 'TTS_RETRYING'
  | 'BARGE_IN_TRIGGERED'
  | 'ERROR_RECORDED'
  | 'STALE_EVENT_DETECTED'
  | 'STALE_EVENT_REJECTED'
  | 'STALE_EVENT_ACCEPTED'
  | 'CROSS_CONVERSATION_REJECTED'
  | 'INVALID_STATE_TRANSITION_REJECTED'
  | 'DUPLICATE_TURN_REJECTED'
  | 'SEQUENCE_CONFLICT'
  | 'IDEMPOTENCY_REPLAY'
  | 'AUDIO_CONTEXT_SUSPENDED'
  | 'AUDIO_CONTEXT_RESUMED'
  | 'TTS_BUFFER_UNDERRUN'
  | 'NETWORK_UNAVAILABLE';

export interface TelemetryIdentity {
  traceId?: string;
  anonymousSessionId?: string;
  conversationId?: string;
  sequenceNumber?: number;
  executionId?: string;
  sessionGeneration?: number;
  turnGeneration?: number;
  recognitionGeneration?: number;
  vadGeneration?: number;
  executionGeneration?: number;
  playbackGeneration?: number;
}

export interface TelemetryTraceItem extends TelemetryIdentity {
  id: string;
  timestamp: number;
  monotonicTimestamp?: number;
  relativeTimeStr: string;
  sessionId: string; // Deprecated, use anonymousSessionId instead but kept for backwards compat
  turnId?: string;
  type: TelemetryEventType;
  description: string;
  previousState?: string;
  currentState?: string;
  payload?: Record<string, any>;
  isError?: boolean;
}

export interface AudioIntegrity {
  expectedSegments: number;
  generatedSegments: number;
  decodedSegments: number;
  scheduledSegments: number;
  completedSegments: number;
  expectedDurationMs: number;
  scheduledDurationMs: number;
  completedDurationMs: number;
  expectedTextChecksum: string;
  generatedTextChecksum: string;
  completionRatio: number;
  terminalState?: 'FULLY_COMPLETED' | 'INTERRUPTED_BY_USER' | 'SUPERSEDED_BY_NEW_TURN' | 'FAILED' | 'DEGRADED';
}

export class VoiceTelemetry {
  private sessionStartTime: number = Date.now();
  private traces: TelemetryTraceItem[] = [];
  private listeners: ((item: TelemetryTraceItem) => void)[] = [];

  resetSessionTimer() {
    this.sessionStartTime = Date.now();
  }

  // Backwards compat log function
  log(
    type: TelemetryEventType,
    sessionId: string,
    turnId?: string,
    description?: string,
    payload?: Record<string, any>,
    isError = false
  ): TelemetryTraceItem {
    return this.logExtended({ type, sessionId, turnId, description, payload, isError });
  }

  logExtended(params: {
    type: TelemetryEventType,
    sessionId: string,
    turnId?: string,
    description?: string,
    previousState?: string,
    currentState?: string,
    payload?: Record<string, any>,
    isError?: boolean
  } & TelemetryIdentity): TelemetryTraceItem {
    const now = Date.now();
    const elapsedMs = Math.max(0, now - this.sessionStartTime);

    const minutes = Math.floor(elapsedMs / 60000);
    const seconds = Math.floor((elapsedMs % 60000) / 1000);
    const millis = elapsedMs % 1000;
    const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;

    const desc = params.description || params.type;
    const traceItem: TelemetryTraceItem = {
      id: `trace_${now}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: now,
      monotonicTimestamp: typeof performance !== 'undefined' ? performance.now() : now,
      relativeTimeStr: timeStr,
      ...params,
      description: desc
    };
    
    // Internal Exception Containment (Fire and Forget)
    try {
        this.traces.push(traceItem);
        this.listeners.forEach(l => {
           try { l(traceItem); } catch(e) { console.error("Telemetry listener error", e); }
        });
    } catch(e) {
        console.error("Telemetry buffer error", e);
    }
    
    return traceItem;
  }

  getTraces(): TelemetryTraceItem[] {
    return [...this.traces];
  }

  onTrace(listener: (item: TelemetryTraceItem) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }
}
