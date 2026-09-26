/**
 * server/peptide/types.ts
 * 
 * Canonical data contracts for the Single-Purpose Peptide Information Voice Agent.
 * Implements strict Evidence Classification hierarchy (Levels A through E)
 * and structured claim-level attribution.
 */

export type EvidenceLevel = 
  | 'LEVEL_A' // Clinically Supported (Human RCTs, meta-analyses, regulatory approval)
  | 'LEVEL_B' // Limited Clinical Evidence (Preliminary human studies, inconsistent or small trials)
  | 'LEVEL_C' // Preclinical / Research Evidence (Animal models, in vitro cell studies, mechanistic)
  | 'LEVEL_D' // Anecdotal (User reports, online bodybuilding discussions, practitioner anecdotes)
  | 'LEVEL_E'; // Unknown / Insufficient Evidence (No reliable scientific basis)

export type PeptideCategory = 
  | 'gh_secretagogues'
  | 'healing_repair'
  | 'metabolic_fatloss'
  | 'advanced_anabolic';

export type ClaimCategory = 
  | 'benefit'
  | 'mechanism'
  | 'adverse_effect'
  | 'pharmacokinetics'
  | 'indication';

export type AdverseEffectType =
  | 'established'  // Supported by clinical or official safety evidence
  | 'reported'     // Observed in studies/clinical contexts with limited certainty
  | 'anecdotal'    // Community reports without established causality
  | 'unknown';

export interface PeptideSource {
  id: string;
  title: string;
  authorsOrOrg: string;
  journalOrPublisher: string;
  year: number;
  pmidOrDoi?: string;
  url?: string;
  evidenceLevel: EvidenceLevel;
  studyType?: string; // 'RCT', 'Systematic Review', 'Animal Model', 'In Vitro', 'FDA Label'
}

export interface PeptideClaim {
  id: string;
  claim: string;
  category: ClaimCategory;
  evidenceLevel: EvidenceLevel;
  description: string;
  population?: string; // 'Human Clinical', 'Rodent', 'Cell Culture', 'Athletic Community'
  studyType?: string;
  limitations: string;
  confidence: 'HIGH' | 'MODERATE' | 'LOW';
  sourceIds: string[];
}

export interface AdverseEffectEntry {
  effect: string;
  type: AdverseEffectType;
  description: string;
  evidenceLevel: EvidenceLevel;
  frequency?: string; // 'Common', 'Infrequent', 'Rare', 'Unknown'
  sourceIds?: string[];
}

export interface InvestigatedUse {
  conditionOrGoal: string;
  evidenceLevel: EvidenceLevel;
  status: string; // e.g., 'FDA Approved', 'Phase 3 Clinical', 'Preclinical Only', 'Anecdotal Only'
  summary: string;
  sources: string[];
}

export type EvidenceType = 
  | 'ANECDOTAL'
  | 'PRECLINICAL'
  | 'HUMAN_CLINICAL'
  | 'REGULATORY'
  | 'OTHER';

export type EvidenceStatus =
  | 'VERIFIED'
  | 'PRELIMINARY'
  | 'COMMUNITY_REPORT'
  | 'INSUFFICIENT'
  | 'REGULATORY_APPROVED';

export interface StructuredEvidenceRecord {
  id: string;
  peptide: string; // peptide id
  peptideName: string;
  evidence_type: EvidenceType;
  source: string;
  source_url?: string;
  publication_date: string;
  population_or_model: string; // e.g. "Sprague-Dawley rats (in vivo)", "Phase 3 RCT (n=1,961 adults)", "Online bodybuilding forums & athlete logs"
  claim: string;
  finding: string;
  limitations: string;
  evidence_status: EvidenceStatus;
  citation?: string;
}

export interface EvidenceSummaryBlock {
  anecdotal: string;
  preclinical: string;
  human: string;
  bottomLine: string;
}

export interface SalesHandoffState {
  isPurchaseIntent: boolean;
  intentPhrase?: string;
  whatsappNumber: string;
  whatsappUrl: string;
  prefilledMessage: string;
  ctaText: string;
}

export interface SessionContext {
  primaryInterest?: 'recovery' | 'body_composition' | 'fat_loss' | 'muscle_growth' | 'injury' | 'general';
  interestTopicName?: string;
  discussedPeptides: string[];
  lastDiscussedPeptide?: string;
}

export interface PeptideRecord {
  id: string;
  name: string;
  commonNames: string[];
  category: PeptideCategory;
  classification: string;
  molecularFormula?: string;
  halfLife?: string;
  administrationRoutes?: string[];
  mechanism: string;
  regulatoryStatus: string;
  investigatedUses: InvestigatedUse[];
  claims: PeptideClaim[];
  clinicalEvidenceSummary: string;
  preclinicalEvidenceSummary: string;
  anecdotalSummary: string;
  adverseEffects: AdverseEffectEntry[];
  contraindications: string[];
  unknowns: string[];
  sources: PeptideSource[];
  structuredEvidence?: StructuredEvidenceRecord[];
  evidenceSummary?: EvidenceSummaryBlock;
  createdAt: number;
  updatedAt: number;
}

export interface EvidenceClassificationResult {
  peptideId?: string;
  peptideName?: string;
  claimTopic: string;
  evidenceLevel: EvidenceLevel;
  recommendedLanguage: string;
  evidenceSummary: string;
  caveats: string[];
  matchingSources: PeptideSource[];
  isAnecdotal: boolean;
  isPreclinical: boolean;
  isClinicallySupported: boolean;
  isUnknown: boolean;
}

export interface SafetyEvaluationResult {
  hasEmergentSymptoms: boolean;
  emergencyLevel: 'NONE' | 'URGENT' | 'EMERGENT';
  detectedSymptoms: string[];
  safetyGuidance: string;
  isPrescribingRequest: boolean;
  prescribingGuidance?: string;
}

export type UIStateModel = 
  | 'COMMUNITY_VIEW'
  | 'RESEARCH_CHOOSER'
  | 'PRECLINICAL_VIEW'
  | 'HUMAN_CLINICAL_VIEW'
  | 'REGULATORY_VIEW'
  | 'SOURCE_VIEW'
  | 'EVIDENCE_SUMMARY';

export type PrimaryEvidenceClass = 
  | 'COMMUNITY_REPORT'
  | 'PRECLINICAL'
  | 'HUMAN_CLINICAL'
  | 'REGULATORY';

export interface PeptideQueryResponse {
  answer: string;
  peptide?: PeptideRecord;
  evidenceClassification: EvidenceClassificationResult;
  safety: SafetyEvaluationResult;
  sources: PeptideSource[];
  evidenceSummary?: EvidenceSummaryBlock;
  structuredEvidence?: StructuredEvidenceRecord[];
  salesHandoff?: SalesHandoffState;
  sessionContext?: SessionContext;
  uiState?: UIStateModel;
  primaryEvidenceClass?: PrimaryEvidenceClass;
}

