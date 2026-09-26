/**
 * VoiceActivityDetector (VAD)
 * 
 * Separates audio activity and conversational pause evaluation from speech transcription:
 * 1. Tracks states: SILENT -> SPEECH_DETECTED -> SPEAKING -> POSSIBLE_END -> TURN_COMPLETE
 * 2. Evaluates dynamic pause thresholds based on transcript completeness and audio energy.
 * 3. Speech resumption during POSSIBLE_END safely returns to SPEAKING.
 */

export type VADState = 'SILENT' | 'SPEECH_DETECTED' | 'SPEAKING' | 'POSSIBLE_END' | 'TURN_COMPLETE';

export interface VADCallbacks {
  onSpeechStart?: () => void;
  onSpeechSpeaking?: () => void;
  onPossibleEnd?: () => void;
  onTurnComplete?: (reason: string) => void;
}

const TRAILING_INCOMPLETE_WORDS = new Set([
  'and', 'or', 'but', 'because', 'with', 'for', 'like', 'so', 'if', 'that', 'which',
  'to', 'in', 'at', 'about', 'around', 'of', 'from', 'as', 'than',
  'um', 'uh', 'umm', 'uhh', 'er', 'ah', 'well',
  'maybe', 'probably', 'perhaps', 'just', 'i', "i'm", 'we', 'my'
]);

export class VoiceActivityDetector {
  private state: VADState = 'SILENT';
  private callbacks: VADCallbacks = {};
  private silenceTimer: any = null;
  private lastSpeechTime = 0;
  private isEnabled = true;

  private readonly FAST_TURN_SILENCE_MS = 1200; // Crisp natural turn completion
  private readonly PATIENT_TURN_SILENCE_MS = 2200; // Patient window for mid-thought pauses

  private speechStartTimestamp = 0;
  private hasAcousticSpeech = false;
  private energySilenceTimer: any = null;

  constructor(callbacks?: VADCallbacks) {
    if (callbacks) this.callbacks = callbacks;
  }

  setCallbacks(callbacks: VADCallbacks) {
    this.callbacks = callbacks;
  }

  getState(): VADState {
    return this.state;
  }

  /**
   * Called whenever new audio energy or speech tokens are detected
   */
  notifySpeechActivity(currentTranscript?: string) {
    if (!this.isEnabled) return;
    const clean = (currentTranscript || '').trim();

    if (!clean || clean.length < 2) {
      return;
    }

    this.lastSpeechTime = Date.now();

    if (this.state === 'SILENT' || this.state === 'TURN_COMPLETE') {
      this.state = 'SPEECH_DETECTED';
      this.callbacks.onSpeechStart?.();
      this.state = 'SPEAKING';
      this.callbacks.onSpeechSpeaking?.();
    } else if (this.state === 'POSSIBLE_END') {
      this.state = 'SPEAKING';
      this.callbacks.onSpeechSpeaking?.();
    }

    this.scheduleTurnCheck(clean);
  }

  /**
   * Called on audio energy level to provide visual feedback and trigger turn completion
   */
  notifyAudioEnergy(rms: number, peak: number) {
    if (!this.isEnabled) return;

    // Adaptive mobile speech threshold:
    // Mobile mics often operate with RMS around 0.005 - 0.008 during normal voice input.
    const isSpeechLevel = rms >= 0.005 || peak >= 0.020;

    if (isSpeechLevel) {
      this.lastSpeechTime = Date.now();
      if (!this.hasAcousticSpeech) {
        this.speechStartTimestamp = Date.now();
        this.hasAcousticSpeech = true;
      }

      if (this.state === 'SILENT' || this.state === 'TURN_COMPLETE') {
        this.state = 'SPEECH_DETECTED';
        this.callbacks.onSpeechStart?.();
        this.state = 'SPEAKING';
        this.callbacks.onSpeechSpeaking?.();
      } else if (this.state === 'POSSIBLE_END') {
        this.state = 'SPEAKING';
        this.callbacks.onSpeechSpeaking?.();
      }

      this.clearEnergySilenceTimer();
    } else if (this.hasAcousticSpeech && (this.state === 'SPEAKING' || this.state === 'SPEECH_DETECTED')) {
      // Audio dropped below speech threshold. If user spoke for at least 300ms, start silence timer
      const speechDuration = Date.now() - this.speechStartTimestamp;
      if (speechDuration >= 300 && !this.energySilenceTimer && !this.silenceTimer) {
        this.state = 'POSSIBLE_END';
        this.callbacks.onPossibleEnd?.();

        this.energySilenceTimer = setTimeout(() => {
          if (!this.isEnabled) return;
          if (this.state === 'POSSIBLE_END' || this.state === 'SPEAKING') {
            this.state = 'TURN_COMPLETE';
            this.hasAcousticSpeech = false;
            this.callbacks.onTurnComplete?.('acoustic_silence_threshold');
          }
        }, 1100);
      }
    }
  }

  private scheduleTurnCheck(transcript: string) {
    this.clearTimer();
    this.clearEnergySilenceTimer();

    const duration = this.computeSilenceDuration(transcript);

    this.silenceTimer = setTimeout(() => {
      if (!this.isEnabled) return;

      if (this.state === 'SPEAKING' || this.state === 'SPEECH_DETECTED') {
        this.state = 'POSSIBLE_END';
        this.callbacks.onPossibleEnd?.();

        this.state = 'TURN_COMPLETE';
        this.hasAcousticSpeech = false;
        this.callbacks.onTurnComplete?.('silence_threshold_reached');
      }
    }, duration);
  }

  
  private computeSilenceDuration(transcript: string): number {
    if (!transcript || !transcript.trim()) {
      return this.FAST_TURN_SILENCE_MS;
    }

    const cleaned = transcript.trim().toLowerCase().replace(/[.,!?;:]/g, '');
    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length === 0) return this.FAST_TURN_SILENCE_MS;

    const lastWord = words[words.length - 1];
    
    // Explicit scoring model (Phase 15, 16)
    let score = 0;
    let requiredWaitTime = this.FAST_TURN_SILENCE_MS;

    // 1. Conjunction / Incomplete indicator
    if (TRAILING_INCOMPLETE_WORDS.has(lastWord)) {
      score -= 50;
      requiredWaitTime = 3500; // Very patient for 'and', 'but', 'uh'
    }

    // 2. Question indicator
    if (transcript.includes('?') || ['who', 'what', 'where', 'when', 'why', 'how'].includes(words[0])) {
      score += 20;
    }

    // 3. Number handling patience (Phase 16)
    const endsWithNumberOrCurrency = /\d|six|seven|eight|nine|ten|hundred|thousand|million/.test(lastWord);
    if (endsWithNumberOrCurrency) {
      score -= 30;
      requiredWaitTime = Math.max(requiredWaitTime, 3000);
    }

    // 4. Sentence Completeness heuristics
    if (words.length > 4 && !TRAILING_INCOMPLETE_WORDS.has(lastWord)) {
      score += 30;
    }

    // Apply thresholds
    if (score > 40) {
      return 1000; // High confidence complete
    } else if (score < -20) {
      return requiredWaitTime; // Low confidence, wait
    }

    return this.PATIENT_TURN_SILENCE_MS;
  }

  forceTurnComplete(reason = 'manual_override') {
    this.clearTimer();
    this.clearEnergySilenceTimer();
    this.state = 'TURN_COMPLETE';
    this.hasAcousticSpeech = false;
    this.callbacks.onTurnComplete?.(reason);
  }

  reset() {
    this.clearTimer();
    this.clearEnergySilenceTimer();
    this.state = 'SILENT';
    this.lastSpeechTime = 0;
    this.speechStartTimestamp = 0;
    this.hasAcousticSpeech = false;
  }

  setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
    if (!enabled) {
      this.clearTimer();
      this.clearEnergySilenceTimer();
      this.state = 'SILENT';
    }
  }

  private clearTimer() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private clearEnergySilenceTimer() {
    if (this.energySilenceTimer) {
      clearTimeout(this.energySilenceTimer);
      this.energySilenceTimer = null;
    }
  }
}
