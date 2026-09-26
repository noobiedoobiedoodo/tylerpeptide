/**
 * server_routes/voiceLeadSync.ts
 * 
 * Authoritative backend voice lead conversion and CRM synchronization endpoint.
 * - Idempotently persists Jarvis 1:1 Live Voice leads into PostgreSQL
 * - Computes canonical lead intelligence metrics server-side
 * - Normalizes and merges incoming profile updates without data loss
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { queryDB } from './db.js';
import { calculateLeadIntelligence } from './ai.js';
import {
  BuyerProfile,
  mergeBuyerProfile,
  generateSalesBrief,
  normalizePhone,
  normalizeEmail,
  normalizeCurrency,
  normalizeCredit,
  normalizeVehicle
} from './voiceLeadExtractor.js';

export const voiceLeadRouter = Router();

// In-memory conversation-to-lead mapping with TTL (2 hours) for instant deduplication
interface CacheEntry {
  leadId: string;
  expiresAt: number;
}
const sessionLeadMap = new Map<string, CacheEntry>();
const SESSION_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_SESSION_CACHE_SIZE = 5000;

function getCachedLeadId(conversationId: string): string | undefined {
  const entry = sessionLeadMap.get(conversationId);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    sessionLeadMap.delete(conversationId);
    return undefined;
  }
  return entry.leadId;
}

function setCachedLeadId(conversationId: string, leadId: string): void {
  if (sessionLeadMap.size >= MAX_SESSION_CACHE_SIZE) {
    const now = Date.now();
    let pruned = 0;
    for (const [key, value] of sessionLeadMap.entries()) {
      if (now > value.expiresAt || pruned < 100) {
        sessionLeadMap.delete(key);
        pruned++;
      }
      if (pruned >= 200) break;
    }
  }
  sessionLeadMap.set(conversationId, {
    leadId,
    expiresAt: Date.now() + SESSION_CACHE_TTL_MS
  });
}

voiceLeadRouter.post('/sync-lead', async (req: Request, res: Response) => {
  try {
    const {
      conversationId,
      leadId: clientLeadId,
      buyerProfile = {},
      transcriptHistory = [],
      signals = [],
      lastTurn = '',
      forensics = null
    } = req.body;

    if (!conversationId) {
      return res.status(400).json({ error: 'Missing required conversationId' });
    }

    console.log('[JARVIS_CRM_SYNC_STARTED]', {
      conversationId,
      hasIncomingPhone: Boolean(buyerProfile.phone),
      hasIncomingVehicle: Boolean(buyerProfile.targetVehicle || buyerProfile.vehicleType),
      timestamp: Date.now()
    });

    // 1. Resolve stable Lead ID (Idempotency before any async tick)
    let leadId = clientLeadId || getCachedLeadId(conversationId);

    // Protection against resurrection of deleted leads
    if (leadId) {
      const delCheck = await queryDB('SELECT 1 FROM deleted_leads WHERE id = $1', [leadId]);
      if (delCheck.rows && delCheck.rows.length > 0) {
        console.log('[JARVIS_CRM_SYNC_IGNORED_DELETED]', { conversationId, leadId });
        return res.status(200).json({ success: true, ignored: true, reason: 'deleted', leadId });
      }
    }

    if (!leadId) {
      leadId = `lead_voice_${crypto.randomUUID()}`;
      setCachedLeadId(conversationId, leadId);
    }

    // 2. Query for existing lead in PostgreSQL / memory store
    let existingRecord: any = null;
    if (leadId) {
      const byId = await queryDB('SELECT * FROM leads WHERE id = $1', [leadId]);
      if (byId.rows && byId.rows.length > 0) {
        existingRecord = byId.rows[0];
      }
    }

    if (!existingRecord) {
      const byConv = await queryDB('SELECT * FROM leads WHERE conversation_id = $1', [conversationId]);
      if (byConv.rows && byConv.rows.length > 0) {
        existingRecord = byConv.rows[0];
        leadId = existingRecord.id;
        setCachedLeadId(conversationId, leadId);
      }
    }

    // 3. Map existing DB fields into existing profile
    const existingProfile: BuyerProfile = {};
    if (existingRecord) {
      if (existingRecord.name) existingProfile.name = existingRecord.name;
      if (existingRecord.phone) existingProfile.phone = existingRecord.phone;
      if (existingRecord.email) existingProfile.email = existingRecord.email;
      if (existingRecord.vehicle) existingProfile.targetVehicle = existingRecord.vehicle;
      if (existingRecord.vehicle_type) existingProfile.vehicleType = existingRecord.vehicle_type;
      if (existingRecord.monthly_income) existingProfile.monthlyIncome = normalizeCurrency(existingRecord.monthly_income) || undefined;
      if (existingRecord.credit_situation) existingProfile.creditSituation = existingRecord.credit_situation;
      if (existingRecord.down_payment || existingRecord.downPayment) {
        existingProfile.downPayment = normalizeCurrency(existingRecord.down_payment || existingRecord.downPayment) || undefined;
      }
      if (existingRecord.has_trade) existingProfile.hasTrade = Boolean(existingRecord.has_trade);
      if (existingRecord.trade_vehicle) existingProfile.tradeVehicle = existingRecord.trade_vehicle;
      if (existingRecord.budget || existingRecord.payment_target) {
        existingProfile.monthlyBudget = normalizeCurrency(existingRecord.budget || existingRecord.payment_target) || undefined;
      }
      if (existingRecord.purchase_timeline) existingProfile.purchaseTimeline = existingRecord.purchase_timeline;
      if (existingRecord.urgency) existingProfile.urgency = existingRecord.urgency;
    }

    // 4. Merge incoming delta with existing profile (Never erase data)
    const mergedProfile = mergeBuyerProfile(existingProfile, buyerProfile);

    // 5. Calculate Canonical Lead Intelligence Server-Side
    const intelContext = {
      name: mergedProfile.name,
      firstName: mergedProfile.name ? mergedProfile.name.split(' ')[0] : undefined,
      phone: mergedProfile.phone,
      email: mergedProfile.email,
      targetVehicle: mergedProfile.targetVehicle,
      vehicleType: mergedProfile.vehicleType,
      monthlyBudget: mergedProfile.monthlyBudget,
      paymentTarget: mergedProfile.monthlyBudget ? `$${mergedProfile.monthlyBudget}/mo` : undefined,
      creditSituation: mergedProfile.creditSituation,
      monthlyIncome: mergedProfile.monthlyIncome,
      income: mergedProfile.monthlyIncome ? String(mergedProfile.monthlyIncome) : undefined,
      downPayment: mergedProfile.downPayment,
      hasTrade: mergedProfile.hasTrade,
      tradeVehicle: mergedProfile.tradeVehicle,
      purchaseTimeline: mergedProfile.purchaseTimeline,
      urgency: mergedProfile.urgency
    };

    const rawMetrics = calculateLeadIntelligence(intelContext, signals, lastTurn);

    // Clamp numeric scores safely
    const metrics = {
      intentScore: Math.max(0, Math.min(100, Math.round(rawMetrics.intentScore || 0))),
      intentStage: rawMetrics.intentStage || 'CURIOUS',
      contactabilityScore: Math.max(0, Math.min(100, Math.round(rawMetrics.contactabilityScore || 0))),
      qualificationScore: Math.max(0, Math.min(100, Math.round(rawMetrics.qualificationScore || 0))),
      leadQualityScore: Math.max(0, Math.min(100, Math.round(rawMetrics.leadQualityScore || 0))),
      leadCompleteness: Math.max(0, Math.min(100, Math.round(rawMetrics.completenessScore || 0))),
      buyingCommitment: rawMetrics.buyingCommitment || 'NONE',
      nextBestAction: rawMetrics.nextBestAction || 'DISCOVER',
      recommendedNextAction: rawMetrics.recommendedNextAction || 'NURTURE',
      salesBrief: generateSalesBrief(mergedProfile)
    };

    // 6. Authoritative status assignment
    let status = 'NEW';
    if (metrics.intentScore >= 75 || metrics.recommendedNextAction === 'CALL_ASAP') {
      status = 'HIGH_INTENT';
    } else if (metrics.qualificationScore >= 60 && metrics.contactabilityScore >= 60) {
      status = 'QUALIFIED';
    }

    const firstName = mergedProfile.name ? mergedProfile.name.split(' ')[0] : null;
    const lastName = mergedProfile.name && mergedProfile.name.split(' ').length > 1
      ? mergedProfile.name.split(' ').slice(1).join(' ')
      : null;

    const createdAt = existingRecord?.createdAt || existingRecord?.created_at || new Date().toISOString();

    // 7. Upsert into PostgreSQL leads table
    const upsertQuery = `
      INSERT INTO leads (
        id, conversation_id, name, first_name, last_name, email, phone,
        vehicle, vehicle_type, "selectedModel", payment_target, budget,
        credit_situation, monthly_income, income, down_payment, "downPayment",
        has_trade, trade_vehicle, purchase_timeline, urgency,
        source, status, intent_score, intent_stage, contactability_score,
        qualification_score, lead_completeness, lead_quality_score,
        buying_commitment, next_best_action, recommended_next_action,
        sales_brief, customer_summary, "createdAt", created_at, signals_json, forensics_json
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17,
        $18, $19, $20, $21,
        $22, $23, $24, $25, $26,
        $27, $28, $29,
        $30, $31, $32,
        $33, $34, $35, $36, $37, $38
      )
      ON CONFLICT (id) DO UPDATE SET
        conversation_id = EXCLUDED.conversation_id,
        name = COALESCE(EXCLUDED.name, leads.name),
        first_name = COALESCE(EXCLUDED.first_name, leads.first_name),
        last_name = COALESCE(EXCLUDED.last_name, leads.last_name),
        email = COALESCE(EXCLUDED.email, leads.email),
        phone = COALESCE(EXCLUDED.phone, leads.phone),
        vehicle = COALESCE(EXCLUDED.vehicle, leads.vehicle),
        vehicle_type = COALESCE(EXCLUDED.vehicle_type, leads.vehicle_type),
        "selectedModel" = COALESCE(EXCLUDED."selectedModel", leads."selectedModel"),
        payment_target = COALESCE(EXCLUDED.payment_target, leads.payment_target),
        budget = COALESCE(EXCLUDED.budget, leads.budget),
        credit_situation = COALESCE(EXCLUDED.credit_situation, leads.credit_situation),
        monthly_income = COALESCE(EXCLUDED.monthly_income, leads.monthly_income),
        income = COALESCE(EXCLUDED.income, leads.income),
        down_payment = COALESCE(EXCLUDED.down_payment, leads.down_payment),
        "downPayment" = COALESCE(EXCLUDED."downPayment", leads."downPayment"),
        has_trade = COALESCE(EXCLUDED.has_trade, leads.has_trade),
        trade_vehicle = COALESCE(EXCLUDED.trade_vehicle, leads.trade_vehicle),
        purchase_timeline = COALESCE(EXCLUDED.purchase_timeline, leads.purchase_timeline),
        urgency = COALESCE(EXCLUDED.urgency, leads.urgency),
        source = 'JARVIS_LIVE',
        status = EXCLUDED.status,
        intent_score = EXCLUDED.intent_score,
        intent_stage = EXCLUDED.intent_stage,
        contactability_score = EXCLUDED.contactability_score,
        qualification_score = EXCLUDED.qualification_score,
        lead_completeness = EXCLUDED.lead_completeness,
        lead_quality_score = EXCLUDED.lead_quality_score,
        buying_commitment = EXCLUDED.buying_commitment,
        next_best_action = EXCLUDED.next_best_action,
        recommended_next_action = EXCLUDED.recommended_next_action,
        sales_brief = EXCLUDED.sales_brief,
        customer_summary = EXCLUDED.customer_summary,
        "createdAt" = COALESCE(leads."createdAt", EXCLUDED."createdAt"),
        created_at = COALESCE(leads.created_at, EXCLUDED.created_at),
        signals_json = EXCLUDED.signals_json,
        forensics_json = COALESCE(EXCLUDED.forensics_json, leads.forensics_json)
      RETURNING *;
    `;

    const values = [
      leadId,
      conversationId,
      mergedProfile.name || null,
      firstName,
      lastName,
      mergedProfile.email || null,
      mergedProfile.phone || null,
      mergedProfile.targetVehicle || mergedProfile.vehicleType || null,
      mergedProfile.vehicleType || null,
      mergedProfile.targetVehicle || null,
      mergedProfile.monthlyBudget ? `$${mergedProfile.monthlyBudget}/mo` : null,
      mergedProfile.monthlyBudget ? String(mergedProfile.monthlyBudget) : null,
      mergedProfile.creditSituation || null,
      mergedProfile.monthlyIncome ? String(mergedProfile.monthlyIncome) : null,
      mergedProfile.monthlyIncome ? String(mergedProfile.monthlyIncome) : null,
      mergedProfile.downPayment !== undefined ? String(mergedProfile.downPayment) : null,
      mergedProfile.downPayment !== undefined ? String(mergedProfile.downPayment) : null,
      mergedProfile.hasTrade || false,
      mergedProfile.tradeVehicle || null,
      mergedProfile.purchaseTimeline || null,
      mergedProfile.urgency || null,
      'JARVIS_LIVE',
      status,
      metrics.intentScore,
      metrics.intentStage,
      metrics.contactabilityScore,
      metrics.qualificationScore,
      metrics.leadCompleteness,
      metrics.leadQualityScore,
      metrics.buyingCommitment,
      metrics.nextBestAction,
      metrics.recommendedNextAction,
      metrics.salesBrief,
      metrics.salesBrief,
      createdAt,
      createdAt,
      JSON.stringify(signals || []),
      forensics ? (typeof forensics === 'string' ? forensics : JSON.stringify(forensics)) : null
    ];

    await queryDB(upsertQuery, values);

    console.log('[JARVIS_CRM_SYNC_SUCCESS]', {
      conversationId,
      leadId,
      source: 'JARVIS_LIVE',
      intentScore: metrics.intentScore,
      intentStage: metrics.intentStage,
      qualificationScore: metrics.qualificationScore,
      status
    });

    return res.status(200).json({
      success: true,
      leadId,
      metrics,
      buyerProfile: mergedProfile
    });

  } catch (err: any) {
    console.error('[JARVIS_CRM_SYNC_FAILURE]', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to synchronize voice lead'
    });
  }
});
