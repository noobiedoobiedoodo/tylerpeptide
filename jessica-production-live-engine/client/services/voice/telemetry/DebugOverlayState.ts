import { VoiceState } from '../VoiceStateMachine';
import { VADState } from '../vad/VoiceActivityDetector';
import { SessionHealthMetrics } from '../VoiceSession';
import { TelemetryTraceItem } from './VoiceTelemetry';

export interface DiagnosticMicTestResult {
  isRunning: boolean;
  microphoneDetected: boolean | null;
  audioStreamActive: boolean | null;
  audioEnergyDetected: boolean | null;
  vadDetectedSpeech: boolean | null;
  sttReceivedAudio: boolean | null;
  transcriptGenerated: boolean | null;
  diagnosticNotes: string[];
}

export interface DebugState {
  micActive: boolean;
  audioLevels: { rms: number; peak: number };
  vadState: VADState;
  sttStatus: 'ACTIVE' | 'LISTENING' | 'IDLE' | 'ERROR';
  transcript: string;
  turnId: string;
  voiceState: VoiceState;
  apiStatus: 'IDLE' | 'REQUEST' | '200' | 'ERROR';
  ttsStatus: 'IDLE' | 'PLAYING' | 'COMPLETE' | 'ERROR';
  lastErrorDetails?: {
    turnId: string;
    lastSuccessfulEvent: string;
    failedEvent: string;
    reason: string;
  };
  metrics: SessionHealthMetrics;
  recentTraces: TelemetryTraceItem[];
  diagnosticTest: DiagnosticMicTestResult;
}

export class DebugOverlayStore {
  private state: DebugState = {
    micActive: false,
    audioLevels: { rms: 0, peak: 0 },
    vadState: 'SILENT',
    sttStatus: 'IDLE',
    transcript: '',
    turnId: '0',
    voiceState: 'IDLE',
    apiStatus: 'IDLE',
    ttsStatus: 'IDLE',
    metrics: {
      totalTurns: 0,
      successfulTurns: 0,
      microphoneHealth: 100,
      vadHealth: 100,
      sttHealth: 100,
      turnDetectionHealth: 100,
      apiHealth: 100,
      ttsHealth: 100,
      conversationHealth: 100,
      topFailureModes: []
    },
    recentTraces: [],
    diagnosticTest: {
      isRunning: false,
      microphoneDetected: null,
      audioStreamActive: null,
      audioEnergyDetected: null,
      vadDetectedSpeech: null,
      sttReceivedAudio: null,
      transcriptGenerated: null,
      diagnosticNotes: []
    }
  };

  private listeners: ((state: DebugState) => void)[] = [];

  getState(): DebugState {
    return { ...this.state };
  }

  update(partial: Partial<DebugState>) {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      try { listener(this.state); } catch {}
    }
  }

  addTrace(trace: TelemetryTraceItem) {
    const updated = [trace, ...this.state.recentTraces].slice(0, 50);
    this.update({ recentTraces: updated });
  }

  subscribe(listener: (state: DebugState) => void): () => void {
    this.listeners.push(listener);
    listener(this.state);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }
}

export const debugOverlayStore = new DebugOverlayStore();
