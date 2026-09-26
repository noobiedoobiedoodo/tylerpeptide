import { STTProvider, STTEvents } from './STTProvider';

/**
 * BrowserSTTProvider - Resilient Web Speech Recognition Provider
 * 
 * 1. Accumulates multi-session final segments across browser speech engine restarts.
 * 2. Emits granular lifecycle events (STT_START, STT_INTERIM, STT_FINAL, STT_END, STT_ERROR).
 * 3. Supports mobile continuous listening via auto-rearm loop on onend/onerror.
 */
export class BrowserSTTProvider implements STTProvider {
  readonly name = 'BrowserWebSpeechSTT';
  private recognition: any = null;
  private SpeechRecognitionClass: any = null;
  private _isListening = false;
  private events: STTEvents = {};
  private intentionalStop = false;
  private bargeInMode = false;

  private accumulatedFinalSegments: string[] = [];
  private currentSessionFinal = '';
  private currentSessionInterim = '';
  private recognitionGeneration = 0;

  async start(events: STTEvents): Promise<void> {
    this.events = events;
    this.intentionalStop = false;
    this.bargeInMode = false;
    this.accumulatedFinalSegments = [];
    this.currentSessionFinal = '';
    this.currentSessionInterim = '';

    if (typeof window === 'undefined') {
      events.onError?.(new Error('Window context is undefined.'));
      return;
    }

    this.SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!this.SpeechRecognitionClass) {
      events.onError?.(new Error('Speech recognition is not supported in this browser.'));
      return;
    }

    this.startFreshRecognition();
  }

  setBargeInMode(active: boolean) {
    this.bargeInMode = active;
    // Clear transcript so we ONLY hear new barge-in words without restarting recognition
    this.currentSessionFinal = '';
    this.currentSessionInterim = '';
    this.accumulatedFinalSegments = [];
  }

  private cleanupCurrentRecognition() {
    if (this.recognition) {
      try {
        this.recognition.onstart = null;
        this.recognition.onaudiostart = null;
        this.recognition.onspeechstart = null;
        this.recognition.onresult = null;
        this.recognition.onspeechend = null;
        this.recognition.onaudioend = null;
        this.recognition.onerror = null;
        this.recognition.onend = null;
        this.recognition.stop();
      } catch {}
      this.recognition = null;
    }
    this._isListening = false;
  }

  private startFreshRecognition() {
    if (this.intentionalStop) return;
    if (!this.SpeechRecognitionClass) return;

    // If already listening, do not recreate or restart
    if (this._isListening && this.recognition) return;

    this.cleanupCurrentRecognition();
    const generation = ++this.recognitionGeneration;

    try {
      const rec = new this.SpeechRecognitionClass();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        if (generation !== this.recognitionGeneration) return;
        this._isListening = true;
      };

      rec.onspeechstart = () => {
        if (generation !== this.recognitionGeneration) return;
        this.events.onSpeechStart?.();
      };

      rec.onresult = (event: any) => {
        if (generation !== this.recognitionGeneration) return;
        const finals: string[] = [];
        const interims: string[] = [];

        for (let i = 0; i < event.results.length; ++i) {
          const result = event.results[i];
          if (result && result[0]) {
            const text = result[0].transcript?.trim();
            if (!text) continue;
            const isFinal = Boolean(result.isFinal || result[0]?.isFinal);
            if (isFinal) {
              finals.push(text);
            } else {
              interims.push(text);
            }
          }
        }

        if (finals.length > 0) {
          this.currentSessionFinal = finals.join(' ').trim();
        }
        this.currentSessionInterim = interims.join(' ').trim();

        const full = this.getAccumulatedTranscript();
        if (full) {
          this.events.onSpeechStart?.();
          this.events.onInterimTranscript?.(full);
          if (this.currentSessionFinal) {
            this.events.onFinalTranscript?.(full);
          }
        }
      };

      rec.onerror = (event: any) => {
        if (generation !== this.recognitionGeneration) return;
        if (event.error === 'no-speech' || event.error === 'aborted') {
          // Expected on mobile Safari & Chrome during quiet periods; onend will re-arm.
          return;
        }
        if (event.error === 'not-allowed') {
          this.intentionalStop = true;
          this._isListening = false;
          this.events.onError?.(new Error('Microphone permission was denied.'));
          return;
        }
        console.warn('[BrowserSTT Notice]', event.error);
      };

      rec.onend = () => {
        if (generation !== this.recognitionGeneration) return;
        this._isListening = false;
        this.recognition = null;
        
        // Fold cycle's final text into accumulatedFinalSegments
        const sessionText = [this.currentSessionFinal, this.currentSessionInterim].filter(Boolean).join(' ').trim();
        if (sessionText) {
          this.accumulatedFinalSegments.push(sessionText);
          this.currentSessionFinal = '';
          this.currentSessionInterim = '';
        }

        // Auto-rearm on mobile if not intentionally stopped
        if (!this.intentionalStop) {
          setTimeout(() => {
            if (!this.intentionalStop && !this._isListening && this.SpeechRecognitionClass) {
              this.startFreshRecognition();
            }
          }, 100);
        }
      };

      this.recognition = rec;
      rec.start();
      this._isListening = true;
    } catch (err: any) {
      this._isListening = false;
      this.recognition = null;
      console.warn('[BrowserSTT start error]', err.message);

      // Retry start after brief pause if not intentionally stopped
      if (!this.intentionalStop) {
        setTimeout(() => {
          if (!this.intentionalStop && !this._isListening && this.SpeechRecognitionClass) {
            this.startFreshRecognition();
          }
        }, 300);
      }
    }
  }

  ensureListening() {
    if (this.intentionalStop) return;
    if (this._isListening && this.recognition) return;
    if (!this.SpeechRecognitionClass) return;
    this.startFreshRecognition();
  }

  getAccumulatedTranscript(): string {
    const segments = [...this.accumulatedFinalSegments, this.currentSessionFinal, this.currentSessionInterim];
    return segments.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  clearTranscript() {
    this.accumulatedFinalSegments = [];
    this.currentSessionFinal = '';
    this.currentSessionInterim = '';
  }

  async stop(): Promise<void> {
    this.intentionalStop = true;
    this.clearTranscript();
    this.cleanupCurrentRecognition();
  }

  isListening(): boolean {
    return this._isListening;
  }
}
