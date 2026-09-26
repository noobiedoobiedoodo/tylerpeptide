/**
 * server/peptide/__tests__/peptideEvidenceDisplayContract.test.ts
 * 
 * Automated Verification Suite for the Customer-Facing Evidence-Display Contract.
 * Directly implements Section 20: ACCEPTANCE TESTS (TEST 1 through TEST 7).
 * 
 * Core Principle: BODYBUILDING COMMUNITY FIRST. DEEPER RESEARCH ON REQUEST.
 */

import { describe, it, expect } from 'vitest';
import { peptideKnowledgeEngine } from '../peptideKnowledgeEngine.js';

describe('Evidence-Display Contract — Acceptance Tests (Section 20)', () => {

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 1: Default Peptide Inquiry (BPC-157)
  // Expected: COMMUNITY_REPORT. No automatic PRECLINICAL panel. No automatic REGULATORY panel.
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 1: "What is BPC-157?" yields COMMUNITY_REPORT without unprompted preclinical/regulatory dump', () => {
    const query = 'What is BPC-157?';
    const response = peptideKnowledgeEngine.query(query);

    // 1. Primary class must be COMMUNITY_REPORT and UI state must be COMMUNITY_VIEW
    expect(response.primaryEvidenceClass).toBe('COMMUNITY_REPORT');
    expect(response.uiState).toBe('COMMUNITY_VIEW');

    // 2. Must speak from bodybuilding community perspective first
    expect(response.answer).toMatch(/In the bodybuilding and physique community/i);
    expect(response.answer).toMatch(/Lifters mostly look at it when they're dealing with/i);

    // 3. Must include short community experience disclaimer
    expect(response.answer).toMatch(/what you hear in the gym is community experience, not clinical proof/i);

    // 4. Must offer research choices and STOP
    expect(response.answer).toMatch(/If you want, I can tell you what bodybuilders are saying about it in more detail, or we can go into the preclinical or human research/i);
    expect(response.answer).toMatch(/Where do you want to start\?/i);

    // 5. NEGATIVE CHECKS: No automatic preclinical, gastric juice, rodent, or regulatory dump
    expect(response.answer).not.toMatch(/gastric/i);
    expect(response.answer).not.toMatch(/rodent/i);
    expect(response.answer).not.toMatch(/achilles tendon/i);
    expect(response.answer).not.toMatch(/VEGF/i);
    expect(response.answer).not.toMatch(/REGULATORY INFORMATION:/i);
    expect(response.answer).not.toMatch(/PRECLINICAL RESEARCH:/i);
    expect(response.answer).not.toMatch(/HUMAN \/ CLINICAL EVIDENCE:/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 2: Community Questions
  // Expected: Community information first.
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 2: "What do bodybuilders say about BPC-157?" gives community information first', () => {
    const query = 'What do bodybuilders say about BPC-157?';
    const response = peptideKnowledgeEngine.query(query);

    expect(response.primaryEvidenceClass).toBe('COMMUNITY_REPORT');
    expect(response.uiState).toBe('COMMUNITY_VIEW');
    expect(response.answer).toMatch(/ANECDOTAL REPORTS:|bodybuilding and physique community/i);
    expect(response.answer).toMatch(/not clinical evidence and not proof of efficacy|community experience, not clinical proof/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 3: Preclinical Question
  // Expected: PRECLINICAL_VIEW.
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 3: "What does the preclinical research say?" transitions to PRECLINICAL_VIEW', () => {
    const query = 'What does the preclinical research say about BPC-157?';
    const response = peptideKnowledgeEngine.query(query);

    expect(response.primaryEvidenceClass).toBe('PRECLINICAL');
    expect(response.uiState).toBe('PRECLINICAL_VIEW');
    expect(response.answer).toContain('PRECLINICAL RESEARCH:');
    expect(response.answer).toMatch(/does not establish the same effect in humans/i);
    expect(response.answer).toMatch(/animal|cell|tissue/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 4: Human Clinical Question
  // Expected: HUMAN_CLINICAL_VIEW.
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 4: "Have there been human studies?" transitions to HUMAN_CLINICAL_VIEW', () => {
    const query = 'Have there been human studies on BPC-157?';
    const response = peptideKnowledgeEngine.query(query);

    expect(response.primaryEvidenceClass).toBe('HUMAN_CLINICAL');
    expect(response.uiState).toBe('HUMAN_CLINICAL_VIEW');
    expect(response.answer).toContain('HUMAN / CLINICAL EVIDENCE:');
    expect(response.answer).toMatch(/clinical trials|clinical evidence/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 5: Regulatory Question
  // Expected: REGULATORY_VIEW.
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 5: "Is it FDA approved?" transitions to REGULATORY_VIEW without dumping other layers', () => {
    const query = 'Is BPC-157 FDA approved?';
    const response = peptideKnowledgeEngine.query(query);

    expect(response.primaryEvidenceClass).toBe('REGULATORY');
    expect(response.uiState).toBe('REGULATORY_VIEW');
    expect(response.answer).toContain('REGULATORY INFORMATION:');
    expect(response.answer).toMatch(/regulatory status/i);
    expect(response.answer).not.toMatch(/ANECDOTAL REPORTS:/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 6: Purchase Intent
  // Expected: Immediate WhatsApp purchase-intent pathway. No unnecessary evidence dump.
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 6: "I want to buy it." routes to immediate WhatsApp pathway without evidence dump', () => {
    const query = 'I want to buy BPC-157.';
    const response = peptideKnowledgeEngine.query(query);

    expect(response.salesHandoff).toBeDefined();
    expect(response.salesHandoff?.isPurchaseIntent).toBe(true);
    expect(response.salesHandoff?.whatsappUrl).toContain('https://wa.me/');
    expect(response.answer).toContain('WhatsApp');
    // Concise handoff, no giant research essay
    expect(response.answer.length).toBeLessThan(350);
    expect(response.answer).not.toContain('WHAT THE EVIDENCE ACTUALLY SAYS:');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 7: Progressive Information ("Tell me everything.")
  // Expected: Do NOT blindly dump every database field. Present progressively.
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 7: "Tell me everything about BPC-157." presents progressively rather than dumping everything', () => {
    const query = 'Tell me everything about BPC-157.';
    const response = peptideKnowledgeEngine.query(query);

    expect(response.uiState).toBe('COMMUNITY_VIEW');
    // Must lead with community and offer progressive steps
    expect(response.answer).toMatch(/bodybuilding and physique community/i);
    expect(response.answer).toMatch(/Rather than dumping every scientific database field at once|take it step by step/i);
    expect(response.answer).toMatch(/preclinical|human clinical/i);
  });

});
