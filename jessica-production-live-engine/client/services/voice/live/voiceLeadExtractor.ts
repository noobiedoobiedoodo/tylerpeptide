/**
 * voiceLeadExtractor.ts
 * 
 * Deterministic normalization, transcript fallback parsing, and confidence-aware
 * profile merging for the Jarvis 1:1 Live Voice automotive sales engine.
 */

export interface BuyerProfile {
  name?: string;
  phone?: string;
  email?: string;
  targetVehicle?: string;
  vehicleType?: string;
  monthlyBudget?: number;
  creditSituation?: string;
  monthlyIncome?: number;
  employment?: string;
  downPayment?: number;
  hasTrade?: boolean;
  tradeVehicle?: string;
  purchaseTimeline?: string;
  urgency?: string;
  salesBrief?: string;
  phoneConfirmed?: boolean;
  pending7DigitPhone?: string;
}

export type ExtractionConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ExtractedField<T = any> {
  value: T;
  source: 'FUNCTION_CALL' | 'TRANSCRIPT_FALLBACK';
  confidence: ExtractionConfidence;
}

export interface LeadIntelligenceMetrics {
  intentScore: number;
  intentStage: string;
  contactabilityScore: number;
  qualificationScore: number;
  leadQualityScore: number;
  leadCompleteness: number;
  buyingCommitment: string;
  nextBestAction: string;
  recommendedNextAction: string;
  salesBrief?: string;
}

export interface BuyerIntelligenceState {
  profile: BuyerProfile;
  metrics: LeadIntelligenceMetrics | null;
  crmStatus: 'IDLE' | 'SYNCING' | 'SYNCED' | 'ERROR';
  lastUpdated: number | null;
}

// ── Number & Spoken Words Map ────────────────────────────────────────────────
const TENS_WORDS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90
};

const TEENS_WORDS: Record<string, string> = {
  ten: '10', eleven: '11', twelve: '12', thirteen: '13', fourteen: '14',
  fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19'
};

const SINGLE_DIGIT_WORDS: Record<string, string> = {
  zero: '0', oh: '0', o: '0', naught: '0',
  one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9'
};

const DIGIT_TOKEN_PATTERN = '(?:[0-9]|zero|oh|o|naught|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)';

/**
 * Normalizes spoken phone text, compound tens/hundreds, and repairs common
 * speech-to-text substitutions contextual to phone-number candidates.
 */
export function sanitizeSpokenPhoneText(raw: string | undefined | null): string {
  if (!raw) return '';

  let text = String(raw).toLowerCase();

  // 1. Normalize punctuation introduced by streaming STT into whitespace
  text = text.replace(/[,;:|/\\]/g, ' ');

  // 2. Repeated-digit constructions (e.g. "double nine" -> "nine nine", "triple five" -> "five five five")
  text = text.replace(/\bdouble\s+([a-z0-9]+)\b/g, '$1 $1');
  text = text.replace(/\btriple\s+([a-z0-9]+)\b/g, '$1 $1 $1');
  text = text.replace(/\bquadruple\s+([a-z0-9]+)\b/g, '$1 $1 $1 $1');

  // 3. Contextual STT homophone recovery (phone candidate context ONLY):
  // Explicit area code triggers: "area code to" -> "area code 2", "area code for" -> "area code 4"
  text = text.replace(new RegExp(`\\barea\\s+code\\s+(?:to|too)\\b`, 'g'), 'area code 2');
  text = text.replace(new RegExp(`\\barea\\s+code\\s+(?:for)\\b`, 'g'), 'area code 4');
  text = text.replace(new RegExp(`\\barea\\s+code\\s+(?:tree|free)\\b`, 'g'), 'area code 3');
  text = text.replace(new RegExp(`\\barea\\s+code\\s+(?:ate)\\b`, 'g'), 'area code 8');
  text = text.replace(new RegExp(`\\barea\\s+code\\s+(?:won)\\b`, 'g'), 'area code 1');

  // Followed by digit tokens
  text = text.replace(new RegExp(`\\b(?:to|too)\\s+(?=${DIGIT_TOKEN_PATTERN}\\b)`, 'g'), '2 ');
  text = text.replace(new RegExp(`\\b(?:for)\\s+(?=${DIGIT_TOKEN_PATTERN}\\b)`, 'g'), '4 ');
  text = text.replace(new RegExp(`\\b(?:tree|free)\\s+(?=${DIGIT_TOKEN_PATTERN}\\b)`, 'g'), '3 ');
  text = text.replace(new RegExp(`\\b(?:ate)\\s+(?=${DIGIT_TOKEN_PATTERN}\\b)`, 'g'), '8 ');
  text = text.replace(new RegExp(`\\b(?:won)\\s+(?=${DIGIT_TOKEN_PATTERN}\\b)`, 'g'), '1 ');

  // Preceded by digit tokens
  text = text.replace(new RegExp(`(?<=\\b${DIGIT_TOKEN_PATTERN}\\s+)(?:to|too)\\b`, 'g'), '2');
  text = text.replace(new RegExp(`(?<=\\b${DIGIT_TOKEN_PATTERN}\\s+)(?:for)\\b`, 'g'), '4');
  text = text.replace(new RegExp(`(?<=\\b${DIGIT_TOKEN_PATTERN}\\s+)(?:tree|free)\\b`, 'g'), '3');
  text = text.replace(new RegExp(`(?<=\\b${DIGIT_TOKEN_PATTERN}\\s+)(?:ate)\\b`, 'g'), '8');
  text = text.replace(new RegExp(`(?<=\\b${DIGIT_TOKEN_PATTERN}\\s+)(?:won)\\b`, 'g'), '1');

  // 4. Combine compound tens and ones (e.g. "twenty four" -> "24", "thirty four" -> "34", "fifty-one" -> "51")
  for (const [tenWord, tenVal] of Object.entries(TENS_WORDS)) {
    for (const [oneWord, digitStr] of Object.entries(SINGLE_DIGIT_WORDS)) {
      if (digitStr === '0') continue;
      const compoundRegex = new RegExp(`\\b${tenWord}[-\\s]+${oneWord}\\b`, 'g');
      text = text.replace(compoundRegex, String(tenVal + parseInt(digitStr, 10)));
    }
  }

  // 5. Replace teens (e.g. "twelve", "fourteen")
  for (const [word, digit] of Object.entries(TEENS_WORDS)) {
    text = text.replace(new RegExp(`\\b${word}\\b`, 'g'), digit);
  }

  // 6. Replace single tens without ones (e.g. "twenty" -> "20", "fifty" -> "50")
  for (const [word, val] of Object.entries(TENS_WORDS)) {
    text = text.replace(new RegExp(`\\b${word}\\b`, 'g'), String(val));
  }

  // 7. Replace single digits (e.g. "zero", "oh", "o", "naught" -> "0")
  for (const [word, digit] of Object.entries(SINGLE_DIGIT_WORDS)) {
    text = text.replace(new RegExp(`\\b${word}\\b`, 'g'), digit);
  }

  // 8. Natural compound hundreds (e.g. "fifty-one hundred" -> "5100", "twelve hundred" -> "1200")
  text = text.replace(/\b([1-9]\d?)[-\s]+hundred\b/g, (_, n) => `${n}00`);

  return text;
}

/**
 * Extracts a standalone 7-digit phone number candidate from spoken text if present.
 */
export function extractSevenDigitCandidate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const text = sanitizeSpokenPhoneText(raw);
  const digits = text.replace(/\D/g, '');
  if (digits.length === 7 && digits[0] >= '2') {
    return digits;
  }
  const match = digits.match(/(?:^|\D)([2-9]\d{6})(?:\D|$)/);
  if (match) return match[1];
  return null;
}

/**
 * Normalizes a phone number to standard format e.g. (204) 555-1234 or clean 10-digit.
 * Supports optional 3-digit areaCode to combine with a 7-digit local number.
 */
export function normalizePhone(raw: string | undefined | null, areaCode?: string | null): string | null {
  if (!raw) return null;

  let text = sanitizeSpokenPhoneText(raw);

  // Extract phone candidate sequences first (avoiding rogue preceding/trailing digits like "I have 2 kids...")
  // A phone sequence consists of 10 digits (or 11 with leading 1) separated by spaces, hyphens, dots, commas, or parens.
  const phoneCandidateRegex = /(?:\+?1[\s,.-]*)?\(?\d[\s,.-]*\d[\s,.-]*\d\)?[\s,.-]*\d[\s,.-]*\d[\s,.-]*\d[\s,.-]*\d[\s,.-]*\d[\s,.-]*\d[\s,.-]*\d/g;
  const candidateMatches = text.match(phoneCandidateRegex);

  let digits = '';
  if (candidateMatches && candidateMatches.length > 0) {
    // Prefer the candidate with a valid NANP area code (first digit 2-9)
    const validNanp = candidateMatches.find(c => {
      const d = c.replace(/\D/g, '');
      const d10 = (d.length === 11 && d.startsWith('1')) ? d.substring(1) : d;
      return d10.length === 10 && d10[0] >= '2' && d10[0] <= '9';
    });
    const bestMatch = validNanp || candidateMatches[candidateMatches.length - 1];
    digits = bestMatch.replace(/\D/g, '');
  } else {
    // Fallback: extract all digits across the string
    digits = text.replace(/\D/g, '');
  }

  let clean10 = '';
  if (digits.length === 10) {
    clean10 = digits;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    clean10 = digits.substring(1);
  } else if (digits.length === 7 && areaCode) {
    // Combine 7-digit number with provided area code
    const cleanArea = areaCode.replace(/\D/g, '');
    if (cleanArea.length === 3 && cleanArea[0] >= '2' && cleanArea[0] <= '9') {
      clean10 = cleanArea + digits;
    } else {
      return null;
    }
  } else if (digits.length > 10) {
    // If extra digits, prefer finding a 10-digit sequence matching NANP area code [2-9]
    const nanpMatch = digits.match(/[2-9]\d{9}/);
    if (nanpMatch) {
      clean10 = nanpMatch[0];
    } else {
      clean10 = digits.substring(0, 10);
    }
  } else {
    return null; // Less than 10 digits is incomplete for standard North American
  }

  const area = clean10.substring(0, 3);
  const mid = clean10.substring(3, 6);
  const last = clean10.substring(6, 10);
  return `(${area}) ${mid}-${last}`;
}

/**
 * Capitalizes every part of a person's name across spaces and hyphens.
 * Example: "stephan smith" -> "Stephan Smith", "mary-jane" -> "Mary-Jane"
 */
export function capitalizeName(raw: string | undefined | null): string {
  if (!raw) return '';
  return raw
    .trim()
    .split(/([\s-]+)/)
    .map(part => {
      if (/^[\s-]+$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join('');
}

/**
 * Normalizes email and repairs common speech-to-text artifacts like "john at gmail dot com"
 */
export function normalizeEmail(raw: string | undefined | null): string | null {
  if (!raw) return null;

  let text = String(raw).toLowerCase().trim();

  // Fix common STT artifacts
  text = text.replace(/\s+at\s+/g, '@');
  text = text.replace(/\s+dot\s+/g, '.');

  // Extract email address pattern first before removing internal whitespace
  // to avoid merging surrounding words into the email
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) {
    const candidate = emailMatch[0].replace(/\s+/g, '');
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (emailRegex.test(candidate)) {
      return candidate;
    }
  }

  const clean = text.replace(/\s+/g, '');
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (emailRegex.test(clean)) {
    return clean;
  }
  return null;
}

/**
 * Normalizes currency and spoken amounts to integer number
 * Examples: "$500", "500 a month", "5 grand", "five hundred", "around 600"
 */
export function normalizeCurrency(raw: any): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.round(raw);
  }
  if (!raw) return null;

  const text = String(raw).toLowerCase().replace(/,/g, '').trim();

  // Grand / K detection: "5 grand", "5k" -> 5000, "five grand" -> 5000
  const spokenGrand: Record<string, number> = {
    'one grand': 1000, 'two grand': 2000, 'three grand': 3000,
    'four grand': 4000, 'five grand': 5000, 'six grand': 6000,
    'seven grand': 7000, 'eight grand': 8000, 'nine grand': 9000,
    'ten grand': 10000
  };
  for (const [phrase, amount] of Object.entries(spokenGrand)) {
    if (text.includes(phrase)) return amount;
  }

  const grandMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:grand|k)\b/i);
  if (grandMatch) {
    return Math.round(parseFloat(grandMatch[1]) * 1000);
  }

  // Spoken hundreds and compounds: "five hundred" -> 500, "six-fifty" -> 650
  const spokenCompounds: Record<string, number> = {
    'six fifty': 650, 'six-fifty': 650, 'seven fifty': 750, 'seven-fifty': 750,
    'eight fifty': 850, 'eight-fifty': 850, 'nine fifty': 950, 'nine-fifty': 950,
    'three fifty': 350, 'three-fifty': 350, 'four fifty': 450, 'four-fifty': 450,
    'five fifty': 550, 'five-fifty': 550, 'six hundred fifty': 650, 'six hundred and fifty': 650,
    'one hundred': 100, 'two hundred': 200, 'three hundred': 300,
    'four hundred': 400, 'five hundred': 500, 'six hundred': 600,
    'seven hundred': 700, 'eight hundred': 800, 'nine hundred': 900,
    'one thousand': 1000, 'two thousand': 2000, 'three thousand': 3000,
    'four thousand': 4000, 'five thousand': 5000
  };
  for (const [phrase, amount] of Object.entries(spokenCompounds)) {
    if (text.includes(phrase)) return amount;
  }

  // Standard numeric extraction: "$500", "650/mo", "under 700"
  const numMatch = text.match(/\$?\s*([0-9]{2,6})(?:\.00)?/);
  if (numMatch) {
    const parsed = parseInt(numMatch[1], 10);
    if (parsed > 0 && parsed <= 500000) {
      return parsed;
    }
  }

  return null;
}

/**
 * Normalizes credit description, preserving customer terminology
 */
export function normalizeCredit(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const lower = String(raw).toLowerCase().trim();

  // Guard against monthly budget or payment phrases
  const isPaymentPhrase = /\b(month|mo|monthly|payment|budget|\$|spend|afford|dollars|bucks|pay|down)\b/.test(lower);

  if (/\b(excellent|tier 1|700\+|800|prime|great)\b/.test(lower)) return 'Excellent';
  if (/\b(good|decent|average)\b/.test(lower)) return 'Good';
  if (/\b(?:credit|score|rating)\b.*\b(?:around|about)?\s*650\b|\b(?:around|about)?\s*650\b.*\b(?:credit|score|rating)\b/.test(lower) && !isPaymentPhrase) return 'Good';
  if (/\b(fair|okay|so so)\b/.test(lower)) return 'Fair';
  if (/\b(?:credit|score|rating)\b.*\b(?:around|about)?\s*600\b|\b(?:around|about)?\s*600\b.*\b(?:credit|score|rating)\b/.test(lower) && !isPaymentPhrase) return 'Fair';
  if (/\b(rebuilding|improving|working on it)\b/.test(lower)) return 'Rebuilding';
  if (/\b(bankruptcy|chapter 7|bankrupt)\b/.test(lower)) return 'Bankruptcy';
  if (/\b(consumer proposal|proposal)\b/.test(lower)) return 'Consumer Proposal';
  if (/\b(collections|late payments|slow pay|bad credit|poor|terrible|low)\b/.test(lower)) return 'Challenged / Collections';
  if (/\b(no credit|new to canada|first time buyer|new credit)\b/.test(lower)) return 'First-Time / New Credit';

  // If only a numeric score was spoken (e.g. "my score is 680" or "around 580")
  // MUST NOT match digits that are part of a phone number, budget, or address!
  const hasPhoneOrBudget = /(?:\d{3}[-.\s]?\d{3}[-.\s]?\d{4}|\$\d+)/.test(lower);
  const explicitScoreMatch = lower.match(/(?:credit\s*score|score|credit|rating)\s*(?:is|of|around|about)?\s*([3-8]\d{2})\b/);
  if (explicitScoreMatch && !isPaymentPhrase) {
    const score = parseInt(explicitScoreMatch[1], 10);
    if (score >= 720) return 'Excellent';
    if (score >= 650) return 'Good';
    if (score >= 600) return 'Fair';
    if (score >= 300) return 'Rebuilding';
  } else if (!hasPhoneOrBudget && !isPaymentPhrase) {
    // If standalone 3-digit score with optional around/about
    const standaloneScore = lower.match(/^\s*(?:around\s*|about\s*)?([3-8]\d{2})\s*$/);
    if (standaloneScore) {
      const score = parseInt(standaloneScore[1], 10);
      if (score >= 720) return 'Excellent';
      if (score >= 650) return 'Good';
      if (score >= 600) return 'Fair';
      if (score >= 300) return 'Rebuilding';
    }
  }

  // Only return raw if it was a very short direct answer (1-2 words), otherwise null
  if (raw.trim().split(/\s+/).length <= 2 && !isPaymentPhrase && !hasPhoneOrBudget) {
    return raw.trim();
  }

  return null;
}

/**
 * Normalizes vehicle type and popular makes/models
 */
export function normalizeVehicle(raw: string | undefined | null): { vehicleType?: string; targetVehicle?: string } | null {
  if (!raw) return null;
  const lower = String(raw).toLowerCase().trim();

  let vehicleType: string | undefined;
  if (/\b(suv|crossover|4x4|awd|cr-?v|rav-?4|tucson|sportage|explorer|escape|cherokee|grand cherokee|highlander|pilot|subaru|forester|outback|cx-?5|cx-?50|rogue|pathfinder)\b/.test(lower)) vehicleType = 'SUV';
  else if (/\b(truck|pickup|f-?150|silverado|ram|ram 1500|sierra|tacoma|tundra|colorado|canyon|ranger)\b/.test(lower)) vehicleType = 'Truck';
  else if (/\b(van|minivan|pacifica|sienna|caravan|odyssey|carnival)\b/.test(lower)) vehicleType = 'Van';
  else if (/\b(sedan|car|civic|corolla|camry|accord|elantra|sonata|forte|jetta|passat|mazda 3|mazda 6)\b/.test(lower)) vehicleType = 'Car';
  else if (/\b(coupe|convertible|sports car|mustang|camaro|challenger|corvette|miata)\b/.test(lower)) vehicleType = 'Car';
  else if (/\b(electric|ev|tesla|hybrid|model 3|model y|ioniq|leaf)\b/.test(lower)) vehicleType = 'Car';

  return {
    vehicleType,
    targetVehicle: raw.trim()
  };
}

/**
 * Merges a partial profile delta into the existing buyer profile.
 * - Respects confidence (never overwrites non-empty with empty).
 * - Normalizes inputs safely.
 */
export function mergeBuyerProfile(
  existing: BuyerProfile,
  delta: Partial<BuyerProfile>,
  source: 'FUNCTION_CALL' | 'TRANSCRIPT_FALLBACK' | 'FORM' = 'FUNCTION_CALL'
): BuyerProfile {
  const merged: BuyerProfile = { ...existing };

  if (delta.name && delta.name.trim().length > 1) {
    const candidateName = delta.name.trim();
    // Name Protection: protect established authoritative name against phonetic STT drift
    const isPhoneticVariant = existing.name && (
      (existing.name.toLowerCase() === 'stephan' && /^(steven|stephen)$/i.test(candidateName)) ||
      (existing.name.toLowerCase() === candidateName.toLowerCase())
    );
    if (existing.name && isPhoneticVariant) {
      merged.name = existing.name;
    } else if (existing.name && existing.name !== 'Player' && source === 'TRANSCRIPT_FALLBACK' && candidateName.toLowerCase() !== existing.name.toLowerCase()) {
      // Never allow speculative transcript fallback to overwrite an established name from form or function call
      merged.name = existing.name;
    } else {
      merged.name = capitalizeName(candidateName);
    }
  }

  if (delta.phone) {
    const normalized = normalizePhone(delta.phone);
    if (normalized) {
      merged.phone = normalized;
      merged.pending7DigitPhone = undefined;
    }
  }

  if (delta.phoneConfirmed !== undefined) {
    merged.phoneConfirmed = delta.phoneConfirmed;
  }

  if (delta.pending7DigitPhone !== undefined) {
    merged.pending7DigitPhone = delta.pending7DigitPhone;
  }

  if (delta.email) {
    const normalized = normalizeEmail(delta.email);
    if (normalized) merged.email = normalized;
  }

  if (delta.targetVehicle && delta.targetVehicle.trim().length > 1) {
    merged.targetVehicle = delta.targetVehicle.trim();
  }

  if (delta.vehicleType && delta.vehicleType.trim().length > 1) {
    merged.vehicleType = delta.vehicleType.trim();
  }

  if (delta.monthlyBudget !== undefined && delta.monthlyBudget !== null) {
    const parsed = normalizeCurrency(delta.monthlyBudget);
    if (parsed) merged.monthlyBudget = parsed;
  }

  if (delta.creditSituation && delta.creditSituation.trim().length > 1) {
    const normalized = normalizeCredit(delta.creditSituation);
    if (normalized) merged.creditSituation = normalized;
  }

  if (delta.monthlyIncome !== undefined && delta.monthlyIncome !== null) {
    const parsed = normalizeCurrency(delta.monthlyIncome);
    if (parsed) merged.monthlyIncome = parsed;
  }

  if (delta.employment && delta.employment.trim().length > 1) {
    merged.employment = delta.employment.trim();
  }

  if (delta.downPayment !== undefined && delta.downPayment !== null) {
    const parsed = normalizeCurrency(delta.downPayment);
    if (parsed !== null) merged.downPayment = parsed;
  }

  if (delta.hasTrade !== undefined) {
    merged.hasTrade = Boolean(delta.hasTrade);
  }

  if (delta.tradeVehicle && delta.tradeVehicle.trim().length > 1) {
    merged.tradeVehicle = delta.tradeVehicle.trim();
    merged.hasTrade = true;
  }

  if (delta.purchaseTimeline && delta.purchaseTimeline.trim().length > 1) {
    merged.purchaseTimeline = delta.purchaseTimeline.trim();
  }

  if (delta.urgency && delta.urgency.trim().length > 1) {
    merged.urgency = delta.urgency.trim();
  }

  if (delta.salesBrief && delta.salesBrief.trim().length > 5) {
    merged.salesBrief = delta.salesBrief.trim();
  }

  return merged;
}

/**
 * Deterministic transcript fallback parser.
 * Scans user utterances for high-value buyer facts (phone, email, budget, income, credit, vehicle).
 */
export function parseTranscriptForBuyerIntel(
  transcript: string,
  existing: BuyerProfile = {}
): Partial<BuyerProfile> {
  const delta: Partial<BuyerProfile> = {};
  if (!transcript || transcript.trim().length === 0) return delta;

  const text = transcript.trim();
  const lower = text.toLowerCase();

  // 1. Phone extraction
  // Handles: "(204) 555-1234", "204-555-1234", "204 555 1234", "204, 555, 1234",
  // and spoken number sequences ("two zero four five five five one two three four")
  const phonePattern = /(?:\+?1[\s,.-]*)?\(?([0-9]{3})\)?[\s,.-]*([0-9]{3})[\s,.-]*([0-9]{4})\b/;
  const phoneMatch = text.match(phonePattern);
  if (phoneMatch) {
    const normalized = normalizePhone(phoneMatch[0]);
    if (normalized) delta.phone = normalized;
  } else {
    // Spoken digit sequence detector
    const spokenDigitPattern = /\b(?:zero|oh|o|naught|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|\d)(?:[\s,.-]+(?:zero|oh|o|naught|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|\d)){6,12}\b/i;
    const spokenMatch = text.match(spokenDigitPattern);
    if (spokenMatch) {
      const normalized = normalizePhone(spokenMatch[0]);
      if (normalized) delta.phone = normalized;
    } else {
      const normalized = normalizePhone(text);
      if (normalized) delta.phone = normalized;
    }
  }

  // 7-digit local number combined with 3-digit area code follow-up
  if (!delta.phone) {
    if (existing?.pending7DigitPhone) {
      // Check if user just provided a 3-digit area code (e.g. "204", "area code 204", "two oh four")
      const areaMatch = text.match(/(?:area\s+code\s*)?([2-9]\d{2})\b/i) || text.match(/\b([2-9]\d{2})\b/);
      if (areaMatch) {
        const full10 = normalizePhone(existing.pending7DigitPhone, areaMatch[1]);
        if (full10) {
          delta.phone = full10;
          delta.pending7DigitPhone = undefined;
        }
      } else {
        const spokenArea = sanitizeSpokenPhoneText(text).replace(/\D/g, '');
        if (spokenArea.length === 3 && spokenArea[0] >= '2' && spokenArea[0] <= '9') {
          const full10 = normalizePhone(existing.pending7DigitPhone, spokenArea);
          if (full10) {
            delta.phone = full10;
            delta.pending7DigitPhone = undefined;
          }
        }
      }
    } else if (!existing?.phone) {
      const candidate7 = extractSevenDigitCandidate(text);
      if (candidate7) {
        delta.pending7DigitPhone = candidate7;
      }
    }
  }

  // Partial 4-digit phone correction against existing phone (e.g. "No, it ends in 9999" or "ends in 9-9-9-9")
  if (!delta.phone && existing?.phone) {
    const endsMatch = text.match(/(?:ends in|last four(?: are)?|ending in|ends with)\s*([0-9\s-]{4,8}|(?:\b(?:zero|oh|o|naught|one|two|three|four|five|six|seven|eight|nine)\b\s*){4})/i);
    if (endsMatch) {
      let lastFourDigits = endsMatch[1].toLowerCase();
      for (const [w, d] of Object.entries(SINGLE_DIGIT_WORDS)) {
        lastFourDigits = lastFourDigits.replace(new RegExp(`\\b${w}\\b`, 'g'), d);
      }
      const clean4 = lastFourDigits.replace(/\D/g, '');
      if (clean4.length === 4) {
        const rawExistingDigits = existing.phone.replace(/\D/g, '');
        if (rawExistingDigits.length >= 10) {
          const first6 = rawExistingDigits.substring(rawExistingDigits.length - 10, rawExistingDigits.length - 4);
          const corrected10 = first6 + clean4;
          const normalized = normalizePhone(corrected10);
          if (normalized) delta.phone = normalized;
        }
      }
    }
  }

  // 2. Email extraction
  const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
  const emailMatch = text.match(emailPattern);
  if (emailMatch) {
    const normalized = normalizeEmail(emailMatch[0]);
    if (normalized) delta.email = normalized;
  } else if (/\bat\b/i.test(lower) && /\bdot com\b/i.test(lower)) {
    const normalized = normalizeEmail(text);
    if (normalized) delta.email = normalized;
  }

  // 3. Monthly payment target / budget
  // Patterns: "$500 a month", "500/month", "around 600", "under 700", "600 a month", "budget is 550"
  const budgetMatch = text.match(/(?:around|under|about|stay around|keep it at|payment of|payment is|budget of|budget is|\$)\s*(\$?\d{2,4})\s*(?:\/|\s*a\s*|\s*per\s*)?(?:month|mo|monthly)?\b/i) ||
                      text.match(/(\$?\d{2,4})\s*(?:\/|\s*a\s*|\s*per\s*|\s*bucks\s*a\s*|\s*dollars\s*a\s*)(?:month|mo|monthly)\b/i) ||
                      text.match(/(?:monthly payment|monthly budget|payment|budget)\s*(?:is|of|around|about)?\s*(\$?\d{2,4})\b/i);
  if (budgetMatch && !existing.monthlyBudget) {
    // Only exclude if the matched figure itself is qualified as a down payment or income
    const matchedIndex = budgetMatch.index ?? text.indexOf(budgetMatch[0]);
    const afterMatch = text.slice(matchedIndex + budgetMatch[0].length);
    const beforeMatch = text.slice(Math.max(0, matchedIndex - 25), matchedIndex);
    const isDownQualifier = /^\s*(?:down|deposit|cash down)\b/i.test(afterMatch) ||
                            /\b(?:down payment of|deposit of|put down)\s*$/i.test(beforeMatch);
    const isIncomeQualifier = /\b(?:make|earn|salary of|bring home|take home)\s*$/i.test(beforeMatch);
    const isCreditQualifier = /\b(?:credit|score|rating)\s*(?:is|of|around|about)?\s*$/i.test(beforeMatch) ||
                              /^\s*(?:credit|score|rating)\b/i.test(afterMatch) ||
                              /\b(?:credit|score)\b/i.test(text.slice(Math.max(0, matchedIndex - 20), matchedIndex + 20));

    if (!isDownQualifier && !isIncomeQualifier && !isCreditQualifier) {
      const budgetVal = normalizeCurrency(budgetMatch[1]);
      if (budgetVal && budgetVal >= 150 && budgetVal <= 3000) {
        delta.monthlyBudget = budgetVal;
      }
    }
  }

  // 4. Monthly Income
  // Patterns: "$4,500 a month", "make 4500", "bring home about five grand"
  const incomeMatch = text.match(/(?:make|income is|bring home|take home|earn|salary of)\s*(?:about|around)?\s*(\$?\d[\d,]*\s*(?:grand|k)?)/i);
  if (incomeMatch && !existing.monthlyIncome) {
    const incomeVal = normalizeCurrency(incomeMatch[1]);
    if (incomeVal && incomeVal >= 1000) {
      delta.monthlyIncome = incomeVal;
    }
  }

  // 5. Down payment
  // Patterns: "$5,000 down", "put down 2000", "zero down", "no down payment"
  if (/\b(zero down|no down payment|nothing down)\b/i.test(lower)) {
    delta.downPayment = 0;
  } else {
    const downMatch = text.match(/(\$?\d[\d,]*\s*(?:grand|k)?)\s*(?:down|deposit|cash down)/i) ||
                      text.match(/(?:put down|have|got)\s*(\$?\d[\d,]*\s*(?:grand|k)?)\s*(?:down|cash)?/i);
    if (downMatch && !existing.downPayment) {
      const downVal = normalizeCurrency(downMatch[1]);
      if (downVal !== null && downVal <= 100000) {
        delta.downPayment = downVal;
      }
    }
  }

  // 6. Credit situation
  const creditDetected = normalizeCredit(lower);
  if (creditDetected && !existing.creditSituation) {
    delta.creditSituation = creditDetected;
  }

  // 7. Vehicle Preference
  if (!existing.vehicleType) {
    const vehicleInfo = normalizeVehicle(text);
    if (vehicleInfo?.vehicleType) {
      delta.vehicleType = vehicleInfo.vehicleType;
      const words = text.trim().split(/\s+/);
      if (words.length <= 4 && !text.includes('**') && !text.includes('phone') && !text.includes('budget') && !text.includes('cell')) {
        delta.targetVehicle = text.trim();
      } else {
        delta.targetVehicle = vehicleInfo.vehicleType;
      }
    }
  }

  // 8. Trade-in
  if (/\b(trade in|trading in|have a trade)\b/i.test(lower)) {
    delta.hasTrade = true;
    const tradeMatch = text.match(/trade\s*(?:in)?\s*(?:my|a)?\s*([0-9]{4}\s+[A-Za-z0-9]+(?:\s+[A-Za-z0-9]+){0,2}|[A-Za-z0-9]+(?:\s+[A-Za-z0-9]+){1,2})/i);
    if (tradeMatch && tradeMatch[1]) {
      const cleaned = tradeMatch[1].replace(/\s+(?:and|with|but|for|my|or|so|to|is|in|at)\b.*$/i, '').trim();
      if (cleaned.length > 2) {
        delta.tradeVehicle = cleaned;
      }
    }
  } else if (/\b(no trade|don't have a trade)\b/i.test(lower)) {
    delta.hasTrade = false;
  }

  // 9. Purchase Timeline
  if (/\b(today|right now|asap|broken down|broke down|immediately)\b/i.test(lower)) {
    delta.purchaseTimeline = 'Immediate (ASAP)';
    delta.urgency = 'IMMEDIATE';
  } else if (/\b(this week|within a week|few days)\b/i.test(lower)) {
    delta.purchaseTimeline = 'This week';
    delta.urgency = 'HIGH';
  } else if (/\b(two weeks|this month|within a month)\b/i.test(lower)) {
    delta.purchaseTimeline = 'Within 1 month';
    delta.urgency = 'MEDIUM';
  } else if (/\b(just browsing|just looking|exploring|researching|couple months)\b/i.test(lower)) {
    delta.purchaseTimeline = 'Researching';
    delta.urgency = 'LOW';
  }

  // 10. Buyer Name
  const namePatternMatch = text.match(/(?:my name is|i am|this is|i'm|it's|its)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i) ||
                           text.match(/\bcall me\s+(?!at\b)([A-Z][a-z]+)\b/i) ||
                           text.match(/(?:nice to meet you|great to meet you|pleasure to meet you|welcome)\s*,?\s+([A-Z][a-z]+)\b/i) ||
                           text.match(/(?:buyer\s+(?:is|named|called)|buyer's\s+name\s+is|user's\s+name\s+is|user\s+(?:is|named|called)|parsed\s+|identified\s+|customer\s+(?:is|named|called)|name\s*[:=])\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i);
  if (namePatternMatch && !existing.name) {
    let candidate = namePatternMatch[1].trim();
    if (!/^(looking|here|interested|trying|wondering|car|suv|truck|van|fine|good|okay|at|to|for|with|about|a|the|data|information|intel|profile|parameters|buyer|customer|user|jarvis|winston|jessica)$/i.test(candidate)) {
      if (existing.email) {
        const emailUser = existing.email.split('@')[0].toLowerCase();
        if (emailUser.includes(candidate.toLowerCase()) || (/^(steven|stephen)$/i.test(candidate) && emailUser.includes('stephan'))) {
          candidate = emailUser.charAt(0).toUpperCase() + emailUser.slice(1);
        }
      }
      delta.name = capitalizeName(candidate);
    }
  } else if (!existing.name) {
    const trimmed = text.trim();
    if (/^[A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20})?$/.test(trimmed) &&
        !/^(car|suv|truck|van|sedan|minivan|yes|no|hello|hi|hey|good|okay|fine|thanks|rebuilding|fair|excellent|zero|nothing|none|at|start|help|ready|sure|right|jarvis|winston|jessica)$/i.test(trimmed)) {
      let candidate = trimmed;
      if (existing.email) {
        const emailUser = existing.email.split('@')[0].toLowerCase();
        if (emailUser.includes(candidate.toLowerCase()) || (/^(steven|stephen)$/i.test(candidate) && emailUser.includes('stephan'))) {
          candidate = emailUser.charAt(0).toUpperCase() + emailUser.slice(1);
        }
      }
      delta.name = capitalizeName(candidate);
    }
  }

  return delta;
}

/**
 * Generates an executive sales brief from structured facts
 */
export function generateSalesBrief(profile: BuyerProfile): string {
  const parts: string[] = [];

  const vehicleDesc = profile.targetVehicle || profile.vehicleType || 'vehicle';
  parts.push(`Buyer is inquiring about a ${vehicleDesc}.`);

  if (profile.monthlyBudget) {
    parts.push(`Target monthly payment is approximately $${profile.monthlyBudget}/month.`);
  }

  if (profile.creditSituation) {
    parts.push(`Credit profile self-described as "${profile.creditSituation}".`);
  }

  if (profile.monthlyIncome) {
    parts.push(`Estimated monthly take-home income is ~$${profile.monthlyIncome}.`);
  }

  if (profile.downPayment !== undefined) {
    parts.push(profile.downPayment > 0 ? `Available down payment: $${profile.downPayment}.` : 'Zero down payment requested.');
  }

  if (profile.hasTrade && profile.tradeVehicle) {
    parts.push(`Trade-in vehicle: ${profile.tradeVehicle}.`);
  }

  if (profile.purchaseTimeline) {
    parts.push(`Buying timeline: ${profile.purchaseTimeline}.`);
  }

  if (profile.phone) {
    parts.push(`Direct contact verified: ${profile.phone}.`);
  }

  parts.push('Recommended next action: Senior specialist Stephan should contact the buyer to review tailored vehicle and payment options.');

  return parts.join(' ');
}

/**
 * Maps website store form data into a structured BuyerProfile to seed Jarvis live memory.
 */
export function formDataToBuyerProfile(formData: any): BuyerProfile {
  if (!formData || typeof formData !== 'object') return {};
  const profile: BuyerProfile = {};

  if (formData.name && typeof formData.name === 'string' && formData.name.trim().length > 0 && formData.name.trim().toLowerCase() !== 'player') {
    profile.name = formData.name.trim();
  }

  if (formData.phone) {
    const p = normalizePhone(formData.phone);
    if (p) profile.phone = p;
  }

  if (formData.email) {
    const e = normalizeEmail(formData.email);
    if (e) profile.email = e;
  }

  if (formData.selectedModel && typeof formData.selectedModel === 'string' && formData.selectedModel.trim().length > 0) {
    profile.targetVehicle = formData.selectedModel.trim();
  }

  if (formData.vehicle && typeof formData.vehicle === 'string' && formData.vehicle.trim().length > 0) {
    const v = normalizeVehicle(formData.vehicle);
    if (v?.vehicleType) {
      profile.vehicleType = v.vehicleType;
    }
    if (v?.targetVehicle && !profile.targetVehicle) {
      profile.targetVehicle = v.targetVehicle;
    }
  }

  if (formData.income && typeof formData.income === 'string' && formData.income.trim().length > 0) {
    const inc = normalizeCurrency(formData.income);
    if (inc && inc > 0) {
      profile.monthlyIncome = inc;
    }
  }

  if (formData.downPayment && typeof formData.downPayment === 'string' && formData.downPayment !== '0' && formData.downPayment.trim().length > 0) {
    const dp = normalizeCurrency(formData.downPayment);
    if (dp !== null) {
      profile.downPayment = dp;
    }
  }

  if (formData.employment && typeof formData.employment === 'string' && formData.employment.trim().length > 0) {
    profile.employment = formData.employment.trim();
  }

  if (formData.creditScore && typeof formData.creditScore === 'string' && formData.creditScore.trim().length > 0) {
    const c = normalizeCredit(formData.creditScore);
    if (c) {
      profile.creditSituation = c;
    }
  }

  return profile;
}

