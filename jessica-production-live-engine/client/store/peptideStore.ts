/**
 * client/store/peptideStore.ts
 * 
 * Reactive Zustand store for the Single-Purpose Peptide Information Voice Agent.
 * Manages active voice consultation, live transcript with evidence badges,
 * active peptide dossier, and knowledge base administration.
 */

import { create } from 'zustand';

export type EvidenceLevel = 
  | 'LEVEL_A'
  | 'LEVEL_B'
  | 'LEVEL_C'
  | 'LEVEL_D'
  | 'LEVEL_E';

export interface DialogueTurn {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: number;
  evidenceLevel?: EvidenceLevel;
  evidenceTopic?: string;
  evidenceSummary?: string;
  citations?: string[];
  safetyAlert?: {
    isEmergent: boolean;
    symptomType: string;
    guidance: string;
  };
}

export interface PeptideSource {
  id: string;
  title: string;
  authorsOrOrg: string;
  journalOrPublisher: string;
  year: number;
  pmidOrDoi?: string;
  url?: string;
  evidenceLevel: EvidenceLevel;
}

export interface AdverseEffectEntry {
  effect: string;
  type: 'established' | 'reported' | 'anecdotal' | 'unknown';
  description: string;
  evidenceLevel: EvidenceLevel;
  frequency?: string;
}

export interface InvestigatedUse {
  conditionOrGoal: string;
  evidenceLevel: EvidenceLevel;
  status: string;
  summary: string;
  sources: string[];
}

export interface PeptideClaim {
  id: string;
  claim: string;
  category: string;
  evidenceLevel: EvidenceLevel;
  description: string;
  population?: string;
  studyType?: string;
  limitations: string;
  confidence: 'HIGH' | 'MODERATE' | 'LOW';
  sourceIds: string[];
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
  peptide: string;
  peptideName: string;
  evidence_type: EvidenceType;
  source: string;
  source_url?: string;
  publication_date: string;
  population_or_model: string;
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
  category: 'gh_secretagogues' | 'healing_repair' | 'metabolic_fatloss' | 'advanced_anabolic';
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

interface PeptideStoreState {
  // Navigation
  activeTab: 'voice' | 'admin' | 'knowledge' | 'framework';
  setActiveTab: (tab: 'voice' | 'admin' | 'knowledge' | 'framework') => void;

  // Voice Agent State
  connectionState: string;
  setConnectionState: (state: string) => void;
  userAudioLevel: number;
  setUserAudioLevel: (level: number) => void;
  agentAudioLevel: number;
  setAgentAudioLevel: (level: number) => void;
  isMuted: boolean;
  setIsMuted: (muted: boolean) => void;

  // Dialogue & Evidence
  transcript: DialogueTurn[];
  addTranscriptTurn: (turn: Omit<DialogueTurn, 'id' | 'timestamp'>) => void;
  updateLastTurn: (text: string) => void;
  clearTranscript: () => void;

  // Active Peptide Dossier & Evidence Hierarchy
  activePeptide: PeptideRecord | null;
  setActivePeptide: (peptide: PeptideRecord | null) => void;
  activeStructuredEvidence: StructuredEvidenceRecord[];
  setActiveStructuredEvidence: (evidence: StructuredEvidenceRecord[]) => void;
  activeEvidenceSummary: EvidenceSummaryBlock | null;
  setActiveEvidenceSummary: (summary: EvidenceSummaryBlock | null) => void;
  isSourcesModalOpen: boolean;
  setSourcesModalOpen: (open: boolean) => void;

  // Evidence Display Contract State Model
  uiState: 'COMMUNITY_VIEW' | 'RESEARCH_CHOOSER' | 'PRECLINICAL_VIEW' | 'HUMAN_CLINICAL_VIEW' | 'REGULATORY_VIEW' | 'SOURCE_VIEW' | 'EVIDENCE_SUMMARY';
  setUiState: (state: 'COMMUNITY_VIEW' | 'RESEARCH_CHOOSER' | 'PRECLINICAL_VIEW' | 'HUMAN_CLINICAL_VIEW' | 'REGULATORY_VIEW' | 'SOURCE_VIEW' | 'EVIDENCE_SUMMARY') => void;
  primaryEvidenceClass: 'COMMUNITY_REPORT' | 'PRECLINICAL' | 'HUMAN_CLINICAL' | 'REGULATORY';
  setPrimaryEvidenceClass: (cls: 'COMMUNITY_REPORT' | 'PRECLINICAL' | 'HUMAN_CLINICAL' | 'REGULATORY') => void;

  // Sales Concierge & WhatsApp Handoff
  whatsappNumber: string;
  setWhatsappNumber: (number: string) => void;
  salesHandoff: SalesHandoffState | null;
  setSalesHandoff: (handoff: SalesHandoffState | null) => void;
  sessionContext: SessionContext;
  setSessionContext: (context: Partial<SessionContext>) => void;
  openWhatsApp: () => void;

  // Active Safety Alert
  activeSafetyAlert: {
    level: 'NONE' | 'URGENT' | 'EMERGENT';
    symptoms: string[];
    guidance: string;
  } | null;
  setActiveSafetyAlert: (alert: { level: 'NONE' | 'URGENT' | 'EMERGENT'; symptoms: string[]; guidance: string } | null) => void;

  // Knowledge Base Catalog & Admin
  peptides: PeptideRecord[];
  isLoadingPeptides: boolean;
  searchFilter: string;
  categoryFilter: string | null;
  evidenceFilter: EvidenceLevel | null;
  setSearchFilter: (search: string) => void;
  setCategoryFilter: (category: string | null) => void;
  setEvidenceFilter: (level: EvidenceLevel | null) => void;
  loadPeptides: () => Promise<void>;
  createPeptide: (data: Partial<PeptideRecord>) => Promise<boolean>;
  updatePeptide: (id: string, updates: Partial<PeptideRecord>) => Promise<boolean>;
  deletePeptide: (id: string) => Promise<boolean>;
}

export const usePeptideStore = create<PeptideStoreState>((set, get) => ({
  activeTab: 'voice',
  setActiveTab: (tab) => set({ activeTab: tab }),

  connectionState: 'DISCONNECTED',
  setConnectionState: (state) => set({ connectionState: state }),
  userAudioLevel: 0,
  setUserAudioLevel: (level) => set({ userAudioLevel: level }),
  agentAudioLevel: 0,
  setAgentAudioLevel: (level) => set({ agentAudioLevel: level }),
  isMuted: false,
  setIsMuted: (muted) => set({ isMuted: muted }),

  transcript: [],
  addTranscriptTurn: (turn) => set((state) => ({
    transcript: [
      ...state.transcript,
      {
        ...turn,
        id: `turn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        timestamp: Date.now()
      }
    ]
  })),
  updateLastTurn: (text) => set((state) => {
    if (state.transcript.length === 0) return state;
    const updated = [...state.transcript];
    const last = updated[updated.length - 1];
    if (last.sender === 'assistant') {
      updated[updated.length - 1] = { ...last, text };
    }
    return { transcript: updated };
  }),
  clearTranscript: () => set({
    transcript: [
      {
        id: 'greeting-turn',
        sender: 'assistant',
        text: "Alright. I'm your peptide information specialist. If you're researching peptides for bodybuilding, recovery, physique or performance, I can help you separate the claims from the evidence. What are you looking into?",
        timestamp: Date.now()
      }
    ],
    activeSafetyAlert: null
  }),

  activePeptide: null,
  setActivePeptide: (peptide) => {
    if (peptide) {
      set({
        activePeptide: peptide,
        activeStructuredEvidence: peptide.structuredEvidence || [],
        activeEvidenceSummary: peptide.evidenceSummary || null,
        sessionContext: {
          ...get().sessionContext,
          lastDiscussedPeptide: peptide.name,
          discussedPeptides: Array.from(new Set([...get().sessionContext.discussedPeptides, peptide.id]))
        }
      });
      if (!peptide.structuredEvidence || peptide.structuredEvidence.length === 0) {
        fetch(`/api/peptides/${peptide.id}/evidence`)
          .then(r => r.json())
          .then(d => {
            if (d.success && d.evidence) {
              set({ activeStructuredEvidence: d.evidence, activeEvidenceSummary: d.summary || null });
            }
          })
          .catch(() => {});
      }
    } else {
      set({ activePeptide: null, activeStructuredEvidence: [], activeEvidenceSummary: null });
    }
  },

  activeStructuredEvidence: [],
  setActiveStructuredEvidence: (evidence) => set({ activeStructuredEvidence: evidence }),
  activeEvidenceSummary: null,
  setActiveEvidenceSummary: (summary) => set({ activeEvidenceSummary: summary }),
  isSourcesModalOpen: false,
  setSourcesModalOpen: (open) => set({ isSourcesModalOpen: open }),

  uiState: 'COMMUNITY_VIEW',
  setUiState: (state) => set({ uiState: state }),
  primaryEvidenceClass: 'COMMUNITY_REPORT',
  setPrimaryEvidenceClass: (cls) => set({ primaryEvidenceClass: cls }),

  whatsappNumber: '15557378433',
  setWhatsappNumber: (number) => set({ whatsappNumber: number }),
  salesHandoff: null,
  setSalesHandoff: (handoff) => set({ salesHandoff: handoff }),
  sessionContext: {
    discussedPeptides: []
  },
  setSessionContext: (context) => set((state) => ({
    sessionContext: {
      ...state.sessionContext,
      ...context,
      discussedPeptides: context.discussedPeptides
        ? Array.from(new Set([...state.sessionContext.discussedPeptides, ...context.discussedPeptides]))
        : state.sessionContext.discussedPeptides
    }
  })),
  openWhatsApp: () => {
    const handoff = get().salesHandoff;
    const num = get().whatsappNumber.replace(/[^0-9]/g, '') || '15557378433';
    const peptide = get().activePeptide;
    const goal = get().sessionContext.primaryInterest;
    let text = "Hi, I was researching peptides with the Peptide Specialist and I'd like to learn more about availability.";
    if (handoff && handoff.whatsappUrl) {
      window.open(handoff.whatsappUrl, '_blank');
      return;
    }
    if (peptide && goal) {
      text = `Hi, I was researching ${peptide.name} for ${goal} with the Peptide Specialist and I'd like to learn more about availability.`;
    } else if (peptide) {
      text = `Hi, I was researching ${peptide.name} with the Peptide Specialist and I'd like to learn more about availability.`;
    }
    const url = `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  },

  activeSafetyAlert: null,
  setActiveSafetyAlert: (alert) => set({ activeSafetyAlert: alert }),

  peptides: [],
  isLoadingPeptides: false,
  searchFilter: '',
  categoryFilter: null,
  evidenceFilter: null,
  setSearchFilter: (search) => set({ searchFilter: search }),
  setCategoryFilter: (category) => set({ categoryFilter: category }),
  setEvidenceFilter: (level) => set({ evidenceFilter: level }),

  loadPeptides: async () => {
    set({ isLoadingPeptides: true });
    try {
      // Fetch WhatsApp configuration
      fetch('/api/peptides/config')
        .then(r => r.json())
        .then(d => {
          if (d.success && d.whatsappNumber) {
            set({ whatsappNumber: d.whatsappNumber });
          }
        })
        .catch(() => {});

      const res = await fetch('/api/peptides');
      if (res.ok) {
        const data = await res.json();
        if (data.peptides && Array.isArray(data.peptides)) {
          set({ peptides: data.peptides, isLoadingPeptides: false });
          // If no active peptide, select the first one (e.g. Tirzepatide or BPC-157)
          if (!get().activePeptide && data.peptides.length > 0) {
            get().setActivePeptide(data.peptides[0]);
          }
          return;
        }
      }
      set({ isLoadingPeptides: false });
    } catch (err) {
      console.error('[PeptideStore] Failed to fetch peptides:', err);
      set({ isLoadingPeptides: false });
    }
  },

  createPeptide: async (recordData) => {
    try {
      const res = await fetch('/api/peptides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recordData)
      });
      if (res.ok) {
        await get().loadPeptides();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  updatePeptide: async (id, updates) => {
    try {
      const res = await fetch(`/api/peptides/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (res.ok) {
        await get().loadPeptides();
        const active = get().activePeptide;
        if (active && active.id === id) {
          const fresh = get().peptides.find(p => p.id === id);
          if (fresh) set({ activePeptide: fresh });
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  deletePeptide: async (id) => {
    try {
      const res = await fetch(`/api/peptides/${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        await get().loadPeptides();
        const active = get().activePeptide;
        if (active && active.id === id) {
          set({ activePeptide: get().peptides[0] || null });
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}));
