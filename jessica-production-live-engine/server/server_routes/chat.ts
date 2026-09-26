import express from 'express';
import crypto from 'crypto';
import { queryDB } from './db.js';
import { ai, calculateLeadIntelligence } from './ai.js';
import { Type } from "@google/genai";

export const chatRouter = express.Router();

chatRouter.post('/', async (req, res) => {
  const executionId = 'exec_' + crypto.randomUUID();
  try {
    const rawToken = req.cookies?.winston_session || (typeof req.headers['x-winston-session'] === 'string' ? req.headers['x-winston-session'] : undefined);
    if (!rawToken || typeof rawToken !== 'string') {
      return res.status(401).json({
        ok: false,
        error: { code: "UNAUTHORIZED", message: "Missing or invalid session cookie." }
      });
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const sessionResult = await queryDB(
      "SELECT id FROM anonymous_sessions WHERE session_token_hash = $1 AND expires_at > CURRENT_TIMESTAMP",
      [tokenHash]
    );
    
    if (sessionResult.rows.length === 0) {
      return res.status(401).json({
        ok: false,
        error: { code: "SESSION_EXPIRED", message: "Session is invalid or expired." }
      });
    }

    const anonymousSessionId = sessionResult.rows[0].id;
    const { conversationId, turnId, message, buyerContext = {}, salesStage = 'GREETING' } = req.body || {};

    if (
      !conversationId ||
      typeof conversationId !== 'string' ||
      conversationId.trim().length === 0 ||
      conversationId.length > 255
    ) {
      return res.status(400).json({
        ok: false,
        error: { code: "INVALID_REQUEST", message: "Invalid or missing conversationId (must be non-empty string up to 255 chars)." }
      });
    }

    if (
      turnId === undefined ||
      turnId === null ||
      (typeof turnId !== 'string' && typeof turnId !== 'number') ||
      String(turnId).trim().length === 0 ||
      String(turnId).length > 255
    ) {
      return res.status(400).json({
        ok: false,
        error: { code: "INVALID_REQUEST", message: "Invalid or missing turnId (must be string/number up to 255 chars)." }
      });
    }

    if (
      !message ||
      typeof message !== 'string' ||
      message.trim().length === 0 ||
      message.length > 10000
    ) {
      return res.status(400).json({
        ok: false,
        error: { code: "INVALID_REQUEST", message: "Invalid or missing message (must be non-empty string up to 10,000 chars)." }
      });
    }

    const cleanMessage = message.trim();
    const strTurnId = String(turnId).trim();

    // 1. Authorize Conversation Ownership
    let convResult = await queryDB(
      "SELECT * FROM conversations WHERE id = $1 AND anonymous_session_id = $2",
      [conversationId, anonymousSessionId]
    );
    
    if (convResult.rows.length === 0) {
      // Check if conversation exists under another session (IDOR protection)
      const otherConv = await queryDB("SELECT id FROM conversations WHERE id = $1", [conversationId]);
      if (otherConv.rows.length > 0) {
        return res.status(403).json({
          ok: false,
          error: { code: "FORBIDDEN", message: "Access to this conversation is unauthorized." }
        });
      }

      // If new, create conversation record
      try {
        convResult = await queryDB(
          "INSERT INTO conversations (id, anonymous_session_id, version, status) VALUES ($1, $2, 0, 'ACTIVE') RETURNING *",
          [conversationId, anonymousSessionId]
        );
      } catch (err) {
        convResult = await queryDB(
          "SELECT * FROM conversations WHERE id = $1 AND anonymous_session_id = $2",
          [conversationId, anonymousSessionId]
        );
        if (convResult.rows.length === 0) {
          return res.status(404).json({
            ok: false,
            error: { code: "NOT_FOUND", message: "Conversation could not be initialized." }
          });
        }
      }
    }

    let conversation = convResult.rows[0];

    // 2. Check Idempotency & Database-Authoritative Lease Reclaim
    const existingTurn = await queryDB(
      "SELECT * FROM conversation_turns WHERE conversation_id = $1 AND turn_id = $2",
      [conversationId, strTurnId]
    );

    let turnRecord: any = null;

    if (existingTurn.rows.length > 0) {
      const row = existingTurn.rows[0];
      if (row.status === 'COMPLETED' && row.assistant_response) {
        try {
          const cachedResponse = JSON.parse(row.assistant_response);
          return res.json({ ok: true, ...cachedResponse });
        } catch (e) {
          return res.json({ ok: true, message: row.assistant_response, conversationId, turnId: strTurnId });
        }
      }

      // Atomic database-authoritative lease takeover: only reclaim if FAILED or PROCESSING and older than 45s according to PostgreSQL NOW()
      const reclaimResult = await queryDB(
        `UPDATE conversation_turns
         SET execution_id = $1, processing_started_at = NOW(), status = 'PROCESSING'
         WHERE conversation_id = $2 AND turn_id = $3
           AND (
             status = 'FAILED'
             OR (status = 'PROCESSING' AND processing_started_at < NOW() - INTERVAL '45 seconds')
           )
         RETURNING *`,
        [executionId, conversationId, strTurnId]
      );

      if (reclaimResult.rows.length > 0) {
        turnRecord = reclaimResult.rows[0];
      } else {
        // Still actively processing and within 45s window
        return res.status(409).json({
          ok: false,
          error: { code: "TURN_PROCESSING", message: "This turn is currently processing. Please wait or retry after lease timeout." }
        });
      }
    }

    // 3. Transactional Sequence Allocation with Optimistic Locking (for new turns)
    if (!turnRecord) {
      const nextSequence = Number(conversation.version || 0) + 1;
      try {
        const insertResult = await queryDB(
          `INSERT INTO conversation_turns (id, conversation_id, turn_id, sequence_number, user_transcript, status, execution_id, processing_started_at) 
           VALUES ($1, $2, $3, $4, $5, 'PROCESSING', $6, NOW()) RETURNING *`,
          ['turn_' + crypto.randomUUID(), conversationId, strTurnId, nextSequence, cleanMessage, executionId]
        );
        turnRecord = insertResult.rows[0];

        // Optimistic lock on conversation version
        const updateConv = await queryDB(
          "UPDATE conversations SET version = $1, updated_at = NOW() WHERE id = $2 AND version = $3",
          [nextSequence, conversationId, conversation.version]
        );

        if (updateConv.rowCount === 0) {
          // Concurrent version conflict - revert inserted turn
          await queryDB("DELETE FROM conversation_turns WHERE id = $1", [turnRecord.id]);
          return res.status(409).json({
            ok: false,
            error: { code: "CONCURRENCY_CONFLICT", message: "Conversation sequence conflict. Please retry." }
          });
        }
      } catch (dbErr: any) {
        if (dbErr.code === '23505') { // UNIQUE constraint violation
          const recheck = await queryDB(
            "SELECT * FROM conversation_turns WHERE conversation_id = $1 AND turn_id = $2",
            [conversationId, strTurnId]
          );
          if (recheck.rows.length > 0 && recheck.rows[0].status === 'COMPLETED' && recheck.rows[0].assistant_response) {
            return res.json({ ok: true, ...JSON.parse(recheck.rows[0].assistant_response) });
          }
          return res.status(409).json({
            ok: false,
            error: { code: "DUPLICATE_TURN", message: "A turn with this ID is already registered or processing." }
          });
        }
        throw dbErr;
      }
    }

    // 4. Load Durable Completed History from PostgreSQL (Source of Truth)
    const historyResult = await queryDB(
      "SELECT user_transcript, assistant_response FROM conversation_turns WHERE conversation_id = $1 AND status = 'COMPLETED' ORDER BY sequence_number ASC",
      [conversationId]
    );

    const contents: any[] = [];
    for (const row of historyResult.rows) {
      if (row.user_transcript) {
        contents.push({ role: 'user', parts: [{ text: row.user_transcript }] });
      }
      if (row.assistant_response) {
        try {
          const parsed = JSON.parse(row.assistant_response);
          const reply = parsed.message || parsed.textResponse || (typeof parsed === 'string' ? parsed : '');
          if (reply) {
            contents.push({ role: 'model', parts: [{ text: reply }] });
          }
        } catch (e) {}
      }
    }
    contents.push({ role: 'user', parts: [{ text: cleanMessage }] });

    // 5. System Prompt & Sales Desk Tools
    const systemInstruction = `You are Jarvis, the 24/7 AI Automotive Advisor and Sales Intelligence for "Your New Auto" (YNA).
MISSION & PHILOSOPHY:
You are an expert AI sales desk, not a generic chatbot. Your commercial goal is to identify genuine vehicle-buying intent, build trust, demonstrate value, and convert qualified prospects into complete, actionable leads for human follow-up with our senior specialist, Stephan.
You prioritize QUALITY over quantity: 10 high-intent, contactable, well-qualified buyers are vastly more valuable than 100 empty submissions.
Guide the conversation answering: "What does this customer need to hear or understand to confidently take the next step?"

PSYCHOLOGICAL PROGRESSION:
RAPPORT -> DISCOVERY -> NEED / PAIN -> VEHICLE FIT -> FINANCING / BUDGET -> VALUE CREATION -> MICRO-COMMITMENT -> CONTACT CAPTURE -> HUMAN HANDOFF.

CONVERSATION & EXTRACTION RULES:
1. PROGRESSIVE & OPPORTUNISTIC EXTRACTION:
   - Extract ALL observable facts from the user's statements immediately.
2. "DON'T ASK" MEMORY SYSTEM:
   - NEVER re-ask for information already known or provided.
3. FORWARD & VALUE-FRAMED CONTACT CAPTURE:
   - Frame contact requests with a clear, valuable reason connected to Stephan.
4. CONVERSATIONAL CADENCE:
   - Respond in 1-2 natural, spoken sentences (under 30 words total).
   - End with ONE clear, focused question moving toward the next value step.`;

    const salesDeskTools = {
      functionDeclarations: [
        {
          name: "capture_buyer_information",
          description: "Captures stated buyer attributes: vehicle, budget, timeline, trade, income, credit, or contact details.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              firstName: { type: Type.STRING, description: "Customer's first name" },
              lastName: { type: Type.STRING, description: "Customer's last name" },
              name: { type: Type.STRING, description: "Customer's full name" },
              email: { type: Type.STRING, description: "Customer's email" },
              phone: { type: Type.STRING, description: "Customer's phone number" },
              location: { type: Type.STRING, description: "City or region" },
              targetVehicle: { type: Type.STRING, description: "Vehicle type (SUV, Sedan, Truck, Van)" },
              monthlyBudget: { type: Type.NUMBER, description: "Target monthly payment in CAD" },
              purchaseTimeline: { type: Type.STRING, description: "Timeline" },
              hasTrade: { type: Type.BOOLEAN, description: "Whether client has a trade-in" },
              tradeVehicle: { type: Type.STRING, description: "Trade-in year/make/model" },
              monthlyIncome: { type: Type.NUMBER, description: "Estimated monthly income" },
              creditSituation: { type: Type.STRING, description: "Credit status" }
            }
          }
        },
        {
          name: "update_sales_stage",
          description: "Transitions the sales conversation to the next stage.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              stage: { type: Type.STRING, enum: ["GREETING", "DISCOVERY", "QUALIFYING", "PRE_QUAL_READY", "HANDOFF"], description: "New sales stage" },
              reason: { type: Type.STRING, description: "Rationale for stage progression" }
            },
            required: ["stage"]
          }
        },
        {
          name: "hand_off_to_human",
          description: "Requests senior specialist follow-up (Stephan) when intent is high or contact is provided.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING, description: "Customer's name" },
              email: { type: Type.STRING, description: "Customer's email" },
              phone: { type: Type.STRING, description: "Customer's phone number" },
              summary: { type: Type.STRING, description: "Executive summary for Stephan" }
            },
            required: ["name", "summary"]
          }
        }
      ]
    };

    // 6. Direct Gemini-2.5-Flash Execution (Zero 404 retries)
    if (!ai) {
      throw new Error("Gemini AI instance is not configured on server.");
    }

    const preferredModel = (process.env.GEMINI_MODEL && process.env.GEMINI_MODEL !== 'gemini-3.6-flash')
      ? process.env.GEMINI_MODEL
      : 'gemini-3.8-flash';

    const candidateModels = [preferredModel, 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-flash-latest'].filter((m, i, arr) => arr.indexOf(m) === i);

    let response: any = null;
    let lastError: any = null;

    for (const modelName of candidateModels) {
      try {
        response = await ai.models.generateContent({
          model: modelName,
          contents,
          config: {
            systemInstruction,
            tools: [salesDeskTools]
          }
        });
        if (response) {
          lastError = null;
          break;
        }
      } catch (llmError: any) {
        lastError = llmError;
        console.warn(`[LLM Failover] Model ${modelName} failed (${llmError?.message || llmError}). Trying next candidate...`);
      }
    }

    if (!response && lastError) {
      console.error("[LLM Error]", lastError?.message || lastError);

      const isRateLimit =
        lastError?.status === 429 ||
        lastError?.code === 429 ||
        lastError?.error?.code === 429 ||
        lastError?.error?.status === 'RESOURCE_EXHAUSTED' ||
        String(lastError?.message || '').includes('RESOURCE_EXHAUSTED') ||
        String(lastError?.message || '').includes('Quota exceeded') ||
        String(lastError?.message || '').includes('rate-limits');

      const isNetworkError =
        lastError?.code === 'ENOTFOUND' ||
        lastError?.code === 'ECONNRESET' ||
        lastError?.code === 'ETIMEDOUT' ||
        String(lastError?.message || '').includes('fetch failed');

      const errorCode = isRateLimit
        ? "LLM_RATE_LIMITED"
        : (isNetworkError ? "LLM_NETWORK_ERROR" : "LLM_PROVIDER_ERROR");

      const httpStatus = isRateLimit ? 429 : (isNetworkError ? 503 : 502);

      // Deterministically mark turn as FAILED in database so it can be retried safely
      await queryDB(
        "UPDATE conversation_turns SET status = 'FAILED', failed_at = NOW() WHERE id = $1 AND execution_id = $2",
        [turnRecord.id, executionId]
      );

      return res.status(httpStatus).json({
        ok: false,
        error: {
          code: errorCode,
          message: isRateLimit
            ? "AI capacity limit reached. Please retry in a few moments."
            : "Upstream AI service temporarily unavailable. Please retry.",
          retryable: true,
          turnId: strTurnId,
          conversationId
        }
      });
    }

    // 7. Parse LLM Output & Tool Calls
    const actions: any[] = [];
    let textResponse = '';
    
    // Extract text from parts array if available
    const candidate = response?.candidates?.[0];
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (typeof part.text === 'string' && part.text.trim()) {
          textResponse += (textResponse ? ' ' : '') + part.text.trim();
        }
      }
    }
    if (!textResponse && typeof response?.text === 'string') {
      textResponse = response.text.trim();
    }

    const currentContext = { ...(buyerContext || {}) };
    let handoff = false;
    let updatedStage: string | null = null;

    if (response?.functionCalls && response.functionCalls.length > 0) {
      for (const fc of response.functionCalls) {
        if (fc.name === "capture_buyer_information") {
          const args = fc.args as any;
          Object.assign(currentContext, args);
          actions.push({ type: 'capture_buyer_information', fields: args });
        } else if (fc.name === "update_sales_stage") {
          updatedStage = (fc.args as any).stage;
          actions.push({ type: 'update_sales_stage', stage: updatedStage });
        } else if (fc.name === "hand_off_to_human") {
          handoff = true;
          const args = fc.args as any;
          actions.push({ type: 'hand_off_to_human', ...args });
        }
      }
    }

    // Opportunistic extraction from user message
    const lowerMsg = cleanMessage.toLowerCase();
    if (/\bsuv\b/i.test(lowerMsg)) currentContext.targetVehicle = 'SUV';
    else if (/\btruck\b/i.test(lowerMsg)) currentContext.targetVehicle = 'Truck';
    else if (/\bsedan\b|\bcar\b/i.test(lowerMsg)) currentContext.targetVehicle = 'Sedan';
    else if (/\bvan\b/i.test(lowerMsg)) currentContext.targetVehicle = 'Van';

    const budgetMatch = cleanMessage.match(/\$?([2-9]\d{2}|[1-4]\d{3})\b/);
    if (budgetMatch && !currentContext.monthlyBudget) {
      const b = parseInt(budgetMatch[1], 10);
      if (b >= 200 && b <= 5000) currentContext.monthlyBudget = b;
    }

    // Credit situation extraction
    if (!currentContext.creditSituation) {
      if (/\b(excellent|great|good|7\d{2}|8\d{2})\b/i.test(lowerMsg)) {
        currentContext.creditSituation = 'Good';
      } else if (/\b(fair|average|okay|6\d{2})\b/i.test(lowerMsg)) {
        currentContext.creditSituation = 'Fair';
      } else if (/\b(rebuilding|bad|poor|low|collections|consumer proposal|bankruptcy|5\d{2}|4\d{2})\b/i.test(lowerMsg)) {
        currentContext.creditSituation = 'Rebuilding';
      }
    }

    // Monthly income extraction
    const incomeMatch = cleanMessage.match(/(?:income|make|earn|gross)?\s*\$?([2-9]\d{3}|[1-9]\d{4})\b/i);
    if (incomeMatch && !currentContext.monthlyIncome) {
      const inc = parseInt(incomeMatch[1], 10);
      if (inc >= 1500 && inc <= 50000) currentContext.monthlyIncome = inc;
    }

    // Phone and Email extraction
    const phoneMatch = cleanMessage.match(/(\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/);
    if (phoneMatch && !currentContext.phone) {
      currentContext.phone = phoneMatch[0];
    }
    const emailMatch = cleanMessage.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch && !currentContext.email) {
      currentContext.email = emailMatch[0];
    }

    // Context-aware intelligent fallback progression (Never repeat known questions)
    if (!textResponse) {
      if (handoff || (currentContext.phone && (currentContext.name || currentContext.email))) {
        textResponse = `Splendid! I have everything organized for your ${currentContext.targetVehicle || 'vehicle'}. I'll have Stephan review your details and reach out to you directly.`;
      } else if (currentContext.creditSituation && currentContext.monthlyIncome) {
        textResponse = `Splendid! With your credit profile and income on a ${currentContext.targetVehicle || 'vehicle'}, we have strong lender options. What is the best phone number or email for Stephan to send your tailored options?`;
      } else if (currentContext.creditSituation) {
        textResponse = `Got it, thank you. To help us calculate the best approval terms for your $${currentContext.monthlyBudget || 600}/mo payment, what is your approximate gross monthly income?`;
      } else if (currentContext.targetVehicle && currentContext.monthlyBudget) {
        textResponse = `Splendid! A ${currentContext.targetVehicle} around $${currentContext.monthlyBudget} a month gives us fantastic options. How would you describe your current credit—good, fair, or rebuilding?`;
      } else if (currentContext.targetVehicle) {
        textResponse = `A ${currentContext.targetVehicle} is an excellent choice! What monthly budget range would you like to keep this within?`;
      } else {
        textResponse = "Delighted to assist! Are you looking for an SUV, Truck, Sedan, or Van to get started?";
      }
    }

    const metrics = calculateLeadIntelligence(currentContext, actions, cleanMessage);

    const finalResponse = {
      ok: true,
      message: textResponse,
      actions,
      conversationalAction: handoff ? 'handoff' : 'speak_and_listen',
      nextObjective: metrics.nextBestAction.toLowerCase(),
      conversationId,
      turnId,
      salesStage: updatedStage || salesStage,
      buyerContext: currentContext,
      leadIntelligence: metrics
    };

    // 8. Commit Assistant Turn to PostgreSQL
    await queryDB(
      "UPDATE conversation_turns SET assistant_response = $1, status = 'COMPLETED', completed_at = NOW() WHERE id = $2 AND execution_id = $3",
      [JSON.stringify(finalResponse), turnRecord.id, executionId]
    );

    return res.json(finalResponse);

  } catch (error: any) {
    console.error("[CHAT_ROUTE_FATAL]", error);
    try {
      await queryDB(
        "UPDATE conversation_turns SET status = 'FAILED', failed_at = NOW() WHERE execution_id = $1",
        [executionId]
      );
    } catch (e) {}
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred." }
    });
  }
});
