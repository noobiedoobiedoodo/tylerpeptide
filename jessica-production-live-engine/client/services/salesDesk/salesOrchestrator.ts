import {
  BuyerContext,
  ChatMessage,
  ChatResponse,
  FieldMemoryState,
  FieldSource,
  LeadIntelligenceMetrics,
  SalesDeskAction,
  SalesDeskEvent,
  SalesDeskMode,
  SalesDeskResponse,
  SalesStage,
  VoiceState
} from './types';

export interface SalesDeskState {
  sessionId: string;
  mode: SalesDeskMode;
  voiceState: VoiceState;
  salesStage: SalesStage;
  buyerContext: BuyerContext;
  fieldMemory: FieldMemoryState;
  leadIntelligence: LeadIntelligenceMetrics;
  salesBrief?: string;
  customerSummary?: string;
  messages: ChatMessage[];
  interimTranscript: string;
  isHandoffRequested: boolean;
  eventLogs: SalesDeskEvent[];
}

export class SalesOrchestrator {
  private state: SalesDeskState;
  private listeners: Array<(state: SalesDeskState) => void> = [];

  constructor(initialMode: SalesDeskMode = 'classic') {
    const sessionId = `sdesk_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    this.state = {
      sessionId,
      mode: initialMode,
      voiceState: 'speaking',
      salesStage: 'GREETING',
      buyerContext: {},
      fieldMemory: {
        knownFields: [],
        askedFields: [],
        declinedFields: [],
        unknownFields: ['vehicle', 'budget', 'timeline', 'trade', 'credit', 'income', 'phone', 'email']
      },
      leadIntelligence: {
        intentScore: 0,
        intentStage: 'CURIOUS',
        contactabilityScore: 0,
        qualificationScore: 0,
        completenessScore: 0,
        leadQualityScore: 0,
        buyingCommitment: 'NONE',
        nextBestAction: 'DISCOVER',
        recommendedNextAction: 'NURTURE'
      },
      messages: [
        {
          id: 'welcome',
          role: 'assistant',
          content: "Good day! I'm Jessica, your 24/7 AI automotive advisor. What type of vehicle or monthly budget are you looking to explore today?",
          timestamp: new Date().toISOString(),
        }
      ],
      interimTranscript: '',
      isHandoffRequested: false,
      eventLogs: []
    };

    this.logEvent('SESSION_STARTED', { mode: initialMode, sessionId });
  }

  getState(): SalesDeskState {
    return this.state;
  }

  setSessionId(sessionId: string) {
    this.state = { ...this.state, sessionId };
    this.notify();
  }

  setHistory(history: ChatMessage[]) {
    if (!Array.isArray(history) || history.length === 0) return;
    const mapped: ChatMessage[] = history.map((msg: any) => ({
      id: msg.id || `msg_${Math.random().toString(36).substring(2, 8)}`,
      role: msg.role || 'assistant',
      content: msg.content || msg.text || '',
      timestamp: msg.timestamp || new Date().toISOString()
    }));
    this.state = {
      ...this.state,
      messages: mapped
    };
    this.turnCounter = mapped.filter(m => m.role === 'user').length;
    this.notify();
  }

  subscribe(listener: (state: SalesDeskState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify() {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  logEvent(type: SalesDeskEvent['type'], payload?: Record<string, any>) {
    const idSuffix = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().substring(0, 8) : Math.random().toString(36).substring(2, 6);
    const event: SalesDeskEvent = {
      id: `evt_${Date.now()}_${idSuffix}`,
      sessionId: this.state.sessionId,
      timestamp: new Date().toISOString(),
      type,
      payload,
    };
    const nextLogs = [...this.state.eventLogs, event];
    this.state = {
      ...this.state,
      eventLogs: nextLogs.length > 100 ? nextLogs.slice(-100) : nextLogs
    };
    if (typeof console !== 'undefined' && process.env.NODE_ENV !== 'production') {
      console.log(`[SalesDesk Event][${type}]`, payload || '');
    }
  }

  setVoiceState(voiceState: VoiceState) {
    this.state = { ...this.state, voiceState };
    this.notify();
  }

  setInterimTranscript(interimTranscript: string) {
    this.state = { ...this.state, interimTranscript };
    this.notify();
  }

  switchMode(targetMode: SalesDeskMode, reason = 'user_action') {
    if (this.state.mode === targetMode) return;
    
    this.logEvent('MODE_SWITCHED', { from: this.state.mode, to: targetMode, reason });
    this.state = {
      ...this.state,
      mode: targetMode,
      voiceState: targetMode === 'voice' ? 'listening' : 'idle',
      interimTranscript: ''
    };
    this.notify();
  }

  addUserMessage(content: string): ChatMessage {
    const msg: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      role: 'user',
      content: content.trim(),
      timestamp: new Date().toISOString(),
    };

    this.logEvent('USER_SPEECH_FINALIZED', { content });
    this.state = {
      ...this.state,
      messages: [...this.state.messages, msg],
      interimTranscript: ''
    };
    this.notify();
    return msg;
  }

  addAssistantMessage(content: string): ChatMessage {
    const msg: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      role: 'assistant',
      content: content.trim(),
      timestamp: new Date().toISOString(),
    };

    this.logEvent('AI_RESPONSE_COMPLETED', { content });
    this.state = {
      ...this.state,
      messages: [...this.state.messages, msg]
    };
    this.notify();
    return msg;
  }

  /**
   * Deterministic stage validation logic.
   * Prevents arbitrary stage jumps without required facts.
   */
  canTransitionToStage(targetStage: SalesStage): boolean {
    const current = this.state.salesStage;
    const ctx = this.state.buyerContext;

    switch (targetStage) {
      case 'GREETING':
        return true;
      case 'DISCOVERY':
        return current === 'GREETING' || current === 'DISCOVERY';
      case 'QUALIFYING':
        // Requires vehicle or budget or income context to enter qualifying
        return (
          !!ctx.targetVehicle?.value ||
          !!ctx.monthlyBudget?.value ||
          !!ctx.monthlyIncome?.value ||
          current === 'DISCOVERY'
        );
      case 'PRE_QUAL_READY':
        // Requires vehicle or budget information
        return !!ctx.targetVehicle?.value || !!ctx.monthlyBudget?.value;
      case 'HANDOFF':
        // Requires either contact info or explicit request
        return !!ctx.name?.value || !!ctx.phone?.value || !!ctx.email?.value;
      default:
        return true;
    }
  }

  setSalesStage(stage: SalesStage, reason?: string) {
    if (this.state.salesStage === stage) return;
    if (!this.canTransitionToStage(stage)) {
      console.warn(`[SalesOrchestrator] Gated stage transition rejected: ${this.state.salesStage} -> ${stage}`);
      return;
    }

    this.logEvent('SALES_STAGE_CHANGED', { from: this.state.salesStage, to: stage, reason });
    this.state = {
      ...this.state,
      salesStage: stage
    };
    this.notify();
  }

  updateBuyerContext(fields: Partial<Record<keyof BuyerContext, any>>) {
    const updated = { ...this.state.buyerContext };
    const now = new Date().toISOString();
    const knownFields = new Set(this.state.fieldMemory.knownFields);
    const unknownFields = new Set(this.state.fieldMemory.unknownFields);

    for (const [key, item] of Object.entries(fields)) {
      if (item === undefined || item === null || item === '') continue;

      const fieldKey = key as keyof BuyerContext;
      const current = updated[fieldKey];
      const val = (typeof item === 'object' && item !== null && 'value' in item) ? item.value : item;
      const src = (typeof item === 'object' && item !== null && 'source' in item) ? item.source : 'user';
      const conf = (typeof item === 'object' && item !== null && 'confidence' in item) ? item.confidence : 1.0;

      // Rule: Do not overwrite explicit 'user' fact with an 'inferred' estimate
      if (current?.source === 'user' && src === 'inferred') {
        continue;
      }

      (updated as any)[fieldKey] = {
        value: val,
        source: src,
        confidence: conf,
        updatedAt: now
      };

      knownFields.add(key);
      unknownFields.delete(key);
    }

    this.logEvent('BUYER_CONTEXT_UPDATED', { fields });
    this.state = {
      ...this.state,
      buyerContext: updated,
      fieldMemory: {
        ...this.state.fieldMemory,
        knownFields: Array.from(knownFields),
        unknownFields: Array.from(unknownFields)
      }
    };
    this.notify();
  }

  /**
   * Deterministic execution of actions proposed by Conversation Engine
   */
  async executeAction(action: SalesDeskAction): Promise<void> {
    this.logEvent('TOOL_EXECUTED', { action });

    switch (action.type) {
      case 'switch_sales_desk_mode':
        this.switchMode(action.mode, 'ai_conversation_intent');
        break;

      case 'capture_buyer_information':
        this.updateBuyerContext(action.fields);
        break;

      case 'record_lead_signal':
        this.logEvent('BUYER_CONTEXT_UPDATED', { signal: action.signalType, value: action.value });
        break;

      case 'record_objection':
        this.updateBuyerContext({
          activeObjection: { value: action.objection.objectionType, source: 'user', confidence: 1.0, updatedAt: new Date().toISOString() },
          objections: { value: action.objection.details || action.objection.objectionType, source: 'user', confidence: 1.0, updatedAt: new Date().toISOString() }
        });
        break;

      case 'update_sales_stage':
        this.setSalesStage(action.stage, action.reason);
        break;

      case 'hand_off_to_human': {
        this.state = { ...this.state, isHandoffRequested: true };
        this.setSalesStage('HANDOFF', 'Specialist follow-up requested');
        this.logEvent('HUMAN_HANDOFF', { name: action.name, summary: action.summary });
        
        // Auto-update buyer contact info
        this.updateBuyerContext({
          name: { value: action.name, source: 'user', confidence: 1.0, updatedAt: new Date().toISOString() },
          phone: action.phone ? { value: action.phone, source: 'user', confidence: 1.0, updatedAt: new Date().toISOString() } : undefined,
          email: action.email ? { value: action.email, source: 'user', confidence: 1.0, updatedAt: new Date().toISOString() } : undefined,
          monthlyIncome: action.income ? { value: parseFloat(action.income) || 0, source: 'user', confidence: 1.0, updatedAt: new Date().toISOString() } : undefined,
        });

        // Persist lead to database via /api/lead asynchronously (non-blocking)
        const leadIdSuffix = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().substring(0, 8) : Math.random().toString(36).substring(2, 8);
        fetch('/api/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            id: `lead_${Date.now()}_${leadIdSuffix}`,
            name: action.name,
            phone: action.phone || '',
            email: action.email || '',
            monthlyIncome: action.income || '',
            source: 'AI_SALES_DESK',
            status: 'NEW',
            sales_brief: action.summary,
            recommended_next_action: action.urgency || 'CALL_ASAP'
          })
        }).catch(err => {
          console.error('[SalesOrchestrator] Failed to persist specialist lead:', err);
        });
        break;
      }

      case 'start_pre_approval': {
        this.logEvent('PRE_APPROVAL_STARTED', { vehicleType: action.vehicleType, budget: action.budget });
        if (action.vehicleType) {
          this.updateBuyerContext({
            targetVehicle: { value: action.vehicleType, source: 'user', confidence: 1.0, updatedAt: new Date().toISOString() }
          });
        }
        break;
      }
    }
  }

  private turnCounter = 0;
  private isProcessingTurn = false;
  private turnQueue: Array<{
    text: string;
    resolve: (res: SalesDeskResponse) => void;
    reject: (err: any) => void;
  }> = [];

  /**
   * Dispatches message to Conversation Engine backend (/api/chat)
   */
  async processUserMessage(text: string): Promise<SalesDeskResponse> {
    const cleanText = (text || '').trim();
    if (!cleanText) {
      console.warn('[TURN_SKIPPED] Empty transcript submitted');
      return {
        message: "I beg your pardon, I did not catch that. Could you please repeat?",
        conversationalAction: 'speak_and_listen'
      };
    }

    if (this.isProcessingTurn) {
      console.log(`[TURN_QUEUED] Turn queued while turn ${this.turnCounter} is in-flight: "${cleanText}"`);
      // Bounded queue: drop oldest if exceeding 5 pending turns
      if (this.turnQueue.length >= 5) {
        const oldest = this.turnQueue.shift();
        oldest?.resolve({
          message: '',
          conversationalAction: 'listen'
        });
      }
      return new Promise<SalesDeskResponse>((resolve, reject) => {
        this.turnQueue.push({ text: cleanText, resolve, reject });
      });
    }

    this.isProcessingTurn = true;
    this.turnCounter++;
    const turnId = this.turnCounter;

    this.addUserMessage(cleanText);
    this.setVoiceState('thinking');
    console.log(`[TURN_ID] ${turnId}`);
    console.log(`[API_REQUEST] turnId=${turnId} sessionId=${this.state.sessionId} message="${cleanText}"`);

    try {
      const historyPayload = this.state.messages
        .filter(m => m.id !== 'welcome')
        .map(m => ({ role: m.role, content: m.content }));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          sessionId: this.state.sessionId,
          conversationId: this.state.sessionId,
          turnId,
          history: historyPayload,
          message: cleanText,
          salesStage: this.state.salesStage,
          buyerContext: this.state.buyerContext
        })
      });

      console.log(`[API_RESPONSE] turnId=${turnId} status=${res.status}`);

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        const reason = typeof errorData.error === 'object'
          ? (errorData.error.message || JSON.stringify(errorData.error))
          : (errorData.error || `HTTP ${res.status}`);
        throw new Error(reason);
      }

      const data: ChatResponse = await res.json();
      
      // Update Lead Intelligence metrics and Sales Brief
      if (data.leadIntelligence) {
        this.state = {
          ...this.state,
          leadIntelligence: data.leadIntelligence,
          salesBrief: data.salesBrief || this.state.salesBrief,
          customerSummary: data.customerSummary || this.state.customerSummary
        };
      }

      // Execute any structured actions deterministically (Directive 3)
      if (data.actions && Array.isArray(data.actions)) {
        for (const act of data.actions) {
          await this.executeAction(act);
        }
      }

      if (data.buyerContext) {
        this.updateBuyerContext(data.buyerContext);
      }

      if (data.salesStage) {
        this.setSalesStage(data.salesStage, 'api_response_stage_update');
      }

      const messageContent = (data && typeof data.message === 'string' && data.message.trim() !== '')
        ? data.message.trim()
        : "Certainly. How may I best assist with your vehicle search or financing today?";

      console.log(`[RESPONSE_MESSAGE] turnId=${turnId} message="${messageContent}"`);

      const assistantMsg = this.addAssistantMessage(messageContent);
      return {
        message: assistantMsg.content,
        actions: data.actions || [],
        conversationalAction: data.conversationalAction || 'speak_and_listen',
        nextObjective: data.nextObjective || 'discover_vehicle',
        turnId,
        suggestedStage: data.salesStage,
        handoffRequested: this.state.isHandoffRequested,
        leadIntelligence: this.state.leadIntelligence,
        salesBrief: this.state.salesBrief,
        customerSummary: this.state.customerSummary
      };
    } catch (err: any) {
      console.error(`[API_FAILED] turnId=${turnId} reason="${err.message}"`, err);
      this.logEvent('ERROR_OCCURRED', { turnId, message: err.message });
      this.setVoiceState('error');
      const fallbackMsg = "I beg your pardon, I experienced a brief processing issue. Please feel free to continue speaking.";
      this.addAssistantMessage(fallbackMsg);
      return { message: fallbackMsg, conversationalAction: 'speak_and_listen', turnId, nextObjective: 'none' };
    } finally {
      this.isProcessingTurn = false;
      if (this.turnQueue.length > 0) {
        const next = this.turnQueue.shift();
        if (next) {
          this.processUserMessage(next.text)
            .then(next.resolve)
            .catch(next.reject);
        }
      }
    }
  }
}
