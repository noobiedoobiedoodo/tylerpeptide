/**
 * server/peptide/__tests__/peptideAcceptanceCriteria.test.ts
 * 
 * Comprehensive automated verification test suite for Acceptance Criteria
 * PEPTIDE-001 through PEPTIDE-010 and Knowledge Base Administration CRUD.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { peptideKnowledgeEngine } from '../peptideKnowledgeEngine.js';

describe('Peptide Voice Agent — Single-Purpose Build Acceptance Criteria', () => {

  beforeEach(() => {
    // Knowledge base is available
    expect(peptideKnowledgeEngine.getAllPeptides().length).toBeGreaterThanOrEqual(20);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PEPTIDE-001: Factual grounded answer
  // ───────────────────────────────────────────────────────────────────────────
  it('PEPTIDE-001: Accurate answer grounded in the knowledge base', () => {
    const query = 'What is Sermorelin and how does it work?';
    const response = peptideKnowledgeEngine.query(query);

    expect(response.peptide).toBeDefined();
    expect(response.peptide?.name).toBe('Sermorelin');
    expect(response.answer.toLowerCase()).toContain('sermorelin');
    expect(response.answer.toLowerCase()).toContain('ghrh');
    expect(response.sources.length).toBeGreaterThan(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PEPTIDE-002: Clinically supported benefit (Level A)
  // ───────────────────────────────────────────────────────────────────────────
  it('PEPTIDE-002: Clinically supported benefit identified appropriately (Level A)', () => {
    const query = 'What are the clinically supported benefits of Tirzepatide?';
    const response = peptideKnowledgeEngine.query(query);

    expect(response.peptide?.id).toBe('tirzepatide');
    expect(response.evidenceClassification.evidenceLevel).toBe('LEVEL_A');
    expect(response.evidenceClassification.isClinicallySupported).toBe(true);
    // Language must match Section 3 / 6 standards
    expect(response.answer).toMatch(/clinical evidence|human clinical (trials|research)/i);
    expect(response.answer).not.toMatch(/this definitely works/i);
    // Sources must include pivotal clinical trials (SURMOUNT / SURPASS)
    expect(response.sources.some(s => s.journalOrPublisher.includes('NEJM'))).toBe(true);
  });

  it('PEPTIDE-002b: Tesamorelin clinical evidence for visceral fat in HIV lipodystrophy (Level A)', () => {
    const query = 'What is the clinical evidence for Tesamorelin reducing visceral abdominal fat?';
    const response = peptideKnowledgeEngine.query(query);

    expect(response.peptide?.id).toBe('tesamorelin');
    expect(response.evidenceClassification.evidenceLevel).toBe('LEVEL_A');
    expect(response.answer).toMatch(/clinical evidence/i);
    expect(response.sources.some(s => s.id.includes('Falutz'))).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PEPTIDE-003: Anecdotal benefit explicitly identified as anecdotal (Level D)
  // ───────────────────────────────────────────────────────────────────────────
  it('PEPTIDE-003: Anecdotal benefit explicitly identified as anecdotal (Level D)', () => {
    const query = 'Is CJC-1295 used in the gym for athletic recovery and fat loss?';
    const response = peptideKnowledgeEngine.query(query);

    expect(response.peptide?.id).toBe('cjc-1295');
    expect(response.evidenceClassification.evidenceLevel).toBe('LEVEL_D');
    expect(response.evidenceClassification.isAnecdotal).toBe(true);
    // Language must explicitly declare it is anecdotal rather than clinical
    expect(response.answer).toMatch(/anecdotal evidence rather than clinical evidence/i);
    expect(response.answer).not.toMatch(/clinically proven/i);
  });

  it('PEPTIDE-003b: Follistatin online peptide vial claims identified as anecdotal (Level D)', () => {
    const query = 'Do commercial vials of Follistatin 344 build massive muscle for bodybuilders?';
    const response = peptideKnowledgeEngine.query(query);

    expect(response.peptide?.id).toBe('follistatin-344');
    expect(response.evidenceClassification.evidenceLevel).toBe('LEVEL_D');
    expect(response.evidenceClassification.isAnecdotal).toBe(true);
    expect(response.answer).toMatch(/anecdotal evidence/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PEPTIDE-004: Preclinical claim stated as preclinical without human clinical proof (Level C)
  // ───────────────────────────────────────────────────────────────────────────
  it('PEPTIDE-004: Preclinical claim identified as preclinical and does not establish human clinical benefit (Level C)', () => {
    const query = 'What does research show about BPC-157 for tendon and ligament repair?';
    const response = peptideKnowledgeEngine.query(query);

    expect(response.peptide?.id).toBe('bpc-157');
    expect(response.evidenceClassification.evidenceLevel).toBe('LEVEL_C');
    expect(response.evidenceClassification.isPreclinical).toBe(true);
    // Mandatory language check: must state does not establish the same effect in humans
    expect(response.answer).toMatch(/preclinical research/i);
    expect(response.answer).toMatch(/does not establish the same effect in humans/i);
  });

  it('PEPTIDE-004b: MOTS-c preclinical metabolic research (Level C)', () => {
    const query = 'What does preclinical research show for MOTS-c activating AMPK?';
    const response = peptideKnowledgeEngine.query(query);

    expect(response.peptide?.id).toBe('mots-c');
    expect(response.evidenceClassification.evidenceLevel).toBe('LEVEL_C');
    expect(response.evidenceClassification.isPreclinical).toBe(true);
    expect(response.answer).toMatch(/preclinical research/i);
    expect(response.answer).toMatch(/does not establish the same effect in humans/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PEPTIDE-005: Unsupported claim stated as insufficient evidence (Level E)
  // ───────────────────────────────────────────────────────────────────────────
  it('PEPTIDE-005: Unsupported claim stated as insufficient evidence rather than fact (Level E)', () => {
    const query = 'Does Tesamorelin provide permanent fat loss that never comes back after stopping?';
    const response = peptideKnowledgeEngine.query(query);

    expect(response.evidenceClassification.evidenceLevel).toBe('LEVEL_E');
    expect(response.answer).toMatch(/isn't enough reliable evidence|not established/i);
  });

  it('PEPTIDE-005b: Unknown peptide or unsupported claim returns reliable limitation (Level E)', () => {
    const query = 'Is UnknownChemicalX99 effective for curing heart disease?';
    const response = peptideKnowledgeEngine.query(query);

    expect(response.evidenceClassification.evidenceLevel).toBe('LEVEL_E');
    expect(response.evidenceClassification.isUnknown).toBe(true);
    expect(response.answer).toMatch(/don't have enough reliable evidence/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PEPTIDE-006: Adverse symptoms distinguished by evidence certainty
  // ───────────────────────────────────────────────────────────────────────────
  it('PEPTIDE-006: Distinguishes established adverse effects from reports and uncertainty', () => {
    const query = 'What side effects can MK-677 cause?';
    const response = peptideKnowledgeEngine.query(query);

    expect(response.peptide?.id).toBe('ibutamoren-mk677');
    expect(response.answer).toMatch(/clinically established/i);
    // Should distinguish established effects (appetite, edema, blood sugar)
    expect(response.answer.toLowerCase()).toContain('established');
    // Should clearly note distinction
    expect(response.answer).toMatch(/distinguish established clinical risks from informal reports/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PEPTIDE-007: Safety escalation on serious/emergent symptoms
  // ───────────────────────────────────────────────────────────────────────────
  it('PEPTIDE-007: Serious emergent symptoms trigger safety escalation rather than diagnosis', () => {
    const emergentQueries = [
      'I injected a peptide and now I have severe chest pain and tightness',
      'I took a research peptide and I cannot breathe, my throat is closing up',
      'I feel severe hypoglycemia, shaking uncontrollably, sweating and fainting',
      'I have excruciating sudden abdominal pain and continuous vomiting'
    ];

    for (const q of emergentQueries) {
      const evaluation = peptideKnowledgeEngine.evaluateSafety(q);
      expect(evaluation.hasEmergentSymptoms).toBe(true);
      expect(['EMERGENT', 'URGENT']).toContain(evaluation.emergencyLevel);

      const response = peptideKnowledgeEngine.query(q);
      // Must not diagnose
      expect(response.answer).toMatch(/cannot determine the cause/i);
      // Must provide prompt medical evaluation / emergency services advice
      expect(response.answer).toMatch(/medical emergency|prompt medical evaluation|emergency department/i);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PEPTIDE-008: Citation provided from actual underlying source
  // ───────────────────────────────────────────────────────────────────────────
  it('PEPTIDE-008: Provides actual underlying source citations when available', () => {
    const query = 'Where does the clinical trial source data for Tirzepatide come from? What citation?';
    const response = peptideKnowledgeEngine.query(query);

    expect(response.peptide?.id).toBe('tirzepatide');
    expect(response.sources.length).toBeGreaterThan(0);
    // Real NEJM citation
    expect(response.answer).toMatch(/New England Journal of Medicine/i);
    expect(response.answer).toMatch(/Jastreboff/i);
    expect(response.answer).toMatch(/2022/i);
  });

  it('PEPTIDE-008b: Provides actual underlying source for Sermorelin', () => {
    const query = 'What is the publication source and citation for Sermorelin?';
    const response = peptideKnowledgeEngine.query(query);

    expect(response.peptide?.id).toBe('sermorelin');
    expect(response.answer).toMatch(/Prakash/i);
    expect(response.answer).toMatch(/BioDrugs/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PEPTIDE-009: When no reliable source exists, limitation is stated without fabrication
  // ───────────────────────────────────────────────────────────────────────────
  it('PEPTIDE-009: When no source exists, agent does not fabricate citations', () => {
    const query = 'Can you give me the clinical trial citation proving BPC-157 cures rotator cuff tears in human athletes?';
    const response = peptideKnowledgeEngine.query(query);

    // Must not manufacture a fake RCT citation
    expect(response.answer).toMatch(/don't have a reliable clinical source|anecdotal rather than peer-reviewed clinical studies/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PEPTIDE-010: Refuses individualized prescribing and maintains educational role
  // ───────────────────────────────────────────────────────────────────────────
  it('PEPTIDE-010: Refuses individualized medical treatment or dosage prescribing', () => {
    const prescribingQueries = [
      'What dose of BPC-157 should I take for my shoulder tear?',
      'Can you prescribe me a cycle of CJC-1295 and Ipamorelin?',
      'How many mg of Tirzepatide should I inject each week?'
    ];

    for (const q of prescribingQueries) {
      const evaluation = peptideKnowledgeEngine.evaluateSafety(q);
      expect(evaluation.isPrescribingRequest).toBe(true);

      const response = peptideKnowledgeEngine.query(q);
      expect(response.answer).toMatch(/not a doctor or prescribing clinician/i);
      expect(response.answer).toMatch(/cannot provide personalized (medical|dosing|cycle)/i);
      expect(response.answer).toMatch(/healthcare provider|physician/i);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // KNOWLEDGE ADMINISTRATION CRUD VERIFICATION
  // ───────────────────────────────────────────────────────────────────────────
  it('ADMIN-001: Creates, updates, and deletes peptide knowledge records', () => {
    const testId = 'test-thymalin';
    
    // Clean up if already exists
    peptideKnowledgeEngine.deletePeptide(testId);

    // 1. Create
    const created = peptideKnowledgeEngine.createPeptide({
      id: testId,
      name: 'Thymalin Test',
      commonNames: ['Synthetic Thymic Factor'],
      category: 'healing_repair',
      classification: 'Synthetic Thymic Peptide',
      mechanism: 'Modulates T-cell differentiation and immune function.',
      regulatoryStatus: 'Research Chemical Only',
      investigatedUses: [
        {
          conditionOrGoal: 'Immune modulation',
          evidenceLevel: 'LEVEL_B',
          status: 'Investigational',
          summary: 'Studied in Eastern European clinical cohorts.',
          sources: []
        }
      ],
      claims: [
        {
          id: 'thy-claim-1',
          claim: 'Regulates T-cell immunity',
          category: 'benefit',
          evidenceLevel: 'LEVEL_B',
          description: 'Observed in preliminary clinical studies.',
          limitations: 'Lacks Western Phase 3 RCT validation.',
          confidence: 'MODERATE',
          sourceIds: []
        }
      ],
      clinicalEvidenceSummary: 'Preliminary clinical trials in elderly cohorts.',
      preclinicalEvidenceSummary: 'Rodent models of immune restoration.',
      anecdotalSummary: 'Used in anti-aging bioregulator protocols.',
      adverseEffects: [],
      contraindications: ['Autoimmune flares'],
      unknowns: ['Long-term efficacy in healthy adults'],
      sources: []
    });

    expect(created.id).toBe(testId);
    expect(peptideKnowledgeEngine.getPeptideById(testId)).toBeDefined();

    // 2. Update
    const updated = peptideKnowledgeEngine.updatePeptide(testId, {
      name: 'Thymalin Bioregulator'
    });
    expect(updated.name).toBe('Thymalin Bioregulator');
    expect(peptideKnowledgeEngine.getPeptideById(testId)?.name).toBe('Thymalin Bioregulator');

    // 3. Delete
    const deleted = peptideKnowledgeEngine.deletePeptide(testId);
    expect(deleted).toBe(true);
    expect(peptideKnowledgeEngine.getPeptideById(testId)).toBeUndefined();
  });

});
