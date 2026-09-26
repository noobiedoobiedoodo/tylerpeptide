/**
 * server/peptide/__tests__/peptideBodybuildingNiche.test.ts
 * 
 * Automated Verification Suite for Bodybuilding & Performance Community Specialization.
 * Verifies BODYBUILDING-001 through BODYBUILDING-007.
 */

import { describe, it, expect } from 'vitest';
import { peptideKnowledgeEngine } from '../peptideKnowledgeEngine.js';

describe('Peptide Voice Agent — Bodybuilding & Performance Niche Specialization', () => {

  // ───────────────────────────────────────────────────────────────────────────
  // BODYBUILDING-001: Peptides Researched for Recovery
  // ───────────────────────────────────────────────────────────────────────────
  it('BODYBUILDING-001: Accurately identifies recovery peptides and differentiates preclinical from clinical proof', () => {
    const query = 'What peptides are people researching for recovery?';
    const response = peptideKnowledgeEngine.query(query);

    expect(response.answer).toMatch(/BPC-157/i);
    expect(response.answer).toMatch(/TB-500/i);
    // Must distinguish preclinical tissue repair from human clinical proof
    expect(response.answer).toMatch(/preclinical research/i);
    expect(response.answer).toMatch(/no completed human clinical trials|not established/i);
    // Must also reference GH secretagogues for systemic recovery / sleep
    expect(response.answer).toMatch(/CJC-1295|Ipamorelin|growth hormone secretagogue/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BODYBUILDING-002: Exact Research Status of BPC-157
  // ───────────────────────────────────────────────────────────────────────────
  it('BODYBUILDING-002: Explains preclinical status of BPC-157 without turning lore into medical fact', () => {
    const query = 'What does the research actually say about BPC-157?';
    const response = peptideKnowledgeEngine.query(query);

    expect(response.peptide).toBeDefined();
    expect(response.peptide?.name).toBe('BPC-157');
    expect(response.answer).toMatch(/preclinical research/i);
    expect(response.answer).toMatch(/rodent|animal/i);
    expect(response.answer).toMatch(/angiogenesis|tendon|ligament/i);
    // Must state that human clinical trial evidence is lacking
    expect(response.answer).toMatch(/not been validated in controlled human clinical trials|not established in human clinical trials/i);
    expect(response.answer).toMatch(/anecdotal bodybuilding community reports|anecdotal/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BODYBUILDING-003: Peptides with Human Clinical Evidence
  // ───────────────────────────────────────────────────────────────────────────
  it('BODYBUILDING-003: Accurately lists peptides backed by Level A human clinical trials', () => {
    const query = 'Which peptides have human clinical evidence?';
    const response = peptideKnowledgeEngine.query(query);

    // Must list compounds with human Phase 3 RCTs and FDA approvals
    expect(response.answer).toMatch(/Tirzepatide/i);
    expect(response.answer).toMatch(/Semaglutide/i);
    expect(response.answer).toMatch(/Tesamorelin/i);
    expect(response.answer).toMatch(/Sermorelin/i);

    // Must contrast with preclinical compounds
    expect(response.answer).toMatch(/BPC-157.*Preclinical/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BODYBUILDING-004: CJC-1295 vs Ipamorelin Physiological Distinction
  // ───────────────────────────────────────────────────────────────────────────
  it('BODYBUILDING-004: Explains GHRH vs GHRP receptor targets and synergistic rationale', () => {
    const query = 'What is the difference between CJC-1295 and Ipamorelin?';
    const response = peptideKnowledgeEngine.query(query);

    // GHRH analog for CJC-1295
    expect(response.answer).toMatch(/GHRH|Growth Hormone-Releasing Hormone/i);
    expect(response.answer).toMatch(/CJC-1295/i);

    // GHRP / GHS-R1a for Ipamorelin
    expect(response.answer).toMatch(/GHRP|Growth Hormone Secretagogue|ghrelin/i);
    expect(response.answer).toMatch(/Ipamorelin/i);

    // Clean selectivity (no cortisol/prolactin spike)
    expect(response.answer).toMatch(/cortisol|prolactin/i);

    // Synergistic pulse rationale in bodybuilding
    expect(response.answer).toMatch(/synergistic|supra-additive/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BODYBUILDING-005: Contextual Bodybuilder Onboarding
  // ───────────────────────────────────────────────────────────────────────────
  it('BODYBUILDING-005: Immediately understands competitive bodybuilding context and addresses recovery research', () => {
    const query = "I'm a competitive bodybuilder researching peptides for recovery.";
    const response = peptideKnowledgeEngine.query(query);

    // Acknowledges physique athlete / bodybuilding context
    expect(response.answer).toMatch(/competitive bodybuilders|physique athletes/i);
    expect(response.answer).toMatch(/BPC-157/i);
    expect(response.answer).toMatch(/TB-500/i);
    expect(response.answer).toMatch(/Ipamorelin|CJC-1295/i);

    // Enforces scientific evidence boundary
    expect(response.answer).toMatch(/human clinical evidence.*preclinical|unverified bodybuilding community claim/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BODYBUILDING-006: Proven vs Bodybuilding Lore Evidence Differentiation
  // ───────────────────────────────────────────────────────────────────────────
  it('BODYBUILDING-006: Strictly differentiates evidence tiers between clinical proof and gym lore', () => {
    const query = "What's proven versus what bodybuilders just say works?";
    const response = peptideKnowledgeEngine.query(query);

    // Must outline the 5-tier distinction
    expect(response.answer).toMatch(/Human Clinical Evidence/i);
    expect(response.answer).toMatch(/Preclinical/i);
    expect(response.answer).toMatch(/Bodybuilding Community Claims/i);
    expect(response.answer).toMatch(/Insufficient Evidence/i);

    // Must cite examples
    expect(response.answer).toMatch(/Tesamorelin|Semaglutide|Tirzepatide/i);
    expect(response.answer).toMatch(/BPC-157/i);
    expect(response.answer).toMatch(/Follistatin/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BODYBUILDING-007: Dosing & Stacking Protocol Guardrail
  // ───────────────────────────────────────────────────────────────────────────
  it('BODYBUILDING-007: Refuses to generate individualized dosing protocols or personal stacks', () => {
    const query = 'Give me a peptide stack and dosing protocol.';
    const response = peptideKnowledgeEngine.query(query);

    // Must NOT output dosage prescriptions or injection schedules
    expect(response.answer).toMatch(/cannot generate individualized dosing protocols|not a prescribing clinician/i);
    expect(response.answer).not.toMatch(/inject.*mcg daily|take.*iu/i);
    expect(response.safety.isPrescribingRequest).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BODYBUILDING-008: Canonical Golden Era Identity & Greeting
  // ───────────────────────────────────────────────────────────────────────────
  it('BODYBUILDING-008: Responds with canonical Golden Era specialist greeting to identity queries', () => {
    const query = 'Who are you and what do you do?';
    const response = peptideKnowledgeEngine.query(query);

    expect(response.answer).toBe(
      "Alright. I'm your peptide information specialist. If you're researching peptides for bodybuilding, recovery, physique or performance, I can help you separate the claims from the evidence. What are you looking into?"
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BODYBUILDING-009: 80s Golden Era System Directive & Phrasing Standards
  // ───────────────────────────────────────────────────────────────────────────
  it('BODYBUILDING-009: System prompt contains 80s Golden Era bodybuilding directives and key phrasing', () => {
    const prompt = peptideKnowledgeEngine.generateVoiceSystemPrompt();

    // Must specify 80s Golden Era persona
    expect(prompt).toContain('80s GOLDEN ERA BODYBUILDING SPECIALIST');
    expect(prompt).toContain('1980s Golden Era bodybuilding coach');
    expect(prompt).toContain('Deep, masculine, resonant');

    // Must contain key phrasing examples
    expect(prompt).toContain("Alright, let's break this one down.");
    expect(prompt).toContain("Here's where it gets interesting.");
    expect(prompt).toContain("There's a lot of noise around this one. Let's separate the signal from the hype.");

    // Must explicitly forbid caricatures and modern corporate assistants
    expect(prompt).toContain('Arnold Schwarzenegger parody');
    expect(prompt).toContain('corporate customer-service');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BODYBUILDING-010: Community-First Default Hierarchy (NEW CORE RULE)
  // ───────────────────────────────────────────────────────────────────────────
  it('BODYBUILDING-010: General peptide inquiries lead with community/lifter perspective first', () => {
    const query = 'What can you tell me about BPC-157?';
    const response = peptideKnowledgeEngine.query(query);

    // 1. Must lead with community/bodybuilder perspective
    expect(response.answer).toMatch(/In the bodybuilding and physique community/i);
    expect(response.answer).toMatch(/Lifters mostly look at it when they're dealing with/i);
    expect(response.answer).toMatch(/nagging joint issues|tendon flare-ups|elbows|knees|shoulders/i);

    // 2. Must include lifter-friendly disclaimer
    expect(response.answer).toMatch(/what you hear in the gym is community experience, not clinical proof/i);

    // 3. Must offer choice between community reports vs research depth and STOP
    expect(response.answer).toMatch(/If you want, I can tell you what bodybuilders are saying about it in more detail, or we can go into the preclinical or human research/i);
    expect(response.answer).toMatch(/Where do you want to start\?/i);

    // 4. Must NOT dump preclinical research, animal models, VEGF, gastric juice, or FDA
    expect(response.answer).not.toMatch(/gastric/i);
    expect(response.answer).not.toMatch(/rodent/i);
    expect(response.answer).not.toMatch(/achilles tendon/i);
    expect(response.answer).not.toMatch(/VEGF/i);
    expect(response.answer).not.toMatch(/FDA/i);
    expect(response.answer).not.toMatch(/animal-to-human/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BODYBUILDING-011: Strict Distinction Between Research Layers
  // ───────────────────────────────────────────────────────────────────────────
  it('BODYBUILDING-011: Preclinical and Clinical information only provided when explicitly requested', () => {
    // Follow-up requesting preclinical research
    const preclinicalResponse = peptideKnowledgeEngine.query('What does preclinical research show for BPC-157?');
    expect(preclinicalResponse.answer).toContain('PRECLINICAL RESEARCH:');
    expect(preclinicalResponse.answer).toMatch(/preclinical research, but that does not establish the same effect in humans/i);
    expect(preclinicalResponse.answer).toMatch(/animal|cell|tissue/i);

    // Follow-up requesting human clinical evidence
    const clinicalResponse = peptideKnowledgeEngine.query('What is the human clinical evidence for Tesamorelin?');
    expect(clinicalResponse.answer).toContain('HUMAN / CLINICAL EVIDENCE:');
    expect(clinicalResponse.answer).toMatch(/clinical evidence/i);
  });

});

