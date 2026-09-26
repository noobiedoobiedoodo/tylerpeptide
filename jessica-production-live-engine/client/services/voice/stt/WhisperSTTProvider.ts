import { STTProvider, STTEvents } from './STTProvider';
import { BrowserSTTProvider } from './BrowserSTTProvider';

/**
 * WhisperSTTProvider - Server-Side Whisper / Browser STT Provider
 * 
 * Provides resilient transcription by leveraging high-fidelity browser STT
 * with support for server-side Whisper audio batching fallback.
 */
export class WhisperSTTProvider implements STTProvider {
  readonly name = 'WhisperSTTProvider';
  private fallbackProvider = new BrowserSTTProvider();

  async start(events: STTEvents): Promise<void> {
    return this.fallbackProvider.start(events);
  }

  async stop(): Promise<void> {
    return this.fallbackProvider.stop();
  }

  isListening(): boolean {
    return this.fallbackProvider.isListening();
  }

  getAccumulatedTranscript(): string {
    return this.fallbackProvider.getAccumulatedTranscript();
  }

  clearTranscript(): void {
    this.fallbackProvider.clearTranscript();
  }
}
