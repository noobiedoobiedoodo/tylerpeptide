import express from 'express';
import crypto from 'crypto';
import { queryDB } from './db.js';

export const sessionRouter = express.Router();

sessionRouter.post('/init', async (req, res) => {
  try {
    const existingRawToken = req.cookies?.winston_session;
    let sessionId: string | null = null;
    let tokenHash: string | null = null;

    if (existingRawToken && typeof existingRawToken === 'string') {
      tokenHash = crypto.createHash('sha256').update(existingRawToken).digest('hex');
      const sessionResult = await queryDB(
        "SELECT id FROM anonymous_sessions WHERE session_token_hash = $1 AND expires_at > CURRENT_TIMESTAMP", 
        [tokenHash]
      );
      if (sessionResult.rows.length > 0) {
        sessionId = sessionResult.rows[0].id;
      }
    }

    if (!sessionId) {
      // 1. Generate high-entropy opaque token (never signed, strictly hashed)
      const rawToken = crypto.randomUUID() + crypto.randomBytes(32).toString('hex');
      tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      sessionId = 'ses_' + crypto.randomUUID();

      await queryDB(
        "INSERT INTO anonymous_sessions (id, session_token_hash, expires_at) VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '24 hours')",
        [sessionId, tokenHash]
      );

      res.cookie('winston_session', rawToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production' || !!process.env.VERCEL,
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000,
        path: '/'
      });
    }

    // 2. Fetch or create active conversation for this anonymous session
    const convResult = await queryDB(
      "SELECT id, version, status FROM conversations WHERE anonymous_session_id = $1 ORDER BY created_at DESC LIMIT 1",
      [sessionId]
    );

    let activeConversationId: string;
    if (convResult.rows.length > 0) {
      activeConversationId = convResult.rows[0].id;
    } else {
      activeConversationId = 'conv_' + crypto.randomUUID();
      await queryDB(
        "INSERT INTO conversations (id, anonymous_session_id, version, status) VALUES ($1, $2, 0, 'ACTIVE')",
        [activeConversationId, sessionId]
      );
    }

    // 3. Load completed history turns mapped to canonical ChatMessage structure
    const historyResult = await queryDB(
      "SELECT id, turn_id, sequence_number, user_transcript, assistant_response, processing_started_at, completed_at FROM conversation_turns WHERE conversation_id = $1 AND status = 'COMPLETED' ORDER BY sequence_number ASC",
      [activeConversationId]
    );

    const canonicalHistory: Array<{ id: string; role: 'user' | 'assistant'; content: string; timestamp: string }> = [];
    
    for (const row of historyResult.rows) {
      if (row.user_transcript) {
        canonicalHistory.push({
          id: `msg_user_${row.turn_id || row.id}`,
          role: 'user',
          content: row.user_transcript,
          timestamp: row.processing_started_at ? new Date(row.processing_started_at).toISOString() : new Date().toISOString()
        });
      }
      if (row.assistant_response) {
        try {
          const parsed = JSON.parse(row.assistant_response);
          const assistantContent = parsed.message || parsed.textResponse || (typeof parsed === 'string' ? parsed : '');
          if (assistantContent) {
            canonicalHistory.push({
              id: `msg_assistant_${row.turn_id || row.id}`,
              role: 'assistant',
              content: assistantContent,
              timestamp: row.completed_at ? new Date(row.completed_at).toISOString() : new Date().toISOString()
            });
          }
        } catch (e) {}
      }
    }

    return res.json({
      ok: true,
      sessionId,
      conversationId: activeConversationId,
      status: "ACTIVE",
      history: canonicalHistory
    });

  } catch (error: any) {
    console.error('[Session Init Error]', error);
    return res.status(500).json({
      ok: false,
      error: {
        code: "SESSION_INIT_FAILED",
        message: "Unable to initialize conversation session"
      }
    });
  }
});
