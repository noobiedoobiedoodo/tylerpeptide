/**
 * GeminiLiveClient - Native 1-to-1 Multimodal Speech-to-Speech Client
 * 
 * Directly connects browser raw PCM audio to Gemini Live WebSocket:
 * - 16kHz PCM audio input streaming (16-bit, little-endian, mono)
 * - 24kHz PCM scheduled audio output with gapless playback
 * - Zero-latency acoustic barge-in / cancellation
 * - Real-time audio analysis for visualizer HUD
 * - Generation-tracked connection lifecycle with single active socket invariant
 * - Authoritative close code classification (1007 strictly halts with zero auto-reconnects)
 * - Outbound message firewall with runtime validation & 20-message ring buffer forensics
 */

import {
  BuyerProfile,
  LeadIntelligenceMetrics,
  BuyerIntelligenceState,
  mergeBuyerProfile,
  parseTranscriptForBuyerIntel,
  normalizePhone
} from './voiceLeadExtractor';
import { diagnosticStore } from '../diagnostics/DiagnosticLogger';
import { WebAudioEngine } from '../audio/WebAudioEngine';
import { WakeLockManager } from './WakeLockManager';
import { collectAndEnrichForensics } from '../../../lib/deviceForensics';

export type MicStatus =
  | 'unknown'
  | 'requesting'
  | 'available'
  | 'denied'
  | 'unavailable';

export type LiveConnectionState =
  | 'DISCONNECTED'
  | 'INITIALIZING'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'READY'
  | 'LISTENING'
  | 'THINKING'
  | 'USER_SPEAKING'
  | 'SPEAKING'
  | 'WAITING_FOR_TURN_COMPLETE'
  | 'INTERRUPTED'
  | 'ERROR'
  | 'PROTOCOL_ERROR'
  | 'RECONNECTING';

export type CloseClassification =
  | 'NORMAL'
  | 'PROTOCOL_ERROR'
  | 'TRANSIENT_NETWORK'
  | 'SERVER_ERROR'
  | 'UNKNOWN';

export function classifyCloseCode(code: number): CloseClassification {
  switch (code) {
    case 1000:
      return 'NORMAL';
    case 1002:
    case 1003:
    case 1007:
    case 1008:
      return 'PROTOCOL_ERROR';
    case 1006:
    case 1013:
      return 'TRANSIENT_NETWORK';
    case 1011:
    case 1012:
      return 'SERVER_ERROR';
    default:
      return 'UNKNOWN';
  }
}

export class ProtocolValidationError extends Error {
  constructor(message: string) {
    super(`[ProtocolValidationError] ${message}`);
    this.name = 'ProtocolValidationError';
  }
}

export interface ProtocolTraceEntry {
  seq: number;
  generation: number;
  timestamp: number;
  direction: 'OUTBOUND' | 'INBOUND';
  type: string;
  subtype?: string;
  byteSize?: number;
  socketId?: string;
}

export interface ProtocolEvent {
  timestamp: number;
  generation: number;
  eventType: string;
  details?: any;
}

export interface LiveMessage {
  id: string;
  sender: 'user' | 'jarvis';
  text: string;
  timestamp: number;
}

export interface LiveClientCallbacks {
  onStateChange: (state: LiveConnectionState) => void;
  onUserAudioLevel: (level: number) => void;
  onJarvisAudioLevel: (level: number) => void;
  onTranscript: (turn: { sender: 'user' | 'jarvis'; text: string; isFinal: boolean }) => void;
  onBuyerIntelligenceUpdated?: (state: BuyerIntelligenceState) => void;
  onEvidenceClassification?: (evidence: any) => void;
  onSafetyEscalation?: (safety: any) => void;
  onMicStatusChange?: (status: MicStatus) => void;
  onError: (errorMessage: string) => void;
}

export type VoiceAgentType = 'PEPTIDE_SPECIALIST' | 'AUTOMOTIVE';

export interface LiveClientOptions {
  agentType?: VoiceAgentType;
  initialProfile?: BuyerProfile;
  conversationId?: string;
  leadId?: string | null;
  enableTools?: boolean;
  enableSpeechRecognition?: boolean;
  apiKey?: string;
  model?: string;
  voiceName?: string;
  systemPrompt?: string;
  silenceHangoverFrames?: number;
  useGateway?: boolean;
}

export interface AudioQueueItem {
  audioItemId: string;
  responseId: string;
  generation: number;
  buffer: AudioBuffer;
  started: boolean;
  completed: boolean;
}

export interface ActivePlaybackState {
  playbackId: string;
  audioItemId: string;
  responseId: string;
  generation: number;
  source: AudioBufferSourceNode;
}

export class GeminiLiveClient {
  private ws: WebSocket | null = null;
  private activeSocketId: string | null = null;
  private connectionGeneration = 0;
  private sessionGeneration = 0;
  private reconnectAttempts = 0;
  private reconnectTimer: any = null;

  private state: LiveConnectionState = 'DISCONNECTED';
  private callbacks: LiveClientCallbacks;
  
  // Tactical CRM & Buyer Intelligence State
  private buyerState: BuyerIntelligenceState = {
    profile: {},
    metrics: null,
    crmStatus: 'IDLE',
    lastUpdated: null
  };
  private conversationId: string = 'conv_live_' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 11)));
  private leadId: string | null = null;
  private syncTimeout: any = null;
  private isSyncing = false;
  private pendingSync = false;
  private enableTools = true;
  private isAwaitingToolResponse = false;

  private inputAudioContext: AudioContext | null = null;
  private inputMediaStream: MediaStream | null = null;
  private inputProcessor: ScriptProcessorNode | null = null;
  private inputSourceNode: MediaStreamAudioSourceNode | null = null;
  private inputAnalyser: AnalyserNode | null = null;

  private outputAudioContext: AudioContext | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private nextPlaybackTime = 0;
  private activeAudioSources: AudioBufferSourceNode[] = [];

  // P0 Audio Queue & Single-Consumer State
  private audioQueue: AudioQueueItem[] = [];
  private playbackConsumerRunning = false;
  private activePlayback: ActivePlaybackState | null = null;
  private playedAudioItemIds = new Set<string>();
  private readonly MAX_PLAYED_AUDIO_IDS = 500;
  private currentResponseId = '';
  private audioItemCounter = 0;
  private consecutiveBargeInFrames = 0;
  private silenceHangoverFrames = 0;
  private hasActiveSpeechTurn = false;
  private noiseFloor = 0.004;
  private streamingAudioBuffer = '';
  private pcmOddByte: number | null = null;

  private isMuted = false;
  private audioPlaybackSuppressed = false;
  private lastJarvisPlaybackEndTime = 0;
  private lastNaturalPlaybackEndTime = 0;
  private _aborted = false; // Abort flag for in-flight connect() during unmount/cleanup
  private animationFrameId: number | null = null;
  private currentJarvisTranscript = '';
  private speechRecognition: any = null;
  private enableSpeechRecognition = false;
  
  // Phone Capture & Zero-False Confirmation State Machine
  public isAwaitingPhoneConfirmation = false;
  public isPhoneConfirmed = false;
  public pending7DigitPhone: string | null = null;
  public wasLastUserTurnRejection = false;
  
  // Observational Watchdogs (Single active instance per generation)
  private watchdogGeneration: number | null = null;
  private turnWatchdogTimer: any = null;
  private playbackWatchdogInterval: any = null;

  private micStatus: MicStatus = 'unknown';
  private hasSentInitialGreeting = false;
  public static globalGreetingSentSessions = new Set<string>();
  private static readonly MAX_GLOBAL_GREETING_IDS = 200;
  private greetingSentForConversation = new Set<string>();
  private answeredFunctionCalls = new Set<string>();
  private readonly MAX_ANSWERED_FUNCTION_CALLS = 200;

  // Forensics Ring Buffers (Max 20 outbound traces, 100 protocol events)
  private outboundRingBuffer: ProtocolTraceEntry[] = [];
  private readonly MAX_OUTBOUND_TRACE = 20;
  private protocolEventsRingBuffer: ProtocolEvent[] = [];
  private readonly MAX_PROTOCOL_EVENTS = 100;
  private messageSequence = 0;
  private lastSetupConfigHash = '';

  private apiKey = '';
  private useGateway = false;
  private agentType: VoiceAgentType = 'AUTOMOTIVE';
  private model = 'models/gemini-2.5-flash-native-audio-latest';
  private voiceName = 'Fenrir';
  private systemPrompt = '';
  private speechRecognitionActive = false;
  private defaultSilenceHangoverFrames: number = (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') ? 8 : 18;

  public static sharedAudioContext: AudioContext | null = null;
  public static activeInstance: GeminiLiveClient | null = null;
  private pendingGreetingOnUnlock = false;
  private visibilityListener: (() => void) | null = null;

  /**
   * Section 2: Directly unlocks the browser Web Audio context inside a user gesture
   * using the WebAudioEngine singleton. Guarantees 1-sample silent buffer trigger for mobile Safari/Chrome.
   */
  public static async unlockAudioContext(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    try {
      const engine = WebAudioEngine.getInstance();
      const ctx = await engine.initializeFromUserGesture();
      GeminiLiveClient.sharedAudioContext = ctx;
      diagnosticStore.updateHealth({ webaudio: ctx.state === 'running' ? 'RUNNING' : 'SUSPENDED' });

      // If there is an active client with audio buffered while suspended, resume playback seamlessly
      if (GeminiLiveClient.activeInstance && ctx.state === 'running') {
        GeminiLiveClient.activeInstance.outputAudioContext = ctx;
        GeminiLiveClient.activeInstance.nextPlaybackTime = ctx.currentTime;
        GeminiLiveClient.activeInstance.processNextQueueItem();
      }

      return ctx.state === 'running';
    } catch (e: any) {
      console.warn('[GeminiLive] Failed to unlock audio context:', e);
      diagnosticStore.log({
        level: 'ERROR',
        category: 'AUDIO_OUTPUT',
        event: 'AUDIO_HARDWARE_UNLOCK_FAILED',
        details: { error: e?.message || String(e) }
      });
      return false;
    }
  }

  /**
   * Returns whether the shared Web Audio context is currently active and running.
   */
  public static isAudioContextRunning(): boolean {
    if (typeof window === 'undefined') return false;
    const ctx = WebAudioEngine.getInstance().getAudioContext() || GeminiLiveClient.sharedAudioContext;
    return Boolean(ctx && ctx.state === 'running');
  }

  constructor(callbacks: LiveClientCallbacks, options?: LiveClientOptions) {
    if (GeminiLiveClient.activeInstance && GeminiLiveClient.activeInstance !== this) {
      try {
        console.log('[GeminiLive] Tearing down prior activeInstance to enforce singleton invariant');
        GeminiLiveClient.activeInstance.disconnect();
      } catch (e) {
        console.warn('[GeminiLive] Failed to disconnect prior active instance:', e);
      }
    }
    GeminiLiveClient.activeInstance = this;
    this.callbacks = callbacks;
    if (options?.conversationId) {
      this.conversationId = options.conversationId;
    }
    if (options?.leadId) {
      this.leadId = options.leadId;
    }
    if (options?.initialProfile) {
      this.buyerState.profile = { ...options.initialProfile };
    }
    if (options?.enableTools !== undefined) {
      this.enableTools = options.enableTools;
    }
    if (options?.enableSpeechRecognition !== undefined) {
      this.enableSpeechRecognition = options.enableSpeechRecognition;
    }
    if (options?.apiKey) {
      this.apiKey = options.apiKey;
    }
    if (options?.model) {
      this.model = options.model;
    }
    if (options?.voiceName) {
      this.voiceName = options.voiceName;
    }
    if (options?.systemPrompt) {
      this.systemPrompt = options.systemPrompt;
    }
    if (options?.silenceHangoverFrames !== undefined) {
      this.defaultSilenceHangoverFrames = options.silenceHangoverFrames;
    }
    if (options?.useGateway !== undefined) {
      this.useGateway = options.useGateway;
    }
    if (options?.agentType) {
      this.agentType = options.agentType;
      if (this.agentType === 'PEPTIDE_SPECIALIST' && !options.voiceName) {
        this.voiceName = 'Charon';
      }
    }

    diagnosticStore.log({
      level: 'INFO',
      category: 'SESSION',
      event: 'SESSION_CREATED',
      sessionGeneration: this.connectionGeneration,
      conversationId: this.conversationId,
      details: { leadId: this.leadId, hasInitialProfile: Object.keys(this.buyerState.profile).length > 0 }
    });
    diagnosticStore.updateHealth({
      sessionGeneration: this.connectionGeneration,
      conversationId: this.conversationId,
      voiceState: this.state
    });
  }

  getConversationId(): string {
    return this.conversationId;
  }

  getLeadId(): string | null {
    return this.leadId;
  }

  getState(): LiveConnectionState {
    return this.state;
  }

  getMicStatus(): MicStatus {
    return this.micStatus;
  }

  getConnectionGeneration(): number {
    return this.connectionGeneration;
  }

  getSessionGeneration(): number {
    return this.sessionGeneration;
  }

  getActiveSocketId(): string | null {
    return this.activeSocketId;
  }

  private setMicStatus(status: MicStatus) {
    this.micStatus = status;
    this.recordProtocolEvent('MIC_STATUS_CHANGE', { status });
    this.callbacks.onMicStatusChange?.(status);
  }

  private setState(newState: LiveConnectionState) {
    if (this.state === newState) return;
    const oldState = this.state;
    this.state = newState;
    this.recordProtocolEvent('STATE_CHANGE', { from: oldState, to: newState });
    this.callbacks.onStateChange(newState);
  }

  // ── Protocol Tracing & Forensic Ring Buffers ─────────────────────────────

  private recordProtocolEvent(eventType: string, details?: any): void {
    const entry: ProtocolEvent = {
      timestamp: Date.now(),
      generation: this.connectionGeneration,
      eventType,
      details: details ? (typeof details === 'object' ? { ...details } : details) : undefined
    };
    this.protocolEventsRingBuffer.push(entry);
    if (this.protocolEventsRingBuffer.length > this.MAX_PROTOCOL_EVENTS) {
      this.protocolEventsRingBuffer.shift();
    }
  }

  private recordOutboundTrace(type: string, subtype?: string, byteSize?: number): void {
    const entry: ProtocolTraceEntry = {
      seq: ++this.messageSequence,
      generation: this.connectionGeneration,
      timestamp: Date.now(),
      direction: 'OUTBOUND',
      type,
      subtype,
      byteSize,
      socketId: this.activeSocketId || undefined
    };
    this.outboundRingBuffer.push(entry);
    if (this.outboundRingBuffer.length > this.MAX_OUTBOUND_TRACE) {
      this.outboundRingBuffer.shift();
    }
  }

  public getProtocolDiagnostics(): {
    outboundRingBuffer: ProtocolTraceEntry[];
    protocolEvents: ProtocolEvent[];
    connectionGeneration: number;
    activeSocketId: string | null;
    state: LiveConnectionState;
    setupConfigHash: string;
    hasSentInitialGreeting: boolean;
  } {
    return {
      outboundRingBuffer: [...this.outboundRingBuffer],
      protocolEvents: [...this.protocolEventsRingBuffer],
      connectionGeneration: this.connectionGeneration,
      activeSocketId: this.activeSocketId,
      state: this.state,
      setupConfigHash: this.lastSetupConfigHash,
      hasSentInitialGreeting: this.greetingSentForConversation.has(this.conversationId)
    };
  }

  // ── Outbound Firewall & Runtime Message Validators ────────────────────────

  private validateSetup(payload: any): void {
    if (!payload?.setup || typeof payload.setup !== 'object') {
      throw new ProtocolValidationError('Setup payload missing setup object');
    }
    if (typeof payload.setup.model !== 'string' || !payload.setup.model.trim()) {
      throw new ProtocolValidationError('Setup model must be a non-empty string');
    }
    if (payload.setup.generationConfig?.responseModalities) {
      if (!Array.isArray(payload.setup.generationConfig.responseModalities)) {
        throw new ProtocolValidationError('Setup responseModalities must be an array');
      }
    }
  }

  private validateRealtimeAudio(payload: any): void {
    const audio = payload?.realtimeInput?.audio;
    if (audio) {
      if (!audio.mimeType || !audio.mimeType.startsWith('audio/pcm')) {
        throw new ProtocolValidationError(`Invalid audio mimeType: ${audio.mimeType}`);
      }
      if (!audio.data || typeof audio.data !== 'string' || audio.data.length === 0) {
        throw new ProtocolValidationError('audio data must be non-empty base64 string');
      }
      return;
    }

    const mediaChunks = payload?.realtimeInput?.mediaChunks;
    if (Array.isArray(mediaChunks) && mediaChunks.length > 0) {
      for (const chunk of mediaChunks) {
        if (!chunk.mimeType || !chunk.mimeType.startsWith('audio/pcm')) {
          throw new ProtocolValidationError(`Invalid mediaChunk mimeType: ${chunk.mimeType}`);
        }
        if (!chunk.data || typeof chunk.data !== 'string' || chunk.data.length === 0) {
          throw new ProtocolValidationError('mediaChunk data must be non-empty base64 string');
        }
      }
      return;
    }

    throw new ProtocolValidationError('realtimeInput must contain non-empty audio object or mediaChunks array');
  }

  private validateRealtimeActivity(payload: any): void {
    const actStart = payload?.realtimeInput?.activityStart;
    const actEnd = payload?.realtimeInput?.activityEnd;
    if ((!actStart || typeof actStart !== 'object') && (!actEnd || typeof actEnd !== 'object')) {
      throw new ProtocolValidationError('realtimeInput must contain activityStart or activityEnd object');
    }
  }

  private validateRealtimeText(payload: any): void {
    const text = payload?.realtimeInput?.text;
    if (typeof text !== 'string' || !text.trim()) {
      throw new ProtocolValidationError('realtimeInput.text must be a non-empty string');
    }
  }

  private validateClientContent(payload: any): void {
    if (!payload?.clientContent || typeof payload.clientContent !== 'object') {
      throw new ProtocolValidationError('clientContent must be an object');
    }
    const turns = payload.clientContent.turns;
    if (!Array.isArray(turns) || turns.length === 0) {
      throw new ProtocolValidationError('clientContent.turns must be a non-empty array. Empty turnComplete-only messages trigger 1007!');
    }
    for (const turn of turns) {
      if (!Array.isArray(turn.parts) || turn.parts.length === 0) {
        throw new ProtocolValidationError('Each turn in clientContent must have a non-empty parts array');
      }
    }
  }

  private validateToolResponse(payload: any): void {
    const fnResponses = payload?.toolResponse?.functionResponses;
    if (!Array.isArray(fnResponses) || fnResponses.length === 0) {
      throw new ProtocolValidationError('toolResponse.functionResponses must be a non-empty array');
    }
    for (const item of fnResponses) {
      if (!item.id || typeof item.id !== 'string') {
        throw new ProtocolValidationError('toolResponse functionResponse missing required string id');
      }
      if (!item.name || typeof item.name !== 'string') {
        throw new ProtocolValidationError('toolResponse functionResponse missing required string name');
      }
      if (!item.response || typeof item.response !== 'object') {
        throw new ProtocolValidationError('toolResponse functionResponse missing required response object');
      }
    }
  }

  public validateToolCallResponse(call: any, responseData: any): boolean {
    if (!call || typeof call !== 'object') {
      console.error('[GeminiLive] Tool response validation failed: call is not an object');
      return false;
    }
    if (typeof call.name !== 'string' || !call.name.trim()) {
      console.error('[GeminiLive] Tool response validation failed: missing call name');
      return false;
    }
    if (!responseData || typeof responseData !== 'object') {
      console.error('[GeminiLive] Tool response validation failed: response is not an object');
      return false;
    }
    try {
      JSON.stringify(responseData);
    } catch {
      console.error('[GeminiLive] Tool response validation failed: response is not JSON-serializable');
      return false;
    }
    return true;
  }

  /**
   * Outbound Message Firewall: All WebSocket writes MUST pass through this method.
   * Performs connection-state validation, generation verification, payload validation,
   * protocol tracing, and transmission.
   */
  private sendOutbound(type: string, payload: any, subtype?: string, byteSize?: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn(`[GeminiLive] Cannot send ${type}: WebSocket is not open (readyState=${this.ws?.readyState})`);
      return;
    }

    // Run structural validator before transmission
    switch (type) {
      case 'setup':
        this.validateSetup(payload);
        break;
      case 'realtimeInput.activityStart':
      case 'realtimeInput.activityEnd':
        this.validateRealtimeActivity(payload);
        break;
      case 'realtimeInput.audio':
        this.validateRealtimeAudio(payload);
        break;
      case 'realtimeInput.text':
      case 'realtimeInput':
        if (payload?.realtimeInput?.audio || payload?.realtimeInput?.mediaChunks) {
          this.validateRealtimeAudio(payload);
        } else if (payload?.realtimeInput?.text !== undefined) {
          this.validateRealtimeText(payload);
        } else if (payload?.realtimeInput?.activityStart || payload?.realtimeInput?.activityEnd) {
          this.validateRealtimeActivity(payload);
        } else {
          throw new ProtocolValidationError('Unknown realtimeInput payload structure');
        }
        break;
      case 'clientContent':
        this.validateClientContent(payload);
        break;
      case 'toolResponse':
        this.validateToolResponse(payload);
        break;
      default:
        console.warn(`[GeminiLive] Unvalidated outbound message type: ${type}`);
    }

    // Record forensic trace
    this.recordOutboundTrace(type, subtype, byteSize);
    this.recordProtocolEvent('SEND', { type, subtype, byteSize });

    const mappedType: 'SETUP' | 'AUDIO' | 'TEXT' | 'TOOL_CALL' | 'TOOL_RESPONSE' | 'TURN_COMPLETE' | 'INTERRUPTION' | 'CLOSE' =
      type === 'setup' ? 'SETUP' :
      type === 'realtimeInput.audio' ? 'AUDIO' :
      type === 'realtimeInput.activityStart' || type === 'realtimeInput.activityEnd' ? 'TURN_COMPLETE' :
      type === 'realtimeInput.text' ? 'TEXT' :
      type === 'clientContent' ? 'TEXT' :
      type === 'toolResponse' ? 'TOOL_RESPONSE' : 'TEXT';

    diagnosticStore.log({
      level: mappedType === 'AUDIO' ? 'DEBUG' : 'INFO',
      category: 'WEBSOCKET',
      event: mappedType === 'SETUP' ? 'GEMINI_SETUP_SENT' : 'OUTBOUND_MESSAGE',
      sessionGeneration: this.connectionGeneration,
      conversationId: this.conversationId,
      socketId: this.activeSocketId || '',
      details: {
        direction: 'OUT',
        type: mappedType,
        subtype,
        generation: this.connectionGeneration,
        socketId: this.activeSocketId || '',
        size: byteSize || JSON.stringify(payload).length,
        schema: type
      }
    });

    // Transmit over wire
    this.ws.send(JSON.stringify(payload));
  }

  private computeSetupConfigHash(setupPayload: any): string {
    const str = JSON.stringify({
      model: setupPayload?.setup?.model,
      modalities: setupPayload?.setup?.generationConfig?.responseModalities,
      voice: setupPayload?.setup?.generationConfig?.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName,
      tools: setupPayload?.setup?.tools?.map((t: any) => t.functionDeclarations?.map((f: any) => f.name)),
      hasSystemInstruction: Boolean(setupPayload?.setup?.systemInstruction)
    });
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return 'setup_' + Math.abs(hash).toString(16);
  }

  // ── Session Connection & Lifecycle ────────────────────────────────────────

  /**
   * Connects to Gemini Multimodal Live API.
   * Microphone availability is NOT a prerequisite for establishing the Live session.
   */
  async connect(): Promise<void> {
    if (this.state !== 'DISCONNECTED' && this.state !== 'ERROR' && this.state !== 'PROTOCOL_ERROR') return;

    this._aborted = false;
    this.setState('INITIALIZING');

    try {
      // 1. Fetch live config from server or environment
      try {
        const configRes = await fetch('/api/voice/live-config');
        if (this._aborted) return;
        if (configRes.ok) {
          const config = await configRes.json();
          if (config.apiKey) this.apiKey = config.apiKey;
          if (config.model) this.model = config.model;
          if (config.voiceName) this.voiceName = config.voiceName;
          if (config.systemPrompt) this.systemPrompt = config.systemPrompt;
          if (config.useGateway !== undefined) this.useGateway = Boolean(config.useGateway);
        }
      } catch (e) {
        console.warn('[GeminiLive] Failed to fetch server config, checking process.env:', e);
      }

      if (this._aborted) return;

      // Fallback for testing environments with injected mock key
      if (!this.apiKey && typeof process !== 'undefined' && (process.env as any)?.GEMINI_API_KEY) {
        this.apiKey = (process.env as any).GEMINI_API_KEY;
      }

      if (!this.useGateway && !this.apiKey) {
        diagnosticStore.updateHealth({ geminiApiKey: 'MISSING' });
        throw new Error('Gemini API key is not available. Please verify GEMINI_API_KEY in .env.');
      }
      diagnosticStore.updateHealth({ geminiApiKey: this.useGateway ? 'SECURED_GATEWAY' : 'PRESENT' });

      // 2. Initialize output audio pipeline (independent of microphone)
      this.setupOutputAudio();
      if (this._aborted) return;

      // 3. Attempt microphone capture (NON-BLOCKING capability check)
      if (this.micStatus !== 'denied' && this.micStatus !== 'unavailable') {
        try {
          await this.attemptMicrophoneSetup(2000);
        } catch (micErr: any) {
          console.warn('[GeminiLive] Initial mic setup deferred (user gesture or permission needed):', micErr?.message || micErr);
        }
      }

      if (this._aborted) return;

      this.setState('CONNECTING');

      // 4. Connect to Google Gemini BidiGenerateContent WebSocket
      this.openWebSocket();

      // 5. Engage Screen Keep-Awake and background recovery
      WakeLockManager.getInstance().request().catch(() => {});
      this.setupVisibilityRecovery();

    } catch (err: any) {
      console.error('[GeminiLive] Session connection error:', err);
      diagnosticStore.log({
        level: 'ERROR',
        category: 'SESSION',
        event: 'GEMINI_ERROR',
        sessionGeneration: this.connectionGeneration,
        conversationId: this.conversationId,
        details: { error: err?.message || String(err) }
      });
      diagnosticStore.updateHealth({ gemini: 'ERROR', websocket: 'ERROR' });
      this.setState('ERROR');
      this.callbacks.onError(err.message || 'Live connection failed. Please check network connection.');
      this.disconnect();
    }
  }

  private static activeGeminiSocketsCount = 0;

  public static resetActiveSocketCountForTesting(): void {
    GeminiLiveClient.activeGeminiSocketsCount = 0;
  }

  public static getActiveSocketCount(): number {
    return GeminiLiveClient.activeGeminiSocketsCount;
  }

  private closeExistingSocket(): void {
    if (this.ws) {
      const oldSocketId = this.activeSocketId || 'unknown';
      const oldGen = this.connectionGeneration;
      const oldReadyState = this.ws.readyState;
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.ws.close();
      } catch {}
      this.ws = null;
      this.activeSocketId = null;
      GeminiLiveClient.activeGeminiSocketsCount = Math.max(0, GeminiLiveClient.activeGeminiSocketsCount - 1);
      diagnosticStore.updateHealth({ activeSocketCount: GeminiLiveClient.activeGeminiSocketsCount });
      diagnosticStore.log({
        level: 'INFO',
        category: 'WEBSOCKET',
        event: 'SOCKET_CLOSED',
        sessionGeneration: oldGen,
        conversationId: this.conversationId,
        socketId: oldSocketId,
        details: { socketId: oldSocketId, generation: oldGen, readyState: oldReadyState, activeSockets: GeminiLiveClient.activeGeminiSocketsCount }
      });
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Opens the Gemini Multimodal Live Bidi WebSocket connection.
   * Guarantees Single Active Socket invariant and Connection Generation protection.
   */
  private openWebSocket(): void {
    if (this._aborted) return;

    // RULE 4: Single active socket invariant
    const oldSocketId = this.activeSocketId;
    if (this.ws) {
      diagnosticStore.log({
        level: 'INFO',
        category: 'WEBSOCKET',
        event: 'SOCKET_REPLACED',
        sessionGeneration: this.connectionGeneration,
        conversationId: this.conversationId,
        socketId: oldSocketId || '',
        details: { oldSocketId, generation: this.connectionGeneration }
      });
    }
    this.closeExistingSocket();
    this.clearReconnectTimer();
    this.clearTurnWatchdog();

    const generation = ++this.connectionGeneration;
    this.sessionGeneration = generation;
    const socketId = `gemini-live-${generation}-${Date.now().toString(36)}`;
    this.activeSocketId = socketId;

    this.recordProtocolEvent('OPEN_WEBSOCKET_ATTEMPT', {
      generation,
      socketId,
      reconnectAttempts: this.reconnectAttempts
    });

    diagnosticStore.log({
      level: 'INFO',
      category: 'WEBSOCKET',
      event: 'WEBSOCKET_CONNECT_START',
      sessionGeneration: generation,
      conversationId: this.conversationId,
      socketId,
      details: { socketId, reconnectAttempts: this.reconnectAttempts }
    });
    diagnosticStore.log({
      level: 'INFO',
      category: 'WEBSOCKET',
      event: 'WEBSOCKET_CONNECTING',
      sessionGeneration: generation,
      conversationId: this.conversationId,
      socketId,
      details: { socketId, reconnectAttempts: this.reconnectAttempts }
    });
    diagnosticStore.updateHealth({ websocket: 'CONNECTING', sessionGeneration: generation, conversationId: this.conversationId });

    let wsUrl: string;
    if (this.useGateway) {
      const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = typeof window !== 'undefined' && window.location.host ? window.location.host : 'localhost:3000';
      wsUrl = `${protocol}//${host}/api/voice/live-stream?model=${encodeURIComponent(this.model)}`;
    } else if (this.apiKey) {
      wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;
    } else {
      const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = typeof window !== 'undefined' && window.location.host ? window.location.host : 'localhost:3000';
      wsUrl = `${protocol}//${host}/api/voice/live-stream?model=${encodeURIComponent(this.model)}`;
    }
    const ws = new WebSocket(wsUrl);
    this.ws = ws;
    GeminiLiveClient.activeGeminiSocketsCount++;
    diagnosticStore.updateHealth({ activeSocketCount: GeminiLiveClient.activeGeminiSocketsCount });

    diagnosticStore.log({
      level: 'INFO',
      category: 'WEBSOCKET',
      event: 'SOCKET_CREATED',
      sessionGeneration: generation,
      conversationId: this.conversationId,
      socketId,
      details: { socketId, generation, readyState: ws.readyState, activeSockets: GeminiLiveClient.activeGeminiSocketsCount }
    });

    ws.onopen = () => {
      // Guard: Stale generation or aborted session
      if (this._aborted || this.connectionGeneration !== generation || this.ws !== ws) {
        try { ws.close(); } catch {}
        return;
      }

      this.recordProtocolEvent('WS_OPENED', { generation, socketId });
      diagnosticStore.log({
        level: 'INFO',
        category: 'WEBSOCKET',
        event: 'WEBSOCKET_CONNECTED',
        sessionGeneration: generation,
        conversationId: this.conversationId,
        socketId,
        details: { socketId, generation, readyState: ws.readyState }
      });
      diagnosticStore.log({
        level: 'INFO',
        category: 'WEBSOCKET',
        event: 'WEBSOCKET_OPEN',
        sessionGeneration: generation,
        conversationId: this.conversationId,
        socketId,
        details: { socketId }
      });
      diagnosticStore.log({
        level: 'INFO',
        category: 'GEMINI',
        event: 'GEMINI_SESSION_CREATED',
        sessionGeneration: generation,
        conversationId: this.conversationId,
        socketId,
        details: { model: this.model, voice: this.voiceName }
      });
      diagnosticStore.updateHealth({ websocket: 'CONNECTED', gemini: 'READY' });
      console.log(`[GeminiLive] WebSocket connected (gen=${generation}, socketId=${socketId}). Sending setup handshake...`);

      // Compile pre-existing customer memory
      const knownFacts: string[] = [];
      const p = this.buyerState.profile;
      if (p.name) knownFacts.push(`- Customer Name: ${p.name}`);
      if (p.targetVehicle) knownFacts.push(`- Target Vehicle Model: ${p.targetVehicle}`);
      else if (p.vehicleType) knownFacts.push(`- Target Vehicle Category: ${p.vehicleType}`);
      if (p.monthlyBudget) knownFacts.push(`- Comfortable Monthly Budget: $${p.monthlyBudget}/month`);
      if (p.creditSituation) knownFacts.push(`- Credit Situation: ${p.creditSituation}`);
      if (p.monthlyIncome) knownFacts.push(`- Monthly Take-Home Income: $${p.monthlyIncome}/month`);
      if (p.downPayment !== undefined) knownFacts.push(`- Down Payment: $${p.downPayment}`);
      if (p.employment) knownFacts.push(`- Employment Status: ${p.employment}`);
      if (p.phone) knownFacts.push(`- Phone: ${p.phone}`);
      if (p.email) knownFacts.push(`- Email: ${p.email}`);

      const memoryContext = knownFacts.length > 0
        ? `\nPRE-EXISTING CUSTOMER DATA (INGESTED FROM ONLINE ACTIONS - DO NOT RE-ASK):\n${knownFacts.join('\n')}\n`
        : '';

      const setupMessage: any = {
        setup: {
          model: this.model,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: this.voiceName
                }
              }
            },
            thinkingConfig: {
              thinkingBudget: 0
            }
          },
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: true
            }
          },
          systemInstruction: {
            parts: [
              {
                text: this.systemPrompt || 'You are an expert AI peptide information and clinical evidence assistant.'
              }
            ]
          }
        }
      };

      if (this.enableTools) {
        if (this.agentType === 'PEPTIDE_SPECIALIST') {
          setupMessage.setup.tools = [
            {
              functionDeclarations: [
                {
                  name: 'record_evidence_classification',
                  description: 'Record the evidence classification level for the peptide claim being discussed.',
                  parameters: {
                    type: 'OBJECT',
                    properties: {
                      peptideName: { type: 'STRING', description: 'Name of the peptide (e.g. BPC-157, Tirzepatide)' },
                      claimTopic: { type: 'STRING', description: 'Topic or benefit claim being discussed' },
                      evidenceLevel: { type: 'STRING', description: 'LEVEL_A, LEVEL_B, LEVEL_C, LEVEL_D, or LEVEL_E' },
                      evidenceSummary: { type: 'STRING', description: 'Brief summary of what the scientific evidence demonstrates' }
                    }
                  }
                },
                {
                  name: 'flag_safety_escalation',
                  description: 'Trigger an urgent medical safety escalation when user reports emergent symptoms.',
                  parameters: {
                    type: 'OBJECT',
                    properties: {
                      symptomType: { type: 'STRING', description: 'Identified emergent symptom' },
                      severity: { type: 'STRING', description: 'URGENT or EMERGENT' },
                      recommendation: { type: 'STRING', description: 'Safety guidance delivered to the user' }
                    }
                  }
                }
              ]
            }
          ];
        } else {
          // Legacy automotive tools ONLY for automotive agent
          setupMessage.setup.tools = [
            {
              functionDeclarations: [
                {
                  name: 'update_buyer_intelligence',
                  description: 'Extract and update conversational facts.',
                  parameters: {
                    type: 'OBJECT',
                    properties: {
                      name: { type: 'STRING', description: 'User name' }
                    }
                  }
                }
              ]
            }
          ];
        }
      }

      const activeToolNames = this.enableTools
        ? (this.agentType === 'PEPTIDE_SPECIALIST'
            ? ['record_evidence_classification', 'flag_safety_escalation']
            : ['update_buyer_intelligence'])
        : [];

      this.lastSetupConfigHash = this.computeSetupConfigHash(setupMessage);
      console.log('[GeminiLive] Setup configuration audit:', {
        agentType: this.agentType,
        model: setupMessage.setup.model,
        responseModalities: setupMessage.setup.generationConfig?.responseModalities,
        hasSystemInstruction: Boolean(setupMessage.setup.systemInstruction),
        hasTools: Boolean(this.enableTools),
        toolNames: activeToolNames,
        hasSpeechConfig: Boolean(setupMessage.setup.generationConfig?.speechConfig),
        hasGenerationConfig: Boolean(setupMessage.setup.generationConfig),
        setupConfigHash: this.lastSetupConfigHash
      });

      this.sendOutbound('setup', setupMessage, this.model);
      this.setState('CONNECTED');
      this.startLevelMonitoring();

      // Ingest initial profile only if automotive
      if (this.agentType === 'AUTOMOTIVE') {
        this.callbacks.onBuyerIntelligenceUpdated?.(this.buyerState);
        this.queueBackendSync(this.buyerState.profile);
      }
    };

    ws.onmessage = async (event: MessageEvent) => {
      if (this._aborted || this.connectionGeneration !== generation || this.ws !== ws) {
        return;
      }
      try {
        const rawData = typeof event.data === 'string' ? event.data : await event.data.text();
        const response = JSON.parse(rawData);

        diagnosticStore.log({
          level: 'DEBUG',
          category: 'GEMINI',
          event: 'GEMINI_MESSAGE_RECEIVED',
          sessionGeneration: generation,
          conversationId: this.conversationId,
          socketId,
          details: {
            hasSetupComplete: Boolean(response.setupComplete),
            hasServerContent: Boolean(response.serverContent),
            hasToolCall: Boolean(response.toolCall),
            length: rawData.length
          }
        });

        this.recordProtocolEvent('MESSAGE_RECV', {
          hasSetupComplete: Boolean(response.setupComplete),
          hasServerContent: Boolean(response.serverContent),
          hasToolCall: Boolean(response.toolCall)
        });
        this.handleServerMessage(response, this.connectionGeneration);
      } catch (err: any) {
        console.error('[GeminiLive] Message parsing error:', err);
      }
    };

    ws.onerror = (err) => {
      if (this._aborted || this.connectionGeneration !== generation || this.ws !== ws) {
        return;
      }
      console.error('[GeminiLive] WebSocket error on gen', generation, err);
      this.recordProtocolEvent('WS_ERROR', { error: String(err) });
      if (this.state !== 'RECONNECTING' && this.state !== 'PROTOCOL_ERROR') {
        this.setState('ERROR');
        this.callbacks.onError('Live voice connection interrupted.');
      }
    };

    ws.onclose = (event) => {
      if (this.ws === ws) {
        this.ws = null;
        this.activeSocketId = null;
        GeminiLiveClient.activeGeminiSocketsCount = Math.max(0, GeminiLiveClient.activeGeminiSocketsCount - 1);
        diagnosticStore.updateHealth({ activeSocketCount: GeminiLiveClient.activeGeminiSocketsCount });
      }

      if (this._aborted || this.connectionGeneration !== generation) {
        return;
      }

      const classification = classifyCloseCode(event.code);
      this.recordProtocolEvent('WS_CLOSED', {
        code: event.code,
        reason: event.reason,
        classification,
        generation
      });

      console.log(`[GeminiLive] WebSocket closed: code=${event.code} (${classification}), reason=${event.reason || 'none'}`);
 
      // If gateway connection failed with 1006 (e.g. Vercel serverless environment drops WebSocket upgrades)
      // and we have an apiKey, fall back immediately to direct Gemini Live connection
      if (this.useGateway && this.apiKey && (event.code === 1006 || event.code === 1011)) {
        console.warn('[GeminiLive] Gateway WebSocket failed (Vercel/serverless environment), falling back to direct Gemini Live connection...');
        this.useGateway = false;
        this.openWebSocket();
        return;
      }

      // ── RULE 1: 1007 / PROTOCOL_ERROR MUST NEVER AUTO-RECONNECT ──────────────
      if (classification === 'PROTOCOL_ERROR') {
        this.clearReconnectTimer();
        this.clearTurnWatchdog();
        this.cleanupInputAudio();
        this.abortActiveAudioPlayback();

        const lastOutbound = this.outboundRingBuffer.slice(-1)[0] || null;
        diagnosticStore.log({
          level: 'ERROR',
          category: 'GEMINI',
          event: 'GEMINI_1007_INVALID_ARGUMENT',
          sessionGeneration: generation,
          conversationId: this.conversationId,
          socketId,
          details: {
            closeCode: event.code,
            closeReason: event.reason,
            lastOutboundMessage: lastOutbound ? {
              type: lastOutbound.type,
              subtype: lastOutbound.subtype,
              byteSize: lastOutbound.byteSize,
              direction: lastOutbound.direction
            } : null
          }
        });

        // 1007 Forensic Dump
        console.error('[GEMINI_PROTOCOL_ERROR]', {
          conversationId: this.conversationId,
          leadId: this.leadId,
          connectionGeneration: generation,
          socketId,
          model: this.model,
          setupConfigHash: this.lastSetupConfigHash,
          closeCode: event.code,
          closeReason: event.reason,
          last20Outbound: this.outboundRingBuffer.map(m => `#${m.seq} ${m.type}${m.subtype ? ` (${m.subtype})` : ''} gen=${m.generation}`),
          recentEvents: this.protocolEventsRingBuffer.slice(-20),
          clientState: this.state,
          hasSentInitialGreeting: this.greetingSentForConversation.has(this.conversationId)
        });

        this.setState('PROTOCOL_ERROR');
        this.callbacks.onError('Voice connection needs to be restarted.');
        return;
      }

      if (classification === 'NORMAL') {
        this.clearReconnectTimer();
        this.clearTurnWatchdog();
        this.setState('DISCONNECTED');
        return;
      }

      // Transient Network or Server Error: Bounded Reconnect (max 3 attempts)
      if (this.state !== 'DISCONNECTED' && this.state !== 'PROTOCOL_ERROR') {
        if (this.reconnectAttempts < 3) {
          this.reconnectAttempts++;
          const baseDelay = [1500, 3000, 6000][this.reconnectAttempts - 1] || 6000;
          const jitter = Math.floor(Math.random() * 200);
          const delay = baseDelay + jitter;

          console.log(`[GeminiLive] Transient disconnect detected. Reconnect attempt ${this.reconnectAttempts}/3 in ${delay}ms...`);
          this.setState('RECONNECTING');

          this.clearReconnectTimer();
          this.reconnectTimer = setTimeout(() => {
            if (!this._aborted && (this.state === 'RECONNECTING' || this.state === 'ERROR')) {
              this.openWebSocket();
            }
          }, delay);
        } else {
          console.error('[GeminiLive] Maximum reconnect attempts (3) exceeded.');
          this.clearReconnectTimer();
          this.clearTurnWatchdog();
          this.setState('ERROR');
          this.callbacks.onError('Unable to restore connection. Please reconnect.');
        }
      }
    };
  }

  /**
   * Attempts microphone stream capture and initializes 16kHz PCM downsampler.
   * Runs with a bounded timeout so it never hangs indefinitely.
   */
  private async attemptMicrophoneSetup(timeoutMs = 5000): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    if (!navigator?.mediaDevices?.getUserMedia) {
      this.setMicStatus('unavailable');
      this.isMuted = true;
      return false;
    }

    // Clean up any existing input stream before opening new one
    this.cleanupInputAudio();

    this.setMicStatus('requesting');
    diagnosticStore.log({
      level: 'INFO',
      category: 'AUDIO_INPUT',
      event: 'MICROPHONE_SETUP_START',
      sessionGeneration: this.connectionGeneration,
      conversationId: this.conversationId,
      socketId: this.activeSocketId || '',
      details: { timeoutMs }
    });

    let timedOut = false;
    let timeoutId: any;

    const capturePromise = navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    }).then((stream) => {
      if (timedOut || this._aborted) {
        try { stream.getTracks().forEach(t => t.stop()); } catch {}
        throw new Error('Microphone permission granted after timeout or abort');
      }
      return stream;
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        reject(new Error('Microphone permission request timed out'));
      }, timeoutMs);
    });

    try {
      const stream = await Promise.race([capturePromise, timeoutPromise]);
      clearTimeout(timeoutId);
      this.inputMediaStream = stream;

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        if (GeminiLiveClient.sharedAudioContext && GeminiLiveClient.sharedAudioContext.state !== 'closed') {
          this.inputAudioContext = GeminiLiveClient.sharedAudioContext;
        } else {
          this.inputAudioContext = new AudioContextClass();
        }
        if (this.inputAudioContext.state === 'suspended') {
          await this.inputAudioContext.resume().catch(() => {});
        }

        this.inputSourceNode = this.inputAudioContext.createMediaStreamSource(stream);
        this.inputAnalyser = this.inputAudioContext.createAnalyser();
        this.inputAnalyser.fftSize = 256;
        this.inputSourceNode.connect(this.inputAnalyser);

        // Buffer size 2048 gives ~45ms chunk intervals at 44.1k/48k
        this.inputProcessor = this.inputAudioContext.createScriptProcessor(2048, 1, 1);
        this.inputAnalyser.connect(this.inputProcessor);
        this.inputProcessor.connect(this.inputAudioContext.destination);

        const inputSampleRate = this.inputAudioContext.sampleRate;
        const currentGen = this.connectionGeneration;

        this.inputProcessor.onaudioprocess = (e) => {
          if (e.outputBuffer) {
            for (let ch = 0; ch < e.outputBuffer.numberOfChannels; ch++) {
              e.outputBuffer.getChannelData(ch).fill(0);
            }
          }
          if (this.isMuted || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
          // Audio streams continuously without blocking on tool responses to prevent syllable loss.

          if (this.ws.bufferedAmount > 65536) {
            return;
          }

          const inputChannelData = e.inputBuffer.getChannelData(0);

          let sum = 0;
          for (let i = 0; i < inputChannelData.length; i++) {
            sum += inputChannelData[i] * inputChannelData[i];
          }
          const rms = Math.sqrt(sum / inputChannelData.length);

          const nowAudioTime = this.outputAudioContext ? this.outputAudioContext.currentTime : 0;
          const isAudioHardwarePlaying = this.outputAudioContext ? (nowAudioTime < this.nextPlaybackTime) : false;
          const isJarvisSpeaking =
            this.state === 'SPEAKING' ||
            this.activePlayback !== null ||
            this.activeAudioSources.length > 0 ||
            this.audioQueue.length > 0 ||
            isAudioHardwarePlaying;

          const nowWallClock = Date.now();
          const msSinceJarvisPlayback = nowWallClock - this.lastJarvisPlaybackEndTime;
          const msSinceNaturalCompletion = this.lastNaturalPlaybackEndTime > 0 ? (nowWallClock - this.lastNaturalPlaybackEndTime) : 999999;

          // Section 13 & 14: Acoustic self-echo elimination & intentional barge-in gating
          if (isJarvisSpeaking) {
            this.silenceHangoverFrames = 0;
            // During Jessica playback, speaker output into microphone is strictly suppressed to prevent acoustic feedback loop.
            // Conversational speech directly into mic requires sustained energy (rms > 0.075 for >= 3 frames, ~130ms)
            // to trigger client-side barge-in, preventing speaker audio leakage from aborting playback.
            if (rms > 0.075) {
              this.consecutiveBargeInFrames++;
              if (this.consecutiveBargeInFrames >= 3) {
                this.consecutiveBargeInFrames = 0;
                this.abortActiveAudioPlayback();
                this.setState('LISTENING');
                return; // Cease playback cleanly and do not transmit candidate barge-in frame upon cancellation
              } else {
                return; // Accumulating barge-in confidence; do not send candidate frame yet
              }
            } else {
              this.consecutiveBargeInFrames = 0;
              return; // Suppress speaker feedback from triggering self-echo or accidental aborts
            }
          } else {
            this.consecutiveBargeInFrames = 0;
          }

          // Section 15: Acoustic Room Reverberation & Speaker Ring-down Tail Protection
          // Stage 1 (0ms - 450ms): Immediate tail suppression upon natural speech completion.
          // Hardware DAC buffering (100-200ms) + room acoustic reverberation (RT60: 250-400ms)
          // means the mic hears Jessica's voice for up to 450ms after Web Audio marks playback ended.
          // In natural human dialogue, no customer starts speaking within 450ms of assistant's last syllable.
          // Strictly suppress all audio input during this window to eliminate acoustic feedback.
          if (msSinceNaturalCompletion < 450) {
            return;
          }

          // Stage 2 (450ms - 850ms): Decaying reverberation protection.
          // Lingering reflections in resonant or bare rooms require strong intentional speech signal.
          if (msSinceNaturalCompletion < 850 && rms < Math.max(0.024, this.noiseFloor * 2.8)) {
            return;
          }

          // Adaptive Noise Floor Tracking & Dynamic Speech Threshold:
          // Continuously track background ambient noise floor (fans, hiss, room acoustics)
          this.noiseFloor = this.noiseFloor * 0.995 + rms * 0.005;
          const dynamicThreshold = Math.max(0.010, this.noiseFloor * 2.2);

          // Explicit Client Activity Control:
          // Emits activityStart at onset of user speech and activityEnd when silence hangover expires.
          // Bypasses server VAD timeouts, reducing turn response latency to ~1.0 second.
          if (rms >= dynamicThreshold) {
            if (!this.hasActiveSpeechTurn) {
              this.hasActiveSpeechTurn = true;
              this.restartSpeechRecognitionIfNeeded();
              try {
                this.sendOutbound(
                  'realtimeInput.activityStart',
                  {
                    realtimeInput: {
                      activityStart: {}
                    }
                  },
                  'activity_start'
                );
                diagnosticStore.log({
                  level: 'INFO',
                  category: 'AUDIO_INPUT',
                  event: 'USER_ACTIVITY_START_SENT',
                  sessionGeneration: this.connectionGeneration,
                  conversationId: this.conversationId,
                  socketId: this.activeSocketId || ''
                });
              } catch {}
            }
            this.silenceHangoverFrames = this.defaultSilenceHangoverFrames;
          } else if (this.silenceHangoverFrames > 0) {
            this.silenceHangoverFrames--;
          } else {
            if (this.hasActiveSpeechTurn) {
              this.hasActiveSpeechTurn = false;
              try {
                this.sendOutbound(
                  'realtimeInput.activityEnd',
                  {
                    realtimeInput: {
                      activityEnd: {}
                    }
                  },
                  'activity_end'
                );
                diagnosticStore.log({
                  level: 'INFO',
                  category: 'AUDIO_INPUT',
                  event: 'USER_ACTIVITY_END_SENT',
                  sessionGeneration: this.connectionGeneration,
                  conversationId: this.conversationId,
                  socketId: this.activeSocketId || '',
                  details: { trigger: 'silence_hangover_elapsed' }
                });
              } catch {}
            }
            return; // Deep silence; halt transmission after activityEnd
          }

          const pcm16 = this.downsampleTo16k(inputChannelData, inputSampleRate, false);
          if (!pcm16 || pcm16.length === 0) return;

          // Audio Protocol Gate: PCM16, 16kHz, mono, little-endian, non-zero, even bytes
          if (pcm16.byteLength === 0 || pcm16.byteLength % 2 !== 0) return;

          const base64Audio = this.int16ToBase64(pcm16);
          const realtimeInputMessage = {
            realtimeInput: {
              audio: {
                mimeType: 'audio/pcm;rate=16000',
                data: base64Audio
              }
            }
          };

          try {
            this.sendOutbound('realtimeInput.audio', realtimeInputMessage, '16000Hz_PCM16', pcm16.byteLength);
            diagnosticStore.log({
              level: 'DEBUG',
              category: 'AUDIO_INPUT',
              event: 'USER_AUDIO_FRAME_SENT',
              sessionGeneration: this.connectionGeneration,
              conversationId: this.conversationId,
              socketId: this.activeSocketId || '',
              details: { chunkByteLength: pcm16.byteLength, rms }
            });
          } catch {}
        };
      }

      this.isMuted = false;
      this.setMicStatus('available');
      diagnosticStore.updateHealth({ microphone: 'ACTIVE' });
      diagnosticStore.log({
        level: 'INFO',
        category: 'AUDIO_INPUT',
        event: 'MICROPHONE_SETUP_SUCCESS',
        sessionGeneration: this.connectionGeneration,
        conversationId: this.conversationId,
        socketId: this.activeSocketId || '',
        details: { sampleRate: this.inputAudioContext?.sampleRate }
      });
      diagnosticStore.log({
        level: 'INFO',
        category: 'AUDIO_INPUT',
        event: 'USER_AUDIO_CAPTURE_STARTED',
        sessionGeneration: this.connectionGeneration,
        conversationId: this.conversationId,
        socketId: this.activeSocketId || '',
        details: { sampleRate: this.inputAudioContext?.sampleRate }
      });

      // Start local speech recognition for HUD subtitles & CRM extraction ONLY (isolated)
      this.startBrowserSpeechRecognition();
      return true;

    } catch (err: any) {
      diagnosticStore.log({
        level: 'ERROR',
        category: 'AUDIO_INPUT',
        event: 'MICROPHONE_SETUP_FAILED',
        sessionGeneration: this.connectionGeneration,
        conversationId: this.conversationId,
        socketId: this.activeSocketId || '',
        details: { error: err?.message || String(err) }
      });
      const isDenied = err?.name === 'NotAllowedError' ||
                       err?.name === 'PermissionDeniedError' ||
                       err?.message?.toLowerCase().includes('permission') ||
                       err?.message?.toLowerCase().includes('denied');
      this.setMicStatus(isDenied ? 'denied' : 'unavailable');
      this.isMuted = true;
      throw err;
    }
  }

  /**
   * Explicitly enables microphone capture from a user gesture.
   * Safe to call repeatedly, does not recreate live session, bounded timeout.
   */
  public async enableMicrophone(): Promise<boolean> {
    if (this.micStatus === 'available' && this.inputMediaStream?.active) {
      if (this.inputAudioContext && this.inputAudioContext.state === 'suspended') {
        await this.inputAudioContext.resume().catch(() => {});
      }
      this.isMuted = false;
      this.setMicStatus('available');
      if (this.pendingGreetingOnUnlock && !this.greetingSentForConversation.has(this.conversationId) && !this.hasSentInitialGreeting) {
        this.pendingGreetingOnUnlock = false;
        this.triggerInitialGreeting();
      }
      return true;
    }

    if (this._aborted) return false;

    // Guaranteed user gesture context: unlock AudioContext, acquire wake lock, and start mic
    await GeminiLiveClient.unlockAudioContext();
    WakeLockManager.getInstance().request().catch(() => {});

    try {
      await this.attemptMicrophoneSetup(8000);
      if (this.pendingGreetingOnUnlock && !this.greetingSentForConversation.has(this.conversationId) && !this.hasSentInitialGreeting) {
        this.pendingGreetingOnUnlock = false;
        this.triggerInitialGreeting();
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Safely disposes microphone input stream, nodes, and speech recognition.
   */
  private cleanupInputAudio(): void {
    diagnosticStore.log({
      level: 'DEBUG',
      category: 'AUDIO_INPUT',
      event: 'MIC_STOPPED',
      sessionGeneration: this.connectionGeneration,
      conversationId: this.conversationId
    });
    diagnosticStore.updateHealth({ microphone: 'INACTIVE' });
    if (this.speechRecognition) {
      try {
        this.speechRecognition.onend = null;
        this.speechRecognition.onerror = null;
        this.speechRecognition.stop();
      } catch {}
      this.speechRecognition = null;
    }
    if (this.inputProcessor) {
      try { this.inputProcessor.disconnect(); } catch {}
      this.inputProcessor = null;
    }
    if (this.inputSourceNode) {
      try { this.inputSourceNode.disconnect(); } catch {}
      this.inputSourceNode = null;
    }
    if (this.inputMediaStream) {
      try { this.inputMediaStream.getTracks().forEach(t => t.stop()); } catch {}
      this.inputMediaStream = null;
    }
    if (this.inputAudioContext && this.inputAudioContext.state !== 'closed') {
      if (this.inputAudioContext !== GeminiLiveClient.sharedAudioContext) {
        try { this.inputAudioContext.close(); } catch {}
      }
      this.inputAudioContext = null;
    }
  }

  /**
   * Initializes local browser speech recognition for real-time user HUD transcripts
   * and fallback buyer intelligence extraction ONLY.
   * Crucial: Errors in SpeechRecognition NEVER terminate or reconnect Gemini Live WebSocket!
   */
  private startBrowserSpeechRecognition(): void {
    if (typeof window === 'undefined') return;
    const isTest = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';
    if (!this.enableSpeechRecognition && !isTest) {
      // In production browsers, Gemini Live natively streams 16kHz PCM audio directly over WebSocket.
      // Running browser SpeechRecognition triggers an OS/browser microphone notification chime (beep)
      // every 10 seconds when the recognition session times out and restarts.
      return;
    }

    const SpeechRecClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecClass) return;

    try {
      if (this.speechRecognition) {
        try { this.speechRecognition.stop(); } catch {}
      }

      const rec = new SpeechRecClass();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';
      rec.maxAlternatives = 1;

      rec.onresult = (event: any) => {
        // Conversational barge-in: If user speaks while Jarvis is talking, immediately halt Jarvis
        if (this.state === 'SPEAKING' || this.activeAudioSources.length > 0) {
          this.abortActiveAudioPlayback();
          this.setState('LISTENING');
        }

        let interimText = '';
        let finalText = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          if (res.isFinal) {
            finalText += res[0].transcript + ' ';
          } else {
            interimText += res[0].transcript;
          }
        }

        const cleanFinal = finalText.trim();
        const cleanInterim = interimText.trim();
        const activeText = cleanFinal || cleanInterim;

        if (activeText) {
          this.callbacks.onTranscript({
            sender: 'user',
            text: activeText,
            isFinal: Boolean(cleanFinal)
          });
        }

        if (cleanFinal) {
          // Ingest into deterministic CRM fallback parser
          this.ingestUserTranscript(cleanFinal);
        }
      };

      rec.onerror = (event: any) => {
        // RULE 23: SpeechRecognition error must NEVER terminate Gemini WebSocket
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        console.warn('[GeminiLive] SpeechRecognition event error (isolated from Live WebSocket):', event.error);
      };

      rec.onend = () => {
        // SILENCED: Do NOT auto-restart SpeechRecognition on timeout.
        // Auto-restarting on onend causes Chrome/Edge to emit a loud periodic system beep every 10 seconds.
        this.speechRecognitionActive = false;
      };

      rec.start();
      this.speechRecognitionActive = true;
      this.speechRecognition = rec;
    } catch (e) {
      console.warn('[GeminiLive] SpeechRecognition initialization error (isolated):', e);
    }
  }

  /**
   * Proactively restarts browser SpeechRecognition when user activity resumes (H1).
   * Prevents Chrome's periodic 10s idle chime while ensuring transcripts never die mid-session.
   */
  private restartSpeechRecognitionIfNeeded(): void {
    if (this._aborted || this.isMuted) return;
    if (!this.enableSpeechRecognition && !(typeof process !== 'undefined' && process.env?.NODE_ENV === 'test')) return;
    if (this.speechRecognition && !this.speechRecognitionActive) {
      try {
        this.speechRecognition.start();
        this.speechRecognitionActive = true;
      } catch (err) {
        // Recognition may already be starting or transitioning
      }
    }
  }

  /**
   * Initializes 24kHz Web Audio output context
   */
  private setupOutputAudio(): void {
    if (typeof window === 'undefined') return;

    let engineCtx: AudioContext | null = null;
    try {
      engineCtx = WebAudioEngine.getInstance().getAudioContext();
    } catch {}

    if (engineCtx && engineCtx.state !== 'closed') {
      this.outputAudioContext = engineCtx;
      GeminiLiveClient.sharedAudioContext = engineCtx;
    } else if (GeminiLiveClient.sharedAudioContext && GeminiLiveClient.sharedAudioContext.state !== 'closed') {
      this.outputAudioContext = GeminiLiveClient.sharedAudioContext;
    } else {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.outputAudioContext = new AudioContextClass();
      GeminiLiveClient.sharedAudioContext = this.outputAudioContext;
    }

    if (this.outputAudioContext.state === 'suspended') {
      this.outputAudioContext.resume().catch(() => {});
    }

    // Autoplay resumption: if context was suspended and later transitions to running via user gesture, resume playback immediately
    this.outputAudioContext.onstatechange = () => {
      if (this.outputAudioContext?.state === 'running') {
        this.nextPlaybackTime = this.outputAudioContext.currentTime;
        this.processNextQueueItem();
      }
    };

    this.outputAnalyser = this.outputAudioContext.createAnalyser();
    this.outputAnalyser.fftSize = 256;

    // Route through WebAudioEngine's neural acoustic mastering chain if initialized on the same context
    try {
      const outputGainNode = WebAudioEngine.getInstance().getOutputGainNode();
      if (outputGainNode && outputGainNode.context === this.outputAudioContext) {
        this.outputAnalyser.connect(outputGainNode);
      } else {
        this.outputAnalyser.connect(this.outputAudioContext.destination);
      }
    } catch {
      this.outputAnalyser.connect(this.outputAudioContext.destination);
    }
    this.nextPlaybackTime = this.outputAudioContext.currentTime;

    if (this.playbackWatchdogInterval) {
      clearInterval(this.playbackWatchdogInterval);
    }
    this.playbackWatchdogInterval = setInterval(() => {
      if (this.state === 'SPEAKING' && this.outputAudioContext) {
        const now = this.outputAudioContext.currentTime;
        if (this.audioQueue.length === 0 && now > this.nextPlaybackTime + 0.35) {
          for (const s of this.activeAudioSources) {
            try { s.stop(); s.disconnect(); } catch {}
          }
          this.activeAudioSources = [];
          this.activePlayback = null;
          this.playbackConsumerRunning = false;
          this.nextPlaybackTime = now;
          this.setState('LISTENING');
          this.callbacks.onJarvisAudioLevel(0);
        } else if (this.audioQueue.length > 0 && now > this.nextPlaybackTime + 1.0) {
          // Playback queue stall recovery (H8): Queue has pending chunks but consumer or timeline stalled
          this.nextPlaybackTime = now;
          this.playbackConsumerRunning = false;
          this.ensurePlaybackConsumer();
        }
      }
    }, 250);
  }

  /**
   * Proactively triggers Jarvis's greeting turn.
   * Strictly idempotent per logical conversationId and generation-protected.
   */
  public triggerInitialGreeting(): void {
    if (this.conversationId && GeminiLiveClient.globalGreetingSentSessions.has(this.conversationId)) return;
    if (this.greetingSentForConversation.has(this.conversationId)) return;

    // PEPTIDE SPECIALIST VERTICAL ISOLATION
    if (this.agentType === 'PEPTIDE_SPECIALIST') {
      if (typeof sessionStorage !== 'undefined' && this.conversationId) {
        try {
          if (sessionStorage.getItem(`peptide_greeted_${this.conversationId}`) === '1') {
            return;
          }
        } catch {}
      }
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      if (this.conversationId) {
        GeminiLiveClient.globalGreetingSentSessions.add(this.conversationId);
      }
      this.greetingSentForConversation.add(this.conversationId);
      this.hasSentInitialGreeting = true;
      if (typeof sessionStorage !== 'undefined' && this.conversationId) {
        try {
          sessionStorage.setItem(`peptide_greeted_${this.conversationId}`, '1');
        } catch {}
      }

      const peptideGreeting = "Introduce yourself: 'Alright. I'm your peptide information specialist. If you're researching peptides for bodybuilding, recovery, physique or performance, I can help you separate the claims from the evidence. What are you looking into?' Speak with controlled intensity in a deep, masculine, confident, slightly gritty voice like an experienced 1980s Golden Era bodybuilding coach talking to a serious lifter between sets.";
      const initialTrigger = {
        clientContent: {
          turns: [
            {
              role: 'user',
              parts: [{ text: peptideGreeting }]
            }
          ],
          turnComplete: true
        }
      };

      try {
        diagnosticStore.log({
          level: 'INFO',
          category: 'GEMINI',
          event: 'GEMINI_RESPONSE_STARTED',
          sessionGeneration: this.connectionGeneration,
          conversationId: this.conversationId,
          details: { promptType: 'peptide_specialist_greeting' }
        });
        this.sendOutbound('clientContent', initialTrigger, 'initial_greeting');
        this.setState('THINKING');
      } catch (err: any) {
        console.warn('[GeminiLive] Failed to send peptide greeting trigger:', err);
      }
      return;
    }

    // LEGACY AUTOMOTIVE GREETING (Only executed if agentType === 'AUTOMOTIVE')
    if (typeof sessionStorage !== 'undefined') {
      try {
        if (this.conversationId && sessionStorage.getItem(`yna_greeted_${this.conversationId}`) === '1') {
          return;
        }
      } catch {}
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    if (this.conversationId) {
      GeminiLiveClient.globalGreetingSentSessions.add(this.conversationId);
      if (GeminiLiveClient.globalGreetingSentSessions.size > GeminiLiveClient.MAX_GLOBAL_GREETING_IDS) {
        const iter = GeminiLiveClient.globalGreetingSentSessions.values();
        const oldest = iter.next().value;
        if (oldest) GeminiLiveClient.globalGreetingSentSessions.delete(oldest);
      }
    }
    this.greetingSentForConversation.add(this.conversationId);
    this.hasSentInitialGreeting = true;
    if (typeof sessionStorage !== 'undefined') {
      try {
        if (this.conversationId) sessionStorage.setItem(`yna_greeted_${this.conversationId}`, '1');
      } catch {}
    }

    const p = this.buyerState.profile;
    const hasPriorName = Boolean(p.name && p.name.trim().length > 1 && p.name.toLowerCase() !== 'player');
    const hasPriorVehicle = Boolean(p.targetVehicle || p.vehicleType);

    let greetingPrompt: string;
    if (hasPriorName) {
      greetingPrompt = `Hello Jessica! Greet me warmly by my first name (${p.name.trim()}) as my personal automotive concierge at Your New Auto, and ask whether I'm looking for a car, van, SUV, or truck to get started!`;
    } else {
      greetingPrompt = `Hello Jessica! Introduce yourself warmly as my personal automotive concierge at Your New Auto. In this initial turn, ask only for my first name ("Who do I have the pleasure of speaking with today?") before you ask me what kind of vehicle I'm looking for! Do NOT ask for vehicle type, budget, or phone number yet—ask ONLY for my first name so we can personalize my file!`;
    }

    const initialTrigger = {
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [{ text: greetingPrompt }]
          }
        ],
        turnComplete: true
      }
    };

    try {
      diagnosticStore.log({
        level: 'INFO',
        category: 'GEMINI',
        event: 'GEMINI_RESPONSE_STARTED',
        sessionGeneration: this.connectionGeneration,
        conversationId: this.conversationId,
        details: { promptType: hasPriorVehicle ? 'acknowledged_vehicle' : 'ask_vehicle' }
      });
      this.sendOutbound('clientContent', initialTrigger, 'initial_greeting');
      this.setState('THINKING');
    } catch (err: any) {
      console.warn('[GeminiLive] Failed to send initial greeting trigger:', err);
      diagnosticStore.log({
        level: 'ERROR',
        category: 'GEMINI',
        event: 'GEMINI_ERROR',
        sessionGeneration: this.connectionGeneration,
        conversationId: this.conversationId,
        details: { error: err?.message || String(err) }
      });
    }
  }

  /**
   * Complete Server Event Processing: Systematically processes all content components
   * in each incoming server message without dropping sibling parts.
   */
  private handleServerMessage(response: any, generation: number): void {
    if (generation !== this.connectionGeneration) return;

    // 1. Initial Handshake confirmation — Jarvis initiates conversation proactively
    if (response.setupComplete) {
      console.log('[GeminiLive] Setup complete. Ready for live 1-to-1 conversation.');
      diagnosticStore.log({
        level: 'INFO',
        category: 'GEMINI',
        event: 'GEMINI_SETUP_COMPLETE',
        sessionGeneration: generation,
        conversationId: this.conversationId,
        socketId: this.activeSocketId || '',
        details: { generation }
      });
      this.reconnectAttempts = 0;
      this.setState('READY');
      this.setState('LISTENING');

      // Idempotent Concierge Initiation
      if (!this.greetingSentForConversation.has(this.conversationId) && !this.hasSentInitialGreeting) {
        if (GeminiLiveClient.isAudioContextRunning()) {
          setTimeout(() => {
            if (this.connectionGeneration === generation && !this.greetingSentForConversation.has(this.conversationId) && !this.hasSentInitialGreeting) {
              this.triggerInitialGreeting();
            }
          }, 120);
        } else {
          this.pendingGreetingOnUnlock = true;
        }
      }
      return;
    }

    // 2. Process Tool / Function Calls (update_buyer_intelligence)
    if (response.toolCall?.functionCalls && Array.isArray(response.toolCall.functionCalls) && response.toolCall.functionCalls.length > 0) {
      const toolCalls = response.toolCall.functionCalls;
      this.isAwaitingToolResponse = true;

      for (const call of toolCalls) {
        if (call.args && typeof call.args === 'object') {
          if (call.name === 'record_evidence_classification') {
            this.callbacks.onEvidenceClassification?.(call.args);
          } else if (call.name === 'flag_safety_escalation') {
            this.callbacks.onSafetyEscalation?.(call.args);
          } else if (this.agentType === 'AUTOMOTIVE' && call.name === 'update_buyer_intelligence') {
            if (call.args.phone) {
              this.buyerState.profile.phoneConfirmed = false;
              this.isPhoneConfirmed = false;
              this.isAwaitingPhoneConfirmation = true;
            }
            this.buyerState.profile = mergeBuyerProfile(this.buyerState.profile, call.args, 'FUNCTION_CALL');
          }
        }
      }
      if (this.agentType === 'AUTOMOTIVE') {
        this.buyerState.lastUpdated = Date.now();
        this.callbacks.onBuyerIntelligenceUpdated?.(this.buyerState);
        this.queueBackendSync(this.buyerState.profile);
      }

      // Exactly-once enforcement per function call ID
      const unhandledCalls = toolCalls.filter(call => {
        const callId = call.id || `call_${Date.now()}`;
        if (this.answeredFunctionCalls.has(callId)) {
          console.warn('[GeminiLive] Duplicate functionCall ignored for id:', callId);
          return false;
        }
        this.answeredFunctionCalls.add(callId);
        // Evict oldest entries when set exceeds cap to prevent memory leak
        if (this.answeredFunctionCalls.size > this.MAX_ANSWERED_FUNCTION_CALLS) {
          const iter = this.answeredFunctionCalls.values();
          for (let i = 0; i < 20; i++) {
            const oldest = iter.next().value;
            if (oldest) this.answeredFunctionCalls.delete(oldest);
          }
        }
        return true;
      });

      if (unhandledCalls.length === 0) {
        this.isAwaitingToolResponse = false;
        return;
      }

      // Send single batched toolResponse over WebSocket via Outbound Firewall
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const functionResponses = unhandledCalls.map(call => ({
          id: call.id || `call_${Date.now()}`,
          name: call.name || 'update_buyer_intelligence',
          response: {
            result: { status: 'recorded', success: true }
          }
        }));

        const toolResponseMsg = {
          toolResponse: {
            functionResponses
          }
        };

        try {
          this.sendOutbound('toolResponse', toolResponseMsg, 'batched_tool_response');
        } catch (err) {
          console.warn('[GeminiLive] Failed to send batched toolResponse:', err);
        } finally {
          this.isAwaitingToolResponse = false;
        }
      } else {
        this.isAwaitingToolResponse = false;
      }
    }

    // Process inline function calls in modelTurn parts for local buyer intel extraction ONLY (no un-ID'd wire response)
    if (response.serverContent?.modelTurn?.parts) {
      for (const part of response.serverContent.modelTurn.parts) {
        if (part.functionCall?.args && typeof part.functionCall.args === 'object') {
          if (part.functionCall.args.phone) {
            this.buyerState.profile.phoneConfirmed = false;
            this.isPhoneConfirmed = false;
            this.isAwaitingPhoneConfirmation = true;
          }
          this.buyerState.profile = mergeBuyerProfile(this.buyerState.profile, part.functionCall.args, 'FUNCTION_CALL');
          this.buyerState.lastUpdated = Date.now();
          this.callbacks.onBuyerIntelligenceUpdated?.(this.buyerState);
          this.queueBackendSync(this.buyerState.profile);
        }
      }
    }

    const serverContent = response.serverContent;
    if (!serverContent) return;

    // 3. Acoustic Barge-in / Interruption
    if (serverContent.interrupted) {
      console.log('[GeminiLive] Interruption detected. Aborting active playback immediately.');
      this.abortActiveAudioPlayback();
      this.setState('INTERRUPTED');
      setTimeout(() => {
        if (this.state === 'INTERRUPTED') this.setState('LISTENING');
      }, 100);
      return;
    }

    // 4. Audio & Text Chunks from Gemini (process sibling parts completely)
    if (serverContent.modelTurn && Array.isArray(serverContent.modelTurn.parts)) {
      for (const part of serverContent.modelTurn.parts) {
        // Live text transcript
        if (part.text) {
          const isThought = Boolean(
            (part as any).thought ||
            part.text.trim().startsWith('**') ||
            part.text.includes('**Extracting') ||
            part.text.includes('**Acknowledging') ||
            part.text.includes('**Gathering') ||
            part.text.includes('**Processing')
          );

          if (!isThought) {
            this.clearTurnWatchdog();

            // ZERO FALSE CONFIRMATION GUARD:
            // If the user's prior turn was an explicit rejection of phone confirmation,
            // the model is STRICTLY FORBIDDEN from saying "Perfect!", "Great!", "Awesome!".
            // If the model emits false confirmation on rejection, suppress and replace with apology prompt.
            if (this.wasLastUserTurnRejection) {
              const fullCandidate = (this.currentJarvisTranscript + part.text).trim();
              if (/^(?:perfect|great|awesome)\b/i.test(fullCandidate)) {
                console.warn('[GeminiLive] Suppressed unauthorized false confirmation after rejection:', fullCandidate);
                this.abortActiveAudioPlayback();
                this.currentJarvisTranscript = "Oh shoot, my apologies. What's the correct number?";
                this.callbacks.onTranscript({
                  sender: 'jarvis',
                  text: this.currentJarvisTranscript,
                  isFinal: false
                });
                return;
              }
            }

            this.currentJarvisTranscript += part.text;
            this.callbacks.onTranscript({
              sender: 'jarvis',
              text: this.currentJarvisTranscript,
              isFinal: false
            });
          }
        }

        // Live 24kHz Audio chunk
        if (part.inlineData && part.inlineData.data) {
          diagnosticStore.log({
            level: 'DEBUG',
            category: 'AUDIO_OUTPUT',
            event: 'GEMINI_AUDIO_FRAME_RECEIVED',
            sessionGeneration: generation,
            conversationId: this.conversationId,
            socketId: this.activeSocketId || '',
            details: { mimeType: part.inlineData.mimeType, dataLength: part.inlineData.data.length }
          });
          this.clearTurnWatchdog();
          if (!this.audioPlaybackSuppressed) {
            this.setState('SPEAKING');

            if (this.activePlayback === null && this.audioQueue.length === 0) {
              // First chunk of turn: start playback promptly for low initial latency
              if (this.streamingAudioBuffer) {
                const fullChunk = this.streamingAudioBuffer + part.inlineData.data;
                this.streamingAudioBuffer = '';
                this.playAudioChunk(fullChunk);
              } else if (part.inlineData.data.length >= 2560) {
                this.playAudioChunk(part.inlineData.data);
              } else {
                this.streamingAudioBuffer = part.inlineData.data;
              }
            } else {
              // Subsequent streaming chunks: accumulate into smooth ~70ms blocks (4480 chars)
              // to guarantee lookahead gapless scheduling without audio hardware starvation clicks/static
              this.streamingAudioBuffer += part.inlineData.data;
              if (this.streamingAudioBuffer.length >= 4480) {
                const chunk = this.streamingAudioBuffer;
                this.streamingAudioBuffer = '';
                this.playAudioChunk(chunk);
              }
            }
          }
        }
      }
    }

    // 5. Turn Complete
    if (serverContent.turnComplete) {
      if (this.streamingAudioBuffer && !this.audioPlaybackSuppressed) {
        const remaining = this.streamingAudioBuffer;
        this.streamingAudioBuffer = '';
        this.playAudioChunk(remaining);
      }
      if (this.currentJarvisTranscript) {
        this.callbacks.onTranscript({
          sender: 'jarvis',
          text: this.currentJarvisTranscript,
          isFinal: true
        });

        // Detect if Jessica just asked for phone confirmation or 7-digit area code
        const isConfirmationPrompt = /(?:did I get that (?:number )?right|have your cell as|have your number as|did I get it right|is that right|got that right)/i.test(this.currentJarvisTranscript);
        if (isConfirmationPrompt) {
          this.isAwaitingPhoneConfirmation = true;
          this.wasLastUserTurnRejection = false;
        }

        const isSevenDigitPrompt = /(?:got the (?:seven|7) digits|three-digit area code|what's your area code)/i.test(this.currentJarvisTranscript);
        if (isSevenDigitPrompt) {
          this.isAwaitingPhoneConfirmation = false;
        }

        this.currentJarvisTranscript = '';
      }

      // If there is no queued or active audio, transition to LISTENING immediately.
      // Otherwise, the audio queue drains naturally via sourceNode.onended -> finishItem().
      if (this.audioQueue.length === 0 && !this.activePlayback && (this.state === 'SPEAKING' || this.state === 'THINKING')) {
        this.setState('LISTENING');
        this.callbacks.onJarvisAudioLevel?.(0);
        this.lastJarvisPlaybackEndTime = Date.now();
        this.lastNaturalPlaybackEndTime = Date.now();
      }
    }
  }

  /**
   * Ingests transcript into the deterministic fallback extractor.
   * Enforces zero-false confirmation and correction handling for phone numbers.
   */
  public ingestUserTranscript(text: string): void {
    if (!text || text.trim().length === 0) return;
    const trimmed = text.trim();

    // Check for negative rejection / correction when awaiting phone confirmation
    if (this.isAwaitingPhoneConfirmation) {
      const isRejection = /^(?:no|nope|nah|no\s+no|that's\s+wrong|wrong|wait|hold\s+on|actually|you\s+got\s+that\s+wrong|not\s+right|incorrect|not\s+this\s+one)\b/i.test(trimmed) ||
                          /\b(?:that's\s+wrong|wrong\s+number|not\s+my\s+number|you\s+got\s+it\s+wrong|incorrect\s+number)\b/i.test(text);

      const newPhone = normalizePhone(text);

      if (isRejection) {
        this.wasLastUserTurnRejection = true;
        this.isPhoneConfirmed = false;

        if (newPhone) {
          // Customer supplied replacement digits (e.g. "No, it's 204-555-9999")
          this.buyerState.profile.phone = newPhone;
          this.buyerState.profile.phoneConfirmed = false;
          this.isAwaitingPhoneConfirmation = true; // Wait for confirmation of new digits
        } else {
          // Customer rejected without replacement digits (e.g. "No", "That's wrong", "Wait")
          this.isAwaitingPhoneConfirmation = false;
          delete this.buyerState.profile.phone;
          this.buyerState.profile.phoneConfirmed = false;
        }

        this.buyerState.lastUpdated = Date.now();
        this.callbacks.onBuyerIntelligenceUpdated?.(this.buyerState);
        this.queueBackendSync(this.buyerState.profile, text);
        return;
      }

      const isAffirmative = /^(?:yes|yep|yeah|yup|correct|that's\s+right|that's\s+it|right|sure|exact)\b/i.test(trimmed);
      if (isAffirmative) {
        this.isAwaitingPhoneConfirmation = false;
        this.isPhoneConfirmed = true;
        this.wasLastUserTurnRejection = false;
        this.buyerState.profile.phoneConfirmed = true;
        this.buyerState.lastUpdated = Date.now();
        this.callbacks.onBuyerIntelligenceUpdated?.(this.buyerState);
        this.queueBackendSync(this.buyerState.profile, text);
        return;
      }
    }

    const extracted = parseTranscriptForBuyerIntel(text, this.buyerState.profile);
    const discoveredKeys = Object.keys(extracted);

    if (discoveredKeys.length > 0) {
      console.log('[JARVIS_TRANSCRIPT_EXTRACTION]', {
        changedFields: discoveredKeys,
        extracted,
        conversationId: this.conversationId
      });

      if (extracted.phone) {
        this.buyerState.profile.phoneConfirmed = false;
        this.isPhoneConfirmed = false;
        this.isAwaitingPhoneConfirmation = true;
      }

      this.buyerState.profile = mergeBuyerProfile(this.buyerState.profile, extracted, 'TRANSCRIPT_FALLBACK');
      this.buyerState.lastUpdated = Date.now();
      this.callbacks.onBuyerIntelligenceUpdated?.(this.buyerState);

      this.queueBackendSync(this.buyerState.profile, text);
    }
  }

  /**
   * Sends a text message turn to Gemini Live.
   * Uses realtimeInput.text for Gemini 3.1 Live or properly-formed clientContent with turns for Gemini 2.5.
   */
  /**
   * Sends a text message turn to Gemini Live.
   * Immediately updates UI transcript, ingests CRM buyer intelligence,
   * sets state to THINKING, and sends turn via WebSocket Outbound Firewall if connected.
   */
  public sendTextMessage(text: string): void {
    if (!text || !text.trim()) return;
    const clean = text.trim();

    // 1. Immediately emit user transcript to UI
    this.callbacks.onTranscript({
      sender: 'user',
      text: clean,
      isFinal: true
    });

    // 2. Ingest into deterministic CRM extractor
    this.ingestUserTranscript(clean);

    // 3. Set state to THINKING
    this.setState('THINKING');
    this.resetTurnWatchdog();

    // 4. Send turn via Outbound Firewall if WebSocket is open (for native audio stream & test compliance)
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      if (this.model.includes('gemini-3') || this.model.includes('flash-live-preview')) {
        this.sendOutbound('realtimeInput.text', { realtimeInput: { text: clean } }, 'user_text');
      } else {
        const clientTurnMessage = {
          clientContent: {
            turns: [
              {
                role: 'user',
                parts: [{ text: clean }]
              }
            ],
            turnComplete: true
          }
        };
        this.sendOutbound('clientContent', clientTurnMessage, 'user_text_turn');
      }
    }
  }

  /**
   * Sends a user speech turn directly to Gemini Live with explicit turnComplete: true.
   */
  public sendClientTurn(text: string): void {
    if (!text || !text.trim() || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const clean = text.trim();

    try {
      if (this.model.includes('gemini-3') || this.model.includes('flash-live-preview')) {
        this.sendOutbound('realtimeInput.text', { realtimeInput: { text: clean } }, 'client_turn');
      } else {
        const turnMsg = {
          clientContent: {
            turns: [
              {
                role: 'user',
                parts: [{ text: clean }]
              }
            ],
            turnComplete: true
          }
        };
        this.sendOutbound('clientContent', turnMsg, 'client_turn');
      }
      this.resetTurnWatchdog();
    } catch (err) {
      console.warn('[GeminiLive] Failed to send client turn:', err);
    }
  }

  /**
   * Observational Turn Watchdog.
   * RULE 5 & 21: Watchdog NEVER transmits conversational content or any WebSocket message to Gemini!
   * Purely observational: monitors for playback or thinking freezes.
   */
  private resetTurnWatchdog(): void {
    this.clearTurnWatchdog();
    const generation = this.connectionGeneration;
    this.watchdogGeneration = generation;

    this.turnWatchdogTimer = setTimeout(() => {
      if (this.connectionGeneration !== generation || this._aborted) return;
      
      this.recordProtocolEvent('WATCHDOG_OBSERVATION', {
        state: this.state,
        activeSources: this.activeAudioSources.length,
        currentTime: this.outputAudioContext?.currentTime,
        nextPlaybackTime: this.nextPlaybackTime
      });

      // Observational recovery: If stuck in THINKING for >10s without server response, reset local state
      if (this.state === 'THINKING') {
        console.warn('[GeminiLive] Observational watchdog: Response timeout in THINKING. Transitioning to LISTENING.');
        this.setState('LISTENING');
      }
    }, 10000);
  }

  private clearTurnWatchdog(): void {
    if (this.turnWatchdogTimer) {
      clearTimeout(this.turnWatchdogTimer);
      this.turnWatchdogTimer = null;
    }
    this.watchdogGeneration = null;
  }

  /**
   * Debounced CRM Synchronization Queue
   */
  private queueBackendSync(profile: BuyerProfile, lastTurn?: string): void {
    if (this.agentType === 'PEPTIDE_SPECIALIST') {
      return; // Absolute vertical isolation: zero automotive CRM sync
    }
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
    }
    const hasHighPriority = Boolean(profile.phone || (profile.name && profile.name.trim().length > 1) || profile.vehicleType);
    const delay = hasHighPriority ? 50 : 300;
    this.syncTimeout = setTimeout(() => {
      this.syncToBackend(profile, lastTurn);
    }, delay);
  }

  /**
   * Non-blocking asynchronous sync to backend /api/voice/sync-lead
   */
  private async syncToBackend(profile: BuyerProfile, lastTurn?: string, retryCount = 0): Promise<void> {
    if (this.isSyncing) {
      this.pendingSync = true;
      return;
    }

    this.isSyncing = true;
    this.buyerState.crmStatus = 'SYNCING';
    this.callbacks.onBuyerIntelligenceUpdated?.(this.buyerState);
    diagnosticStore.log({
      level: 'INFO',
      category: 'CRM',
      event: 'CRM_SYNC_STARTED',
      sessionGeneration: this.connectionGeneration,
      conversationId: this.conversationId,
      details: { leadId: this.leadId, profileKeys: Object.keys(profile) }
    });
    diagnosticStore.updateHealth({ crm: 'PENDING' });

    try {
      // Collect enriched forensics (cached after first call, non-blocking)
      let forensicsJson: string | null = null;
      try {
        forensicsJson = await collectAndEnrichForensics();
      } catch { /* Non-critical - proceed without forensics */ }

      const res = await fetch('/api/voice/sync-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: this.conversationId,
          leadId: this.leadId,
          buyerProfile: profile,
          lastTurn: lastTurn || this.currentJarvisTranscript,
          forensics: forensicsJson
        })
      });

      if (!res.ok) {
        throw new Error(`Sync failed with HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data.ignored && data.reason === 'deleted') {
        this.leadId = null;
        try {
          sessionStorage.removeItem('jarvis_live_session');
        } catch {}
        this.buyerState.crmStatus = 'IDLE';
        this.callbacks.onBuyerIntelligenceUpdated?.(this.buyerState);
        return;
      }
      if (data.leadId) this.leadId = data.leadId;
      if (data.metrics) this.buyerState.metrics = data.metrics;
      if (data.buyerProfile) this.buyerState.profile = data.buyerProfile;

      this.buyerState.crmStatus = 'SYNCED';
      this.buyerState.lastUpdated = Date.now();
      this.callbacks.onBuyerIntelligenceUpdated?.(this.buyerState);
      diagnosticStore.log({
        level: 'INFO',
        category: 'CRM',
        event: 'CRM_SYNC_SUCCESS',
        sessionGeneration: this.connectionGeneration,
        conversationId: this.conversationId,
        details: { leadId: this.leadId }
      });
      diagnosticStore.log({
        level: 'INFO',
        category: 'LEAD',
        event: 'LEAD_PROFILE_UPDATED',
        sessionGeneration: this.connectionGeneration,
        conversationId: this.conversationId,
        details: { profile }
      });
      diagnosticStore.updateHealth({ crm: 'SYNCED' });

    } catch (err: any) {
      console.warn('[JARVIS_CRM_SYNC_FAILURE]', err?.message || err);
      this.buyerState.crmStatus = 'ERROR';
      this.callbacks.onBuyerIntelligenceUpdated?.(this.buyerState);
      diagnosticStore.log({
        level: 'WARN',
        category: 'CRM',
        event: 'CRM_SYNC_FAILED',
        sessionGeneration: this.connectionGeneration,
        conversationId: this.conversationId,
        details: { error: err?.message || String(err), retryCount }
      });
      diagnosticStore.updateHealth({ crm: 'ERROR' });

      if (retryCount < 3) {
        const delay = Math.pow(2, retryCount) * 1200;
        setTimeout(() => {
          this.syncToBackend(profile, lastTurn, retryCount + 1);
        }, delay);
      }
    } finally {
      this.isSyncing = false;
      if (this.pendingSync) {
        this.pendingSync = false;
        this.queueBackendSync(this.buyerState.profile, lastTurn);
      }
    }
  }

  public getBuyerState(): BuyerIntelligenceState {
    return this.buyerState;
  }

  /**
   * Section 5: Enqueues an audio item and triggers the single consumer loop.
   * Chunks are NEVER played directly; only enqueued.
   */
  public enqueueAudioItem(base64Data: string, responseId?: string, generation: number = this.sessionGeneration): void {
    if (!base64Data || typeof base64Data !== 'string' || base64Data.trim().length === 0) return;
    if (this.sessionGeneration !== generation || this._aborted || this.audioPlaybackSuppressed || this.isMuted) return;
    if (!this.outputAudioContext || !this.outputAnalyser) return;

    if (this.outputAudioContext.state === 'closed') {
      diagnosticStore.log({
        level: 'WARN',
        category: 'AUDIO_OUTPUT',
        event: 'AUDIO_PLAYBACK_FAILED',
        sessionGeneration: this.connectionGeneration,
        conversationId: this.conversationId,
        socketId: this.activeSocketId || '',
        details: { reason: 'AudioContext is closed' }
      });
      return;
    }

    try {
      diagnosticStore.log({
        level: 'DEBUG',
        category: 'AUDIO_OUTPUT',
        event: 'AUDIO_DECODE_STARTED',
        sessionGeneration: this.connectionGeneration,
        conversationId: this.conversationId,
        socketId: this.activeSocketId || '',
        details: { base64Length: base64Data.length }
      });

      const float32 = this.base64ToFloat32(base64Data);
      if (float32.length === 0) return;

      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = this.outputAudioContext.createBuffer(1, float32.length, 24000);
        audioBuffer.getChannelData(0).set(float32);
        diagnosticStore.log({
          level: 'DEBUG',
          category: 'AUDIO_OUTPUT',
          event: 'AUDIO_BUFFER_CREATED',
          sessionGeneration: this.connectionGeneration,
          conversationId: this.conversationId,
          socketId: this.activeSocketId || '',
          details: { sampleCount: float32.length, duration: audioBuffer.duration }
        });
      } catch (err: any) {
        diagnosticStore.log({
          level: 'ERROR',
          category: 'AUDIO_OUTPUT',
          event: 'AUDIO_PLAYBACK_FAILED',
          sessionGeneration: this.connectionGeneration,
          conversationId: this.conversationId,
          socketId: this.activeSocketId || '',
          details: { error: 'createBuffer failed: ' + (err?.message || err) }
        });
        return;
      }

      const activeRespId = responseId || this.currentResponseId || `resp_${this.connectionGeneration}_${Date.now()}`;
      const audioItemId = `item_${activeRespId}_${++this.audioItemCounter}_${Math.random().toString(36).substring(2, 7)}`;

      const queueItem: AudioQueueItem = {
        audioItemId,
        responseId: activeRespId,
        generation: this.sessionGeneration,
        buffer: audioBuffer,
        started: false,
        completed: false
      };

      this.audioQueue.push(queueItem);

      diagnosticStore.log({
        level: 'DEBUG',
        category: 'AUDIO_OUTPUT',
        event: 'AUDIO_ENQUEUE',
        sessionGeneration: this.connectionGeneration,
        conversationId: this.conversationId,
        socketId: this.activeSocketId || '',
        details: {
          responseId: queueItem.responseId,
          audioItemId: queueItem.audioItemId,
          generation: this.connectionGeneration,
          queueLength: this.audioQueue.length,
          audioContextState: this.outputAudioContext.state
        }
      });

      this.ensurePlaybackConsumer();
    } catch (err: any) {
      console.warn('[GeminiLive] Failed to decode/enqueue audio chunk:', err);
      diagnosticStore.log({
        level: 'ERROR',
        category: 'AUDIO_OUTPUT',
        event: 'AUDIO_PLAYBACK_FAILED',
        sessionGeneration: this.connectionGeneration,
        conversationId: this.conversationId,
        socketId: this.activeSocketId || '',
        details: { error: err?.message || String(err) }
      });
    }
  }

  /**
   * Backward-compatible helper for existing tests and external invocations.
   */
  public playAudioChunk(base64Data: string, generation: number = this.sessionGeneration): void {
    if (this.audioPlaybackSuppressed || this.isMuted) return;
    if (!this.currentResponseId) {
      this.currentResponseId = `resp_${generation}_${Date.now()}`;
    }
    this.enqueueAudioItem(base64Data, this.currentResponseId, generation);
  }

  public setMute(muted: boolean): void {
    this.isMuted = muted;
    if (this.inputProcessor && muted) {
      this.hasActiveSpeechTurn = false;
    }
  }

  public getMute(): boolean {
    return this.isMuted;
  }

  /**
   * Section 5: Single-Consumer Queue Governor.
   * Guarantees maxConcurrentConsumers === 1.
   */
  private ensurePlaybackConsumer(): void {
    if (this.playbackConsumerRunning) {
      return;
    }
    this.processNextQueueItem();
  }

  /**
   * Section 6: Sequential Queue Consumer Loop.
   * Drains the audio queue item by item in strict sequential order.
   */
  private async consumePlaybackQueue(): Promise<void> {
    this.processNextQueueItem();
  }

  private processNextQueueItem(): void {
    if (this._aborted) {
      this.playbackConsumerRunning = false;
      return;
    }

    // Bounded Lookahead Invariant: Allow up to 3 scheduled chunks (~240ms lookahead)
    // Hardware DAC never starves, eliminating audio clicks, gaps, and robotic static.
    if (this.activeAudioSources.length >= 3) {
      return;
    }

    // If queue is empty, check if all scheduled playback ended
    if (this.audioQueue.length === 0) {
      this.playbackConsumerRunning = false;
      if (this.activeAudioSources.length === 0 && this.state === 'SPEAKING') {
        this.setState('LISTENING');
        this.callbacks.onJarvisAudioLevel?.(0);
      }
      return;
    }

    // SUSPENDED AUDIOCONTEXT PROTECTION (Browser Autoplay Compliance):
    // Do NOT dequeue and burn audio frames when AudioContext is suspended.
    // Hold items in audioQueue until unlocked by user gesture or context becomes running.
    if (!this.outputAudioContext || this.outputAudioContext.state !== 'running') {
      this.playbackConsumerRunning = false;
      if (this.outputAudioContext && this.outputAudioContext.state === 'suspended') {
        try { this.outputAudioContext.resume().catch(() => {}); } catch {}
      }
      return;
    }

    this.playbackConsumerRunning = true;
    const item = this.audioQueue.shift();
    if (!item) {
      this.playbackConsumerRunning = false;
      return;
    }

    // Hard Invariant: Generation protection
    if (item.generation !== this.sessionGeneration) {
      diagnosticStore.log({
        level: 'DEBUG',
        category: 'AUDIO_OUTPUT',
        event: 'AUDIO_PLAYBACK_CANCELLED',
        sessionGeneration: this.sessionGeneration,
        conversationId: this.conversationId,
        socketId: this.activeSocketId || '',
        details: {
          reason: 'STALE_GENERATION_DISCARD',
          audioItemId: item.audioItemId,
          responseId: item.responseId,
          itemGen: item.generation,
          currentGen: this.sessionGeneration
        }
      });
      this.processNextQueueItem();
      return;
    }

    // Hard Invariant: Claimed / started items cannot be replayed
    if (item.started || item.completed) {
      this.processNextQueueItem();
      return;
    }

    // Hard Invariant: Deduplication set
    if (this.playedAudioItemIds.has(item.audioItemId)) {
      this.processNextQueueItem();
      return;
    }

    diagnosticStore.log({
      level: 'DEBUG',
      category: 'AUDIO_OUTPUT',
      event: 'AUDIO_DEQUEUE',
      sessionGeneration: item.generation,
      conversationId: this.conversationId,
      socketId: this.activeSocketId || '',
      details: {
        responseId: item.responseId,
        audioItemId: item.audioItemId,
        generation: item.generation,
        queueLength: this.audioQueue.length,
        audioContextState: this.outputAudioContext?.state
      }
    });

    const isLookahead = this.activeAudioSources.length > 0;
    this.playAudioItem(item, isLookahead);

    // Bounded lookahead pipeline: if more items remain in queue and buffer capacity permits,
    // schedule next chunk immediately onto the Web Audio timeline
    if (this.audioQueue.length > 0 && this.activeAudioSources.length < 3) {
      this.processNextQueueItem();
    }
  }

  /**
   * Section 7, 8, 9 & 10: Atomic Item Playback Execution with Bounded Timeline Scheduling.
   * Guarantees sample-accurate lookahead buffer chaining without DAC starvation or static clicks.
   */
  private playAudioItem(item: AudioQueueItem, isLookahead = false): void {
    if (item.generation !== this.sessionGeneration || this._aborted) {
      this.processNextQueueItem();
      return;
    }
    if (!this.outputAudioContext || !this.outputAnalyser) {
      this.processNextQueueItem();
      return;
    }

    if (!isLookahead && this.activePlayback !== null) {
      diagnosticStore.log({
        level: 'ERROR',
        category: 'AUDIO_OUTPUT',
        event: 'AUDIO_INVARIANT_VIOLATION',
        sessionGeneration: this.connectionGeneration,
        conversationId: this.conversationId,
        socketId: this.activeSocketId || '',
        details: {
          reason: 'SECOND_ACTIVE_PLAYBACK_ATTEMPT',
          activePlaybackId: this.activePlayback.playbackId,
          attemptedAudioItemId: item.audioItemId,
          generation: this.connectionGeneration
        }
      });
      return; // Fail closed, do not start second source!
    }

    // Bounded capacity check
    if (this.activeAudioSources.length >= 3) {
      item.started = false;
      this.playedAudioItemIds.delete(item.audioItemId);
      this.audioQueue.unshift(item);
      return;
    }

    if (this.playedAudioItemIds.has(item.audioItemId)) {
      this.processNextQueueItem();
      return;
    }
    this.playedAudioItemIds.add(item.audioItemId);
    // Evict oldest entries when set exceeds cap to prevent memory leak
    if (this.playedAudioItemIds.size > this.MAX_PLAYED_AUDIO_IDS) {
      const iter = this.playedAudioItemIds.values();
      for (let i = 0; i < 50; i++) { // Batch evict 50 oldest
        const oldest = iter.next().value;
        if (oldest) this.playedAudioItemIds.delete(oldest);
      }
    }
    item.started = true; // Claim item atomically before creating source

    const playbackId = `pb_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;

    diagnosticStore.log({
      level: 'DEBUG',
      category: 'AUDIO_OUTPUT',
      event: 'AUDIO_PLAYBACK_ATTEMPT',
      sessionGeneration: item.generation,
      conversationId: this.conversationId,
      socketId: this.activeSocketId || '',
      details: {
        responseId: item.responseId,
        audioItemId: item.audioItemId,
        playbackId,
        generation: item.generation,
        queueLength: this.audioQueue.length,
        audioContextState: this.outputAudioContext.state
      }
    });

    if (this.outputAudioContext.state === 'suspended') {
      try { this.outputAudioContext.resume().catch(() => {}); } catch {}
    }

    if (this.outputAudioContext.state !== 'running') {
      // Re-insert item at the head of queue; wait for user gesture to resume AudioContext
      item.started = false;
      this.playedAudioItemIds.delete(item.audioItemId);
      this.audioQueue.unshift(item);
      this.playbackConsumerRunning = false;
      return;
    }

    let sourceNode: AudioBufferSourceNode;
    try {
      sourceNode = this.outputAudioContext.createBufferSource();
      sourceNode.buffer = item.buffer;
      sourceNode.connect(this.outputAnalyser);

      diagnosticStore.log({
        level: 'DEBUG',
        category: 'AUDIO_OUTPUT',
        event: 'AUDIO_SOURCE_CREATED',
        sessionGeneration: item.generation,
        conversationId: this.conversationId,
        socketId: this.activeSocketId || '',
        details: {
          responseId: item.responseId,
          audioItemId: item.audioItemId,
          playbackId,
          generation: item.generation
        }
      });
    } catch (err: any) {
      diagnosticStore.log({
        level: 'ERROR',
        category: 'AUDIO_OUTPUT',
        event: 'AUDIO_PLAYBACK_ERROR',
        sessionGeneration: item.generation,
        conversationId: this.conversationId,
        socketId: this.activeSocketId || '',
        details: { error: 'createBufferSource failed: ' + (err?.message || err) }
      });
      this.processNextQueueItem();
      return;
    }

    const now = this.outputAudioContext.currentTime;
    if (this.nextPlaybackTime < now) {
      this.nextPlaybackTime = now;
    }
    const startTime = this.nextPlaybackTime;
    const duration = (typeof item.buffer.duration === 'number' && !isNaN(item.buffer.duration))
      ? item.buffer.duration
      : 0.1;
    this.nextPlaybackTime = startTime + duration;

    this.activePlayback = {
      playbackId,
      audioItemId: item.audioItemId,
      responseId: item.responseId,
      generation: item.generation,
      source: sourceNode
    };
    this.activeAudioSources.push(sourceNode);

    let completed = false;
    const currentGen = item.generation;

    const finishItem = () => {
      if (completed) return;
      completed = true;

      if (this.sessionGeneration === currentGen) {
        this.activeAudioSources = this.activeAudioSources.filter(s => s !== sourceNode);
        if (this.activeAudioSources.length === 0) {
          this.activePlayback = null;
        }
        item.completed = true;

        diagnosticStore.log({
          level: 'DEBUG',
          category: 'AUDIO_OUTPUT',
          event: 'AUDIO_PLAYBACK_ENDED',
          sessionGeneration: currentGen,
          conversationId: this.conversationId,
          socketId: this.activeSocketId || '',
          details: {
            responseId: item.responseId,
            audioItemId: item.audioItemId,
            playbackId,
            generation: currentGen,
            activePlaybackId: this.activePlayback?.playbackId || null,
            queueLength: this.audioQueue.length,
            remainingActiveSources: this.activeAudioSources.length
          }
        });

        if (this.activeAudioSources.length === 0 && this.audioQueue.length === 0) {
          if (this.state === 'SPEAKING') {
            this.setState('LISTENING');
          }
          this.callbacks.onJarvisAudioLevel?.(0);
          this.lastJarvisPlaybackEndTime = Date.now();
          this.lastNaturalPlaybackEndTime = Date.now();
        }
      }

      this.processNextQueueItem();
    };

    sourceNode.onended = () => {
      finishItem();
    };

    try {
      sourceNode.start(startTime);
      this.setState('SPEAKING');

      diagnosticStore.log({
        level: 'DEBUG',
        category: 'AUDIO_OUTPUT',
        event: 'AUDIO_SOURCE_STARTED',
        sessionGeneration: item.generation,
        conversationId: this.conversationId,
        socketId: this.activeSocketId || '',
        details: {
          method: 'sourceNode.start(startTime)',
          responseId: item.responseId,
          audioItemId: item.audioItemId,
          playbackId,
          generation: item.generation,
          startTime,
          duration,
          activePlaybackId: playbackId,
          queueLength: this.audioQueue.length
        }
      });

      diagnosticStore.log({
        level: 'DEBUG',
        category: 'AUDIO_OUTPUT',
        event: 'AUDIO_PLAYBACK_STARTED',
        sessionGeneration: item.generation,
        conversationId: this.conversationId,
        socketId: this.activeSocketId || '',
        details: {
          responseId: item.responseId,
          audioItemId: item.audioItemId,
          playbackId,
          generation: item.generation,
          startTime,
          duration,
          activePlaybackId: playbackId,
          queueLength: this.audioQueue.length
        }
      });
    } catch (startErr: any) {
      diagnosticStore.log({
        level: 'ERROR',
        category: 'AUDIO_OUTPUT',
        event: 'AUDIO_PLAYBACK_ERROR',
        sessionGeneration: item.generation,
        conversationId: this.conversationId,
        socketId: this.activeSocketId || '',
        details: { error: 'sourceNode.start failed: ' + (startErr?.message || startErr) }
      });
      this.activePlayback = null;
      this.activeAudioSources = [];
      this.processNextQueueItem();
    }
  }

  /**
   * Section 11: Barge-In & Cancellation Invariant.
   * Monotonically increments generation FIRST, then safely terminates playback and purges queue.
   */
  public abortActiveAudioPlayback(incrementGeneration: boolean = true): void {
    if (incrementGeneration) {
      this.sessionGeneration++;
    }
    const currentGen = this.sessionGeneration;

    const active = this.activePlayback;
    const scheduledSources = [...this.activeAudioSources]; // snapshot before clearing
    const discardedCount = this.audioQueue.length;
    this.pcmOddByte = null;
    this.audioQueue = [];
    this.activePlayback = null;
    this.activeAudioSources = [];
    this.playbackConsumerRunning = false;
    this.silenceHangoverFrames = 0;
    this.hasActiveSpeechTurn = false;
    this.streamingAudioBuffer = '';
    this.lastJarvisPlaybackEndTime = Date.now();
    this.lastNaturalPlaybackEndTime = 0;

    // Stop ALL scheduled sources (lookahead scheduling may have multiple)
    for (const source of scheduledSources) {
      try {
        source.onended = null;
        source.stop();
        source.disconnect();
      } catch {}
    }

    if (active || scheduledSources.length > 0) {
      diagnosticStore.log({
        level: 'INFO',
        category: 'AUDIO_OUTPUT',
        event: 'AUDIO_PLAYBACK_CANCELLED',
        sessionGeneration: currentGen,
        conversationId: this.conversationId,
        socketId: this.activeSocketId || '',
        details: {
          playbackId: active?.playbackId || null,
          audioItemId: active?.audioItemId || null,
          responseId: active?.responseId || null,
          generation: currentGen,
          reason: 'ABORT_REQUESTED',
          discardedCount,
          stoppedSourceCount: scheduledSources.length
        }
      });
    }

    if (this.outputAudioContext) {
      this.nextPlaybackTime = this.outputAudioContext.currentTime;
    }
    this.callbacks.onJarvisAudioLevel?.(0);
  }

  /**
   * Toggles audio playback suppression for silent text conversations.
   * When suppressed is true, any playing audio is aborted immediately and new audio chunks are dropped.
   */
  public setAudioPlaybackSuppressed(suppressed: boolean): void {
    this.audioPlaybackSuppressed = suppressed;
    if (suppressed) {
      this.abortActiveAudioPlayback(true);
    }
  }

  public isAudioPlaybackSuppressed(): boolean {
    return this.audioPlaybackSuppressed;
  }

  // Testing & Forensic inspection getters
  public getAudioQueueLength(): number {
    return this.audioQueue.length;
  }

  public getActivePlayback(): ActivePlaybackState | null {
    return this.activePlayback;
  }

  public isPlaybackConsumerRunning(): boolean {
    return this.playbackConsumerRunning;
  }

  public getPlayedAudioItemIdsCount(): number {
    return this.playedAudioItemIds.size;
  }


  private startLevelMonitoring(): void {
    const inputData = new Uint8Array(128);
    const outputData = new Uint8Array(128);
    let frameSkip = 0;

    const updateLevels = () => {
      // Throttle to ~20fps (skip 2 of every 3 frames) to reduce CPU/battery drain
      frameSkip++;
      if (frameSkip < 3) {
        if (typeof requestAnimationFrame !== 'undefined') {
          this.animationFrameId = requestAnimationFrame(updateLevels);
        }
        return;
      }
      frameSkip = 0;

      // User Mic Level
      if (this.inputAnalyser && !this.isMuted) {
        this.inputAnalyser.getByteTimeDomainData(inputData);
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          const norm = (inputData[i] - 128) / 128;
          sum += norm * norm;
        }
        const rms = Math.sqrt(sum / (inputData.length || 1));
        this.callbacks.onUserAudioLevel(Math.min(1, rms * 4));
      } else {
        this.callbacks.onUserAudioLevel(0);
      }

      // Jarvis Speaker Level
      if (this.outputAnalyser && (this.activeAudioSources.length > 0 || this.activePlayback !== null)) {
        this.outputAnalyser.getByteTimeDomainData(outputData);
        let sum = 0;
        for (let i = 0; i < outputData.length; i++) {
          const norm = (outputData[i] - 128) / 128;
          sum += norm * norm;
        }
        const rms = Math.sqrt(sum / (outputData.length || 1));
        this.callbacks.onJarvisAudioLevel(Math.min(1, rms * 3.5));
      } else {
        this.callbacks.onJarvisAudioLevel(0);
      }

      if (typeof requestAnimationFrame !== 'undefined') {
        this.animationFrameId = requestAnimationFrame(updateLevels);
      }
    };

    updateLevels();
  }

  toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    return this.isMuted;
  }

  getIsMuted(): boolean {
    return this.isMuted;
  }

  getOutputAnalyser(): AnalyserNode | null {
    return this.outputAnalyser;
  }

  /**
   * Cleanly disconnects live session.
   */
  disconnect(): void {
    if (GeminiLiveClient.activeInstance === this) {
      GeminiLiveClient.activeInstance = null;
    }
    this._aborted = true;

    this.clearTurnWatchdog();
    this.clearReconnectTimer();

    if (this.playbackWatchdogInterval) {
      clearInterval(this.playbackWatchdogInterval);
      this.playbackWatchdogInterval = null;
    }

    if (this.animationFrameId) {
      if (typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(this.animationFrameId);
      }
      this.animationFrameId = null;
    }

    this.cleanupInputAudio();
    this.abortActiveAudioPlayback(false);

    // Only suspend AudioContext if it's exclusively owned (not the shared/singleton context)
    if (this.outputAudioContext && this.outputAudioContext.state === 'running') {
      const isShared = this.outputAudioContext === GeminiLiveClient.sharedAudioContext ||
                       this.outputAudioContext === WebAudioEngine.getInstance().getAudioContext();
      if (!isShared) {
        try { this.outputAudioContext.suspend().catch(() => {}); } catch {}
      }
      this.outputAudioContext = null;
    }

    // Flush pending sync if buyer profile has fields
    if (Object.keys(this.buyerState.profile).length > 0 && this.buyerState.crmStatus !== 'SYNCED') {
      this.syncToBackend(this.buyerState.profile).catch(() => {});
    }

    this.closeExistingSocket();
    this.setState('DISCONNECTED');

    // Release Screen Keep-Awake and remove visibility listener
    WakeLockManager.getInstance().release().catch(() => {});
    if (this.visibilityListener && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityListener);
      this.visibilityListener = null;
    }
  }

  /**
   * Mobile Resilience: Monitors page visibility to restore Web Audio,
   * Microphone hardware stream, Screen Wake Lock, and WebSocket connection
   * when the device wakes up or the user returns to the browser tab.
   */
  private setupVisibilityRecovery(): void {
    if (typeof document === 'undefined' || this.visibilityListener) return;

    this.visibilityListener = async () => {
      if (document.visibilityState === 'visible' && !this._aborted) {
        console.log('[GeminiLive] Returned to foreground, restoring hardware & wake lock...');
        WakeLockManager.getInstance().request().catch(() => {});

        if (this.outputAudioContext && this.outputAudioContext.state === 'suspended') {
          await this.outputAudioContext.resume().catch(() => {});
        }
        await WebAudioEngine.getInstance().ensureRunning().catch(() => {});

        if (this.inputAudioContext && this.inputAudioContext.state === 'suspended') {
          await this.inputAudioContext.resume().catch(() => {});
        }

        // Check if mic stream tracks were ended or muted by OS during sleep
        if (this.inputMediaStream) {
          const tracks = this.inputMediaStream.getAudioTracks();
          const hasDeadTrack = tracks.some(t => t.readyState === 'ended' || !t.enabled);
          if (hasDeadTrack && this.micStatus === 'available') {
            console.log('[GeminiLive] Mic track terminated during background sleep, re-acquiring...');
            this.attemptMicrophoneSetup(4000).catch(() => {});
          }
        }

        // Auto-reconnect live voice socket if severed during sleep
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          if (this.state !== 'CONNECTING' && this.state !== 'RECONNECTING' && this.state !== 'PROTOCOL_ERROR') {
            console.log('[GeminiLive] Reconnecting live socket after phone sleep...');
            // Allow one fresh attempt, but don't fully reset counter to prevent infinite retry loops
            this.reconnectAttempts = Math.max(0, this.reconnectAttempts - 1);
            this.openWebSocket();
          }
        }
      }
    };

    document.addEventListener('visibilitychange', this.visibilityListener);
  }

  /**
   * Section 13: True Clear / Restart Transaction
   * Executes explicit 18-step ordered reset.
   * Monotonic generation increments FIRST to invalidate stale callbacks.
   */
  public restartSession(): void {
    // 1. Increment session generation FIRST (both connection and audio)
    const nextGen = ++this.connectionGeneration;
    this.sessionGeneration = nextGen;

    // 2. Generate new conversation ID
    this.conversationId = 'conv_live_' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 11)));

    // 3. Invalidate old callbacks (guarded by generation !== this.connectionGeneration)
    // 4. Stop active audio
    this.abortActiveAudioPlayback(false);

    // 5. Clear audio queue
    this.activeAudioSources = [];

    // 6. Stop SpeechRecognition
    this.cleanupInputAudio();

    // 7. Close old Gemini WebSocket
    this.closeExistingSocket();

    // 8. Clear timers/watchdogs
    this.clearReconnectTimer();
    this.clearTurnWatchdog();
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
      this.syncTimeout = null;
    }

    // 9. Clear transcript/messages
    this.currentJarvisTranscript = '';

    // 10. Clear buyer intelligence
    this.buyerState = {
      profile: {},
      metrics: null,
      crmStatus: 'IDLE',
      lastUpdated: Date.now()
    };

    // 11. Clear lead state
    this.leadId = null;

    // 12. Reset form data (signaled via buyerState)
    // 13. Reset voice state to DISCONNECTED so fresh connect() can establish session
    this.setState('DISCONNECTED');

    // 14. Reset transport state
    this.reconnectAttempts = 0;
    this.hasSentInitialGreeting = false;
    this.greetingSentForConversation.clear();
    this.answeredFunctionCalls.clear();
    this.pendingGreetingOnUnlock = false;

    // 15. Reset CRM state
    this.isSyncing = false;
    this.pendingSync = false;

    // 16. Initialize new session
    diagnosticStore.log({
      level: 'INFO',
      category: 'SESSION',
      event: 'SESSION_RESET',
      sessionGeneration: nextGen,
      conversationId: this.conversationId,
      details: { previousGeneration: nextGen - 1 }
    });
    diagnosticStore.updateHealth({
      sessionGeneration: nextGen,
      conversationId: this.conversationId,
      websocket: 'CLOSED',
      gemini: 'UNKNOWN',
      crm: 'IDLE'
    });

    // 17. Establish new WebSocket
    this.connect();
    // 18. Resume normal JARVIS flow
  }

  // ── Audio Helpers ──────────────────────────────────────────────────────────

  private downsampleTo16k(inputData: Float32Array, inputSampleRate: number, isSilent = false): Int16Array {
    const sampleRateRatio = inputSampleRate / 16000;
    const newLength = Math.round(inputData.length / sampleRateRatio);
    const result = new Int16Array(newLength);

    if (isSilent) {
      return result;
    }

    if (inputSampleRate === 16000) {
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        result[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      return result;
    }

    // Fast linear decimation
    for (let i = 0; i < newLength; i++) {
      const srcIdx = i * sampleRateRatio;
      const idx = Math.floor(srcIdx);
      const frac = srcIdx - idx;
      const s0 = inputData[idx] || 0;
      const s1 = inputData[idx + 1] !== undefined ? inputData[idx + 1] : s0;
      const val = s0 + frac * (s1 - s0);
      const s = Math.max(-1, Math.min(1, val));
      result[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    return result;
  }

  private int16ToBase64(int16Array: Int16Array): string {
    const bytes = new Uint8Array(int16Array.buffer, int16Array.byteOffset, int16Array.byteLength);
    const len = bytes.byteLength;
    // Batch String.fromCharCode in chunks of 8192 to avoid call stack limits
    // and eliminate O(n²) string concatenation from per-byte += loop
    const chunks: string[] = [];
    for (let i = 0; i < len; i += 8192) {
      const slice = bytes.subarray(i, Math.min(i + 8192, len));
      chunks.push(String.fromCharCode.apply(null, slice as any));
    }
    return btoa(chunks.join(''));
  }

  private base64ToFloat32(base64: string): Float32Array {
    try {
      const cleanBase64 = base64.replace(/\s+/g, '');
      if (!cleanBase64) return new Float32Array(0);
      const binary = atob(cleanBase64);
      
      // Preserve byte alignment across streaming chunks: buffer leftover odd byte
      const incomingLen = binary.length;
      const prependLen = this.pcmOddByte !== null ? 1 : 0;
      const totalLen = incomingLen + prependLen;
      const usableLen = totalLen - (totalLen % 2);
      const numSamples = usableLen / 2;

      if (numSamples === 0) {
        if (totalLen === 1) {
          this.pcmOddByte = this.pcmOddByte !== null ? this.pcmOddByte : binary.charCodeAt(0);
        }
        return new Float32Array(0);
      }

      const bytes = new Uint8Array(usableLen);
      let byteIdx = 0;
      if (this.pcmOddByte !== null) {
        bytes[byteIdx++] = this.pcmOddByte;
        this.pcmOddByte = null;
      }
      for (let i = 0; byteIdx < usableLen; i++, byteIdx++) {
        bytes[byteIdx] = binary.charCodeAt(i);
      }

      // Save odd trailing byte for next incoming chunk to prevent 1-byte phase shift static
      if (totalLen % 2 !== 0) {
        this.pcmOddByte = binary.charCodeAt(binary.length - 1);
      } else {
        this.pcmOddByte = null;
      }

      const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, numSamples);
      const float32 = new Float32Array(numSamples);
      for (let i = 0; i < numSamples; i++) {
        float32[i] = int16[i] / 32768.0;
      }
      diagnosticStore.log({
        level: 'DEBUG',
        category: 'AUDIO_OUTPUT',
        event: 'AUDIO_DECODE_SUCCESS',
        sessionGeneration: this.connectionGeneration,
        conversationId: this.conversationId,
        socketId: this.activeSocketId || '',
        details: { numSamples }
      });
      return float32;
    } catch (e: any) {
      diagnosticStore.log({
        level: 'WARN',
        category: 'AUDIO_OUTPUT',
        event: 'AUDIO_DECODE_FAILED',
        sessionGeneration: this.connectionGeneration,
        conversationId: this.conversationId,
        socketId: this.activeSocketId || '',
        details: { error: e?.message || String(e) }
      });
      return new Float32Array(0);
    }
  }
}
