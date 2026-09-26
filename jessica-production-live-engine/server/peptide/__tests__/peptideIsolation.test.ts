/**
 * server/peptide/__tests__/peptideIsolation.test.ts
 *
 * Mandatory Automated Negative Isolation Test Suite
 * Verifies ISOLATION-001 through ISOLATION-007
 * Proves complete vertical isolation from YourNewAuto / automotive brain.
 */

import { describe, it, expect } from 'vitest';
import { peptideKnowledgeEngine } from '../peptideKnowledgeEngine.js';

describe('Peptide Voice Agent — Negative Isolation & Anti-Contamination Suite', () => {

  // ───────────────────────────────────────────────────────────────────────────
  // ISOLATION-001: Direct Automotive Question
  // ───────────────────────────────────────────────────────────────────────────
  it('ISOLATION-001: Rejects vehicle financing and remains in peptide specialist role', () => {
    const query = 'Can you help me finance a vehicle?';
    const response = peptideKnowledgeEngine.query(query);

    expect(response.answer).toMatch(/peptide information/i);
    expect(response.answer).toMatch(/do not handle vehicle financing|automotive/i);

    // Must NOT ask automotive qualification questions or mention YourNewAuto
    expect(response.answer).not.toMatch(/YourNewAuto|Your New Auto|Jessica|Stephan/i);
    expect(response.answer).not.toMatch(/monthly payment|down payment|credit score|annual income/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ISOLATION-002: YourNewAuto Identity Test
  // ───────────────────────────────────────────────────────────────────────────
  it('ISOLATION-002: Does not identify as YourNewAuto or an automotive entity', () => {
    const query = 'What company do you work for?';
    const response = peptideKnowledgeEngine.query(query);

    expect(response.answer).toMatch(/peptide information specialist/i);
    expect(response.answer).not.toMatch(/YourNewAuto|Your New Auto|dealership/i);
  });

  it('ISOLATION-002b: Rejects affiliation with YourNewAuto when directly asked', () => {
    const query = 'Are you from YourNewAuto?';
    const response = peptideKnowledgeEngine.query(query);

    expect(response.answer).toMatch(/not affiliated with YourNewAuto/i);
    expect(response.answer).toMatch(/peptide/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ISOLATION-003: Automotive Knowledge / Inventory Injection
  // ───────────────────────────────────────────────────────────────────────────
  it('ISOLATION-003: Does not provide vehicle inventory or car search', () => {
    const query = 'What vehicles do you have available?';
    const response = peptideKnowledgeEngine.query(query);

    expect(response.answer).toMatch(/do not handle.*car inventory|vehicle/i);
    expect(response.answer).toMatch(/peptide/i);
    expect(response.answer).not.toMatch(/F-150|Civic|RAV4|CR-V|Silverado|Ram 1500/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ISOLATION-004: Automotive Lead Injection
  // ───────────────────────────────────────────────────────────────────────────
  it('ISOLATION-004: Does not switch into automotive finance qualification when presented with credit/truck', () => {
    const query = 'My credit is bad and I need a truck.';
    const response = peptideKnowledgeEngine.query(query);

    expect(response.answer).toMatch(/do not handle vehicle financing|automotive/i);
    expect(response.answer).not.toMatch(/bank approval|credit situation|monthly budget/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ISOLATION-005: Clean Peptide Query
  // ───────────────────────────────────────────────────────────────────────────
  it('ISOLATION-005: Answers peptide questions cleanly with zero automotive contamination', () => {
    const query = 'What is BPC-157?';
    const response = peptideKnowledgeEngine.query(query);

    expect(response.peptide).toBeDefined();
    expect(response.peptide?.name).toBe('BPC-157');
    expect(response.answer).toMatch(/BPC-157/i);
    expect(response.answer).toMatch(/preclinical/i);

    // Absolutely zero automotive contamination
    expect(response.answer).not.toMatch(/vehicle|car|truck|van|SUV|YourNewAuto|finance|dealer/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ISOLATION-006: Context Contamination Test (Automotive followed by Peptide)
  // ───────────────────────────────────────────────────────────────────────────
  it('ISOLATION-006: Transitions to peptide subject without carrying automotive context forward', () => {
    // Turn 1: Automotive inquiry
    const turn1 = peptideKnowledgeEngine.query('I need a vehicle.');
    expect(turn1.answer).toMatch(/do not handle vehicle/i);

    // Turn 2: Peptide inquiry
    const turn2 = peptideKnowledgeEngine.query('Actually, what is BPC-157?');
    expect(turn2.peptide?.name).toBe('BPC-157');
    expect(turn2.answer).toMatch(/BPC-157/i);
    expect(turn2.answer).not.toMatch(/vehicle|car|truck|dealer|financing/i);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ISOLATION-007: Reverse Contamination Test (Peptide followed by Automotive)
  // ───────────────────────────────────────────────────────────────────────────
  it('ISOLATION-007: Does not switch to automotive advisor even after prior peptide conversation', () => {
    // Turn 1: Peptide inquiry
    const turn1 = peptideKnowledgeEngine.query('What does BPC-157 do?');
    expect(turn1.peptide?.name).toBe('BPC-157');

    // Turn 2: Automotive financing inquiry
    const turn2 = peptideKnowledgeEngine.query('Can you get me approved for a vehicle?');
    expect(turn2.answer).toMatch(/do not handle vehicle financing|automotive/i);
    expect(turn2.answer).not.toMatch(/YourNewAuto|Jessica|Stephan|priority file/i);
  });

});
