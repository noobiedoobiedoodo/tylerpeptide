/**
 * server_routes/voiceLeadExtractor.ts
 * 
 * Shared lead extraction and normalization utilities for backend voice lead sync.
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

export function sanitizeSpokenPhoneText(raw: string | undefined | null): string {
  if (!raw) return '';

  let text = String(raw).toLowerCase();

  // 1. Punctuation to whitespace
  text = text.replace(/[,;:|/\\]/g, ' ');

  // 2. Repeated digits
  text = text.replace(/\bdouble\s+([a-z0-9]+)\b/g, '$1 $1');
  text = text.replace(/\btriple\s+([a-z0-9]+)\b/g, '$1 $1 $1');
  text = text.replace(/\bquadruple\s+([a-z0-9]+)\b/g, '$1 $1 $1 $1');

  // 3. Homophone recovery
  text = text.replace(new RegExp(`\\barea\\s+code\\s+(?:to|too)\\b`, 'g'), 'area code 2');
  text = text.replace(new RegExp(`\\barea\\s+code\\s+(?:for)\\b`, 'g'), 'area code 4');
  text = text.replace(new RegExp(`\\barea\\s+code\\s+(?:tree|free)\\b`, 'g'), 'area code 3');
  text = text.replace(new RegExp(`\\barea\\s+code\\s+(?:ate)\\b`, 'g'), 'area code 8');
  text = text.replace(new RegExp(`\\barea\\s+code\\s+(?:won)\\b`, 'g'), 'area code 1');

  text = text.replace(new RegExp(`\\b(?:to|too)\\s+(?=${DIGIT_TOKEN_PATTERN}\\b)`, 'g'), '2 ');
  text = text.replace(new RegExp(`\\b(?:for)\\s+(?=${DIGIT_TOKEN_PATTERN}\\b)`, 'g'), '4 ');
  text = text.replace(new RegExp(`\\b(?:tree|free)\\s+(?=${DIGIT_TOKEN_PATTERN}\\b)`, 'g'), '3 ');
  text = text.replace(new RegExp(`\\b(?:ate)\\s+(?=${DIGIT_TOKEN_PATTERN}\\b)`, 'g'), '8 ');
  text = text.replace(new RegExp(`\\b(?:won)\\s+(?=${DIGIT_TOKEN_PATTERN}\\b)`, 'g'), '1 ');

  text = text.replace(new RegExp(`(?<=\\b${DIGIT_TOKEN_PATTERN}\\s+)(?:to|too)\\b`, 'g'), '2');
  text = text.replace(new RegExp(`(?<=\\b${DIGIT_TOKEN_PATTERN}\\s+)(?:for)\\b`, 'g'), '4');
  text = text.replace(new RegExp(`(?<=\\b${DIGIT_TOKEN_PATTERN}\\s+)(?:tree|free)\\b`, 'g'), '3');
  text = text.replace(new RegExp(`(?<=\\b${DIGIT_TOKEN_PATTERN}\\s+)(?:ate)\\b`, 'g'), '8');
  text = text.replace(new RegExp(`(?<=\\b${DIGIT_TOKEN_PATTERN}\\s+)(?:won)\\b`, 'g'), '1');

  // 4. Compound tens and ones
  for (const [tenWord, tenVal] of Object.entries(TENS_WORDS)) {
    for (const [oneWord, digitStr] of Object.entries(SINGLE_DIGIT_WORDS)) {
      if (digitStr === '0') continue;
      const compoundRegex = new RegExp(`\\b${tenWord}[-\\s]+${oneWord}\\b`, 'g');
      text = text.replace(compoundRegex, String(tenVal + parseInt(digitStr, 10)));
    }
  }

  // 5. Teens
  for (const [word, digit] of Object.entries(TEENS_WORDS)) {
    text = text.replace(new RegExp(`\\b${word}\\b`, 'g'), digit);
  }

  // 6. Single tens
  for (const [word, val] of Object.entries(TENS_WORDS)) {
    text = text.replace(new RegExp(`\\b${word}\\b`, 'g'), String(val));
  }

  // 7. Single digits
  for (const [word, digit] of Object.entries(SINGLE_DIGIT_WORDS)) {
    text = text.replace(new RegExp(`\\b${word}\\b`, 'g'), digit);
  }

  // 8. Hundreds
  text = text.replace(/\b([1-9]\d?)[-\s]+hundred\b/g, (_, n) => `${n}00`);

  return text;
}

export function normalizePhone(raw: string | undefined | null, areaCode?: string | null): string | null {
  if (!raw) return null;
  let text = sanitizeSpokenPhoneText(raw);

  const phoneCandidateRegex = /(?:\+?1[\s,.-]*)?\(?\d[\s,.-]*\d[\s,.-]*\d\)?[\s,.-]*\d[\s,.-]*\d[\s,.-]*\d[\s,.-]*\d[\s,.-]*\d[\s,.-]*\d[\s,.-]*\d/g;
  const candidateMatches = text.match(phoneCandidateRegex);

  let digits = '';
  if (candidateMatches && candidateMatches.length > 0) {
    const validNanp = candidateMatches.find(c => {
      const d = c.replace(/\D/g, '');
      const d10 = (d.length === 11 && d.startsWith('1')) ? d.substring(1) : d;
      return d10.length === 10 && d10[0] >= '2' && d10[0] <= '9';
    });
    const bestMatch = validNanp || candidateMatches[candidateMatches.length - 1];
    digits = bestMatch.replace(/\D/g, '');
  } else {
    digits = text.replace(/\D/g, '');
  }

  let clean10 = '';
  if (digits.length === 10) {
    clean10 = digits;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    clean10 = digits.substring(1);
  } else if (digits.length === 7 && areaCode) {
    const cleanArea = areaCode.replace(/\D/g, '');
    if (cleanArea.length === 3 && cleanArea[0] >= '2' && cleanArea[0] <= '9') {
      clean10 = cleanArea + digits;
    } else {
      return null;
    }
  } else if (digits.length > 10) {
    const nanpMatch = digits.match(/[2-9]\d{9}/);
    if (nanpMatch) {
      clean10 = nanpMatch[0];
    } else {
      clean10 = digits.substring(0, 10);
    }
  } else {
    return null;
  }

  const area = clean10.substring(0, 3);
  const mid = clean10.substring(3, 6);
  const last = clean10.substring(6, 10);
  return `(${area}) ${mid}-${last}`;
}

export function normalizeEmail(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let text = String(raw).toLowerCase().trim();
  text = text.replace(/\s+at\s+/g, '@');
  text = text.replace(/\s+dot\s+/g, '.');
  text = text.replace(/\s+/g, '');
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (emailRegex.test(text)) {
    return text;
  }
  return null;
}

export function normalizeCurrency(raw: any): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.round(raw);
  }
  if (!raw) return null;
  const text = String(raw).toLowerCase().replace(/,/g, '').trim();
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
  const numMatch = text.match(/\$?\s*([0-9]{2,6})(?:\.00)?/);
  if (numMatch) {
    const parsed = parseInt(numMatch[1], 10);
    if (parsed > 0 && parsed <= 500000) {
      return parsed;
    }
  }
  return null;
}

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
  const hasPhoneOrBudget = /(?:\d{3}[-.\s]?\d{3}[-.\s]?\d{4}|\$\d+)/.test(lower);
  const explicitScoreMatch = lower.match(/(?:credit\s*score|score|credit|rating)\s*(?:is|of|around|about)?\s*([3-8]\d{2})\b/);
  if (explicitScoreMatch && !isPaymentPhrase) {
    const score = parseInt(explicitScoreMatch[1], 10);
    if (score >= 720) return 'Excellent';
    if (score >= 650) return 'Good';
    if (score >= 600) return 'Fair';
    if (score >= 300) return 'Rebuilding';
  } else if (!hasPhoneOrBudget && !isPaymentPhrase) {
    const standaloneScore = lower.match(/^\s*(?:around\s*|about\s*)?([3-8]\d{2})\s*$/);
    if (standaloneScore) {
      const score = parseInt(standaloneScore[1], 10);
      if (score >= 720) return 'Excellent';
      if (score >= 650) return 'Good';
      if (score >= 600) return 'Fair';
      if (score >= 300) return 'Rebuilding';
    }
  }

  if (raw.trim().split(/\s+/).length <= 2 && !isPaymentPhrase && !hasPhoneOrBudget) {
    return raw.trim();
  }
  return null;
}

export function normalizeVehicle(raw: string | undefined | null): { vehicleType?: string; targetVehicle?: string } | null {
  if (!raw) return null;
  const lower = String(raw).toLowerCase().trim();
  let vehicleType: string | undefined;
  if (/\b(suv|crossover|4x4|awd|cr-?v|rav-?4|tucson|sportage|explorer|escape|cherokee|grand cherokee|highlander|pilot|subaru|forester|outback|cx-?5|cx-?50|rogue|pathfinder)\b/.test(lower)) vehicleType = 'SUV';
  else if (/\b(truck|pickup|f-?150|silverado|ram|ram 1500|sierra|tacoma|tundra|colorado|canyon|ranger)\b/.test(lower)) vehicleType = 'Truck';
  else if (/\b(sedan|car|civic|corolla|camry|accord|elantra|sonata|forte|jetta|passat|mazda 3|mazda 6)\b/.test(lower)) vehicleType = 'Car';
  else if (/\b(minivan|van|pacifica|sienna|caravan|odyssey|carnival)\b/.test(lower)) vehicleType = 'Van';
  else if (/\b(coupe|convertible|sports car|mustang|camaro|challenger|corvette|miata)\b/.test(lower)) vehicleType = 'Car';
  else if (/\b(electric|ev|tesla|hybrid|model 3|model y|ioniq|leaf)\b/.test(lower)) vehicleType = 'Car';

  return {
    vehicleType,
    targetVehicle: raw.trim()
  };
}

export function mergeBuyerProfile(
  existing: BuyerProfile,
  delta: Partial<BuyerProfile>
): BuyerProfile {
  const merged: BuyerProfile = { ...existing };
  if (delta.name && delta.name.trim().length > 1) merged.name = delta.name.trim();
  if (delta.phone) {
    const normalized = normalizePhone(delta.phone);
    if (normalized) merged.phone = normalized;
  }
  if (delta.email) {
    const normalized = normalizeEmail(delta.email);
    if (normalized) merged.email = normalized;
  }
  if (delta.targetVehicle && delta.targetVehicle.trim().length > 1) merged.targetVehicle = delta.targetVehicle.trim();
  if (delta.vehicleType && delta.vehicleType.trim().length > 1) merged.vehicleType = delta.vehicleType.trim();
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
  if (delta.employment && delta.employment.trim().length > 1) merged.employment = delta.employment.trim();
  if (delta.downPayment !== undefined && delta.downPayment !== null) {
    const parsed = normalizeCurrency(delta.downPayment);
    if (parsed !== null) merged.downPayment = parsed;
  }
  if (delta.hasTrade !== undefined) merged.hasTrade = Boolean(delta.hasTrade);
  if (delta.tradeVehicle && delta.tradeVehicle.trim().length > 1) {
    merged.tradeVehicle = delta.tradeVehicle.trim();
    merged.hasTrade = true;
  }
  if (delta.purchaseTimeline && delta.purchaseTimeline.trim().length > 1) merged.purchaseTimeline = delta.purchaseTimeline.trim();
  if (delta.urgency && delta.urgency.trim().length > 1) merged.urgency = delta.urgency.trim();
  if (delta.salesBrief && delta.salesBrief.trim().length > 5) merged.salesBrief = delta.salesBrief.trim();
  return merged;
}

export function generateSalesBrief(profile: BuyerProfile): string {
  const parts: string[] = [];
  const vehicleDesc = profile.targetVehicle || profile.vehicleType || 'vehicle';
  parts.push(`Buyer is actively inquiring about a ${vehicleDesc}.`);
  if (profile.monthlyBudget) {
    parts.push(`Target payment is approximately $${profile.monthlyBudget}/month.`);
  }
  if (profile.creditSituation) {
    parts.push(`Credit situation: "${profile.creditSituation}".`);
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
    parts.push(`Timeline: ${profile.purchaseTimeline}.`);
  }
  if (profile.phone) {
    parts.push(`Contact number: ${profile.phone}.`);
  }
  parts.push('Recommended action: Senior specialist Stephan should contact buyer promptly to confirm approvals.');
  return parts.join(' ');
}
