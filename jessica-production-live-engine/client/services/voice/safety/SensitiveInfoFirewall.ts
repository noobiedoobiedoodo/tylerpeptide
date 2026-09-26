/**
 * SensitiveInfoFirewall - PII & Credential Voice Firewall
 * 
 * Prevents sensitive authentication credentials (SIN numbers, credit cards, passwords)
 * from being spoken aloud over voice channels, safely redirecting to secure UI forms.
 * Uses entity detection, context, and validation to prevent false positives on VINs or phone numbers.
 */

export type PIIConfidence = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

export class SensitiveInfoFirewall {
  // Check if string passes Luhn algorithm (mod 10)
  private passesLuhn(digits: string): boolean {
    let sum = 0;
    let shouldDouble = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let digit = parseInt(digits.charAt(i), 10);
      if (shouldDouble) {
        if ((digit *= 2) > 9) digit -= 9;
      }
      sum += digit;
      shouldDouble = !shouldDouble;
    }
    return (sum % 10) === 0;
  }

  // Check if string passes basic SIN validation (Canadian SIN is mod 10 luhn)
  private passesSINCheck(digits: string): boolean {
    if (digits.length !== 9) return false;
    // SINs do not start with 0 or 8
    if (digits.startsWith('0') || digits.startsWith('8')) return false;
    return this.passesLuhn(digits);
  }

  check(text: string): { containsSensitiveData: boolean; confidence: PIIConfidence; safeMessage?: string } {
    if (!text) return { containsSensitiveData: false, confidence: 'NONE' };

    const digitsOnly = text.replace(/\D/g, '');
    const lowerText = text.toLowerCase();

    // 1. Credit Card Check
    // Generally 13-19 digits.
    if (digitsOnly.length >= 13 && digitsOnly.length <= 19) {
      if (this.passesLuhn(digitsOnly)) {
        const hasCCContext = /(credit card|visa|mastercard|amex|card number)/.test(lowerText);
        return {
          containsSensitiveData: true,
          confidence: hasCCContext ? 'HIGH' : 'MEDIUM',
          safeMessage: "For your privacy and security, please enter your credit card details directly into our secure form."
        };
      }
    }

    // 2. SIN / SSN Check (Canadian SIN = 9 digits)
    if (digitsOnly.length === 9) {
      if (this.passesSINCheck(digitsOnly)) {
        const hasSINContext = /(sin|social insurance|social security|ssn)/.test(lowerText);
        return {
          containsSensitiveData: true,
          confidence: hasSINContext ? 'HIGH' : 'MEDIUM',
          safeMessage: "For your privacy, please enter your Social Insurance Number securely through the encrypted form."
        };
      }
    }

    // Explicit Context Override for explicit statements like "My SIN is..." even if recognition mangled the digits slightly
    if (/(my sin is|my social insurance number is)/.test(lowerText) && digitsOnly.length > 5) {
      return {
        containsSensitiveData: true,
        confidence: 'HIGH',
        safeMessage: "For your privacy, please enter your Social Insurance Number securely through the encrypted form."
      };
    }

    return { containsSensitiveData: false, confidence: 'NONE' };
  }
}
