/**
 * Text-To-Speech Provider Interface
 * 
 * Chatterbox and future TTS systems implement this contract.
 * Note: The TTS layer is strictly responsible for speech synthesis (Text -> Audio),
 * not conversation logic or sales orchestration.
 */

export interface TextToSpeechProvider {
  readonly name: string;

  /**
   * Synthesizes text into natural speech.
   * @param text The text string approved by the conversation engine.
   * @param onStart Fired when audio begins playing.
   * @param onEnd Fired when audio playback finishes.
   * @param onError Fired on playback error.
   */
  synthesize(
    text: string,
    onStart?: () => void,
    onEnd?: () => void,
    onError?: (error: Error) => void
  ): Promise<void>;

  /**
   * Immediately stops speech synthesis, clears audio buffers,
   * cancels any queued synthesis, and resets audio hardware.
   * Crucial for first-class Barge-In support.
   */
  stop(): Promise<void>;

  /**
   * Returns true if audio is actively speaking or queued.
   */
  isSpeaking(): boolean;
}
