/**
 * FinancialPolicyGuard - Regulatory & Compliance Financial Guard
 * 
 * Validates that all AI responses maintain conditional phrasing and do NOT
 * fabricate binding lender approvals, guaranteed credit outcomes, or unauthorized APRs.
 */

const FORBIDDEN_GUARANTEE_PATTERNS = [
  /\b(you will definitely get approved|guaranteed approval|100% approved|we guarantee approval)/i,
  /\b(your interest rate is \d+(?:\.\d+)?%|you are locked in at \d+(?:\.\d+)?%)/i
];

export class FinancialPolicyGuard {
  validate(text: string): { compliant: boolean; sanitizedText: string; reason?: string } {
    if (!text) return { compliant: true, sanitizedText: text };

    for (const pattern of FORBIDDEN_GUARANTEE_PATTERNS) {
      if (pattern.test(text)) {
        console.warn(`[FinancialPolicyGuard] Caught non-compliant financial claim: "${text}"`);
        
        // Rephrase into safe conditional language
        let safeText = text
          .replace(/you will definitely get approved/gi, "we can explore available financing options for you")
          .replace(/guaranteed approval/gi, "our network specializes in approvals across every credit circumstance")
          .replace(/100% approved/gi, "a strong opportunity for approval based on lender criteria")
          .replace(/\b(your interest rate is \d+(?:\.\d+)?%|you are locked in at \d+(?:\.\d+)?%)/gi, "your precise interest rate will be determined by the lender");

        // Hard boundary: If the sanitized text STILL contains the forbidden pattern (e.g. failed regex replace), fallback
        if (FORBIDDEN_GUARANTEE_PATTERNS.some(p => p.test(safeText))) {
          safeText = "Let's explore your financing options. I will have a specialist discuss specific rates and approvals with you.";
        }

        return {
          compliant: false,
          sanitizedText: safeText,
          reason: 'NON_COMPLIANT_GUARANTEE_REPHRASED'
        };
      }
    }

    return { compliant: true, sanitizedText: text };
  }
}
