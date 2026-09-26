/**
 * STTProvider - Speech-to-Text Provider Interface
 * 
 * Providers transcribe speech tokens and deliver interim/final chunks to the
 * VoiceConversationEngine. Providers do NOT determine when a conversational turn completes.
 */

export interface STTEvents {
  onSpeechStart?: () => void;
  onInterimTranscript?: (text: string) => void;
  onFinalTranscript?: (text: string) => void;
  onError?: (error: Error) => void;
}

export interface STTProvider {
  readonly name: string;
  start(events: STTEvents): Promise<void>;
  stop(): Promise<void>;
  isListening(): boolean;
  getAccumulatedTranscript(): string;
  clearTranscript(): void;
  setBargeInMode?(active: boolean): void;
  ensureListening?(): void;
}
