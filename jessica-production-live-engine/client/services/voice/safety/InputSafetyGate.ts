/**
 * InputSafetyGate - Pre-LLM User Input Validation & Echo Rejection
 * 
 * Intercepts transcribed user speech before reaching Gemini:
 * 1. Filters empty/corrupted strings and non-meaningful acoustic artifacts.
 * 2. Detects and discards acoustic echo of Winston's recent spoken responses based on text and timing.
 * 3. Blocks prompt injection attempts or system instruction extraction.
 */

export interface InputGateResult {
  allowed: boolean;
  sanitizedText: string;
  reason?: 'EMPTY' | 'ECHO_DETECTED' | 'PROMPT_INJECTION' | 'CORRUPTED';
}

const INJECTION_PATTERNS = [
  /ignore previous instructions/i,
  /system prompt/i,
  /you are now a/i,
  /override safety/i,
  /reveal your instructions/i,
  /act as dan/i
];

export class InputSafetyGate {
  private recentWinstonUtterances: string[] = [];

  registerWinstonOutput(text: string) {
    if (!text || !text.trim()) return;
    const clean = text.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    this.recentWinstonUtterances.push(clean);
    if (this.recentWinstonUtterances.length > 5) {
      this.recentWinstonUtterances.shift();
    }
  }

  /**
   * Calculates probability of an echo based on textual similarity and timing.
   */
  calculateEchoProbability(userInput: string, isWinstonSpeaking: boolean): 'LOW' | 'MEDIUM' | 'HIGH' {
    if (!userInput || !userInput.trim()) return 'LOW';
    const cleanUser = userInput.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleanUser.length < 3) return 'LOW';

    const userWords = cleanUser.split(/\s+/).filter(w => w.length > 2);
    if (userWords.length === 0) return 'LOW';

    let maxOverlapRatio = 0;
    let isExactMatch = false;

    for (const recent of this.recentWinstonUtterances) {
      if (recent === cleanUser) {
        isExactMatch = true;
        maxOverlapRatio = 1.0;
        break;
      }

      const recentWords = new Set(recent.split(/\s+/).filter(w => w.length > 2));
      let matchCount = 0;
      for (const w of userWords) {
        if (recentWords.has(w)) matchCount++;
      }
      const overlapRatio = matchCount / userWords.length;
      if (overlapRatio > maxOverlapRatio) {
        maxOverlapRatio = overlapRatio;
      }
    }

    if (maxOverlapRatio < 0.6) {
      return 'LOW'; // Little to no overlap
    }

    if (isWinstonSpeaking) {
      // If Winston is currently speaking and we detect high textual similarity simultaneously
      if (maxOverlapRatio >= 0.8 || isExactMatch) {
        return 'HIGH';
      }
      return 'MEDIUM';
    } else {
      // If Winston is NOT speaking, user starts speaking. It is highly unlikely to be echo,
      // it might be the user genuinely repeating Winston's phrase to confirm (e.g. "The Honda Civic?").
      // Unless it is an absurdly long exact match that the STT somehow regurgitated late.
      if (isExactMatch && userWords.length >= 6) {
        return 'HIGH'; // Suspiciously exact long phrase even after speech ended
      }
      return 'LOW'; // Safe, legitimate user confirmation
    }
  }

  validate(userInput: string, isWinstonSpeaking: boolean = false): InputGateResult {
    if (!userInput || !userInput.trim()) {
      return { allowed: false, sanitizedText: '', reason: 'EMPTY' };
    }

    const cleanInput = userInput.trim();

    // 1. Minimum meaningful length
    if (cleanInput.length < 2) {
      return { allowed: false, sanitizedText: '', reason: 'EMPTY' };
    }

    // 2. Prompt Injection Check
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(cleanInput)) {
        console.warn(`[InputSafetyGate] Blocked potential prompt injection: "${cleanInput}"`);
        return { allowed: false, sanitizedText: cleanInput, reason: 'PROMPT_INJECTION' };
      }
    }

    // 3. Acoustic Echo Detection
    const echoProb = this.calculateEchoProbability(cleanInput, isWinstonSpeaking);
    if (echoProb === 'HIGH') {
      console.warn(`[InputSafetyGate] Discarded HIGH probability acoustic echo of Winston: "${cleanInput}"`);
      return { allowed: false, sanitizedText: cleanInput, reason: 'ECHO_DETECTED' };
    }

    return { allowed: true, sanitizedText: cleanInput };
  }
}
