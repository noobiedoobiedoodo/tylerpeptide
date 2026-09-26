/**
 * TTSProvider - Text-to-Speech Provider Interface
 * 
 * Reports deterministic lifecycle events (STARTED, PROGRESS, COMPLETED, CANCELLED, ERROR)
 * and supports instant barge-in cancellation.
 */

export type TTSEvent = 'STARTED' | 'PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'ERROR';

export interface TTSProvider {
  readonly name: string;
  speak(text: string, onEvent?: (event: TTSEvent, data?: any) => void): Promise<void>;
  stop(): Promise<void>;
  isSpeaking(): boolean;
}
