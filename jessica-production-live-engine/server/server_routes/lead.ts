import express from 'express';
import crypto from 'crypto';
import { queryDB } from './db.js';

export const leadRouter = express.Router();

async function authenticateSession(req: express.Request, res: express.Response, next: express.NextFunction) {
  const rawToken = req.cookies.winston_session;
  if (!rawToken) {
    return res.status(401).json({ error: "Unauthorized. Missing session cookie." });
  }
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const sessionResult = await queryDB("SELECT * FROM anonymous_sessions WHERE session_token_hash = $1 AND expires_at > CURRENT_TIMESTAMP", [tokenHash]);
  
  if (sessionResult.rows.length === 0) {
    return res.status(401).json({ error: "Unauthorized. Invalid or expired session." });
  }
  (req as any).anonymousSessionId = sessionResult.rows[0].id;
  next();
}

leadRouter.post('/', authenticateSession, async (req, res) => {
  try {
    const anonymousSessionId = (req as any).anonymousSessionId;
    const { conversationId, leadData } = req.body;
    
    if (!conversationId) {
      return res.status(400).json({ error: "Missing conversationId" });
    }

    const convResult = await queryDB("SELECT * FROM conversations WHERE id = $1 AND anonymous_session_id = $2", [conversationId, anonymousSessionId]);
    if (convResult.rows.length === 0) {
      return res.status(403).json({ error: "Forbidden. Conversation does not belong to session." });
    }

    const hasContactInfo = (leadData.name && leadData.name.trim() !== '') || 
                           (leadData.email && leadData.email.trim() !== '') || 
                           (leadData.phone && leadData.phone.trim() !== '');

    if (!hasContactInfo) {
      return res.status(200).json({ success: true, message: "Partial lead ignored (no contact info)" });
    }

    const leadId = 'lead_' + crypto.randomUUID();

    const insertQuery = `
        INSERT INTO leads (
          id, conversation_id, name, email, phone, location, employment, income, 
          "creditScore", "monthlyDebt", "downPayment", "housingStatus", vehicle, "selectedModel", "selectedModelYear",
          status, "createdAt"
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15,
          $16, CURRENT_TIMESTAMP
        ) RETURNING *;
    `;
    const values = [
      leadId,
      conversationId,
      leadData.name || null,
      leadData.email || null,
      leadData.phone || null,
      leadData.location || null,
      leadData.employment || null,
      leadData.income || null,
      leadData.creditScore || null,
      leadData.monthlyDebt || null,
      leadData.downPayment || null,
      leadData.housingStatus || null,
      leadData.vehicle || null,
      leadData.selectedModel || null,
      leadData.selectedModelYear || null,
      'NEW'
    ];

    const result = await queryDB(insertQuery, values);

    return res.status(200).json({
        success: true,
        leadId: leadId,
        updatedAt: result.rows[0].createdAt
    });
  } catch (error) {
    console.error("[LEAD_ROUTE_ERROR]", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
