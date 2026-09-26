/**
 * server/peptide/__tests__/peptideSalesConcierge.test.ts
 * 
 * Comprehensive 14-Point Automated Test Suite for:
 * Bodybuilding-Focused Peptide Research & Sales Concierge
 * 
 * Verifies:
 * 1. Anecdotal evidence retrieval and distinct labeling
 * 2. Preclinical evidence retrieval with animal species and translation limitation
 * 3. Human clinical evidence retrieval (Phase 3 RCTs, limitations, FDA status)
 * 4. Source visibility and metadata (PMID, DOI, journals, citations)
 * 5. Strict evidence category isolation (cannot blur anecdotal into preclinical or clinical)
 * 6. Bodybuilding context & terminology understanding (GHRH vs GHRP, contest prep, recovery)
 * 7. Purchase intent detection ("I want to buy", "How much", "Where can I get it", "Do you sell")
 * 8. Immediate WhatsApp handoff on purchase intent (does NOT dump research essay)
 * 9. WhatsApp configuration and URL generator (PEPTIDE_SALES_WHATSAPP_NUMBER & prefilled text)
 * 10. Session context retention (remembers "recovery" across sequential queries)
 * 11. Negative seller claim isolation (AI never claims "I sell this" or "I have it in stock")
 * 12. No fabricated evidence or testimonials (honest unknown and preclinical boundaries)
 * 13. Zero automotive / Jessica / YourNewAuto contamination
 * 14. End-to-end full conversation simulation (Discovery -> Research -> Context -> Sales Intent -> WhatsApp Handoff)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { peptideKnowledgeEngine } from '../peptideKnowledgeEngine.js';
import { getStructuredEvidenceDossier } from '../evidenceModel.js';

describe('Peptide Research & Sales Concierge — 14-Point Forensic Suite', () => {

  beforeEach(() => {
    peptideKnowledgeEngine.clearSessionContext('test-session');
    peptideKnowledgeEngine.clearSessionContext('default');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Anecdotal Evidence Retrieval and Distinct Labeling
  // ───────────────────────────────────────────────────────────────────────────
  it('POINT-01: Anecdotal evidence is distinctly labeled with explicit non-clinical disclaimer', () => {
    const response = peptideKnowledgeEngine.query('What are bodybuilders reporting about BPC-157?');

    expect(response.answer).toContain('ANECDOTAL REPORTS:');
    expect(response.answer).toContain('These are individual reports, not clinical evidence and not proof of efficacy.');
    
    // Check structured evidence records
    const dossier = getStructuredEvidenceDossier('bpc-157');
    expect(dossier).toBeDefined();
    const anecdotalRecords = dossier!.records.filter(r => r.evidence_type === 'ANECDOTAL');
    expect(anecdotalRecords.length).toBeGreaterThan(0);
    expect(anecdotalRecords[0].evidence_status).toBe('COMMUNITY_REPORT');
    expect(anecdotalRecords[0].population_or_model).toMatch(/bodybuilding|forum|athlete|athletic/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Preclinical Evidence Retrieval with Animal Species and Translation Limitation
  // ───────────────────────────────────────────────────────────────────────────
  it('POINT-02: Preclinical evidence specifies animal species/model and explicit translation limitation', () => {
    const response = peptideKnowledgeEngine.query('What does preclinical research show for BPC-157?');

    expect(response.answer).toContain('PRECLINICAL RESEARCH:');
    expect(response.answer).toMatch(/preclinical research, but that does not establish the same effect in humans/i);

    const dossier = getStructuredEvidenceDossier('bpc-157');
    const preclinicalRecords = dossier!.records.filter(r => r.evidence_type === 'PRECLINICAL');
    expect(preclinicalRecords.length).toBeGreaterThan(0);
    
    // Must contain specific laboratory/animal models
    const models = preclinicalRecords.map(r => r.population_or_model).join(' ');
    expect(models).toMatch(/rat|murine|in vitro|in-vitro|tendon explants/i);
    
    // Every preclinical record must record the translational limitation
    preclinicalRecords.forEach(r => {
      expect(r.limitations).toMatch(/human|animal|clinical|extrapolat/i);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Human Clinical Evidence Retrieval (Phase 3 RCTs, Limitations, FDA Status)
  // ───────────────────────────────────────────────────────────────────────────
  it('POINT-03: Human clinical evidence includes Phase 3 RCTs, FDA status, and limitations', () => {
    const response = peptideKnowledgeEngine.query('What is the human clinical evidence for Tesamorelin?');

    expect(response.answer).toContain('HUMAN / CLINICAL EVIDENCE:');
    expect(response.answer).toMatch(/clinical evidence/i);

    const dossier = getStructuredEvidenceDossier('tesamorelin');
    expect(dossier).toBeDefined();
    const clinicalRecords = dossier!.records.filter(r => r.evidence_type === 'HUMAN_CLINICAL');
    expect(clinicalRecords.length).toBeGreaterThan(0);

    const primaryTrial = clinicalRecords[0];
    expect(primaryTrial.population_or_model).toMatch(/Phase 3|RCT|human/i);
    expect(['VERIFIED', 'REGULATORY_APPROVED']).toContain(primaryTrial.evidence_status);
    expect(primaryTrial.citation).toMatch(/N Engl J Med|Falutz/i);
    expect(primaryTrial.limitations).toMatch(/visceral fat|re-accumulates|discontinuation|cancer/i);

    // Also verify regulatory FDA record
    const regRecord = dossier!.records.find(r => r.evidence_type === 'REGULATORY');
    expect(regRecord).toBeDefined();
    expect(regRecord?.evidence_status).toBe('REGULATORY_APPROVED');
    expect(regRecord?.claim).toMatch(/FDA-approved/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Source Visibility and Metadata
  // ───────────────────────────────────────────────────────────────────────────
  it('POINT-04: Peer-reviewed sources include authentic PMIDs, DOIs, and journal metadata', () => {
    const dossierBpc = getStructuredEvidenceDossier('bpc-157');
    const dossierTirz = getStructuredEvidenceDossier('tirzepatide');

    expect(dossierBpc).toBeDefined();
    expect(dossierTirz).toBeDefined();

    // Check Tirzepatide SURMOUNT-1 source
    const surmount = dossierTirz!.records.find(r => r.citation?.includes('SURMOUNT-1') || r.source.includes('Jastreboff'));
    expect(surmount).toBeDefined();
    expect(surmount?.source_url).toContain('35658024');
    expect(surmount?.citation).toContain('N Engl J Med');

    // Check BPC-157 Chang et al source
    const chang = dossierBpc!.records.find(r => r.source.includes('Chang'));
    expect(chang).toBeDefined();
    expect(chang?.source_url).toContain('21031536');
    expect(chang?.source).toContain('Journal of Orthopaedic Research');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Strict Evidence Category Isolation
  // ───────────────────────────────────────────────────────────────────────────
  it('POINT-05: Strict category isolation prevents blurring anecdotal reports into clinical evidence', () => {
    const response = peptideKnowledgeEngine.query('Is BPC-157 clinically proven in humans for muscle tears?');

    // Must NOT state clinical proof exists for this
    expect(response.evidenceClassification.isClinicallySupported).toBe(false);
    expect(response.evidenceClassification.evidenceLevel).toBe('LEVEL_D');
    
    // Must clearly state it is anecdotal rather than clinical evidence
    expect(response.answer).toMatch(/anecdotal evidence rather than clinical evidence/i);
    expect(response.answer).not.toMatch(/clinically proven in human athletes/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Bodybuilding Context & Terminology Understanding
  // ───────────────────────────────────────────────────────────────────────────
  it('POINT-06: Understands bodybuilding context, physiology, and compound distinctions', () => {
    const cjcVsIpam = peptideKnowledgeEngine.query('What is the difference between CJC-1295 and Ipamorelin?');
    expect(cjcVsIpam.answer).toContain('GHRH');
    expect(cjcVsIpam.answer).toContain('GHS-R1a');
    expect(cjcVsIpam.answer).toMatch(/cortisol|prolactin/i);
    expect(cjcVsIpam.answer).toMatch(/synergistic|pulsatile/i);

    const recomp = peptideKnowledgeEngine.query('What peptides are researched for body recomposition and fat loss?');
    expect(recomp.answer).toMatch(/Tesamorelin/i);
    expect(recomp.answer).toMatch(/visceral adipose tissue|visceral fat/i);
    expect(recomp.answer).toMatch(/incretin/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. Purchase Intent Detection
  // ───────────────────────────────────────────────────────────────────────────
  it('POINT-07: Reliably detects diverse commercial purchase intent signals', () => {
    const buyPhrases = [
      'I want to buy BPC-157',
      'How much is Tesamorelin?',
      'How much does it cost?',
      'Where can I get CJC-1295?',
      'Where do I buy peptides?',
      'Can I order some right now?',
      'Do you have this in stock?',
      'Who is the supplier?',
      'Where to source high purity peptides'
    ];

    buyPhrases.forEach(phrase => {
      const intent = peptideKnowledgeEngine.detectPurchaseIntent(phrase);
      expect(intent.isPurchaseIntent, `Failed to detect purchase intent for: "${phrase}"`).toBe(true);
    });

    // Scientific / Educational inquiries must NOT trigger purchase intent
    const researchPhrases = [
      'What is the mechanism of BPC-157?',
      'What animal studies were conducted on TB-500?',
      'Does Tesamorelin elevate fasting blood sugar?',
      'How does CJC-1295 stimulate growth hormone pulsatility?'
    ];

    researchPhrases.forEach(phrase => {
      const intent = peptideKnowledgeEngine.detectPurchaseIntent(phrase);
      expect(intent.isPurchaseIntent, `False positive purchase intent on: "${phrase}"`).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 8. Immediate WhatsApp Handoff on Purchase Intent
  // ───────────────────────────────────────────────────────────────────────────
  it('POINT-08: Purchase intent triggers immediate concise WhatsApp handoff without research dumping', () => {
    const response = peptideKnowledgeEngine.query('I want to buy BPC-157, how much does it cost?');

    // Must flag sales handoff
    expect(response.salesHandoff).toBeDefined();
    expect(response.salesHandoff?.isPurchaseIntent).toBe(true);
    expect(response.salesHandoff?.whatsappUrl).toContain('https://wa.me/');

    // Must NOT be a massive multi-section science lecture
    expect(response.answer.length).toBeLessThan(350);
    expect(response.answer).toContain('WhatsApp');
    expect(response.answer).toMatch(/availability|pricing|purchasing/i);
    expect(response.answer).not.toContain('WHAT THE EVIDENCE ACTUALLY SAYS:');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 9. WhatsApp Configuration and URL Generator
  // ───────────────────────────────────────────────────────────────────────────
  it('POINT-09: Generates valid sanitized WhatsApp link with context-aware prefilled message', () => {
    const number = peptideKnowledgeEngine.getWhatsAppNumber();
    expect(number).toBeTruthy();

    const urlWithCompoundAndGoal = peptideKnowledgeEngine.buildWhatsAppUrl('BPC-157', 'recovery');
    expect(urlWithCompoundAndGoal).toContain('https://wa.me/15557378433?text=');
    expect(decodeURIComponent(urlWithCompoundAndGoal)).toContain('BPC-157');
    expect(decodeURIComponent(urlWithCompoundAndGoal)).toContain('recovery');
    expect(decodeURIComponent(urlWithCompoundAndGoal)).toContain('availability');

    const defaultUrl = peptideKnowledgeEngine.buildWhatsAppUrl();
    expect(defaultUrl).toContain('https://wa.me/15557378433?text=');
    expect(decodeURIComponent(defaultUrl)).toContain('Peptide Specialist');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 10. Session Context Retention
  // ───────────────────────────────────────────────────────────────────────────
  it('POINT-10: Preserves research goals and active peptides across sequential conversational turns', () => {
    const sessionId = 'session-lifter-101';
    peptideKnowledgeEngine.clearSessionContext(sessionId);

    // Turn 1: Lifter introduces primary goal
    peptideKnowledgeEngine.query('I am dealing with serious tendon injury and need recovery help.', sessionId);
    const sessionAfterT1 = peptideKnowledgeEngine.getSessionContext(sessionId);
    expect(sessionAfterT1.primaryInterest).toMatch(/injury|recovery/);

    // Turn 2: Lifter asks about a peptide without mentioning recovery
    const turn2 = peptideKnowledgeEngine.query('Tell me about BPC-157.', sessionId);
    
    // Response recognizes the ongoing goal context
    expect(turn2.answer).toMatch(/Since you're looking at (injury|recovery)/i);
    expect(turn2.sessionContext?.lastDiscussedPeptide).toBe('BPC-157');
    expect(turn2.sessionContext?.discussedPeptides).toContain('bpc-157');

    // Turn 3: Follow-up using anaphoric pronoun "it"
    const turn3 = peptideKnowledgeEngine.query('What does the preclinical research say about it?', sessionId);
    expect(turn3.peptide?.id).toBe('bpc-157');
    expect(turn3.answer).toContain('BPC-157');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 11. Negative Seller Claim Isolation
  // ───────────────────────────────────────────────────────────────────────────
  it('POINT-11: Explicitly refuses direct seller/inventory claims and routes to WhatsApp', () => {
    const sellerQueries = [
      'Do you sell peptides?',
      'Can you sell me some BPC-157?',
      'Do you have Tesamorelin in stock?',
      'Are you the seller?'
    ];

    sellerQueries.forEach(q => {
      const response = peptideKnowledgeEngine.query(q);
      expect(response.answer).toContain('I cannot sell you peptides or confirm product inventory.');
      expect(response.answer).toContain('I am an AI peptide research and evidence specialist.');
      expect(response.answer).toContain('contact the peptide team directly on WhatsApp.');
      expect(response.salesHandoff?.isPurchaseIntent).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 12. No Fabricated Evidence or Testimonials
  // ───────────────────────────────────────────────────────────────────────────
  it('POINT-12: Honestly admits absence of clinical evidence and does not fabricate citations', () => {
    const response = peptideKnowledgeEngine.query('Give me the human clinical citation proving BPC-157 heals rotator cuffs in 48 hours');

    expect(response.answer).toContain("I don't have a reliable clinical source establishing that claim.");
    expect(response.answer).toContain('The available reports are anecdotal rather than peer-reviewed clinical studies.');
    expect(response.sources).toHaveLength(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 13. Zero Automotive / Jessica / YourNewAuto Contamination
  // ───────────────────────────────────────────────────────────────────────────
  it('POINT-13: System prompt and runtime are 100% isolated from Jessica and YourNewAuto', () => {
    const prompt = peptideKnowledgeEngine.generateVoiceSystemPrompt();

    // Zero Jessica / YourNewAuto / Dealership references
    expect(prompt).not.toMatch(/jessica/i);
    expect(prompt).not.toMatch(/yournewauto/i);
    expect(prompt).not.toMatch(/dealership|test drive|down payment|financing options|pre-approval/i);
    expect(prompt).not.toMatch(/car sales|vehicle inventory/i);

    // Prompt must enforce voice and concierge directives
    expect(prompt).toContain('80s GOLDEN ERA BODYBUILDING SPECIALIST');
    expect(prompt).toContain('DISCOVER → RESEARCH → UNDERSTAND → BUILD INTEREST → CONTACT SELLER ON WHATSAPP');

    // Direct automotive inquiries are rejected cleanly
    const response = peptideKnowledgeEngine.query('Can you help me get approved for car financing?');
    expect(response.answer).toContain('I do not handle vehicle financing');
    expect(response.evidenceClassification.claimTopic).toContain('Non-Peptide Domain');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 14. End-to-End Full Conversation Simulation
  // ───────────────────────────────────────────────────────────────────────────
  it('POINT-14: Simulates complete 5-step visitor journey from greeting to WhatsApp conversion', () => {
    const sessionId = 'full-simulation-session';
    peptideKnowledgeEngine.clearSessionContext(sessionId);

    // Step 1: Greeting / Discovery
    const turn1 = peptideKnowledgeEngine.query('Where should I begin with peptides for workout recovery?', sessionId);
    expect(turn1.sessionContext?.primaryInterest).toBe('recovery');

    // Step 2: Research Compound (BPC-157)
    const turn2 = peptideKnowledgeEngine.query('What does the evidence say about BPC-157?', sessionId);
    expect(turn2.answer).toContain("Since you're looking at recovery");
    expect(turn2.answer).toContain('ANECDOTAL REPORTS:');
    expect(turn2.answer).toContain('PRECLINICAL RESEARCH:');
    expect(turn2.answer).toContain('HUMAN / CLINICAL EVIDENCE:');
    expect(turn2.answer).toContain('WHAT THE EVIDENCE ACTUALLY SAYS:');
    expect(turn2.structuredEvidence).toBeDefined();
    expect(turn2.structuredEvidence!.length).toBeGreaterThan(0);

    // Step 3: Deep Dive into Mechanism & Safety
    const turn3 = peptideKnowledgeEngine.query('What are the known side effects or risks of it?', sessionId);
    expect(turn3.peptide?.id).toBe('bpc-157');
    expect(turn3.answer).toMatch(/distinguish established clinical risks from informal reports/i);

    // Step 4: Stacking / Dosing Guardrail
    const turn4 = peptideKnowledgeEngine.query('What dose should I inject and what stack should I run?', sessionId);
    expect(turn4.safety.isPrescribingRequest).toBe(true);
    expect(turn4.answer).toMatch(/I cannot generate individualized dosing protocols|prescribing clinician/i);

    // Step 5: Sales Intent & WhatsApp Conversion
    const turn5 = peptideKnowledgeEngine.query('Okay, where can I buy BPC-157 and how much is it?', sessionId);
    expect(turn5.salesHandoff?.isPurchaseIntent).toBe(true);
    expect(turn5.salesHandoff?.whatsappUrl).toContain('https://wa.me/');
    expect(turn5.salesHandoff?.whatsappUrl).toContain('BPC-157');
    expect(turn5.salesHandoff?.ctaText).toBe('WHATSAPP THE PEPTIDE TEAM');
    expect(turn5.answer).toContain('WhatsApp');
  });

});
