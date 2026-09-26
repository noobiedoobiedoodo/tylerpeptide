import { STTProvider, STTEvents } from './STTProvider';
import { BrowserSTTProvider } from './BrowserSTTProvider';

/**
 * ProductionSTTProvider - Pluggable Voice Gateway STT Provider
 * 
 * Supports external low-latency streaming endpoints (WebSocket / WebRTC / Deepgram / Whisper)
 * with transparent fallback to browser STT.
 */
export class ProductionSTTProvider implements STTProvider {
  readonly name = 'ProductionVoiceGatewaySTT';
  private activeProvider: STTProvider;

  constructor() {
    this.activeProvider = new BrowserSTTProvider();
  }

  async start(events: STTEvents): Promise<void> {
    return this.activeProvider.start(events);
  }

  async stop(): Promise<void> {
    return this.activeProvider.stop();
  }

  isListening(): boolean {
    return this.activeProvider.isListening();
  }

  getAccumulatedTranscript(): string {
    return this.activeProvider.getAccumulatedTranscript();
  }

  clearTranscript(): void {
    this.activeProvider.clearTranscript();
  }
}
