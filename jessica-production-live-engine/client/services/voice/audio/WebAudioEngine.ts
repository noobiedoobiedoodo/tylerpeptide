/**
 * WebAudioEngine - Enterprise Web Audio Context Manager
 * 
 * 1. Manages a singleton AudioContext initialized and resumed from explicit user gesture.
 * 2. Provides active recovery state machine: AUDIO_CONTEXT_SUSPENDED -> RESUMING -> RUNNING -> FAILED.
 * 3. Keeps input graph (Mic -> 110Hz filter -> Analyser) completely isolated from output graph (TTS -> Gain -> Destination).
 */

import { diagnosticStore } from '../diagnostics/DiagnosticLogger';

export type AudioContextLifecycleState = 
  | 'AUDIO_CONTEXT_UNINITIALIZED'
  | 'AUDIO_CONTEXT_SUSPENDED'
  | 'AUDIO_CONTEXT_RESUMING'
  | 'AUDIO_CONTEXT_RUNNING'
  | 'AUDIO_CONTEXT_FAILED';

export interface AudioEngineTelemetry {
  audio_context_created_at: number | null;
  audio_context_resumed_at: number | null;
  initial_user_gesture: boolean;
  suspension_count: number;
  recovery_count: number;
  state: AudioContextLifecycleState;
}

export class WebAudioEngine {
  private static instance: WebAudioEngine | null = null;
  private audioContext: AudioContext | null = null;
  private outputGainNode: GainNode | null = null;
  private state: AudioContextLifecycleState = 'AUDIO_CONTEXT_UNINITIALIZED';
  
  private telemetry: AudioEngineTelemetry = {
    audio_context_created_at: null,
    audio_context_resumed_at: null,
    initial_user_gesture: false,
    suspension_count: 0,
    recovery_count: 0,
    state: 'AUDIO_CONTEXT_UNINITIALIZED'
  };

  private stateChangeListeners: ((state: AudioContextLifecycleState) => void)[] = [];

  private constructor() {}

  static getInstance(): WebAudioEngine {
    if (!WebAudioEngine.instance) {
      WebAudioEngine.instance = new WebAudioEngine();
    }
    return WebAudioEngine.instance;
  }

  /**
   * Initializes and unlocks the AudioContext from a direct user gesture
   */
  async initializeFromUserGesture(): Promise<AudioContext> {
    if (typeof window === 'undefined') {
      throw new Error('WebAudioEngine requires browser window context.');
    }

    if (!this.audioContext || this.audioContext.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) {
        this.setState('AUDIO_CONTEXT_FAILED');
        throw new Error('Web Audio API is not supported in this browser.');
      }

      this.audioContext = new AudioCtx({ latencyHint: 'interactive' });
      this.telemetry.audio_context_created_at = Date.now();
      this.telemetry.initial_user_gesture = true;
      diagnosticStore.log({
        level: 'INFO',
        category: 'AUDIO_OUTPUT',
        event: 'AUDIO_CONTEXT_CREATED',
        details: { sampleRate: this.audioContext.sampleRate, state: this.audioContext.state }
      });
      diagnosticStore.updateHealth({ webaudio: this.audioContext.state === 'running' ? 'RUNNING' : 'SUSPENDED' });

      // Create primary output gain node with graceful fallback
      if (typeof this.audioContext.createGain === 'function') {
        this.outputGainNode = this.audioContext.createGain();
        if (this.outputGainNode.gain?.setValueAtTime) {
          this.outputGainNode.gain.setValueAtTime(1.0, this.audioContext.currentTime);
        }

        // JARVIS Neural Acoustic Filter Chain:
        if (
          typeof this.audioContext.createBiquadFilter === 'function' &&
          typeof this.audioContext.createDynamicsCompressor === 'function'
        ) {
          const highpass = this.audioContext.createBiquadFilter();
          highpass.type = 'highpass';
          highpass.frequency.setValueAtTime(80, this.audioContext.currentTime);

          const lowshelf = this.audioContext.createBiquadFilter();
          lowshelf.type = 'lowshelf';
          lowshelf.frequency.setValueAtTime(220, this.audioContext.currentTime);
          lowshelf.gain.setValueAtTime(-2.0, this.audioContext.currentTime);

          const presenceEQ = this.audioContext.createBiquadFilter();
          presenceEQ.type = 'peaking';
          presenceEQ.frequency.setValueAtTime(2800, this.audioContext.currentTime);
          presenceEQ.Q.setValueAtTime(1.2, this.audioContext.currentTime);
          presenceEQ.gain.setValueAtTime(2.5, this.audioContext.currentTime);

          const highshelf = this.audioContext.createBiquadFilter();
          highshelf.type = 'highshelf';
          highshelf.frequency.setValueAtTime(7500, this.audioContext.currentTime);
          highshelf.gain.setValueAtTime(1.5, this.audioContext.currentTime);

          const compressor = this.audioContext.createDynamicsCompressor();
          compressor.threshold.setValueAtTime(-16, this.audioContext.currentTime);
          compressor.knee.setValueAtTime(10, this.audioContext.currentTime);
          compressor.ratio.setValueAtTime(3.0, this.audioContext.currentTime);
          compressor.attack.setValueAtTime(0.003, this.audioContext.currentTime);
          compressor.release.setValueAtTime(0.15, this.audioContext.currentTime);

          // Connect graph: outputGain -> highpass -> lowshelf -> presenceEQ -> highshelf -> compressor -> destination
          this.outputGainNode.connect(highpass);
          highpass.connect(lowshelf);
          lowshelf.connect(presenceEQ);
          presenceEQ.connect(highshelf);
          highshelf.connect(compressor);
          compressor.connect(this.audioContext.destination);
        } else {
          this.outputGainNode.connect(this.audioContext.destination);
        }
      }

      // Listen for browser auto-suspension events
      this.audioContext.onstatechange = () => {
        this.handleAudioContextStateChange();
      };
    }

    // Play a 1-sample silent buffer to unlock iOS Safari Web Audio lock
    try {
      diagnosticStore.log({
        level: 'INFO',
        category: 'AUDIO_OUTPUT',
        event: 'AUDIO_HARDWARE_UNLOCK_START',
        details: { currentState: this.audioContext.state }
      });
      diagnosticStore.log({
        level: 'INFO',
        category: 'AUDIO_OUTPUT',
        event: 'AUDIO_HARDWARE_UNLOCK_STARTED',
        details: { currentState: this.audioContext.state }
      });

      if (this.audioContext.state === 'suspended') {
        this.setState('AUDIO_CONTEXT_RESUMING');
        await this.audioContext.resume();
        diagnosticStore.log({
          level: 'INFO',
          category: 'AUDIO_OUTPUT',
          event: 'AUDIO_CONTEXT_RESUMED',
          details: { state: this.audioContext.state }
        });
      }

      const silentBuffer = this.audioContext.createBuffer(1, 1, 22050);
      const source = this.audioContext.createBufferSource();
      source.buffer = silentBuffer;
      source.connect(this.audioContext.destination);
      source.start(0);

      this.telemetry.audio_context_resumed_at = Date.now();
      this.setState('AUDIO_CONTEXT_RUNNING');
      diagnosticStore.updateHealth({ webaudio: 'RUNNING' });
      diagnosticStore.log({
        level: 'INFO',
        category: 'AUDIO_OUTPUT',
        event: 'AUDIO_HARDWARE_UNLOCK_SUCCESS',
        details: { state: this.audioContext.state }
      });
    } catch (e: any) {
      console.warn('[WebAudioEngine Resume Error]', e.message);
      diagnosticStore.log({
        level: 'ERROR',
        category: 'AUDIO_OUTPUT',
        event: 'AUDIO_HARDWARE_UNLOCK_FAILED',
        details: { error: e.message }
      });
      diagnosticStore.updateHealth({ webaudio: 'SUSPENDED' });
      this.handleAudioContextStateChange();
    }

    return this.audioContext;
  }

  /**
   * Attempts automatic recovery if browser policy suspended the context
   */
  async ensureRunning(): Promise<boolean> {
    if (!this.audioContext) return false;

    if (this.audioContext.state === 'running' as any) {
      if (this.state !== 'AUDIO_CONTEXT_RUNNING') {
        this.setState('AUDIO_CONTEXT_RUNNING');
      }
      return true;
    }

    try {
      this.setState('AUDIO_CONTEXT_RESUMING');
      await this.audioContext.resume();
      if (this.audioContext.state === 'running' as any) {
        this.telemetry.recovery_count++;
        this.setState('AUDIO_CONTEXT_RUNNING');
        return true;
      }
    } catch (err: any) {
      console.warn('[WebAudioEngine Recovery Failed]', err.message);
    }

    this.setState('AUDIO_CONTEXT_SUSPENDED');
    return false;
  }

  private handleAudioContextStateChange() {
    if (!this.audioContext) return;
    const ctxState = this.audioContext.state;

    if (ctxState === 'running') {
      this.setState('AUDIO_CONTEXT_RUNNING');
    } else if (ctxState === 'suspended') {
      this.telemetry.suspension_count++;
      this.setState('AUDIO_CONTEXT_SUSPENDED');
    } else if (ctxState === 'closed') {
      this.setState('AUDIO_CONTEXT_FAILED');
    }
  }

  private setState(next: AudioContextLifecycleState) {
    this.state = next;
    this.telemetry.state = next;
    for (const listener of this.stateChangeListeners) {
      listener(next);
    }
  }

  onStateChange(listener: (state: AudioContextLifecycleState) => void): () => void {
    this.stateChangeListeners.push(listener);
    return () => {
      this.stateChangeListeners = this.stateChangeListeners.filter(l => l !== listener);
    };
  }

  getAudioContext(): AudioContext | null {
    return this.audioContext;
  }

  getOutputGainNode(): GainNode | null {
    return this.outputGainNode;
  }

  getState(): AudioContextLifecycleState {
    return this.state;
  }

  getTelemetry(): AudioEngineTelemetry {
    return { ...this.telemetry };
  }

  async close(): Promise<void> {
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        await this.audioContext.close();
      } catch {}
    }
    this.audioContext = null;
    this.outputGainNode = null;
    this.setState('AUDIO_CONTEXT_UNINITIALIZED');
  }

  /**
   * For testing environment resets
   */
  static resetForTesting(): void {
    if (WebAudioEngine.instance) {
      WebAudioEngine.instance.audioContext = null;
      WebAudioEngine.instance.outputGainNode = null;
      WebAudioEngine.instance.state = 'AUDIO_CONTEXT_UNINITIALIZED';
      WebAudioEngine.instance = null;
    }
  }
}
