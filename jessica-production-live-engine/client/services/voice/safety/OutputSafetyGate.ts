/**
 * OutputSafetyGate - Post-LLM Model Output Validation
 * 
 * Sanitizes Winston's generated message before TTS speech synthesis:
 * 1. Strips raw function call syntaxes, JSON payloads, or markdown artifacts.
 * 2. Ensures no empty message reaches the speech synthesizer.
 */

export class OutputSafetyGate {
  sanitize(rawOutput: string): { isValid: boolean; sanitizedText: string } {
    if (!rawOutput || !rawOutput.trim()) {
      return {
        isValid: false,
        sanitizedText: "Certainly. How may I best assist with your vehicle search or financing today?"
      };
    }

    let cleaned = rawOutput
      .replace(/```(?:json)?[\s\S]*?```/g, '') // remove codeblocks
      .replace(/\{"name":[\s\S]*?\}/g, '') // remove raw JSON function objects
      .replace(/\[(?:TOOL|ACTION|FUNCTION)[\s\S]*?\]/gi, '') // remove bracketed tool logs
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned) {
      cleaned = "Certainly. How may I best assist with your vehicle search or financing today?";
    }

    return {
      isValid: true,
      sanitizedText: cleaned
    };
  }
}
