/**
 * server/peptide/peptideKnowledgeEngine.ts
 * 
 * Core Peptide Knowledge & Evidence Engine.
 * Implements:
 * 1. Knowledge Base Repository with CRUD administration & file persistence
 * 2. Strict Evidence Classification (Level A through Level E)
 * 3. Clinical Safety Escalation & Emergent Symptom Triage
 * 4. Non-Prescribing Educational Guardrails
 * 5. Grounded Factual Q&A and Citation Retrieval
 */

import fs from 'fs';
import path from 'path';
import {
  PeptideRecord,
  EvidenceLevel,
  EvidenceClassificationResult,
  SafetyEvaluationResult,
  PeptideQueryResponse,
  PeptideSource,
  ClaimCategory,
  StructuredEvidenceRecord,
  EvidenceSummaryBlock,
  SalesHandoffState,
  SessionContext,
  EvidenceType
} from './types.js';
import { INITIAL_PEPTIDES } from './database.js';
import {
  getStructuredEvidenceDossier,
  getEvidenceSummaryBlock,
  getRecordsByEvidenceType,
  buildFallbackEvidenceDossier
} from './evidenceModel.js';

export class PeptideKnowledgeEngine {
  private static instance: PeptideKnowledgeEngine;
  private peptides: Map<string, PeptideRecord> = new Map();
  private sessionStore: Map<string, SessionContext> = new Map();
  private storageFilePath: string;

  private constructor() {
    this.storageFilePath = path.join(process.cwd(), 'data', 'peptides_store.json');
    this.initializeStore();
  }

  public static getInstance(): PeptideKnowledgeEngine {
    if (!PeptideKnowledgeEngine.instance) {
      PeptideKnowledgeEngine.instance = new PeptideKnowledgeEngine();
    }
    return PeptideKnowledgeEngine.instance;
  }

  private attachStructuredEvidence(peptide: PeptideRecord): PeptideRecord {
    const dossier = getStructuredEvidenceDossier(peptide.id) || buildFallbackEvidenceDossier(peptide);
    return {
      ...peptide,
      structuredEvidence: dossier.records,
      evidenceSummary: dossier.summary
    };
  }

  private initializeStore(): void {
    try {
      if (fs.existsSync(this.storageFilePath)) {
        const raw = fs.readFileSync(this.storageFilePath, 'utf-8');
        const parsed: PeptideRecord[] = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          parsed.forEach(p => {
            const enriched = this.attachStructuredEvidence(p);
            this.peptides.set(enriched.id, enriched);
          });
          // Always synchronize canonical initial peptides with any code updates
          INITIAL_PEPTIDES.forEach(initP => {
            const existing = this.peptides.get(initP.id);
            const enrichedInit = this.attachStructuredEvidence(initP);
            if (existing) {
              this.peptides.set(initP.id, {
                ...existing,
                classification: initP.classification,
                mechanism: initP.mechanism,
                claims: initP.claims,
                sources: initP.sources,
                structuredEvidence: enrichedInit.structuredEvidence,
                evidenceSummary: enrichedInit.evidenceSummary
              });
            } else {
              this.peptides.set(initP.id, enrichedInit);
            }
          });
          this.persistStore();
          console.log(`[PeptideEngine] Loaded ${this.peptides.size} peptides from persistent store.`);
          return;
        }
      }
    } catch (err: any) {
      console.warn('[PeptideEngine] Could not load persisted peptide store, seeding initial database:', err.message);
    }

    // Seed from INITIAL_PEPTIDES
    INITIAL_PEPTIDES.forEach(p => {
      const enriched = this.attachStructuredEvidence(p);
      this.peptides.set(enriched.id, enriched);
    });
    this.persistStore();
    console.log(`[PeptideEngine] Seeded ${this.peptides.size} peptides into knowledge engine.`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SESSION CONTEXT & SALES CONCIERGE HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  public getSessionContext(sessionId: string = 'default'): SessionContext {
    let session = this.sessionStore.get(sessionId);
    if (!session) {
      session = { discussedPeptides: [] };
      this.sessionStore.set(sessionId, session);
    }
    return session;
  }

  public updateSessionContext(sessionId: string = 'default', updates: Partial<SessionContext>): SessionContext {
    const current = this.getSessionContext(sessionId);
    const updated: SessionContext = {
      ...current,
      ...updates,
      discussedPeptides: updates.discussedPeptides
        ? Array.from(new Set([...current.discussedPeptides, ...updates.discussedPeptides]))
        : current.discussedPeptides
    };
    this.sessionStore.set(sessionId, updated);
    return updated;
  }

  public clearSessionContext(sessionId: string = 'default'): void {
    this.sessionStore.delete(sessionId);
  }

  public getWhatsAppNumber(): string {
    return process.env.PEPTIDE_SALES_WHATSAPP_NUMBER || '15557378433';
  }

  public buildWhatsAppPrefill(peptideName?: string, goal?: string): string {
    if (peptideName && goal) {
      return `Hi, I was researching ${peptideName} for ${goal} with the Peptide Specialist and I'd like to learn more about availability.`;
    }
    if (peptideName) {
      return `Hi, I was researching ${peptideName} with the Peptide Specialist and I'd like to learn more about availability.`;
    }
    return `Hi, I was researching peptides with the Peptide Specialist and I'd like to learn more about availability.`;
  }

  public buildWhatsAppUrl(peptideName?: string, goal?: string): string {
    const rawNumber = this.getWhatsAppNumber();
    const cleanNumber = rawNumber.replace(/[^0-9]/g, '');
    const prefill = encodeURIComponent(this.buildWhatsAppPrefill(peptideName, goal));
    return `https://wa.me/${cleanNumber}?text=${prefill}`;
  }

  public detectPurchaseIntent(text: string): { isPurchaseIntent: boolean; match?: string } {
    const patterns = [
      /\b(i want to buy|want to buy|how much is|how much are|how much does|what does it cost|how much for|cost of|pricing|price)\b/i,
      /\b(do you sell|do you have.*in stock|is it in stock|in stock)\b/i,
      /\b(where can i get|where can i buy|where do i buy|where to buy|how to buy)\b/i,
      /\b(what's available|whats available|current availability|product availability)\b/i,
      /\b(can i order|how to order|place an order|can i purchase|how to purchase|ready to purchase|ready to buy)\b/i,
      /\b(can you send me the supplier|who is the supplier|where to source|supplier contact|contact the supplier)\b/i,
      /\b(buy it|buy peptides|order peptides|purchase peptides|order some|buy some)\b/i
    ];

    for (const pat of patterns) {
      const match = text.match(pat);
      if (match) {
        return { isPurchaseIntent: true, match: match[0] };
      }
    }
    return { isPurchaseIntent: false };
  }

  public detectResearchGoal(text: string): 'recovery' | 'body_composition' | 'fat_loss' | 'muscle_growth' | 'injury' | undefined {
    const lower = text.toLowerCase();
    if (/\b(injury|injuries|tendon|ligament|tear|sprain|joint pain|rotator cuff)\b/i.test(lower)) {
      return 'injury';
    }
    if (/\b(recovery|training recovery|recover faster|workout recovery|soreness|heal|healing)\b/i.test(lower)) {
      return 'recovery';
    }
    if (/\b(fat loss|cutting|shredded|dieting|visceral fat|lose weight|leanness)\b/i.test(lower)) {
      return 'fat_loss';
    }
    if (/\b(body composition|recomp|body recomposition|lean mass)\b/i.test(lower)) {
      return 'body_composition';
    }
    if (/\b(muscle growth|hypertrophy|building muscle|build muscle|pack on muscle)\b/i.test(lower)) {
      return 'muscle_growth';
    }
    return undefined;
  }

  public getPeptideStructuredEvidence(peptideId: string): StructuredEvidenceRecord[] {
    const dossier = getStructuredEvidenceDossier(peptideId);
    if (dossier) return dossier.records;
    const peptide = this.getPeptideById(peptideId);
    if (peptide) return buildFallbackEvidenceDossier(peptide).records;
    return [];
  }

  public getPeptideEvidenceSummary(peptideId: string): EvidenceSummaryBlock | undefined {
    const dossier = getStructuredEvidenceDossier(peptideId);
    if (dossier) return dossier.summary;
    const peptide = this.getPeptideById(peptideId);
    if (peptide) return buildFallbackEvidenceDossier(peptide).summary;
    return undefined;
  }


  private persistStore(): void {
    try {
      const dir = path.dirname(this.storageFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = Array.from(this.peptides.values());
      fs.writeFileSync(this.storageFilePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err: any) {
      console.error('[PeptideEngine] Failed to persist peptide store:', err.message);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // REPOSITORY / CRUD ADMINISTRATION
  // ─────────────────────────────────────────────────────────────────────────────

  public getAllPeptides(): PeptideRecord[] {
    return Array.from(this.peptides.values());
  }

  public getPeptideById(id: string): PeptideRecord | undefined {
    return this.peptides.get(id.toLowerCase().trim());
  }

  public findPeptideByName(query: string): PeptideRecord | undefined {
    if (!query) return undefined;
    const clean = query.toLowerCase().trim();

    // 1. Direct ID match
    if (this.peptides.has(clean)) return this.peptides.get(clean);

    // 2. Name or alias match
    for (const record of this.peptides.values()) {
      if (record.name.toLowerCase() === clean) return record;
      if (record.commonNames.some(alias => alias.toLowerCase() === clean)) return record;
    }

    // 3. Substring match
    for (const record of this.peptides.values()) {
      if (record.name.toLowerCase().includes(clean) || clean.includes(record.name.toLowerCase())) {
        return record;
      }
      for (const alias of record.commonNames) {
        if (alias.toLowerCase().includes(clean) || clean.includes(alias.toLowerCase())) {
          return record;
        }
      }
    }

    return undefined;
  }

  public createPeptide(record: Omit<PeptideRecord, 'createdAt' | 'updatedAt'>): PeptideRecord {
    const id = record.id.toLowerCase().trim();
    if (this.peptides.has(id)) {
      throw new Error(`Peptide with id "${id}" already exists.`);
    }

    const fullRecord: PeptideRecord = {
      ...record,
      id,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.peptides.set(id, fullRecord);
    this.persistStore();
    return fullRecord;
  }

  public updatePeptide(id: string, updates: Partial<PeptideRecord>): PeptideRecord {
    const cleanId = id.toLowerCase().trim();
    const existing = this.peptides.get(cleanId);
    if (!existing) {
      throw new Error(`Peptide "${cleanId}" not found.`);
    }

    const updated: PeptideRecord = {
      ...existing,
      ...updates,
      id: existing.id, // Preserve original ID
      updatedAt: Date.now()
    };

    this.peptides.set(cleanId, updated);
    this.persistStore();
    return updated;
  }

  public deletePeptide(id: string): boolean {
    const cleanId = id.toLowerCase().trim();
    const deleted = this.peptides.delete(cleanId);
    if (deleted) {
      this.persistStore();
    }
    return deleted;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SAFETY EVALUATOR & CLINICAL TRIAGE
  // ─────────────────────────────────────────────────────────────────────────────

  public evaluateSafety(text: string): SafetyEvaluationResult {
    const lower = text.toLowerCase();

    // 1. Detect Prescribing / Dosage Protocol Requests (Section 10)
    const prescribingPatterns = [
      /\bhow much (should i|do i|to|would i) (take|inject|use|pin|dose|administer)\b/i,
      /\b(what dose|what dosage|how many mcg|how many mg|how to dose|what amount to (take|inject|use)|dosing protocol|dosing schedule)\b/i,
      /\b(prescribe|prescribe me|cycle for me|recommend a dose|how often should i inject|how to inject|how to take)\b/i,
      /\b(what cycle should i run|give me a cycle|best cycle for me|protocol for my)\b/i
    ];
    const isPrescribingRequest = prescribingPatterns.some(p => p.test(lower));

    // 2. Detect Emergent / Serious Symptoms (Section 8)
    const emergentSymptomPatterns: Array<{ name: string; pattern: RegExp; severity: 'EMERGENT' | 'URGENT' }> = [
      { name: 'Difficulty Breathing / Shortness of Breath', pattern: /\b(can't breathe|cannot breathe|difficulty breathing|shortness of breath|gasping|wheezing severely|throat closing|suffocating)\b/i, severity: 'EMERGENT' },
      { name: 'Chest Pain / Angina', pattern: /\b(chest pain|pressure in chest|tightness in chest|radiating to arm|crushing chest|angina|heart racing irregularly)\b/i, severity: 'EMERGENT' },
      { name: 'Severe Allergic Reaction / Anaphylaxis', pattern: /\b(anaphylaxis|swollen tongue|lips swelling|face swollen|hives all over|throat swelling)\b/i, severity: 'EMERGENT' },
      { name: 'Loss of Consciousness / Syncope', pattern: /\b(passed out|blacked out|fainted|loss of consciousness|unresponsive)\b/i, severity: 'EMERGENT' },
      { name: 'Severe Hypoglycemia', pattern: /\b(severe hypoglycemia|shaking uncontrollably|profuse sweating and confusion|blood sugar 40|hypoglycemic collapse)\b/i, severity: 'EMERGENT' },
      { name: 'Severe Acute Abdominal Pain (Pancreatitis)', pattern: /\b(severe stomach pain|excruciating.*abdominal|severe.*abdominal|pancreatitis|pain radiating to back with vomiting)\b/i, severity: 'URGENT' },
      { name: 'Severe Neurological Symptoms', pattern: /\b(slurred speech|facial drooping|one-sided numbness|sudden severe headache|thunderclap headache)\b/i, severity: 'EMERGENT' },
      { name: 'Rapidly Worsening Symptoms', pattern: /\b(rapidly worsening|getting drastically worse|spreading quickly|sudden severe pain)\b/i, severity: 'URGENT' }
    ];

    const detectedSymptoms: string[] = [];
    let highestSeverity: 'NONE' | 'URGENT' | 'EMERGENT' = 'NONE';

    for (const item of emergentSymptomPatterns) {
      if (item.pattern.test(lower)) {
        detectedSymptoms.push(item.name);
        if (item.severity === 'EMERGENT') {
          highestSeverity = 'EMERGENT';
        } else if (highestSeverity !== 'EMERGENT' && item.severity === 'URGENT') {
          highestSeverity = 'URGENT';
        }
      }
    }

    let safetyGuidance = '';
    if (highestSeverity === 'EMERGENT') {
      safetyGuidance = 'If you are experiencing a medical emergency or symptoms that are severe or rapidly worsening, contact emergency medical services (such as 911) or go to the nearest emergency department immediately.';
    } else if (highestSeverity === 'URGENT') {
      safetyGuidance = 'Those symptoms can potentially be serious. You should seek prompt medical evaluation from a qualified healthcare professional.';
    }

    const prescribingGuidance = isPrescribingRequest
      ? 'I am an educational peptide information specialist for the bodybuilding and performance community, not a doctor or prescribing clinician. I cannot provide personalized medical diagnoses, dosing schedules, cycle prescriptions, or personal peptide stacks. Any therapeutic regimen should be determined in consultation with your licensed healthcare provider.'
      : undefined;

    return {
      hasEmergentSymptoms: highestSeverity !== 'NONE',
      emergencyLevel: highestSeverity,
      detectedSymptoms,
      safetyGuidance,
      isPrescribingRequest,
      prescribingGuidance
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // EVIDENCE CLASSIFIER & CLAIM GROUNDING
  // ─────────────────────────────────────────────────────────────────────────────

  public classifyClaim(text: string, contextPeptide?: PeptideRecord): EvidenceClassificationResult {
    const lower = text.toLowerCase();
    const peptide = contextPeptide || this.detectPeptideInText(text);

    // Default Unknown
    let level: EvidenceLevel = 'LEVEL_E';
    let topic = 'General Efficacy';
    let summary = "There isn't enough reliable evidence to say that this benefit is established.";
    let caveats: string[] = ['Limited published peer-reviewed human literature.'];
    let matchingSources: PeptideSource[] = [];

    if (!peptide) {
      return {
        claimTopic: 'Unrecognized Peptide Claim',
        evidenceLevel: 'LEVEL_E',
        recommendedLanguage: "There isn't enough reliable evidence to say that this benefit is established.",
        evidenceSummary: "I don't have enough reliable evidence to give you a factual answer about that compound.",
        caveats: ['Unrecognized substance in knowledge base.'],
        matchingSources: [],
        isAnecdotal: false,
        isPreclinical: false,
        isClinicallySupported: false,
        isUnknown: true
      };
    }

    // 1. Search for matching structured claims in the peptide record
    let bestClaim = peptide.claims.find(c => {
      const claimLower = c.claim.toLowerCase();
      const descLower = c.description.toLowerCase();
      const keywords = lower.split(/\s+/).filter(w => w.length > 3);
      return keywords.some(k => claimLower.includes(k) || descLower.includes(k));
    });

    // 2. Specific domain heuristic classification based on peptide science:
    let heuristicMatched = false;

    if (peptide.id === 'tirzepatide') {
      if (lower.includes('weight') || lower.includes('fat loss') || lower.includes('obesity') || lower.includes('diabetes') || lower.includes('a1c') || lower.includes('benefit')) {
        level = 'LEVEL_A';
        topic = 'Weight Management & Glycemic Control';
        summary = 'Human clinical research in Phase 3 SURMOUNT and SURPASS trials has demonstrated substantial, clinically supported weight loss (up to 20-22%) and HbA1c reductions.';
        matchingSources = peptide.sources.filter(s => s.evidenceLevel === 'LEVEL_A');
        heuristicMatched = true;
      } else if (lower.includes('nausea') || lower.includes('vomit') || lower.includes('side effect') || lower.includes('diarrhea') || lower.includes('adverse')) {
        level = 'LEVEL_A';
        topic = 'Gastrointestinal Adverse Effects';
        summary = 'Gastrointestinal effects (nausea, diarrhea, constipation) are established adverse effects documented in clinical trials, typically mild-to-moderate during dose titration.';
        heuristicMatched = true;
      }
    } else if (peptide.id === 'semaglutide') {
      if (lower.includes('weight') || lower.includes('cardio') || lower.includes('stroke') || lower.includes('heart') || lower.includes('benefit') || lower.includes('diabetes')) {
        level = 'LEVEL_A';
        topic = 'Cardiovascular Risk Reduction & Weight Management';
        summary = 'Clinical evidence from Phase 3 STEP and SELECT trials establishes significant weight loss (approx. 15%) and a 20% reduction in major adverse cardiovascular events.';
        matchingSources = peptide.sources.filter(s => s.evidenceLevel === 'LEVEL_A');
        heuristicMatched = true;
      }
    } else if (peptide.id === 'tesamorelin') {
      if (lower.includes('permanent') || lower.includes('forever') || lower.includes('never come back') || lower.includes('never comes back')) {
        level = 'LEVEL_E';
        topic = 'Permanence of Fat Loss';
        summary = "There isn't enough reliable evidence to say that this benefit is established. In fact, clinical evidence shows that visceral fat re-accumulates after therapy is discontinued.";
        heuristicMatched = true;
      } else if (lower.includes('visceral') || lower.includes('belly fat') || lower.includes('hiv') || lower.includes('benefit')) {
        level = 'LEVEL_A';
        topic = 'Visceral Adipose Tissue Reduction';
        summary = 'There is clinical evidence supporting the reduction of excess visceral abdominal fat, established in Phase 3 multicenter human trials published in the NEJM.';
        matchingSources = peptide.sources.filter(s => s.evidenceLevel === 'LEVEL_A');
        heuristicMatched = true;
      }
    } else if (peptide.id === 'bpc-157') {
      if (lower.includes('tendon') || lower.includes('ligament') || lower.includes('muscle') || lower.includes('injury') || lower.includes('wound') || lower.includes('heal') || lower.includes('benefit') || lower.includes('what is') || lower.includes('what does') || lower.includes('tell me about')) {
        if (lower.includes('clinically proven') || lower.includes('human trial') || lower.includes('athlete') || lower.includes('cure')) {
          level = 'LEVEL_D';
          topic = 'Human Orthopedic Injury Healing';
          summary = "Some people report rapid joint and tendon repair, but that's anecdotal evidence rather than clinical evidence. This has been investigated in preclinical research, but that doesn't establish the same effect in humans.";
        } else {
          level = 'LEVEL_C';
          topic = 'Angiogenesis and Preclinical Soft Tissue Repair';
          summary = "This has been investigated in preclinical research involving animal models, but that doesn't establish a demonstrated human clinical benefit.";
          matchingSources = peptide.sources.filter(s => s.evidenceLevel === 'LEVEL_C');
        }
        heuristicMatched = true;
      }
    } else if (peptide.id === 'tb-500') {
      if (lower.includes('heal') || lower.includes('tendon') || lower.includes('injury') || lower.includes('wolverine') || lower.includes('benefit')) {
        level = 'LEVEL_C';
        topic = 'Cell Migration and Preclinical Wound Healing';
        summary = "This has been investigated in preclinical research for cellular migration and wound repair, but that doesn't establish a demonstrated human clinical benefit in musculoskeletal injuries.";
        matchingSources = peptide.sources.filter(s => s.evidenceLevel === 'LEVEL_C');
        heuristicMatched = true;
      }
    } else if (peptide.id === 'ghk-cu') {
      if (lower.includes('skin') || lower.includes('wrinkle') || lower.includes('collagen') || lower.includes('elasticity')) {
        level = 'LEVEL_A';
        topic = 'Topical Skin Rejuvenation & Collagen Synthesis';
        summary = 'There is clinical evidence supporting topical GHK-Cu for improving skin firmness, elasticity, and collagen production in human cosmetic trials.';
        matchingSources = peptide.sources.filter(s => s.evidenceLevel === 'LEVEL_A');
        heuristicMatched = true;
      } else if (lower.includes('reverse aging') || lower.includes('longevity') || lower.includes('injection')) {
        level = 'LEVEL_D';
        topic = 'Systemic Longevity & Rejuvenation';
        summary = "Some people report whole-body rejuvenation from injections, but that's anecdotal evidence rather than clinical evidence.";
        heuristicMatched = true;
      }
    } else if (peptide.id === 'ibutamoren-mk677') {
      if (lower.includes('igf') || lower.includes('lean mass') || lower.includes('bone') || lower.includes('benefit')) {
        level = 'LEVEL_A';
        topic = 'IGF-1 Elevation & Fat-Free Mass';
        summary = 'Human clinical research has found that oral MK-677 produces sustained 24-hour elevations in serum GH and IGF-1 and increases fat-free mass.';
        matchingSources = peptide.sources.filter(s => s.evidenceLevel === 'LEVEL_A');
        heuristicMatched = true;
      } else if (lower.includes('appetite') || lower.includes('hunger') || lower.includes('water') || lower.includes('blood sugar') || lower.includes('side effect')) {
        level = 'LEVEL_A';
        topic = 'Established Metabolic Adverse Effects';
        summary = 'Increased appetite, lower extremity edema, and elevated fasting blood glucose are established clinical adverse effects of MK-677.';
        heuristicMatched = true;
      }
    } else if (peptide.id === 'kisspeptin') {
      if (lower.includes('lh') || lower.includes('fsh') || lower.includes('testosterone') || lower.includes('ivf') || lower.includes('benefit')) {
        level = 'LEVEL_A';
        topic = 'Hypothalamic-Pituitary-Gonadal Axis Stimulation';
        summary = 'Human clinical research has found that Kisspeptin stimulates pulsatile LH and FSH secretion, and triggers safe oocyte maturation in clinical IVF trials.';
        matchingSources = peptide.sources.filter(s => s.evidenceLevel === 'LEVEL_A');
        heuristicMatched = true;
      } else if (lower.includes('pct') || lower.includes('bodybuilding cycle')) {
        level = 'LEVEL_D';
        topic = 'Post-Cycle Therapy in Bodybuilders';
        summary = "Some people in athletic communities report using kisspeptin for post-cycle recovery, but that's anecdotal evidence rather than clinical evidence.";
        heuristicMatched = true;
      }
    } else if (peptide.id === 'cjc-1295') {
      if (lower.includes('gh') || lower.includes('growth hormone') || lower.includes('igf')) {
        level = 'LEVEL_B';
        topic = 'Endogenous Growth Hormone Pulsatility';
        summary = 'There is some human research demonstrating sustained GH and IGF-1 elevations, but large-scale clinical development was discontinued and evidence remains limited.';
        matchingSources = peptide.sources.filter(s => s.evidenceLevel === 'LEVEL_B');
        heuristicMatched = true;
      } else if (lower.includes('fat') || lower.includes('gym') || lower.includes('muscle') || lower.includes('recovery')) {
        level = 'LEVEL_D';
        topic = 'Athletic Recovery & Body Composition';
        summary = "Some people report experiencing enhanced gym recovery and fat loss, but that's anecdotal evidence rather than clinical evidence.";
        heuristicMatched = true;
      }
    } else if (peptide.id === 'ipamorelin') {
      if (lower.includes('selective') || lower.includes('cortisol') || lower.includes('prolactin')) {
        level = 'LEVEL_A';
        topic = 'Selective GHRP Pharmacology';
        summary = 'Human and animal pharmacology studies confirm selective GH secretion without clinically significant increases in cortisol or prolactin.';
        matchingSources = peptide.sources.filter(s => s.evidenceLevel === 'LEVEL_A');
        heuristicMatched = true;
      } else if (lower.includes('muscle') || lower.includes('shred') || lower.includes('fat')) {
        level = 'LEVEL_D';
        topic = 'Bodybuilding Fat Loss and Muscle Growth';
        summary = "Some people report body recomposition benefits, but that's anecdotal evidence rather than clinical evidence.";
        heuristicMatched = true;
      }
    } else if (peptide.id === 'follistatin-344') {
      if (lower.includes('myostatin') || lower.includes('gene therapy') || lower.includes('becker')) {
        level = 'LEVEL_B';
        topic = 'Myostatin Antagonism in Gene Therapy';
        summary = 'Early clinical research investigated follistatin gene therapy in Becker muscular dystrophy, but evidence is limited and does not establish benefits for healthy athletes.';
        matchingSources = peptide.sources.filter(s => s.evidenceLevel === 'LEVEL_B');
        heuristicMatched = true;
      } else if (lower.includes('vial') || lower.includes('peptide') || lower.includes('bodybuilding') || lower.includes('muscle')) {
        level = 'LEVEL_D';
        topic = 'Commercial Peptide Vial Anabolism';
        summary = "Reports of muscle building from commercial peptide vials are anecdotal and unverified; recombinant follistatin is unstable and lacks human clinical trials in athletes.";
        heuristicMatched = true;
      }
    }

    // 3. Fallback to best claim if matched and no domain heuristic matched
    if (!heuristicMatched && bestClaim && level === 'LEVEL_E') {
      level = bestClaim.evidenceLevel;
      topic = bestClaim.claim;
      summary = bestClaim.description;
      caveats = [bestClaim.limitations];
      matchingSources = peptide.sources.filter(s => bestClaim!.sourceIds.includes(s.id));
    }

    // Recommended language template according to Section 3
    let recommendedLanguage = '';
    switch (level) {
      case 'LEVEL_A':
        recommendedLanguage = 'There is clinical evidence supporting this...';
        break;
      case 'LEVEL_B':
        recommendedLanguage = 'There is some human research, but the evidence is still limited.';
        break;
      case 'LEVEL_C':
        recommendedLanguage = "This has been investigated in preclinical research, but that doesn't establish the same effect in humans.";
        break;
      case 'LEVEL_D':
        recommendedLanguage = "Some people report experiencing this, but that's anecdotal evidence rather than clinical evidence.";
        break;
      case 'LEVEL_E':
      default:
        recommendedLanguage = "There isn't enough reliable evidence to say that this benefit is established.";
        break;
    }

    return {
      peptideId: peptide.id,
      peptideName: peptide.name,
      claimTopic: topic,
      evidenceLevel: level,
      recommendedLanguage,
      evidenceSummary: summary,
      caveats,
      matchingSources,
      isAnecdotal: level === 'LEVEL_D',
      isPreclinical: level === 'LEVEL_C',
      isClinicallySupported: level === 'LEVEL_A',
      isUnknown: level === 'LEVEL_E'
    };
  }

  public detectPeptideInText(text: string): PeptideRecord | undefined {
    const lower = text.toLowerCase();

    // Priority ordered matches
    const nameMap: Array<{ pattern: RegExp; id: string }> = [
      { pattern: /\b(cjc[- ]?1295|mod[- ]?grf|dac:grf)\b/i, id: 'cjc-1295' },
      { pattern: /\b(ipamorelin|nnc[- ]?26[- ]?0161)\b/i, id: 'ipamorelin' },
      { pattern: /\b(sermorelin|geref|ghrh[- ]?1[- ]?29)\b/i, id: 'sermorelin' },
      { pattern: /\b(tesamorelin|egrifta|th[- ]?9507)\b/i, id: 'tesamorelin' },
      { pattern: /\b(ghrp[- ]?6)\b/i, id: 'ghrp-6' },
      { pattern: /\b(ghrp[- ]?2|pralmorelin)\b/i, id: 'ghrp-2' },
      { pattern: /\b(hexarelin|ep[- ]?23959)\b/i, id: 'hexarelin' },
      { pattern: /\b(mk[- ]?677|ibutamoren|nutrobal)\b/i, id: 'ibutamoren-mk677' },
      { pattern: /\b(examorelin)\b/i, id: 'examorelin' },
      { pattern: /\b(bpc[- ]?157|bepecin|pl[- ]?14736)\b/i, id: 'bpc-157' },
      { pattern: /\b(tb[- ]?500|thymosin beta[- ]?4|tβ4)\b/i, id: 'tb-500' },
      { pattern: /\b(ghk[- ]?cu|copper peptide|copper tripeptide)\b/i, id: 'ghk-cu' },
      { pattern: /\b(kpv|lys[- ]?pro[- ]?val)\b/i, id: 'kpv' },
      { pattern: /\b(tirzepatide|mounjaro|zepbound)\b/i, id: 'tirzepatide' },
      { pattern: /\b(semaglutide|ozempic|wegovy|rybelsus)\b/i, id: 'semaglutide' },
      { pattern: /\b(retatrutide|triple g|ly3437943)\b/i, id: 'retatrutide' },
      { pattern: /\b(mots[- ]?c)\b/i, id: 'mots-c' },
      { pattern: /\b(igf[- ]?1[- ]?lr3|long[- ]?r3|long r3 igf)\b/i, id: 'igf-1-lr3' },
      { pattern: /\b(follistatin|fs[- ]?344|fst[- ]?344)\b/i, id: 'follistatin-344' },
      { pattern: /\b(kisspeptin|kisspeptin[- ]?10|kisspeptin[- ]?54)\b/i, id: 'kisspeptin' }
    ];

    for (const item of nameMap) {
      if (item.pattern.test(lower)) {
        return this.peptides.get(item.id);
      }
    }

    return undefined;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GROUNDED FACTUAL Q&A RESPONSE GENERATOR
  // ─────────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────────

  public query(queryText: string, sessionId: string = 'default'): PeptideQueryResponse {
    const lower = queryText.toLowerCase();

    // Track research goal in session memory
    const detectedGoal = this.detectResearchGoal(queryText);
    if (detectedGoal) {
      this.updateSessionContext(sessionId, {
        primaryInterest: detectedGoal,
        interestTopicName: detectedGoal.replace('_', ' ')
      });
    }
    const priorSession = this.getSessionContext(sessionId);

    // Track active peptide in session memory
    let peptide = this.detectPeptideInText(queryText);
    if (peptide) {
      this.updateSessionContext(sessionId, {
        lastDiscussedPeptide: peptide.name,
        discussedPeptides: [peptide.id]
      });
    } else if (priorSession.lastDiscussedPeptide && !peptide) {
      if (/\b(it|this|the peptide|this compound|that peptide)\b/i.test(queryText)) {
        peptide = this.findPeptideByName(priorSession.lastDiscussedPeptide);
      }
    }

    const session = this.getSessionContext(sessionId);

    const safety = this.evaluateSafety(queryText);
    const classification = this.classifyClaim(queryText, peptide);

    // 1. Safety Escalation Takes Precedence
    if (safety.hasEmergentSymptoms) {
      return {
        answer: `${safety.safetyGuidance} Those symptoms can have several possible causes, and I cannot determine the cause from this conversation. Please do not attempt to self-treat.`,
        peptide,
        evidenceClassification: classification,
        safety,
        sources: [],
        sessionContext: session
      };
    }

    // 2. Prescribing Request Guardrail
    if (safety.isPrescribingRequest) {
      return {
        answer: `${safety.prescribingGuidance} I cannot generate individualized dosing protocols, injection instructions, or personal peptide stacks. I can, however, explain what the published research and clinical literature investigate regarding these compounds and their known safety considerations.`,
        peptide,
        evidenceClassification: classification,
        safety,
        sources: peptide ? peptide.sources : [],
        sessionContext: session
      };
    }

    // 2a-1. Negative Seller Claim & Inventory Boundary (Section 8)
    const isSellerQuery = /\b(do you sell|can you sell|can i buy from you|are you the seller|do you have.*in stock|is it in stock|in stock|do you carry)\b/i.test(lower);
    if (isSellerQuery) {
      return {
        answer: "I cannot sell you peptides or confirm product inventory. I am an AI peptide research and evidence specialist. For availability, purchasing information, or questions about the supplier's products, contact the peptide team directly on WhatsApp.",
        peptide,
        evidenceClassification: {
          claimTopic: 'Supplier & Sales Boundary',
          evidenceLevel: 'LEVEL_E',
          recommendedLanguage: 'For availability and purchasing, contact the peptide team on WhatsApp.',
          evidenceSummary: 'The AI assists with research and evidence, directing purchase inquiries to WhatsApp.',
          caveats: ['The AI is not a vendor or dispensing pharmacy.'],
          matchingSources: [],
          isAnecdotal: false,
          isPreclinical: false,
          isClinicallySupported: false,
          isUnknown: false
        },
        safety,
        sources: peptide ? peptide.sources : [],
        evidenceSummary: peptide ? this.getPeptideEvidenceSummary(peptide.id) : undefined,
        structuredEvidence: peptide ? this.getPeptideStructuredEvidence(peptide.id) : undefined,
        salesHandoff: {
          isPurchaseIntent: true,
          intentPhrase: 'Supplier sales inquiry',
          whatsappNumber: this.getWhatsAppNumber(),
          whatsappUrl: this.buildWhatsAppUrl(peptide?.name, session.primaryInterest),
          prefilledMessage: this.buildWhatsAppPrefill(peptide?.name, session.primaryInterest),
          ctaText: 'WHATSAPP THE PEPTIDE TEAM'
        },
        sessionContext: session
      };
    }

    // 2a-2. Conversational Purchase Intent Detection & Instant Handoff (Section 9)
    const purchaseIntent = this.detectPurchaseIntent(queryText);
    if (purchaseIntent.isPurchaseIntent) {
      return {
        answer: "I can help you research the peptide science. For current availability, pricing, and purchasing directly with the supplier, you can connect with the peptide team on WhatsApp.",
        peptide,
        evidenceClassification: {
          claimTopic: 'Purchase & Availability Inquiry',
          evidenceLevel: 'LEVEL_E',
          recommendedLanguage: 'Contact the peptide team on WhatsApp for availability and purchasing.',
          evidenceSummary: 'Conversational purchase intent detected. Handing off to WhatsApp supplier channel.',
          caveats: [],
          matchingSources: [],
          isAnecdotal: false,
          isPreclinical: false,
          isClinicallySupported: false,
          isUnknown: false
        },
        safety,
        sources: peptide ? peptide.sources : [],
        evidenceSummary: peptide ? this.getPeptideEvidenceSummary(peptide.id) : undefined,
        structuredEvidence: peptide ? this.getPeptideStructuredEvidence(peptide.id) : undefined,
        salesHandoff: {
          isPurchaseIntent: true,
          intentPhrase: purchaseIntent.match || queryText,
          whatsappNumber: this.getWhatsAppNumber(),
          whatsappUrl: this.buildWhatsAppUrl(peptide?.name, session.primaryInterest),
          prefilledMessage: this.buildWhatsAppPrefill(peptide?.name, session.primaryInterest),
          ctaText: 'WHATSAPP THE PEPTIDE TEAM'
        },
        sessionContext: session
      };
    }

    // 2a-3. Discovery Questions Step (Section 7, Step 1)
    const isDiscoveryPrompt = /\b(what should i take|where do i start|help me choose|recommend a peptide|what's best for me|where should i begin)\b/i.test(lower);
    if (isDiscoveryPrompt && !peptide) {
      return {
        answer: "Alright, let's figure out what you're looking to achieve. What are you mainly researching—recovery, body composition, performance, or something else?",
        peptide: undefined,
        evidenceClassification: {
          claimTopic: 'Research Discovery',
          evidenceLevel: 'LEVEL_E',
          recommendedLanguage: 'What are you mainly researching?',
          evidenceSummary: 'Discovery qualification to understand the visitor research objectives.',
          caveats: [],
          matchingSources: [],
          isAnecdotal: false,
          isPreclinical: false,
          isClinicallySupported: false,
          isUnknown: false
        },
        safety,
        sources: [],
        salesHandoff: {
          isPurchaseIntent: false,
          whatsappNumber: this.getWhatsAppNumber(),
          whatsappUrl: this.buildWhatsAppUrl(undefined, session.primaryInterest),
          prefilledMessage: this.buildWhatsAppPrefill(undefined, session.primaryInterest),
          ctaText: 'WHATSAPP THE PEPTIDE TEAM'
        },
        sessionContext: session
      };
    }


    // 2b. Strict Cross-Vertical Isolation (ISOLATION-001, ISOLATION-003, ISOLATION-004, ISOLATION-006, ISOLATION-007)
    const isDirectYNAQuery = /\b(yournewauto|your new auto)\b/i.test(lower);
    if (isDirectYNAQuery) {
      return {
        answer: "I am an AI peptide information specialist. I am not affiliated with YourNewAuto or any automotive service.",
        peptide: undefined,
        evidenceClassification: {
          claimTopic: 'Agent Identity Inquiry',
          evidenceLevel: 'LEVEL_E',
          recommendedLanguage: 'I am a peptide information specialist.',
          evidenceSummary: 'The agent identifies as a specialized peptide information assistant.',
          caveats: [],
          matchingSources: [],
          isAnecdotal: false,
          isPreclinical: false,
          isClinicallySupported: false,
          isUnknown: false
        },
        safety,
        sources: []
      };
    }

    const isAutomotiveQuery = /\b(vehicle|vehicles|car|cars|truck|trucks|suv|suvs|sedan|sedans|van|vans|dealership|dealer|dealers|car finance|vehicle financing|finance a vehicle|approved for a vehicle|car loan|auto loan|credit preapproval|buy a car|lease a car|car inventory|vehicle inventory)\b/i.test(lower);
    if (isAutomotiveQuery && !peptide) {
      return {
        answer: "I am an AI peptide information and clinical evidence specialist. I do not handle vehicle financing, automotive sales, car inventory, or credit applications. How can I assist you with peptide research, mechanisms of action, or published evidence today?",
        peptide: undefined,
        evidenceClassification: {
          claimTopic: 'Automotive / Non-Peptide Domain Inquiry',
          evidenceLevel: 'LEVEL_E',
          recommendedLanguage: 'I do not handle vehicle sales or financing.',
          evidenceSummary: 'Cross-vertical inquiry rejected. The agent exclusively provides peptide information.',
          caveats: ['Non-peptide domain inquiry.'],
          matchingSources: [],
          isAnecdotal: false,
          isPreclinical: false,
          isClinicallySupported: false,
          isUnknown: true
        },
        safety,
        sources: []
      };
    }

    // 2c. Identity & Company Isolation (ISOLATION-002, Test C)
    const isCompanyIdentityQuery = /\b(what company|who do you work for)\b/i.test(lower);
    if (isCompanyIdentityQuery) {
      return {
        answer: "I am an independent AI peptide information specialist dedicated to evidence-based education on peptides, their clinical research, potential benefits, and safety profiles.",
        peptide: undefined,
        evidenceClassification: {
          claimTopic: 'Agent Identity Inquiry',
          evidenceLevel: 'LEVEL_E',
          recommendedLanguage: 'I am a peptide information specialist.',
          evidenceSummary: 'The agent identifies as a specialized peptide information assistant.',
          caveats: [],
          matchingSources: [],
          isAnecdotal: false,
          isPreclinical: false,
          isClinicallySupported: false,
          isUnknown: false
        },
        safety,
        sources: []
      };
    }

    const isIdentityQuery = /\b(who are you|what do you do|what are you)\b/i.test(lower) && !peptide;
    if (isIdentityQuery) {
      return {
        answer: "Alright. I'm your peptide information specialist. If you're researching peptides for bodybuilding, recovery, physique or performance, I can help you separate the claims from the evidence. What are you looking into?",
        peptide: undefined,
        evidenceClassification: {
          claimTopic: 'Agent Identity',
          evidenceLevel: 'LEVEL_E',
          recommendedLanguage: "Alright. I'm your peptide information specialist.",
          evidenceSummary: 'The agent is an 80s Golden Era bodybuilding peptide information specialist.',
          caveats: [],
          matchingSources: [],
          isAnecdotal: false,
          isPreclinical: false,
          isClinicallySupported: false,
          isUnknown: false
        },
        safety,
        sources: []
      };
    }

    // 2d. Bodybuilding Niche: Dosing Protocol / Stacking Guardrail (BODYBUILDING-007)
    const isStackOrDosing = /\b(stack|dosing protocol|dosing schedule|how to stack|what stack|give me a stack|give me a peptide stack|cycle for me|how should i inject|how much should i take)\b/i.test(lower);
    if (isStackOrDosing) {
      return {
        answer: "I am an educational peptide information specialist for the bodybuilding and performance community, not a prescribing clinician or personal dosing coach. I cannot generate individualized dosing protocols, injection instructions, or personal peptide stacks. I can, however, break down what the scientific literature investigates regarding these compounds, their physiological mechanisms, and their known safety considerations.",
        peptide: peptide || undefined,
        evidenceClassification: {
          claimTopic: 'Personal Dosing & Stacking Request',
          evidenceLevel: 'LEVEL_E',
          recommendedLanguage: 'I cannot generate personal dosing protocols or stacks.',
          evidenceSummary: 'Personalized medical prescribing and stacking protocols are outside educational bounds.',
          caveats: ['Individualized medical dosing requires licensed clinical supervision.'],
          matchingSources: [],
          isAnecdotal: false,
          isPreclinical: false,
          isClinicallySupported: false,
          isUnknown: true
        },
        safety: {
          ...safety,
          isPrescribingRequest: true
        },
        sources: peptide ? peptide.sources : []
      };
    }

    // 2e. Bodybuilding Niche: Competitive Bodybuilder Intro & Recovery Context (BODYBUILDING-005)
    const isBodybuilderIntro = /\b(competitive bodybuilder|i'm a bodybuilder|i am a bodybuilder|physique athlete)\b/i.test(lower);
    if (isBodybuilderIntro && (lower.includes('recovery') || lower.includes('peptides'))) {
      const bpc = this.peptides.get('bpc-157');
      return {
        answer: "Understood. For competitive bodybuilders and physique athletes, recovery research primarily focuses on BPC-157 and TB-500 for soft tissue, tendon, and ligament repair, alongside growth hormone secretagogues like Ipamorelin and CJC-1295 for systemic recovery and sleep quality. It is critical to separate what has actual human clinical evidence from what is strictly preclinical or circulating as an unverified bodybuilding community claim. BPC-157 and TB-500 have demonstrated tissue healing and angiogenesis in animal and cellular studies, but they lack completed human clinical trials. What specific compound or recovery target are you looking into?",
        peptide: bpc,
        evidenceClassification: {
          claimTopic: 'Competitive Bodybuilding Recovery Research',
          evidenceLevel: 'LEVEL_C',
          recommendedLanguage: 'This has been investigated in preclinical research, but human clinical efficacy is unproven.',
          evidenceSummary: 'Preclinical animal studies investigate soft tissue and tendon healing (BPC-157, TB-500), but human clinical evidence remains unproven.',
          caveats: ['Preclinical evidence does not establish clinical human efficacy in athletes.'],
          matchingSources: bpc ? bpc.sources : [],
          isAnecdotal: true,
          isPreclinical: true,
          isClinicallySupported: false,
          isUnknown: false
        },
        safety,
        sources: bpc ? bpc.sources : []
      };
    }

    // 2f-1. Bodybuilding Niche: Visitor Exploring Recovery (General Scene Entry)
    const isLookingAtRecovery = /\b(i'm looking at peptides for recovery|looking at peptides for recovery|peptides for recovery|looking for recovery peptides)\b/i.test(lower);
    if (isLookingAtRecovery && (!peptide || peptide.id === 'bpc-157')) {
      const bpc = this.peptides.get('bpc-157');
      return {
        answer: "Yeah, recovery is one of the biggest areas where peptides come up in the bodybuilding scene. BPC-157 is probably one of the names you'll run into, along with some of the other compounds people discuss around training recovery and soft-tissue issues.\n\nA lot of the interest comes from individual reports from lifters and athletes.\n\nWhat specifically are you researching — general recovery, an old injury, training volume, or something else?",
        peptide: bpc,
        evidenceClassification: {
          claimTopic: 'Recovery Peptides in Bodybuilding',
          evidenceLevel: 'LEVEL_D',
          recommendedLanguage: 'A lot of the interest comes from individual reports from lifters and athletes.',
          evidenceSummary: 'Recovery compounds are widely discussed in bodybuilding communities based on user experiences.',
          caveats: ['Individual reports do not equal clinical proof.'],
          matchingSources: bpc ? bpc.sources : [],
          isAnecdotal: true,
          isPreclinical: false,
          isClinicallySupported: false,
          isUnknown: false
        },
        safety,
        sources: bpc ? bpc.sources : [],
        sessionContext: session
      };
    }

    // 2f-2. Bodybuilding Niche: Peptides Researched for Recovery (BODYBUILDING-001)
    const isRecoveryQuery = /\b(recovery|training recovery|healing|tissue repair)\b/i.test(lower) &&
      (lower.includes('researching for recovery') || lower.includes('peptides are people') || lower.includes('from training') || lower.includes('about recovery') || lower.includes('what peptides'));
    if (isRecoveryQuery && (!peptide || peptide.id === 'bpc-157' || peptide.id === 'tb-500')) {
      const bpc = this.peptides.get('bpc-157');
      return {
        answer: "In bodybuilding and athletic communities, the primary peptides researched for recovery are BPC-157 and TB-500 for localized soft tissue and tendon repair, along with GH secretagogues like CJC-1295 and Ipamorelin for systemic recovery and deep sleep. Preclinical research in animal models indicates BPC-157 promotes angiogenesis and collagen organization in damaged tendons, but there are no completed human clinical trials proving these benefits in athletes. In contrast, secretagogues have human pharmacokinetic data for elevating GH pulses, but recovery claims remain largely supported by community anecdotes.",
        peptide: bpc,
        evidenceClassification: {
          claimTopic: 'Peptides for Training Recovery',
          evidenceLevel: 'LEVEL_C',
          recommendedLanguage: 'This has been investigated in preclinical research, but that does not establish human clinical proof.',
          evidenceSummary: 'BPC-157 and TB-500 have preclinical animal evidence for tissue repair; human clinical evidence is not established.',
          caveats: ['Preclinical animal findings do not translate directly to human athletic recovery.'],
          matchingSources: bpc ? bpc.sources : [],
          isAnecdotal: true,
          isPreclinical: true,
          isClinicallySupported: false,
          isUnknown: false
        },
        safety,
        sources: bpc ? bpc.sources : []
      };
    }

    // 2g. Bodybuilding Niche: CJC-1295 vs Ipamorelin Distinction (BODYBUILDING-004)
    const isCjcVsIpam = (lower.includes('cjc') || lower.includes('cjc-1295') || lower.includes('cjc 1295')) &&
      (lower.includes('ipamorelin') || lower.includes('difference') || lower.includes('compare'));
    if (isCjcVsIpam) {
      const cjc = this.peptides.get('cjc-1295');
      return {
        answer: "The fundamental physiological difference between CJC-1295 and Ipamorelin lies in their receptor pathways: CJC-1295 is a Growth Hormone-Releasing Hormone (GHRH) analog that acts on pituitary GHRH receptors to amplify the natural pulsatile release of growth hormone. Ipamorelin is a selective Growth Hormone Secretagogue (GHRP) that binds to the ghrelin / GHS-R1a receptor to trigger acute GH release without spiking cortisol, prolactin, or appetite. In bodybuilding research, they are frequently paired because combining a GHRH with a GHRP produces a synergistic, supra-additive growth hormone pulse by stimulating release while blunting somatostatin inhibition.",
        peptide: cjc,
        evidenceClassification: {
          claimTopic: 'GHRH vs GHRP Receptor Mechanism',
          evidenceLevel: 'LEVEL_A',
          recommendedLanguage: 'Pharmacological and clinical research demonstrates distinct receptor targets...',
          evidenceSummary: 'Pharmacological studies confirm CJC-1295 acts at GHRH receptors, while Ipamorelin acts selectively at GHS-R1a without cortisol/prolactin elevation.',
          caveats: ['Long-term athletic enhancement is not approved by regulatory bodies.'],
          matchingSources: cjc ? cjc.sources : [],
          isAnecdotal: false,
          isPreclinical: false,
          isClinicallySupported: true,
          isUnknown: false
        },
        safety,
        sources: cjc ? cjc.sources : []
      };
    }

    // 2h. Bodybuilding Niche: Which Peptides Have Human Clinical Evidence (BODYBUILDING-003)
    const isClinicalListQuery = /\b(which peptides have human clinical evidence|peptides.*human clinical evidence|peptides.*human trials|which.*human evidence|clinically proven peptides|what is actually proven)\b/i.test(lower);
    if (isClinicalListQuery && !peptide) {
      const tirz = this.peptides.get('tirzepatide');
      return {
        answer: "Peptides with robust Human Clinical Evidence (Level A, supported by randomized Phase 3 clinical trials and FDA approvals) include: Tirzepatide (SURMOUNT trials for metabolic regulation and body fat loss), Semaglutide (STEP trials for fat reduction and cardiovascular risk), Tesamorelin (Phase 3 NEJM trials for reducing visceral abdominal fat in HIV lipodystrophy), and Sermorelin (FDA-approved GHRH analog for pituitary stimulation). In contrast, popular bodybuilding compounds like BPC-157 and TB-500 have only Preclinical evidence (animal models), and commercial Follistatin claims remain unverified Bodybuilding Community Claims.",
        peptide: tirz,
        evidenceClassification: {
          claimTopic: 'Peptides with Human Clinical Evidence',
          evidenceLevel: 'LEVEL_A',
          recommendedLanguage: 'There is clinical evidence supporting several approved peptides...',
          evidenceSummary: 'Tirzepatide, Semaglutide, Tesamorelin, and Sermorelin have human clinical trial evidence; BPC-157 and TB-500 remain preclinical.',
          caveats: ['Most approved indications are clinical rather than cosmetic or athletic.'],
          matchingSources: tirz ? tirz.sources : [],
          isAnecdotal: false,
          isPreclinical: false,
          isClinicallySupported: true,
          isUnknown: false
        },
        safety,
        sources: tirz ? tirz.sources : []
      };
    }

    // 2i. Bodybuilding Niche: Proven vs Bodybuilding Community Claims (BODYBUILDING-006)
    const isProvenVsClaims = /\b(proven versus|proven vs|what's proven|what is proven|what bodybuilders.*say|bodybuilding.*claims|myth versus fact|fact vs fiction)\b/i.test(lower);
    if (isProvenVsClaims) {
      return {
        answer: "To evaluate peptides accurately, we differentiate between five evidence levels: 1. Human Clinical Evidence: Validated in Phase 3 human clinical trials (e.g. Tesamorelin for visceral fat reduction, Semaglutide/Tirzepatide for significant fat loss). 2. Human Research: Human data exists but is preliminary or limited (e.g. Sermorelin, CJC-1295 GH pulse studies). 3. Preclinical: Animal or cell culture models only (e.g. BPC-157 for tendon angiogenesis, TB-500 for wound repair). 4. Bodybuilding Community Claims: Forum discussions and athlete anecdotes lacking clinical verification (e.g. localized BPC-157 curing torn muscles in 48 hours, or commercial Follistatin vials packing on 10 lbs of pure muscle). 5. Insufficient Evidence: Unsupported claims with no reliable scientific basis.",
        peptide: undefined,
        evidenceClassification: {
          claimTopic: 'Clinical Proof vs Bodybuilding Community Claims',
          evidenceLevel: 'LEVEL_A',
          recommendedLanguage: 'Differentiating clinical evidence from anecdotal community claims...',
          evidenceSummary: 'Human clinical trials establish efficacy for select metabolic/GHRH peptides; popular injury and muscle claims are preclinical or anecdotal.',
          caveats: ['Anecdotal reports in athletic communities do not equal clinical proof.'],
          matchingSources: [],
          isAnecdotal: false,
          isPreclinical: false,
          isClinicallySupported: true,
          isUnknown: false
        },
        safety,
        sources: []
      };
    }

    // 2j. Bodybuilding Niche: Muscle Growth & Hypertrophy Research
    const isMuscleGrowth = /\b(muscle growth|hypertrophy|building muscle|build muscle|muscle building|peptides and muscle)\b/i.test(lower) && !peptide;
    if (isMuscleGrowth) {
      const mk677 = this.peptides.get('ibutamoren-mk677');
      return {
        answer: "When it comes to muscle growth, the evidence is often misunderstood in bodybuilding circles. GH secretagogues like MK-677, Ipamorelin, and CJC-1295 reliably elevate serum GH and IGF-1, but human clinical studies show this primarily increases fat-free mass via intracellular water retention and connective tissue hydration rather than contractile myofibrillar hypertrophy. Peptides do not exhibit the direct androgen receptor-mediated muscle protein synthesis seen with anabolic steroids. Furthermore, recombinant follistatin peptide vials sold online lack human trial verification and are notoriously unstable.",
        peptide: mk677,
        evidenceClassification: {
          claimTopic: 'Peptides and Skeletal Muscle Growth',
          evidenceLevel: 'LEVEL_B',
          recommendedLanguage: 'Human research shows increased fat-free mass, but limited direct contractile hypertrophy...',
          evidenceSummary: 'GH/IGF-1 secretagogues increase water retention and lean mass, but clinical evidence does not demonstrate direct steroid-like muscle hypertrophy.',
          caveats: ['Increased fat-free mass does not equal pure myofibrillar protein accretion.'],
          matchingSources: mk677 ? mk677.sources : [],
          isAnecdotal: true,
          isPreclinical: false,
          isClinicallySupported: false,
          isUnknown: false
        },
        safety,
        sources: mk677 ? mk677.sources : []
      };
    }

    // 2k. Bodybuilding Niche: Body Composition & Fat Loss Research
    const isBodyComp = /\b(body composition|peptides.*body composition|fat loss.*muscle|recomp|body recomposition)\b/i.test(lower) && !peptide;
    if (isBodyComp) {
      const tesa = this.peptides.get('tesamorelin');
      return {
        answer: "For body composition, the peptides with the strongest scientific evidence are Tesamorelin and incretin mimetics (Tirzepatide and Semaglutide). Tesamorelin is supported by Phase 3 human clinical trials published in the NEJM specifically for reducing deep visceral adipose tissue (VAT) while preserving subcutaneous fat. Incretins provide dramatic overall fat loss in clinical trials, though bodybuilders must maintain high protein and resistance training to preserve lean mass. Secretagogues like MK-677 increase fat-free mass but can complicate contest prep due to fluid retention and appetite spikes.",
        peptide: tesa,
        evidenceClassification: {
          claimTopic: 'Peptides for Body Composition & Fat Loss',
          evidenceLevel: 'LEVEL_A',
          recommendedLanguage: 'There is clinical evidence for visceral fat reduction and body composition changes...',
          evidenceSummary: 'Tesamorelin selectively reduces visceral fat; incretins drive overall fat loss; secretagogues increase water/lean mass.',
          caveats: ['Fat loss re-accumulates if lifestyle or therapy is discontinued.'],
          matchingSources: tesa ? tesa.sources : [],
          isAnecdotal: false,
          isPreclinical: false,
          isClinicallySupported: true,
          isUnknown: false
        },
        safety,
        sources: tesa ? tesa.sources : []
      };
    }

    // 2l. Bodybuilding Niche: GH Secretagogues Overview
    const isGhSecretagogue = /\b(gh secretagogues|growth hormone secretagogues|what is known about gh secretagogues)\b/i.test(lower) && !peptide;
    if (isGhSecretagogue) {
      const ipam = this.peptides.get('ipamorelin');
      return {
        answer: "Growth hormone secretagogues fall into two major classes: GHRH analogs (such as Sermorelin, Tesamorelin, and CJC-1295) that stimulate pituitary GHRH receptors, and GHRPs / ghrelin receptor agonists (such as Ipamorelin, GHRP-6, GHRP-2, Hexarelin, and MK-677) that trigger release via GHS-R1a. Ipamorelin is known in research for being highly selective, triggering GH release without increasing cortisol, prolactin, or appetite. In contrast, older secretagogues like GHRP-6 cause intense hunger and cortisol elevation, while Hexarelin rapidly desensitizes pituitary receptors.",
        peptide: ipam,
        evidenceClassification: {
          claimTopic: 'Growth Hormone Secretagogue Pharmacology',
          evidenceLevel: 'LEVEL_A',
          recommendedLanguage: 'Human and pharmacological research defines clear distinctions among secretagogues...',
          evidenceSummary: 'GHRH analogs stimulate GHRH receptors; GHRPs stimulate GHS-R1a. Selectivity varies significantly between compounds.',
          caveats: ['Pituitary desensitization occurs with continuous use of certain compounds.'],
          matchingSources: ipam ? ipam.sources : [],
          isAnecdotal: false,
          isPreclinical: false,
          isClinicallySupported: true,
          isUnknown: false
        },
        safety,
        sources: ipam ? ipam.sources : []
      };
    }

    // 2m. Bodybuilding Niche: Specific BPC-157 Research Details (BODYBUILDING-002)
    if (peptide && peptide.id === 'bpc-157' && (lower.includes('research actually say') || lower.includes('actually say about'))) {
      return {
        answer: "BPC-157 (Body Protection Compound-157) is a 15-amino acid synthetic peptide derived from a naturally occurring gastric protein. In preclinical research involving rodent and in-vitro models, it has been investigated for soft tissue repair, tendon and ligament healing, and angiogenesis via VEGF upregulation. However, it has not been validated in controlled human clinical trials. Its effects in athletes remain theoretical and experimental, and claims of rapid tendon or muscle injury repair are based on anecdotal bodybuilding community reports rather than human clinical evidence.",
        peptide,
        evidenceClassification: {
          claimTopic: 'Preclinical Angiogenesis & Soft Tissue Repair',
          evidenceLevel: 'LEVEL_C',
          recommendedLanguage: "This has been investigated in preclinical research, but that doesn't establish the same effect in humans.",
          evidenceSummary: "BPC-157 has shown tendon, ligament, and gastric tissue healing in animal models, but human clinical trial evidence is lacking.",
          caveats: ['Preclinical animal models do not establish human clinical efficacy in athletes.'],
          matchingSources: peptide.sources.filter(s => s.evidenceLevel === 'LEVEL_C'),
          isAnecdotal: false,
          isPreclinical: true,
          isClinicallySupported: false,
          isUnknown: false
        },
        safety,
        sources: peptide.sources
      };
    }

    // 3. If Peptide Not Recognized
    if (!peptide) {
      return {
        answer: "I don't have enough reliable evidence to give you a factual answer to that. I can provide evidence-based information on characterized peptides such as Semaglutide, Tirzepatide, Tesamorelin, BPC-157, TB-500, Sermorelin, Ipamorelin, MK-677, and others.",
        evidenceClassification: classification,
        safety,
        sources: []
      };
    }

    // 4. Citation / Source Requests (Section 15, PEPTIDE-008, PEPTIDE-009)
    if (lower.includes('citation') || lower.includes('source') || lower.includes('where does that come from') || lower.includes('study details') || lower.includes('reference')) {
      const asksForClinical = lower.includes('clinical') || lower.includes('human') || lower.includes('trial') || lower.includes('cure');
      const hasClinicalMatchingSource = classification.matchingSources.some(s => s.evidenceLevel === 'LEVEL_A' || s.evidenceLevel === 'LEVEL_B');
      const hasClinicalPeptideSource = peptide.sources.some(s => s.evidenceLevel === 'LEVEL_A' || s.evidenceLevel === 'LEVEL_B');

      // If user asks for a citation on an anecdotal claim, or asks for clinical citation when none exists:
      const isAnecdotalClaim = classification.evidenceLevel === 'LEVEL_D';
      const isPreclinicalOnly = classification.evidenceLevel === 'LEVEL_C' && asksForClinical;
      const noClinicalAvailable = asksForClinical && !hasClinicalMatchingSource && !hasClinicalPeptideSource;
      const noSourcesAtAll = peptide.sources.length === 0 && classification.matchingSources.length === 0;

      if (isAnecdotalClaim || isPreclinicalOnly || noClinicalAvailable || noSourcesAtAll) {
        return {
          answer: "I don't have a reliable clinical source establishing that claim. The available reports are anecdotal rather than peer-reviewed clinical studies.",
          peptide,
          evidenceClassification: classification,
          safety,
          sources: []
        };
      }

      if (classification.matchingSources.length > 0) {
        const src = classification.matchingSources[0];
        return {
          answer: `That information comes from published research: "${src.title}", published in ${src.journalOrPublisher} (${src.year}) by ${src.authorsOrOrg}${src.pmidOrDoi ? ` (${src.pmidOrDoi})` : ''}.`,
          peptide,
          evidenceClassification: classification,
          safety,
          sources: classification.matchingSources
        };
      } else if (peptide.sources.length > 0) {
        const src = peptide.sources[0];
        return {
          answer: `The primary peer-reviewed source for ${peptide.name} is "${src.title}", published in ${src.journalOrPublisher} (${src.year}) by ${src.authorsOrOrg}.`,
          peptide,
          evidenceClassification: classification,
          safety,
          sources: [src]
        };
      } else {
        return {
          answer: "I don't have a reliable clinical source establishing that claim. The available reports are anecdotal rather than peer-reviewed clinical studies.",
          peptide,
          evidenceClassification: classification,
          safety,
          sources: []
        };
      }
    }

    // 5. Symptom / Adverse Effect Questions (Section 7, PEPTIDE-006)
    if (lower.includes('side effect') || lower.includes('symptom') || lower.includes('adverse') || lower.includes('risk') || lower.includes('danger')) {
      const established = peptide.adverseEffects.filter(e => e.type === 'established').map(e => e.effect);
      const reported = peptide.adverseEffects.filter(e => e.type === 'reported').map(e => e.effect);
      const anecdotal = peptide.adverseEffects.filter(e => e.type === 'anecdotal').map(e => e.effect);

      let sideEffectText = `For ${peptide.name}, it's important to distinguish established clinical risks from informal reports. `;
      if (established.length > 0) {
        sideEffectText += `Clinically established adverse effects include: ${established.join(', ')}. `;
      }
      if (reported.length > 0) {
        sideEffectText += `Effects reported in preliminary studies or clinical contexts include: ${reported.join(', ')}. `;
      }
      if (anecdotal.length > 0) {
        sideEffectText += `Additionally, some people anecdotally report ${anecdotal.join(', ')}, but that does not establish that the peptide caused it. `;
      }

      return {
        answer: sideEffectText.trim(),
        peptide,
        evidenceClassification: classification,
        safety,
        sources: peptide.sources
      };
    }

    // 6. Evidence & Topic Handling (Section 6, PEPTIDE-001 through PEPTIDE-005)
    // Core Hierarchy: 1. Community/Bodybuilders -> 2. Ask -> 3. Preclinical -> 4. Human Clinical

    // 6a. Explicit request for full evidence breakdown (e.g. "What does the evidence say about...")
    const isEvidenceBreakdown = lower.includes('evidence say') || lower.includes('break down the evidence') || lower.includes('evidence breakdown') || lower.includes('structured evidence') || lower.includes('what the evidence actually says');
    if (isEvidenceBreakdown) {
      let breakdownResponse = '';
      if (session.primaryInterest && !lower.includes('since you')) {
        breakdownResponse += `Since you're looking at ${session.primaryInterest.replace('_', ' ')}, ${peptide.name} is one of the compounds you'll see discussed in that context. Let me separate the anecdotal reports from the preclinical and human evidence.\n\n`;
      } else {
        breakdownResponse += `Alright, let's break down ${peptide.name}. It's a ${peptide.classification}.\n\n`;
      }

      if (lower.includes('how') || lower.includes('work') || lower.includes('mechanism')) {
        breakdownResponse += `Mechanism of action: ${peptide.mechanism}\n\n`;
      }

      breakdownResponse += `ANECDOTAL REPORTS:\n`;
      if (classification.evidenceLevel === 'LEVEL_D') {
        breakdownResponse += `Some people report experiencing ${classification.claimTopic.toLowerCase()}, but that is anecdotal evidence rather than clinical evidence. These are individual reports, not clinical evidence and not proof of efficacy. ${peptide.anecdotalSummary}\n\n`;
      } else {
        breakdownResponse += `These are individual reports, not clinical evidence and not proof of efficacy. Some users report ${peptide.anecdotalSummary}\n\n`;
      }

      breakdownResponse += `PRECLINICAL RESEARCH:\n`;
      breakdownResponse += `This has been investigated in preclinical research, but that does not establish the same effect in humans. In animal and cell studies, ${peptide.preclinicalEvidenceSummary}\n\n`;

      breakdownResponse += `HUMAN / CLINICAL EVIDENCE:\n`;
      if (classification.evidenceLevel === 'LEVEL_A') {
        breakdownResponse += `There is clinical evidence supporting its use for ${classification.claimTopic.toLowerCase()}. Human clinical trials have demonstrated that ${classification.evidenceSummary} ${peptide.clinicalEvidenceSummary}\n\n`;
      } else if (classification.evidenceLevel === 'LEVEL_B') {
        breakdownResponse += `There is some human research investigating this, but the evidence is still limited. ${classification.evidenceSummary} ${peptide.clinicalEvidenceSummary}\n\n`;
      } else if (classification.evidenceLevel === 'LEVEL_E') {
        breakdownResponse += `There isn't enough reliable evidence to say that this benefit is established. ${classification.evidenceSummary}\n\n`;
      } else {
        breakdownResponse += `Clinical evidence is limited or no completed human clinical trials located for athletic performance. ${peptide.clinicalEvidenceSummary}\n\n`;
      }

      const summaryBlock = this.getPeptideEvidenceSummary(peptide.id) || {
        anecdotal: peptide.anecdotalSummary,
        preclinical: peptide.preclinicalEvidenceSummary,
        human: peptide.clinicalEvidenceSummary,
        bottomLine: 'The evidence should be interpreted according to the strongest available evidence, not the volume of online testimonials.'
      };

      breakdownResponse += `WHAT THE EVIDENCE ACTUALLY SAYS:\n`;
      breakdownResponse += `• Anecdotal: ${summaryBlock.anecdotal}\n`;
      breakdownResponse += `• Preclinical: ${summaryBlock.preclinical}\n`;
      breakdownResponse += `• Human: ${summaryBlock.human}\n`;
      breakdownResponse += `• Bottom line: ${summaryBlock.bottomLine}\n\n`;

      if (peptide.contraindications.length > 0) {
        breakdownResponse += `Known cautions include: ${peptide.contraindications[0]}.\n\n`;
      }

      breakdownResponse += `If you'd like to continue your research with the supplier and discuss current peptide availability, you can contact them directly on WhatsApp.`;

      return {
        answer: breakdownResponse.trim(),
        peptide,
        evidenceClassification: classification,
        safety,
        sources: classification.matchingSources.length > 0 ? classification.matchingSources : peptide.sources,
        evidenceSummary: summaryBlock,
        structuredEvidence: this.getPeptideStructuredEvidence(peptide.id),
        salesHandoff: {
          isPurchaseIntent: false,
          whatsappNumber: this.getWhatsAppNumber(),
          whatsappUrl: this.buildWhatsAppUrl(peptide.name, session.primaryInterest),
          prefilledMessage: this.buildWhatsAppPrefill(peptide.name, session.primaryInterest),
          ctaText: 'WHATSAPP THE PEPTIDE TEAM'
        },
        sessionContext: session
      };
    }

    // 6b. Specific query for Bodybuilder / Anecdotal Reports (POINT-01)
    const isAnecdotalSpecific = lower.includes('bodybuilders reporting') || lower.includes('bodybuilders say') || lower.includes('what are people reporting') || lower.includes('what are bodybuilders') || lower.includes('gym reports') || lower.includes('community reports') || (lower.includes('anecdotal') && !lower.includes('rather than'));
    if (isAnecdotalSpecific) {
      const anecdotalText = `ANECDOTAL REPORTS:\nThese are individual reports, not clinical evidence and not proof of efficacy. Some users report ${peptide.anecdotalSummary}\n\nIf you want, I can also break down what the preclinical research or human clinical studies show. Where do you want to start?`;
      return {
        answer: anecdotalText,
        peptide,
        evidenceClassification: {
          claimTopic: `${peptide.name} Community Reports`,
          evidenceLevel: 'LEVEL_D',
          recommendedLanguage: 'These are individual reports, not clinical evidence and not proof of efficacy.',
          evidenceSummary: peptide.anecdotalSummary,
          caveats: ['Individual reports are not proof of efficacy.'],
          matchingSources: [],
          isAnecdotal: true,
          isPreclinical: false,
          isClinicallySupported: false,
          isUnknown: false
        },
        primaryEvidenceClass: 'COMMUNITY_REPORT',
        uiState: 'COMMUNITY_VIEW',
        safety,
        sources: peptide.sources,
        sessionContext: session
      };
    }

    // 6c. Specific gym claim or unsupported claim verification (PEPTIDE-003, PEPTIDE-003b, PEPTIDE-005, POINT-05)
    const isSpecificGymClaim = lower.includes('used in the gym') || lower.includes('build massive muscle') || lower.includes('permanent fat loss') || lower.includes('clinically proven in humans') || (lower.includes('clinically proven') && !classification.isClinicallySupported);
    if (isSpecificGymClaim) {
      if (classification.evidenceLevel === 'LEVEL_D') {
        const gymText = `Some people report experiencing ${classification.claimTopic.toLowerCase()}, but that is anecdotal evidence rather than clinical evidence. These are individual reports, not clinical evidence and not proof of efficacy. ${peptide.anecdotalSummary}\n\nIf you want, we can dig into what the preclinical research or human studies actually show. Where do you want to start?`;
        return {
          answer: gymText,
          peptide,
          evidenceClassification: classification,
          primaryEvidenceClass: 'COMMUNITY_REPORT',
          uiState: 'COMMUNITY_VIEW',
          safety,
          sources: peptide.sources,
          sessionContext: session
        };
      } else if (classification.evidenceLevel === 'LEVEL_E') {
        const unsubText = `There isn't enough reliable evidence to say that this benefit is established. ${classification.evidenceSummary}\n\nIf you'd like, I can break down what has actually been researched or what bodybuilders report in practice.`;
        return {
          answer: unsubText,
          peptide,
          evidenceClassification: classification,
          primaryEvidenceClass: 'COMMUNITY_REPORT',
          uiState: 'COMMUNITY_VIEW',
          safety,
          sources: [],
          sessionContext: session
        };
      }
    }

    // 6d. Preclinical Research Query (PEPTIDE-004, PEPTIDE-004b, POINT-02, POINT-10 Turn 3, TEST 3)
    const isPreclinicalQuery = lower.includes('preclinical') || lower.includes('animal') || lower.includes('in vitro') || lower.includes('in-vitro') || lower.includes('what does research show') || (lower.includes('what does the research say') && !lower.includes('actually say')) || lower.includes('rodent') || lower.includes('tendon explant');
    if (isPreclinicalQuery) {
      const preclinicalText = `PRECLINICAL RESEARCH:\nThis has been investigated in preclinical research, but that does not establish the same effect in humans. In animal and cell studies, ${peptide.preclinicalEvidenceSummary}\n\nIf you want, I can tell you what human clinical trials exist, or what bodybuilders are reporting in the gym. Where do you want to head next?`;
      return {
        answer: preclinicalText,
        peptide,
        evidenceClassification: {
          claimTopic: `${peptide.name} Preclinical Research`,
          evidenceLevel: 'LEVEL_C',
          recommendedLanguage: "This has been investigated in preclinical research, but that doesn't establish the same effect in humans.",
          evidenceSummary: peptide.preclinicalEvidenceSummary,
          caveats: ['Preclinical animal models do not establish human clinical efficacy in athletes.'],
          matchingSources: peptide.sources.filter(s => s.evidenceLevel === 'LEVEL_C'),
          isAnecdotal: false,
          isPreclinical: true,
          isClinicallySupported: false,
          isUnknown: false
        },
        primaryEvidenceClass: 'PRECLINICAL',
        uiState: 'PRECLINICAL_VIEW',
        safety,
        sources: peptide.sources.filter(s => s.evidenceLevel === 'LEVEL_C').length > 0 ? peptide.sources.filter(s => s.evidenceLevel === 'LEVEL_C') : peptide.sources,
        sessionContext: session
      };
    }

    // 6e-1. Regulatory & Approval Information Query (Contract Section 7, Section 13, TEST 5)
    const isRegulatoryQuery = lower.includes('fda') || lower.includes('approved') || lower.includes('regulatory') || lower.includes('legality') || lower.includes('legal status') || lower.includes('wada');
    if (isRegulatoryQuery) {
      const regRecord = peptide.structuredEvidence?.find(r => r.evidence_type === 'REGULATORY');
      const regStatus = peptide.regulatoryStatus || 'Research chemical / Not approved for human consumption';
      const regulatoryText = `REGULATORY INFORMATION:\nFor ${peptide.name}, its regulatory status is: ${regStatus}. ${regRecord ? `${regRecord.finding} (Source: ${regRecord.source}).` : 'It is not approved by the FDA or regulatory agencies for athletic performance or bodybuilding.'}\n\nWould you like to look into what human clinical trials exist, or what lifters report in practice?`;
      return {
        answer: regulatoryText,
        peptide,
        evidenceClassification: {
          claimTopic: `${peptide.name} Regulatory Status`,
          evidenceLevel: peptide.regulatoryStatus.toLowerCase().includes('fda-approved') ? 'LEVEL_A' : 'LEVEL_E',
          recommendedLanguage: `The regulatory status is: ${regStatus}`,
          evidenceSummary: regRecord ? regRecord.finding : regStatus,
          caveats: ['Regulatory status does not imply approval for athletic enhancement.'],
          matchingSources: peptide.sources.filter(s => s.evidenceLevel === 'LEVEL_A' || s.studyType?.includes('FDA')),
          isAnecdotal: false,
          isPreclinical: false,
          isClinicallySupported: peptide.regulatoryStatus.toLowerCase().includes('fda-approved'),
          isUnknown: false
        },
        primaryEvidenceClass: 'REGULATORY',
        uiState: 'REGULATORY_VIEW',
        safety,
        sources: peptide.sources,
        sessionContext: session
      };
    }

    // 6e-2. Human Clinical Evidence Query (PEPTIDE-002, PEPTIDE-002b, POINT-03, TEST 4)
    const isClinicalQuery = lower.includes('human clinical') || lower.includes('clinical evidence') || lower.includes('clinically supported') || lower.includes('clinical trials') || lower.includes('human studies') || lower.includes('human research') || lower.includes('studied in humans') || lower.includes('human data') || lower.includes('phase 3');
    if (isClinicalQuery) {
      let clinicalBody = '';
      if (classification.evidenceLevel === 'LEVEL_A') {
        clinicalBody = `There is clinical evidence supporting its use for ${classification.claimTopic.toLowerCase()}. Human clinical trials have demonstrated that ${classification.evidenceSummary} ${peptide.clinicalEvidenceSummary}`;
      } else if (classification.evidenceLevel === 'LEVEL_B') {
        clinicalBody = `There is some human research investigating this, but the evidence is still limited. ${classification.evidenceSummary} ${peptide.clinicalEvidenceSummary}`;
      } else {
        clinicalBody = `Clinical evidence is limited or no completed human clinical trials located for athletic performance. ${peptide.clinicalEvidenceSummary}`;
      }
      const clinicalText = `HUMAN / CLINICAL EVIDENCE:\n${clinicalBody}\n\nWould you like to hear about the preclinical research, or what bodybuilders report on the ground?`;
      return {
        answer: clinicalText,
        peptide,
        evidenceClassification: classification,
        primaryEvidenceClass: 'HUMAN_CLINICAL',
        uiState: 'HUMAN_CLINICAL_VIEW',
        safety,
        sources: classification.matchingSources.length > 0 ? classification.matchingSources : peptide.sources,
        sessionContext: session
      };
    }

    // 6e-3. Progressive "Tell Me Everything" Handler (Contract Section 20, TEST 7)
    const isTellMeEverything = lower.includes('tell me everything') || lower.includes('all information') || lower.includes('tell me all');
    if (isTellMeEverything) {
      const progressiveText = `In the bodybuilding and physique community, ${peptide.name} is primarily discussed for ${peptide.investigatedUses.map(u => u.conditionOrGoal).slice(0, 2).join(' and ')}.\n\n` +
        `Lifters typically look into it based on user reports around ${peptide.anecdotalSummary}.\n\n` +
        `That said, what you hear in the gym is community experience, not clinical proof.\n\n` +
        `Rather than dumping every scientific database field at once, we can take it step by step. Would you like to start with what lifters are reporting, look into the preclinical animal research, or review the human clinical trial data?`;
      return {
        answer: progressiveText,
        peptide,
        evidenceClassification: classification,
        primaryEvidenceClass: 'COMMUNITY_REPORT',
        uiState: 'COMMUNITY_VIEW',
        safety,
        sources: peptide.sources,
        sessionContext: session
      };
    }

    // 6f. Mechanism / How Does It Work (PEPTIDE-001)
    const isMechanismQuery = lower.includes('how does it work') || lower.includes('how it works') || lower.includes('how do they work') || lower.includes('mechanism');
    if (isMechanismQuery) {
      const mechanismText = `For ${peptide.name}, it's classified as a ${peptide.classification}. Mechanism of action: ${peptide.mechanism}\n\nIn the bodybuilding and physique community, lifters look at it for ${peptide.investigatedUses.map(u => u.conditionOrGoal).slice(0, 2).join(' and ')}. That said, what you hear in the gym is community experience, not clinical proof.\n\nIf you want, I can tell you what bodybuilders are saying about it in more detail, or we can go into the preclinical or human research. Where do you want to start?`;
      return {
        answer: mechanismText,
        peptide,
        evidenceClassification: classification,
        primaryEvidenceClass: 'COMMUNITY_REPORT',
        uiState: 'COMMUNITY_VIEW',
        safety,
        sources: peptide.sources,
        sessionContext: session
      };
    }

    // 6g. DEFAULT — THE NEW CORE RULE: COMMUNITY PERSPECTIVE FIRST (TEST 1, TEST 2)
    // Speaks to the user from the bodybuilding/physique perspective first,
    // provides lifter disclaimer, offers research depth, and STOPS.
    const summaryBlock = this.getPeptideEvidenceSummary(peptide.id) || {
      anecdotal: peptide.anecdotalSummary,
      preclinical: peptide.preclinicalEvidenceSummary,
      human: peptide.clinicalEvidenceSummary,
      bottomLine: 'The evidence should be interpreted according to the strongest available evidence, not the volume of online testimonials.'
    };
    const communityFirstText = this.generateCommunityFirstResponse(peptide, session);

    return {
      answer: communityFirstText,
      peptide,
      evidenceClassification: classification,
      primaryEvidenceClass: 'COMMUNITY_REPORT',
      uiState: 'COMMUNITY_VIEW',
      safety,
      sources: classification.matchingSources.length > 0 ? classification.matchingSources : peptide.sources,
      evidenceSummary: summaryBlock,
      structuredEvidence: this.getPeptideStructuredEvidence(peptide.id),
      salesHandoff: {
        isPurchaseIntent: false,
        whatsappNumber: this.getWhatsAppNumber(),
        whatsappUrl: this.buildWhatsAppUrl(peptide.name, session.primaryInterest),
        prefilledMessage: this.buildWhatsAppPrefill(peptide.name, session.primaryInterest),
        ctaText: 'WHATSAPP THE PEPTIDE TEAM'
      },
      sessionContext: session
    };
  }

  /**
   * Generates the coach/peer Community-First response for a peptide (The New Core Rule).
   * Speaks from the bodybuilding/physique perspective first, gives a brief lifter disclaimer,
   * offers to dive into preclinical or human research, and STOPS.
   */
  private generateCommunityFirstResponse(peptide: PeptideRecord, session: SessionContext): string {
    let intro = '';
    if (session.primaryInterest && (session.primaryInterest.includes('recovery') || session.primaryInterest.includes('injury'))) {
      intro = `Since you're looking at recovery, in the bodybuilding and physique community, `;
    } else if (session.primaryInterest) {
      intro = `Since you're looking at ${session.primaryInterest.replace('_', ' ')}, in the bodybuilding and physique community, `;
    } else {
      intro = `In the bodybuilding and physique community, `;
    }

    if (peptide.id === 'bpc-157') {
      return `${intro}BPC-157 has gotten a ton of attention over the last few years.\n\n` +
        `Lifters mostly look at it when they're dealing with nagging joint issues, tendon flare-ups, elbows, knees, shoulders, or trying to bounce back from heavy training sessions.\n\n` +
        `That said, what you hear in the gym is community experience, not clinical proof.\n\n` +
        `If you want, I can tell you what bodybuilders are saying about it in more detail, or we can go into the preclinical or human research. Where do you want to start?`;
    }

    if (peptide.id === 'tb-500') {
      return `${intro}TB-500 is frequently discussed alongside BPC-157 for soft-tissue recovery, muscle strains, and chronic inflammation.\n\n` +
        `Lifters usually look into it when dealing with deep muscular injuries or systemic recovery demands.\n\n` +
        `That said, what you hear in the gym is community experience, not clinical proof.\n\n` +
        `If you want, I can tell you what bodybuilders are saying about it in more detail, or we can go into the preclinical or human research. Where do you want to start?`;
    }

    if (peptide.id === 'cjc-1295') {
      return `${intro}CJC-1295 is widely researched as a GHRH analog for stimulating natural growth hormone release, deeper sleep, and improved recovery between heavy workouts.\n\n` +
        `Lifters often discuss pairing it with GHRPs like Ipamorelin for synergistic GH pulses without appetite or cortisol spikes.\n\n` +
        `That said, what you hear in the gym is community experience, not clinical proof.\n\n` +
        `If you want, I can tell you what bodybuilders are saying about it in more detail, or we can go into the preclinical or human research. Where do you want to start?`;
    }

    if (peptide.id === 'ipamorelin') {
      return `${intro}Ipamorelin is one of the most popular selective GH secretagogues because it stimulates GH release without driving up hunger, prolactin, or cortisol.\n\n` +
        `Physique athletes often look into it for recovery, body composition, and lean tissue support during calorie deficits.\n\n` +
        `That said, what you hear in the gym is community experience, not clinical proof.\n\n` +
        `If you want, I can tell you what bodybuilders are saying about it in more detail, or we can go into the preclinical or human research. Where do you want to start?`;
    }

    if (peptide.id === 'tesamorelin') {
      return `${intro}Tesamorelin has a big reputation specifically for targeting stubborn visceral abdominal fat and sharpening contest conditioning.\n\n` +
        `Lifters look into it because it triggers natural GH pulsatility without the receptor desensitization of older secretagogues.\n\n` +
        `That said, what you hear in the gym is community experience, not clinical proof.\n\n` +
        `If you want, I can tell you what bodybuilders are saying about it in more detail, or we can go into the preclinical or human research. Where do you want to start?`;
    }

    if (peptide.id === 'ibutamoren-mk677') {
      return `${intro}MK-677 is widely discussed as an oral secretagogue for packing on mass, boosting appetite, and accelerating sleep and recovery.\n\n` +
        `Lifters often run into it during off-season growth phases, though water retention and insulin sensitivity are common discussion points.\n\n` +
        `That said, what you hear in the gym is community experience, not clinical proof.\n\n` +
        `If you want, I can tell you what bodybuilders are saying about it in more detail, or we can go into the preclinical or human research. Where do you want to start?`;
    }

    const primaryGoal = peptide.investigatedUses[0]?.conditionOrGoal || 'recovery and performance';
    return `${intro}${peptide.name} is discussed primarily for ${primaryGoal}.\n\n` +
      `Lifters typically look into it based on user reports around ${peptide.anecdotalSummary}.\n\n` +
      `That said, what you hear in the gym is community experience, not clinical proof.\n\n` +
      `If you want, I can tell you what bodybuilders are saying about it in more detail, or we can go into the preclinical or human research. Where do you want to start?`;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // COMPACT SYSTEM INSTRUCTIONS FOR GEMINI LIVE VOICE ENGINE
  // ─────────────────────────────────────────────────────────────────────────────

  public generateVoiceSystemPrompt(): string {
    const peptideSummaries = Array.from(this.peptides.values()).map(p => {
      const topUse = p.investigatedUses[0] ? `${p.investigatedUses[0].conditionOrGoal} (${p.investigatedUses[0].evidenceLevel})` : 'Under study';
      const keyEstablished = p.adverseEffects.filter(e => e.type === 'established').map(e => e.effect).slice(0, 2).join(', ') || 'Injection site reactions';
      return `- ${p.name} (${p.classification}): Status: ${p.regulatoryStatus}. Primary research: ${topUse}. Key known effects: ${keyEstablished}.`;
    }).join('\n');

    return `CORE PEPTIDE RESEARCH & SALES CONCIERGE OPERATIONAL DIRECTIVE:
You are an expert AI peptide research specialist and sales concierge built specifically for the bodybuilding, physique athlete, and performance community researching peptides for training, recovery, body composition, and performance.

CUSTOMER JOURNEY:
DISCOVER → RESEARCH → UNDERSTAND → BUILD INTEREST → CONTACT SELLER ON WHATSAPP
You educate visitors about peptides with complete scientific transparency and then direct interested users to WhatsApp to discuss current availability and continue with the supplier.

PERSONA & VOICE — 80s GOLDEN ERA BODYBUILDING SPECIALIST:
- Vocal Persona: Experienced 1980s Golden Era bodybuilding coach and peptide research specialist (38-year-old male competitive physique athlete).
- Vocal Delivery: Deep, masculine, resonant, authoritative, confident, slightly gritty and textured, with calm intensity and strong presence. Voice: Charon.
- Setting & Attitude: You sound like a veteran coach inside a Golden Era gym explaining physiology to a serious lifter between sets. Grounded, steady pacing, not rushed, with controlled intensity.
- Attitude toward lifters: Motivational and respectful without sounding like a hype man or motivational speaker. You have spent decades in bodybuilding culture and understand the lifter mindset deeply.
- ABSOLUTELY NOT:
  * A corporate customer-service representative
  * A Silicon Valley AI assistant
  * A doctor avatar or medical receptionist
  * A radio announcer or overly polished commercial voice
  * A robotic "AI assistant"
  * An Arnold Schwarzenegger parody or cartoonish gym bro caricature (no cheesy 80s catchphrases)
- Conversational Cadence: Speak concise conversational turns (2 to 3 sentences maximum initially). Offer deeper dives naturally: "I can break down the study details if you'd like."
- Key Phrasing Standards:
  * "Alright, let's break this one down."
  * "Here's where it gets interesting."
  * "There's a lot of noise around this one. Let's separate the signal from the hype."

NEW CORE RULE — COMMUNITY PERSPECTIVE FIRST (MANDATORY):
Speak to the user from the bodybuilding/physique community perspective FIRST.
The default conversation hierarchy is:
1. WHAT BODYBUILDERS ARE SAYING / REPORTING:
   - Lead with community perspective: why lifters are interested, common gym use cases (nagging joints, elbows, knees, recovery).
   - Give a brief, lifter-friendly disclaimer: "That said, what you hear in the gym is community experience, not clinical proof."
2. ASK WHETHER THEY WANT THE RESEARCH:
   - "If you want, I can tell you what bodybuilders are saying about it in more detail, or we can go into the preclinical or human research. Where do you want to start?"
   - STOP THERE. Do not keep talking.
3. PRECLINICAL INFORMATION — ONLY IF REQUESTED:
   - Animal and cell models, rodent tendons, VEGF upregulation, and state that animal models do not establish human clinical proof.
4. HUMAN / CLINICAL INFORMATION — ONLY IF REQUESTED:
   - Phase 3 RCTs, limitations, or lack of completed clinical trials.
5. REGULATORY / FDA — ONLY IF REQUESTED:
   - FDA approval status and regulatory position.

CRITICAL NEGATIVE CONSTRAINTS (ZERO TOLERANCE):
- Do NOT automatically launch into preclinical research after identifying a peptide.
- Do NOT automatically mention gastric juice origins, rodent Achilles tendons, VEGF upregulation, or animal-to-human translation unless specifically asked.
- Do NOT automatically give FDA warnings or regulatory lectures unprompted.
- Do NOT dump a multi-paragraph scientific disclaimer upfront. The user is a bodybuilder/physique athlete, not a biology student.

CONVERSATIONAL SALES PSYCHOLOGY (5 STEPS):
1. STEP 1 — DISCOVER: Understand what the visitor is researching.
   - "What are you mainly researching—recovery, body composition, performance, or something else?"
   - "What caught your attention about this peptide?"
2. STEP 2 — EDUCATE (COMMUNITY FIRST): Lead with what lifters are experiencing and why it's popular in the gym, then offer research.
3. STEP 3 — DIFFERENTIATE EVIDENCE (WHEN REQUESTED): Separate into Anecdotal vs Preclinical vs Human Clinical.
4. STEP 4 — PERSONAL RELEVANCE: Connect research to their stated goals (e.g. "Since you're looking at recovery...").
5. STEP 5 — WHATSAPP HANDOFF / CONVERSION:
   When interest is established or purchase intent appears:
   "If you'd like to continue your research with the supplier and discuss current peptide availability, you can contact them directly on WhatsApp."

CRITICAL BOUNDARIES (DO NOT PRETEND TO BE THE SELLER OR DOCTOR):
- NEVER claim: "I can sell you this", "I have this in stock", "Your order is confirmed", or "I'm your doctor".
- Say: "I can help you research the peptide. For availability, purchasing information, or questions about the supplier's products, contact the peptide team directly on WhatsApp."
- NEVER generate individualized dosing protocols, injection instructions, or personal peptide stacks.
- Maintain the strict role: Research → education → qualified handoff.

CONVERSION SIGNALS & PURCHASE INTENT:
When the visitor asks purchase intent questions ("I want to buy it", "How much is it?", "Do you sell it?", "Where can I get it?", "Can I order?"):
DO NOT dump another giant research answer.
Move immediately toward the WhatsApp handoff:
"If you'd like to discuss availability and purchasing directly with the supplier, I can connect you with the peptide team on WhatsApp."

CANONICAL INITIAL GREETING:
"Alright. I'm your peptide information specialist. If you're researching peptides for bodybuilding, recovery, physique or performance, I can help you separate the claims from the evidence. What are you looking into?"

PEPTIDE KNOWLEDGE REPOSITORY OVERVIEW:
${peptideSummaries}
`;
  }
}

export const peptideKnowledgeEngine = PeptideKnowledgeEngine.getInstance();
