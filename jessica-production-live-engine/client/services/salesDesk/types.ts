/**
 * AI Sales Desk - Domain Types & State Models
 * 
 * Defines strict types for:
 * - Buyer Context with field-level provenance
 * - Lead Intelligence Metrics (Intent, Contactability, Qualification, Completeness, Lead Quality)
 * - Deterministic Sales Stages & Transitions
 * - Field Memory & "Don't Ask" tracking
 * - Structured Event Logging and Actions
 */

export type SalesDeskMode = 'voice' | 'classic';

export type VoiceState =
  | 'idle'
  | 'listening'
  | 'user_speaking'
  | 'speaking'
  | 'thinking'
  | 'interrupted'
  | 'error';

export type SalesStage =
  | 'GREETING'
  | 'DISCOVERY'
  | 'QUALIFYING'
  | 'PRE_QUAL_READY'
  | 'HANDOFF';

export type FieldSource = 'user' | 'inferred' | 'system' | 'verified';

export interface FieldProvenance<T> {
  value: T;
  source: FieldSource;
  confidence: number; // 0.0 to 1.0
  updatedAt: string;
}

export interface BuyerContext {
  firstName?: FieldProvenance<string>;
  lastName?: FieldProvenance<string>;
  name?: FieldProvenance<string>;
  email?: FieldProvenance<string>;
  phone?: FieldProvenance<string>;
  location?: FieldProvenance<string>;
  targetVehicle?: FieldProvenance<string>;
  makeModel?: FieldProvenance<string>;
  monthlyBudget?: FieldProvenance<number>;
  monthlyIncome?: FieldProvenance<number>;
  creditSituation?: FieldProvenance<string>;
  creditProfile?: FieldProvenance<string>;
  downPayment?: FieldProvenance<number>;
  employmentStatus?: FieldProvenance<string>;
  purchaseTimeline?: FieldProvenance<string>;
  urgency?: FieldProvenance<string>;
  hasTrade?: FieldProvenance<boolean>;
  tradeVehicle?: FieldProvenance<string>;
  painPoints?: FieldProvenance<string>;
  objections?: FieldProvenance<string>;
  activeObjection?: FieldProvenance<string>;
  postalCode?: FieldProvenance<string>;
}

export interface FieldMemoryState {
  knownFields: string[];
  askedFields: string[];
  declinedFields: string[];
  unknownFields: string[];
}

export interface LeadIntelligenceMetrics {
  intentScore: number;          // 0-100 (Observable buying desire & urgency)
  intentStage: string;          // CURIOUS | RESEARCHING | SHOPPING | QUALIFIED | HIGH_INTENT
  contactabilityScore: number;  // 0-100 (Phone 60%, Email 30%, Name 10%)
  qualificationScore: number;    // 0-100 (Income, Credit, Budget, Trade)
  completenessScore: number;    // 0-100% (Proportion of 9 CRM attributes known)
  leadQualityScore: number;     // 0-100 (Weighted composite)
  buyingCommitment: string;     // NONE | EXPLORING | CONSIDERING | ACTIVELY_SHOPPING | READY_TO_PROCEED
  nextBestAction: string;       // EDUCATE | DISCOVER | QUALIFY | OVERCOME_OBJECTION | CAPTURE_PHONE | CAPTURE_EMAIL | REQUEST_HUMAN_HANDOFF | HANDOFF_NOW | NURTURE
  activeObjection?: string | null;
  recommendedNextAction: string; // CALL_ASAP | SCHEDULE_CALL | EMAIL_PORTFOLIO | NURTURE
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  isInterim?: boolean;
}

export type SalesDeskAction =
  | { type: 'switch_sales_desk_mode'; mode: SalesDeskMode }
  | { type: 'capture_buyer_information'; fields: Partial<Record<keyof BuyerContext, any>> }
  | { type: 'record_lead_signal'; signalType: string; value?: any }
  | { type: 'record_objection'; objection: { objectionType: string; details?: string } }
  | { type: 'update_sales_stage'; stage: SalesStage; reason?: string }
  | { type: 'hand_off_to_human'; name: string; phone?: string; email?: string; income?: string; summary: string; urgency?: string }
  | { type: 'start_pre_approval'; vehicleType?: string; budget?: number };

export interface SalesDeskEvent {
  id: string;
  sessionId: string;
  timestamp: string;
  type:
    | 'SESSION_STARTED'
    | 'VOICE_STARTED'
    | 'USER_SPEECH_STARTED'
    | 'USER_SPEECH_INTERIM'
    | 'USER_SPEECH_FINALIZED'
    | 'AI_RESPONSE_STARTED'
    | 'AI_RESPONSE_COMPLETED'
    | 'AI_INTERRUPTED'
    | 'MODE_SWITCHED'
    | 'BUYER_CONTEXT_UPDATED'
    | 'SALES_STAGE_CHANGED'
    | 'TOOL_EXECUTED'
    | 'HUMAN_HANDOFF'
    | 'PRE_APPROVAL_STARTED'
    | 'SESSION_ENDED'
    | 'ERROR_OCCURRED';
  payload?: Record<string, any>;
}

export type ConversationalAction =
  | 'speak_and_listen'
  | 'speak_and_wait'
  | 'listen'
  | 'handoff'
  | 'complete';

export type NextConversationalObjective =
  | 'discover_vehicle'
  | 'discover_budget'
  | 'discover_credit'
  | 'discover_down_payment'
  | 'discover_income'
  | 'capture_phone'
  | 'capture_email'
  | 'overcome_objection'
  | 'pre_approval'
  | 'handoff'
  | 'educate'
  | 'none';

export interface SalesDeskTurn {
  sessionId: string;
  turnId: string;
  userMessage: string;
  assistantMessage?: string;
  conversationalAction: ConversationalAction;
  nextObjective: NextConversationalObjective;
  salesStage: SalesStage;
  buyerContext: BuyerContext;
}

export interface ChatResponse {
  message: string;
  actions: SalesDeskAction[];
  conversationalAction?: ConversationalAction;
  nextObjective?: NextConversationalObjective;
  conversationId: string;
  turnId?: number;
  buyerContext?: BuyerContext;
  salesStage?: SalesStage;
  leadIntelligence?: LeadIntelligenceMetrics;
  salesBrief?: string;
  customerSummary?: string;
}

export interface SalesDeskResponse {
  message: string;
  actions?: SalesDeskAction[];
  conversationalAction?: ConversationalAction;
  nextObjective?: NextConversationalObjective;
  turnId?: number;
  suggestedStage?: SalesStage;
  handoffRequested?: boolean;
  leadIntelligence?: LeadIntelligenceMetrics;
  salesBrief?: string;
  customerSummary?: string;
}
