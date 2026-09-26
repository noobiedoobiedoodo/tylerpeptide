import { TTSProvider, TTSEvent } from './TTSProvider';

/**
 * ChatterboxProvider - High-performance Neural TTS & Speech Synthesis Provider
 * 
 * 1. Supports neural British butler TTS via /api/tts/speech (MsEdgeTTS / Chatterbox)
 * 2. Instant Barge-In Cancellation: aborts pending HTTP requests and halts audio playback immediately
 * 3. Graceful fallback to client-side Web Speech Synthesis if backend is unavailable
 */
export class ChatterboxProvider implements TTSProvider {
  readonly name = 'Chatterbox';
  private _isSpeaking = false;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private currentAudio: HTMLAudioElement | null = null;
  private currentAudioUrl: string | null = null;
  private abortController: AbortController | null = null;

  async speak(text: string, onEvent?: (event: TTSEvent, data?: any) => void): Promise<void> {
    await this.stop();

    if (!text || !text.trim()) {
      onEvent?.('COMPLETED');
      return;
    }

    const cleanText = text
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/\[.*?\]/g, '')
      .replace(/`/g, '')
      .replace(/→/g, '')
      .replace(/✓/g, '')
      .replace(/•/g, '')
      .trim();

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Combine barge-in abort with a 12s hard timeout so Jarvis falls back to
    // local synthesis instead of hanging silently when the server is slow.
    const fetchSignal = typeof AbortSignal.any === 'function'
      ? AbortSignal.any([signal, AbortSignal.timeout(12_000)])
      : signal;

    try {
      const response = await fetch('/api/tts/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: cleanText,
          voice: 'onyx',
          exaggeration: 0.28,
          cfg_weight: 0.75,
          temperature: 0.55,
        }),
        signal: fetchSignal
      });

      if (response.ok && response.headers.get('content-type')?.includes('audio')) {
        const audioBlob = await response.blob();
        if (signal.aborted) {
          onEvent?.('CANCELLED');
          return;
        }

        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        (audio as any).playsInline = true;
        audio.preload = 'auto';
        this.currentAudio = audio;

        return new Promise<void>((resolve) => {
          audio.onplay = () => {
            this._isSpeaking = true;
            onEvent?.('STARTED');
          };

          audio.onended = () => {
            this._isSpeaking = false;
            this.cleanupAudio();
            onEvent?.('COMPLETED');
            resolve();
          };

          audio.onerror = () => {
            this._isSpeaking = false;
            this.cleanupAudio();
            // Fallback to local synthesis
            this.synthesizeLocal(cleanText, signal, onEvent).then(resolve);
          };

          audio.play().catch(() => {
            this.cleanupAudio();
            this.synthesizeLocal(cleanText, signal, onEvent).then(resolve);
          });
        });
      }
    } catch (err: any) {
      if (signal.aborted) {
        onEvent?.('CANCELLED');
        return;
      }
    }

    // Fallback to client-side synthesis
    return this.synthesizeLocal(cleanText, signal, onEvent);
  }

  // Backward compatibility alias for legacy components
  async synthesize(
    text: string,
    onStart?: () => void,
    onEnd?: () => void,
    onError?: (error: Error) => void
  ): Promise<void> {
    return this.speak(text, (event, data) => {
      if (event === 'STARTED') onStart?.();
      else if (event === 'COMPLETED' || event === 'CANCELLED') onEnd?.();
      else if (event === 'ERROR') onError?.(new Error(data?.message || 'TTS Error'));
    });
  }

  private synthesizeLocal(
    cleanText: string,
    signal: AbortSignal,
    onEvent?: (event: TTSEvent, data?: any) => void
  ): Promise<void> {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      onEvent?.('ERROR', { message: 'Speech synthesis is not supported on this device.' });
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      try {
        window.speechSynthesis.resume();

        const utterance = new SpeechSynthesisUtterance(cleanText);
        this.currentUtterance = utterance;

        const setVoiceAndSpeak = () => {
          if (signal.aborted) {
            onEvent?.('CANCELLED');
            resolve();
            return;
          }

          const voices = window.speechSynthesis.getVoices();
          if (voices && voices.length > 0) {
            const preferredVoice = voices.find(v => 
              (v.lang === 'en-GB' || v.lang.includes('GB') || v.lang.includes('UK')) &&
              !v.name.toLowerCase().includes('female')
            ) || voices.find(v => v.lang.startsWith('en'));

            if (preferredVoice) utterance.voice = preferredVoice;
          }

          utterance.rate = 0.98;
          utterance.pitch = 0.95;

          utterance.onstart = () => {
            this._isSpeaking = true;
            onEvent?.('STARTED');
          };

          utterance.onend = () => {
            this._isSpeaking = false;
            this.currentUtterance = null;
            onEvent?.('COMPLETED');
            resolve();
          };

          utterance.onerror = (e) => {
            this._isSpeaking = false;
            this.currentUtterance = null;
            if (signal.aborted) {
              onEvent?.('CANCELLED');
            } else if (e.error === 'interrupted') {
              // Ignore chrome internal speech synthesis reset
              onEvent?.('COMPLETED');
            } else {
              onEvent?.('ERROR', { message: e.error });
            }
            resolve();
          };

          window.speechSynthesis.speak(utterance);
        };

        if (window.speechSynthesis.getVoices().length > 0) {
          setVoiceAndSpeak();
        } else {
          window.speechSynthesis.onvoiceschanged = () => {
            window.speechSynthesis.onvoiceschanged = null;
            setVoiceAndSpeak();
          };
          setTimeout(setVoiceAndSpeak, 100);
        }
      } catch (err: any) {
        this._isSpeaking = false;
        this.currentUtterance = null;
        onEvent?.('ERROR', { message: err.message });
        resolve();
      }
    });
  }

  async stop(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.src = '';
      } catch {}
      this.currentAudio = null;
    }

    this.cleanupAudio();

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
      this.currentUtterance = null;
    }

    this._isSpeaking = false;
  }

  private cleanupAudio() {
    if (this.currentAudioUrl) {
      try {
        URL.revokeObjectURL(this.currentAudioUrl);
      } catch {}
      this.currentAudioUrl = null;
    }
  }

  isSpeaking(): boolean {
    return this._isSpeaking;
  }
}
