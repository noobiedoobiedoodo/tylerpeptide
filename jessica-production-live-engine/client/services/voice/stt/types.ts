/**
 * Speech-To-Text Provider Interface
 * 
 * Defines contract for streaming speech recognition providers.
 * Supports partial (interim) transcripts for live display and final transcripts for LLM ingestion.
 */

export interface STTCallbacks {
  onSpeechStart?: () => void;
  onInterimResult?: (transcript: string) => void;
  onFinalResult?: (transcript: string) => void;
  onSpeechEnd?: () => void;
  onError?: (error: Error) => void;
}

export interface SpeechToTextProvider {
  readonly name: string;

  /**
   * Starts listening to audio input.
   */
  start(callbacks: STTCallbacks): Promise<void>;

  /**
   * Stops listening and releases microphone streams.
   */
  stop(): Promise<void>;

  /**
   * Returns whether the provider is currently listening.
   */
  isListening(): boolean;

  /**
   * Immediately commits currently recognized speech without waiting for silence timer.
   */
  commitSpeech?(): void;
}
