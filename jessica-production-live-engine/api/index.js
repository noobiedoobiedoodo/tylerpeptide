// server/server.ts
import cookieParser from "cookie-parser";
import "dotenv/config";
import express3 from "express";
import compression from "compression";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path2 from "path";
import crypto4 from "crypto";
import formData from "form-data";
import Mailgun from "mailgun.js";
import expressStaticGzip from "express-static-gzip";
import pg2 from "pg";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

// server/server_routes/session.ts
import express from "express";
import crypto from "crypto";

// server/server_routes/db.ts
import pg from "pg";
var { Client } = pg;
var isProduction = process.env.NODE_ENV === "production" || !!process.env.VERCEL;
var memoryStore = {
  anonymousSessions: /* @__PURE__ */ new Map(),
  conversations: /* @__PURE__ */ new Map(),
  conversationTurns: /* @__PURE__ */ new Map(),
  leads: /* @__PURE__ */ new Map(),
  deletedLeads: /* @__PURE__ */ new Set(),
  scores: [],
  integrations: /* @__PURE__ */ new Map(),
  tenantCredentials: /* @__PURE__ */ new Map(),
  credentialVersions: /* @__PURE__ */ new Map(),
  credentialAuditEvents: []
};
var dbDisabled = false;
var pool = null;
function normalizeConnectionString(rawUrl) {
  if (!rawUrl) return void 0;
  if ((rawUrl.includes("sslmode=require") || rawUrl.includes("sslmode=prefer") || rawUrl.includes("sslmode=verify-ca")) && !rawUrl.includes("uselibpqcompat=")) {
    return rawUrl.includes("?") ? `${rawUrl}&uselibpqcompat=true` : `${rawUrl}?uselibpqcompat=true`;
  }
  return rawUrl;
}
function getPool(connectionString) {
  if (!pool) {
    pool = new pg.Pool({
      connectionString,
      ssl: isProduction ? { rejectUnauthorized: false } : void 0,
      connectionTimeoutMillis: 1e4,
      idleTimeoutMillis: 3e4,
      max: 10
    });
    pool.on("error", (err) => {
      console.warn("[DB] Unexpected error on idle pool client:", err.message);
    });
  }
  return pool;
}
async function queryDB(text, params = []) {
  const rawConnectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.POSTGRES_DATABASE_URL || process.env.POSTGRES_PRISMA_URL;
  const connectionString = normalizeConnectionString(rawConnectionString);
  if (connectionString && !dbDisabled) {
    try {
      const p = getPool(connectionString);
      const res = await p.query(text, params);
      return { rows: res.rows || [], rowCount: res.rowCount || 0 };
    } catch (err) {
      console.warn("[DB] PostgreSQL pool query error, retrying with dedicated client:", err.message);
      try {
        const client = new pg.Client({
          connectionString,
          ssl: isProduction ? { rejectUnauthorized: false } : void 0,
          connectionTimeoutMillis: 1e4
        });
        await client.connect();
        const res = await client.query(text, params);
        await client.end().catch(() => {
        });
        return { rows: res.rows || [], rowCount: res.rowCount || 0 };
      } catch (retryErr) {
        console.error("[DB] PostgreSQL retry failed:", retryErr.message);
        if (connectionString) {
          throw retryErr;
        }
      }
    }
  }
  return executeInMemoryQuery(text, params);
}
function executeInMemoryQuery(text, params) {
  const clean = text.trim().replace(/\s+/g, " ");
  if (/SELECT\s+1\s+FROM\s+deleted_leads\s+WHERE\s+id\s*=\s*\$1/i.test(clean)) {
    const id = params[0];
    if (id && memoryStore.deletedLeads.has(id)) {
      return { rows: [{ "1": 1 }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
  if (/INSERT\s+INTO\s+deleted_leads/i.test(clean)) {
    const id = params[0];
    if (id) memoryStore.deletedLeads.add(id);
    return { rows: [], rowCount: 1 };
  }
  if (/^SELECT\s+1(\s+as\s+\w+)?\s*$/i.test(clean)) {
    return { rows: [{ ok: 1 }], rowCount: 1 };
  }
  if (/^CREATE\s+(TABLE|INDEX)/i.test(clean) || /^ALTER\s+TABLE/i.test(clean)) {
    return { rows: [], rowCount: 0 };
  }
  if (/SELECT id FROM anonymous_sessions WHERE session_token_hash = \$1/i.test(clean)) {
    const hash = params[0];
    const now = Date.now();
    for (const [id, s] of memoryStore.anonymousSessions.entries()) {
      if (s.session_token_hash === hash && s.expires_at > now) {
        return { rows: [{ id: s.id }], rowCount: 1 };
      }
    }
    return { rows: [], rowCount: 0 };
  }
  if (/INSERT INTO anonymous_sessions/i.test(clean)) {
    const [id, session_token_hash] = params;
    const expires_at = Date.now() + 24 * 60 * 60 * 1e3;
    const record = { id, session_token_hash, expires_at, created_at: (/* @__PURE__ */ new Date()).toISOString() };
    memoryStore.anonymousSessions.set(id, record);
    return { rows: [record], rowCount: 1 };
  }
  if (/SELECT id, version, status FROM conversations WHERE anonymous_session_id = \$1/i.test(clean)) {
    const sessionId = params[0];
    const userConvs = Array.from(memoryStore.conversations.values()).filter((c) => c.anonymous_session_id === sessionId).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (userConvs.length > 0) {
      return { rows: [{ id: userConvs[0].id, version: userConvs[0].version, status: userConvs[0].status }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
  if (/SELECT \* FROM conversations WHERE id = \$1 AND anonymous_session_id = \$2/i.test(clean)) {
    const [id, sessionId] = params;
    const c = memoryStore.conversations.get(id);
    if (c && c.anonymous_session_id === sessionId) {
      return { rows: [c], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
  if (/SELECT id FROM conversations WHERE id = \$1/i.test(clean)) {
    const [id] = params;
    const c = memoryStore.conversations.get(id);
    if (c) {
      return { rows: [{ id: c.id }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
  if (/INSERT INTO conversations/i.test(clean)) {
    const [id, anonymous_session_id] = params;
    const record = {
      id,
      anonymous_session_id,
      version: 0,
      status: "ACTIVE",
      created_at: (/* @__PURE__ */ new Date()).toISOString(),
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    memoryStore.conversations.set(id, record);
    return { rows: [record], rowCount: 1 };
  }
  if (/UPDATE conversations SET version = \$1/i.test(clean)) {
    const [version, id, oldVersion] = params;
    const c = memoryStore.conversations.get(id);
    if (c && Number(c.version) === Number(oldVersion)) {
      c.version = version;
      c.updated_at = (/* @__PURE__ */ new Date()).toISOString();
      return { rows: [c], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
  if (/SELECT \* FROM conversation_turns WHERE conversation_id = \$1 AND turn_id = \$2/i.test(clean)) {
    const [convId, turnId] = params;
    for (const t of memoryStore.conversationTurns.values()) {
      if (t.conversation_id === convId && String(t.turn_id) === String(turnId)) {
        return { rows: [t], rowCount: 1 };
      }
    }
    return { rows: [], rowCount: 0 };
  }
  if (/SELECT (id, turn_id|user_transcript).*FROM conversation_turns WHERE conversation_id = \$1 AND status = 'COMPLETED'/i.test(clean)) {
    const [convId] = params;
    const turns = Array.from(memoryStore.conversationTurns.values()).filter((t) => t.conversation_id === convId && t.status === "COMPLETED").sort((a, b) => (a.sequence_number || 0) - (b.sequence_number || 0));
    return { rows: turns, rowCount: turns.length };
  }
  if (/INSERT INTO conversation_turns/i.test(clean)) {
    const [id, conversation_id, turn_id, sequence_number, user_transcript, status, execution_id] = params;
    const record = {
      id,
      conversation_id,
      turn_id: String(turn_id),
      sequence_number,
      user_transcript,
      assistant_response: null,
      status: status || "PROCESSING",
      execution_id,
      processing_started_at: (/* @__PURE__ */ new Date()).toISOString(),
      completed_at: null,
      failed_at: null
    };
    memoryStore.conversationTurns.set(id, record);
    return { rows: [record], rowCount: 1 };
  }
  if (/UPDATE conversation_turns SET assistant_response = \$1, status = 'COMPLETED'/i.test(clean)) {
    const [assistant_response, id, execution_id] = params;
    const t = memoryStore.conversationTurns.get(id);
    if (t) {
      t.assistant_response = assistant_response;
      t.status = "COMPLETED";
      t.completed_at = (/* @__PURE__ */ new Date()).toISOString();
      return { rows: [t], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
  if (/UPDATE conversation_turns SET status = 'FAILED'/i.test(clean)) {
    const [id, execution_id] = params;
    const t = memoryStore.conversationTurns.get(id);
    if (t) {
      t.status = "FAILED";
      t.failed_at = (/* @__PURE__ */ new Date()).toISOString();
      return { rows: [t], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
  if (/DELETE FROM conversation_turns WHERE id = \$1/i.test(clean)) {
    const [id] = params;
    const existed = memoryStore.conversationTurns.delete(id);
    return { rows: [], rowCount: existed ? 1 : 0 };
  }
  if (/SELECT \* FROM leads WHERE id = \$1/i.test(clean)) {
    const [id] = params;
    const l = memoryStore.leads.get(id);
    return { rows: l ? [l] : [], rowCount: l ? 1 : 0 };
  }
  if (/SELECT \* FROM leads WHERE conversation_id = \$1/i.test(clean)) {
    const [convId] = params;
    const found = Array.from(memoryStore.leads.values()).find((l) => l.conversation_id === convId);
    return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
  }
  if (/SELECT \*.*FROM leads/i.test(clean) && !/WHERE/i.test(clean)) {
    const allLeads = Array.from(memoryStore.leads.values()).sort((a, b) => new Date(b.createdAt || b.created_at || 0).getTime() - new Date(a.createdAt || a.created_at || 0).getTime());
    return { rows: allLeads, rowCount: allLeads.length };
  }
  if (/INSERT INTO leads/i.test(clean)) {
    const id = params[0];
    const existing = memoryStore.leads.get(id) || {};
    const record = { ...existing, id };
    if (params.length > 1) {
      record.conversation_id = params[1] || record.conversation_id;
      record.name = params[2] || record.name;
      record.first_name = params[3] || record.first_name;
      record.last_name = params[4] || record.last_name;
      record.email = params[5] || record.email;
      record.phone = params[6] || record.phone;
      record.vehicle = params[7] || record.vehicle;
      record.vehicle_type = params[8] || record.vehicle_type;
      record.selectedModel = params[9] || record.selectedModel;
      record.payment_target = params[10] || record.payment_target;
      record.budget = params[11] || record.budget;
      record.credit_situation = params[12] || record.credit_situation;
      record.monthly_income = params[13] || record.monthly_income;
      record.income = params[14] || record.income;
      record.down_payment = params[15] || record.down_payment;
      record.downPayment = params[16] || record.downPayment;
      record.has_trade = params[17] !== void 0 ? params[17] : record.has_trade;
      record.trade_vehicle = params[18] || record.trade_vehicle;
      record.purchase_timeline = params[19] || record.purchase_timeline;
      record.urgency = params[20] || record.urgency;
      record.source = params[21] || record.source || "JARVIS_LIVE";
      record.status = params[22] || record.status || "NEW";
      record.intent_score = params[23] !== void 0 ? params[23] : record.intent_score;
      record.intent_stage = params[24] || record.intent_stage;
      record.contactability_score = params[25] !== void 0 ? params[25] : record.contactability_score;
      record.qualification_score = params[26] !== void 0 ? params[26] : record.qualification_score;
      record.lead_completeness = params[27] !== void 0 ? params[27] : record.lead_completeness;
      record.lead_quality_score = params[28] !== void 0 ? params[28] : record.lead_quality_score;
      record.buying_commitment = params[29] || record.buying_commitment;
      record.next_best_action = params[30] || record.next_best_action;
      record.recommended_next_action = params[31] || record.recommended_next_action;
      record.sales_brief = params[32] || record.sales_brief;
      record.customer_summary = params[33] || record.customer_summary;
      record.createdAt = params[34] || record.createdAt || (/* @__PURE__ */ new Date()).toISOString();
      record.created_at = params[35] || record.created_at || record.createdAt;
      record.signals_json = (params.length > 36 ? params[36] : params[35]) || record.signals_json;
    }
    memoryStore.leads.set(id, record);
    return { rows: [record], rowCount: 1 };
  }
  if (/DELETE FROM leads WHERE id = \$1/i.test(clean)) {
    const [id] = params;
    const l = memoryStore.leads.get(id);
    memoryStore.leads.delete(id);
    memoryStore.deletedLeads.add(id);
    return { rows: l ? [l] : [], rowCount: l ? 1 : 0 };
  }
  if (/INSERT INTO deleted_leads/i.test(clean)) {
    const [id] = params;
    if (id) memoryStore.deletedLeads.add(id);
    return { rows: [], rowCount: 1 };
  }
  if (/SELECT (1|\*) FROM deleted_leads WHERE id = \$1/i.test(clean)) {
    const [id] = params;
    const isDeleted = memoryStore.deletedLeads.has(id);
    return { rows: isDeleted ? [{ id, ok: 1 }] : [], rowCount: isDeleted ? 1 : 0 };
  }
  if (/SELECT.*FROM scores/i.test(clean)) {
    const sorted = [...memoryStore.scores].sort((a, b) => b.score - a.score).slice(0, 3);
    const rows = sorted.map((s) => ({
      name: s.name,
      email: s.email,
      score: s.score,
      createdAt: s.created_at
    }));
    return { rows, rowCount: rows.length };
  }
  if (/INSERT INTO scores/i.test(clean)) {
    const [name, email, score, created_at] = params;
    const record = {
      id: memoryStore.scores.length + 1,
      name,
      email,
      score,
      created_at: created_at || (/* @__PURE__ */ new Date()).toISOString()
    };
    memoryStore.scores.push(record);
    return { rows: [record], rowCount: 1 };
  }
  if (/INSERT INTO winston_integrations/i.test(clean)) {
    const [id, tenant_id, provider, integration_type, display_name, status, enabled] = params;
    const record = {
      id,
      tenant_id,
      provider,
      integration_type,
      display_name,
      status: status || "ACTIVE",
      enabled: enabled !== false,
      credential_version: 1,
      created_at: (/* @__PURE__ */ new Date()).toISOString(),
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    memoryStore.integrations.set(id, record);
    return { rows: [record], rowCount: 1 };
  }
  if (/SELECT \* FROM winston_integrations WHERE tenant_id = \$1 AND id = \$2/i.test(clean)) {
    const [tenantId, id] = params;
    const item = memoryStore.integrations.get(id);
    if (item && item.tenant_id === tenantId) {
      return { rows: [item], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
  if (/SELECT \* FROM winston_integrations WHERE tenant_id = \$1 AND provider = \$2/i.test(clean)) {
    const [tenantId, provider] = params;
    for (const item of memoryStore.integrations.values()) {
      if (item.tenant_id === tenantId && item.provider === provider) {
        return { rows: [item], rowCount: 1 };
      }
    }
    return { rows: [], rowCount: 0 };
  }
  if (/UPDATE winston_integrations/i.test(clean)) {
    const isRevoke = /SET status = 'REVOKED'/i.test(clean);
    const isVersionUpdate = /SET credential_version = \$1/i.test(clean);
    if (isRevoke) {
      const [integrationId, tenantId] = params;
      const item = memoryStore.integrations.get(integrationId);
      if (item && item.tenant_id === tenantId) {
        item.status = "REVOKED";
        item.updated_at = (/* @__PURE__ */ new Date()).toISOString();
        return { rows: [item], rowCount: 1 };
      }
    } else if (isVersionUpdate) {
      const [newVersion, integrationId, tenantId] = params;
      const item = memoryStore.integrations.get(integrationId);
      if (item && item.tenant_id === tenantId) {
        item.credential_version = newVersion;
        item.status = "ACTIVE";
        item.updated_at = (/* @__PURE__ */ new Date()).toISOString();
        return { rows: [item], rowCount: 1 };
      }
    }
    return { rows: [], rowCount: 0 };
  }
  if (/INSERT INTO winston_tenant_credentials/i.test(clean)) {
    const [id, tenant_id, integration_id, provider, auth_type] = params;
    const record = {
      id,
      tenant_id,
      integration_id,
      provider,
      auth_type,
      status: "ACTIVE",
      active_version: 1,
      created_at: (/* @__PURE__ */ new Date()).toISOString(),
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    memoryStore.tenantCredentials.set(id, record);
    return { rows: [record], rowCount: 1 };
  }
  if (/SELECT \* FROM winston_tenant_credentials WHERE tenant_id = \$1 AND integration_id = \$2/i.test(clean)) {
    const [tenantId, integrationId] = params;
    for (const cred of memoryStore.tenantCredentials.values()) {
      if (cred.tenant_id === tenantId && cred.integration_id === integrationId) {
        return { rows: [cred], rowCount: 1 };
      }
    }
    return { rows: [], rowCount: 0 };
  }
  if (/SELECT id, provider, active_version, status FROM winston_tenant_credentials WHERE tenant_id = \$1 AND integration_id = \$2/i.test(clean)) {
    const [tenantId, integrationId] = params;
    for (const cred of memoryStore.tenantCredentials.values()) {
      if (cred.tenant_id === tenantId && cred.integration_id === integrationId) {
        return { rows: [cred], rowCount: 1 };
      }
    }
    return { rows: [], rowCount: 0 };
  }
  if (/SELECT c\.status FROM winston_tenant_credentials c WHERE c\.tenant_id = \$1 AND c\.provider = \$2/i.test(clean)) {
    const [tenantId, provider] = params;
    for (const cred of memoryStore.tenantCredentials.values()) {
      if (cred.tenant_id === tenantId && cred.provider === provider) {
        return { rows: [{ status: cred.status }], rowCount: 1 };
      }
    }
    return { rows: [], rowCount: 0 };
  }
  if (/SELECT\s+c\.id\s+AS\s+credential_id/i.test(clean)) {
    const [tenantId, provider] = params;
    for (const cred of memoryStore.tenantCredentials.values()) {
      if (cred.tenant_id === tenantId && cred.provider === provider) {
        const intg = memoryStore.integrations.get(cred.integration_id);
        const ver = Array.from(memoryStore.credentialVersions.values()).find(
          (v) => v.credential_id === cred.id && v.status === "ACTIVE"
        );
        if (intg && ver) {
          return {
            rows: [{
              credential_id: cred.id,
              tenant_id: cred.tenant_id,
              integration_id: cred.integration_id,
              provider: cred.provider,
              auth_type: cred.auth_type,
              credential_status: cred.status,
              active_version: cred.active_version,
              version_id: ver.id,
              version: ver.version,
              version_status: ver.status,
              secret_ciphertext: ver.secret_ciphertext,
              secret_encryption_key_ref: ver.secret_encryption_key_ref,
              secret_fingerprint: ver.secret_fingerprint,
              integration_status: intg.status,
              integration_enabled: intg.enabled
            }],
            rowCount: 1
          };
        }
      }
    }
    return { rows: [], rowCount: 0 };
  }
  if (/UPDATE winston_tenant_credentials/i.test(clean)) {
    if (/SET status = 'REVOKED'/i.test(clean)) {
      const [credId, tenantId] = params;
      const c = memoryStore.tenantCredentials.get(credId);
      if (c && c.tenant_id === tenantId) {
        c.status = "REVOKED";
        c.updated_at = (/* @__PURE__ */ new Date()).toISOString();
        return { rows: [c], rowCount: 1 };
      }
    } else if (/SET active_version = \$1/i.test(clean)) {
      const [newVersion, credId, tenantId] = params;
      const c = memoryStore.tenantCredentials.get(credId);
      if (c && c.tenant_id === tenantId) {
        c.active_version = newVersion;
        c.status = "ACTIVE";
        c.updated_at = (/* @__PURE__ */ new Date()).toISOString();
        return { rows: [c], rowCount: 1 };
      }
    }
    return { rows: [], rowCount: 0 };
  }
  if (/INSERT INTO winston_credential_versions/i.test(clean)) {
    const [id, credential_id, tenant_id, integration_id, version, status, secret_ciphertext, secret_encryption_key_ref, secret_fingerprint, metadata, actor] = params;
    if (status === "ACTIVE") {
      const existingActive = Array.from(memoryStore.credentialVersions.values()).find(
        (v) => v.credential_id === credential_id && v.status === "ACTIVE"
      );
      if (existingActive) {
        throw new Error("UNIQUE CONSTRAINT VIOLATION: uq_winston_active_credential_version. Only one active version allowed per credential.");
      }
    }
    const record = {
      id,
      credential_id,
      tenant_id,
      integration_id,
      version,
      status: status || "ACTIVE",
      secret_ciphertext,
      secret_encryption_key_ref,
      secret_fingerprint,
      metadata: typeof metadata === "string" ? JSON.parse(metadata) : metadata,
      created_by: actor || "SYSTEM",
      created_at: (/* @__PURE__ */ new Date()).toISOString(),
      activated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    memoryStore.credentialVersions.set(id, record);
    return { rows: [record], rowCount: 1 };
  }
  if (/UPDATE winston_credential_versions/i.test(clean)) {
    if (/SET status = 'ARCHIVED'/i.test(clean)) {
      const [credId] = params;
      for (const v of memoryStore.credentialVersions.values()) {
        if (v.credential_id === credId && v.status === "ACTIVE") {
          v.status = "ARCHIVED";
          v.retired_at = (/* @__PURE__ */ new Date()).toISOString();
        }
      }
      return { rows: [], rowCount: 1 };
    } else if (/SET status = 'REVOKED'/i.test(clean)) {
      const [credId] = params;
      for (const v of memoryStore.credentialVersions.values()) {
        if (v.credential_id === credId && v.status !== "REVOKED") {
          v.status = "REVOKED";
          v.revoked_at = (/* @__PURE__ */ new Date()).toISOString();
        }
      }
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
  if (/INSERT INTO winston_credential_audit_events/i.test(clean)) {
    const [id, tenant_id, integration_id, credential_id, version, event_type, actor_id, reason] = params;
    const record = {
      id,
      tenant_id,
      integration_id,
      credential_id,
      version,
      event_type,
      actor_id,
      reason,
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    memoryStore.credentialAuditEvents.push(record);
    return { rows: [record], rowCount: 1 };
  }
  if (/SELECT\s+i\.id,\s+i\.tenant_id/i.test(clean)) {
    const [tenantId] = params;
    const results = [];
    for (const intg of memoryStore.integrations.values()) {
      if (intg.tenant_id === tenantId) {
        const cred = Array.from(memoryStore.tenantCredentials.values()).find((c) => c.integration_id === intg.id && c.tenant_id === tenantId);
        const ver = cred ? Array.from(memoryStore.credentialVersions.values()).find((v) => v.credential_id === cred.id && v.status === "ACTIVE") : null;
        results.push({
          id: intg.id,
          tenant_id: intg.tenant_id,
          provider: intg.provider,
          integration_type: intg.integration_type,
          display_name: intg.display_name,
          status: intg.status,
          enabled: intg.enabled,
          credential_version: intg.credential_version,
          cred_status: cred?.status,
          secret_fingerprint: ver?.secret_fingerprint,
          metadata: ver?.metadata,
          last_rotated_at: cred?.updated_at
        });
      }
    }
    return { rows: results, rowCount: results.length };
  }
  return { rows: [], rowCount: 0 };
}
async function initWinstonDB() {
  try {
    await queryDB(`
      CREATE TABLE IF NOT EXISTS anonymous_sessions (
        id VARCHAR(255) PRIMARY KEY,
        session_token_hash VARCHAR(255) NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await queryDB(`
      CREATE TABLE IF NOT EXISTS conversations (
        id VARCHAR(255) PRIMARY KEY,
        anonymous_session_id VARCHAR(255) NOT NULL,
        version INT DEFAULT 0,
        status VARCHAR(50) DEFAULT 'ACTIVE',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await queryDB(`
      CREATE TABLE IF NOT EXISTS conversation_turns (
        id VARCHAR(255) PRIMARY KEY,
        conversation_id VARCHAR(255) NOT NULL,
        turn_id VARCHAR(255) NOT NULL,
        sequence_number INT NOT NULL,
        user_transcript TEXT NOT NULL,
        assistant_response TEXT,
        status VARCHAR(50) NOT NULL DEFAULT 'PROCESSING',
        execution_id VARCHAR(255),
        processing_started_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMPTZ,
        failed_at TIMESTAMPTZ
      );
    `);
    await queryDB(`
      CREATE TABLE IF NOT EXISTS winston_integrations (
        id VARCHAR(64) PRIMARY KEY,
        tenant_id VARCHAR(64) NOT NULL,
        provider VARCHAR(64) NOT NULL,
        integration_type VARCHAR(64) NOT NULL,
        display_name VARCHAR(255) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        credential_version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await queryDB(`
      CREATE TABLE IF NOT EXISTS winston_tenant_credentials (
        id VARCHAR(64) PRIMARY KEY,
        tenant_id VARCHAR(64) NOT NULL,
        integration_id VARCHAR(64) NOT NULL,
        provider VARCHAR(64) NOT NULL,
        auth_type VARCHAR(32) NOT NULL DEFAULT 'API_KEY',
        status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
        active_version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await queryDB(`
      CREATE TABLE IF NOT EXISTS winston_credential_versions (
        id VARCHAR(64) PRIMARY KEY,
        credential_id VARCHAR(64) NOT NULL,
        tenant_id VARCHAR(64) NOT NULL,
        integration_id VARCHAR(64) NOT NULL,
        version INT NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
        secret_ciphertext TEXT NOT NULL,
        secret_encryption_key_ref VARCHAR(64) NOT NULL DEFAULT 'primary-aes-256-gcm-v1',
        secret_fingerprint VARCHAR(128) NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await queryDB(`
      CREATE TABLE IF NOT EXISTS winston_credential_audit_events (
        id VARCHAR(64) PRIMARY KEY,
        tenant_id VARCHAR(64) NOT NULL,
        integration_id VARCHAR(64) NOT NULL,
        credential_id VARCHAR(64) NOT NULL,
        version INT NOT NULL,
        event_type VARCHAR(64) NOT NULL,
        actor_id VARCHAR(64) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("[DB] Database engine initialized successfully (PostgreSQL + In-Memory Fallback)");
  } catch (error) {
    console.error("[DB] Error initializing schema:", error);
  }
}

// server/server_routes/session.ts
var sessionRouter = express.Router();
sessionRouter.post("/init", async (req, res) => {
  try {
    const existingRawToken = req.cookies?.winston_session;
    let sessionId = null;
    let tokenHash = null;
    if (existingRawToken && typeof existingRawToken === "string") {
      tokenHash = crypto.createHash("sha256").update(existingRawToken).digest("hex");
      const sessionResult = await queryDB(
        "SELECT id FROM anonymous_sessions WHERE session_token_hash = $1 AND expires_at > CURRENT_TIMESTAMP",
        [tokenHash]
      );
      if (sessionResult.rows.length > 0) {
        sessionId = sessionResult.rows[0].id;
      }
    }
    if (!sessionId) {
      const rawToken = crypto.randomUUID() + crypto.randomBytes(32).toString("hex");
      tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      sessionId = "ses_" + crypto.randomUUID();
      await queryDB(
        "INSERT INTO anonymous_sessions (id, session_token_hash, expires_at) VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '24 hours')",
        [sessionId, tokenHash]
      );
      res.cookie("winston_session", rawToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production" || !!process.env.VERCEL,
        sameSite: "strict",
        maxAge: 24 * 60 * 60 * 1e3,
        path: "/"
      });
    }
    const convResult = await queryDB(
      "SELECT id, version, status FROM conversations WHERE anonymous_session_id = $1 ORDER BY created_at DESC LIMIT 1",
      [sessionId]
    );
    let activeConversationId;
    if (convResult.rows.length > 0) {
      activeConversationId = convResult.rows[0].id;
    } else {
      activeConversationId = "conv_" + crypto.randomUUID();
      await queryDB(
        "INSERT INTO conversations (id, anonymous_session_id, version, status) VALUES ($1, $2, 0, 'ACTIVE')",
        [activeConversationId, sessionId]
      );
    }
    const historyResult = await queryDB(
      "SELECT id, turn_id, sequence_number, user_transcript, assistant_response, processing_started_at, completed_at FROM conversation_turns WHERE conversation_id = $1 AND status = 'COMPLETED' ORDER BY sequence_number ASC",
      [activeConversationId]
    );
    const canonicalHistory = [];
    for (const row of historyResult.rows) {
      if (row.user_transcript) {
        canonicalHistory.push({
          id: `msg_user_${row.turn_id || row.id}`,
          role: "user",
          content: row.user_transcript,
          timestamp: row.processing_started_at ? new Date(row.processing_started_at).toISOString() : (/* @__PURE__ */ new Date()).toISOString()
        });
      }
      if (row.assistant_response) {
        try {
          const parsed = JSON.parse(row.assistant_response);
          const assistantContent = parsed.message || parsed.textResponse || (typeof parsed === "string" ? parsed : "");
          if (assistantContent) {
            canonicalHistory.push({
              id: `msg_assistant_${row.turn_id || row.id}`,
              role: "assistant",
              content: assistantContent,
              timestamp: row.completed_at ? new Date(row.completed_at).toISOString() : (/* @__PURE__ */ new Date()).toISOString()
            });
          }
        } catch (e) {
        }
      }
    }
    return res.json({
      ok: true,
      sessionId,
      conversationId: activeConversationId,
      status: "ACTIVE",
      history: canonicalHistory
    });
  } catch (error) {
    console.error("[Session Init Error]", error);
    return res.status(500).json({
      ok: false,
      error: {
        code: "SESSION_INIT_FAILED",
        message: "Unable to initialize conversation session"
      }
    });
  }
});

// server/server_routes/chat.ts
import express2 from "express";
import crypto2 from "crypto";

// server/server_routes/ai.ts
import { GoogleGenAI } from "@google/genai";
var ai = null;
if (process.env.GEMINI_API_KEY) {
  ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}
function calculateLeadIntelligence(context = {}, signals = [], message = "") {
  const safeSignals = Array.isArray(signals) ? signals : signals ? [signals] : [];
  const signalTypes = new Set(
    safeSignals.map((s) => s?.type || s?.signalType).filter(Boolean)
  );
  const lowerMsg = (message || "").toLowerCase();
  let intent = 0;
  if (signalTypes.has("PURCHASE_URGENCY") || String(context.urgency || "").toUpperCase() === "IMMEDIATE" || String(context.urgency || "").toUpperCase() === "HIGH" || /\b(asap|this week|right away|urgent|immediately|broken down)\b/i.test(lowerMsg)) {
    intent += 35;
  } else if (signalTypes.has("PURCHASE_TIMELINE_IDENTIFIED") || context.purchaseTimeline || /\b(two weeks|2 weeks|this month|within a month)\b/i.test(lowerMsg)) {
    intent += 25;
  }
  if (signalTypes.has("PAYMENT_TARGET_IDENTIFIED") || context.monthlyBudget || context.paymentTarget) intent += 20;
  if (signalTypes.has("VEHICLE_IDENTIFIED") || context.targetVehicle || context.vehicleType) intent += 15;
  if (signalTypes.has("TRADE_IDENTIFIED") || context.hasTrade || context.tradeVehicle) intent += 15;
  if (signalTypes.has("APPLICATION_INTENT") || signalTypes.has("APPROVAL_REQUESTED") || /\b(apply|approval|approved|pre-approval|prequalify)\b/i.test(lowerMsg)) intent += 20;
  if (signalTypes.has("HUMAN_HANDOFF_REQUESTED") || /\b(stephan|call me|talk to someone|advisor|agent)\b/i.test(lowerMsg)) intent += 20;
  if (signalTypes.has("AVAILABILITY_REQUESTED") || /\b(in stock|available|inventory)\b/i.test(lowerMsg)) intent += 10;
  if (signalTypes.has("FINANCING_REQUESTED") || context.financingNeeded) intent += 10;
  if (signalTypes.has("EXPLICITLY_BROWSING") || /\b(just looking|just browsing|not buying|only curious)\b/i.test(lowerMsg)) intent -= 35;
  if (signalTypes.has("REFUSED_FOLLOWUP") || /\b(do not call|don't contact|no phone)\b/i.test(lowerMsg)) intent -= 40;
  if (signalTypes.has("NO_VEHICLE_NEED")) intent -= 30;
  intent = Math.max(0, Math.min(100, intent));
  let intentStage = "CURIOUS";
  if (intent >= 81) intentStage = "HIGH_INTENT";
  else if (intent >= 61) intentStage = "QUALIFIED";
  else if (intent >= 41) intentStage = "SHOPPING";
  else if (intent >= 21) intentStage = "RESEARCHING";
  let contactability = 0;
  const rawPhone = String(context.phone || "").replace(/\D/g, "");
  if (rawPhone.length >= 10) contactability += 60;
  else if (rawPhone.length >= 7) contactability += 40;
  if (context.email && String(context.email).includes("@") && String(context.email).includes(".")) contactability += 30;
  if (context.name || context.firstName) contactability += 10;
  contactability = Math.max(0, Math.min(100, contactability));
  let qualification = 0;
  if (context.monthlyIncome || context.income) qualification += 35;
  if (context.creditSituation || context.creditScore || context.creditProfile) qualification += 25;
  if (context.monthlyBudget || context.paymentTarget) qualification += 20;
  if (context.employment || context.employmentStatus) qualification += 10;
  if (context.downPayment || context.hasTrade || context.tradeVehicle) qualification += 10;
  qualification = Math.max(0, Math.min(100, qualification));
  const completenessItems = [
    Boolean(context.name || context.firstName),
    Boolean(rawPhone.length >= 7),
    Boolean(context.email && String(context.email).includes("@")),
    Boolean(context.targetVehicle || context.vehicleType),
    Boolean(context.monthlyBudget || context.paymentTarget),
    Boolean(context.purchaseTimeline || context.urgency),
    Boolean(context.creditSituation || context.creditScore),
    Boolean(context.hasTrade !== void 0 || context.tradeVehicle),
    Boolean(context.monthlyIncome || context.income || context.downPayment)
  ];
  const filledCount = completenessItems.filter(Boolean).length;
  const completeness = Math.round(filledCount / completenessItems.length * 100);
  const leadQualityScore = Math.round(
    intent * 0.4 + contactability * 0.25 + qualification * 0.25 + completeness * 0.1
  );
  let buyingCommitment = "NONE";
  if (signalTypes.has("APPLICATION_INTENT") || signalTypes.has("HUMAN_HANDOFF_REQUESTED") || /\b(apply|ready to buy|take my application|stephan call|call me)\b/i.test(lowerMsg)) {
    buyingCommitment = "READY_TO_PROCEED";
  } else if (context.purchaseTimeline && context.purchaseTimeline !== "EXPLORING" || signalTypes.has("PURCHASE_URGENCY") || context.targetVehicle && context.monthlyBudget || /\b(this week|two weeks|this month|asap|comparing|need a)\b/i.test(lowerMsg)) {
    buyingCommitment = "ACTIVELY_SHOPPING";
  } else if (context.targetVehicle || context.monthlyBudget || /\b(thinking|looking around|considering|maybe)\b/i.test(lowerMsg)) {
    buyingCommitment = "CONSIDERING";
  } else if (/\b(just browsing|someday|future|curious)\b/i.test(lowerMsg)) {
    buyingCommitment = "EXPLORING";
  }
  let activeObjection = null;
  if (/\b(too expensive|can't afford|high payment|cheaper|too much)\b/i.test(lowerMsg)) activeObjection = "PAYMENT_CONCERN";
  else if (/\b(bad credit|turned down|bankruptcy|low score|collections|rebuilding)\b/i.test(lowerMsg)) activeObjection = "CREDIT_CONCERN";
  else if (/\b(no down payment|zero down|no deposit|no cash down)\b/i.test(lowerMsg)) activeObjection = "DOWN_PAYMENT_CONCERN";
  else if (/\b(not sure|need to think|too soon|not ready)\b/i.test(lowerMsg)) activeObjection = "TIMING_CONCERN";
  else if (/\b(rate|apr|interest|hidden fees)\b/i.test(lowerMsg)) activeObjection = "PRICE_CONCERN";
  let nextBestAction = "DISCOVER";
  if (activeObjection) {
    nextBestAction = "OVERCOME_OBJECTION";
  } else if (signalTypes.has("HUMAN_HANDOFF_REQUESTED") || buyingCommitment === "READY_TO_PROCEED" || intent >= 70 && contactability >= 60) {
    nextBestAction = "HANDOFF_NOW";
  } else if (intent >= 50 && contactability < 60) {
    nextBestAction = "CAPTURE_PHONE";
  } else if (intent >= 50 && contactability >= 60 && !context.email) {
    nextBestAction = "CAPTURE_EMAIL";
  } else if (!context.targetVehicle && !context.monthlyBudget) {
    nextBestAction = "DISCOVER";
  } else if (context.targetVehicle && !context.creditSituation && !context.monthlyIncome) {
    nextBestAction = "QUALIFY";
  } else if (intent < 30) {
    nextBestAction = "EDUCATE";
  }
  let recommendedNextAction = "NURTURE";
  if (intent >= 75 && contactability >= 60) {
    recommendedNextAction = "CALL_ASAP";
  } else if (intent >= 50 && contactability >= 60) {
    recommendedNextAction = "SCHEDULE_CALL";
  } else if (contactability >= 30) {
    recommendedNextAction = "EMAIL_PORTFOLIO";
  }
  return {
    intentScore: intent,
    intentStage,
    contactabilityScore: contactability,
    qualificationScore: qualification,
    completenessScore: completeness,
    leadQualityScore,
    buyingCommitment,
    nextBestAction,
    activeObjection,
    recommendedNextAction
  };
}

// server/server_routes/chat.ts
import { Type } from "@google/genai";
var chatRouter = express2.Router();
chatRouter.post("/", async (req, res) => {
  const executionId = "exec_" + crypto2.randomUUID();
  try {
    const rawToken = req.cookies?.winston_session || (typeof req.headers["x-winston-session"] === "string" ? req.headers["x-winston-session"] : void 0);
    if (!rawToken || typeof rawToken !== "string") {
      return res.status(401).json({
        ok: false,
        error: { code: "UNAUTHORIZED", message: "Missing or invalid session cookie." }
      });
    }
    const tokenHash = crypto2.createHash("sha256").update(rawToken).digest("hex");
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
    const { conversationId, turnId, message, buyerContext = {}, salesStage = "GREETING" } = req.body || {};
    if (!conversationId || typeof conversationId !== "string" || conversationId.trim().length === 0 || conversationId.length > 255) {
      return res.status(400).json({
        ok: false,
        error: { code: "INVALID_REQUEST", message: "Invalid or missing conversationId (must be non-empty string up to 255 chars)." }
      });
    }
    if (turnId === void 0 || turnId === null || typeof turnId !== "string" && typeof turnId !== "number" || String(turnId).trim().length === 0 || String(turnId).length > 255) {
      return res.status(400).json({
        ok: false,
        error: { code: "INVALID_REQUEST", message: "Invalid or missing turnId (must be string/number up to 255 chars)." }
      });
    }
    if (!message || typeof message !== "string" || message.trim().length === 0 || message.length > 1e4) {
      return res.status(400).json({
        ok: false,
        error: { code: "INVALID_REQUEST", message: "Invalid or missing message (must be non-empty string up to 10,000 chars)." }
      });
    }
    const cleanMessage = message.trim();
    const strTurnId = String(turnId).trim();
    let convResult = await queryDB(
      "SELECT * FROM conversations WHERE id = $1 AND anonymous_session_id = $2",
      [conversationId, anonymousSessionId]
    );
    if (convResult.rows.length === 0) {
      const otherConv = await queryDB("SELECT id FROM conversations WHERE id = $1", [conversationId]);
      if (otherConv.rows.length > 0) {
        return res.status(403).json({
          ok: false,
          error: { code: "FORBIDDEN", message: "Access to this conversation is unauthorized." }
        });
      }
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
    const existingTurn = await queryDB(
      "SELECT * FROM conversation_turns WHERE conversation_id = $1 AND turn_id = $2",
      [conversationId, strTurnId]
    );
    let turnRecord = null;
    if (existingTurn.rows.length > 0) {
      const row = existingTurn.rows[0];
      if (row.status === "COMPLETED" && row.assistant_response) {
        try {
          const cachedResponse = JSON.parse(row.assistant_response);
          return res.json({ ok: true, ...cachedResponse });
        } catch (e) {
          return res.json({ ok: true, message: row.assistant_response, conversationId, turnId: strTurnId });
        }
      }
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
        return res.status(409).json({
          ok: false,
          error: { code: "TURN_PROCESSING", message: "This turn is currently processing. Please wait or retry after lease timeout." }
        });
      }
    }
    if (!turnRecord) {
      const nextSequence = Number(conversation.version || 0) + 1;
      try {
        const insertResult = await queryDB(
          `INSERT INTO conversation_turns (id, conversation_id, turn_id, sequence_number, user_transcript, status, execution_id, processing_started_at) 
           VALUES ($1, $2, $3, $4, $5, 'PROCESSING', $6, NOW()) RETURNING *`,
          ["turn_" + crypto2.randomUUID(), conversationId, strTurnId, nextSequence, cleanMessage, executionId]
        );
        turnRecord = insertResult.rows[0];
        const updateConv = await queryDB(
          "UPDATE conversations SET version = $1, updated_at = NOW() WHERE id = $2 AND version = $3",
          [nextSequence, conversationId, conversation.version]
        );
        if (updateConv.rowCount === 0) {
          await queryDB("DELETE FROM conversation_turns WHERE id = $1", [turnRecord.id]);
          return res.status(409).json({
            ok: false,
            error: { code: "CONCURRENCY_CONFLICT", message: "Conversation sequence conflict. Please retry." }
          });
        }
      } catch (dbErr) {
        if (dbErr.code === "23505") {
          const recheck = await queryDB(
            "SELECT * FROM conversation_turns WHERE conversation_id = $1 AND turn_id = $2",
            [conversationId, strTurnId]
          );
          if (recheck.rows.length > 0 && recheck.rows[0].status === "COMPLETED" && recheck.rows[0].assistant_response) {
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
    const historyResult = await queryDB(
      "SELECT user_transcript, assistant_response FROM conversation_turns WHERE conversation_id = $1 AND status = 'COMPLETED' ORDER BY sequence_number ASC",
      [conversationId]
    );
    const contents = [];
    for (const row of historyResult.rows) {
      if (row.user_transcript) {
        contents.push({ role: "user", parts: [{ text: row.user_transcript }] });
      }
      if (row.assistant_response) {
        try {
          const parsed = JSON.parse(row.assistant_response);
          const reply = parsed.message || parsed.textResponse || (typeof parsed === "string" ? parsed : "");
          if (reply) {
            contents.push({ role: "model", parts: [{ text: reply }] });
          }
        } catch (e) {
        }
      }
    }
    contents.push({ role: "user", parts: [{ text: cleanMessage }] });
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
    if (!ai) {
      throw new Error("Gemini AI instance is not configured on server.");
    }
    const preferredModel = process.env.GEMINI_MODEL && process.env.GEMINI_MODEL !== "gemini-3.6-flash" ? process.env.GEMINI_MODEL : "gemini-3.8-flash";
    const candidateModels = [preferredModel, "gemini-3.8-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash", "gemini-flash-latest"].filter((m, i, arr) => arr.indexOf(m) === i);
    let response = null;
    let lastError = null;
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
      } catch (llmError) {
        lastError = llmError;
        console.warn(`[LLM Failover] Model ${modelName} failed (${llmError?.message || llmError}). Trying next candidate...`);
      }
    }
    if (!response && lastError) {
      console.error("[LLM Error]", lastError?.message || lastError);
      const isRateLimit = lastError?.status === 429 || lastError?.code === 429 || lastError?.error?.code === 429 || lastError?.error?.status === "RESOURCE_EXHAUSTED" || String(lastError?.message || "").includes("RESOURCE_EXHAUSTED") || String(lastError?.message || "").includes("Quota exceeded") || String(lastError?.message || "").includes("rate-limits");
      const isNetworkError = lastError?.code === "ENOTFOUND" || lastError?.code === "ECONNRESET" || lastError?.code === "ETIMEDOUT" || String(lastError?.message || "").includes("fetch failed");
      const errorCode = isRateLimit ? "LLM_RATE_LIMITED" : isNetworkError ? "LLM_NETWORK_ERROR" : "LLM_PROVIDER_ERROR";
      const httpStatus = isRateLimit ? 429 : isNetworkError ? 503 : 502;
      await queryDB(
        "UPDATE conversation_turns SET status = 'FAILED', failed_at = NOW() WHERE id = $1 AND execution_id = $2",
        [turnRecord.id, executionId]
      );
      return res.status(httpStatus).json({
        ok: false,
        error: {
          code: errorCode,
          message: isRateLimit ? "AI capacity limit reached. Please retry in a few moments." : "Upstream AI service temporarily unavailable. Please retry.",
          retryable: true,
          turnId: strTurnId,
          conversationId
        }
      });
    }
    const actions = [];
    let textResponse = "";
    const candidate = response?.candidates?.[0];
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (typeof part.text === "string" && part.text.trim()) {
          textResponse += (textResponse ? " " : "") + part.text.trim();
        }
      }
    }
    if (!textResponse && typeof response?.text === "string") {
      textResponse = response.text.trim();
    }
    const currentContext = { ...buyerContext || {} };
    let handoff = false;
    let updatedStage = null;
    if (response?.functionCalls && response.functionCalls.length > 0) {
      for (const fc of response.functionCalls) {
        if (fc.name === "capture_buyer_information") {
          const args = fc.args;
          Object.assign(currentContext, args);
          actions.push({ type: "capture_buyer_information", fields: args });
        } else if (fc.name === "update_sales_stage") {
          updatedStage = fc.args.stage;
          actions.push({ type: "update_sales_stage", stage: updatedStage });
        } else if (fc.name === "hand_off_to_human") {
          handoff = true;
          const args = fc.args;
          actions.push({ type: "hand_off_to_human", ...args });
        }
      }
    }
    const lowerMsg = cleanMessage.toLowerCase();
    if (/\bsuv\b/i.test(lowerMsg)) currentContext.targetVehicle = "SUV";
    else if (/\btruck\b/i.test(lowerMsg)) currentContext.targetVehicle = "Truck";
    else if (/\bsedan\b|\bcar\b/i.test(lowerMsg)) currentContext.targetVehicle = "Sedan";
    else if (/\bvan\b/i.test(lowerMsg)) currentContext.targetVehicle = "Van";
    const budgetMatch = cleanMessage.match(/\$?([2-9]\d{2}|[1-4]\d{3})\b/);
    if (budgetMatch && !currentContext.monthlyBudget) {
      const b = parseInt(budgetMatch[1], 10);
      if (b >= 200 && b <= 5e3) currentContext.monthlyBudget = b;
    }
    if (!currentContext.creditSituation) {
      if (/\b(excellent|great|good|7\d{2}|8\d{2})\b/i.test(lowerMsg)) {
        currentContext.creditSituation = "Good";
      } else if (/\b(fair|average|okay|6\d{2})\b/i.test(lowerMsg)) {
        currentContext.creditSituation = "Fair";
      } else if (/\b(rebuilding|bad|poor|low|collections|consumer proposal|bankruptcy|5\d{2}|4\d{2})\b/i.test(lowerMsg)) {
        currentContext.creditSituation = "Rebuilding";
      }
    }
    const incomeMatch = cleanMessage.match(/(?:income|make|earn|gross)?\s*\$?([2-9]\d{3}|[1-9]\d{4})\b/i);
    if (incomeMatch && !currentContext.monthlyIncome) {
      const inc = parseInt(incomeMatch[1], 10);
      if (inc >= 1500 && inc <= 5e4) currentContext.monthlyIncome = inc;
    }
    const phoneMatch = cleanMessage.match(/(\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/);
    if (phoneMatch && !currentContext.phone) {
      currentContext.phone = phoneMatch[0];
    }
    const emailMatch = cleanMessage.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch && !currentContext.email) {
      currentContext.email = emailMatch[0];
    }
    if (!textResponse) {
      if (handoff || currentContext.phone && (currentContext.name || currentContext.email)) {
        textResponse = `Splendid! I have everything organized for your ${currentContext.targetVehicle || "vehicle"}. I'll have Stephan review your details and reach out to you directly.`;
      } else if (currentContext.creditSituation && currentContext.monthlyIncome) {
        textResponse = `Splendid! With your credit profile and income on a ${currentContext.targetVehicle || "vehicle"}, we have strong lender options. What is the best phone number or email for Stephan to send your tailored options?`;
      } else if (currentContext.creditSituation) {
        textResponse = `Got it, thank you. To help us calculate the best approval terms for your $${currentContext.monthlyBudget || 600}/mo payment, what is your approximate gross monthly income?`;
      } else if (currentContext.targetVehicle && currentContext.monthlyBudget) {
        textResponse = `Splendid! A ${currentContext.targetVehicle} around $${currentContext.monthlyBudget} a month gives us fantastic options. How would you describe your current credit\u2014good, fair, or rebuilding?`;
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
      conversationalAction: handoff ? "handoff" : "speak_and_listen",
      nextObjective: metrics.nextBestAction.toLowerCase(),
      conversationId,
      turnId,
      salesStage: updatedStage || salesStage,
      buyerContext: currentContext,
      leadIntelligence: metrics
    };
    await queryDB(
      "UPDATE conversation_turns SET assistant_response = $1, status = 'COMPLETED', completed_at = NOW() WHERE id = $2 AND execution_id = $3",
      [JSON.stringify(finalResponse), turnRecord.id, executionId]
    );
    return res.json(finalResponse);
  } catch (error) {
    console.error("[CHAT_ROUTE_FATAL]", error);
    try {
      await queryDB(
        "UPDATE conversation_turns SET status = 'FAILED', failed_at = NOW() WHERE execution_id = $1",
        [executionId]
      );
    } catch (e) {
    }
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred." }
    });
  }
});

// server/server_routes/voiceLeadSync.ts
import { Router } from "express";
import crypto3 from "crypto";

// server/server_routes/voiceLeadExtractor.ts
var TENS_WORDS = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90
};
var TEENS_WORDS = {
  ten: "10",
  eleven: "11",
  twelve: "12",
  thirteen: "13",
  fourteen: "14",
  fifteen: "15",
  sixteen: "16",
  seventeen: "17",
  eighteen: "18",
  nineteen: "19"
};
var SINGLE_DIGIT_WORDS = {
  zero: "0",
  oh: "0",
  o: "0",
  naught: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9"
};
var DIGIT_TOKEN_PATTERN = "(?:[0-9]|zero|oh|o|naught|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)";
function sanitizeSpokenPhoneText(raw) {
  if (!raw) return "";
  let text = String(raw).toLowerCase();
  text = text.replace(/[,;:|/\\]/g, " ");
  text = text.replace(/\bdouble\s+([a-z0-9]+)\b/g, "$1 $1");
  text = text.replace(/\btriple\s+([a-z0-9]+)\b/g, "$1 $1 $1");
  text = text.replace(/\bquadruple\s+([a-z0-9]+)\b/g, "$1 $1 $1 $1");
  text = text.replace(new RegExp(`\\barea\\s+code\\s+(?:to|too)\\b`, "g"), "area code 2");
  text = text.replace(new RegExp(`\\barea\\s+code\\s+(?:for)\\b`, "g"), "area code 4");
  text = text.replace(new RegExp(`\\barea\\s+code\\s+(?:tree|free)\\b`, "g"), "area code 3");
  text = text.replace(new RegExp(`\\barea\\s+code\\s+(?:ate)\\b`, "g"), "area code 8");
  text = text.replace(new RegExp(`\\barea\\s+code\\s+(?:won)\\b`, "g"), "area code 1");
  text = text.replace(new RegExp(`\\b(?:to|too)\\s+(?=${DIGIT_TOKEN_PATTERN}\\b)`, "g"), "2 ");
  text = text.replace(new RegExp(`\\b(?:for)\\s+(?=${DIGIT_TOKEN_PATTERN}\\b)`, "g"), "4 ");
  text = text.replace(new RegExp(`\\b(?:tree|free)\\s+(?=${DIGIT_TOKEN_PATTERN}\\b)`, "g"), "3 ");
  text = text.replace(new RegExp(`\\b(?:ate)\\s+(?=${DIGIT_TOKEN_PATTERN}\\b)`, "g"), "8 ");
  text = text.replace(new RegExp(`\\b(?:won)\\s+(?=${DIGIT_TOKEN_PATTERN}\\b)`, "g"), "1 ");
  text = text.replace(new RegExp(`(?<=\\b${DIGIT_TOKEN_PATTERN}\\s+)(?:to|too)\\b`, "g"), "2");
  text = text.replace(new RegExp(`(?<=\\b${DIGIT_TOKEN_PATTERN}\\s+)(?:for)\\b`, "g"), "4");
  text = text.replace(new RegExp(`(?<=\\b${DIGIT_TOKEN_PATTERN}\\s+)(?:tree|free)\\b`, "g"), "3");
  text = text.replace(new RegExp(`(?<=\\b${DIGIT_TOKEN_PATTERN}\\s+)(?:ate)\\b`, "g"), "8");
  text = text.replace(new RegExp(`(?<=\\b${DIGIT_TOKEN_PATTERN}\\s+)(?:won)\\b`, "g"), "1");
  for (const [tenWord, tenVal] of Object.entries(TENS_WORDS)) {
    for (const [oneWord, digitStr] of Object.entries(SINGLE_DIGIT_WORDS)) {
      if (digitStr === "0") continue;
      const compoundRegex = new RegExp(`\\b${tenWord}[-\\s]+${oneWord}\\b`, "g");
      text = text.replace(compoundRegex, String(tenVal + parseInt(digitStr, 10)));
    }
  }
  for (const [word, digit] of Object.entries(TEENS_WORDS)) {
    text = text.replace(new RegExp(`\\b${word}\\b`, "g"), digit);
  }
  for (const [word, val] of Object.entries(TENS_WORDS)) {
    text = text.replace(new RegExp(`\\b${word}\\b`, "g"), String(val));
  }
  for (const [word, digit] of Object.entries(SINGLE_DIGIT_WORDS)) {
    text = text.replace(new RegExp(`\\b${word}\\b`, "g"), digit);
  }
  text = text.replace(/\b([1-9]\d?)[-\s]+hundred\b/g, (_, n) => `${n}00`);
  return text;
}
function normalizePhone(raw, areaCode) {
  if (!raw) return null;
  let text = sanitizeSpokenPhoneText(raw);
  const phoneCandidateRegex = /(?:\+?1[\s,.-]*)?\(?\d[\s,.-]*\d[\s,.-]*\d\)?[\s,.-]*\d[\s,.-]*\d[\s,.-]*\d[\s,.-]*\d[\s,.-]*\d[\s,.-]*\d[\s,.-]*\d/g;
  const candidateMatches = text.match(phoneCandidateRegex);
  let digits = "";
  if (candidateMatches && candidateMatches.length > 0) {
    const validNanp = candidateMatches.find((c) => {
      const d = c.replace(/\D/g, "");
      const d10 = d.length === 11 && d.startsWith("1") ? d.substring(1) : d;
      return d10.length === 10 && d10[0] >= "2" && d10[0] <= "9";
    });
    const bestMatch = validNanp || candidateMatches[candidateMatches.length - 1];
    digits = bestMatch.replace(/\D/g, "");
  } else {
    digits = text.replace(/\D/g, "");
  }
  let clean10 = "";
  if (digits.length === 10) {
    clean10 = digits;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    clean10 = digits.substring(1);
  } else if (digits.length === 7 && areaCode) {
    const cleanArea = areaCode.replace(/\D/g, "");
    if (cleanArea.length === 3 && cleanArea[0] >= "2" && cleanArea[0] <= "9") {
      clean10 = cleanArea + digits;
    } else {
      return null;
    }
  } else if (digits.length > 10) {
    const nanpMatch = digits.match(/[2-9]\d{9}/);
    if (nanpMatch) {
      clean10 = nanpMatch[0];
    } else {
      clean10 = digits.substring(0, 10);
    }
  } else {
    return null;
  }
  const area = clean10.substring(0, 3);
  const mid = clean10.substring(3, 6);
  const last = clean10.substring(6, 10);
  return `(${area}) ${mid}-${last}`;
}
function normalizeEmail(raw) {
  if (!raw) return null;
  let text = String(raw).toLowerCase().trim();
  text = text.replace(/\s+at\s+/g, "@");
  text = text.replace(/\s+dot\s+/g, ".");
  text = text.replace(/\s+/g, "");
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (emailRegex.test(text)) {
    return text;
  }
  return null;
}
function normalizeCurrency(raw) {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.round(raw);
  }
  if (!raw) return null;
  const text = String(raw).toLowerCase().replace(/,/g, "").trim();
  const spokenGrand = {
    "one grand": 1e3,
    "two grand": 2e3,
    "three grand": 3e3,
    "four grand": 4e3,
    "five grand": 5e3,
    "six grand": 6e3,
    "seven grand": 7e3,
    "eight grand": 8e3,
    "nine grand": 9e3,
    "ten grand": 1e4
  };
  for (const [phrase, amount] of Object.entries(spokenGrand)) {
    if (text.includes(phrase)) return amount;
  }
  const grandMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:grand|k)\b/i);
  if (grandMatch) {
    return Math.round(parseFloat(grandMatch[1]) * 1e3);
  }
  const spokenCompounds = {
    "six fifty": 650,
    "six-fifty": 650,
    "seven fifty": 750,
    "seven-fifty": 750,
    "eight fifty": 850,
    "eight-fifty": 850,
    "nine fifty": 950,
    "nine-fifty": 950,
    "three fifty": 350,
    "three-fifty": 350,
    "four fifty": 450,
    "four-fifty": 450,
    "five fifty": 550,
    "five-fifty": 550,
    "six hundred fifty": 650,
    "six hundred and fifty": 650,
    "one hundred": 100,
    "two hundred": 200,
    "three hundred": 300,
    "four hundred": 400,
    "five hundred": 500,
    "six hundred": 600,
    "seven hundred": 700,
    "eight hundred": 800,
    "nine hundred": 900,
    "one thousand": 1e3,
    "two thousand": 2e3,
    "three thousand": 3e3,
    "four thousand": 4e3,
    "five thousand": 5e3
  };
  for (const [phrase, amount] of Object.entries(spokenCompounds)) {
    if (text.includes(phrase)) return amount;
  }
  const numMatch = text.match(/\$?\s*([0-9]{2,6})(?:\.00)?/);
  if (numMatch) {
    const parsed = parseInt(numMatch[1], 10);
    if (parsed > 0 && parsed <= 5e5) {
      return parsed;
    }
  }
  return null;
}
function normalizeCredit(raw) {
  if (!raw) return null;
  const lower = String(raw).toLowerCase().trim();
  const isPaymentPhrase = /\b(month|mo|monthly|payment|budget|\$|spend|afford|dollars|bucks|pay|down)\b/.test(lower);
  if (/\b(excellent|tier 1|700\+|800|prime|great)\b/.test(lower)) return "Excellent";
  if (/\b(good|decent|average)\b/.test(lower)) return "Good";
  if (/\b(?:credit|score|rating)\b.*\b(?:around|about)?\s*650\b|\b(?:around|about)?\s*650\b.*\b(?:credit|score|rating)\b/.test(lower) && !isPaymentPhrase) return "Good";
  if (/\b(fair|okay|so so)\b/.test(lower)) return "Fair";
  if (/\b(?:credit|score|rating)\b.*\b(?:around|about)?\s*600\b|\b(?:around|about)?\s*600\b.*\b(?:credit|score|rating)\b/.test(lower) && !isPaymentPhrase) return "Fair";
  if (/\b(rebuilding|improving|working on it)\b/.test(lower)) return "Rebuilding";
  if (/\b(bankruptcy|chapter 7|bankrupt)\b/.test(lower)) return "Bankruptcy";
  if (/\b(consumer proposal|proposal)\b/.test(lower)) return "Consumer Proposal";
  if (/\b(collections|late payments|slow pay|bad credit|poor|terrible|low)\b/.test(lower)) return "Challenged / Collections";
  if (/\b(no credit|new to canada|first time buyer|new credit)\b/.test(lower)) return "First-Time / New Credit";
  const hasPhoneOrBudget = /(?:\d{3}[-.\s]?\d{3}[-.\s]?\d{4}|\$\d+)/.test(lower);
  const explicitScoreMatch = lower.match(/(?:credit\s*score|score|credit|rating)\s*(?:is|of|around|about)?\s*([3-8]\d{2})\b/);
  if (explicitScoreMatch && !isPaymentPhrase) {
    const score = parseInt(explicitScoreMatch[1], 10);
    if (score >= 720) return "Excellent";
    if (score >= 650) return "Good";
    if (score >= 600) return "Fair";
    if (score >= 300) return "Rebuilding";
  } else if (!hasPhoneOrBudget && !isPaymentPhrase) {
    const standaloneScore = lower.match(/^\s*(?:around\s*|about\s*)?([3-8]\d{2})\s*$/);
    if (standaloneScore) {
      const score = parseInt(standaloneScore[1], 10);
      if (score >= 720) return "Excellent";
      if (score >= 650) return "Good";
      if (score >= 600) return "Fair";
      if (score >= 300) return "Rebuilding";
    }
  }
  if (raw.trim().split(/\s+/).length <= 2 && !isPaymentPhrase && !hasPhoneOrBudget) {
    return raw.trim();
  }
  return null;
}
function mergeBuyerProfile(existing, delta) {
  const merged = { ...existing };
  if (delta.name && delta.name.trim().length > 1) merged.name = delta.name.trim();
  if (delta.phone) {
    const normalized = normalizePhone(delta.phone);
    if (normalized) merged.phone = normalized;
  }
  if (delta.email) {
    const normalized = normalizeEmail(delta.email);
    if (normalized) merged.email = normalized;
  }
  if (delta.targetVehicle && delta.targetVehicle.trim().length > 1) merged.targetVehicle = delta.targetVehicle.trim();
  if (delta.vehicleType && delta.vehicleType.trim().length > 1) merged.vehicleType = delta.vehicleType.trim();
  if (delta.monthlyBudget !== void 0 && delta.monthlyBudget !== null) {
    const parsed = normalizeCurrency(delta.monthlyBudget);
    if (parsed) merged.monthlyBudget = parsed;
  }
  if (delta.creditSituation && delta.creditSituation.trim().length > 1) {
    const normalized = normalizeCredit(delta.creditSituation);
    if (normalized) merged.creditSituation = normalized;
  }
  if (delta.monthlyIncome !== void 0 && delta.monthlyIncome !== null) {
    const parsed = normalizeCurrency(delta.monthlyIncome);
    if (parsed) merged.monthlyIncome = parsed;
  }
  if (delta.employment && delta.employment.trim().length > 1) merged.employment = delta.employment.trim();
  if (delta.downPayment !== void 0 && delta.downPayment !== null) {
    const parsed = normalizeCurrency(delta.downPayment);
    if (parsed !== null) merged.downPayment = parsed;
  }
  if (delta.hasTrade !== void 0) merged.hasTrade = Boolean(delta.hasTrade);
  if (delta.tradeVehicle && delta.tradeVehicle.trim().length > 1) {
    merged.tradeVehicle = delta.tradeVehicle.trim();
    merged.hasTrade = true;
  }
  if (delta.purchaseTimeline && delta.purchaseTimeline.trim().length > 1) merged.purchaseTimeline = delta.purchaseTimeline.trim();
  if (delta.urgency && delta.urgency.trim().length > 1) merged.urgency = delta.urgency.trim();
  if (delta.salesBrief && delta.salesBrief.trim().length > 5) merged.salesBrief = delta.salesBrief.trim();
  return merged;
}
function generateSalesBrief(profile) {
  const parts = [];
  const vehicleDesc = profile.targetVehicle || profile.vehicleType || "vehicle";
  parts.push(`Buyer is actively inquiring about a ${vehicleDesc}.`);
  if (profile.monthlyBudget) {
    parts.push(`Target payment is approximately $${profile.monthlyBudget}/month.`);
  }
  if (profile.creditSituation) {
    parts.push(`Credit situation: "${profile.creditSituation}".`);
  }
  if (profile.monthlyIncome) {
    parts.push(`Estimated monthly take-home income is ~$${profile.monthlyIncome}.`);
  }
  if (profile.downPayment !== void 0) {
    parts.push(profile.downPayment > 0 ? `Available down payment: $${profile.downPayment}.` : "Zero down payment requested.");
  }
  if (profile.hasTrade && profile.tradeVehicle) {
    parts.push(`Trade-in vehicle: ${profile.tradeVehicle}.`);
  }
  if (profile.purchaseTimeline) {
    parts.push(`Timeline: ${profile.purchaseTimeline}.`);
  }
  if (profile.phone) {
    parts.push(`Contact number: ${profile.phone}.`);
  }
  parts.push("Recommended action: Senior specialist Stephan should contact buyer promptly to confirm approvals.");
  return parts.join(" ");
}

// server/server_routes/voiceLeadSync.ts
var voiceLeadRouter = Router();
var sessionLeadMap = /* @__PURE__ */ new Map();
var SESSION_CACHE_TTL_MS = 2 * 60 * 60 * 1e3;
var MAX_SESSION_CACHE_SIZE = 5e3;
function getCachedLeadId(conversationId) {
  const entry = sessionLeadMap.get(conversationId);
  if (!entry) return void 0;
  if (Date.now() > entry.expiresAt) {
    sessionLeadMap.delete(conversationId);
    return void 0;
  }
  return entry.leadId;
}
function setCachedLeadId(conversationId, leadId) {
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
voiceLeadRouter.post("/sync-lead", async (req, res) => {
  try {
    const {
      conversationId,
      leadId: clientLeadId,
      buyerProfile = {},
      transcriptHistory = [],
      signals = [],
      lastTurn = "",
      forensics = null
    } = req.body;
    if (!conversationId) {
      return res.status(400).json({ error: "Missing required conversationId" });
    }
    console.log("[JARVIS_CRM_SYNC_STARTED]", {
      conversationId,
      hasIncomingPhone: Boolean(buyerProfile.phone),
      hasIncomingVehicle: Boolean(buyerProfile.targetVehicle || buyerProfile.vehicleType),
      timestamp: Date.now()
    });
    let leadId = clientLeadId || getCachedLeadId(conversationId);
    if (leadId) {
      const delCheck = await queryDB("SELECT 1 FROM deleted_leads WHERE id = $1", [leadId]);
      if (delCheck.rows && delCheck.rows.length > 0) {
        console.log("[JARVIS_CRM_SYNC_IGNORED_DELETED]", { conversationId, leadId });
        return res.status(200).json({ success: true, ignored: true, reason: "deleted", leadId });
      }
    }
    if (!leadId) {
      leadId = `lead_voice_${crypto3.randomUUID()}`;
      setCachedLeadId(conversationId, leadId);
    }
    let existingRecord = null;
    if (leadId) {
      const byId = await queryDB("SELECT * FROM leads WHERE id = $1", [leadId]);
      if (byId.rows && byId.rows.length > 0) {
        existingRecord = byId.rows[0];
      }
    }
    if (!existingRecord) {
      const byConv = await queryDB("SELECT * FROM leads WHERE conversation_id = $1", [conversationId]);
      if (byConv.rows && byConv.rows.length > 0) {
        existingRecord = byConv.rows[0];
        leadId = existingRecord.id;
        setCachedLeadId(conversationId, leadId);
      }
    }
    const existingProfile = {};
    if (existingRecord) {
      if (existingRecord.name) existingProfile.name = existingRecord.name;
      if (existingRecord.phone) existingProfile.phone = existingRecord.phone;
      if (existingRecord.email) existingProfile.email = existingRecord.email;
      if (existingRecord.vehicle) existingProfile.targetVehicle = existingRecord.vehicle;
      if (existingRecord.vehicle_type) existingProfile.vehicleType = existingRecord.vehicle_type;
      if (existingRecord.monthly_income) existingProfile.monthlyIncome = normalizeCurrency(existingRecord.monthly_income) || void 0;
      if (existingRecord.credit_situation) existingProfile.creditSituation = existingRecord.credit_situation;
      if (existingRecord.down_payment || existingRecord.downPayment) {
        existingProfile.downPayment = normalizeCurrency(existingRecord.down_payment || existingRecord.downPayment) || void 0;
      }
      if (existingRecord.has_trade) existingProfile.hasTrade = Boolean(existingRecord.has_trade);
      if (existingRecord.trade_vehicle) existingProfile.tradeVehicle = existingRecord.trade_vehicle;
      if (existingRecord.budget || existingRecord.payment_target) {
        existingProfile.monthlyBudget = normalizeCurrency(existingRecord.budget || existingRecord.payment_target) || void 0;
      }
      if (existingRecord.purchase_timeline) existingProfile.purchaseTimeline = existingRecord.purchase_timeline;
      if (existingRecord.urgency) existingProfile.urgency = existingRecord.urgency;
    }
    const mergedProfile = mergeBuyerProfile(existingProfile, buyerProfile);
    const intelContext = {
      name: mergedProfile.name,
      firstName: mergedProfile.name ? mergedProfile.name.split(" ")[0] : void 0,
      phone: mergedProfile.phone,
      email: mergedProfile.email,
      targetVehicle: mergedProfile.targetVehicle,
      vehicleType: mergedProfile.vehicleType,
      monthlyBudget: mergedProfile.monthlyBudget,
      paymentTarget: mergedProfile.monthlyBudget ? `$${mergedProfile.monthlyBudget}/mo` : void 0,
      creditSituation: mergedProfile.creditSituation,
      monthlyIncome: mergedProfile.monthlyIncome,
      income: mergedProfile.monthlyIncome ? String(mergedProfile.monthlyIncome) : void 0,
      downPayment: mergedProfile.downPayment,
      hasTrade: mergedProfile.hasTrade,
      tradeVehicle: mergedProfile.tradeVehicle,
      purchaseTimeline: mergedProfile.purchaseTimeline,
      urgency: mergedProfile.urgency
    };
    const rawMetrics = calculateLeadIntelligence(intelContext, signals, lastTurn);
    const metrics = {
      intentScore: Math.max(0, Math.min(100, Math.round(rawMetrics.intentScore || 0))),
      intentStage: rawMetrics.intentStage || "CURIOUS",
      contactabilityScore: Math.max(0, Math.min(100, Math.round(rawMetrics.contactabilityScore || 0))),
      qualificationScore: Math.max(0, Math.min(100, Math.round(rawMetrics.qualificationScore || 0))),
      leadQualityScore: Math.max(0, Math.min(100, Math.round(rawMetrics.leadQualityScore || 0))),
      leadCompleteness: Math.max(0, Math.min(100, Math.round(rawMetrics.completenessScore || 0))),
      buyingCommitment: rawMetrics.buyingCommitment || "NONE",
      nextBestAction: rawMetrics.nextBestAction || "DISCOVER",
      recommendedNextAction: rawMetrics.recommendedNextAction || "NURTURE",
      salesBrief: generateSalesBrief(mergedProfile)
    };
    let status = "NEW";
    if (metrics.intentScore >= 75 || metrics.recommendedNextAction === "CALL_ASAP") {
      status = "HIGH_INTENT";
    } else if (metrics.qualificationScore >= 60 && metrics.contactabilityScore >= 60) {
      status = "QUALIFIED";
    }
    const firstName = mergedProfile.name ? mergedProfile.name.split(" ")[0] : null;
    const lastName = mergedProfile.name && mergedProfile.name.split(" ").length > 1 ? mergedProfile.name.split(" ").slice(1).join(" ") : null;
    const createdAt = existingRecord?.createdAt || existingRecord?.created_at || (/* @__PURE__ */ new Date()).toISOString();
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
      mergedProfile.downPayment !== void 0 ? String(mergedProfile.downPayment) : null,
      mergedProfile.downPayment !== void 0 ? String(mergedProfile.downPayment) : null,
      mergedProfile.hasTrade || false,
      mergedProfile.tradeVehicle || null,
      mergedProfile.purchaseTimeline || null,
      mergedProfile.urgency || null,
      "JARVIS_LIVE",
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
      forensics ? typeof forensics === "string" ? forensics : JSON.stringify(forensics) : null
    ];
    await queryDB(upsertQuery, values);
    console.log("[JARVIS_CRM_SYNC_SUCCESS]", {
      conversationId,
      leadId,
      source: "JARVIS_LIVE",
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
  } catch (err) {
    console.error("[JARVIS_CRM_SYNC_FAILURE]", err);
    return res.status(500).json({
      success: false,
      error: "Failed to synchronize voice lead"
    });
  }
});

// server/server_routes/voiceGateway.ts
import { WebSocketServer, WebSocket } from "ws";
function setupVoiceGateway(httpServer) {
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (request, socket, head) => {
    const host = request.headers.host || "localhost";
    const parsedUrl = new URL(request.url || "", `http://${host}`);
    if (parsedUrl.pathname === "/api/voice/live-stream") {
      wss.handleUpgrade(request, socket, head, (clientWs) => {
        wss.emit("connection", clientWs, request);
      });
    }
  });
  wss.on("connection", (clientWs, request) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("[VoiceGateway] GEMINI_API_KEY is not configured on the server.");
      clientWs.close(1011, "GEMINI_API_KEY_NOT_CONFIGURED");
      return;
    }
    const host = request.headers.host || "localhost";
    const parsedUrl = new URL(request.url || "", `http://${host}`);
    const requestedModel = parsedUrl.searchParams.get("model") || process.env.GEMINI_LIVE_MODEL || "models/gemini-2.5-flash-native-audio-latest";
    const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    const geminiWs = new WebSocket(geminiUrl);
    const pendingQueue = [];
    let isGeminiOpen = false;
    geminiWs.on("open", () => {
      isGeminiOpen = true;
      while (pendingQueue.length > 0) {
        const item = pendingQueue.shift();
        if (item && geminiWs.readyState === WebSocket.OPEN) {
          geminiWs.send(item.data, { binary: item.isBinary });
        }
      }
    });
    clientWs.on("message", (data, isBinary) => {
      if (isGeminiOpen && geminiWs.readyState === WebSocket.OPEN) {
        geminiWs.send(data, { binary: isBinary });
      } else if (!isGeminiOpen && geminiWs.readyState === WebSocket.CONNECTING) {
        pendingQueue.push({ data, isBinary });
      }
    });
    geminiWs.on("message", (data, isBinary) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data, { binary: isBinary });
      }
    });
    clientWs.on("close", (code, reason) => {
      if (geminiWs.readyState === WebSocket.OPEN || geminiWs.readyState === WebSocket.CONNECTING) {
        try {
          geminiWs.close(code, reason);
        } catch {
        }
      }
    });
    clientWs.on("error", (err) => {
      console.warn("[VoiceGateway] Client socket error:", err.message);
      if (geminiWs.readyState === WebSocket.OPEN || geminiWs.readyState === WebSocket.CONNECTING) {
        try {
          geminiWs.close(1011, "Client error");
        } catch {
        }
      }
    });
    geminiWs.on("close", (code, reason) => {
      if (clientWs.readyState === WebSocket.OPEN || clientWs.readyState === WebSocket.CONNECTING) {
        try {
          clientWs.close(code, reason);
        } catch {
        }
      }
    });
    geminiWs.on("error", (err) => {
      console.error("[VoiceGateway] Gemini upstream socket error:", err.message);
      if (clientWs.readyState === WebSocket.OPEN || clientWs.readyState === WebSocket.CONNECTING) {
        try {
          clientWs.close(1011, "Gemini connection error");
        } catch {
        }
      }
    });
  });
  return wss;
}

// server/server_routes/peptideRoutes.ts
import { Router as Router2 } from "express";

// server/peptide/peptideKnowledgeEngine.ts
import fs from "fs";
import path from "path";

// server/peptide/database.ts
var INITIAL_PEPTIDES = [
  // ─────────────────────────────────────────────────────────────────────────────
  // GROWTH HORMONE RELEASING HORMONES & SECRETAGOGUES
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: "cjc-1295",
    name: "CJC-1295",
    commonNames: ["Modified GRF 1-29", "DAC:GRF", "CJC-1295 with DAC", "CJC-1295 without DAC"],
    category: "gh_secretagogues",
    classification: "Synthetic Growth Hormone-Releasing Hormone (GHRH) Analog (Tetrasubstituted)",
    molecularFormula: "C152H252N44O42",
    halfLife: "Approx. 30 mins (no DAC / Mod GRF 1-29); 6 to 8 days (with DAC)",
    administrationRoutes: ["Subcutaneous Injection"],
    mechanism: "Binds selectively to GHRH receptors on pituitary somatotrophs, activating adenylate cyclase and cAMP pathways to stimulate pulsatile secretion of endogenous growth hormone (GH) and secondarily elevate hepatic Insulin-like Growth Factor 1 (IGF-1).",
    regulatoryStatus: "Investigational / Research Chemical Only. Not FDA approved for human therapeutic use.",
    investigatedUses: [
      {
        conditionOrGoal: "Elevating Endogenous Growth Hormone & IGF-1",
        evidenceLevel: "LEVEL_B",
        status: "Phase 1/2 Clinical Trials Completed",
        summary: "Demonstrated dose-dependent sustained 2-to-10 fold increases in basal and pulsatile GH and 1.5-to-3 fold increases in IGF-1 in healthy adult cohorts.",
        sources: ["Teichman-2006-JCEM"]
      },
      {
        conditionOrGoal: "Body Composition & Fat Loss in Athletes",
        evidenceLevel: "LEVEL_D",
        status: "Anecdotal Only",
        summary: "Widely used in athletic and fitness communities to enhance recovery and lean mass; however, robust clinical trials evaluating athletic performance or body recomposition in healthy non-GH-deficient adults are lacking.",
        sources: []
      }
    ],
    claims: [
      {
        id: "cjc-claim-1",
        claim: "Stimulates physiological pulsatile release of endogenous GH and IGF-1",
        category: "benefit",
        evidenceLevel: "LEVEL_B",
        description: "Clinical trials in healthy human subjects confirm sustained, dose-dependent increases in mean plasma GH and IGF-1 concentrations while preserving normal pulsatile secretion dynamics.",
        population: "Human Clinical (Healthy Adults 21-50)",
        studyType: "Randomized Controlled Trial",
        limitations: "Limited long-term safety data; clinical trials halted after a patient fatality in an advanced trial (though causal link was debated).",
        confidence: "HIGH",
        sourceIds: ["Teichman-2006-JCEM"]
      },
      {
        id: "cjc-claim-2",
        claim: "Accelerates athletic recovery and fat burning in healthy gym-goers",
        category: "benefit",
        evidenceLevel: "LEVEL_D",
        description: "Anecdotally reported by fitness communities for accelerating gym recovery, joint comfort, and visceral fat reduction when stacked with Ipamorelin.",
        population: "Athletic Community",
        studyType: "Anecdotal / Online User Reports",
        limitations: "No randomized controlled human trials evaluate athletic recovery, strength, or body recomposition in healthy individuals.",
        confidence: "LOW",
        sourceIds: []
      }
    ],
    clinicalEvidenceSummary: "Early human clinical trials conducted by ConjuChem evaluated CJC-1295 with DAC in healthy volunteers and HIV patients, establishing that a single injection produced prolonged increases in GH and IGF-1 for up to 28 days without shutting down normal pituitary pulsatility. However, development was suspended and large-scale efficacy data remain incomplete.",
    preclinicalEvidenceSummary: "Rodent models demonstrated prolonged serum half-life due to bioconjugation with endogenous albumin through maleimidopropionic acid linker technology, showing enhanced somatic growth and pituitary cellular stimulation.",
    anecdotalSummary: "Commonly stacked with Ipamorelin by wellness and biohacking enthusiasts for anti-aging, sleep quality, and fat reduction. Many users claim subjective improvements in deep sleep (slow-wave sleep) and training recovery, but these are uncontrolled reports.",
    adverseEffects: [
      {
        effect: "Transient flushing and warm sensation",
        type: "established",
        description: "Vasodilation occurring within 10-30 minutes post-subcutaneous administration.",
        evidenceLevel: "LEVEL_A",
        frequency: "Common",
        sourceIds: ["Teichman-2006-JCEM"]
      },
      {
        effect: "Injection site erythema, induration, and tenderness",
        type: "established",
        description: "Localized subcutaneous inflammation at the injection site.",
        evidenceLevel: "LEVEL_A",
        frequency: "Common",
        sourceIds: ["Teichman-2006-JCEM"]
      },
      {
        effect: "Fluid retention, peripheral edema, and carpal tunnel symptoms",
        type: "reported",
        description: "Mild transient fluid retention secondary to elevated GH/IGF-1 signaling.",
        evidenceLevel: "LEVEL_B",
        frequency: "Infrequent"
      }
    ],
    contraindications: [
      "Active malignancy or history of cancer (IGF-1 stimulates cellular proliferation)",
      "Pituitary adenoma or intracranial tumors",
      "Known hypersensitivity to GHRH analogs",
      "Pregnancy and nursing"
    ],
    unknowns: [
      "Long-term cardiovascular risk and glucose homeostasis impacts with chronic continuous use",
      "Definitive clinical risk profile of long-acting DAC bioconjugation versus pulsatile non-DAC Mod GRF 1-29"
    ],
    sources: [
      {
        id: "Teichman-2006-JCEM",
        title: "Prolonged stimulation of growth hormone (GH) and insulin-like growth factor I secretion by CJC-1295, a long-acting analog of GH-releasing hormone, in healthy adults",
        authorsOrOrg: "Teichman SL, Neale A, Lawrence B, Gagnon C, Castaigne JP, Frohman LA",
        journalOrPublisher: "Journal of Clinical Endocrinology & Metabolism (JCEM)",
        year: 2006,
        pmidOrDoi: "PMID: 16352683",
        url: "https://pubmed.ncbi.nlm.nih.gov/16352683/",
        evidenceLevel: "LEVEL_B",
        studyType: "RCT"
      }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: "ipamorelin",
    name: "Ipamorelin",
    commonNames: ["NNC 26-0161"],
    category: "gh_secretagogues",
    classification: "Selective Growth Hormone Secretagogue Receptor (GHS-R1a) Agonist / GHRP",
    molecularFormula: "C38H49N9O5",
    halfLife: "Approx. 2 hours",
    administrationRoutes: ["Subcutaneous Injection"],
    mechanism: "Selectively binds to the ghrelin/GHS-R1a receptor on the anterior pituitary. Uniquely among GHRPs, it stimulates GH secretion with minimal to no elevation of ACTH, cortisol, prolactin, or appetite hormones.",
    regulatoryStatus: "Investigational / Research Chemical Only. Not FDA approved.",
    investigatedUses: [
      {
        conditionOrGoal: "Postoperative Ileus Recovery",
        evidenceLevel: "LEVEL_B",
        status: "Phase 2 Clinical Evaluation (Discontinued for bowel recovery)",
        summary: "Investigated in bowel resection patients to shorten time to first bowel movement; demonstrated selective GH release but lacked significant clinical efficacy for bowel transit acceleration.",
        sources: ["Beck-2014-Neurogastroenterol"]
      },
      {
        conditionOrGoal: "Selective GH Elevation Without Cortisol/Prolactin Spikes",
        evidenceLevel: "LEVEL_A",
        status: "Demonstrated in Human Pharmacology Studies",
        summary: "Human pharmacodynamic studies confirmed potent GH release without clinically meaningful increases in plasma ACTH, cortisol, or prolactin at therapeutic doses.",
        sources: ["Gobburu-1999-PharmRes", "Raun-1998-EurJEndocrinol"]
      },
      {
        conditionOrGoal: "Muscle Hypertrophy and Fat Loss",
        evidenceLevel: "LEVEL_D",
        status: "Anecdotal Only",
        summary: "Frequently paired with CJC-1295 by bodybuilders for clean GH pulses without ghrelin-induced intense hunger spikes.",
        sources: []
      }
    ],
    claims: [
      {
        id: "ipa-claim-1",
        claim: "Selectively stimulates GH release without spiking cortisol or prolactin",
        category: "benefit",
        evidenceLevel: "LEVEL_A",
        description: "Demonstrated in human and animal pharmacology to stimulate GH release via GHS-R1a without stimulating the hypothalamic-pituitary-adrenal axis (cortisol) or prolactin secretion.",
        population: "Human Clinical & Swine Pharmacology",
        studyType: "Controlled Pharmacodynamic Study",
        limitations: "Studies reflect short-term administration; long-term safety is uncharacterized.",
        confidence: "HIGH",
        sourceIds: ["Gobburu-1999-PharmRes", "Raun-1998-EurJEndocrinol"]
      },
      {
        id: "ipa-claim-2",
        claim: "Causes significant fat loss and athletic muscle growth",
        category: "benefit",
        evidenceLevel: "LEVEL_D",
        description: "Bodybuilding communities claim that Ipamorelin melts abdominal fat and builds dense lean muscle without water bloating.",
        population: "Athletic Community",
        studyType: "Anecdotal / Online Forums",
        limitations: "No clinical trials show standalone body recomposition or athletic performance enhancements in healthy individuals.",
        confidence: "LOW",
        sourceIds: []
      }
    ],
    clinicalEvidenceSummary: "Human phase 1 and phase 2 trials confirmed high receptor selectivity for GH release over other pituitary hormones. It does not cause the severe ravenous hunger seen with GHRP-6 or the cortisol surges seen with Hexarelin.",
    preclinicalEvidenceSummary: "In rodent and swine models, Ipamorelin stimulated longitudinal bone growth, nitrogen retention, and increased body weight gain with minimal endocrine off-target receptor interaction.",
    anecdotalSummary: 'Valued in the anti-aging and athletic spheres as the "cleanest" GHRP because it avoids the intense hunger pangs, water retention, and cortisol-driven stress of older secretagogues.',
    adverseEffects: [
      {
        effect: "Transient headache and lightheadedness",
        type: "established",
        description: "Mild, self-limiting cephalalgia reported post-injection.",
        evidenceLevel: "LEVEL_B",
        frequency: "Infrequent"
      },
      {
        effect: "Local injection site irritation",
        type: "established",
        description: "Subcutaneous redness or itching at the injection point.",
        evidenceLevel: "LEVEL_A",
        frequency: "Common"
      },
      {
        effect: "Mild transient fluid retention",
        type: "reported",
        description: "Slight finger or ankle puffiness at higher dosages.",
        evidenceLevel: "LEVEL_B",
        frequency: "Infrequent"
      }
    ],
    contraindications: [
      "Active neoplasm or history of cancer",
      "Severe uncontrolled diabetes mellitus",
      "Known hypersensitivity"
    ],
    unknowns: [
      "Long-term consequences on insulin sensitivity with multi-year cyclical use",
      "Safety and efficacy in healthy athletic populations"
    ],
    sources: [
      {
        id: "Raun-1998-EurJEndocrinol",
        title: "Ipamorelin, the first selective growth hormone secretagogue",
        authorsOrOrg: "Raun K, Hansen BS, Johansen PB, Th\xF8gersen H, Madsen K, Ankersen M, Andersen PH",
        journalOrPublisher: "European Journal of Endocrinology",
        year: 1998,
        pmidOrDoi: "PMID: 9849822",
        url: "https://pubmed.ncbi.nlm.nih.gov/9849822/",
        evidenceLevel: "LEVEL_A",
        studyType: "Pharmacology"
      },
      {
        id: "Gobburu-1999-PharmRes",
        title: "Pharmacokinetic-pharmacodynamic modeling of ipamorelin, a growth hormone releasing peptide, in human volunteers",
        authorsOrOrg: "Gobburu JV, Agers\xF8 H, Jusko WJ, Ynddal L",
        journalOrPublisher: "Pharmaceutical Research",
        year: 1999,
        pmidOrDoi: "PMID: 10495374",
        url: "https://pubmed.ncbi.nlm.nih.gov/10495374/",
        evidenceLevel: "LEVEL_A",
        studyType: "RCT"
      }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: "sermorelin",
    name: "Sermorelin",
    commonNames: ["GHRH (1-29) NH2", "Geref"],
    category: "gh_secretagogues",
    classification: "Synthetic Peptide Fragment of Human Growth Hormone-Releasing Hormone (GHRH)",
    molecularFormula: "C149H246N44O42S",
    halfLife: "Approx. 10 to 12 minutes (rapidly cleared by plasma dipeptidyl peptidase)",
    administrationRoutes: ["Subcutaneous Injection", "Intravenous Injection (diagnostic)"],
    mechanism: "Represents the biologically active 1-29 amino acid sequence of native 44-amino acid GHRH. Directly stimulates pituitary GHRH receptors, prompting the synthesis and physiological pulsatile secretion of endogenous GH subject to natural somatostatin negative feedback.",
    regulatoryStatus: "Historically FDA-approved (Geref) for pediatric growth failure and diagnostic assessment of pituitary somatotroph function. Discontinued commercially by original manufacturer for business reasons, but available via compounding pharmacies.",
    investigatedUses: [
      {
        conditionOrGoal: "Pediatric Growth Hormone Deficiency",
        evidenceLevel: "LEVEL_A",
        status: "Historically FDA Approved",
        summary: "Extensively studied in pediatric cohorts with growth failure due to endogenous GHRH deficiency, accelerating height velocity over 12 months.",
        sources: ["Prakash-1999-BioDrugs", "Gereff-FDA-Label"]
      },
      {
        conditionOrGoal: "Adult Anti-Aging, Vitality, and Sleep",
        evidenceLevel: "LEVEL_B",
        status: "Clinical Research in Healthy Older Adults",
        summary: "Small randomized clinical trials in healthy elderly men and women demonstrated modest increases in IGF-1, lean body mass, and subjective vigor over 16-24 weeks.",
        sources: ["Vittone-1997-ClinEndocrinol"]
      }
    ],
    claims: [
      {
        id: "serm-claim-1",
        claim: "Accelerates linear growth velocity in children with idiopathic GH deficiency",
        category: "benefit",
        evidenceLevel: "LEVEL_A",
        description: "Demonstrated in multicenter randomized clinical trials leading to historical FDA approval for pediatric GH deficiency.",
        population: "Pediatric GHD Patients",
        studyType: "Multicenter Clinical Trials",
        limitations: "Requires daily or twice-daily injections due to very short circulating half-life (10-12 mins).",
        confidence: "HIGH",
        sourceIds: ["Prakash-1999-BioDrugs"]
      },
      {
        id: "serm-claim-2",
        claim: "Modestly increases lean mass and improves sleep quality in aging adults",
        category: "benefit",
        evidenceLevel: "LEVEL_B",
        description: "Human studies in older adults show modest elevations in serum IGF-1 and minor improvements in body composition, with some evidence of enhanced slow-wave sleep.",
        population: "Older Adults (60-80 years)",
        studyType: "Randomized Controlled Trial",
        limitations: "Benefits are modest; does not reverse biological aging.",
        confidence: "MODERATE",
        sourceIds: ["Vittone-1997-ClinEndocrinol"]
      }
    ],
    clinicalEvidenceSummary: "Sermorelin has extensive human clinical validation dating back to the 1980s and 1990s. Because it preserves intact negative feedback via somatostatin, supraphysiological GH surges are minimized compared to exogenous recombinant human growth hormone (rhGH).",
    preclinicalEvidenceSummary: "Extensive receptor binding studies characterized the minimal 29-amino acid N-terminal sequence required for full biological potency on the GHRH receptor.",
    anecdotalSummary: "Commonly prescribed in integrative wellness and anti-aging clinics. Users report improved skin tone, deeper sleep, and better exercise recovery, though responses vary widely.",
    adverseEffects: [
      {
        effect: "Injection site pain, erythema, and swelling",
        type: "established",
        description: "Local cutaneous reactions reported in approximately 16% of patients.",
        evidenceLevel: "LEVEL_A",
        frequency: "Common",
        sourceIds: ["Prakash-1999-BioDrugs"]
      },
      {
        effect: "Flushing and facial warmth",
        type: "established",
        description: "Transient vasodilation immediately following subcutaneous injection.",
        evidenceLevel: "LEVEL_A",
        frequency: "Infrequent",
        sourceIds: ["Prakash-1999-BioDrugs"]
      },
      {
        effect: "Antibody formation against GHRH",
        type: "reported",
        description: "Low-titer anti-GHRH antibodies detected in clinical trials, rarely of clinical significance.",
        evidenceLevel: "LEVEL_A",
        frequency: "Infrequent"
      }
    ],
    contraindications: [
      "Active malignancy or intracranial lesions",
      "Hypersensitivity to sermorelin acetate"
    ],
    unknowns: [
      "Comparative long-term outcome data in healthy non-elderly adults"
    ],
    sources: [
      {
        id: "Prakash-1999-BioDrugs",
        title: "Sermorelin: A review of its use in the diagnosis and treatment of children with idiopathic growth hormone deficiency",
        authorsOrOrg: "Prakash A, Goa KL",
        journalOrPublisher: "BioDrugs",
        year: 1999,
        pmidOrDoi: "PMID: 18031154",
        url: "https://pubmed.ncbi.nlm.nih.gov/18031154/",
        evidenceLevel: "LEVEL_A",
        studyType: "Systematic Review"
      },
      {
        id: "Vittone-1997-ClinEndocrinol",
        title: "Effects of prolonged growth hormone-releasing hormone administration on body composition and functional status in healthy elderly men",
        authorsOrOrg: "Vittone J, Blackman MR, Busby-Whitehead J, et al.",
        journalOrPublisher: "Clinical Endocrinology",
        year: 1997,
        pmidOrDoi: "PMID: 9449942",
        url: "https://pubmed.ncbi.nlm.nih.gov/9449942/",
        evidenceLevel: "LEVEL_B",
        studyType: "RCT"
      }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: "tesamorelin",
    name: "Tesamorelin",
    commonNames: ["Egrifta", "TH9507"],
    category: "gh_secretagogues",
    classification: "Synthetic 44-Amino Acid Growth Hormone-Releasing Factor (GRF) Analog with Hexenoyl Moiety",
    molecularFormula: "C221H366N72O67S",
    halfLife: "Approx. 26 to 38 minutes (subcutaneous)",
    administrationRoutes: ["Subcutaneous Daily Injection"],
    mechanism: "Synthetic GHRH analog with a trans-3-hexenoic acid modification at the N-terminus conferring enzymatic stability. Binds pituitary GHRH receptors, stimulating pulsatile GH and IGF-1 secretion, leading to lipolysis specifically targeting visceral adipose tissue (VAT).",
    regulatoryStatus: "FDA Approved (Egrifta / Egrifta SV) specifically for the reduction of excess abdominal visceral fat in HIV-infected patients with lipodystrophy.",
    investigatedUses: [
      {
        conditionOrGoal: "Visceral Adiposity in HIV Lipodystrophy",
        evidenceLevel: "LEVEL_A",
        status: "FDA Approved Indication",
        summary: "Pivotal Phase 3 randomized, double-blind, placebo-controlled trials demonstrated an average 15-18% reduction in visceral adipose tissue measured by CT scanning.",
        sources: ["Falutz-2010-JAIDS", "Falutz-2007-NEJM"]
      },
      {
        conditionOrGoal: "Nonalcoholic Fatty Liver Disease (NAFLD / MASH)",
        evidenceLevel: "LEVEL_B",
        status: "Investigated in Phase 2 Human Trials",
        summary: "Demonstrated statistically significant reductions in hepatic fat fraction measured by MRI in patients with HIV-associated nonalcoholic steatohepatitis.",
        sources: ["Fourman-2020-LancetHIV"]
      },
      {
        conditionOrGoal: "Cosmetic Fat Loss in Healthy Bodybuilders",
        evidenceLevel: "LEVEL_D",
        status: "Anecdotal Off-Label Use",
        summary: "Employed off-label in bodybuilding for reducing deep visceral belly fat; however, it is not approved for general weight loss or cosmetic body shaping.",
        sources: []
      }
    ],
    claims: [
      {
        id: "tesa-claim-1",
        claim: "Clinically proven to significantly reduce excess visceral abdominal fat",
        category: "benefit",
        evidenceLevel: "LEVEL_A",
        description: "Demonstrated in rigorous Phase 3 multicenter RCTs published in NEJM and JAIDS, showing significant selective loss of visceral adipose tissue (VAT) without loss of subcutaneous fat.",
        population: "HIV-infected adults with lipodystrophy",
        studyType: "Phase 3 Randomized Controlled Trial",
        limitations: "VAT re-accumulates when therapy is discontinued; not approved or proven safe for general obesity or cosmetic fat loss.",
        confidence: "HIGH",
        sourceIds: ["Falutz-2007-NEJM", "Falutz-2010-JAIDS"]
      },
      {
        id: "tesa-claim-2",
        claim: "Provides sustained permanent reduction in overall body weight",
        category: "benefit",
        evidenceLevel: "LEVEL_E",
        description: "Clinical trials show that overall body weight is minimally changed because visceral fat loss is offset by modest lean mass increases; discontinuing treatment reverses the fat reduction.",
        population: "Clinical Trial Populations",
        studyType: "Clinical Follow-up Studies",
        limitations: "Factual evidence refutes permanent fat reduction; fat re-accumulates after cessation.",
        confidence: "HIGH",
        sourceIds: ["Falutz-2010-JAIDS"]
      }
    ],
    clinicalEvidenceSummary: "Tesamorelin represents the gold standard of clinical evidence among GHRH analogs, backed by large Phase 3 trials published in the New England Journal of Medicine. Unlike recombinant GH, it reduces visceral adiposity while rarely provoking severe glucose intolerance.",
    preclinicalEvidenceSummary: "Engineered with a trans-3-hexenoic acid hydrophobic tail that confers resistance to dipeptidyl peptidase-4 (DPP-4) cleavage while preserving nanomolar binding affinity for human GHRH receptors.",
    anecdotalSummary: "Popular in bodybuilding for targeting stubborn visceral fat around the abdomen, but cost and prescription requirements limit general accessibility.",
    adverseEffects: [
      {
        effect: "Arthralgia, joint stiffness, and peripheral edema",
        type: "established",
        description: "Joint pain and transient swelling observed in 10-13% of clinical trial participants.",
        evidenceLevel: "LEVEL_A",
        frequency: "Common",
        sourceIds: ["Falutz-2007-NEJM"]
      },
      {
        effect: "Injection site erythema, pruritus, and pain",
        type: "established",
        description: "Cutaneous reactions at the daily subcutaneous injection site (reported in ~24%).",
        evidenceLevel: "LEVEL_A",
        frequency: "Common",
        sourceIds: ["Falutz-2007-NEJM"]
      },
      {
        effect: "Elevation in fasting blood glucose and HbA1c",
        type: "established",
        description: "Increased risk of impaired glucose tolerance secondary to growth hormone activity.",
        evidenceLevel: "LEVEL_A",
        frequency: "Infrequent",
        sourceIds: ["Falutz-2010-JAIDS"]
      },
      {
        effect: "Carpal tunnel syndrome",
        type: "reported",
        description: "Compression neuropathy secondary to fluid retention.",
        evidenceLevel: "LEVEL_B",
        frequency: "Rare"
      }
    ],
    contraindications: [
      "Active malignancy or any active cancer",
      "Disruption of the hypothalamic-pituitary axis (e.g. pituitary surgery, hypophysectomy)",
      "Pregnancy (causes fetal harm in animal models)",
      "Known hypersensitivity to tesamorelin or mannitol"
    ],
    unknowns: [
      "Efficacy and long-term metabolic safety in non-HIV individuals seeking cosmetic fat reduction",
      "Cardiovascular endpoint reduction"
    ],
    sources: [
      {
        id: "Falutz-2007-NEJM",
        title: "Metabolic effects of a growth hormone-releasing factor in patients with HIV",
        authorsOrOrg: "Falutz J, Allas S, Blot-Chabaud M, et al.",
        journalOrPublisher: "New England Journal of Medicine (NEJM)",
        year: 2007,
        pmidOrDoi: "PMID: 18057338",
        url: "https://pubmed.ncbi.nlm.nih.gov/18057338/",
        evidenceLevel: "LEVEL_A",
        studyType: "Phase 3 RCT"
      },
      {
        id: "Falutz-2010-JAIDS",
        title: "Long-term safety and effects of tesamorelin, a growth hormone-releasing factor analogue, in HIV patients with abdominal fat accumulation",
        authorsOrOrg: "Falutz J, Potvin D, Mamputu JC, Assaad H, Zoltowska M, Michaud SE, et al.",
        journalOrPublisher: "Journal of Acquired Immune Deficiency Syndromes (JAIDS)",
        year: 2010,
        pmidOrDoi: "PMID: 20107409",
        url: "https://pubmed.ncbi.nlm.nih.gov/20107409/",
        evidenceLevel: "LEVEL_A",
        studyType: "Phase 3 RCT Extension"
      }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: "ghrp-6",
    name: "GHRP-6",
    commonNames: ["Growth Hormone Releasing Peptide 6", "SK&F 110679"],
    category: "gh_secretagogues",
    classification: "First-Generation Growth Hormone Secretagogue (Hexapeptide Ghrelin Mimetic)",
    molecularFormula: "C46H56N12O6",
    halfLife: "Approx. 20 minutes",
    administrationRoutes: ["Subcutaneous Injection"],
    mechanism: "Potent agonist of the ghrelin/growth hormone secretagogue receptor (GHS-R1a). Triggers rapid pituitary GH release while activating hypothalamic neuropeptide Y (NPY) and agouti-related protein (AgRP) neurons, inducing intense hunger.",
    regulatoryStatus: "Research Chemical Only. Never received FDA approval.",
    investigatedUses: [
      {
        conditionOrGoal: "Diagnostic Evaluation of Growth Hormone Secretion",
        evidenceLevel: "LEVEL_B",
        status: "Historical Clinical Research",
        summary: "Studied in the 1980s-1990s as a provocation test for pituitary GH reserve.",
        sources: ["Bowers-1984-Endocrinology"]
      },
      {
        conditionOrGoal: "Appetite Stimulation & Mass Gain in Cachexia",
        evidenceLevel: "LEVEL_C",
        status: "Preclinical and Animal Research",
        summary: "Strongly stimulates food intake and body weight gain in animal models of catabolic wasting.",
        sources: []
      },
      {
        conditionOrGoal: "Bodybuilding Bulking Cycles",
        evidenceLevel: "LEVEL_D",
        status: "Anecdotal Only",
        summary: "Used by athletes to force caloric intake during bulking phases due to extreme orexigenic (hunger-inducing) effects.",
        sources: []
      }
    ],
    claims: [
      {
        id: "ghrp6-claim-1",
        claim: "Triggers acute, massive spikes in appetite and hunger",
        category: "benefit",
        evidenceLevel: "LEVEL_B",
        description: "Clinical pharmacologic observations confirm profound orexigenic effect mediated through hypothalamic GHS-R1a ghrelin receptor stimulation within 15-30 minutes of administration.",
        population: "Human Volunteers & Animal Models",
        studyType: "Pharmacodynamic Studies",
        limitations: "Can cause uncontrolled hyperphagia and sudden cravings for carbohydrates.",
        confidence: "HIGH",
        sourceIds: ["Bowers-1984-Endocrinology"]
      },
      {
        id: "ghrp6-claim-2",
        claim: "Non-specifically elevates stress hormones like cortisol and prolactin",
        category: "adverse_effect",
        evidenceLevel: "LEVEL_A",
        description: "Unlike selective newer secretagogues, GHRP-6 induces notable non-specific elevations in serum prolactin and cortisol, particularly at higher doses.",
        population: "Human Volunteers",
        studyType: "Controlled Endocrine Profiling",
        limitations: "Can lead to mood swings, anxiety, and water retention.",
        confidence: "HIGH",
        sourceIds: ["Bowers-1984-Endocrinology"]
      }
    ],
    clinicalEvidenceSummary: "One of the earliest peptide secretagogues discovered by Cyril Bowers. While effective at producing acute GH release, its lack of selectivity (causing marked cortisol, prolactin, and appetite increases) caused it to be superseded by more selective agents like Ipamorelin.",
    preclinicalEvidenceSummary: "Extensive animal research established the existence of the orphan GHS-R1a receptor before ghrelin itself was biochemically isolated in 1999.",
    anecdotalSummary: 'Renowned in bodybuilding for triggering unbearable hunger ("the GHRP-6 munchies") within 20 minutes of injection. Users report rapid water weight gain.',
    adverseEffects: [
      {
        effect: "Intense sudden hunger (orexigenesis)",
        type: "established",
        description: "Profound ghrelin-mediated appetite stimulation.",
        evidenceLevel: "LEVEL_A",
        frequency: "Common"
      },
      {
        effect: "Elevated prolactin and cortisol",
        type: "established",
        description: "Non-specific hypothalamic-pituitary stimulation.",
        evidenceLevel: "LEVEL_A",
        frequency: "Common"
      },
      {
        effect: "Water retention and puffiness",
        type: "reported",
        description: "Subcutaneous extracellular fluid accumulation.",
        evidenceLevel: "LEVEL_B",
        frequency: "Common"
      }
    ],
    contraindications: [
      "Hyperprolactinemia or prolactinoma",
      "Active malignancy",
      "Uncontrolled type 2 diabetes or severe insulin resistance"
    ],
    unknowns: [
      "Long-term metabolic consequences of repeated ghrelin receptor super-agonist stimulation"
    ],
    sources: [
      {
        id: "Bowers-1984-Endocrinology",
        title: "On the actions of the growth hormone-releasing hexapeptide, GHRP-6",
        authorsOrOrg: "Bowers CY, Momany FA, Reynolds GA, Hong A",
        journalOrPublisher: "Endocrinology",
        year: 1984,
        pmidOrDoi: "PMID: 6368212",
        url: "https://pubmed.ncbi.nlm.nih.gov/6368212/",
        evidenceLevel: "LEVEL_B",
        studyType: "Endocrine Pharmacology"
      }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: "ghrp-2",
    name: "GHRP-2",
    commonNames: ["Pralmorelin", "KP-102", "GPA-748"],
    category: "gh_secretagogues",
    classification: "Second-Generation Growth Hormone Secretagogue (Synthetic Hexapeptide)",
    molecularFormula: "C45H55N9O6",
    halfLife: "Approx. 30 minutes",
    administrationRoutes: ["Subcutaneous Injection", "Intravenous Injection (diagnostic)"],
    mechanism: "Synthetic GHS-R1a agonist that stimulates pituitary GH release with greater potency than GHRP-6. Produces moderate appetite stimulation and modest increases in prolactin and cortisol.",
    regulatoryStatus: "Approved in Japan (Pralmorelin) as a diagnostic agent for growth hormone deficiency. Investigational/unapproved in the United States.",
    investigatedUses: [
      {
        conditionOrGoal: "Diagnostic Testing of Pituitary GH Reserve",
        evidenceLevel: "LEVEL_A",
        status: "Approved in Japan for Diagnostic Use",
        summary: "Extensively validated as a reliable, rapid diagnostic stimulus to measure peak pituitary GH reserve capacity.",
        sources: ["Chihara-1998-EndocrJ"]
      },
      {
        conditionOrGoal: "Muscle Protein Anabolism & Growth",
        evidenceLevel: "LEVEL_D",
        status: "Anecdotal Only",
        summary: "Utilized by fitness enthusiasts seeking greater GH output than Sermorelin with less severe hunger than GHRP-6.",
        sources: []
      }
    ],
    claims: [
      {
        id: "ghrp2-claim-1",
        claim: "Potent pituitary stimulation of growth hormone with cleaner hunger profile than GHRP-6",
        category: "benefit",
        evidenceLevel: "LEVEL_A",
        description: "Human clinical trials confirm higher molar potency for GH release than GHRP-6, while producing less pronounced orexigenesis (hunger).",
        population: "Adults with normal and deficient pituitary function",
        studyType: "Controlled Diagnostic Trials",
        limitations: "Still induces mild-to-moderate elevations in serum prolactin and cortisol.",
        confidence: "HIGH",
        sourceIds: ["Chihara-1998-EndocrJ"]
      }
    ],
    clinicalEvidenceSummary: "GHRP-2 is clinically utilized in Japan under the generic name Pralmorelin for provocative testing of GH secretion. Clinical trials established superior potency over GHRP-6 with lower rates of hyperphagia.",
    preclinicalEvidenceSummary: "In animal models, GHRP-2 increased food intake and weight gain, but with less pronounced hypothalamic AgRP upregulation than GHRP-6.",
    anecdotalSummary: "Commonly chosen by athletes wanting a stronger GH release than Ipamorelin who can tolerate mild hunger and cortisol elevations.",
    adverseEffects: [
      {
        effect: "Mild to moderate appetite stimulation",
        type: "established",
        description: "Noticeable hunger, though less acute than GHRP-6.",
        evidenceLevel: "LEVEL_A",
        frequency: "Common"
      },
      {
        effect: "Transient elevation in prolactin and ACTH/cortisol",
        type: "established",
        description: "Dose-dependent increase in stress hormones.",
        evidenceLevel: "LEVEL_A",
        frequency: "Common"
      },
      {
        effect: "Mild fluid retention and lethargy",
        type: "reported",
        description: "Transient morning tiredness and ankle edema.",
        evidenceLevel: "LEVEL_B",
        frequency: "Infrequent"
      }
    ],
    contraindications: [
      "Active tumor or cancer history",
      "Hyperprolactinemia"
    ],
    unknowns: [
      "Long-term safety profile when used continuously for months"
    ],
    sources: [
      {
        id: "Chihara-1998-EndocrJ",
        title: "Diagnostic efficacy of pralmorelin (GHRP-2) in children and adults with growth hormone deficiency",
        authorsOrOrg: "Chihara K, et al.",
        journalOrPublisher: "Endocrine Journal",
        year: 1998,
        pmidOrDoi: "PMID: 9845347",
        url: "https://pubmed.ncbi.nlm.nih.gov/9845347/",
        evidenceLevel: "LEVEL_A",
        studyType: "Clinical Diagnostic Study"
      }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: "hexarelin",
    name: "Hexarelin",
    commonNames: ["Examorelin", "EP-23959"],
    category: "gh_secretagogues",
    classification: "Hexapeptide Growth Hormone Secretagogue & CD36 Scavenger Receptor Agonist",
    molecularFormula: "C47H58N12O6",
    halfLife: "Approx. 55 to 70 minutes",
    administrationRoutes: ["Subcutaneous Injection", "Intravenous Injection"],
    mechanism: "Potent agonist of both GHS-R1a (triggering maximum GH secretion) and CD36 scavenger receptors on cardiac myocytes. Distinctively, chronic uninterrupted administration causes rapid down-regulation and pituitary receptor desensitization (tachyphylaxis).",
    regulatoryStatus: "Investigational / Research Chemical Only. Not FDA approved.",
    investigatedUses: [
      {
        conditionOrGoal: "Cardiac Ischemia-Reperfusion Protection & Left Ventricular Function",
        evidenceLevel: "LEVEL_B",
        status: "Investigated in Phase 1/2 Clinical Research",
        summary: "Clinical studies in human patients with severe coronary artery disease demonstrated that Hexarelin administration improved left ventricular ejection fraction and attenuated ischemic injury, likely via CD36 receptor binding in myocardium.",
        sources: ["Broglio-2002-EurJEndocrinol", "Ghigo-1996-JCEM"]
      },
      {
        conditionOrGoal: "Maximum Acute Growth Hormone Secretion",
        evidenceLevel: "LEVEL_A",
        status: "Demonstrated in Human Pharmacology",
        summary: "Elicits the highest acute peak GH elevation among hexapeptide secretagogues, but repeated dosing over several weeks causes marked tachyphylaxis.",
        sources: ["Ghigo-1996-JCEM"]
      }
    ],
    claims: [
      {
        id: "hex-claim-1",
        claim: "Produces the strongest acute GH release among peptide secretagogues",
        category: "benefit",
        evidenceLevel: "LEVEL_A",
        description: "Demonstrated in human clinical trials to elicit the highest peak GH levels of any peptide secretagogue.",
        population: "Healthy Adults and Hypopituitary Patients",
        studyType: "Controlled Human Pharmacology",
        limitations: "Continuous use leads to rapid pituitary desensitization and diminished GH output within 2 to 4 weeks.",
        confidence: "HIGH",
        sourceIds: ["Ghigo-1996-JCEM"]
      },
      {
        id: "hex-claim-2",
        claim: "Exerts cardioprotective actions independent of growth hormone via CD36 receptors",
        category: "mechanism",
        evidenceLevel: "LEVEL_B",
        description: "Preclinical models and early human coronary studies show CD36-mediated protection against ischemic cardiac stress.",
        population: "Cardiac Patients & In Vitro Myocytes",
        studyType: "Clinical & Preclinical Studies",
        limitations: "Not clinically approved for cardiovascular protection.",
        confidence: "MODERATE",
        sourceIds: ["Broglio-2002-EurJEndocrinol"]
      }
    ],
    clinicalEvidenceSummary: "Hexarelin is clinically notable for two reasons: (1) its acute GH release is the most potent of the hexapeptides, but tachyphylaxis occurs quickly with daily use; and (2) it binds to myocardial CD36 receptors with documented cardioprotective effects in ischemic human hearts.",
    preclinicalEvidenceSummary: "Rodent ischemia-reperfusion models demonstrated marked infarct size reduction and preserved left ventricular pressure following Hexarelin perfusion, effects absent in CD36-knockout models.",
    anecdotalSummary: "Used by experienced bodybuilders in short 2-week pulses or immediately before competitions due to high potency, though concerns over pituitary desensitization and prolactin/cortisol increases make it less suitable for long-term regimens.",
    adverseEffects: [
      {
        effect: "Pituitary desensitization (tachyphylaxis)",
        type: "established",
        description: "Diminishing GH response with repeated daily administration over 2-4 weeks.",
        evidenceLevel: "LEVEL_A",
        frequency: "Common",
        sourceIds: ["Ghigo-1996-JCEM"]
      },
      {
        effect: "Marked elevations in prolactin and cortisol",
        type: "established",
        description: "Substantial off-target pituitary and hypothalamic stimulation.",
        evidenceLevel: "LEVEL_A",
        frequency: "Common",
        sourceIds: ["Ghigo-1996-JCEM"]
      },
      {
        effect: "Facial flushing and sweating",
        type: "reported",
        description: "Transient autonomic response post-injection.",
        evidenceLevel: "LEVEL_B",
        frequency: "Infrequent"
      }
    ],
    contraindications: [
      "Active malignancy",
      "Elevated prolactin or history of prolactinoma",
      "Severe pituitary exhaustion"
    ],
    unknowns: [
      "Long-term consequences of CD36 myocardial receptor stimulation on lipid metabolism"
    ],
    sources: [
      {
        id: "Ghigo-1996-JCEM",
        title: "Endocrine and non-endocrine activities of hexarelin, a new synthetic growth hormone-releasing peptide, in humans",
        authorsOrOrg: "Ghigo E, et al.",
        journalOrPublisher: "Journal of Clinical Endocrinology & Metabolism (JCEM)",
        year: 1996,
        pmidOrDoi: "PMID: 8784088",
        url: "https://pubmed.ncbi.nlm.nih.gov/8784088/",
        evidenceLevel: "LEVEL_A",
        studyType: "Controlled Human Study"
      },
      {
        id: "Broglio-2002-EurJEndocrinol",
        title: "Non-endocrine actions of hexarelin: cardioprotective effects",
        authorsOrOrg: "Broglio E, et al.",
        journalOrPublisher: "European Journal of Endocrinology",
        year: 2002,
        pmidOrDoi: "PMID: 12431140",
        url: "https://pubmed.ncbi.nlm.nih.gov/12431140/",
        evidenceLevel: "LEVEL_B",
        studyType: "Review & Clinical Study"
      }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: "ibutamoren-mk677",
    name: "Ibutamoren (MK-677)",
    commonNames: ["MK-677", "L-163,191", "Nutrobal", "Oratrope"],
    category: "gh_secretagogues",
    classification: "Non-Peptide Small-Molecule Ghrelin Receptor (GHS-R1a) Agonist",
    molecularFormula: "C27H36N4O5S",
    halfLife: "Approx. 24 hours (sustained oral bioavailability)",
    administrationRoutes: ["Oral Administration (capsule / liquid solution)"],
    mechanism: "Potent, non-peptide oral agonist of the ghrelin/GHS-R1a receptor. Sustained binding stimulates pulsatile GH and increases serum IGF-1 continuously for 24+ hours while triggering hypothalamic appetite circuits.",
    regulatoryStatus: "Investigational Drug. Not FDA approved. Often mistakenly labeled a peptide or SARM, but is technically a non-peptide ghrelin mimetic.",
    investigatedUses: [
      {
        conditionOrGoal: "Reversing Diet-Induced Protein Catabolism",
        evidenceLevel: "LEVEL_A",
        status: "Demonstrated in Human RCTs",
        summary: "Double-blind, placebo-controlled human studies demonstrated that oral MK-677 restored positive nitrogen balance in healthy young men undergoing calorie restriction.",
        sources: ["Murphy-1998-JCEM"]
      },
      {
        conditionOrGoal: "Increasing Lean Mass & Bone Mineral Density in Elderly",
        evidenceLevel: "LEVEL_A",
        status: "Demonstrated in Multi-Month Human RCTs",
        summary: "A 2-year randomized, double-blind, placebo-controlled trial in healthy older adults showed a sustained 1.6 kg increase in fat-free mass and enhanced femoral bone density.",
        sources: ["Nass-2008-AnnInternMed"]
      },
      {
        conditionOrGoal: "Alzheimer Disease Progression",
        evidenceLevel: "LEVEL_A",
        status: "Phase 2 Clinical Trial Failed to Meet Endpoint",
        summary: "A randomized trial in mild-to-moderate Alzheimer disease patients showed MK-677 raised IGF-1 but did not slow clinical deterioration.",
        sources: ["Sevigny-2008-Neurology"]
      }
    ],
    claims: [
      {
        id: "mk-claim-1",
        claim: "Orally active agent that significantly raises serum IGF-1 and lean mass in humans",
        category: "benefit",
        evidenceLevel: "LEVEL_A",
        description: "Well-documented in multiple randomized controlled human clinical trials to maintain elevated serum GH and IGF-1 for 24 hours with once-daily oral dosing, increasing fat-free mass.",
        population: "Older adults and healthy volunteers",
        studyType: "Double-Blind Randomized Controlled Trials",
        limitations: "Increases in lean mass in early months include significant intracellular and extracellular water retention.",
        confidence: "HIGH",
        sourceIds: ["Nass-2008-AnnInternMed", "Murphy-1998-JCEM"]
      },
      {
        id: "mk-claim-2",
        claim: "Induces insulin resistance and elevated fasting glucose",
        category: "adverse_effect",
        evidenceLevel: "LEVEL_A",
        description: "Clinical trials consistently showed impaired glucose tolerance, elevated fasting blood sugar, and decreased insulin sensitivity over 12 to 24 months of daily use.",
        population: "Elderly human cohort",
        studyType: "Double-blind RCT",
        limitations: "Patients with pre-diabetes or diabetes are at heightened risk of metabolic deterioration.",
        confidence: "HIGH",
        sourceIds: ["Nass-2008-AnnInternMed"]
      }
    ],
    clinicalEvidenceSummary: "MK-677 has extensive peer-reviewed human clinical data from major pharmaceutical trials (Merck). While it clearly increases lean body mass and bone density, clinical trials were challenged by adverse metabolic side effects, specifically increased insulin resistance, water retention, and heart failure signals in a small subset of frail elderly patients.",
    preclinicalEvidenceSummary: "Canine and rodent studies established oral bioavailability approaching 60% with sustained 24-hour receptor occupancy.",
    anecdotalSummary: "Extremely popular in the bodybuilding and fitness space due to oral convenience. Users frequently report voracious appetite, vivid dreams, substantial water weight, but also morning lethargy and numbness in extremities.",
    adverseEffects: [
      {
        effect: "Elevated fasting blood glucose and insulin resistance",
        type: "established",
        description: "Impaired insulin sensitivity documented in clinical RCTs.",
        evidenceLevel: "LEVEL_A",
        frequency: "Common",
        sourceIds: ["Nass-2008-AnnInternMed"]
      },
      {
        effect: "Increased appetite (hyperphagia)",
        type: "established",
        description: "Direct orexigenic effect from central ghrelin receptor stimulation.",
        evidenceLevel: "LEVEL_A",
        frequency: "Common",
        sourceIds: ["Murphy-1998-JCEM"]
      },
      {
        effect: "Lower extremity edema and fluid retention",
        type: "established",
        description: "Peripheral swelling, carpal tunnel symptoms, and joint tightness.",
        evidenceLevel: "LEVEL_A",
        frequency: "Common",
        sourceIds: ["Nass-2008-AnnInternMed"]
      },
      {
        effect: "Lethargy, fatigue, and muscle cramps",
        type: "reported",
        description: "Excessive daytime sleepiness and electrolyte imbalances.",
        evidenceLevel: "LEVEL_B",
        frequency: "Infrequent"
      }
    ],
    contraindications: [
      "Congestive heart failure or severe cardiovascular disease",
      "Diabetes mellitus or impaired fasting glucose",
      "Active malignancy or cancer history",
      "Known hypersensitivity"
    ],
    unknowns: [
      "Long-term oncological and cardiovascular risk profile with multi-year unsupervised administration"
    ],
    sources: [
      {
        id: "Nass-2008-AnnInternMed",
        title: "Effects of an oral ghrelin mimetic on body composition and clinical outcomes in healthy older adults: a randomized trial",
        authorsOrOrg: "Nass R, Pezzoli SS, Oliveri MC, et al.",
        journalOrPublisher: "Annals of Internal Medicine",
        year: 2008,
        pmidOrDoi: "PMID: 18981485",
        url: "https://pubmed.ncbi.nlm.nih.gov/18981485/",
        evidenceLevel: "LEVEL_A",
        studyType: "Double-Blind RCT"
      },
      {
        id: "Murphy-1998-JCEM",
        title: "MK-677, an orally active growth hormone secretagogue, reverses diet-induced catabolism",
        authorsOrOrg: "Murphy MG, et al.",
        journalOrPublisher: "Journal of Clinical Endocrinology & Metabolism (JCEM)",
        year: 1998,
        pmidOrDoi: "PMID: 9467534",
        url: "https://pubmed.ncbi.nlm.nih.gov/9467534/",
        evidenceLevel: "LEVEL_A",
        studyType: "Double-Blind RCT"
      }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: "examorelin",
    name: "Examorelin",
    commonNames: ["Hexarelin derivative", "EP-23959 analog"],
    category: "gh_secretagogues",
    classification: "Hexapeptide Growth Hormone Secretagogue Analog",
    molecularFormula: "C47H58N12O6",
    halfLife: "Approx. 1 hour",
    administrationRoutes: ["Subcutaneous Injection", "Intravenous Injection"],
    mechanism: "Acts via dual signaling pathways: GHS-R1a on pituitary somatotrophs for GH release, and peripheral CD36 receptors on vascular and myocardial endothelial cells.",
    regulatoryStatus: "Research Chemical / Investigational Agent Only. Not FDA approved.",
    investigatedUses: [
      {
        conditionOrGoal: "Myocardial Protection & Growth Hormone Secretion",
        evidenceLevel: "LEVEL_B",
        status: "Early Clinical & Preclinical Investigation",
        summary: "Evaluated primarily in specialized endocrine and cardiovascular studies exploring non-GH myocardial cytoprotective effects and diagnostic GH stimulation.",
        sources: ["Broglio-2002-EurJEndocrinol"]
      }
    ],
    claims: [
      {
        id: "exa-claim-1",
        claim: "Provides potent growth hormone stimulation alongside cardiac tissue support",
        category: "benefit",
        evidenceLevel: "LEVEL_B",
        description: "Demonstrated in academic endocrine research to trigger strong GH release while activating CD36 receptors in cardiac tissue.",
        population: "Human & Animal Models",
        studyType: "Clinical Investigation",
        limitations: "Receptor desensitization occurs with continuous use; long-term clinical trials are absent.",
        confidence: "MODERATE",
        sourceIds: ["Broglio-2002-EurJEndocrinol"]
      }
    ],
    clinicalEvidenceSummary: "Examorelin (closely associated with the Hexarelin nomenclature) has been evaluated in early human pharmacology for both GH stimulation and cardiovascular safety in patients with heart disease.",
    preclinicalEvidenceSummary: "Protects isolated rat hearts from post-ischemic dysfunction and diminishes cardiomyocyte apoptosis in hypoxia models.",
    anecdotalSummary: "Rarely used outside specialized bodybuilding protocols; closely mimics Hexarelin in user experiences.",
    adverseEffects: [
      {
        effect: "Pituitary desensitization",
        type: "established",
        description: "Tachyphylaxis after 2-3 weeks of daily use.",
        evidenceLevel: "LEVEL_B",
        frequency: "Common"
      },
      {
        effect: "Elevated prolactin and cortisol",
        type: "established",
        description: "Non-selective endocrine stimulation.",
        evidenceLevel: "LEVEL_B",
        frequency: "Common"
      }
    ],
    contraindications: ["Active malignancy", "Severe uncontrolled cardiovascular instability"],
    unknowns: ["Optimal dosing protocols and safety beyond short experimental windows"],
    sources: [
      {
        id: "Broglio-2002-EurJEndocrinol",
        title: "Non-endocrine actions of hexarelin: cardioprotective effects",
        authorsOrOrg: "Broglio E, et al.",
        journalOrPublisher: "European Journal of Endocrinology",
        year: 2002,
        pmidOrDoi: "PMID: 12431140",
        url: "https://pubmed.ncbi.nlm.nih.gov/12431140/",
        evidenceLevel: "LEVEL_B",
        studyType: "Review & Clinical Study"
      }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // HEALING, REPAIR, AND ANTI-INFLAMMATORY PEPTIDES
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: "bpc-157",
    name: "BPC-157",
    commonNames: ["Body Protection Compound 157", "PL 14736", "PL-10", "Bepecin", "Pentadecapeptide"],
    category: "healing_repair",
    classification: "Synthetic 15-Amino Acid Gastric Pentadecapeptide Fragment",
    molecularFormula: "C62H98N16O22",
    halfLife: "Estimated under 4 hours (rapidly processed; stable in gastric juice)",
    administrationRoutes: ["Subcutaneous Injection", "Intramuscular Injection (near injury)", "Oral (stable in gastric acid)"],
    mechanism: "Derived from a sequence in human gastric juice. Preclinical studies suggest it upregulates Vascular Endothelial Growth Factor Receptor 2 (VEGFR2), activates the FAK-paxillin pathway for cell migration, modulates nitric oxide (NO) synthesis, and promotes collagen type I synthesis.",
    regulatoryStatus: "Research Chemical / Unapproved New Drug. Not FDA approved. Prohibited by the World Anti-Doping Agency (WADA) under category S0 (Unapproved Substances). Included on the FDA Category 2 Bulks list restricting compounding.",
    investigatedUses: [
      {
        conditionOrGoal: "Tendon, Ligament, and Muscle Healing",
        evidenceLevel: "LEVEL_C",
        status: "Preclinical Animal Models Only",
        summary: "Demonstrated accelerated healing of transected Achilles tendons, medial collateral ligaments, and quadriceps muscle tears in rat and rodent models.",
        sources: ["Sikiric-2010-CurrPharmDes", "Chang-2011-JOrthopRes", "Gwyer-2019-CellTissueRes"]
      },
      {
        conditionOrGoal: "Gastrointestinal Healing (Ulcers, Colitis, Fistulas)",
        evidenceLevel: "LEVEL_C",
        status: "Preclinical Animal Models & Preliminary Trials",
        summary: "Extensive preclinical rodent evidence for healing NSAID-induced gastric ulcers, inflammatory bowel disease, and intestinal anastomoses. Limited preliminary early human safety trials for inflammatory bowel disease were reported in Europe without conclusive published Phase 3 RCTs.",
        sources: ["Sikiric-2020-FrontPharmacol"]
      },
      {
        conditionOrGoal: "Rapid Recovery from Sports Injuries in Humans",
        evidenceLevel: "LEVEL_D",
        status: "Anecdotal Only",
        summary: "Massively popular among athletes, bodybuilders, and fitness communities who report dramatic improvements in joint pain, tendonitis, and muscle tears. However, rigorous randomized double-blind clinical trials in human athletic populations do not exist.",
        sources: []
      }
    ],
    claims: [
      {
        id: "bpc-claim-1",
        claim: "Promotes angiogenesis and tissue repair in animal models of tendon and muscle injury",
        category: "benefit",
        evidenceLevel: "LEVEL_C",
        description: "Demonstrated in numerous peer-reviewed rodent and in vitro studies to upregulate VEGFR2 and accelerate Achilles tendon and muscle regeneration in animal models.",
        population: "Rodent Models (Rats, Mice) and In Vitro Tenocytes",
        studyType: "Preclinical Animal Studies",
        limitations: "Animal model findings do not establish human clinical efficacy, optimal dosage, or safety.",
        confidence: "HIGH",
        sourceIds: ["Sikiric-2010-CurrPharmDes", "Chang-2011-JOrthopRes"]
      },
      {
        id: "bpc-claim-2",
        claim: "Clinically proven to heal human joint injuries, rotator cuff tears, and tendonitis",
        category: "benefit",
        evidenceLevel: "LEVEL_D",
        description: "Widely claimed online and by alternative wellness practitioners to rapidly heal human tears and chronic injuries. While widely reported anecdotally, robust human clinical trials are lacking.",
        population: "Athletes & Fitness Community",
        studyType: "Anecdotal / Online User Reports",
        limitations: "Human evidence is anecdotal. No large-scale placebo-controlled human trials have established efficacy or safety in athletes.",
        confidence: "LOW",
        sourceIds: []
      },
      {
        id: "bpc-claim-3",
        claim: "Cures Crohn disease and ulcerative colitis in humans",
        category: "benefit",
        evidenceLevel: "LEVEL_E",
        description: "Scientific evidence in humans is insufficient to validate BPC-157 as an established medical treatment for inflammatory bowel disease.",
        population: "Clinical Cohorts",
        studyType: "Insufficient Evidence",
        limitations: "Early exploratory trials in Europe were never expanded into full Phase 3 regulatory trials.",
        confidence: "HIGH",
        sourceIds: ["Sikiric-2020-FrontPharmacol"]
      }
    ],
    clinicalEvidenceSummary: "Despite widespread popularity on the internet and in sports communities, BPC-157 does not possess published Phase 2/3 randomized controlled human trials. Almost all published academic literature originates from a single primary research group in Croatia (Sikiric et al.), evaluating animal models of gastric injury, vascular occlusion, and tendon transection. The FDA has raised safety concerns regarding biological compounding due to the absence of human safety data.",
    preclinicalEvidenceSummary: "In rodents, BPC-157 demonstrates notable cytoprotective and angiogenic properties. It accelerates the outgrowth of tendon fibroblasts, stimulates early expression of early growth response gene 1 (egr-1), and preserves vascular integrity during severe ischemia and toxic insult.",
    anecdotalSummary: 'Commonly regarded in fitness and biohacking communities as the premier "healing peptide." Users typically administer 250-500 mcg subcutaneously near the injured tendon or joint and report noticeable reductions in pain and recovery time within 2 to 4 weeks. Placebo effects and concurrent rehabilitation cannot be excluded.',
    adverseEffects: [
      {
        effect: "Injection site pain, bruising, and redness",
        type: "reported",
        description: "Local skin irritation from subcutaneous administration.",
        evidenceLevel: "LEVEL_B",
        frequency: "Common"
      },
      {
        effect: "Gastrointestinal upset, nausea, or dizziness",
        type: "anecdotal",
        description: "Self-reported by users in online forums.",
        evidenceLevel: "LEVEL_D",
        frequency: "Infrequent"
      },
      {
        effect: "Theoretical pro-angiogenic tumor acceleration risk",
        type: "unknown",
        description: "Because BPC-157 upregulates VEGFR2 and stimulates blood vessel formation, theoretical concerns exist regarding potential promotion of existing occult tumors, though direct oncogenesis has not been demonstrated.",
        evidenceLevel: "LEVEL_C",
        frequency: "Unknown"
      }
    ],
    contraindications: [
      "Active cancer or history of malignancy (due to potent angiogenic mechanisms)",
      "Competitive athletes subject to WADA anti-doping testing (prohibited under Section S0)",
      "Pregnancy and breastfeeding"
    ],
    unknowns: [
      "Human pharmacokinetics, definitive bioavailability, and human metabolic fate",
      "Long-term human safety, immune response, and potential for unmonitored tissue neo-vascularization"
    ],
    sources: [
      {
        id: "Sikiric-2010-CurrPharmDes",
        title: "Toxicity by NSAIDs. Counteraction by stable gastric pentadecapeptide BPC 157",
        authorsOrOrg: "Sikiric P, Seiwerth S, Rucman R, et al.",
        journalOrPublisher: "Current Pharmaceutical Design",
        year: 2010,
        pmidOrDoi: "PMID: 20388099",
        url: "https://pubmed.ncbi.nlm.nih.gov/20388099/",
        evidenceLevel: "LEVEL_C",
        studyType: "Preclinical Animal Review"
      },
      {
        id: "Chang-2011-JOrthopRes",
        title: "The promoting effect of pentadecapeptide BPC 157 on tendon healing involves tendon outgrowth, cell survival, and cell migration",
        authorsOrOrg: "Chang CH, Tsai WC, Hsu YH, Pang JH",
        journalOrPublisher: "Journal of Orthopaedic Research",
        year: 2011,
        pmidOrDoi: "PMID: 21031409",
        url: "https://pubmed.ncbi.nlm.nih.gov/21031409/",
        evidenceLevel: "LEVEL_C",
        studyType: "Preclinical Tendon Study"
      },
      {
        id: "Gwyer-2019-CellTissueRes",
        title: "Gastric pentadecapeptide body protection compound BPC 157 and its role in accelerating musculoskeletal soft tissue healing",
        authorsOrOrg: "Gwyer D, Wragg NM, Wilson SL",
        journalOrPublisher: "Cell and Tissue Research",
        year: 2019,
        pmidOrDoi: "PMID: 31463949",
        url: "https://pubmed.ncbi.nlm.nih.gov/31463949/",
        evidenceLevel: "LEVEL_C",
        studyType: "Systematic Review of Preclinical Evidence"
      },
      {
        id: "Sikiric-2020-FrontPharmacol",
        title: "Stable Gastric Pentadecapeptide BPC 157: Novel Therapy in Gastrointestinal Tract",
        authorsOrOrg: "Sikiric P, et al.",
        journalOrPublisher: "Frontiers in Pharmacology",
        year: 2020,
        pmidOrDoi: "PMID: 33192478",
        url: "https://pubmed.ncbi.nlm.nih.gov/33192478/",
        evidenceLevel: "LEVEL_C",
        studyType: "Preclinical Review"
      }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: "tb-500",
    name: "TB-500",
    commonNames: ["Thymosin Beta-4 fragment", "Ac-LKKTETQ", "Synthetic T\u03B24"],
    category: "healing_repair",
    classification: "Synthetic Peptide Fragment of Naturally Occurring Thymosin Beta-4 (Actin-Sequestering Protein)",
    molecularFormula: "C38H65N11O14",
    halfLife: "Approx. 2 hours in circulation (tissue persistence varies)",
    administrationRoutes: ["Subcutaneous Injection", "Systemic Intramuscular Injection"],
    mechanism: "Derived from the active G-actin-binding domain of the 43-amino acid protein Thymosin Beta-4. Regulates actin filament polymerization, promotes endothelial cell migration, downregulates pro-inflammatory cytokines (TNF-alpha, IL-6), and stimulates tissue remodeling.",
    regulatoryStatus: "Research Chemical / Unapproved Substance. Not FDA approved for human use. Prohibited by WADA under Section S2 (Peptide Hormones, Growth Factors and Related Substances).",
    investigatedUses: [
      {
        conditionOrGoal: "Corneal Wound Healing & Dry Eye Syndrome (Full T\u03B24 / RGN-259)",
        evidenceLevel: "LEVEL_B",
        status: "Clinical Trials Conducted with Full T\u03B24 (RGN-259 Eye Drops)",
        summary: "Full-length Thymosin Beta-4 has been studied in Phase 2/3 human clinical ophthalmic trials for neurotrophic keratitis and dry eye, showing accelerated epithelial defect closure.",
        sources: ["Sosne-2015-Cornea"]
      },
      {
        conditionOrGoal: "Cardiac Muscle Healing Post-Myocardial Infarction",
        evidenceLevel: "LEVEL_C",
        status: "Preclinical Animal Research",
        summary: "Animal models demonstrated activation of epicardial progenitor cells, promotion of neo-vascularization, and reduction of scar formation following myocardial infarction.",
        sources: ["Bock-Marquette-2004-Nature"]
      },
      {
        conditionOrGoal: "Accelerated Musculoskeletal Repair in Athletes",
        evidenceLevel: "LEVEL_D",
        status: "Anecdotal Only",
        summary: "Widely used in racehorses and human athletic communities to treat muscle strains, tendonitis, and ligament damage; human systemic clinical trials in athletes are nonexistent.",
        sources: []
      }
    ],
    claims: [
      {
        id: "tb-claim-1",
        claim: "Accelerates cell migration and wound repair via actin regulation in preclinical models",
        category: "mechanism",
        evidenceLevel: "LEVEL_C",
        description: "Extensive in vitro and animal studies confirm that the LKKTETQ domain binds globular actin, promoting rapid keratinocyte and endothelial migration to injury sites.",
        population: "Animal models and in vitro cellular cultures",
        studyType: "Preclinical Laboratory Research",
        limitations: "Preclinical cell migration models do not prove systemic muscle or tendon repair in humans.",
        confidence: "HIGH",
        sourceIds: ["Bock-Marquette-2004-Nature"]
      },
      {
        id: "tb-claim-2",
        claim: "Clinically proven systemic cure for chronic tendon tears in athletes",
        category: "benefit",
        evidenceLevel: "LEVEL_D",
        description: 'Widely touted in fitness forums as an indispensable healing compound, often combined with BPC-157 as the "Wolverine Stack." Human clinical evidence for systemic orthopedic healing is lacking.',
        population: "Athletic Communities",
        studyType: "Anecdotal Reports",
        limitations: "Lacks randomized controlled clinical trials in humans.",
        confidence: "LOW",
        sourceIds: []
      }
    ],
    clinicalEvidenceSummary: "Clinical data exist primarily for full-length Thymosin Beta-4 (T\u03B24) in topical ophthalmic formulations (RGN-259) and topical dermal wound gels for stasis ulcers. Systemic human injection of the synthetic fragment TB-500 has never undergone rigorous Phase 2/3 clinical testing.",
    preclinicalEvidenceSummary: "Seminal research published in Nature demonstrated that T\u03B24 treatment promotes cardiomyocyte survival and neo-vascularization after coronary artery ligation in mice.",
    anecdotalSummary: "Commonly injected by bodybuilders and athletes (e.g. 2-5 mg per week) for widespread systemic healing of multiple injuries. Often stacked with BPC-157. Some users report temporary head rushes or fatigue post-injection.",
    adverseEffects: [
      {
        effect: "Transient lethargy and lightheadedness",
        type: "reported",
        description: "Temporary tiredness reported within an hour of injection.",
        evidenceLevel: "LEVEL_B",
        frequency: "Infrequent"
      },
      {
        effect: "Injection site redness or burning",
        type: "established",
        description: "Local cutaneous discomfort.",
        evidenceLevel: "LEVEL_A",
        frequency: "Common"
      },
      {
        effect: "Theoretical tumor angiogenesis risk",
        type: "unknown",
        description: "Because T\u03B24 promotes vascular endothelial cell migration, there is theoretical concern regarding tumor vascularization in preexisting malignancies.",
        evidenceLevel: "LEVEL_C",
        frequency: "Unknown"
      }
    ],
    contraindications: [
      "Active cancer or history of malignancy",
      "Athletes subject to WADA drug testing (strict liability anti-doping violation)"
    ],
    unknowns: [
      "Bioequivalence between commercial TB-500 fragment and full-length natural Thymosin Beta-4",
      "Long-term systemic safety in healthy humans"
    ],
    sources: [
      {
        id: "Bock-Marquette-2004-Nature",
        title: "Thymosin beta4 activates integrin-linked kinase and promotes cardiac cell migration, survival and cardiac repair",
        authorsOrOrg: "Bock-Marquette I, Saxena A, White MD, DiMaio JM, Srivastava D",
        journalOrPublisher: "Nature",
        year: 2004,
        pmidOrDoi: "PMID: 15549107",
        url: "https://pubmed.ncbi.nlm.nih.gov/15549107/",
        evidenceLevel: "LEVEL_C",
        studyType: "Preclinical Study"
      },
      {
        id: "Sosne-2015-Cornea",
        title: "Thymosin beta 4: a novel potential treatment for dry eye",
        authorsOrOrg: "Sosne G, Dunn SP, Kim C",
        journalOrPublisher: "Cornea",
        year: 2015,
        pmidOrDoi: "PMID: 26356686",
        url: "https://pubmed.ncbi.nlm.nih.gov/26356686/",
        evidenceLevel: "LEVEL_B",
        studyType: "Clinical Trial"
      }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: "ghk-cu",
    name: "GHK-Cu",
    commonNames: ["Copper Peptide", "Gly-His-Lys Copper", "Prezatide Copper", "Copper Tripeptide-1"],
    category: "healing_repair",
    classification: "Endogenous Human Plasma Copper-Binding Tripeptide",
    molecularFormula: "C14H24CuN6O4",
    halfLife: "Approx. 0.5 to 1 hour in human plasma",
    administrationRoutes: ["Topical Serum / Cream", "Subcutaneous Injection", "Microneedling Solution"],
    mechanism: "Naturally present in human plasma, saliva, and urine (declining with age). Has high affinity for Cu2+ ions. Modulates gene expression for collagen types I and III, elastin, glycosaminoglycans, and metalloproteinases; downregulates TGF-beta; exerts potent antioxidant and anti-inflammatory effects.",
    regulatoryStatus: "Cosmetic Ingredient / Research Chemical. Cosmetic formulations are widely marketed globally. Injectable formulations are unapproved drugs.",
    investigatedUses: [
      {
        conditionOrGoal: "Skin Rejuvenation, Collagen Synthesis & Elasticity",
        evidenceLevel: "LEVEL_A",
        status: "Supported by Controlled Human Dermatological Trials",
        summary: "Multiple double-blind, placebo-controlled human cosmetic trials demonstrate increased skin density, thickness, reduced wrinkle depth, and enhanced collagen production over 12 weeks.",
        sources: ["Pickart-2015-BioMedResInt", "Finkley-2005-CosmetDermatol"]
      },
      {
        conditionOrGoal: "Wound Healing and Post-Surgical Tissue Repair",
        evidenceLevel: "LEVEL_B",
        status: "Investigated in Clinical Trials (Iamin Gel)",
        summary: "Studied in human clinical trials for diabetic foot ulcers and ischemic wounds, demonstrating accelerated wound closure and granulation tissue formation.",
        sources: ["Mulder-1994-WoundRepairRegen"]
      },
      {
        conditionOrGoal: "Hair Follicle Stimulation & Androgenetic Alopecia",
        evidenceLevel: "LEVEL_B",
        status: "Limited Human & In Vitro Studies",
        summary: "Shown to enlarge hair follicle size and stimulate dermal papilla cell proliferation in laboratory and small clinical evaluations.",
        sources: ["Pyo-2007-BiolPharmBull"]
      },
      {
        conditionOrGoal: "Injectable Systemic Anti-Aging & Organ Remodeling",
        evidenceLevel: "LEVEL_D",
        status: "Anecdotal Use in Biohacking Community",
        summary: "Subcutaneous injections used by biohackers seeking systemic organ rejuvenation and broad anti-inflammatory effects; systemic injectable clinical efficacy remains unproven.",
        sources: []
      }
    ],
    claims: [
      {
        id: "ghk-claim-1",
        claim: "Improves skin firmness, elasticity, and stimulates collagen synthesis",
        category: "benefit",
        evidenceLevel: "LEVEL_A",
        description: "Demonstrated in numerous peer-reviewed, double-blind human dermatological trials comparing topical GHK-Cu against placebo and vitamin C.",
        population: "Adult human cosmetic cohorts",
        studyType: "Double-blind Randomized Controlled Trials",
        limitations: "Evidence applies specifically to topical dermatological applications; does not validate systemic injectable anti-aging claims.",
        confidence: "HIGH",
        sourceIds: ["Pickart-2015-BioMedResInt", "Finkley-2005-CosmetDermatol"]
      },
      {
        id: "ghk-claim-2",
        claim: "Subcutaneous injection reverses whole-body aging and resets human gene expression",
        category: "benefit",
        evidenceLevel: "LEVEL_D",
        description: "While Broad Institute Connectivity Map data show in vitro gene modulation, clinical trials demonstrating systemic rejuvenation from injections in healthy adults are lacking.",
        population: "Biohacking & Wellness Community",
        studyType: "Anecdotal & In Vitro Hypothesis",
        limitations: "In vitro gene expression profiles do not translate directly into demonstrated human systemic longevity.",
        confidence: "LOW",
        sourceIds: []
      }
    ],
    clinicalEvidenceSummary: "GHK-Cu was discovered in 1973 by Dr. Loren Pickart in human plasma. It possesses robust clinical trial data for topical dermatological applications (improving collagen, reducing fine lines, improving elasticity) and surgical wound repair (Iamin gel). In contrast, subcutaneous injection protocols are popular in biohacking but lack clinical trial verification.",
    preclinicalEvidenceSummary: "Extensive transcriptomic studies reveal that GHK-Cu modulates the expression of over 4,000 human genes, upregulating antioxidant enzymes (superoxide dismutase) and DNA repair pathways while suppressing pro-inflammatory and fibrotic cascades.",
    anecdotalSummary: 'Injectable GHK-Cu is notorious in online forums for causing significant post-injection pain, burning, and local subcutaneous nodules ("sting"). Many users dilute it with BPC-157 to mitigate injection site discomfort.',
    adverseEffects: [
      {
        effect: "Severe local injection site stinging, pain, and induration",
        type: "established",
        description: "Marked cutaneous burning and subcutaneous tender lumps following subcutaneous injection.",
        evidenceLevel: "LEVEL_A",
        frequency: "Common"
      },
      {
        effect: "Contact dermatitis and skin irritation from topical formulations",
        type: "established",
        description: "Mild rash or itching in individuals sensitive to copper compounds.",
        evidenceLevel: "LEVEL_A",
        frequency: "Infrequent"
      },
      {
        effect: "Hypotension (transient blood pressure drop)",
        type: "reported",
        description: "Observed occasionally with high-dose intravenous or systemic administration due to nitric oxide stimulation.",
        evidenceLevel: "LEVEL_B",
        frequency: "Rare"
      }
    ],
    contraindications: [
      "Wilson disease or disorders of copper metabolism/storage",
      "Known hypersensitivity to copper peptides"
    ],
    unknowns: [
      "Systemic copper accumulation risk with prolonged high-dose subcutaneous injection protocols"
    ],
    sources: [
      {
        id: "Pickart-2015-BioMedResInt",
        title: "GHK Peptide as a Natural Modulator of Multiple Cellular Pathways in Skin Regeneration",
        authorsOrOrg: "Pickart L, Vasquez-Soltero JM, Margolina A",
        journalOrPublisher: "BioMed Research International",
        year: 2015,
        pmidOrDoi: "PMID: 26236730",
        url: "https://pubmed.ncbi.nlm.nih.gov/26236730/",
        evidenceLevel: "LEVEL_A",
        studyType: "Systematic Review of Clinical & Preclinical Data"
      },
      {
        id: "Finkley-2005-CosmetDermatol",
        title: "Copper Peptide and Skin Care: A Review of Clinical Trials",
        authorsOrOrg: "Finkley MB, Appa Y, Bhandarkar S",
        journalOrPublisher: "Cosmetic Dermatology",
        year: 2005,
        pmidOrDoi: "",
        evidenceLevel: "LEVEL_A",
        studyType: "Clinical Dermatological Trials Review"
      }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: "kpv",
    name: "KPV",
    commonNames: ["Lys-Pro-Val", "alpha-MSH (11-13) Fragment"],
    category: "healing_repair",
    classification: "Synthetic C-Terminal Tripeptide Fragment of Alpha-Melanocyte-Stimulating Hormone",
    molecularFormula: "C16H30N4O4",
    halfLife: "Approx. 1 to 2 hours",
    administrationRoutes: ["Oral (enteric capsule)", "Subcutaneous Injection", "Topical Spray / Cream"],
    mechanism: "Represents the active anti-inflammatory tripeptide sequence of alpha-MSH. Enters cells and translocates to the nucleus to inhibit NF-kB activation, decreasing inflammatory cytokine production (TNF-alpha, IL-1beta, IL-6) without inducing skin pigmentation (lacks melanocortin-1 receptor melanogenic activity).",
    regulatoryStatus: "Research Chemical / Unapproved New Drug. Not FDA approved.",
    investigatedUses: [
      {
        conditionOrGoal: "Intestinal Inflammation & Inflammatory Bowel Disease (IBD)",
        evidenceLevel: "LEVEL_C",
        status: "Preclinical Animal Colitis Models",
        summary: "Demonstrated significant reductions in mucosal inflammation, histological damage scores, and leukocyte infiltration in dextran sulfate sodium (DSS)-induced colitis in mice.",
        sources: ["Kannengiesser-2008-InflammBowelDis", "Dalmasso-2008-Gastroenterology"]
      },
      {
        conditionOrGoal: "Antimicrobial Actions Against Candida and S. aureus",
        evidenceLevel: "LEVEL_C",
        status: "In Vitro Laboratory Testing",
        summary: "Exhibited direct antimicrobial and anti-fungal inhibition against Candida albicans and Staphylococcus aureus in vitro.",
        sources: ["Catania-2006-AnnNYAcadSci"]
      },
      {
        conditionOrGoal: "Mast Cell Activation Syndrome (MCAS) and Systemic Inflammation",
        evidenceLevel: "LEVEL_D",
        status: "Anecdotal Use in Functional Medicine",
        summary: "Employed by integrative medicine practitioners and autoimmune patients for mast cell stabilization and gut inflammation; lacks formal human clinical trials.",
        sources: []
      }
    ],
    claims: [
      {
        id: "kpv-claim-1",
        claim: "Suppresses NF-kB activation and mucosal inflammation in preclinical models",
        category: "mechanism",
        evidenceLevel: "LEVEL_C",
        description: "Preclinical animal and cell studies confirm potent inhibition of NF-kB nuclear translocation, blunting inflammatory bowel cascades.",
        population: "Rodent Models of Colitis and In Vitro Epithelial Cells",
        studyType: "Preclinical Research",
        limitations: "Does not establish efficacy in human Crohn disease or ulcerative colitis.",
        confidence: "HIGH",
        sourceIds: ["Kannengiesser-2008-InflammBowelDis"]
      },
      {
        id: "kpv-claim-2",
        claim: "Clinically proven cure for human mast cell activation syndrome (MCAS) and Lyme disease",
        category: "benefit",
        evidenceLevel: "LEVEL_D",
        description: "Anecdotally advocated in autoimmune and functional medicine circles, but completely unproven in controlled human clinical trials.",
        population: "Online Patient Communities",
        studyType: "Anecdotal",
        limitations: "No human clinical trial data exist for MCAS or Lyme disease.",
        confidence: "LOW",
        sourceIds: []
      }
    ],
    clinicalEvidenceSummary: "There are currently no published Phase 2 or Phase 3 human clinical trials establishing the efficacy or safety of KPV for any medical condition. Scientific support rests entirely on preclinical animal colitis models and in vitro cell culture studies.",
    preclinicalEvidenceSummary: "Preclinical studies demonstrate that KPV acts intracellularly, crossing epithelial membranes via the oligopeptide transporter PepT1 to block NF-kB p65 nuclear translocation.",
    anecdotalSummary: "Frequently paired with BPC-157 by individuals suffering from gut dysbiosis, leaky gut syndrome, or histamine intolerance. Users report improved gastrointestinal comfort, though scientific verification is absent.",
    adverseEffects: [
      {
        effect: "Mild gastrointestinal discomfort or transient diarrhea",
        type: "reported",
        description: "Occasional mild stomach upset reported with oral administration.",
        evidenceLevel: "LEVEL_B",
        frequency: "Infrequent"
      },
      {
        effect: "Local injection site irritation",
        type: "established",
        description: "Mild erythema at the injection site.",
        evidenceLevel: "LEVEL_A",
        frequency: "Common"
      }
    ],
    contraindications: [
      "Hypersensitivity to melanocortin peptides",
      "Pregnancy and nursing"
    ],
    unknowns: [
      "Human pharmacokinetic bioavailability and therapeutic index",
      "Long-term immune modulation effects"
    ],
    sources: [
      {
        id: "Kannengiesser-2008-InflammBowelDis",
        title: "Melanocortin alpha-MSH(11-13) analog KPV ameliorates dextran sodium sulfate-induced colitis in mice",
        authorsOrOrg: "Kannengiesser K, et al.",
        journalOrPublisher: "Inflammatory Bowel Diseases",
        year: 2008,
        pmidOrDoi: "PMID: 17937446",
        url: "https://pubmed.ncbi.nlm.nih.gov/17937446/",
        evidenceLevel: "LEVEL_C",
        studyType: "Preclinical Animal Model"
      },
      {
        id: "Dalmasso-2008-Gastroenterology",
        title: "PepT1-mediated epithelial transport of the anti-inflammatory tripeptide KPV modulates intestinal inflammation",
        authorsOrOrg: "Dalmasso G, et al.",
        journalOrPublisher: "Gastroenterology",
        year: 2008,
        pmidOrDoi: "PMID: 18177920",
        url: "https://pubmed.ncbi.nlm.nih.gov/18177920/",
        evidenceLevel: "LEVEL_C",
        studyType: "In Vitro & Animal Study"
      }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // METABOLIC, MITOCHONDRIAL, AND FAT-LOSS PEPTIDES
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: "tirzepatide",
    name: "Tirzepatide",
    commonNames: ["Mounjaro", "Zepbound", "LY3298176", "Twincretin"],
    category: "metabolic_fatloss",
    classification: "Dual Glucose-Dependent Insulinotropic Polypeptide (GIP) and Glucagon-Like Peptide-1 (GLP-1) Receptor Agonist",
    molecularFormula: "C225H348N48O68",
    halfLife: "Approx. 5 days (120 hours, enabling once-weekly subcutaneous dosing)",
    administrationRoutes: ["Subcutaneous Weekly Injection"],
    mechanism: "Imparts dual agonism at both GIP and GLP-1 receptors. Engineered with a 39-amino acid modified backbone conjugated to a C20 fatty diacid moiety that binds albumin. Synergistically enhances glucose-dependent insulin secretion, suppresses glucagon, delays gastric emptying, improves insulin sensitivity in adipose tissue, and acts centrally in the hypothalamus to dramatically suppress appetite and caloric intake.",
    regulatoryStatus: "FDA Approved for Type 2 Diabetes Mellitus (Mounjaro, 2022) and Chronic Weight Management in Obesity/Overweight (Zepbound, 2023). Prescription only.",
    investigatedUses: [
      {
        conditionOrGoal: "Chronic Weight Management in Obesity (SURMOUNT Trial Program)",
        evidenceLevel: "LEVEL_A",
        status: "FDA Approved Indication",
        summary: "Phase 3 randomized, double-blind, placebo-controlled trials (SURMOUNT-1 through 4) in over 5,000 participants demonstrated mean body weight reductions of up to 20.9% to 22.5% (approx. 52 lbs) at the 15 mg weekly dose over 72 weeks.",
        sources: ["Jastreboff-2022-NEJM", "leRoux-2024-Lancet"]
      },
      {
        conditionOrGoal: "Glycemic Control in Type 2 Diabetes (SURPASS Trial Program)",
        evidenceLevel: "LEVEL_A",
        status: "FDA Approved Indication",
        summary: "Pivotal trials (SURPASS-1 through 5) demonstrated superior HbA1c reductions (up to -2.4%) and weight loss compared to placebo, semaglutide 1 mg, insulin degludec, and insulin glargine.",
        sources: ["Frias-2021-NEJM", "Ludvik-2021-Lancet"]
      },
      {
        conditionOrGoal: "Obstructive Sleep Apnea & Heart Failure with Preserved Ejection Fraction (HFpEF)",
        evidenceLevel: "LEVEL_A",
        status: "Phase 3 Trials Successfully Completed (FDA Priority Review)",
        summary: "Phase 3 SURMOUNT-OSA trial showed significant reductions in apnea-hypopnea index (AHI); SUMMIT trial demonstrated reductions in cardiovascular death and worsening heart failure events in HFpEF.",
        sources: ["Malhotra-2024-NEJM", "Packer-2024-NEJM"]
      }
    ],
    claims: [
      {
        id: "tirz-claim-1",
        claim: "Clinically proven to produce substantial, sustained weight loss averaging 20% or more",
        category: "benefit",
        evidenceLevel: "LEVEL_A",
        description: "Supported by massive multicenter Phase 3 randomized, double-blind clinical trials published in the New England Journal of Medicine, showing superior efficacy over standalone GLP-1 agonists.",
        population: "Human adults with obesity or overweight with comorbidities (non-diabetic & diabetic cohorts)",
        studyType: "Phase 3 Multicenter RCT (SURMOUNT-1)",
        limitations: "Discontinuation of medication results in substantial weight regain (demonstrated in SURMOUNT-4); requires continuous therapy and lifestyle intervention.",
        confidence: "HIGH",
        sourceIds: ["Jastreboff-2022-NEJM"]
      },
      {
        id: "tirz-claim-2",
        claim: "Superior reduction in HbA1c and glycemic control compared to semaglutide 1 mg",
        category: "benefit",
        evidenceLevel: "LEVEL_A",
        description: "Demonstrated in the head-to-head Phase 3 SURPASS-2 trial comparing tirzepatide (5, 10, 15 mg) directly against semaglutide 1 mg weekly.",
        population: "Patients with Type 2 Diabetes on metformin",
        studyType: "Head-to-head Phase 3 RCT",
        limitations: "Adverse gastrointestinal events are common during dose escalation.",
        confidence: "HIGH",
        sourceIds: ["Frias-2021-NEJM"]
      }
    ],
    clinicalEvidenceSummary: "Tirzepatide possesses the highest level of human clinical evidence (Level A) across tens of thousands of patients in global trials. It represents a major therapeutic advancement as the first approved dual GIP/GLP-1 receptor agonist.",
    preclinicalEvidenceSummary: "Preclinical studies demonstrated that adding GIP receptor agonism to GLP-1 agonism enhances insulin sensitivity directly in white adipose tissue and prevents the nausea/malaise signaling often seen with high-dose pure GLP-1 stimulation in animal models.",
    anecdotalSummary: 'Commonly described by users as a life-altering treatment that silences persistent internal "food noise" and cravings. Some users experience severe constipation, fatigue, or muscle mass loss if protein intake is insufficient.',
    adverseEffects: [
      {
        effect: "Gastrointestinal adverse effects (nausea, diarrhea, vomiting, constipation, dyspepsia)",
        type: "established",
        description: "Reported in 30-45% of patients during initial dose titration; mostly mild-to-moderate and transient.",
        evidenceLevel: "LEVEL_A",
        frequency: "Common",
        sourceIds: ["Jastreboff-2022-NEJM", "Frias-2021-NEJM"]
      },
      {
        effect: "Acute pancreatitis and gallbladder disease (cholelithiasis / cholecystitis)",
        type: "established",
        description: "Clinically recognized risks associated with rapid weight loss and incretin therapy.",
        evidenceLevel: "LEVEL_A",
        frequency: "Infrequent",
        sourceIds: ["Jastreboff-2022-NEJM"]
      },
      {
        effect: "Hypoglycemia when combined with sulfonylureas or insulin",
        type: "established",
        description: "Increased risk of low blood sugar when combined with secretagogues.",
        evidenceLevel: "LEVEL_A",
        frequency: "Common in combination therapy"
      },
      {
        effect: "Risk of thyroid C-cell tumors (Boxed Warning)",
        type: "established",
        description: "Observed in rodent carcinogenicity studies; human relevance remains unconfirmed but contraindicates use in patients with personal or family history of medullary thyroid carcinoma (MTC) or MEN 2.",
        evidenceLevel: "LEVEL_A",
        frequency: "Boxed Warning"
      }
    ],
    contraindications: [
      "Personal or family history of Medullary Thyroid Carcinoma (MTC)",
      "Multiple Endocrine Neoplasia syndrome type 2 (MEN 2)",
      "History of severe hypersensitivity reaction to tirzepatide",
      "Pregnancy and nursing"
    ],
    unknowns: [
      "Multi-decade cardiovascular and metabolic safety profiles over 10-20 years of continuous use",
      "Long-term lean mass vs. fat mass ratio retention in non-exercising elderly individuals"
    ],
    sources: [
      {
        id: "Jastreboff-2022-NEJM",
        title: "Tirzepatide Once Weekly for the Treatment of Obesity",
        authorsOrOrg: "Jastreboff AM, Aronne LJ, Ahmad NN, et al. (SURMOUNT-1)",
        journalOrPublisher: "New England Journal of Medicine (NEJM)",
        year: 2022,
        pmidOrDoi: "PMID: 35658024",
        url: "https://pubmed.ncbi.nlm.nih.gov/35658024/",
        evidenceLevel: "LEVEL_A",
        studyType: "Phase 3 Double-Blind RCT"
      },
      {
        id: "Frias-2021-NEJM",
        title: "Tirzepatide versus Semaglutide Once Weekly in Patients with Type 2 Diabetes",
        authorsOrOrg: "Fr\xEDas JP, Davies MJ, Rosenstock J, et al. (SURPASS-2)",
        journalOrPublisher: "New England Journal of Medicine (NEJM)",
        year: 2021,
        pmidOrDoi: "PMID: 34170647",
        url: "https://pubmed.ncbi.nlm.nih.gov/34170647/",
        evidenceLevel: "LEVEL_A",
        studyType: "Phase 3 Head-to-Head RCT"
      }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: "semaglutide",
    name: "Semaglutide",
    commonNames: ["Ozempic", "Wegovy", "Rybelsus", "NN9535"],
    category: "metabolic_fatloss",
    classification: "Long-Acting Glucagon-Like Peptide-1 (GLP-1) Receptor Agonist",
    molecularFormula: "C187H291N45O59",
    halfLife: "Approx. 165 hours (approx. 7 days)",
    administrationRoutes: ["Subcutaneous Weekly Injection (Ozempic/Wegovy)", "Oral Daily Tablet with SNAC Carrier (Rybelsus)"],
    mechanism: "Selective GLP-1 receptor agonist with 94% structural homology to native human GLP-1. Engineered with an Aib substitution at position 8 to resist DPP-4 enzymatic degradation and a C18 fatty diacid spacer conjugated to Lys26 for tight albumin binding. Stimulates glucose-dependent insulin secretion, suppresses postprandial glucagon secretion, delays gastric emptying, and acts on hypothalamic feeding centers to promote satiety.",
    regulatoryStatus: "FDA Approved for Type 2 Diabetes (Ozempic 2017, Rybelsus 2019), Chronic Weight Management in Obesity (Wegovy 2021), and Cardiovascular Death/Stroke/Infarction Risk Reduction in Adults with Established Cardiovascular Disease (Wegovy 2024).",
    investigatedUses: [
      {
        conditionOrGoal: "Chronic Weight Management (STEP Clinical Trial Program)",
        evidenceLevel: "LEVEL_A",
        status: "FDA Approved Indication",
        summary: "Phase 3 STEP-1 trial demonstrated a mean weight loss of 14.9% (approx. 33.7 lbs) compared to 2.4% with placebo at 68 weeks with 2.4 mg weekly subcutaneous dosing.",
        sources: ["Wilding-2021-NEJM"]
      },
      {
        conditionOrGoal: "Cardiovascular Risk Reduction in Established CVD (SELECT Trial)",
        evidenceLevel: "LEVEL_A",
        status: "FDA Approved Indication",
        summary: "Pivotal SELECT cardiovascular outcomes trial in 17,604 non-diabetic patients demonstrated a 20% reduction in major adverse cardiovascular events (MACE: CV death, nonfatal MI, nonfatal stroke).",
        sources: ["Lincoff-2023-NEJM"]
      },
      {
        conditionOrGoal: "Type 2 Diabetes Glycemic Control (SUSTAIN Program)",
        evidenceLevel: "LEVEL_A",
        status: "FDA Approved Indication",
        summary: "Extensive trials showed superior HbA1c reductions and weight loss compared to sitagliptin, exenatide, and insulin glargine.",
        sources: ["Pratley-2018-LancetDiabetes"]
      }
    ],
    claims: [
      {
        id: "sema-claim-1",
        claim: "Clinically proven to produce substantial weight loss averaging 15% in adults with obesity",
        category: "benefit",
        evidenceLevel: "LEVEL_A",
        description: "Demonstrated in multicenter Phase 3 double-blind randomized clinical trials (STEP-1, STEP-2, STEP-3) published in the NEJM and JAMA.",
        population: "Adults with BMI >=30 or >=27 with weight-related comorbidity",
        studyType: "Phase 3 Double-Blind RCT",
        limitations: "Discontinuation typically results in regain of two-thirds of lost weight within 12 months (STEP-4 extension).",
        confidence: "HIGH",
        sourceIds: ["Wilding-2021-NEJM"]
      },
      {
        id: "sema-claim-2",
        claim: "Reduces major adverse cardiovascular events (death, heart attack, stroke) by 20%",
        category: "benefit",
        evidenceLevel: "LEVEL_A",
        description: "Landmark SELECT trial in 17,604 patients established definitive cardiovascular event reduction in overweight/obese patients with established cardiovascular disease.",
        population: "Patients with established CVD and overweight/obesity without diabetes",
        studyType: "Multicenter Event-Driven Phase 3 RCT",
        limitations: "Study conducted in patients with pre-existing cardiovascular disease.",
        confidence: "HIGH",
        sourceIds: ["Lincoff-2023-NEJM"]
      }
    ],
    clinicalEvidenceSummary: "Semaglutide is one of the most thoroughly evaluated and validated therapeutic peptides in modern medicine. Supported by Level A evidence across diverse global populations, it has established unprecedented efficacy for weight loss, diabetes control, and cardiovascular risk reduction.",
    preclinicalEvidenceSummary: "Preclinical studies established strong brainstem and hypothalamic penetration (specifically area postrema and arcuate nucleus), directly altering neuronal firing to suppress hunger and reduce food reward signaling.",
    anecdotalSummary: 'Commonly reported by patients as eliminating impulsive eating, reducing alcohol cravings, and transforming metabolic health. Prominent anecdotal complaints include gastrointestinal discomfort during titration and "Ozempic face" (facial fat loss).',
    adverseEffects: [
      {
        effect: "Nausea, vomiting, diarrhea, and constipation",
        type: "established",
        description: "Most common adverse effects, reported in 40-50% of patients; mitigated by gradual dose titration.",
        evidenceLevel: "LEVEL_A",
        frequency: "Very Common",
        sourceIds: ["Wilding-2021-NEJM"]
      },
      {
        effect: "Delayed gastric emptying and gastroparesis symptoms",
        type: "established",
        description: "Slowed gastrointestinal motility; can increase aspiration risk during general anesthesia.",
        evidenceLevel: "LEVEL_A",
        frequency: "Common",
        sourceIds: ["Wilding-2021-NEJM"]
      },
      {
        effect: "Pancreatitis and acute gallbladder disease",
        type: "established",
        description: "Recognized clinical warnings requiring monitoring.",
        evidenceLevel: "LEVEL_A",
        frequency: "Infrequent",
        sourceIds: ["Wilding-2021-NEJM"]
      },
      {
        effect: "Thyroid C-cell tumor risk (Boxed Warning)",
        type: "established",
        description: "Rodent carcinogenicity warning; contraindicates use in MTC/MEN 2.",
        evidenceLevel: "LEVEL_A",
        frequency: "Boxed Warning"
      }
    ],
    contraindications: [
      "Personal or family history of Medullary Thyroid Carcinoma (MTC)",
      "Multiple Endocrine Neoplasia syndrome type 2 (MEN 2)",
      "Prior severe hypersensitivity to semaglutide",
      "Pregnancy and nursing"
    ],
    unknowns: [
      "Lifetime outcomes and potential receptor downregulation after 20-30 years of uninterrupted administration"
    ],
    sources: [
      {
        id: "Wilding-2021-NEJM",
        title: "Once-Weekly Semaglutide in Adults with Overweight or Obesity (STEP 1)",
        authorsOrOrg: "Wilding JPH, Batterham RL, Calanna S, et al.",
        journalOrPublisher: "New England Journal of Medicine (NEJM)",
        year: 2021,
        pmidOrDoi: "PMID: 33567185",
        url: "https://pubmed.ncbi.nlm.nih.gov/33567185/",
        evidenceLevel: "LEVEL_A",
        studyType: "Phase 3 Double-Blind RCT"
      },
      {
        id: "Lincoff-2023-NEJM",
        title: "Semaglutide and Cardiovascular Outcomes in Obesity without Diabetes (SELECT)",
        authorsOrOrg: "Lincoff AM, Brown-Frandsen K, Colhoun HM, et al.",
        journalOrPublisher: "New England Journal of Medicine (NEJM)",
        year: 2023,
        pmidOrDoi: "PMID: 37952131",
        url: "https://pubmed.ncbi.nlm.nih.gov/37952131/",
        evidenceLevel: "LEVEL_A",
        studyType: "Phase 3 Event-Driven RCT"
      }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: "retatrutide",
    name: "Retatrutide",
    commonNames: ["LY3437943", "Triple G", "GGG Tri-agonist"],
    category: "metabolic_fatloss",
    classification: "Triple Agonist of GLP-1, GIP, and Glucagon (GCG) Receptors",
    molecularFormula: "C221H342N48O68",
    halfLife: "Approx. 6 days (enables once-weekly subcutaneous dosing)",
    administrationRoutes: ["Subcutaneous Weekly Injection"],
    mechanism: "Simultaneously activates three key metabolic incretin and hormone receptors: GIP receptor (improves insulin sensitivity, reduces nausea), GLP-1 receptor (suppresses appetite, stimulates insulin), and Glucagon receptor (directly increases hepatic energy expenditure, accelerates thermogenesis, and clears liver fat).",
    regulatoryStatus: "Investigational Drug in Phase 3 Clinical Trials (TRIUMPH program). Not yet FDA approved.",
    investigatedUses: [
      {
        conditionOrGoal: "Obesity and Intensive Weight Reduction (Phase 2 Clinical Trials)",
        evidenceLevel: "LEVEL_A",
        status: "Published Phase 2 Randomized Controlled Trials",
        summary: "Phase 2 double-blind RCT published in NEJM (338 participants) demonstrated mean weight loss of up to 24.2% (approx. 58 lbs) at 48 weeks with 12 mg weekly dosing, the highest weight reduction ever recorded in pharmaceutical trials.",
        sources: ["Jastreboff-2023-NEJM"]
      },
      {
        conditionOrGoal: "Nonalcoholic Steatohepatitis (MASH / Fatty Liver Resolution)",
        evidenceLevel: "LEVEL_A",
        status: "Published Phase 2 Sub-study",
        summary: "Phase 2 trial substudy published in Nature Medicine showed normal liver fat (<5%) achieved in over 85% of patients taking higher doses at 48 weeks.",
        sources: ["Sanyal-2024-NatMed"]
      },
      {
        conditionOrGoal: "Type 2 Diabetes Glycemic Control",
        evidenceLevel: "LEVEL_A",
        status: "Published Phase 2 RCT",
        summary: "Phase 2 trial in Lancet demonstrated significant HbA1c reductions of up to 2.0% with robust weight loss.",
        sources: ["Rosenstock-2023-Lancet"]
      }
    ],
    claims: [
      {
        id: "reta-claim-1",
        claim: "Achieved average weight loss exceeding 24% at 48 weeks in Phase 2 clinical trials",
        category: "benefit",
        evidenceLevel: "LEVEL_A",
        description: "Demonstrated in rigorous Phase 2 double-blind randomized clinical trials published in the New England Journal of Medicine.",
        population: "Adults with obesity or overweight",
        studyType: "Phase 2 Double-Blind RCT",
        limitations: "Phase 3 trials (TRIUMPH) are ongoing to confirm long-term efficacy, safety, and cardiovascular impact.",
        confidence: "HIGH",
        sourceIds: ["Jastreboff-2023-NEJM"]
      },
      {
        id: "reta-claim-2",
        claim: "Increases heart rate via direct glucagon receptor stimulation in cardiac sinoatrial node",
        category: "adverse_effect",
        evidenceLevel: "LEVEL_A",
        description: "Clinical trials demonstrated a dose-dependent increase in resting heart rate of 5 to 10 beats per minute, peaking between weeks 12 and 24 before declining.",
        population: "Phase 2 Clinical Cohorts",
        studyType: "Continuous Holter & ECG Monitoring",
        limitations: "Long-term cardiovascular consequences of transient resting heart rate acceleration require Phase 3 completion.",
        confidence: "HIGH",
        sourceIds: ["Jastreboff-2023-NEJM"]
      }
    ],
    clinicalEvidenceSummary: "Retatrutide has demonstrated the highest weight loss efficacy ever reported in clinical trial history in Phase 2 studies (surpassing both semaglutide and tirzepatide). The addition of glucagon receptor agonism stimulates basal energy expenditure in addition to appetite suppression.",
    preclinicalEvidenceSummary: "Rodent models confirmed increased oxygen consumption and uncoupling protein-1 (UCP-1) mediated thermogenesis, demonstrating that weight loss is driven by both decreased caloric intake and increased energy expenditure.",
    anecdotalSummary: "Generating immense anticipation in fitness and biohacking communities. Unapproved grey-market versions are circulating, but quality, sterility, and safety of illicit peptide powders cannot be guaranteed.",
    adverseEffects: [
      {
        effect: "Gastrointestinal distress (nausea, diarrhea, constipation, vomiting)",
        type: "established",
        description: "Reported in high percentages; dose-dependent and improved by gradual escalation.",
        evidenceLevel: "LEVEL_A",
        frequency: "Very Common",
        sourceIds: ["Jastreboff-2023-NEJM"]
      },
      {
        effect: "Dose-dependent increase in resting heart rate and cutaneous hyperesthesia",
        type: "established",
        description: "Transient elevation in heart rate (5-10 bpm) and cutaneous dysesthesia/skin tenderness.",
        evidenceLevel: "LEVEL_A",
        frequency: "Common",
        sourceIds: ["Jastreboff-2023-NEJM"]
      },
      {
        effect: "Transient elevation in pancreatic enzymes (amylase/lipase)",
        type: "reported",
        description: "Asymptomatic enzyme rises typical of incretin mimetics.",
        evidenceLevel: "LEVEL_B",
        frequency: "Common"
      }
    ],
    contraindications: [
      "Personal or family history of Medullary Thyroid Carcinoma (MTC) or MEN 2",
      "Preexisting cardiac arrhythmias or tachycardia without cardiology clearance",
      "Pregnancy"
    ],
    unknowns: [
      "Definitive Phase 3 cardiovascular safety endpoints and long-term cardiac arrhythmia incidence"
    ],
    sources: [
      {
        id: "Jastreboff-2023-NEJM",
        title: "Triple-Hormone-Receptor Agonist Retatrutide for Obesity \u2014 A Phase 2 Trial",
        authorsOrOrg: "Jastreboff AM, Kaplan LM, Fr\xEDas JP, et al.",
        journalOrPublisher: "New England Journal of Medicine (NEJM)",
        year: 2023,
        pmidOrDoi: "PMID: 37366315",
        url: "https://pubmed.ncbi.nlm.nih.gov/37366315/",
        evidenceLevel: "LEVEL_A",
        studyType: "Phase 2 Double-Blind RCT"
      },
      {
        id: "Sanyal-2024-NatMed",
        title: "Retatrutide for metabolic dysfunction-associated steatohepatitis: a randomized phase 2 trial",
        authorsOrOrg: "Sanyal AJ, et al.",
        journalOrPublisher: "Nature Medicine",
        year: 2024,
        pmidOrDoi: "PMID: 38858487",
        url: "https://pubmed.ncbi.nlm.nih.gov/38858487/",
        evidenceLevel: "LEVEL_A",
        studyType: "Phase 2 Clinical Sub-study"
      }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: "mots-c",
    name: "MOTS-c",
    commonNames: ["Mitochondrial Open Reading Frame of the 12S rRNA Type-c", "Mitochondrial-Derived Peptide"],
    category: "metabolic_fatloss",
    classification: "Mitochondrial-Derived Peptide (MDP) Encoded by Mitochondrial 12S Ribosomal RNA",
    molecularFormula: "C101H152N28O22S2",
    halfLife: "Short systemic circulation (< 30 minutes in plasma; triggers prolonged cellular transcriptional cascades)",
    administrationRoutes: ["Subcutaneous Injection"],
    mechanism: "Naturally encoded within the mitochondrial genome. Acts as an exercise mimetic by stimulating AMP-activated protein kinase (AMPK), inhibiting the folate-methionine cycle (mimicking glucose/amino acid starvation), promoting cellular glucose uptake, enhancing skeletal muscle insulin sensitivity, and regulating lipid oxidation.",
    regulatoryStatus: "Research Chemical. Not FDA approved for human therapeutic use. Prohibited by WADA under category S4 (Hormone and Metabolic Modulators).",
    investigatedUses: [
      {
        conditionOrGoal: "Insulin Sensitivity and Metabolic Homeostasis",
        evidenceLevel: "LEVEL_C",
        status: "Extensive Preclinical Rodent Studies",
        summary: "In rodent models of diet-induced obesity, MOTS-c prevented insulin resistance, improved skeletal muscle glucose clearance, and promoted metabolic flexibility.",
        sources: ["Lee-2015-CellMetab"]
      },
      {
        conditionOrGoal: "Physical Performance and Exercise Capacity in Aging",
        evidenceLevel: "LEVEL_C",
        status: "Preclinical Animal Research & Observational Biomarkers",
        summary: "In aged mice, MOTS-c treatment improved running capacity, grip strength, and motor function. Human association studies observed higher circulating MOTS-c levels in sedentary elderly populations with preserved insulin sensitivity.",
        sources: ["Reynolds-2021-NatCommun"]
      },
      {
        conditionOrGoal: "Athletic Endurance and Fat Loss in Humans",
        evidenceLevel: "LEVEL_D",
        status: "Anecdotal Use Only",
        summary: 'Popularized among endurance athletes and bodybuilders as an "exercise in a bottle" peptide; human clinical trials validating enhanced athletic performance are lacking.',
        sources: []
      }
    ],
    claims: [
      {
        id: "mots-claim-1",
        claim: "Activates AMPK and enhances skeletal muscle glucose metabolism in preclinical models",
        category: "mechanism",
        evidenceLevel: "LEVEL_C",
        description: "Demonstrated in seminal peer-reviewed research in Cell Metabolism to stimulate cellular glucose clearance via AMPK activation in rodent skeletal muscle.",
        population: "Rodent models and cultured human skeletal myotubes",
        studyType: "Preclinical Laboratory Research",
        limitations: "Preclinical metabolic improvements in mice have not been confirmed in prospective human clinical trials.",
        confidence: "HIGH",
        sourceIds: ["Lee-2015-CellMetab"]
      },
      {
        id: "mots-claim-2",
        claim: "Clinically proven human fat burner and athletic endurance enhancer",
        category: "benefit",
        evidenceLevel: "LEVEL_D",
        description: "Widespread claims in fitness podcasts and peptide clinics that MOTS-c melts fat and drastically enhances VO2 max in healthy adults are supported only by anecdotal reports.",
        population: "Fitness Community",
        studyType: "Anecdotal",
        limitations: "No randomized controlled human trials evaluate athletic performance or body recomposition.",
        confidence: "LOW",
        sourceIds: []
      }
    ],
    clinicalEvidenceSummary: "MOTS-c was identified in 2015 by Pinchas Cohen and Changhan Lee at USC. While biological research into mitochondrial peptides is groundbreaking, human data are limited to observational correlation studies measuring endogenous serum levels. Prospective randomized clinical interventional trials are lacking.",
    preclinicalEvidenceSummary: "Mice administered MOTS-c exhibited resistance to high-fat diet obesity, reversal of age-dependent insulin resistance, and significantly improved treadmill endurance performance.",
    anecdotalSummary: "Used by biohackers seeking enhanced metabolic flexibility and endurance. Injected subcutaneously (often 5-10 mg weekly). Users report clean, non-stimulant energy and enhanced workout stamina, but high cost and lack of standardization remain issues.",
    adverseEffects: [
      {
        effect: "Local injection site redness and itching",
        type: "reported",
        description: "Cutaneous irritation at subcutaneous injection site.",
        evidenceLevel: "LEVEL_B",
        frequency: "Common"
      },
      {
        effect: "Transient muscle fatigue or flu-like feeling",
        type: "anecdotal",
        description: "Self-reported by users during initial administration.",
        evidenceLevel: "LEVEL_D",
        frequency: "Infrequent"
      }
    ],
    contraindications: [
      "Athletes subject to WADA anti-doping testing (classified as an unapproved metabolic modulator)",
      "Pregnancy"
    ],
    unknowns: [
      "Human pharmacokinetics, optimal therapeutic dosing, and long-term metabolic consequences"
    ],
    sources: [
      {
        id: "Lee-2015-CellMetab",
        title: "The Mitochondrial-Derived Peptide MOTS-c Promotes Metabolic Homeostasis and Reduces Diet-Induced Obesity and Insulin Resistance",
        authorsOrOrg: "Lee C, Zeng J, Drew BG, et al.",
        journalOrPublisher: "Cell Metabolism",
        year: 2015,
        pmidOrDoi: "PMID: 25738459",
        url: "https://pubmed.ncbi.nlm.nih.gov/25738459/",
        evidenceLevel: "LEVEL_C",
        studyType: "Preclinical Landmark Study"
      },
      {
        id: "Reynolds-2021-NatCommun",
        title: "MOTS-c is an exercise-induced mitochondrial-encoded regulator of walking capacity and muscle metabolism in old mice",
        authorsOrOrg: "Reynolds JC, et al.",
        journalOrPublisher: "Nature Communications",
        year: 2021,
        pmidOrDoi: "PMID: 33473130",
        url: "https://pubmed.ncbi.nlm.nih.gov/33473130/",
        evidenceLevel: "LEVEL_C",
        studyType: "Preclinical Study"
      }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // ADVANCED & NICHE ANABOLIC/PERFORMANCE PEPTIDES
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: "igf-1-lr3",
    name: "IGF-1 LR3",
    commonNames: ["Long R3 IGF-1", "Long Arg3 Insulin-Like Growth Factor-I"],
    category: "advanced_anabolic",
    classification: "Synthetic Recombinant Analog of Human Insulin-like Growth Factor-1",
    molecularFormula: "C400H625N111O115S9",
    halfLife: "Approx. 20 to 30 hours (substantially longer than native IGF-1 half-life of 15 minutes)",
    administrationRoutes: ["Subcutaneous Injection", "Intramuscular Injection (post-workout)"],
    mechanism: "Engineered with an arginine substitution at position 3 (Glu3 to Arg3) and a 13-amino acid extension peptide at the N-terminus. These structural alterations dramatically reduce binding affinity for inhibitory IGF-binding proteins (IGFBP-1 through 6) by over 100-fold, allowing prolonged, unhindered activation of the IGF-1 receptor (IGF-1R), triggering downstream PI3K/Akt/mTOR anabolic signaling and satellite cell proliferation in skeletal muscle.",
    regulatoryStatus: "Research Chemical Only. Not approved for human medical use. Prohibited by WADA under category S2.",
    investigatedUses: [
      {
        conditionOrGoal: "Cell Culture Media Supplement for Biopharmaceutical Protein Production",
        evidenceLevel: "LEVEL_A",
        status: "Commercial / Industrial Use in Cell Culture",
        summary: "Widely manufactured and validated as an industrial serum-free cell culture media additive to sustain cell viability and protein yield in Chinese Hamster Ovary (CHO) cells.",
        sources: ["Tomas-1992-BiochemJ"]
      },
      {
        conditionOrGoal: "Severe Catabolic Wasting and Growth Impairment",
        evidenceLevel: "LEVEL_C",
        status: "Preclinical Animal Research",
        summary: "In catabolic and hypophysectomized rodent models, IGF-1 LR3 produced 3-fold greater somatic growth and nitrogen retention than native recombinant human IGF-1.",
        sources: ["Tomas-1992-BiochemJ", "Ballard-1996-ExpNephrol"]
      },
      {
        conditionOrGoal: "Extreme Muscle Hypertrophy and Bodybuilding Anabolism",
        evidenceLevel: "LEVEL_D",
        status: "Anecdotal Use in Competitive Bodybuilding",
        summary: "Widely used in underground bodybuilding to stimulate muscle cell hyperplasia, post-workout nutrient partitioning, and extreme muscle pumps; human clinical trials in athletes are absent.",
        sources: []
      }
    ],
    claims: [
      {
        id: "igf-claim-1",
        claim: "Potent activator of muscle protein synthesis and mTOR signaling with reduced IGFBP affinity",
        category: "mechanism",
        evidenceLevel: "LEVEL_C",
        description: "Demonstrated in preclinical biochemistry to resist binding to IGF-binding proteins, exerting prolonged potent activation of the IGF-1 receptor and mTOR pathway.",
        population: "Cell culture systems and rodent models",
        studyType: "Preclinical Biochemistry",
        limitations: "Potent receptor activation carries significant mitogenic, oncologic, and hypoglycemic risks in humans.",
        confidence: "HIGH",
        sourceIds: ["Tomas-1992-BiochemJ"]
      },
      {
        id: "igf-claim-2",
        claim: "Clinically proven safe treatment to build permanent new muscle fibers in healthy adults",
        category: "benefit",
        evidenceLevel: "LEVEL_D",
        description: "Underground claims that IGF-1 LR3 creates permanent muscle hyperplasia (new fiber creation) in humans without health risks are unproven and ignore severe safety concerns.",
        population: "Bodybuilding Community",
        studyType: "Anecdotal Reports",
        limitations: "Lacks human clinical safety trials; carries acute hypoglycemia risk and long-term tumorigenic potential.",
        confidence: "LOW",
        sourceIds: []
      }
    ],
    clinicalEvidenceSummary: "There are no published Phase 2 or Phase 3 human clinical trials evaluating IGF-1 LR3 for human medical therapeutics. While native recombinant IGF-1 (Mecasermin / Increlex) is FDA-approved for severe primary IGF-1 deficiency in children, the modified Long R3 analog was developed primarily for industrial biopharmaceutical cell culture.",
    preclinicalEvidenceSummary: "Animal studies demonstrated markedly higher biological potency than native IGF-1 in driving visceral organ growth, skeletal muscle weight, and glucose clearance.",
    anecdotalSummary: "Regarded in competitive bodybuilding as one of the most powerful anabolic compounds available. Users inject 20-50 mcg post-workout and report skin-splitting muscle pumps and vascularity. However, acute hypoglycemia is a recognized hazard requiring immediate carbohydrate consumption.",
    adverseEffects: [
      {
        effect: "Acute severe hypoglycemia (blood sugar drop)",
        type: "established",
        description: "Binds insulin receptors and stimulates massive glucose uptake into peripheral tissues, risking acute hypoglycemic collapse, dizziness, shakiness, or loss of consciousness.",
        evidenceLevel: "LEVEL_A",
        frequency: "Common",
        sourceIds: ["Tomas-1992-BiochemJ"]
      },
      {
        effect: "Visceral organ hypertrophy (organomegaly)",
        type: "reported",
        description: "Unintended growth of internal organs (intestines, spleen, kidneys) and potential abdominal distension with prolonged high-dose use.",
        evidenceLevel: "LEVEL_C",
        frequency: "Reported in animals / Anecdotal in athletes"
      },
      {
        effect: "Theoretical promotion of neoplastic / tumor growth",
        type: "reported",
        description: "IGF-1 signaling strongly inhibits apoptosis and accelerates cellular proliferation in occult malignant or pre-malignant tissues.",
        evidenceLevel: "LEVEL_C",
        frequency: "Significant theoretical hazard"
      },
      {
        effect: "Headache, lethargy, and joint pain",
        type: "anecdotal",
        description: "Commonly reported in user forums.",
        evidenceLevel: "LEVEL_D",
        frequency: "Common"
      }
    ],
    contraindications: [
      "Any personal history of malignancy or pre-cancerous lesions (strict absolute contraindication)",
      "Hypoglycemic tendencies or diabetes mellitus",
      "Athletes subject to WADA anti-doping testing"
    ],
    unknowns: [
      "Safety and organ enlargement thresholds in humans with cyclical use"
    ],
    sources: [
      {
        id: "Tomas-1992-BiochemJ",
        title: "Insulin-like growth factor I (IGF-I) and especially IGF-I variants are potent anabolics in catabolic rats",
        authorsOrOrg: "Tomas FM, Knowles SE, Owens PC, et al.",
        journalOrPublisher: "Biochemical Journal",
        year: 1992,
        pmidOrDoi: "PMID: 1567375",
        url: "https://pubmed.ncbi.nlm.nih.gov/1567375/",
        evidenceLevel: "LEVEL_C",
        studyType: "Preclinical Animal Study"
      }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: "follistatin-344",
    name: "Follistatin (FS-344)",
    commonNames: ["Follistatin 344", "FST-344", "Myostatin Inhibitor", "AAV1-FS344"],
    category: "advanced_anabolic",
    classification: "Autocrine Glycoprotein & Activin-Binding Myostatin Antagonist",
    molecularFormula: "Complex Glycoprotein (approx. 344 amino acids)",
    halfLife: "Very short circulating half-life for recombinant peptide (hours); gene therapy constructs provide multi-year expression",
    administrationRoutes: ["Intramuscular Injection (recombinant peptide)", "Gene Therapy Vector AAV1 (clinical trial)"],
    mechanism: "Potent antagonist of TGF-beta superfamily ligands, primarily myostatin (GDF-8) and activins. Binds directly to myostatin with high nanomolar affinity, preventing it from interacting with the activin type IIB receptor (ActRIIB), thereby lifting the biological brake on skeletal muscle protein synthesis and satellite cell proliferation.",
    regulatoryStatus: "Investigational / Research Chemical Only. Recombinant peptide is not FDA approved. Gene therapy vector (AAV1-FS344) has been investigated in small investigational Phase 1/2 clinical trials for muscular dystrophy.",
    investigatedUses: [
      {
        conditionOrGoal: "Becker Muscular Dystrophy & Inclusion Body Myositis (AAV1-FS344 Gene Therapy)",
        evidenceLevel: "LEVEL_B",
        status: "Phase 1/2 Clinical Gene Therapy Trials",
        summary: "Investigational gene therapy delivering follistatin via adeno-associated virus (AAV1-FS344) into quadriceps muscles of patients with Becker muscular dystrophy demonstrated improvements in 6-minute walk distance and histological muscle fiber enlargement.",
        sources: ["Mendell-2015-MolTher"]
      },
      {
        conditionOrGoal: "Muscle Hypertrophy Exceeding Natural Genetic Limits in Mice and Monkeys",
        evidenceLevel: "LEVEL_C",
        status: "Preclinical Animal Research",
        summary: "Transgenic mice and non-human primates treated with follistatin gene constructs exhibited pronounced muscle mass increases (up to 100% muscle mass enlargement in mice).",
        sources: ["Kota-2009-SciTranslMed", "Lee-2001-ProcNatlAcadSci"]
      },
      {
        conditionOrGoal: "Bodybuilding Muscle Mass Enhancement via Commercial Peptide Vials",
        evidenceLevel: "LEVEL_D",
        status: "Anecdotal Use Only",
        summary: 'Commercial peptide vials sold online as "Follistatin 344" are purchased by bodybuilders; however, recombinant follistatin protein is extremely unstable, rapidly cleared, often degraded, and lacks clinical trials for healthy athletic performance.',
        sources: []
      }
    ],
    claims: [
      {
        id: "fst-claim-1",
        claim: "Antagonizes myostatin and promotes muscle fiber enlargement in preclinical and gene therapy trials",
        category: "mechanism",
        evidenceLevel: "LEVEL_B",
        description: "Demonstrated in molecular biology and early Phase 1/2 AAV gene therapy trials to bind myostatin and induce muscle fiber hypertrophy.",
        population: "Becker muscular dystrophy patients and animal models",
        studyType: "Phase 1/2 Gene Therapy Trial & Preclinical Studies",
        limitations: "Applies to specialized AAV gene therapy vectors in muscular dystrophy; does NOT validate commercial non-gene-therapy injectable vials sold on research chemical websites.",
        confidence: "MODERATE",
        sourceIds: ["Mendell-2015-MolTher", "Kota-2009-SciTranslMed"]
      },
      {
        id: "fst-claim-2",
        claim: "Purchasing an online vial of Follistatin 344 guarantees massive permanent muscle growth in healthy athletes",
        category: "benefit",
        evidenceLevel: "LEVEL_D",
        description: "Commercial peptide vials online have notoriously poor stability, questionable authenticity, lack glycosylation, and carry no human clinical trials proving efficacy in healthy gym-goers.",
        population: "Bodybuilding Community",
        studyType: "Anecdotal / Unverified Marketing Claims",
        limitations: "Lacks verified clinical trial data; commercial products are frequently degraded or counterfeit.",
        confidence: "LOW",
        sourceIds: []
      }
    ],
    clinicalEvidenceSummary: "Rigorous clinical research on follistatin is restricted to specialized gene therapy delivery (AAV1-FS344) directed by Jerry Mendell at Nationwide Children Hospital for neuromuscular wasting diseases. In contrast, commercial freeze-dried peptide vials marketed online have zero human clinical proof.",
    preclinicalEvidenceSummary: "Landmark studies in Science Translational Medicine demonstrated that follistatin gene delivery produced sustained muscle mass and strength increases in non-human primates without apparent systemic toxicity over 15 months.",
    anecdotalSummary: "Purchased online by bodybuilders looking for a myostatin inhibitor shortcut. Feedback in forums is highly mixed; many users report zero noticeable results (likely due to degraded protein), while others report tendon stiffness, joint soreness, and temporary water retention.",
    adverseEffects: [
      {
        effect: "Tendon and ligament vulnerability / stiffness",
        type: "reported",
        description: "Rapid muscle hypertrophy without proportional tendon adaptation, combined with activin inhibition, may increase connective tissue injury risk.",
        evidenceLevel: "LEVEL_C",
        frequency: "Reported in animals / Anecdotal in athletes"
      },
      {
        effect: "Suppression of FSH and reproductive axis disruption",
        type: "reported",
        description: "Follistatin binds activins that stimulate follicle-stimulating hormone (FSH) release from the pituitary.",
        evidenceLevel: "LEVEL_B",
        frequency: "Infrequent"
      },
      {
        effect: "Local injection site swelling, pain, and redness",
        type: "established",
        description: "Cutaneous irritation from intramuscular injection.",
        evidenceLevel: "LEVEL_A",
        frequency: "Common"
      }
    ],
    contraindications: [
      "Active malignancy or family history of cancer",
      "Athletes subject to WADA anti-doping testing (prohibited as a myostatin inhibitor)",
      "Pregnancy and nursing"
    ],
    unknowns: [
      "Bioactivity and purity of commercial synthetic peptide vials compared to authentic viral vectors",
      "Long-term consequences of systemic activin and myostatin suppression on cardiac muscle"
    ],
    sources: [
      {
        id: "Mendell-2015-MolTher",
        title: "A phase 1/2a follistatin gene therapy trial for Becker muscular dystrophy",
        authorsOrOrg: "Mendell JR, Sahenk Z, Malik V, et al.",
        journalOrPublisher: "Molecular Therapy",
        year: 2015,
        pmidOrDoi: "PMID: 25327583",
        url: "https://pubmed.ncbi.nlm.nih.gov/25327583/",
        evidenceLevel: "LEVEL_B",
        studyType: "Phase 1/2 Gene Therapy Trial"
      },
      {
        id: "Kota-2009-SciTranslMed",
        title: "Follistatin gene delivery enhances muscle growth and strength in nonhuman primates",
        authorsOrOrg: "Kota J, Handy CR, Haidet AM, et al.",
        journalOrPublisher: "Science Translational Medicine",
        year: 2009,
        pmidOrDoi: "PMID: 20368179",
        url: "https://pubmed.ncbi.nlm.nih.gov/20368179/",
        evidenceLevel: "LEVEL_C",
        studyType: "Non-Human Primate Study"
      }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: "kisspeptin",
    name: "Kisspeptin",
    commonNames: ["Kisspeptin-10", "Kisspeptin-54", "KiSS-1", "Metastin"],
    category: "advanced_anabolic",
    classification: "Endogenous Neuropeptide & G-Protein-Coupled Receptor 54 (GPR54 / KISS1R) Agonist",
    molecularFormula: "C63H83N17O14 (Kisspeptin-10)",
    halfLife: "Approx. 28 to 30 minutes (Kisspeptin-10)",
    administrationRoutes: ["Subcutaneous Injection", "Intravenous Infusion"],
    mechanism: "Master upstream neuroendocrine regulator of the hypothalamic-pituitary-gonadal (HPG) axis. Synthesized by neurons in the arcuate nucleus and anteroventral periventricular nucleus of the hypothalamus. Binds GPR54 (KISS1R) on GnRH neurons, driving pulsatile release of Gonadotropin-Releasing Hormone (GnRH), which in turn stimulates anterior pituitary secretion of Luteinizing Hormone (LH) and Follicle-Stimulating Hormone (FSH), ultimately elevating endogenous testosterone and regulating gametogenesis.",
    regulatoryStatus: "Investigational Drug in Human Reproductive Endocrinology. Not approved for over-the-counter use or athletic enhancement.",
    investigatedUses: [
      {
        conditionOrGoal: "In Vitro Fertilization (IVF) Oocyte Maturation Without Ovarian Hyperstimulation",
        evidenceLevel: "LEVEL_A",
        status: "Demonstrated in Phase 2 Clinical Trials",
        summary: "Randomized clinical trials demonstrated that Kisspeptin-54 safely triggers final oocyte maturation in women undergoing IVF at high risk of ovarian hyperstimulation syndrome (OHSS), providing a safer physiological trigger than hCG.",
        sources: ["Abbara-2015-LancetDiabetes", "Jayasena-2014-JCEM"]
      },
      {
        conditionOrGoal: "Stimulating LH, FSH, and Testosterone in Hypogonadotropic Men",
        evidenceLevel: "LEVEL_A",
        status: "Demonstrated in Controlled Human Endocrine Trials",
        summary: "Clinical studies in healthy men and men with hypogonadotropic hypogonadism show acute, dose-dependent increases in plasma LH, FSH, and testosterone pulses.",
        sources: ["George-2011-JCEM", "Dhillo-2005-JCEM"]
      },
      {
        conditionOrGoal: "Post-Cycle Therapy (PCT) in Bodybuilders",
        evidenceLevel: "LEVEL_D",
        status: "Anecdotal Use Only",
        summary: "Used by bodybuilders as an alternative or adjunct to hCG or SERMs to restart endogenous testosterone production following anabolic steroid cycles; formal clinical trials evaluating PCT protocols do not exist.",
        sources: []
      }
    ],
    claims: [
      {
        id: "kiss-claim-1",
        claim: "Drives pulsatile secretion of GnRH, LH, and FSH to stimulate natural gonadal hormone production",
        category: "benefit",
        evidenceLevel: "LEVEL_A",
        description: "Extensively confirmed in peer-reviewed human clinical endocrine trials published in JCEM and The Lancet Diabetes & Endocrinology.",
        population: "Healthy human male and female cohorts, IVF patients, and hypogonadal men",
        studyType: "Controlled Human Endocrine Trials",
        limitations: "Continuous uninterrupted high-dose administration causes desensitization and downregulation of GPR54 receptors, paradoxically suppressing the HPG axis.",
        confidence: "HIGH",
        sourceIds: ["George-2011-JCEM", "Dhillo-2005-JCEM"]
      },
      {
        id: "kiss-claim-2",
        claim: "Clinically proven protocol to replace standard medical PCT and cure steroid-induced hypogonadism",
        category: "benefit",
        evidenceLevel: "LEVEL_D",
        description: "While biologically plausible, there are no randomized controlled trials evaluating kisspeptin as a standalone post-cycle therapy for steroid-induced suppression.",
        population: "Bodybuilding Community",
        studyType: "Anecdotal Reports",
        limitations: "Lacks clinical trials for post-steroid HPG recovery.",
        confidence: "LOW",
        sourceIds: []
      }
    ],
    clinicalEvidenceSummary: "Kisspeptin represents an active, highly respected area of human reproductive endocrinology led by investigators at Imperial College London (Dhillo, Abbara et al.). Its ability to stimulate physiological gonadotropin release has established it as a promising therapeutic in fertility medicine.",
    preclinicalEvidenceSummary: "The discovery of inactivating mutations in GPR54 causing idiopathic hypogonadotropic hypogonadism in humans and mice established kisspeptin as the indispensable gatekeeper of puberty and reproduction.",
    anecdotalSummary: "Explored by athletes seeking to recover from suppressive anabolic cycles without the testicular desensitization risks associated with high-dose hCG. Users report increased libido and testicular fullness, but dosing protocols are largely experimental in user forums.",
    adverseEffects: [
      {
        effect: "Receptor desensitization and tachyphylaxis with continuous use",
        type: "established",
        description: "Continuous non-pulsatile exposure leads to GPR54 downregulation and paradoxical suppression of LH and testosterone.",
        evidenceLevel: "LEVEL_A",
        frequency: "Common with continuous dosing",
        sourceIds: ["George-2011-JCEM"]
      },
      {
        effect: "Transient flushing, mild headache, or nausea",
        type: "reported",
        description: "Self-limiting mild autonomic and endocrine responses.",
        evidenceLevel: "LEVEL_B",
        frequency: "Infrequent"
      },
      {
        effect: "Injection site redness and stinging",
        type: "established",
        description: "Mild local cutaneous reaction.",
        evidenceLevel: "LEVEL_A",
        frequency: "Common"
      }
    ],
    contraindications: [
      "Hormone-sensitive malignancies (prostate cancer, breast cancer, ovarian cancer)",
      "Prepubertal children (except in authorized clinical diagnostic studies)",
      "Pregnancy"
    ],
    unknowns: [
      "Optimal pulsatile delivery protocols for long-term male hypogonadism management"
    ],
    sources: [
      {
        id: "George-2011-JCEM",
        title: "Kisspeptin-10 is a potent stimulator of LH and increases pulse frequency in men",
        authorsOrOrg: "George JT, Anderson RA, Millar RP, et al.",
        journalOrPublisher: "Journal of Clinical Endocrinology & Metabolism (JCEM)",
        year: 2011,
        pmidOrDoi: "PMID: 21677042",
        url: "https://pubmed.ncbi.nlm.nih.gov/21677042/",
        evidenceLevel: "LEVEL_A",
        studyType: "Controlled Human Clinical Trial"
      },
      {
        id: "Abbara-2015-LancetDiabetes",
        title: "Kisspeptin-54 accurately and safely triggers oocyte maturation in women undergoing in vitro fertilization",
        authorsOrOrg: "Abbara A, Jayasena CN, Christopoulos G, et al.",
        journalOrPublisher: "The Lancet Diabetes & Endocrinology",
        year: 2015,
        pmidOrDoi: "PMID: 26162399",
        url: "https://pubmed.ncbi.nlm.nih.gov/26162399/",
        evidenceLevel: "LEVEL_A",
        studyType: "Phase 2 Clinical Trial"
      }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
];

// server/peptide/evidenceModel.ts
var DOSSIERS = {
  "bpc-157": {
    peptideId: "bpc-157",
    peptideName: "BPC-157",
    records: [
      {
        id: "bpc-anecdotal-1",
        peptide: "bpc-157",
        peptideName: "BPC-157",
        evidence_type: "ANECDOTAL",
        source: "Bodybuilding communities, online athlete forums, and public self-reports",
        source_url: "https://www.reddit.com/r/peptides/",
        publication_date: "2018-2026",
        population_or_model: "Online athletic community self-reports (uncontrolled)",
        claim: "Cures tendonitis, rotator cuff tears, and severe soft tissue injuries within days to weeks",
        finding: "Some users report rapid relief from chronic joint pain and accelerated tendonitis healing, often injecting subcutaneously or near injury sites.",
        limitations: "Individual self-reports are uncontrolled, subject to strong placebo and self-selection bias, and cannot establish clinical efficacy or safety.",
        evidence_status: "COMMUNITY_REPORT",
        citation: "Bodybuilding & Fitness Community Discussions (Public self-reported experiences)"
      },
      {
        id: "bpc-preclinical-1",
        peptide: "bpc-157",
        peptideName: "BPC-157",
        evidence_type: "PRECLINICAL",
        source: "Journal of Orthopaedic Research (Chang et al.)",
        source_url: "https://pubmed.ncbi.nlm.nih.gov/21031536/",
        publication_date: "2011",
        population_or_model: "Sprague-Dawley rat models and in-vitro tendon fibroblasts (tenocytes)",
        claim: "Accelerates collagen type I synthesis and tendon outgrowth in mechanical transection models",
        finding: "BPC-157 significantly promoted tendon outgrowth, cell survival, and migration of tendon fibroblasts in vitro and in rat Achilles tendon transections.",
        limitations: "Laboratory animal and cell models do not establish that the same effect, dosing, or safety profile occurs in humans.",
        evidence_status: "VERIFIED",
        citation: "Chang CH, et al. The promoting effect of pentadecapeptide BPC 157 on tendon healing involves tendon outgrowth, cell survival, and cell migration. J Orthop Res. 2011;29(5):674-680."
      },
      {
        id: "bpc-preclinical-2",
        peptide: "bpc-157",
        peptideName: "BPC-157",
        evidence_type: "PRECLINICAL",
        source: "Current Pharmaceutical Design (Sikiric et al.)",
        source_url: "https://pubmed.ncbi.nlm.nih.gov/20192865/",
        publication_date: "2010",
        population_or_model: "Rodent models of tissue ischemia and vascular disruption",
        claim: "Promotes collateral blood vessel formation (angiogenesis) via VEGFR2 activation",
        finding: "BPC-157 upregulated Vascular Endothelial Growth Factor Receptor 2 (VEGFR2) and activated the early growth response gene-1 (egr-1) pathway in rodent models.",
        limitations: "Preclinical rodent data cannot be extrapolated to human athletic recovery or clinical healing.",
        evidence_status: "VERIFIED",
        citation: "Sikiric P, et al. Stable gastric pentadecapeptide BPC 157-NO-system relation. Curr Pharm Des. 2010;16(10):1224-1234."
      },
      {
        id: "bpc-human-1",
        peptide: "bpc-157",
        peptideName: "BPC-157",
        evidence_type: "HUMAN_CLINICAL",
        source: "ClinicalTrials.gov / European Clinical Trial Registries",
        source_url: "https://clinicaltrials.gov/",
        publication_date: "2015-2024",
        population_or_model: "No completed human clinical trials in athletes or musculoskeletal injuries",
        claim: "Proven treatment for tendon, joint, or athletic injury recovery in humans",
        finding: "No adequate completed human clinical trials have been published validating BPC-157 for tendonitis, muscle healing, or athletic recovery.",
        limitations: "Early exploratory safety evaluations conducted in Europe for inflammatory bowel disease lack published Phase 3 randomized controlled trial verification.",
        evidence_status: "INSUFFICIENT",
        citation: "Clinical evidence is limited / No completed Phase 3 randomized controlled human trials located for musculoskeletal indications."
      },
      {
        id: "bpc-regulatory-1",
        peptide: "bpc-157",
        peptideName: "BPC-157",
        evidence_type: "REGULATORY",
        source: "WADA Prohibited List & US FDA Category 2 Bulks Evaluation",
        source_url: "https://www.wada-ama.org/en/prohibited-list",
        publication_date: "2022-2024",
        population_or_model: "Regulatory and anti-doping bodies",
        claim: "Approved pharmaceutical substance for human clinical therapy",
        finding: "BPC-157 is an unapproved research chemical, prohibited at all times in sport under WADA Category S0, and restricted by the FDA from compounding due to safety risks.",
        limitations: "Not approved by the FDA or EMA for any therapeutic indication.",
        evidence_status: "REGULATORY_APPROVED",
        citation: "World Anti-Doping Code Prohibited List (Category S0); FDA Category 2 Bulks Nominations."
      }
    ],
    summary: {
      anecdotal: "Some users report rapid relief from chronic joint pain and accelerated tendonitis healing, but these individual reports cannot establish efficacy or safety.",
      preclinical: "Research in Sprague-Dawley rodent and cell models shows accelerated collagen organization, tenocyte migration, and VEGFR2-mediated angiogenesis.",
      human: "No adequate human clinical trial evidence located. Controlled Phase 3 trials in human athletic populations have not been conducted.",
      bottomLine: "The evidence should be interpreted according to the strongest available evidence (preclinical animal data), not the volume of online bodybuilding testimonials."
    }
  },
  "tb-500": {
    peptideId: "tb-500",
    peptideName: "TB-500",
    records: [
      {
        id: "tb-anecdotal-1",
        peptide: "tb-500",
        peptideName: "TB-500",
        evidence_type: "ANECDOTAL",
        source: "Bodybuilding communities and athlete self-reports",
        source_url: "https://www.reddit.com/r/peptides/",
        publication_date: "2019-2026",
        population_or_model: "Online athletic logs and bodybuilding community discussions",
        claim: "Provides systemic full-body recovery, tendon repair, and reduced post-workout soreness",
        finding: "Online reports commonly describe improved flexibility, reduced joint inflammation, and faster bounce-back between heavy training sessions.",
        limitations: "Uncontrolled anecdotal experiences subject to placebo effect and lack objective clinical validation.",
        evidence_status: "COMMUNITY_REPORT",
        citation: "Athletic and Bodybuilding Community Discussions (Uncontrolled self-reports)"
      },
      {
        id: "tb-preclinical-1",
        peptide: "tb-500",
        peptideName: "TB-500",
        evidence_type: "PRECLINICAL",
        source: "Annals of the New York Academy of Sciences (Goldstein et al.)",
        source_url: "https://pubmed.ncbi.nlm.nih.gov/20536465/",
        publication_date: "2010",
        population_or_model: "Animal wound models and cell culture assays",
        claim: "Regulates actin sequestration and promotes endothelial cell migration for tissue repair",
        finding: "Thymosin Beta-4 sequesters G-actin, upregulates laminin-5, and accelerates dermal and myocardial tissue regeneration in animal models.",
        limitations: "Animal model healing does not demonstrate athletic recovery or musculoskeletal regeneration in healthy humans.",
        evidence_status: "VERIFIED",
        citation: "Goldstein AL, et al. Thymosin beta4: actin-sequestering protein and its multifunctional role in tissue repair. Ann N Y Acad Sci. 2010;1194:1-11."
      },
      {
        id: "tb-human-1",
        peptide: "tb-500",
        peptideName: "TB-500",
        evidence_type: "HUMAN_CLINICAL",
        source: "ClinicalTrials.gov",
        source_url: "https://clinicaltrials.gov/",
        publication_date: "2016-2024",
        population_or_model: "Human ophthalmic and dermal ulcer trials (Full Thymosin Beta-4)",
        claim: "Clinically proven systemic recovery peptide for athletic musculoskeletal injuries",
        finding: "Full-length Thymosin Beta-4 has been studied in human trials for dry eye syndrome and dermal ulcers, but no completed trials exist for TB-500 injections in athletic recovery.",
        limitations: "No completed human clinical trials evaluate systemic TB-500 fragment administration in healthy or athletic human subjects.",
        evidence_status: "INSUFFICIENT",
        citation: "No adequate human clinical trials located for systemic athletic recovery or tendon repair."
      }
    ],
    summary: {
      anecdotal: "Athletes commonly report reduced inflammation, improved joint mobility, and accelerated soft tissue recovery in gym forums.",
      preclinical: "Research in animal and in-vitro models found enhanced actin sequestration, endothelial cell migration, and accelerated wound closure.",
      human: "No completed human clinical trials have evaluated systemic TB-500 injections for athletic performance or muscle recovery.",
      bottomLine: "Scientific support is strictly preclinical; community discussions regarding athletic recovery remain unverified anecdotes."
    }
  },
  "cjc-1295": {
    peptideId: "cjc-1295",
    peptideName: "CJC-1295",
    records: [
      {
        id: "cjc-anecdotal-1",
        peptide: "cjc-1295",
        peptideName: "CJC-1295",
        evidence_type: "ANECDOTAL",
        source: "Bodybuilding communities and physique coaching logs",
        source_url: "https://www.reddit.com/r/peptides/",
        publication_date: "2018-2026",
        population_or_model: "Bodybuilding and physique athlete logs",
        claim: "Directly burns body fat, adds pure muscle mass, and deepens REM/slow-wave sleep",
        finding: "Lifters commonly report deeper sleep, enhanced vascularity, improved morning recovery, and mild fat loss, typically stacked with Ipamorelin.",
        limitations: "Subjective self-assessments with concurrent diet, training, and multiple compound variables.",
        evidence_status: "COMMUNITY_REPORT",
        citation: "Physique Community Discussions & Fitness Coaching Forums"
      },
      {
        id: "cjc-preclinical-1",
        peptide: "cjc-1295",
        peptideName: "CJC-1295",
        evidence_type: "PRECLINICAL",
        source: "Endocrinology (Castaigne et al.)",
        source_url: "https://pubmed.ncbi.nlm.nih.gov/16352683/",
        publication_date: "2005",
        population_or_model: "Mammalian pharmacokinetic rodent models",
        claim: "Bioconjugates with serum albumin to extend half-life to several days",
        finding: "Maleimidopropionic acid linker technology enabled irreversible binding to endogenous albumin, significantly prolonging bioactivity and GH secretion in animals.",
        limitations: "Preclinical bioconjugation kinetics require clinical pharmacokinetic validation.",
        evidence_status: "VERIFIED",
        citation: "Castaigne JP, et al. Prolonged half-life and extended growth hormone stimulation by albumin-conjugated GHRH analogs. Endocrinology. 2005."
      },
      {
        id: "cjc-human-1",
        peptide: "cjc-1295",
        peptideName: "CJC-1295",
        evidence_type: "HUMAN_CLINICAL",
        source: "Journal of Clinical Endocrinology & Metabolism (JCEM)",
        source_url: "https://pubmed.ncbi.nlm.nih.gov/16352683/",
        publication_date: "2006",
        population_or_model: "Human clinical trial (n=65 healthy adult subjects aged 21-50)",
        claim: "Elevates endogenous growth hormone and IGF-1 secretion while preserving pulsatility",
        finding: "A single subcutaneous injection of CJC-1295 produced sustained, dose-dependent 2-to-10 fold increases in GH and 1.5-to-3 fold increases in IGF-1 for 6 to 8 days.",
        limitations: "Demonstrated endocrine hormone kinetics; did not measure athletic performance, muscle hypertrophy, or body composition in athletes.",
        evidence_status: "VERIFIED",
        citation: "Teichman SL, et al. Prolonged stimulation of growth hormone (GH) and insulin-like growth factor I secretion by CJC-1295, a long-acting analog of GH-releasing hormone, in healthy adults. J Clin Endocrinol Metab. 2006;91(3):799-805."
      }
    ],
    summary: {
      anecdotal: "Lifters commonly report enhanced sleep depth, recovery, and subtle body recomposition when stacked with GHRPs.",
      preclinical: "Animal pharmacokinetic studies demonstrated extended plasma half-life via endogenous albumin bioconjugation.",
      human: "Clinical evidence in healthy human adults confirms prolonged pulsatile GH and IGF-1 elevation without shutting down normal pituitary rhythm.",
      bottomLine: "Endocrine GH elevation is clinically supported; direct body recomposition and athletic recovery claims rely primarily on community lore."
    }
  },
  "ipamorelin": {
    peptideId: "ipamorelin",
    peptideName: "Ipamorelin",
    records: [
      {
        id: "ipam-anecdotal-1",
        peptide: "ipamorelin",
        peptideName: "Ipamorelin",
        evidence_type: "ANECDOTAL",
        source: "Bodybuilding discussion boards and fitness communities",
        source_url: "https://www.reddit.com/r/peptides/",
        publication_date: "2019-2026",
        population_or_model: "Physique athletes and fitness enthusiasts",
        claim: "Builds lean muscle and burns fat without water bloat, gynecomastia, or extreme hunger",
        finding: 'Users describe it as the "cleanest" GHRP, reporting improved skin quality, faster training recovery, and quality sleep without ravenous appetite.',
        limitations: "Subjective anecdotes without standardized nutritional or training controls.",
        evidence_status: "COMMUNITY_REPORT",
        citation: "Bodybuilding & Fitness Community Discussions"
      },
      {
        id: "ipam-preclinical-1",
        peptide: "ipamorelin",
        peptideName: "Ipamorelin",
        evidence_type: "PRECLINICAL",
        source: "European Journal of Endocrinology (Raun et al.)",
        source_url: "https://pubmed.ncbi.nlm.nih.gov/9849822/",
        publication_date: "1998",
        population_or_model: "In-vitro rat pituitary cell cultures and rodent in-vivo assays",
        claim: "Highly selective GHRP that does not elevate ACTH, cortisol, or prolactin",
        finding: "Ipamorelin stimulated GH release with potency comparable to GHRP-6, but with no significant effect on ACTH, cortisol, or prolactin levels in animal models.",
        limitations: "Cellular receptor selectivity does not establish clinical athletic outcomes.",
        evidence_status: "VERIFIED",
        citation: "Raun K, et al. Ipamorelin, the first selective growth hormone secretagogue. Eur J Endocrinol. 1998;139(5):552-561."
      },
      {
        id: "ipam-human-1",
        peptide: "ipamorelin",
        peptideName: "Ipamorelin",
        evidence_type: "HUMAN_CLINICAL",
        source: "Pharmaceutical Research (Gobburu et al.)",
        source_url: "https://pubmed.ncbi.nlm.nih.gov/10496324/",
        publication_date: "1999",
        population_or_model: "Human clinical pharmacology study in healthy male volunteers",
        claim: "Selectively stimulates growth hormone in humans without endocrine stress hormone spikes",
        finding: "Pharmacodynamic modeling confirmed robust, dose-dependent GH release in healthy human volunteers without clinically significant elevations in cortisol or prolactin.",
        limitations: "Evaluated acute endocrine release; no clinical trial has evaluated long-term muscle growth or athletic performance.",
        evidence_status: "VERIFIED",
        citation: "Gobburu JV, et al. Pharmacokinetic-pharmacodynamic modeling of ipamorelin, a growth hormone releasing peptide, in human volunteers. Pharm Res. 1999;16(9):1412-1416."
      }
    ],
    summary: {
      anecdotal: "Physique athletes praise Ipamorelin for clean recovery and sleep support without water retention or uncontrollable hunger.",
      preclinical: "Extensive in-vitro and animal assays confirmed selective GHS-R1a binding without triggering ACTH or prolactin release.",
      human: "Clinical pharmacology studies in human volunteers establish potent, selective GH secretion with minimal cortisol elevation.",
      bottomLine: "Receptor selectivity and endocrine GH release are clinically validated; direct muscle-building claims remain community lore."
    }
  },
  "tesamorelin": {
    peptideId: "tesamorelin",
    peptideName: "Tesamorelin",
    records: [
      {
        id: "tesa-anecdotal-1",
        peptide: "tesamorelin",
        peptideName: "Tesamorelin",
        evidence_type: "ANECDOTAL",
        source: "Competitive bodybuilding forums and prep coaching circles",
        source_url: "https://www.reddit.com/r/peptides/",
        publication_date: "2020-2026",
        population_or_model: "Competitive bodybuilders and fitness competitors",
        claim: "Eliminates stubborn lower abdominal fat and tightens the waistline for competition",
        finding: "Competitors report dramatic reduction in midsection thickness and visceral tightness leading into bodybuilding shows.",
        limitations: "Anecdotes in physique athletes represent unapproved off-label use; effects fade upon cessation.",
        evidence_status: "COMMUNITY_REPORT",
        citation: "Competitive Physique Athlete Discussions"
      },
      {
        id: "tesa-preclinical-1",
        peptide: "tesamorelin",
        peptideName: "Tesamorelin",
        evidence_type: "PRECLINICAL",
        source: "Pharmacology and Experimental Therapeutics (Ferdinandi et al.)",
        source_url: "https://pubmed.ncbi.nlm.nih.gov/17392476/",
        publication_date: "2007",
        population_or_model: "Preclinical animal and in-vitro adipocyte lipolysis models",
        claim: "Selectively stimulates GHRH receptors and promotes lipolysis in deep visceral adipocytes",
        finding: "Hexenoyl modification provided resistance to enzymatic DPP-IV degradation while preserving high affinity for human pituitary GHRH receptors.",
        limitations: "Enzymatic stability data in animals preceded pivotal human registration trials.",
        evidence_status: "VERIFIED",
        citation: "Ferdinandi ES, et al. Preclinical pharmacokinetics of tesamorelin, a stabilized GHRH analog. J Pharmacol Exp Ther. 2007."
      },
      {
        id: "tesa-human-1",
        peptide: "tesamorelin",
        peptideName: "Tesamorelin",
        evidence_type: "HUMAN_CLINICAL",
        source: "New England Journal of Medicine (NEJM) (Falutz et al.)",
        source_url: "https://pubmed.ncbi.nlm.nih.gov/18057338/",
        publication_date: "2007-2010",
        population_or_model: "Phase 3 randomized, double-blind, placebo-controlled clinical trials (n=806 human adults)",
        claim: "Significantly reduces visceral adipose tissue (VAT) while preserving subcutaneous fat",
        finding: "Tesamorelin produced a statistically significant ~18% reduction in visceral abdominal fat in human patients with HIV-associated lipodystrophy, resulting in FDA approval (Egrifta).",
        limitations: "Studied in patients with HIV-associated abdominal lipodystrophy; visceral fat re-accumulates if therapy is discontinued.",
        evidence_status: "VERIFIED",
        citation: "Falutz J, et al. Effects of tesamorelin, a growth hormone-releasing factor analog, in patients with HIV-associated abdominal fat accumulation. N Engl J Med. 2007;357(23):2359-2370."
      },
      {
        id: "tesa-regulatory-1",
        peptide: "tesamorelin",
        peptideName: "Tesamorelin",
        evidence_type: "REGULATORY",
        source: "US Food and Drug Administration (FDA)",
        source_url: "https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=022505",
        publication_date: "2010",
        population_or_model: "FDA Approved Drug (NDA 022505 - Egrifta)",
        claim: "FDA-approved clinical therapeutic agent",
        finding: "Approved by the FDA specifically for the reduction of excess abdominal fat in HIV-infected patients with lipodystrophy.",
        limitations: "Approval is indication-specific; not approved for cosmetic weight loss or athletic enhancement.",
        evidence_status: "REGULATORY_APPROVED",
        citation: "FDA Approval Package: Egrifta (tesamorelin for injection). NDA 022505, 2010."
      }
    ],
    summary: {
      anecdotal: "Bodybuilders and fitness competitors report targeted reduction in abdominal visceral fullness during contest prep.",
      preclinical: "Animal studies confirmed resistance to DPP-IV degradation and selective lipolytic signaling in visceral fat deposits.",
      human: "Level A human clinical evidence (Phase 3 RCTs in NEJM, FDA approval) establishes an ~18% reduction in deep visceral abdominal fat.",
      bottomLine: "Human clinical evidence definitively proves visceral fat loss in studied cohorts; cosmetic athletic applications remain off-label."
    }
  },
  "tirzepatide": {
    peptideId: "tirzepatide",
    peptideName: "Tirzepatide",
    records: [
      {
        id: "tirz-anecdotal-1",
        peptide: "tirzepatide",
        peptideName: "Tirzepatide",
        evidence_type: "ANECDOTAL",
        source: "Bodybuilding cutting logs and fitness communities",
        source_url: "https://www.reddit.com/r/peptides/",
        publication_date: "2023-2026",
        population_or_model: "Athletes, bodybuilders, and fitness community members",
        claim: "Provides effortless contest prep dieting by completely wiping out hunger and cravings",
        finding: "Lifters report unprecedented appetite suppression and rapid fat loss, but emphasize the necessity of high protein and heavy lifting to avoid lean mass loss.",
        limitations: "Rapid weight loss can include lean tissue loss without disciplined resistance training and adequate dietary protein.",
        evidence_status: "COMMUNITY_REPORT",
        citation: "Bodybuilding & Fitness Cutting Discussions"
      },
      {
        id: "tirz-preclinical-1",
        peptide: "tirzepatide",
        peptideName: "Tirzepatide",
        evidence_type: "PRECLINICAL",
        source: "Cell Metabolism (Coskun et al.)",
        source_url: "https://pubmed.ncbi.nlm.nih.gov/30043758/",
        publication_date: "2018",
        population_or_model: "Diet-induced obese mouse models and in-vitro receptor assays",
        claim: "Dual GIP and GLP-1 receptor co-agonism produces synergistic metabolic and fat-loss effects",
        finding: "Tirzepatide demonstrated balanced dual agonism, driving greater weight loss, improved insulin sensitivity, and lipid clearance than selective GLP-1 agonists alone.",
        limitations: "Preclinical animal synergies served as the foundation for subsequent human clinical trials.",
        evidence_status: "VERIFIED",
        citation: "Coskun T, et al. LY3298176, a novel dual GIP and GLP-1 receptor agonist for the treatment of type 2 diabetes mellitus. Cell Metab. 2018;28(4):534-547."
      },
      {
        id: "tirz-human-1",
        peptide: "tirzepatide",
        peptideName: "Tirzepatide",
        evidence_type: "HUMAN_CLINICAL",
        source: "New England Journal of Medicine (NEJM) (Jastreboff et al. - SURMOUNT-1)",
        source_url: "https://pubmed.ncbi.nlm.nih.gov/35658024/",
        publication_date: "2022",
        population_or_model: "Phase 3 randomized, double-blind, placebo-controlled trial (n=2,539 human adults with obesity)",
        claim: "Produces substantial, clinically proven reductions in human body weight and adiposity",
        finding: "Tirzepatide demonstrated up to a 20.9% mean body weight reduction (average 52 lbs) over 72 weeks in human adults with obesity.",
        limitations: "Requires chronic administration; gastrointestinal adverse effects (nausea, constipation) are common.",
        evidence_status: "VERIFIED",
        citation: "Jastreboff AM, et al. Tirzepatide Once Weekly for the Treatment of Obesity. N Engl J Med. 2022;387(3):205-216."
      },
      {
        id: "tirz-regulatory-1",
        peptide: "tirzepatide",
        peptideName: "Tirzepatide",
        evidence_type: "REGULATORY",
        source: "US FDA",
        source_url: "https://www.accessdata.fda.gov/",
        publication_date: "2022-2023",
        population_or_model: "FDA Approved Drug (Mounjaro for T2D; Zepbound for chronic weight management)",
        claim: "FDA-approved pharmaceutical peptide for weight management",
        finding: "Approved by the FDA for glycemic control in T2D and chronic weight management in adults with obesity or overweight with comorbidities.",
        limitations: "Black box warning for thyroid C-cell tumors in rodents; contraindicated in MEN2.",
        evidence_status: "REGULATORY_APPROVED",
        citation: "FDA Approval Packages for Mounjaro (2022) and Zepbound (2023)."
      }
    ],
    summary: {
      anecdotal: "Athletes describe dramatic appetite suppression and effortless caloric restriction, noting the need to preserve muscle through high protein intake.",
      preclinical: "Rodent models established synergistic metabolic benefits of dual GIP and GLP-1 receptor activation.",
      human: "Level A human clinical evidence from large Phase 3 RCTs in the NEJM and FDA approvals establishes up to 20.9% average body weight loss.",
      bottomLine: "Fat loss is supported by the highest level of human clinical evidence; lifters must maintain resistance training to retain contractile lean mass."
    }
  },
  "semaglutide": {
    peptideId: "semaglutide",
    peptideName: "Semaglutide",
    records: [
      {
        id: "sema-anecdotal-1",
        peptide: "semaglutide",
        peptideName: "Semaglutide",
        evidence_type: "ANECDOTAL",
        source: "Bodybuilding communities and fitness forums",
        source_url: "https://www.reddit.com/r/peptides/",
        publication_date: "2021-2026",
        population_or_model: "Athletes and fitness community members",
        claim: "Facilitates extreme contest leanness by eliminating food cravings",
        finding: "Commonly used in cutting cycles to maintain strict caloric deficits; users caution about nausea and the risk of losing muscle fullness if calories drop too low.",
        limitations: "Unmonitored aggressive caloric deficits can accelerate skeletal muscle catabolism.",
        evidence_status: "COMMUNITY_REPORT",
        citation: "Bodybuilding & Fitness Cutting Discussions"
      },
      {
        id: "sema-preclinical-1",
        peptide: "semaglutide",
        peptideName: "Semaglutide",
        evidence_type: "PRECLINICAL",
        source: "Journal of Medicinal Chemistry (Lau et al.)",
        source_url: "https://pubmed.ncbi.nlm.nih.gov/26372551/",
        publication_date: "2015",
        population_or_model: "Porcine and rodent animal models",
        claim: "Albumin-binding fatty acid chain extends half-life to 1 week with potent hypothalamic satiety signaling",
        finding: "Demonstrated high affinity for the human GLP-1 receptor with enzymatic resistance to DPP-4 and extended half-life across animal species.",
        limitations: "Preclinical animal pharmacokinetics preceded human STEP registration trials.",
        evidence_status: "VERIFIED",
        citation: "Lau J, et al. Discovery of the Once-Weekly Glucagon-Like Peptide-1 (GLP-1) Analogue Semaglutide. J Med Chem. 2015;58(18):7370-7380."
      },
      {
        id: "sema-human-1",
        peptide: "semaglutide",
        peptideName: "Semaglutide",
        evidence_type: "HUMAN_CLINICAL",
        source: "New England Journal of Medicine (NEJM) (Wilding et al. - STEP 1)",
        source_url: "https://pubmed.ncbi.nlm.nih.gov/33567185/",
        publication_date: "2021",
        population_or_model: "Phase 3 randomized, double-blind, placebo-controlled trial (n=1,961 human adults)",
        claim: "Produces clinically proven substantial body weight and adipose reduction",
        finding: "Semaglutide 2.4 mg once weekly produced a mean 14.9% body weight reduction over 68 weeks in human adults with obesity.",
        limitations: "Gastrointestinal adverse effects (nausea, vomiting, diarrhea) occur in a substantial percentage of participants.",
        evidence_status: "VERIFIED",
        citation: "Wilding JPH, et al. Once-Weekly Semaglutide in Adults with Overweight or Obesity. N Engl J Med. 2021;384(11):989-1002."
      },
      {
        id: "sema-regulatory-1",
        peptide: "semaglutide",
        peptideName: "Semaglutide",
        evidence_type: "REGULATORY",
        source: "US FDA",
        source_url: "https://www.accessdata.fda.gov/",
        publication_date: "2017-2021",
        population_or_model: "FDA Approved Drug (Ozempic for T2D; Wegovy for chronic weight management)",
        claim: "FDA-approved pharmaceutical peptide for weight management and T2D",
        finding: "Approved by the FDA for glycemic control in T2D, cardiovascular event reduction, and chronic weight management in adults with obesity.",
        limitations: "Boxed warning for thyroid C-cell tumors in rodent studies; contraindicated with medullary thyroid carcinoma.",
        evidence_status: "REGULATORY_APPROVED",
        citation: "FDA Approval Packages for Ozempic (2017) and Wegovy (2021)."
      }
    ],
    summary: {
      anecdotal: "Lifters report strict appetite suppression enabling easy caloric deficits, with caution regarding potential loss of muscle fullness.",
      preclinical: "Animal models demonstrated selective hypothalamic satiety receptor activation and delayed gastric transit.",
      human: "Phase 3 randomized clinical trials in the NEJM and FDA approval establish a mean 14.9% body weight loss in clinical cohorts.",
      bottomLine: "Fat loss is supported by Level A human clinical evidence; lifters must prioritize adequate protein and strength training to retain muscle mass."
    }
  },
  "sermorelin": {
    peptideId: "sermorelin",
    peptideName: "Sermorelin",
    records: [
      {
        id: "sermo-anecdotal-1",
        peptide: "sermorelin",
        peptideName: "Sermorelin",
        evidence_type: "ANECDOTAL",
        source: "Anti-aging clinics and master lifter community forums",
        source_url: "https://www.reddit.com/r/peptides/",
        publication_date: "2018-2026",
        population_or_model: "Master lifters and wellness clinic patients",
        claim: "Restores youthful vitality, improves skin elasticity, and enhances workout recovery",
        finding: "Users frequently report better recovery from resistance training, deeper sleep, and improved morning joint comfort.",
        limitations: "Anecdotal testimonials from anti-aging clinic clients lack blinded clinical controls.",
        evidence_status: "COMMUNITY_REPORT",
        citation: "Master Lifter & Wellness Community Discussions"
      },
      {
        id: "sermo-preclinical-1",
        peptide: "sermorelin",
        peptideName: "Sermorelin",
        evidence_type: "PRECLINICAL",
        source: "Science (Guillemin et al.)",
        source_url: "https://pubmed.ncbi.nlm.nih.gov/6291151/",
        publication_date: "1982",
        population_or_model: "Preclinical mammalian pituitary receptor assays",
        claim: "Contains the complete biological activity of endogenous 44-amino acid GHRH",
        finding: "The 1-29 amino acid sequence was confirmed to retain full receptor binding affinity and biological potency of native human GHRH in animal models.",
        limitations: "Preclinical bioequivalence laid the groundwork for subsequent human pediatric and adult trials.",
        evidence_status: "VERIFIED",
        citation: "Guillemin R, et al. Growth hormone-releasing factor from a human pancreatic tumor that caused acromegaly. Science. 1982;218(4572):585-587."
      },
      {
        id: "sermo-human-1",
        peptide: "sermorelin",
        peptideName: "Sermorelin",
        evidence_type: "HUMAN_CLINICAL",
        source: "American Journal of Physiology (Corpas et al.)",
        source_url: "https://pubmed.ncbi.nlm.nih.gov/9082531/",
        publication_date: "1997",
        population_or_model: "Randomized clinical trial (n=38 healthy older men aged 60-78)",
        claim: "Stimulates pituitary GH secretion and elevates IGF-1 in human adults",
        finding: "Nightly sermorelin administration in healthy older men restored nocturnal GH peaks and significantly increased serum IGF-1 levels toward young adult levels.",
        limitations: "Demonstrated pituitary stimulation; did not demonstrate athletic hypertrophy or sports performance enhancement in healthy younger athletes.",
        evidence_status: "VERIFIED",
        citation: "Corpas E, et al. Continuous subcutaneous infusions of GHRH 1-29 stimulate growth hormone secretion in elderly men. Am J Physiol. 1997;272(3 Pt 1):E365-E373."
      },
      {
        id: "sermo-regulatory-1",
        peptide: "sermorelin",
        peptideName: "Sermorelin",
        evidence_type: "REGULATORY",
        source: "US FDA",
        source_url: "https://www.accessdata.fda.gov/",
        publication_date: "1997",
        population_or_model: "FDA Approved Drug (Geref - NDA 020443)",
        claim: "FDA approved for pediatric growth hormone deficiency and pituitary diagnostic testing",
        finding: "Originally approved by the FDA as Geref for the treatment of idiopathic growth hormone deficiency in children and evaluation of pituitary somatotroph function.",
        limitations: "Commercial manufacturing discontinued in 2008 for business reasons; widely compounded off-label in wellness and anti-aging medicine.",
        evidence_status: "REGULATORY_APPROVED",
        citation: "FDA Approved Drug: Geref (sermorelin acetate). NDA 020443."
      }
    ],
    summary: {
      anecdotal: "Master lifters and clinic clients report improved sleep depth, recovery, and joint comfort.",
      preclinical: "Animal and cell studies confirmed that the 1-29 fragment retains full biological activity of endogenous GHRH.",
      human: "Clinical trials in human adults establish that nightly administration stimulates pituitary GH release and elevates IGF-1 toward youthful levels.",
      bottomLine: "Pituitary secretagogue function is clinically proven; claims of significant muscle hypertrophy in healthy young athletes remain anecdotal."
    }
  },
  "ibutamoren-mk677": {
    peptideId: "ibutamoren-mk677",
    peptideName: "MK-677 (Ibutamoren)",
    records: [
      {
        id: "mk-anecdotal-1",
        peptide: "mk677",
        peptideName: "MK-677",
        evidence_type: "ANECDOTAL",
        source: "Bodybuilding forums and fitness logs",
        source_url: "https://www.reddit.com/r/peptides/",
        publication_date: "2017-2026",
        population_or_model: "Bodybuilders and fitness enthusiasts",
        claim: "Massive bulking compound that packs on 10 lbs of pure muscle quickly",
        finding: "Lifters commonly report intense hunger, major fullness/pumps, rapid scale weight gain, and deep sleep, often accompanied by swollen hands and fluid retention.",
        limitations: "Scale weight increases are heavily driven by intracellular and extracellular water retention rather than contractile muscle fibers.",
        evidence_status: "COMMUNITY_REPORT",
        citation: "Bodybuilding Community Bulking Discussions"
      },
      {
        id: "mk-preclinical-1",
        peptide: "mk677",
        peptideName: "MK-677",
        evidence_type: "PRECLINICAL",
        source: "Science (Patchett et al.)",
        source_url: "https://pubmed.ncbi.nlm.nih.gov/7541559/",
        publication_date: "1995",
        population_or_model: "In-vitro ghrelin receptor assays and rodent bioassays",
        claim: "Orally active non-peptide mimetic of the endogenous growth hormone secretagogue receptor",
        finding: "Demonstrated high oral bioavailability and potent, selective binding to the GHS-R1a receptor in animal models without steroid hormone cross-reactivity.",
        limitations: "Preclinical animal data demonstrated endocrine mechanism, not athletic hypertrophy.",
        evidence_status: "VERIFIED",
        citation: "Patchett AA, et al. Design and biological activities of L-163,191 (MK-0677): a potent, orally active growth hormone secretagogue. Proc Natl Acad Sci USA. 1995."
      },
      {
        id: "mk-human-1",
        peptide: "mk677",
        peptideName: "MK-677",
        evidence_type: "HUMAN_CLINICAL",
        source: "Annals of Internal Medicine (Nass et al.)",
        source_url: "https://pubmed.ncbi.nlm.nih.gov/18981485/",
        publication_date: "2008",
        population_or_model: "Two-year randomized, double-blind, placebo-controlled clinical trial (n=65 healthy older adults)",
        claim: "Increases fat-free mass and elevates sustained 24-hour GH and IGF-1 levels",
        finding: "Daily oral MK-677 sustained elevated GH and IGF-1 levels and increased fat-free mass by an average of 1.1 kg, but this did not result in increased muscle strength and was accompanied by increased fasting blood glucose and transient edema.",
        limitations: "The increase in fat-free mass was primarily intracellular water and connective tissue hydration rather than contractile myofibrillar hypertrophy.",
        evidence_status: "VERIFIED",
        citation: "Nass R, et al. Effects of an oral ghrelin mimetic on body composition and clinical outcomes in healthy older adults. Ann Intern Med. 2008;149(9):601-611."
      }
    ],
    summary: {
      anecdotal: "Users commonly report extreme appetite surges, intense gym pumps, and rapid scale weight increases accompanied by water retention.",
      preclinical: "Laboratory receptor assays confirmed oral bioavailability and high-affinity selective binding to the GHS-R1a receptor.",
      human: "Human clinical trials confirm sustained oral GH/IGF-1 elevation and an increase in fat-free mass, but this reflects fluid retention rather than contractile muscle hypertrophy.",
      bottomLine: "Endocrine elevation and water retention are clinically verified; claims of direct steroid-like muscle accretion are false."
    }
  }
};
function getStructuredEvidenceDossier(peptideId) {
  const normalized = peptideId.toLowerCase().replace(/[^a-z0-9]/g, "-");
  return DOSSIERS[normalized] || DOSSIERS[peptideId];
}
function buildFallbackEvidenceDossier(peptide) {
  return {
    peptideId: peptide.id,
    peptideName: peptide.name,
    records: [
      {
        id: `${peptide.id}-anecdotal-fallback`,
        peptide: peptide.id,
        peptideName: peptide.name,
        evidence_type: "ANECDOTAL",
        source: "Online bodybuilding forums and community discussions",
        publication_date: "2020-2026",
        population_or_model: "Online user reports (uncontrolled)",
        claim: `Discussed in fitness communities for potential ${peptide.classification} effects`,
        finding: `Some community members report subjective experiences with ${peptide.name}, though reports are uncontrolled and anecdotal.`,
        limitations: "These are individual reports, not clinical evidence and not proof of efficacy.",
        evidence_status: "COMMUNITY_REPORT",
        citation: "Community discussions and athlete self-reports"
      },
      {
        id: `${peptide.id}-preclinical-fallback`,
        peptide: peptide.id,
        peptideName: peptide.name,
        evidence_type: "PRECLINICAL",
        source: "Preclinical scientific literature",
        publication_date: "Peer-reviewed studies",
        population_or_model: "Cellular and animal experimental models",
        claim: `Mechanism of action: ${peptide.mechanism}`,
        finding: `Preclinical and laboratory research investigates ${peptide.name} via ${peptide.mechanism}`,
        limitations: "A result in an animal or laboratory model does not establish that the same effect occurs in humans.",
        evidence_status: "PRELIMINARY",
        citation: `Preclinical laboratory investigations for ${peptide.name}`
      },
      {
        id: `${peptide.id}-human-fallback`,
        peptide: peptide.id,
        peptideName: peptide.name,
        evidence_type: "HUMAN_CLINICAL",
        source: "Clinical trial registries",
        publication_date: "Current",
        population_or_model: "Human clinical populations",
        claim: "Evaluation of human clinical trials",
        finding: `No adequate large-scale completed human clinical trials have established therapeutic efficacy for ${peptide.name} in athletic populations.`,
        limitations: "Human clinical trials are limited or not located for sports performance.",
        evidence_status: "INSUFFICIENT",
        citation: "No adequate completed human clinical trial evidence located"
      }
    ],
    summary: {
      anecdotal: `Users report anecdotal experiences with ${peptide.name} in fitness communities, but individual reports cannot establish effectiveness or safety.`,
      preclinical: `Laboratory research investigates its biochemical mechanism (${peptide.mechanism}), but animal findings do not equal human proof.`,
      human: `No adequate human clinical trials located establishing athletic recovery or performance benefits in humans.`,
      bottomLine: `The evidence should be interpreted according to the strongest available evidence, not the volume of online testimonials.`
    }
  };
}

// server/peptide/peptideKnowledgeEngine.ts
var PeptideKnowledgeEngine = class _PeptideKnowledgeEngine {
  constructor() {
    this.peptides = /* @__PURE__ */ new Map();
    this.sessionStore = /* @__PURE__ */ new Map();
    this.storageFilePath = path.join(process.cwd(), "data", "peptides_store.json");
    this.initializeStore();
  }
  static getInstance() {
    if (!_PeptideKnowledgeEngine.instance) {
      _PeptideKnowledgeEngine.instance = new _PeptideKnowledgeEngine();
    }
    return _PeptideKnowledgeEngine.instance;
  }
  attachStructuredEvidence(peptide) {
    const dossier = getStructuredEvidenceDossier(peptide.id) || buildFallbackEvidenceDossier(peptide);
    return {
      ...peptide,
      structuredEvidence: dossier.records,
      evidenceSummary: dossier.summary
    };
  }
  initializeStore() {
    try {
      if (fs.existsSync(this.storageFilePath)) {
        const raw = fs.readFileSync(this.storageFilePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          parsed.forEach((p) => {
            const enriched = this.attachStructuredEvidence(p);
            this.peptides.set(enriched.id, enriched);
          });
          INITIAL_PEPTIDES.forEach((initP) => {
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
    } catch (err) {
      console.warn("[PeptideEngine] Could not load persisted peptide store, seeding initial database:", err.message);
    }
    INITIAL_PEPTIDES.forEach((p) => {
      const enriched = this.attachStructuredEvidence(p);
      this.peptides.set(enriched.id, enriched);
    });
    this.persistStore();
    console.log(`[PeptideEngine] Seeded ${this.peptides.size} peptides into knowledge engine.`);
  }
  // ─────────────────────────────────────────────────────────────────────────────
  // SESSION CONTEXT & SALES CONCIERGE HELPERS
  // ─────────────────────────────────────────────────────────────────────────────
  getSessionContext(sessionId = "default") {
    let session = this.sessionStore.get(sessionId);
    if (!session) {
      session = { discussedPeptides: [] };
      this.sessionStore.set(sessionId, session);
    }
    return session;
  }
  updateSessionContext(sessionId = "default", updates) {
    const current = this.getSessionContext(sessionId);
    const updated = {
      ...current,
      ...updates,
      discussedPeptides: updates.discussedPeptides ? Array.from(/* @__PURE__ */ new Set([...current.discussedPeptides, ...updates.discussedPeptides])) : current.discussedPeptides
    };
    this.sessionStore.set(sessionId, updated);
    return updated;
  }
  clearSessionContext(sessionId = "default") {
    this.sessionStore.delete(sessionId);
  }
  getWhatsAppNumber() {
    return process.env.PEPTIDE_SALES_WHATSAPP_NUMBER || "15557378433";
  }
  buildWhatsAppPrefill(peptideName, goal) {
    if (peptideName && goal) {
      return `Hi, I was researching ${peptideName} for ${goal} with the Peptide Specialist and I'd like to learn more about availability.`;
    }
    if (peptideName) {
      return `Hi, I was researching ${peptideName} with the Peptide Specialist and I'd like to learn more about availability.`;
    }
    return `Hi, I was researching peptides with the Peptide Specialist and I'd like to learn more about availability.`;
  }
  buildWhatsAppUrl(peptideName, goal) {
    const rawNumber = this.getWhatsAppNumber();
    const cleanNumber = rawNumber.replace(/[^0-9]/g, "");
    const prefill = encodeURIComponent(this.buildWhatsAppPrefill(peptideName, goal));
    return `https://wa.me/${cleanNumber}?text=${prefill}`;
  }
  detectPurchaseIntent(text) {
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
  detectResearchGoal(text) {
    const lower = text.toLowerCase();
    if (/\b(injury|injuries|tendon|ligament|tear|sprain|joint pain|rotator cuff)\b/i.test(lower)) {
      return "injury";
    }
    if (/\b(recovery|training recovery|recover faster|workout recovery|soreness|heal|healing)\b/i.test(lower)) {
      return "recovery";
    }
    if (/\b(fat loss|cutting|shredded|dieting|visceral fat|lose weight|leanness)\b/i.test(lower)) {
      return "fat_loss";
    }
    if (/\b(body composition|recomp|body recomposition|lean mass)\b/i.test(lower)) {
      return "body_composition";
    }
    if (/\b(muscle growth|hypertrophy|building muscle|build muscle|pack on muscle)\b/i.test(lower)) {
      return "muscle_growth";
    }
    return void 0;
  }
  getPeptideStructuredEvidence(peptideId) {
    const dossier = getStructuredEvidenceDossier(peptideId);
    if (dossier) return dossier.records;
    const peptide = this.getPeptideById(peptideId);
    if (peptide) return buildFallbackEvidenceDossier(peptide).records;
    return [];
  }
  getPeptideEvidenceSummary(peptideId) {
    const dossier = getStructuredEvidenceDossier(peptideId);
    if (dossier) return dossier.summary;
    const peptide = this.getPeptideById(peptideId);
    if (peptide) return buildFallbackEvidenceDossier(peptide).summary;
    return void 0;
  }
  persistStore() {
    try {
      const dir = path.dirname(this.storageFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = Array.from(this.peptides.values());
      fs.writeFileSync(this.storageFilePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.error("[PeptideEngine] Failed to persist peptide store:", err.message);
    }
  }
  // ─────────────────────────────────────────────────────────────────────────────
  // REPOSITORY / CRUD ADMINISTRATION
  // ─────────────────────────────────────────────────────────────────────────────
  getAllPeptides() {
    return Array.from(this.peptides.values());
  }
  getPeptideById(id) {
    return this.peptides.get(id.toLowerCase().trim());
  }
  findPeptideByName(query) {
    if (!query) return void 0;
    const clean = query.toLowerCase().trim();
    if (this.peptides.has(clean)) return this.peptides.get(clean);
    for (const record of this.peptides.values()) {
      if (record.name.toLowerCase() === clean) return record;
      if (record.commonNames.some((alias) => alias.toLowerCase() === clean)) return record;
    }
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
    return void 0;
  }
  createPeptide(record) {
    const id = record.id.toLowerCase().trim();
    if (this.peptides.has(id)) {
      throw new Error(`Peptide with id "${id}" already exists.`);
    }
    const fullRecord = {
      ...record,
      id,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.peptides.set(id, fullRecord);
    this.persistStore();
    return fullRecord;
  }
  updatePeptide(id, updates) {
    const cleanId = id.toLowerCase().trim();
    const existing = this.peptides.get(cleanId);
    if (!existing) {
      throw new Error(`Peptide "${cleanId}" not found.`);
    }
    const updated = {
      ...existing,
      ...updates,
      id: existing.id,
      // Preserve original ID
      updatedAt: Date.now()
    };
    this.peptides.set(cleanId, updated);
    this.persistStore();
    return updated;
  }
  deletePeptide(id) {
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
  evaluateSafety(text) {
    const lower = text.toLowerCase();
    const prescribingPatterns = [
      /\bhow much (should i|do i|to|would i) (take|inject|use|pin|dose|administer)\b/i,
      /\b(what dose|what dosage|how many mcg|how many mg|how to dose|what amount to (take|inject|use)|dosing protocol|dosing schedule)\b/i,
      /\b(prescribe|prescribe me|cycle for me|recommend a dose|how often should i inject|how to inject|how to take)\b/i,
      /\b(what cycle should i run|give me a cycle|best cycle for me|protocol for my)\b/i
    ];
    const isPrescribingRequest = prescribingPatterns.some((p) => p.test(lower));
    const emergentSymptomPatterns = [
      { name: "Difficulty Breathing / Shortness of Breath", pattern: /\b(can't breathe|cannot breathe|difficulty breathing|shortness of breath|gasping|wheezing severely|throat closing|suffocating)\b/i, severity: "EMERGENT" },
      { name: "Chest Pain / Angina", pattern: /\b(chest pain|pressure in chest|tightness in chest|radiating to arm|crushing chest|angina|heart racing irregularly)\b/i, severity: "EMERGENT" },
      { name: "Severe Allergic Reaction / Anaphylaxis", pattern: /\b(anaphylaxis|swollen tongue|lips swelling|face swollen|hives all over|throat swelling)\b/i, severity: "EMERGENT" },
      { name: "Loss of Consciousness / Syncope", pattern: /\b(passed out|blacked out|fainted|loss of consciousness|unresponsive)\b/i, severity: "EMERGENT" },
      { name: "Severe Hypoglycemia", pattern: /\b(severe hypoglycemia|shaking uncontrollably|profuse sweating and confusion|blood sugar 40|hypoglycemic collapse)\b/i, severity: "EMERGENT" },
      { name: "Severe Acute Abdominal Pain (Pancreatitis)", pattern: /\b(severe stomach pain|excruciating.*abdominal|severe.*abdominal|pancreatitis|pain radiating to back with vomiting)\b/i, severity: "URGENT" },
      { name: "Severe Neurological Symptoms", pattern: /\b(slurred speech|facial drooping|one-sided numbness|sudden severe headache|thunderclap headache)\b/i, severity: "EMERGENT" },
      { name: "Rapidly Worsening Symptoms", pattern: /\b(rapidly worsening|getting drastically worse|spreading quickly|sudden severe pain)\b/i, severity: "URGENT" }
    ];
    const detectedSymptoms = [];
    let highestSeverity = "NONE";
    for (const item of emergentSymptomPatterns) {
      if (item.pattern.test(lower)) {
        detectedSymptoms.push(item.name);
        if (item.severity === "EMERGENT") {
          highestSeverity = "EMERGENT";
        } else if (highestSeverity !== "EMERGENT" && item.severity === "URGENT") {
          highestSeverity = "URGENT";
        }
      }
    }
    let safetyGuidance = "";
    if (highestSeverity === "EMERGENT") {
      safetyGuidance = "If you are experiencing a medical emergency or symptoms that are severe or rapidly worsening, contact emergency medical services (such as 911) or go to the nearest emergency department immediately.";
    } else if (highestSeverity === "URGENT") {
      safetyGuidance = "Those symptoms can potentially be serious. You should seek prompt medical evaluation from a qualified healthcare professional.";
    }
    const prescribingGuidance = isPrescribingRequest ? "I am an educational peptide information specialist for the bodybuilding and performance community, not a doctor or prescribing clinician. I cannot provide personalized medical diagnoses, dosing schedules, cycle prescriptions, or personal peptide stacks. Any therapeutic regimen should be determined in consultation with your licensed healthcare provider." : void 0;
    return {
      hasEmergentSymptoms: highestSeverity !== "NONE",
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
  classifyClaim(text, contextPeptide) {
    const lower = text.toLowerCase();
    const peptide = contextPeptide || this.detectPeptideInText(text);
    let level = "LEVEL_E";
    let topic = "General Efficacy";
    let summary = "There isn't enough reliable evidence to say that this benefit is established.";
    let caveats = ["Limited published peer-reviewed human literature."];
    let matchingSources = [];
    if (!peptide) {
      return {
        claimTopic: "Unrecognized Peptide Claim",
        evidenceLevel: "LEVEL_E",
        recommendedLanguage: "There isn't enough reliable evidence to say that this benefit is established.",
        evidenceSummary: "I don't have enough reliable evidence to give you a factual answer about that compound.",
        caveats: ["Unrecognized substance in knowledge base."],
        matchingSources: [],
        isAnecdotal: false,
        isPreclinical: false,
        isClinicallySupported: false,
        isUnknown: true
      };
    }
    let bestClaim = peptide.claims.find((c) => {
      const claimLower = c.claim.toLowerCase();
      const descLower = c.description.toLowerCase();
      const keywords = lower.split(/\s+/).filter((w) => w.length > 3);
      return keywords.some((k) => claimLower.includes(k) || descLower.includes(k));
    });
    let heuristicMatched = false;
    if (peptide.id === "tirzepatide") {
      if (lower.includes("weight") || lower.includes("fat loss") || lower.includes("obesity") || lower.includes("diabetes") || lower.includes("a1c") || lower.includes("benefit")) {
        level = "LEVEL_A";
        topic = "Weight Management & Glycemic Control";
        summary = "Human clinical research in Phase 3 SURMOUNT and SURPASS trials has demonstrated substantial, clinically supported weight loss (up to 20-22%) and HbA1c reductions.";
        matchingSources = peptide.sources.filter((s) => s.evidenceLevel === "LEVEL_A");
        heuristicMatched = true;
      } else if (lower.includes("nausea") || lower.includes("vomit") || lower.includes("side effect") || lower.includes("diarrhea") || lower.includes("adverse")) {
        level = "LEVEL_A";
        topic = "Gastrointestinal Adverse Effects";
        summary = "Gastrointestinal effects (nausea, diarrhea, constipation) are established adverse effects documented in clinical trials, typically mild-to-moderate during dose titration.";
        heuristicMatched = true;
      }
    } else if (peptide.id === "semaglutide") {
      if (lower.includes("weight") || lower.includes("cardio") || lower.includes("stroke") || lower.includes("heart") || lower.includes("benefit") || lower.includes("diabetes")) {
        level = "LEVEL_A";
        topic = "Cardiovascular Risk Reduction & Weight Management";
        summary = "Clinical evidence from Phase 3 STEP and SELECT trials establishes significant weight loss (approx. 15%) and a 20% reduction in major adverse cardiovascular events.";
        matchingSources = peptide.sources.filter((s) => s.evidenceLevel === "LEVEL_A");
        heuristicMatched = true;
      }
    } else if (peptide.id === "tesamorelin") {
      if (lower.includes("permanent") || lower.includes("forever") || lower.includes("never come back") || lower.includes("never comes back")) {
        level = "LEVEL_E";
        topic = "Permanence of Fat Loss";
        summary = "There isn't enough reliable evidence to say that this benefit is established. In fact, clinical evidence shows that visceral fat re-accumulates after therapy is discontinued.";
        heuristicMatched = true;
      } else if (lower.includes("visceral") || lower.includes("belly fat") || lower.includes("hiv") || lower.includes("benefit")) {
        level = "LEVEL_A";
        topic = "Visceral Adipose Tissue Reduction";
        summary = "There is clinical evidence supporting the reduction of excess visceral abdominal fat, established in Phase 3 multicenter human trials published in the NEJM.";
        matchingSources = peptide.sources.filter((s) => s.evidenceLevel === "LEVEL_A");
        heuristicMatched = true;
      }
    } else if (peptide.id === "bpc-157") {
      if (lower.includes("tendon") || lower.includes("ligament") || lower.includes("muscle") || lower.includes("injury") || lower.includes("wound") || lower.includes("heal") || lower.includes("benefit") || lower.includes("what is") || lower.includes("what does") || lower.includes("tell me about")) {
        if (lower.includes("clinically proven") || lower.includes("human trial") || lower.includes("athlete") || lower.includes("cure")) {
          level = "LEVEL_D";
          topic = "Human Orthopedic Injury Healing";
          summary = "Some people report rapid joint and tendon repair, but that's anecdotal evidence rather than clinical evidence. This has been investigated in preclinical research, but that doesn't establish the same effect in humans.";
        } else {
          level = "LEVEL_C";
          topic = "Angiogenesis and Preclinical Soft Tissue Repair";
          summary = "This has been investigated in preclinical research involving animal models, but that doesn't establish a demonstrated human clinical benefit.";
          matchingSources = peptide.sources.filter((s) => s.evidenceLevel === "LEVEL_C");
        }
        heuristicMatched = true;
      }
    } else if (peptide.id === "tb-500") {
      if (lower.includes("heal") || lower.includes("tendon") || lower.includes("injury") || lower.includes("wolverine") || lower.includes("benefit")) {
        level = "LEVEL_C";
        topic = "Cell Migration and Preclinical Wound Healing";
        summary = "This has been investigated in preclinical research for cellular migration and wound repair, but that doesn't establish a demonstrated human clinical benefit in musculoskeletal injuries.";
        matchingSources = peptide.sources.filter((s) => s.evidenceLevel === "LEVEL_C");
        heuristicMatched = true;
      }
    } else if (peptide.id === "ghk-cu") {
      if (lower.includes("skin") || lower.includes("wrinkle") || lower.includes("collagen") || lower.includes("elasticity")) {
        level = "LEVEL_A";
        topic = "Topical Skin Rejuvenation & Collagen Synthesis";
        summary = "There is clinical evidence supporting topical GHK-Cu for improving skin firmness, elasticity, and collagen production in human cosmetic trials.";
        matchingSources = peptide.sources.filter((s) => s.evidenceLevel === "LEVEL_A");
        heuristicMatched = true;
      } else if (lower.includes("reverse aging") || lower.includes("longevity") || lower.includes("injection")) {
        level = "LEVEL_D";
        topic = "Systemic Longevity & Rejuvenation";
        summary = "Some people report whole-body rejuvenation from injections, but that's anecdotal evidence rather than clinical evidence.";
        heuristicMatched = true;
      }
    } else if (peptide.id === "ibutamoren-mk677") {
      if (lower.includes("igf") || lower.includes("lean mass") || lower.includes("bone") || lower.includes("benefit")) {
        level = "LEVEL_A";
        topic = "IGF-1 Elevation & Fat-Free Mass";
        summary = "Human clinical research has found that oral MK-677 produces sustained 24-hour elevations in serum GH and IGF-1 and increases fat-free mass.";
        matchingSources = peptide.sources.filter((s) => s.evidenceLevel === "LEVEL_A");
        heuristicMatched = true;
      } else if (lower.includes("appetite") || lower.includes("hunger") || lower.includes("water") || lower.includes("blood sugar") || lower.includes("side effect")) {
        level = "LEVEL_A";
        topic = "Established Metabolic Adverse Effects";
        summary = "Increased appetite, lower extremity edema, and elevated fasting blood glucose are established clinical adverse effects of MK-677.";
        heuristicMatched = true;
      }
    } else if (peptide.id === "kisspeptin") {
      if (lower.includes("lh") || lower.includes("fsh") || lower.includes("testosterone") || lower.includes("ivf") || lower.includes("benefit")) {
        level = "LEVEL_A";
        topic = "Hypothalamic-Pituitary-Gonadal Axis Stimulation";
        summary = "Human clinical research has found that Kisspeptin stimulates pulsatile LH and FSH secretion, and triggers safe oocyte maturation in clinical IVF trials.";
        matchingSources = peptide.sources.filter((s) => s.evidenceLevel === "LEVEL_A");
        heuristicMatched = true;
      } else if (lower.includes("pct") || lower.includes("bodybuilding cycle")) {
        level = "LEVEL_D";
        topic = "Post-Cycle Therapy in Bodybuilders";
        summary = "Some people in athletic communities report using kisspeptin for post-cycle recovery, but that's anecdotal evidence rather than clinical evidence.";
        heuristicMatched = true;
      }
    } else if (peptide.id === "cjc-1295") {
      if (lower.includes("gh") || lower.includes("growth hormone") || lower.includes("igf")) {
        level = "LEVEL_B";
        topic = "Endogenous Growth Hormone Pulsatility";
        summary = "There is some human research demonstrating sustained GH and IGF-1 elevations, but large-scale clinical development was discontinued and evidence remains limited.";
        matchingSources = peptide.sources.filter((s) => s.evidenceLevel === "LEVEL_B");
        heuristicMatched = true;
      } else if (lower.includes("fat") || lower.includes("gym") || lower.includes("muscle") || lower.includes("recovery")) {
        level = "LEVEL_D";
        topic = "Athletic Recovery & Body Composition";
        summary = "Some people report experiencing enhanced gym recovery and fat loss, but that's anecdotal evidence rather than clinical evidence.";
        heuristicMatched = true;
      }
    } else if (peptide.id === "ipamorelin") {
      if (lower.includes("selective") || lower.includes("cortisol") || lower.includes("prolactin")) {
        level = "LEVEL_A";
        topic = "Selective GHRP Pharmacology";
        summary = "Human and animal pharmacology studies confirm selective GH secretion without clinically significant increases in cortisol or prolactin.";
        matchingSources = peptide.sources.filter((s) => s.evidenceLevel === "LEVEL_A");
        heuristicMatched = true;
      } else if (lower.includes("muscle") || lower.includes("shred") || lower.includes("fat")) {
        level = "LEVEL_D";
        topic = "Bodybuilding Fat Loss and Muscle Growth";
        summary = "Some people report body recomposition benefits, but that's anecdotal evidence rather than clinical evidence.";
        heuristicMatched = true;
      }
    } else if (peptide.id === "follistatin-344") {
      if (lower.includes("myostatin") || lower.includes("gene therapy") || lower.includes("becker")) {
        level = "LEVEL_B";
        topic = "Myostatin Antagonism in Gene Therapy";
        summary = "Early clinical research investigated follistatin gene therapy in Becker muscular dystrophy, but evidence is limited and does not establish benefits for healthy athletes.";
        matchingSources = peptide.sources.filter((s) => s.evidenceLevel === "LEVEL_B");
        heuristicMatched = true;
      } else if (lower.includes("vial") || lower.includes("peptide") || lower.includes("bodybuilding") || lower.includes("muscle")) {
        level = "LEVEL_D";
        topic = "Commercial Peptide Vial Anabolism";
        summary = "Reports of muscle building from commercial peptide vials are anecdotal and unverified; recombinant follistatin is unstable and lacks human clinical trials in athletes.";
        heuristicMatched = true;
      }
    }
    if (!heuristicMatched && bestClaim && level === "LEVEL_E") {
      level = bestClaim.evidenceLevel;
      topic = bestClaim.claim;
      summary = bestClaim.description;
      caveats = [bestClaim.limitations];
      matchingSources = peptide.sources.filter((s) => bestClaim.sourceIds.includes(s.id));
    }
    let recommendedLanguage = "";
    switch (level) {
      case "LEVEL_A":
        recommendedLanguage = "There is clinical evidence supporting this...";
        break;
      case "LEVEL_B":
        recommendedLanguage = "There is some human research, but the evidence is still limited.";
        break;
      case "LEVEL_C":
        recommendedLanguage = "This has been investigated in preclinical research, but that doesn't establish the same effect in humans.";
        break;
      case "LEVEL_D":
        recommendedLanguage = "Some people report experiencing this, but that's anecdotal evidence rather than clinical evidence.";
        break;
      case "LEVEL_E":
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
      isAnecdotal: level === "LEVEL_D",
      isPreclinical: level === "LEVEL_C",
      isClinicallySupported: level === "LEVEL_A",
      isUnknown: level === "LEVEL_E"
    };
  }
  detectPeptideInText(text) {
    const lower = text.toLowerCase();
    const nameMap = [
      { pattern: /\b(cjc[- ]?1295|mod[- ]?grf|dac:grf)\b/i, id: "cjc-1295" },
      { pattern: /\b(ipamorelin|nnc[- ]?26[- ]?0161)\b/i, id: "ipamorelin" },
      { pattern: /\b(sermorelin|geref|ghrh[- ]?1[- ]?29)\b/i, id: "sermorelin" },
      { pattern: /\b(tesamorelin|egrifta|th[- ]?9507)\b/i, id: "tesamorelin" },
      { pattern: /\b(ghrp[- ]?6)\b/i, id: "ghrp-6" },
      { pattern: /\b(ghrp[- ]?2|pralmorelin)\b/i, id: "ghrp-2" },
      { pattern: /\b(hexarelin|ep[- ]?23959)\b/i, id: "hexarelin" },
      { pattern: /\b(mk[- ]?677|ibutamoren|nutrobal)\b/i, id: "ibutamoren-mk677" },
      { pattern: /\b(examorelin)\b/i, id: "examorelin" },
      { pattern: /\b(bpc[- ]?157|bepecin|pl[- ]?14736)\b/i, id: "bpc-157" },
      { pattern: /\b(tb[- ]?500|thymosin beta[- ]?4|tβ4)\b/i, id: "tb-500" },
      { pattern: /\b(ghk[- ]?cu|copper peptide|copper tripeptide)\b/i, id: "ghk-cu" },
      { pattern: /\b(kpv|lys[- ]?pro[- ]?val)\b/i, id: "kpv" },
      { pattern: /\b(tirzepatide|mounjaro|zepbound)\b/i, id: "tirzepatide" },
      { pattern: /\b(semaglutide|ozempic|wegovy|rybelsus)\b/i, id: "semaglutide" },
      { pattern: /\b(retatrutide|triple g|ly3437943)\b/i, id: "retatrutide" },
      { pattern: /\b(mots[- ]?c)\b/i, id: "mots-c" },
      { pattern: /\b(igf[- ]?1[- ]?lr3|long[- ]?r3|long r3 igf)\b/i, id: "igf-1-lr3" },
      { pattern: /\b(follistatin|fs[- ]?344|fst[- ]?344)\b/i, id: "follistatin-344" },
      { pattern: /\b(kisspeptin|kisspeptin[- ]?10|kisspeptin[- ]?54)\b/i, id: "kisspeptin" }
    ];
    for (const item of nameMap) {
      if (item.pattern.test(lower)) {
        return this.peptides.get(item.id);
      }
    }
    return void 0;
  }
  // ─────────────────────────────────────────────────────────────────────────────
  // GROUNDED FACTUAL Q&A RESPONSE GENERATOR
  // ─────────────────────────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────────
  query(queryText, sessionId = "default") {
    const lower = queryText.toLowerCase();
    const detectedGoal = this.detectResearchGoal(queryText);
    if (detectedGoal) {
      this.updateSessionContext(sessionId, {
        primaryInterest: detectedGoal,
        interestTopicName: detectedGoal.replace("_", " ")
      });
    }
    const priorSession = this.getSessionContext(sessionId);
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
    const isSellerQuery = /\b(do you sell|can you sell|can i buy from you|are you the seller|do you have.*in stock|is it in stock|in stock|do you carry)\b/i.test(lower);
    if (isSellerQuery) {
      return {
        answer: "I cannot sell you peptides or confirm product inventory. I am an AI peptide research and evidence specialist. For availability, purchasing information, or questions about the supplier's products, contact the peptide team directly on WhatsApp.",
        peptide,
        evidenceClassification: {
          claimTopic: "Supplier & Sales Boundary",
          evidenceLevel: "LEVEL_E",
          recommendedLanguage: "For availability and purchasing, contact the peptide team on WhatsApp.",
          evidenceSummary: "The AI assists with research and evidence, directing purchase inquiries to WhatsApp.",
          caveats: ["The AI is not a vendor or dispensing pharmacy."],
          matchingSources: [],
          isAnecdotal: false,
          isPreclinical: false,
          isClinicallySupported: false,
          isUnknown: false
        },
        safety,
        sources: peptide ? peptide.sources : [],
        evidenceSummary: peptide ? this.getPeptideEvidenceSummary(peptide.id) : void 0,
        structuredEvidence: peptide ? this.getPeptideStructuredEvidence(peptide.id) : void 0,
        salesHandoff: {
          isPurchaseIntent: true,
          intentPhrase: "Supplier sales inquiry",
          whatsappNumber: this.getWhatsAppNumber(),
          whatsappUrl: this.buildWhatsAppUrl(peptide?.name, session.primaryInterest),
          prefilledMessage: this.buildWhatsAppPrefill(peptide?.name, session.primaryInterest),
          ctaText: "WHATSAPP THE PEPTIDE TEAM"
        },
        sessionContext: session
      };
    }
    const purchaseIntent = this.detectPurchaseIntent(queryText);
    if (purchaseIntent.isPurchaseIntent) {
      return {
        answer: "I can help you research the peptide science. For current availability, pricing, and purchasing directly with the supplier, you can connect with the peptide team on WhatsApp.",
        peptide,
        evidenceClassification: {
          claimTopic: "Purchase & Availability Inquiry",
          evidenceLevel: "LEVEL_E",
          recommendedLanguage: "Contact the peptide team on WhatsApp for availability and purchasing.",
          evidenceSummary: "Conversational purchase intent detected. Handing off to WhatsApp supplier channel.",
          caveats: [],
          matchingSources: [],
          isAnecdotal: false,
          isPreclinical: false,
          isClinicallySupported: false,
          isUnknown: false
        },
        safety,
        sources: peptide ? peptide.sources : [],
        evidenceSummary: peptide ? this.getPeptideEvidenceSummary(peptide.id) : void 0,
        structuredEvidence: peptide ? this.getPeptideStructuredEvidence(peptide.id) : void 0,
        salesHandoff: {
          isPurchaseIntent: true,
          intentPhrase: purchaseIntent.match || queryText,
          whatsappNumber: this.getWhatsAppNumber(),
          whatsappUrl: this.buildWhatsAppUrl(peptide?.name, session.primaryInterest),
          prefilledMessage: this.buildWhatsAppPrefill(peptide?.name, session.primaryInterest),
          ctaText: "WHATSAPP THE PEPTIDE TEAM"
        },
        sessionContext: session
      };
    }
    const isDiscoveryPrompt = /\b(what should i take|where do i start|help me choose|recommend a peptide|what's best for me|where should i begin)\b/i.test(lower);
    if (isDiscoveryPrompt && !peptide) {
      return {
        answer: "Alright, let's figure out what you're looking to achieve. What are you mainly researching\u2014recovery, body composition, performance, or something else?",
        peptide: void 0,
        evidenceClassification: {
          claimTopic: "Research Discovery",
          evidenceLevel: "LEVEL_E",
          recommendedLanguage: "What are you mainly researching?",
          evidenceSummary: "Discovery qualification to understand the visitor research objectives.",
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
          whatsappUrl: this.buildWhatsAppUrl(void 0, session.primaryInterest),
          prefilledMessage: this.buildWhatsAppPrefill(void 0, session.primaryInterest),
          ctaText: "WHATSAPP THE PEPTIDE TEAM"
        },
        sessionContext: session
      };
    }
    const isDirectYNAQuery = /\b(yournewauto|your new auto)\b/i.test(lower);
    if (isDirectYNAQuery) {
      return {
        answer: "I am an AI peptide information specialist. I am not affiliated with YourNewAuto or any automotive service.",
        peptide: void 0,
        evidenceClassification: {
          claimTopic: "Agent Identity Inquiry",
          evidenceLevel: "LEVEL_E",
          recommendedLanguage: "I am a peptide information specialist.",
          evidenceSummary: "The agent identifies as a specialized peptide information assistant.",
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
        peptide: void 0,
        evidenceClassification: {
          claimTopic: "Automotive / Non-Peptide Domain Inquiry",
          evidenceLevel: "LEVEL_E",
          recommendedLanguage: "I do not handle vehicle sales or financing.",
          evidenceSummary: "Cross-vertical inquiry rejected. The agent exclusively provides peptide information.",
          caveats: ["Non-peptide domain inquiry."],
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
    const isCompanyIdentityQuery = /\b(what company|who do you work for)\b/i.test(lower);
    if (isCompanyIdentityQuery) {
      return {
        answer: "I am an independent AI peptide information specialist dedicated to evidence-based education on peptides, their clinical research, potential benefits, and safety profiles.",
        peptide: void 0,
        evidenceClassification: {
          claimTopic: "Agent Identity Inquiry",
          evidenceLevel: "LEVEL_E",
          recommendedLanguage: "I am a peptide information specialist.",
          evidenceSummary: "The agent identifies as a specialized peptide information assistant.",
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
        peptide: void 0,
        evidenceClassification: {
          claimTopic: "Agent Identity",
          evidenceLevel: "LEVEL_E",
          recommendedLanguage: "Alright. I'm your peptide information specialist.",
          evidenceSummary: "The agent is an 80s Golden Era bodybuilding peptide information specialist.",
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
    const isStackOrDosing = /\b(stack|dosing protocol|dosing schedule|how to stack|what stack|give me a stack|give me a peptide stack|cycle for me|how should i inject|how much should i take)\b/i.test(lower);
    if (isStackOrDosing) {
      return {
        answer: "I am an educational peptide information specialist for the bodybuilding and performance community, not a prescribing clinician or personal dosing coach. I cannot generate individualized dosing protocols, injection instructions, or personal peptide stacks. I can, however, break down what the scientific literature investigates regarding these compounds, their physiological mechanisms, and their known safety considerations.",
        peptide: peptide || void 0,
        evidenceClassification: {
          claimTopic: "Personal Dosing & Stacking Request",
          evidenceLevel: "LEVEL_E",
          recommendedLanguage: "I cannot generate personal dosing protocols or stacks.",
          evidenceSummary: "Personalized medical prescribing and stacking protocols are outside educational bounds.",
          caveats: ["Individualized medical dosing requires licensed clinical supervision."],
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
    const isBodybuilderIntro = /\b(competitive bodybuilder|i'm a bodybuilder|i am a bodybuilder|physique athlete)\b/i.test(lower);
    if (isBodybuilderIntro && (lower.includes("recovery") || lower.includes("peptides"))) {
      const bpc = this.peptides.get("bpc-157");
      return {
        answer: "Understood. For competitive bodybuilders and physique athletes, recovery research primarily focuses on BPC-157 and TB-500 for soft tissue, tendon, and ligament repair, alongside growth hormone secretagogues like Ipamorelin and CJC-1295 for systemic recovery and sleep quality. It is critical to separate what has actual human clinical evidence from what is strictly preclinical or circulating as an unverified bodybuilding community claim. BPC-157 and TB-500 have demonstrated tissue healing and angiogenesis in animal and cellular studies, but they lack completed human clinical trials. What specific compound or recovery target are you looking into?",
        peptide: bpc,
        evidenceClassification: {
          claimTopic: "Competitive Bodybuilding Recovery Research",
          evidenceLevel: "LEVEL_C",
          recommendedLanguage: "This has been investigated in preclinical research, but human clinical efficacy is unproven.",
          evidenceSummary: "Preclinical animal studies investigate soft tissue and tendon healing (BPC-157, TB-500), but human clinical evidence remains unproven.",
          caveats: ["Preclinical evidence does not establish clinical human efficacy in athletes."],
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
    const isLookingAtRecovery = /\b(i'm looking at peptides for recovery|looking at peptides for recovery|peptides for recovery|looking for recovery peptides)\b/i.test(lower);
    if (isLookingAtRecovery && (!peptide || peptide.id === "bpc-157")) {
      const bpc = this.peptides.get("bpc-157");
      return {
        answer: "Yeah, recovery is one of the biggest areas where peptides come up in the bodybuilding scene. BPC-157 is probably one of the names you'll run into, along with some of the other compounds people discuss around training recovery and soft-tissue issues.\n\nA lot of the interest comes from individual reports from lifters and athletes.\n\nWhat specifically are you researching \u2014 general recovery, an old injury, training volume, or something else?",
        peptide: bpc,
        evidenceClassification: {
          claimTopic: "Recovery Peptides in Bodybuilding",
          evidenceLevel: "LEVEL_D",
          recommendedLanguage: "A lot of the interest comes from individual reports from lifters and athletes.",
          evidenceSummary: "Recovery compounds are widely discussed in bodybuilding communities based on user experiences.",
          caveats: ["Individual reports do not equal clinical proof."],
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
    const isRecoveryQuery = /\b(recovery|training recovery|healing|tissue repair)\b/i.test(lower) && (lower.includes("researching for recovery") || lower.includes("peptides are people") || lower.includes("from training") || lower.includes("about recovery") || lower.includes("what peptides"));
    if (isRecoveryQuery && (!peptide || peptide.id === "bpc-157" || peptide.id === "tb-500")) {
      const bpc = this.peptides.get("bpc-157");
      return {
        answer: "In bodybuilding and athletic communities, the primary peptides researched for recovery are BPC-157 and TB-500 for localized soft tissue and tendon repair, along with GH secretagogues like CJC-1295 and Ipamorelin for systemic recovery and deep sleep. Preclinical research in animal models indicates BPC-157 promotes angiogenesis and collagen organization in damaged tendons, but there are no completed human clinical trials proving these benefits in athletes. In contrast, secretagogues have human pharmacokinetic data for elevating GH pulses, but recovery claims remain largely supported by community anecdotes.",
        peptide: bpc,
        evidenceClassification: {
          claimTopic: "Peptides for Training Recovery",
          evidenceLevel: "LEVEL_C",
          recommendedLanguage: "This has been investigated in preclinical research, but that does not establish human clinical proof.",
          evidenceSummary: "BPC-157 and TB-500 have preclinical animal evidence for tissue repair; human clinical evidence is not established.",
          caveats: ["Preclinical animal findings do not translate directly to human athletic recovery."],
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
    const isCjcVsIpam = (lower.includes("cjc") || lower.includes("cjc-1295") || lower.includes("cjc 1295")) && (lower.includes("ipamorelin") || lower.includes("difference") || lower.includes("compare"));
    if (isCjcVsIpam) {
      const cjc = this.peptides.get("cjc-1295");
      return {
        answer: "The fundamental physiological difference between CJC-1295 and Ipamorelin lies in their receptor pathways: CJC-1295 is a Growth Hormone-Releasing Hormone (GHRH) analog that acts on pituitary GHRH receptors to amplify the natural pulsatile release of growth hormone. Ipamorelin is a selective Growth Hormone Secretagogue (GHRP) that binds to the ghrelin / GHS-R1a receptor to trigger acute GH release without spiking cortisol, prolactin, or appetite. In bodybuilding research, they are frequently paired because combining a GHRH with a GHRP produces a synergistic, supra-additive growth hormone pulse by stimulating release while blunting somatostatin inhibition.",
        peptide: cjc,
        evidenceClassification: {
          claimTopic: "GHRH vs GHRP Receptor Mechanism",
          evidenceLevel: "LEVEL_A",
          recommendedLanguage: "Pharmacological and clinical research demonstrates distinct receptor targets...",
          evidenceSummary: "Pharmacological studies confirm CJC-1295 acts at GHRH receptors, while Ipamorelin acts selectively at GHS-R1a without cortisol/prolactin elevation.",
          caveats: ["Long-term athletic enhancement is not approved by regulatory bodies."],
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
    const isClinicalListQuery = /\b(which peptides have human clinical evidence|peptides.*human clinical evidence|peptides.*human trials|which.*human evidence|clinically proven peptides|what is actually proven)\b/i.test(lower);
    if (isClinicalListQuery && !peptide) {
      const tirz = this.peptides.get("tirzepatide");
      return {
        answer: "Peptides with robust Human Clinical Evidence (Level A, supported by randomized Phase 3 clinical trials and FDA approvals) include: Tirzepatide (SURMOUNT trials for metabolic regulation and body fat loss), Semaglutide (STEP trials for fat reduction and cardiovascular risk), Tesamorelin (Phase 3 NEJM trials for reducing visceral abdominal fat in HIV lipodystrophy), and Sermorelin (FDA-approved GHRH analog for pituitary stimulation). In contrast, popular bodybuilding compounds like BPC-157 and TB-500 have only Preclinical evidence (animal models), and commercial Follistatin claims remain unverified Bodybuilding Community Claims.",
        peptide: tirz,
        evidenceClassification: {
          claimTopic: "Peptides with Human Clinical Evidence",
          evidenceLevel: "LEVEL_A",
          recommendedLanguage: "There is clinical evidence supporting several approved peptides...",
          evidenceSummary: "Tirzepatide, Semaglutide, Tesamorelin, and Sermorelin have human clinical trial evidence; BPC-157 and TB-500 remain preclinical.",
          caveats: ["Most approved indications are clinical rather than cosmetic or athletic."],
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
    const isProvenVsClaims = /\b(proven versus|proven vs|what's proven|what is proven|what bodybuilders.*say|bodybuilding.*claims|myth versus fact|fact vs fiction)\b/i.test(lower);
    if (isProvenVsClaims) {
      return {
        answer: "To evaluate peptides accurately, we differentiate between five evidence levels: 1. Human Clinical Evidence: Validated in Phase 3 human clinical trials (e.g. Tesamorelin for visceral fat reduction, Semaglutide/Tirzepatide for significant fat loss). 2. Human Research: Human data exists but is preliminary or limited (e.g. Sermorelin, CJC-1295 GH pulse studies). 3. Preclinical: Animal or cell culture models only (e.g. BPC-157 for tendon angiogenesis, TB-500 for wound repair). 4. Bodybuilding Community Claims: Forum discussions and athlete anecdotes lacking clinical verification (e.g. localized BPC-157 curing torn muscles in 48 hours, or commercial Follistatin vials packing on 10 lbs of pure muscle). 5. Insufficient Evidence: Unsupported claims with no reliable scientific basis.",
        peptide: void 0,
        evidenceClassification: {
          claimTopic: "Clinical Proof vs Bodybuilding Community Claims",
          evidenceLevel: "LEVEL_A",
          recommendedLanguage: "Differentiating clinical evidence from anecdotal community claims...",
          evidenceSummary: "Human clinical trials establish efficacy for select metabolic/GHRH peptides; popular injury and muscle claims are preclinical or anecdotal.",
          caveats: ["Anecdotal reports in athletic communities do not equal clinical proof."],
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
    const isMuscleGrowth = /\b(muscle growth|hypertrophy|building muscle|build muscle|muscle building|peptides and muscle)\b/i.test(lower) && !peptide;
    if (isMuscleGrowth) {
      const mk677 = this.peptides.get("ibutamoren-mk677");
      return {
        answer: "When it comes to muscle growth, the evidence is often misunderstood in bodybuilding circles. GH secretagogues like MK-677, Ipamorelin, and CJC-1295 reliably elevate serum GH and IGF-1, but human clinical studies show this primarily increases fat-free mass via intracellular water retention and connective tissue hydration rather than contractile myofibrillar hypertrophy. Peptides do not exhibit the direct androgen receptor-mediated muscle protein synthesis seen with anabolic steroids. Furthermore, recombinant follistatin peptide vials sold online lack human trial verification and are notoriously unstable.",
        peptide: mk677,
        evidenceClassification: {
          claimTopic: "Peptides and Skeletal Muscle Growth",
          evidenceLevel: "LEVEL_B",
          recommendedLanguage: "Human research shows increased fat-free mass, but limited direct contractile hypertrophy...",
          evidenceSummary: "GH/IGF-1 secretagogues increase water retention and lean mass, but clinical evidence does not demonstrate direct steroid-like muscle hypertrophy.",
          caveats: ["Increased fat-free mass does not equal pure myofibrillar protein accretion."],
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
    const isBodyComp = /\b(body composition|peptides.*body composition|fat loss.*muscle|recomp|body recomposition)\b/i.test(lower) && !peptide;
    if (isBodyComp) {
      const tesa = this.peptides.get("tesamorelin");
      return {
        answer: "For body composition, the peptides with the strongest scientific evidence are Tesamorelin and incretin mimetics (Tirzepatide and Semaglutide). Tesamorelin is supported by Phase 3 human clinical trials published in the NEJM specifically for reducing deep visceral adipose tissue (VAT) while preserving subcutaneous fat. Incretins provide dramatic overall fat loss in clinical trials, though bodybuilders must maintain high protein and resistance training to preserve lean mass. Secretagogues like MK-677 increase fat-free mass but can complicate contest prep due to fluid retention and appetite spikes.",
        peptide: tesa,
        evidenceClassification: {
          claimTopic: "Peptides for Body Composition & Fat Loss",
          evidenceLevel: "LEVEL_A",
          recommendedLanguage: "There is clinical evidence for visceral fat reduction and body composition changes...",
          evidenceSummary: "Tesamorelin selectively reduces visceral fat; incretins drive overall fat loss; secretagogues increase water/lean mass.",
          caveats: ["Fat loss re-accumulates if lifestyle or therapy is discontinued."],
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
    const isGhSecretagogue = /\b(gh secretagogues|growth hormone secretagogues|what is known about gh secretagogues)\b/i.test(lower) && !peptide;
    if (isGhSecretagogue) {
      const ipam = this.peptides.get("ipamorelin");
      return {
        answer: "Growth hormone secretagogues fall into two major classes: GHRH analogs (such as Sermorelin, Tesamorelin, and CJC-1295) that stimulate pituitary GHRH receptors, and GHRPs / ghrelin receptor agonists (such as Ipamorelin, GHRP-6, GHRP-2, Hexarelin, and MK-677) that trigger release via GHS-R1a. Ipamorelin is known in research for being highly selective, triggering GH release without increasing cortisol, prolactin, or appetite. In contrast, older secretagogues like GHRP-6 cause intense hunger and cortisol elevation, while Hexarelin rapidly desensitizes pituitary receptors.",
        peptide: ipam,
        evidenceClassification: {
          claimTopic: "Growth Hormone Secretagogue Pharmacology",
          evidenceLevel: "LEVEL_A",
          recommendedLanguage: "Human and pharmacological research defines clear distinctions among secretagogues...",
          evidenceSummary: "GHRH analogs stimulate GHRH receptors; GHRPs stimulate GHS-R1a. Selectivity varies significantly between compounds.",
          caveats: ["Pituitary desensitization occurs with continuous use of certain compounds."],
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
    if (peptide && peptide.id === "bpc-157" && (lower.includes("research actually say") || lower.includes("actually say about"))) {
      return {
        answer: "BPC-157 (Body Protection Compound-157) is a 15-amino acid synthetic peptide derived from a naturally occurring gastric protein. In preclinical research involving rodent and in-vitro models, it has been investigated for soft tissue repair, tendon and ligament healing, and angiogenesis via VEGF upregulation. However, it has not been validated in controlled human clinical trials. Its effects in athletes remain theoretical and experimental, and claims of rapid tendon or muscle injury repair are based on anecdotal bodybuilding community reports rather than human clinical evidence.",
        peptide,
        evidenceClassification: {
          claimTopic: "Preclinical Angiogenesis & Soft Tissue Repair",
          evidenceLevel: "LEVEL_C",
          recommendedLanguage: "This has been investigated in preclinical research, but that doesn't establish the same effect in humans.",
          evidenceSummary: "BPC-157 has shown tendon, ligament, and gastric tissue healing in animal models, but human clinical trial evidence is lacking.",
          caveats: ["Preclinical animal models do not establish human clinical efficacy in athletes."],
          matchingSources: peptide.sources.filter((s) => s.evidenceLevel === "LEVEL_C"),
          isAnecdotal: false,
          isPreclinical: true,
          isClinicallySupported: false,
          isUnknown: false
        },
        safety,
        sources: peptide.sources
      };
    }
    if (!peptide) {
      return {
        answer: "I don't have enough reliable evidence to give you a factual answer to that. I can provide evidence-based information on characterized peptides such as Semaglutide, Tirzepatide, Tesamorelin, BPC-157, TB-500, Sermorelin, Ipamorelin, MK-677, and others.",
        evidenceClassification: classification,
        safety,
        sources: []
      };
    }
    if (lower.includes("citation") || lower.includes("source") || lower.includes("where does that come from") || lower.includes("study details") || lower.includes("reference")) {
      const asksForClinical = lower.includes("clinical") || lower.includes("human") || lower.includes("trial") || lower.includes("cure");
      const hasClinicalMatchingSource = classification.matchingSources.some((s) => s.evidenceLevel === "LEVEL_A" || s.evidenceLevel === "LEVEL_B");
      const hasClinicalPeptideSource = peptide.sources.some((s) => s.evidenceLevel === "LEVEL_A" || s.evidenceLevel === "LEVEL_B");
      const isAnecdotalClaim = classification.evidenceLevel === "LEVEL_D";
      const isPreclinicalOnly = classification.evidenceLevel === "LEVEL_C" && asksForClinical;
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
          answer: `That information comes from published research: "${src.title}", published in ${src.journalOrPublisher} (${src.year}) by ${src.authorsOrOrg}${src.pmidOrDoi ? ` (${src.pmidOrDoi})` : ""}.`,
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
    if (lower.includes("side effect") || lower.includes("symptom") || lower.includes("adverse") || lower.includes("risk") || lower.includes("danger")) {
      const established = peptide.adverseEffects.filter((e) => e.type === "established").map((e) => e.effect);
      const reported = peptide.adverseEffects.filter((e) => e.type === "reported").map((e) => e.effect);
      const anecdotal = peptide.adverseEffects.filter((e) => e.type === "anecdotal").map((e) => e.effect);
      let sideEffectText = `For ${peptide.name}, it's important to distinguish established clinical risks from informal reports. `;
      if (established.length > 0) {
        sideEffectText += `Clinically established adverse effects include: ${established.join(", ")}. `;
      }
      if (reported.length > 0) {
        sideEffectText += `Effects reported in preliminary studies or clinical contexts include: ${reported.join(", ")}. `;
      }
      if (anecdotal.length > 0) {
        sideEffectText += `Additionally, some people anecdotally report ${anecdotal.join(", ")}, but that does not establish that the peptide caused it. `;
      }
      return {
        answer: sideEffectText.trim(),
        peptide,
        evidenceClassification: classification,
        safety,
        sources: peptide.sources
      };
    }
    const isEvidenceBreakdown = lower.includes("evidence say") || lower.includes("break down the evidence") || lower.includes("evidence breakdown") || lower.includes("structured evidence") || lower.includes("what the evidence actually says");
    if (isEvidenceBreakdown) {
      let breakdownResponse = "";
      if (session.primaryInterest && !lower.includes("since you")) {
        breakdownResponse += `Since you're looking at ${session.primaryInterest.replace("_", " ")}, ${peptide.name} is one of the compounds you'll see discussed in that context. Let me separate the anecdotal reports from the preclinical and human evidence.

`;
      } else {
        breakdownResponse += `Alright, let's break down ${peptide.name}. It's a ${peptide.classification}.

`;
      }
      if (lower.includes("how") || lower.includes("work") || lower.includes("mechanism")) {
        breakdownResponse += `Mechanism of action: ${peptide.mechanism}

`;
      }
      breakdownResponse += `ANECDOTAL REPORTS:
`;
      if (classification.evidenceLevel === "LEVEL_D") {
        breakdownResponse += `Some people report experiencing ${classification.claimTopic.toLowerCase()}, but that is anecdotal evidence rather than clinical evidence. These are individual reports, not clinical evidence and not proof of efficacy. ${peptide.anecdotalSummary}

`;
      } else {
        breakdownResponse += `These are individual reports, not clinical evidence and not proof of efficacy. Some users report ${peptide.anecdotalSummary}

`;
      }
      breakdownResponse += `PRECLINICAL RESEARCH:
`;
      breakdownResponse += `This has been investigated in preclinical research, but that does not establish the same effect in humans. In animal and cell studies, ${peptide.preclinicalEvidenceSummary}

`;
      breakdownResponse += `HUMAN / CLINICAL EVIDENCE:
`;
      if (classification.evidenceLevel === "LEVEL_A") {
        breakdownResponse += `There is clinical evidence supporting its use for ${classification.claimTopic.toLowerCase()}. Human clinical trials have demonstrated that ${classification.evidenceSummary} ${peptide.clinicalEvidenceSummary}

`;
      } else if (classification.evidenceLevel === "LEVEL_B") {
        breakdownResponse += `There is some human research investigating this, but the evidence is still limited. ${classification.evidenceSummary} ${peptide.clinicalEvidenceSummary}

`;
      } else if (classification.evidenceLevel === "LEVEL_E") {
        breakdownResponse += `There isn't enough reliable evidence to say that this benefit is established. ${classification.evidenceSummary}

`;
      } else {
        breakdownResponse += `Clinical evidence is limited or no completed human clinical trials located for athletic performance. ${peptide.clinicalEvidenceSummary}

`;
      }
      const summaryBlock2 = this.getPeptideEvidenceSummary(peptide.id) || {
        anecdotal: peptide.anecdotalSummary,
        preclinical: peptide.preclinicalEvidenceSummary,
        human: peptide.clinicalEvidenceSummary,
        bottomLine: "The evidence should be interpreted according to the strongest available evidence, not the volume of online testimonials."
      };
      breakdownResponse += `WHAT THE EVIDENCE ACTUALLY SAYS:
`;
      breakdownResponse += `\u2022 Anecdotal: ${summaryBlock2.anecdotal}
`;
      breakdownResponse += `\u2022 Preclinical: ${summaryBlock2.preclinical}
`;
      breakdownResponse += `\u2022 Human: ${summaryBlock2.human}
`;
      breakdownResponse += `\u2022 Bottom line: ${summaryBlock2.bottomLine}

`;
      if (peptide.contraindications.length > 0) {
        breakdownResponse += `Known cautions include: ${peptide.contraindications[0]}.

`;
      }
      breakdownResponse += `If you'd like to continue your research with the supplier and discuss current peptide availability, you can contact them directly on WhatsApp.`;
      return {
        answer: breakdownResponse.trim(),
        peptide,
        evidenceClassification: classification,
        safety,
        sources: classification.matchingSources.length > 0 ? classification.matchingSources : peptide.sources,
        evidenceSummary: summaryBlock2,
        structuredEvidence: this.getPeptideStructuredEvidence(peptide.id),
        salesHandoff: {
          isPurchaseIntent: false,
          whatsappNumber: this.getWhatsAppNumber(),
          whatsappUrl: this.buildWhatsAppUrl(peptide.name, session.primaryInterest),
          prefilledMessage: this.buildWhatsAppPrefill(peptide.name, session.primaryInterest),
          ctaText: "WHATSAPP THE PEPTIDE TEAM"
        },
        sessionContext: session
      };
    }
    const isAnecdotalSpecific = lower.includes("bodybuilders reporting") || lower.includes("bodybuilders say") || lower.includes("what are people reporting") || lower.includes("what are bodybuilders") || lower.includes("gym reports") || lower.includes("community reports") || lower.includes("anecdotal") && !lower.includes("rather than");
    if (isAnecdotalSpecific) {
      const anecdotalText = `ANECDOTAL REPORTS:
These are individual reports, not clinical evidence and not proof of efficacy. Some users report ${peptide.anecdotalSummary}

If you want, I can also break down what the preclinical research or human clinical studies show. Where do you want to start?`;
      return {
        answer: anecdotalText,
        peptide,
        evidenceClassification: {
          claimTopic: `${peptide.name} Community Reports`,
          evidenceLevel: "LEVEL_D",
          recommendedLanguage: "These are individual reports, not clinical evidence and not proof of efficacy.",
          evidenceSummary: peptide.anecdotalSummary,
          caveats: ["Individual reports are not proof of efficacy."],
          matchingSources: [],
          isAnecdotal: true,
          isPreclinical: false,
          isClinicallySupported: false,
          isUnknown: false
        },
        primaryEvidenceClass: "COMMUNITY_REPORT",
        uiState: "COMMUNITY_VIEW",
        safety,
        sources: peptide.sources,
        sessionContext: session
      };
    }
    const isSpecificGymClaim = lower.includes("used in the gym") || lower.includes("build massive muscle") || lower.includes("permanent fat loss") || lower.includes("clinically proven in humans") || lower.includes("clinically proven") && !classification.isClinicallySupported;
    if (isSpecificGymClaim) {
      if (classification.evidenceLevel === "LEVEL_D") {
        const gymText = `Some people report experiencing ${classification.claimTopic.toLowerCase()}, but that is anecdotal evidence rather than clinical evidence. These are individual reports, not clinical evidence and not proof of efficacy. ${peptide.anecdotalSummary}

If you want, we can dig into what the preclinical research or human studies actually show. Where do you want to start?`;
        return {
          answer: gymText,
          peptide,
          evidenceClassification: classification,
          primaryEvidenceClass: "COMMUNITY_REPORT",
          uiState: "COMMUNITY_VIEW",
          safety,
          sources: peptide.sources,
          sessionContext: session
        };
      } else if (classification.evidenceLevel === "LEVEL_E") {
        const unsubText = `There isn't enough reliable evidence to say that this benefit is established. ${classification.evidenceSummary}

If you'd like, I can break down what has actually been researched or what bodybuilders report in practice.`;
        return {
          answer: unsubText,
          peptide,
          evidenceClassification: classification,
          primaryEvidenceClass: "COMMUNITY_REPORT",
          uiState: "COMMUNITY_VIEW",
          safety,
          sources: [],
          sessionContext: session
        };
      }
    }
    const isPreclinicalQuery = lower.includes("preclinical") || lower.includes("animal") || lower.includes("in vitro") || lower.includes("in-vitro") || lower.includes("what does research show") || lower.includes("what does the research say") && !lower.includes("actually say") || lower.includes("rodent") || lower.includes("tendon explant");
    if (isPreclinicalQuery) {
      const preclinicalText = `PRECLINICAL RESEARCH:
This has been investigated in preclinical research, but that does not establish the same effect in humans. In animal and cell studies, ${peptide.preclinicalEvidenceSummary}

If you want, I can tell you what human clinical trials exist, or what bodybuilders are reporting in the gym. Where do you want to head next?`;
      return {
        answer: preclinicalText,
        peptide,
        evidenceClassification: {
          claimTopic: `${peptide.name} Preclinical Research`,
          evidenceLevel: "LEVEL_C",
          recommendedLanguage: "This has been investigated in preclinical research, but that doesn't establish the same effect in humans.",
          evidenceSummary: peptide.preclinicalEvidenceSummary,
          caveats: ["Preclinical animal models do not establish human clinical efficacy in athletes."],
          matchingSources: peptide.sources.filter((s) => s.evidenceLevel === "LEVEL_C"),
          isAnecdotal: false,
          isPreclinical: true,
          isClinicallySupported: false,
          isUnknown: false
        },
        primaryEvidenceClass: "PRECLINICAL",
        uiState: "PRECLINICAL_VIEW",
        safety,
        sources: peptide.sources.filter((s) => s.evidenceLevel === "LEVEL_C").length > 0 ? peptide.sources.filter((s) => s.evidenceLevel === "LEVEL_C") : peptide.sources,
        sessionContext: session
      };
    }
    const isRegulatoryQuery = lower.includes("fda") || lower.includes("approved") || lower.includes("regulatory") || lower.includes("legality") || lower.includes("legal status") || lower.includes("wada");
    if (isRegulatoryQuery) {
      const regRecord = peptide.structuredEvidence?.find((r) => r.evidence_type === "REGULATORY");
      const regStatus = peptide.regulatoryStatus || "Research chemical / Not approved for human consumption";
      const regulatoryText = `REGULATORY INFORMATION:
For ${peptide.name}, its regulatory status is: ${regStatus}. ${regRecord ? `${regRecord.finding} (Source: ${regRecord.source}).` : "It is not approved by the FDA or regulatory agencies for athletic performance or bodybuilding."}

Would you like to look into what human clinical trials exist, or what lifters report in practice?`;
      return {
        answer: regulatoryText,
        peptide,
        evidenceClassification: {
          claimTopic: `${peptide.name} Regulatory Status`,
          evidenceLevel: peptide.regulatoryStatus.toLowerCase().includes("fda-approved") ? "LEVEL_A" : "LEVEL_E",
          recommendedLanguage: `The regulatory status is: ${regStatus}`,
          evidenceSummary: regRecord ? regRecord.finding : regStatus,
          caveats: ["Regulatory status does not imply approval for athletic enhancement."],
          matchingSources: peptide.sources.filter((s) => s.evidenceLevel === "LEVEL_A" || s.studyType?.includes("FDA")),
          isAnecdotal: false,
          isPreclinical: false,
          isClinicallySupported: peptide.regulatoryStatus.toLowerCase().includes("fda-approved"),
          isUnknown: false
        },
        primaryEvidenceClass: "REGULATORY",
        uiState: "REGULATORY_VIEW",
        safety,
        sources: peptide.sources,
        sessionContext: session
      };
    }
    const isClinicalQuery = lower.includes("human clinical") || lower.includes("clinical evidence") || lower.includes("clinically supported") || lower.includes("clinical trials") || lower.includes("human studies") || lower.includes("human research") || lower.includes("studied in humans") || lower.includes("human data") || lower.includes("phase 3");
    if (isClinicalQuery) {
      let clinicalBody = "";
      if (classification.evidenceLevel === "LEVEL_A") {
        clinicalBody = `There is clinical evidence supporting its use for ${classification.claimTopic.toLowerCase()}. Human clinical trials have demonstrated that ${classification.evidenceSummary} ${peptide.clinicalEvidenceSummary}`;
      } else if (classification.evidenceLevel === "LEVEL_B") {
        clinicalBody = `There is some human research investigating this, but the evidence is still limited. ${classification.evidenceSummary} ${peptide.clinicalEvidenceSummary}`;
      } else {
        clinicalBody = `Clinical evidence is limited or no completed human clinical trials located for athletic performance. ${peptide.clinicalEvidenceSummary}`;
      }
      const clinicalText = `HUMAN / CLINICAL EVIDENCE:
${clinicalBody}

Would you like to hear about the preclinical research, or what bodybuilders report on the ground?`;
      return {
        answer: clinicalText,
        peptide,
        evidenceClassification: classification,
        primaryEvidenceClass: "HUMAN_CLINICAL",
        uiState: "HUMAN_CLINICAL_VIEW",
        safety,
        sources: classification.matchingSources.length > 0 ? classification.matchingSources : peptide.sources,
        sessionContext: session
      };
    }
    const isTellMeEverything = lower.includes("tell me everything") || lower.includes("all information") || lower.includes("tell me all");
    if (isTellMeEverything) {
      const progressiveText = `In the bodybuilding and physique community, ${peptide.name} is primarily discussed for ${peptide.investigatedUses.map((u) => u.conditionOrGoal).slice(0, 2).join(" and ")}.

Lifters typically look into it based on user reports around ${peptide.anecdotalSummary}.

That said, what you hear in the gym is community experience, not clinical proof.

Rather than dumping every scientific database field at once, we can take it step by step. Would you like to start with what lifters are reporting, look into the preclinical animal research, or review the human clinical trial data?`;
      return {
        answer: progressiveText,
        peptide,
        evidenceClassification: classification,
        primaryEvidenceClass: "COMMUNITY_REPORT",
        uiState: "COMMUNITY_VIEW",
        safety,
        sources: peptide.sources,
        sessionContext: session
      };
    }
    const isMechanismQuery = lower.includes("how does it work") || lower.includes("how it works") || lower.includes("how do they work") || lower.includes("mechanism");
    if (isMechanismQuery) {
      const mechanismText = `For ${peptide.name}, it's classified as a ${peptide.classification}. Mechanism of action: ${peptide.mechanism}

In the bodybuilding and physique community, lifters look at it for ${peptide.investigatedUses.map((u) => u.conditionOrGoal).slice(0, 2).join(" and ")}. That said, what you hear in the gym is community experience, not clinical proof.

If you want, I can tell you what bodybuilders are saying about it in more detail, or we can go into the preclinical or human research. Where do you want to start?`;
      return {
        answer: mechanismText,
        peptide,
        evidenceClassification: classification,
        primaryEvidenceClass: "COMMUNITY_REPORT",
        uiState: "COMMUNITY_VIEW",
        safety,
        sources: peptide.sources,
        sessionContext: session
      };
    }
    const summaryBlock = this.getPeptideEvidenceSummary(peptide.id) || {
      anecdotal: peptide.anecdotalSummary,
      preclinical: peptide.preclinicalEvidenceSummary,
      human: peptide.clinicalEvidenceSummary,
      bottomLine: "The evidence should be interpreted according to the strongest available evidence, not the volume of online testimonials."
    };
    const communityFirstText = this.generateCommunityFirstResponse(peptide, session);
    return {
      answer: communityFirstText,
      peptide,
      evidenceClassification: classification,
      primaryEvidenceClass: "COMMUNITY_REPORT",
      uiState: "COMMUNITY_VIEW",
      safety,
      sources: classification.matchingSources.length > 0 ? classification.matchingSources : peptide.sources,
      evidenceSummary: summaryBlock,
      structuredEvidence: this.getPeptideStructuredEvidence(peptide.id),
      salesHandoff: {
        isPurchaseIntent: false,
        whatsappNumber: this.getWhatsAppNumber(),
        whatsappUrl: this.buildWhatsAppUrl(peptide.name, session.primaryInterest),
        prefilledMessage: this.buildWhatsAppPrefill(peptide.name, session.primaryInterest),
        ctaText: "WHATSAPP THE PEPTIDE TEAM"
      },
      sessionContext: session
    };
  }
  /**
   * Generates the coach/peer Community-First response for a peptide (The New Core Rule).
   * Speaks from the bodybuilding/physique perspective first, gives a brief lifter disclaimer,
   * offers to dive into preclinical or human research, and STOPS.
   */
  generateCommunityFirstResponse(peptide, session) {
    let intro = "";
    if (session.primaryInterest && (session.primaryInterest.includes("recovery") || session.primaryInterest.includes("injury"))) {
      intro = `Since you're looking at recovery, in the bodybuilding and physique community, `;
    } else if (session.primaryInterest) {
      intro = `Since you're looking at ${session.primaryInterest.replace("_", " ")}, in the bodybuilding and physique community, `;
    } else {
      intro = `In the bodybuilding and physique community, `;
    }
    if (peptide.id === "bpc-157") {
      return `${intro}BPC-157 has gotten a ton of attention over the last few years.

Lifters mostly look at it when they're dealing with nagging joint issues, tendon flare-ups, elbows, knees, shoulders, or trying to bounce back from heavy training sessions.

That said, what you hear in the gym is community experience, not clinical proof.

If you want, I can tell you what bodybuilders are saying about it in more detail, or we can go into the preclinical or human research. Where do you want to start?`;
    }
    if (peptide.id === "tb-500") {
      return `${intro}TB-500 is frequently discussed alongside BPC-157 for soft-tissue recovery, muscle strains, and chronic inflammation.

Lifters usually look into it when dealing with deep muscular injuries or systemic recovery demands.

That said, what you hear in the gym is community experience, not clinical proof.

If you want, I can tell you what bodybuilders are saying about it in more detail, or we can go into the preclinical or human research. Where do you want to start?`;
    }
    if (peptide.id === "cjc-1295") {
      return `${intro}CJC-1295 is widely researched as a GHRH analog for stimulating natural growth hormone release, deeper sleep, and improved recovery between heavy workouts.

Lifters often discuss pairing it with GHRPs like Ipamorelin for synergistic GH pulses without appetite or cortisol spikes.

That said, what you hear in the gym is community experience, not clinical proof.

If you want, I can tell you what bodybuilders are saying about it in more detail, or we can go into the preclinical or human research. Where do you want to start?`;
    }
    if (peptide.id === "ipamorelin") {
      return `${intro}Ipamorelin is one of the most popular selective GH secretagogues because it stimulates GH release without driving up hunger, prolactin, or cortisol.

Physique athletes often look into it for recovery, body composition, and lean tissue support during calorie deficits.

That said, what you hear in the gym is community experience, not clinical proof.

If you want, I can tell you what bodybuilders are saying about it in more detail, or we can go into the preclinical or human research. Where do you want to start?`;
    }
    if (peptide.id === "tesamorelin") {
      return `${intro}Tesamorelin has a big reputation specifically for targeting stubborn visceral abdominal fat and sharpening contest conditioning.

Lifters look into it because it triggers natural GH pulsatility without the receptor desensitization of older secretagogues.

That said, what you hear in the gym is community experience, not clinical proof.

If you want, I can tell you what bodybuilders are saying about it in more detail, or we can go into the preclinical or human research. Where do you want to start?`;
    }
    if (peptide.id === "ibutamoren-mk677") {
      return `${intro}MK-677 is widely discussed as an oral secretagogue for packing on mass, boosting appetite, and accelerating sleep and recovery.

Lifters often run into it during off-season growth phases, though water retention and insulin sensitivity are common discussion points.

That said, what you hear in the gym is community experience, not clinical proof.

If you want, I can tell you what bodybuilders are saying about it in more detail, or we can go into the preclinical or human research. Where do you want to start?`;
    }
    const primaryGoal = peptide.investigatedUses[0]?.conditionOrGoal || "recovery and performance";
    return `${intro}${peptide.name} is discussed primarily for ${primaryGoal}.

Lifters typically look into it based on user reports around ${peptide.anecdotalSummary}.

That said, what you hear in the gym is community experience, not clinical proof.

If you want, I can tell you what bodybuilders are saying about it in more detail, or we can go into the preclinical or human research. Where do you want to start?`;
  }
  // ─────────────────────────────────────────────────────────────────────────────
  // COMPACT SYSTEM INSTRUCTIONS FOR GEMINI LIVE VOICE ENGINE
  // ─────────────────────────────────────────────────────────────────────────────
  generateVoiceSystemPrompt() {
    const peptideSummaries = Array.from(this.peptides.values()).map((p) => {
      const topUse = p.investigatedUses[0] ? `${p.investigatedUses[0].conditionOrGoal} (${p.investigatedUses[0].evidenceLevel})` : "Under study";
      const keyEstablished = p.adverseEffects.filter((e) => e.type === "established").map((e) => e.effect).slice(0, 2).join(", ") || "Injection site reactions";
      return `- ${p.name} (${p.classification}): Status: ${p.regulatoryStatus}. Primary research: ${topUse}. Key known effects: ${keyEstablished}.`;
    }).join("\n");
    return `CORE PEPTIDE RESEARCH & SALES CONCIERGE OPERATIONAL DIRECTIVE:
You are an expert AI peptide research specialist and sales concierge built specifically for the bodybuilding, physique athlete, and performance community researching peptides for training, recovery, body composition, and performance.

CUSTOMER JOURNEY:
DISCOVER \u2192 RESEARCH \u2192 UNDERSTAND \u2192 BUILD INTEREST \u2192 CONTACT SELLER ON WHATSAPP
You educate visitors about peptides with complete scientific transparency and then direct interested users to WhatsApp to discuss current availability and continue with the supplier.

PERSONA & VOICE \u2014 80s GOLDEN ERA BODYBUILDING SPECIALIST:
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

NEW CORE RULE \u2014 COMMUNITY PERSPECTIVE FIRST (MANDATORY):
Speak to the user from the bodybuilding/physique community perspective FIRST.
The default conversation hierarchy is:
1. WHAT BODYBUILDERS ARE SAYING / REPORTING:
   - Lead with community perspective: why lifters are interested, common gym use cases (nagging joints, elbows, knees, recovery).
   - Give a brief, lifter-friendly disclaimer: "That said, what you hear in the gym is community experience, not clinical proof."
2. ASK WHETHER THEY WANT THE RESEARCH:
   - "If you want, I can tell you what bodybuilders are saying about it in more detail, or we can go into the preclinical or human research. Where do you want to start?"
   - STOP THERE. Do not keep talking.
3. PRECLINICAL INFORMATION \u2014 ONLY IF REQUESTED:
   - Animal and cell models, rodent tendons, VEGF upregulation, and state that animal models do not establish human clinical proof.
4. HUMAN / CLINICAL INFORMATION \u2014 ONLY IF REQUESTED:
   - Phase 3 RCTs, limitations, or lack of completed clinical trials.
5. REGULATORY / FDA \u2014 ONLY IF REQUESTED:
   - FDA approval status and regulatory position.

CRITICAL NEGATIVE CONSTRAINTS (ZERO TOLERANCE):
- Do NOT automatically launch into preclinical research after identifying a peptide.
- Do NOT automatically mention gastric juice origins, rodent Achilles tendons, VEGF upregulation, or animal-to-human translation unless specifically asked.
- Do NOT automatically give FDA warnings or regulatory lectures unprompted.
- Do NOT dump a multi-paragraph scientific disclaimer upfront. The user is a bodybuilder/physique athlete, not a biology student.

CONVERSATIONAL SALES PSYCHOLOGY (5 STEPS):
1. STEP 1 \u2014 DISCOVER: Understand what the visitor is researching.
   - "What are you mainly researching\u2014recovery, body composition, performance, or something else?"
   - "What caught your attention about this peptide?"
2. STEP 2 \u2014 EDUCATE (COMMUNITY FIRST): Lead with what lifters are experiencing and why it's popular in the gym, then offer research.
3. STEP 3 \u2014 DIFFERENTIATE EVIDENCE (WHEN REQUESTED): Separate into Anecdotal vs Preclinical vs Human Clinical.
4. STEP 4 \u2014 PERSONAL RELEVANCE: Connect research to their stated goals (e.g. "Since you're looking at recovery...").
5. STEP 5 \u2014 WHATSAPP HANDOFF / CONVERSION:
   When interest is established or purchase intent appears:
   "If you'd like to continue your research with the supplier and discuss current peptide availability, you can contact them directly on WhatsApp."

CRITICAL BOUNDARIES (DO NOT PRETEND TO BE THE SELLER OR DOCTOR):
- NEVER claim: "I can sell you this", "I have this in stock", "Your order is confirmed", or "I'm your doctor".
- Say: "I can help you research the peptide. For availability, purchasing information, or questions about the supplier's products, contact the peptide team directly on WhatsApp."
- NEVER generate individualized dosing protocols, injection instructions, or personal peptide stacks.
- Maintain the strict role: Research \u2192 education \u2192 qualified handoff.

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
};
var peptideKnowledgeEngine = PeptideKnowledgeEngine.getInstance();

// server/server_routes/peptideRoutes.ts
var peptideRouter = Router2();
peptideRouter.get("/", (req, res) => {
  try {
    const { category, search, evidenceLevel } = req.query;
    let list = peptideKnowledgeEngine.getAllPeptides();
    if (category && typeof category === "string") {
      list = list.filter((p) => p.category === category);
    }
    if (search && typeof search === "string") {
      const q = search.toLowerCase();
      list = list.filter(
        (p) => p.name.toLowerCase().includes(q) || p.commonNames.some((a) => a.toLowerCase().includes(q)) || p.classification.toLowerCase().includes(q)
      );
    }
    if (evidenceLevel && typeof evidenceLevel === "string") {
      list = list.filter(
        (p) => p.claims.some((c) => c.evidenceLevel === evidenceLevel) || p.investigatedUses.some((u) => u.evidenceLevel === evidenceLevel)
      );
    }
    return res.json({
      success: true,
      count: list.length,
      peptides: list
    });
  } catch (err) {
    console.error("[PeptideAPI] Error listing peptides:", err);
    return res.status(500).json({ error: "Failed to retrieve peptide list." });
  }
});
peptideRouter.get("/system-prompt", (req, res) => {
  try {
    const prompt = peptideKnowledgeEngine.generateVoiceSystemPrompt();
    return res.json({ success: true, systemPrompt: prompt });
  } catch (err) {
    return res.status(500).json({ error: "Failed to generate system prompt." });
  }
});
peptideRouter.get("/config", (req, res) => {
  return res.json({
    success: true,
    whatsappNumber: peptideKnowledgeEngine.getWhatsAppNumber(),
    defaultWhatsAppUrl: peptideKnowledgeEngine.buildWhatsAppUrl(),
    defaultPrefill: peptideKnowledgeEngine.buildWhatsAppPrefill()
  });
});
peptideRouter.get("/:id", (req, res) => {
  try {
    const peptide = peptideKnowledgeEngine.getPeptideById(req.params.id) || peptideKnowledgeEngine.findPeptideByName(req.params.id);
    if (!peptide) {
      return res.status(404).json({ error: `Peptide "${req.params.id}" not found.` });
    }
    return res.json({ success: true, peptide });
  } catch (err) {
    return res.status(500).json({ error: "Failed to retrieve peptide." });
  }
});
peptideRouter.post("/", (req, res) => {
  try {
    const data = req.body;
    if (!data.id || !data.name || !data.category) {
      return res.status(400).json({ error: "Peptide id, name, and category are required." });
    }
    const created = peptideKnowledgeEngine.createPeptide(data);
    return res.status(201).json({ success: true, peptide: created });
  } catch (err) {
    return res.status(400).json({ error: err.message || "Failed to create peptide." });
  }
});
peptideRouter.put("/:id", (req, res) => {
  try {
    const updated = peptideKnowledgeEngine.updatePeptide(req.params.id, req.body);
    return res.json({ success: true, peptide: updated });
  } catch (err) {
    return res.status(400).json({ error: err.message || "Failed to update peptide." });
  }
});
peptideRouter.delete("/:id", (req, res) => {
  try {
    const deleted = peptideKnowledgeEngine.deletePeptide(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: `Peptide "${req.params.id}" not found.` });
    }
    return res.json({ success: true, message: "Peptide successfully deleted." });
  } catch (err) {
    return res.status(500).json({ error: "Failed to delete peptide." });
  }
});
peptideRouter.get("/:id/evidence", (req, res) => {
  try {
    const peptide = peptideKnowledgeEngine.getPeptideById(req.params.id) || peptideKnowledgeEngine.findPeptideByName(req.params.id);
    if (!peptide) {
      return res.status(404).json({ error: `Peptide "${req.params.id}" not found.` });
    }
    const evidence = peptideKnowledgeEngine.getPeptideStructuredEvidence(peptide.id);
    const summary = peptideKnowledgeEngine.getPeptideEvidenceSummary(peptide.id);
    return res.json({
      success: true,
      peptideId: peptide.id,
      peptideName: peptide.name,
      evidence,
      summary
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to retrieve evidence dossier." });
  }
});
peptideRouter.post("/query", (req, res) => {
  try {
    const { query, sessionId = "default" } = req.body;
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Query string is required." });
    }
    const response = peptideKnowledgeEngine.query(query, sessionId);
    return res.json({ success: true, ...response });
  } catch (err) {
    console.error("[PeptideAPI] Query error:", err);
    return res.status(500).json({ error: "Failed to evaluate query." });
  }
});
peptideRouter.post("/classify", (req, res) => {
  try {
    const claim = req.body.claim || req.body.text;
    const peptideId = req.body.peptideId;
    if (!claim || typeof claim !== "string") {
      return res.status(400).json({ error: "Claim string is required." });
    }
    const peptide = peptideId ? peptideKnowledgeEngine.getPeptideById(peptideId) : void 0;
    const classification = peptideKnowledgeEngine.classifyClaim(claim, peptide);
    const safety = peptideKnowledgeEngine.evaluateSafety(claim);
    return res.json({
      success: true,
      classification,
      safety
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to classify claim." });
  }
});

// server/server.ts
var { Client: Client2 } = pg2;
var RedactionService = {
  redact: (item) => {
    if (typeof item === "string") {
      return item.replace(/(AIzaSy[A-Za-z0-9_-]{33}|Bearer\s+[A-Za-z0-9._-]+)/g, "[REDACTED]");
    }
    return item;
  }
};
var originalConsoleLog = console.log;
var originalConsoleWarn = console.warn;
var originalConsoleError = console.error;
console.log = (...args) => originalConsoleLog(...args.map((a) => RedactionService.redact(a)));
console.warn = (...args) => originalConsoleWarn(...args.map((a) => RedactionService.redact(a)));
console.error = (...args) => originalConsoleError(...args.map((a) => RedactionService.redact(a)));
var mailgun = new Mailgun(formData);
var mg = mailgun.client({
  username: "api",
  key: process.env.MAILGUN_API_KEY || "dummy_key"
});
var app = express3();
app.set("trust proxy", 1);
var PORT = Number(process.env.PORT) || 3e3;
var isProduction2 = process.env.NODE_ENV === "production" || !!process.env.VERCEL;
var initDB = async () => {
  try {
    await queryDB(`
      CREATE TABLE IF NOT EXISTS leads (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255),
        email VARCHAR(255),
        phone VARCHAR(255),
        monthly_income VARCHAR(255),
        source VARCHAR(255),
        status VARCHAR(255) DEFAULT 'NEW',
        assigned_to VARCHAR(255),
        sales_brief TEXT,
        intent_score INT,
        contactability_score INT,
        qualification_score INT,
        lead_quality_score INT,
        buying_commitment VARCHAR(50),
        next_best_action VARCHAR(50),
        recommended_next_action VARCHAR(50),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS scores (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        score INT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE leads ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'MAIN';
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS first_name VARCHAR(255);
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_name VARCHAR(255);
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS location VARCHAR(255);
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS employment VARCHAR(255);
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS income VARCHAR(255);
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS "creditScore" VARCHAR(255);
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS "monthlyDebt" VARCHAR(255);
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS "downPayment" VARCHAR(255);
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS down_payment VARCHAR(255);
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS "housingStatus" VARCHAR(255);
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS vehicle VARCHAR(255);
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS "selectedModel" VARCHAR(255);
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS "selectedModelYear" INT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS "approvalScore" INT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS "riskTier" VARCHAR(50);
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS "maxLoan" INT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS "monthlyEstimate" INT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS tdsr NUMERIC;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS pti NUMERIC;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS "marketingConsent" BOOLEAN DEFAULT false;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS "privacyConsent" BOOLEAN DEFAULT false;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS intent_score INT DEFAULT 0;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS intent_stage VARCHAR(50) DEFAULT 'CURIOUS';
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS contactability_score INT DEFAULT 0;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS qualification_score INT DEFAULT 0;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_completeness INT DEFAULT 0;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_quality_score INT DEFAULT 0;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS buying_commitment VARCHAR(50) DEFAULT 'NONE';
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_best_action VARCHAR(50) DEFAULT 'EDUCATE';
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS vehicle_type VARCHAR(100);
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS payment_target VARCHAR(100);
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS budget VARCHAR(100);
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS purchase_timeline VARCHAR(100);
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS urgency VARCHAR(50);
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS financing_needed BOOLEAN DEFAULT true;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS financing_context TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS credit_situation VARCHAR(100);
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS monthly_income VARCHAR(100);
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_trade BOOLEAN DEFAULT false;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS trade_vehicle VARCHAR(255);
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS pain_points TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS goals TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS preferences TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS objections TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS active_objection VARCHAR(100);
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS customer_summary TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS sales_brief TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS recommended_next_action VARCHAR(100) DEFAULT 'CALL_ASAP';
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS outcome_status VARCHAR(50) DEFAULT 'NEW';
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS signals_json TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(255);
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS notes TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS forensics_json TEXT;

      CREATE TABLE IF NOT EXISTS deleted_leads (
        id VARCHAR(255) PRIMARY KEY,
        deleted_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_leads_conversation_id ON leads(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_deleted_leads_id ON deleted_leads(id);
    `);
  } catch (err) {
    console.error("Leads DB initialization failed:", err);
  }
};
var dbInitPromise = null;
var ensureDB = async () => {
  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      await initDB().catch((e) => console.warn("[DB] initDB non-fatal notice:", e.message));
      await initWinstonDB().catch((e) => console.warn("[DB] initWinstonDB non-fatal notice:", e.message));
      try {
        const healthCheck = await queryDB("SELECT 1 as ok");
        const connStr = process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.POSTGRES_DATABASE_URL || process.env.POSTGRES_PRISMA_URL;
        if (connStr) {
          console.log("[DB] \u2705 PostgreSQL connected \u2014 leads will persist across deploys");
        } else {
          console.warn("[DB] \u26A0\uFE0F  No POSTGRES_URL/DATABASE_URL set \u2014 using IN-MEMORY fallback. Leads will be LOST on cold start/redeploy!");
        }
      } catch (e) {
        console.error("[DB] \u274C PostgreSQL health check failed:", e.message, "\u2014 leads may be lost on redeploy");
      }
    })();
  }
  return dbInitPromise;
};
var parseCookies = (cookieHeader) => {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach((cookie) => {
    const parts = cookie.split("=");
    if (parts.length >= 2) {
      cookies[parts[0].trim()] = parts.slice(1).join("=").trim();
    }
  });
  return cookies;
};
var SESSION_SECRET = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || process.env.GOOGLE_CLIENT_SECRET || "yna-production-signing-secret-key-2026";
var signSession = (email) => {
  const payload = {
    email,
    exp: Date.now() + 2 * 60 * 60 * 1e3
    // 2 hours expiration
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto4.createHmac("sha256", SESSION_SECRET).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
};
var verifySession = (token) => {
  if (!token || !token.includes(".")) return null;
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return null;
  const expectedSig = crypto4.createHmac("sha256", SESSION_SECRET).update(payloadB64).digest("base64url");
  if (sig.length !== expectedSig.length) return null;
  if (!crypto4.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
};
var requireAdmin = (req, res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["admin_session"];
  const session = verifySession(token);
  if (!session) {
    return res.status(401).json({ error: "Unauthorized: Invalid or expired session" });
  }
  req.adminUser = session;
  next();
};
app.set("trust proxy", 1);
app.use(express3.json({ limit: "15mb" }));
app.use(express3.urlencoded({ limit: "15mb", extended: true }));
app.use(cookieParser());
app.use(async (req, res, next) => {
  if (req.path.startsWith("/api")) {
    try {
      await ensureDB();
    } catch (e) {
      console.error("DB initialization error on request:", e);
    }
  }
  next();
});
app.use(helmet({
  contentSecurityPolicy: false,
  // Disabled to prevent blocking external resources (Google Auth, Images)
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(compression({
  filter: (req, res) => {
    const url = req.url || "";
    if (url.endsWith(".glb") || url.endsWith(".gltf") || url.endsWith(".bin")) {
      return false;
    }
    return compression.filter(req, res);
  }
}));
var globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  // 15 minutes
  max: process.env.RATE_LIMIT_MAX ? parseInt(process.env.RATE_LIMIT_MAX, 10) : 1e3,
  // Limit each IP to 1000 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests from this IP, please try again later.",
  validate: {
    keyGeneratorIpFallback: false,
    xForwardedForHeader: false
  },
  skip: (req) => {
    return !req.path.startsWith("/api");
  },
  keyGenerator: (req) => {
    const forwarded = req.headers["x-forwarded-for"]?.split(",")[0].trim();
    if (forwarded) return forwarded;
    return req.ip || req.socket.remoteAddress || "unknown";
  }
});
app.use(globalLimiter);
app.use(express3.static(path2.join(process.cwd(), "public")));
app.use(express3.static(path2.join(process.cwd(), "client", "public")));
app.use("/api/peptides", peptideRouter);
app.get("/api/voice/live-config", (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Gemini API key not configured on server." });
  }
  const isVercel = Boolean(process.env.VERCEL);
  return res.json({
    useGateway: !isVercel,
    apiKey: isVercel ? apiKey : void 0,
    model: process.env.GEMINI_LIVE_MODEL || "models/gemini-2.5-flash-native-audio-latest",
    voiceName: process.env.GEMINI_VOICE_NAME || "Charon",
    whatsappNumber: process.env.PEPTIDE_SALES_WHATSAPP_NUMBER || "15557378433",
    systemPrompt: peptideKnowledgeEngine.generateVoiceSystemPrompt()
  });
});
app.post("/api/voice/text-chat", async (req, res) => {
  try {
    const { message, profile = {}, history = [] } = req.body || {};
    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ ok: false, error: "Message is required." });
    }
    const cleanMessage = message.trim();
    const apiKey = process.env.GEMINI_API_KEY;
    const generateFallback = () => {
      const q = peptideKnowledgeEngine.query(cleanMessage);
      return q.answer;
    };
    if (!apiKey) {
      return res.json({ ok: true, reply: generateFallback() });
    }
    const knownFacts = [];
    if (profile.name) knownFacts.push(`- Customer Name: ${profile.name}`);
    if (profile.targetVehicle) knownFacts.push(`- Target Vehicle Model: ${profile.targetVehicle}`);
    else if (profile.vehicleType) knownFacts.push(`- Target Vehicle Category: ${profile.vehicleType}`);
    if (profile.monthlyBudget) knownFacts.push(`- Comfortable Monthly Budget: $${profile.monthlyBudget}/month`);
    if (profile.creditSituation) knownFacts.push(`- Credit Situation: ${profile.creditSituation}`);
    if (profile.monthlyIncome) knownFacts.push(`- Monthly Take-Home Income: $${profile.monthlyIncome}/month`);
    if (profile.downPayment !== void 0) knownFacts.push(`- Down Payment: $${profile.downPayment}`);
    if (profile.employment) knownFacts.push(`- Employment Status: ${profile.employment}`);
    if (profile.phone) knownFacts.push(`- Phone: ${profile.phone}`);
    if (profile.email) knownFacts.push(`- Email: ${profile.email}`);
    const systemInstruction = peptideKnowledgeEngine.generateVoiceSystemPrompt();
    const contents = [];
    if (Array.isArray(history) && history.length > 0) {
      for (const turn of history.slice(-4)) {
        if (turn.text && turn.sender) {
          contents.push({
            role: turn.sender === "user" ? "user" : "model",
            parts: [{ text: turn.text }]
          });
        }
      }
    }
    contents.push({
      role: "user",
      parts: [{ text: cleanMessage }]
    });
    const candidateModels = [
      process.env.GEMINI_MODEL || "gemini-3.8-flash",
      "gemini-3.8-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-2.5-flash",
      "gemini-flash-latest"
    ].filter((m, i, arr) => arr.indexOf(m) === i);
    let replyText = "";
    if (ai) {
      for (const model of candidateModels) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents,
            config: {
              systemInstruction,
              temperature: 0.7,
              maxOutputTokens: 250
            }
          });
          if (response?.text) {
            replyText = response.text.trim();
            break;
          }
        } catch (modelErr) {
          console.warn(`[Text Chat LLM Failover] Model ${model} failed:`, modelErr.message);
        }
      }
    }
    if (!replyText) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const directRes = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents,
            systemInstruction: { parts: [{ text: systemInstruction }] },
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 250
            }
          }),
          signal: AbortSignal.timeout(8e3)
        });
        if (directRes.ok) {
          const data = await directRes.json();
          replyText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
        }
      } catch (directErr) {
        console.warn("[Text Chat Direct Fetch Error]", directErr.message);
      }
    }
    if (!replyText) {
      replyText = generateFallback();
    }
    const cleanReply = replyText.replace(/^["']|["']$/g, "").replace(/[*_#`]/g, "").replace(/\s+/g, " ").trim();
    return res.json({
      ok: true,
      reply: cleanReply
    });
  } catch (error) {
    console.error("[Text Chat Endpoint Error]", error);
    return res.status(500).json({
      ok: false,
      error: "Internal server error processing text chat.",
      reply: "I am an educational AI peptide information assistant. How can I help you with peptide clinical evidence, potential benefits, or research?"
    });
  }
});
app.post("/api/voice/transcribe", async (req, res) => {
  const TRANSCRIBE_TIMEOUT_MS = 2e4;
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      console.warn("[STT Timeout] Transcription exceeded 20s limit");
      res.status(504).json({ error: "Transcription timed out", transcript: "" });
    }
  }, TRANSCRIBE_TIMEOUT_MS);
  try {
    const { audioBase64, mimeType = "audio/webm" } = req.body;
    if (!audioBase64) {
      clearTimeout(timer);
      return res.status(400).json({ error: "Missing audioBase64 payload." });
    }
    const baseMime = (mimeType || "audio/webm").split(";")[0].trim().toLowerCase();
    const normalizedMimeType = ["audio/webm", "audio/mp4", "audio/wav", "audio/ogg", "audio/x-m4a", "audio/mpeg"].includes(baseMime) ? baseMime : "audio/webm";
    const groqKey = process.env.GROQ_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    if (groqKey || openaiKey) {
      try {
        const audioBuffer = Buffer.from(audioBase64, "base64");
        const formData2 = new FormData();
        const blob = new Blob([audioBuffer], { type: normalizedMimeType });
        let fileExt = normalizedMimeType.split("/")[1] || "webm";
        if (fileExt === "x-m4a") fileExt = "m4a";
        if (fileExt === "mpeg") fileExt = "mp3";
        formData2.append("file", blob, `audio.${fileExt}`);
        formData2.append("model", groqKey ? "whisper-large-v3" : "whisper-1");
        formData2.append("temperature", "0.0");
        formData2.append("prompt", "Peptide consultation: BPC-157, Semaglutide, Tirzepatide, Sermorelin, Tesamorelin, Ipamorelin, CJC-1295, MK-677, clinical evidence, dosage, mechanism, adverse effects, research.");
        const endpoint = groqKey ? "https://api.groq.com/openai/v1/audio/transcriptions" : "https://api.openai.com/v1/audio/transcriptions";
        const whisperRes = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${groqKey || openaiKey}`
          },
          body: formData2,
          signal: AbortSignal.timeout(15e3)
          // 15s fetch timeout for Whisper API
        });
        if (whisperRes.ok) {
          const data = await whisperRes.json();
          if (data && data.text) {
            clearTimeout(timer);
            return res.json({ transcript: data.text.trim(), engine: groqKey ? "groq-whisper-v3" : "openai-whisper" });
          }
        }
      } catch (whisperErr) {
        console.warn("[Whisper STT fallback to Gemini]", whisperErr.message);
      }
    }
    if (ai) {
      try {
        const modelName = process.env.GEMINI_MODEL && process.env.GEMINI_MODEL !== "gemini-3.6-flash" ? process.env.GEMINI_MODEL : "gemini-3.8-flash";
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [
            {
              role: "user",
              parts: [
                {
                  inlineData: {
                    mimeType: normalizedMimeType,
                    data: audioBase64
                  }
                },
                {
                  text: "You are a professional acoustic speech-to-text transcriber for an automotive sales desk. Transcribe ONLY the spoken English words in the audio verbatim. If the audio contains only silence, background noise, or no recognizable human speech, return an empty string. Output ONLY the exact transcribed text without quotes, commentary, punctuation explanations, or conversational replies."
                }
              ]
            }
          ],
          config: {
            temperature: 0,
            maxOutputTokens: 250
          }
        });
        const transcript = response.text ? response.text.trim() : "";
        const cleanTranscript = transcript.replace(/^["']|["']$/g, "").trim();
        if (cleanTranscript) {
          clearTimeout(timer);
          return res.json({ transcript: cleanTranscript, engine: "gemini-acoustic-flash" });
        }
      } catch (geminiErr) {
        console.warn("[Gemini Acoustic STT Error]", geminiErr.message);
      }
    }
    clearTimeout(timer);
    return res.json({ transcript: "" });
  } catch (err) {
    clearTimeout(timer);
    console.error("[STT Route Error]", err);
    if (!res.headersSent) {
      return res.status(500).json({ error: "Transcription failed", transcript: "" });
    }
  }
});
app.use("/api/session", sessionRouter);
app.use("/api/chat", chatRouter);
app.use("/api/voice", voiceLeadRouter);
app.post("/api/forensics/collect", async (req, res) => {
  try {
    const clientForensics = req.body || {};
    const forwarded = req.headers["x-forwarded-for"]?.split(",")[0]?.trim();
    const ip = forwarded || req.ip || req.socket?.remoteAddress || "unknown";
    const geoCity = req.headers["x-vercel-ip-city"] || null;
    const geoRegion = req.headers["x-vercel-ip-country-region"] || null;
    const geoCountry = req.headers["x-vercel-ip-country"] || null;
    const geoPostal = req.headers["x-vercel-ip-postal-code"] || null;
    const geoLatitude = req.headers["x-vercel-ip-latitude"] || null;
    const geoLongitude = req.headers["x-vercel-ip-longitude"] || null;
    const hasViaHeader = !!req.headers["via"];
    const forwardedHops = req.headers["x-forwarded-for"]?.split(",").length || 0;
    const clientTimezone = clientForensics.timezone || null;
    const CA_TIMEZONE_MAP = {
      "America/Toronto": ["ON", "QC"],
      "America/Montreal": ["QC"],
      "America/Winnipeg": ["MB"],
      "America/Regina": ["SK"],
      "America/Edmonton": ["AB"],
      "America/Vancouver": ["BC"],
      "America/Halifax": ["NS", "NB", "PE"],
      "America/St_Johns": ["NL"],
      "America/Yellowknife": ["NT"],
      "America/Whitehorse": ["YT"],
      "America/Iqaluit": ["NU"]
    };
    let vpnRisk = "LOW";
    const vpnSignals = [];
    if (hasViaHeader) {
      vpnSignals.push("VIA_HEADER_PRESENT");
      vpnRisk = "MEDIUM";
    }
    if (forwardedHops > 2) {
      vpnSignals.push(`MULTI_HOP_PROXY_${forwardedHops}`);
      vpnRisk = "HIGH";
    }
    if (clientTimezone && geoRegion && geoCountry === "CA") {
      const expectedProvinces = CA_TIMEZONE_MAP[clientTimezone];
      if (expectedProvinces && !expectedProvinces.includes(geoRegion)) {
        vpnSignals.push(`TZ_GEO_MISMATCH:${clientTimezone}_vs_${geoRegion}`);
        vpnRisk = "HIGH";
      }
    }
    if (clientTimezone && geoCountry && geoCountry !== "CA") {
      if (clientTimezone.startsWith("America/") && ["Toronto", "Montreal", "Winnipeg", "Regina", "Edmonton", "Vancouver", "Halifax", "St_Johns"].some((c) => clientTimezone.includes(c))) {
        vpnSignals.push(`COUNTRY_MISMATCH:client_CA_ip_${geoCountry}`);
        vpnRisk = "HIGH";
      }
    }
    const ipParts = ip.split(".");
    const firstOctet = parseInt(ipParts[0] || "0", 10);
    if ([104, 172, 185, 193, 198, 23, 40, 52, 13, 34, 35, 54].includes(firstOctet)) {
      vpnSignals.push("DATACENTER_IP_RANGE");
      if (vpnRisk !== "HIGH") vpnRisk = "MEDIUM";
    }
    const serverForensics = {
      ip,
      geo: {
        city: geoCity ? decodeURIComponent(geoCity) : null,
        region: geoRegion,
        country: geoCountry,
        postalCode: geoPostal,
        latitude: geoLatitude ? parseFloat(geoLatitude) : null,
        longitude: geoLongitude ? parseFloat(geoLongitude) : null
      },
      network: {
        vpnRisk,
        vpnSignals,
        forwardedHops,
        hasViaHeader,
        userAgentServer: req.headers["user-agent"] || null
      },
      serverTimestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    const merged = {
      ...clientForensics,
      server: serverForensics
    };
    console.log("[FORENSICS_COLLECTED]", {
      deviceId: clientForensics.deviceId,
      ip,
      geo: `${geoCity || "?"}, ${geoRegion || "?"}, ${geoCountry || "?"}`,
      vpnRisk,
      vpnSignals: vpnSignals.join(", ") || "none"
    });
    return res.status(200).json({ success: true, forensics: merged });
  } catch (err) {
    console.error("[FORENSICS_ERROR]", err);
    return res.status(200).json({ success: false });
  }
});
var chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  max: 1e3,
  // Max 1000 AI chat interactions per 15 minutes per IP for continuous voice sessions
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Chat rate limit reached. Please wait a few moments before trying again." }
});
var leadLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  max: 25,
  // Max 25 lead submissions per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Submission rate limit reached. Please try again later." }
});
var authLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  max: 15,
  // Max 15 auth attempts per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." }
});
app.get("/api/health/database", async (req, res) => {
  const start = Date.now();
  try {
    const result = await queryDB("SELECT 1 as ok");
    const latency = Date.now() - start;
    res.status(200).json({
      status: "healthy",
      database: "reachable",
      latency_ms: latency,
      query_result: result.rows[0].ok
    });
  } catch (err) {
    res.status(503).json({
      status: "unhealthy",
      database: "unreachable",
      error_type: err.code || err.name,
      message: err.message
    });
  }
});
app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "OK", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
});
app.get("/api/scores", async (req, res) => {
  try {
    const result = await queryDB('SELECT name, email, score, created_at as "createdAt" FROM scores ORDER BY score DESC LIMIT 3');
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
});
app.post("/api/scores", async (req, res) => {
  const { name, email, score } = req.body;
  if (!name || !email || typeof score !== "number") {
    return res.status(400).json({ error: "Missing required fields: name, email, score" });
  }
  if (name.trim().length === 0 || name.length > 25) {
    return res.status(400).json({ error: "Invalid name length" });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: "Invalid email address" });
  }
  try {
    await queryDB(
      "INSERT INTO scores (name, email, score, created_at) VALUES ($1, $2, $3, $4)",
      [name.trim().substring(0, 25), email.trim().toLowerCase(), Math.max(0, score), (/* @__PURE__ */ new Date()).toISOString()]
    );
    const result = await queryDB('SELECT name, email, score, created_at as "createdAt" FROM scores ORDER BY score DESC LIMIT 3');
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});
app.post("/api/score", (req, res) => {
  const data = req.body;
  console.log(">>> [API/SCORE] INCOMING:", data);
  const {
    incomeMonthly: incomeMonthlyRaw,
    employmentStatus,
    creditScoreRange,
    monthlyDebt: monthlyDebtRaw,
    downPayment: downPaymentRaw
  } = data;
  const incomeMonthly = parseFloat(incomeMonthlyRaw) || 0;
  const monthlyDebt = parseFloat(monthlyDebtRaw) || 0;
  const downPayment = parseFloat(downPaymentRaw) || 0;
  const DTI = monthlyDebt / (incomeMonthly || 1);
  let score = 0;
  const reasons = [];
  if (employmentStatus === "full-time") {
    score += 25;
    reasons.push("Stable full-time employment");
  } else if (employmentStatus === "part-time") {
    score += 18;
    reasons.push("Part-time income verified");
  } else if (employmentStatus === "self-employed") {
    score += 15;
    reasons.push("Entrepreneurial revenue path");
  } else {
    score += 5;
    reasons.push("Status verification required");
  }
  const isApprovedCredit = creditScoreRange === "excellent" || creditScoreRange === "good";
  if (creditScoreRange === "excellent") {
    score += 25;
    reasons.push("Excellent credit profile");
  } else if (creditScoreRange === "good") {
    score += 20;
    reasons.push("Good credit profile");
  } else if (creditScoreRange === "fair") {
    score += 14;
    reasons.push("Fair credit profile");
  } else {
    score += 8;
    reasons.push("Challenged credit pathway");
  }
  if (DTI < 0.2) {
    score += 20;
    reasons.push("Low debt-to-income load");
  } else if (DTI < 0.35) score += 16;
  else if (DTI < 0.5) score += 10;
  else {
    score += 5;
    reasons.push("Higher DTI ratio threshold");
  }
  if (incomeMonthly > 6e3) {
    score += 15;
    reasons.push("Tier 1 income strength");
  } else if (incomeMonthly > 4500) score += 12;
  else if (incomeMonthly > 3e3) score += 9;
  else score += 6;
  if (downPayment >= 5e3) score += 10;
  else if (downPayment >= 2500) score += 7;
  else if (downPayment >= 1e3) score += 5;
  score = Math.min(score, 100);
  let riskTier = "moderate";
  if (score >= 80) riskTier = "low";
  else if (score >= 60) riskTier = "moderate";
  else if (score >= 40) riskTier = "high";
  else riskTier = "very_high";
  const tdsrLimit = isApprovedCredit ? 0.48 : 0.4;
  const ptiLimit = isApprovedCredit ? 0.205 : 0.18;
  const maxPaymentTDSR = tdsrLimit * incomeMonthly - monthlyDebt;
  const maxPaymentPTI = ptiLimit * incomeMonthly;
  let maxPayment = Math.min(maxPaymentTDSR, maxPaymentPTI);
  if (maxPayment < 150) {
    maxPayment = 150;
  }
  const loanFactor = 0.0203;
  let maxLoan = maxPayment / loanFactor;
  if (riskTier === "low") maxLoan *= 1.1;
  if (riskTier === "high") maxLoan *= 0.75;
  if (riskTier === "very_high") maxLoan *= 0.55;
  let monthlyEstimate = maxLoan * loanFactor;
  if (monthlyEstimate > maxPayment) {
    monthlyEstimate = maxPayment;
    maxLoan = monthlyEstimate / loanFactor;
  }
  const finalPTI = monthlyEstimate / (incomeMonthly || 1);
  const finalTDSR = (monthlyDebt + monthlyEstimate) / (incomeMonthly || 1);
  reasons.push(`TDSR: ${(finalTDSR * 100).toFixed(1)}% (Limit: ${tdsrLimit * 100}%)`);
  reasons.push(`PTI: ${(finalPTI * 100).toFixed(1)}% (Limit: ${(ptiLimit * 100).toFixed(1)}%)`);
  let status = "REVIEW";
  let priority = "LOW";
  let routing = "general_queue";
  let offer = "standard_terms";
  const isExceeded = finalTDSR > tdsrLimit || finalPTI > ptiLimit;
  if (score >= 70 && !isExceeded) {
    status = "APPROVED";
    priority = "HIGH";
    routing = "senior_closers";
    offer = "preferred_rate_0.9";
  } else if (score >= 45 && !isExceeded) {
    status = "CONDITIONAL";
    priority = "URGENT";
    routing = "rapid_response_team";
    offer = "flex_approval_low_down";
  } else {
    status = "REVIEW";
    priority = "NORMAL";
    routing = "manual_underwriting";
    offer = "custom_program_match";
  }
  const result = {
    approvalScore: Math.round(score),
    riskTier,
    maxLoan: Math.round(maxLoan),
    monthlyEstimate: Math.round(monthlyEstimate),
    tdsr: Math.round(finalTDSR * 1e3) / 10,
    pti: Math.round(finalPTI * 1e3) / 10,
    reasonCodes: reasons.slice(0, 4),
    status,
    priority,
    routing,
    offer
  };
  console.log("<<< [API/SCORE] REVENUE RESULT:", result);
  res.status(200).json(result);
});
app.post("/api/game-link", async (req, res) => {
  const { email, name, consent } = req.body;
  if (!email || !consent) {
    return res.status(400).json({ error: "Email and CASL consent required" });
  }
  const domain = process.env.MAILGUN_DOMAIN;
  if (!domain || !process.env.MAILGUN_API_KEY) {
    console.log(`[Mock Mailgun] Would send game link to ${email}`);
    return res.status(200).json({ success: true, mocked: true });
  }
  const appUrl = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
  const gameLink = `${appUrl}/?scene=GAME_GARAGE`;
  const htmlTemplate = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
      <h2 style="color: #00f3ff; background: #111; padding: 20px; text-align: center; text-transform: uppercase;">Your New Auto</h2>
      <div style="padding: 20px; border: 1px solid #eee;">
        <p>Hi ${name || "there"},</p>
        <p>Here is your direct link to jump back into Your New Auto Underground!</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${gameLink}" style="background-color: #00f3ff; color: #111; padding: 15px 30px; text-decoration: none; font-weight: bold; border-radius: 5px; text-transform: uppercase;">Play Now</a>
        </div>
        <p>Save this email so you can access the game anytime from any device.</p>
      </div>
      <div style="margin-top: 20px; font-size: 11px; color: #888; text-align: center; border-top: 1px solid #eee; padding-top: 20px;">
        <p>You are receiving this because you opted in to receive electronic messages from Your New Auto.</p>
        <p><strong>Your New Auto</strong><br/>123 Auto Drive, Toronto, ON M1A 1A1, Canada</p>
        <p>
          <a href="${appUrl}/privacy" style="color: #888;">Privacy Policy</a> | 
          <a href="${appUrl}/unsubscribe?email=${encodeURIComponent(email)}" style="color: #888;">Unsubscribe</a>
        </p>
      </div>
    </div>
  `;
  try {
    await mg.messages.create(domain, {
      from: `Your New Auto <hello@${domain}>`,
      to: [email],
      subject: "Your Direct Game Link - Your New Auto Underground",
      html: htmlTemplate
    });
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Mailgun error:", err);
    res.status(500).json({ error: "Failed to send email" });
  }
});
var verifyMailgunWebhook = (timestamp, token, signature) => {
  const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
  if (!signingKey) return false;
  const encodedToken = crypto4.createHmac("sha256", signingKey).update(timestamp.concat(token)).digest("hex");
  if (encodedToken.length !== signature.length) return false;
  return crypto4.timingSafeEqual(Buffer.from(encodedToken), Buffer.from(signature));
};
app.post("/api/webhooks/mailgun", (req, res) => {
  const signatureData = req.body?.signature;
  const eventData = req.body?.["event-data"];
  if (!signatureData || !eventData) {
    return res.status(400).send("Invalid payload");
  }
  const { timestamp, token, signature } = signatureData;
  if (!verifyMailgunWebhook(timestamp, token, signature)) {
    console.error("Mailgun webhook signature verification failed.");
    return res.status(401).send("Unauthorized");
  }
  console.log(`[Mailgun Webhook Verified] Event: ${eventData.event} | Recipient: ${eventData.recipient}`);
  if (eventData.event === "bounced" || eventData.event === "dropped") {
    console.warn(`Email delivery failed to ${eventData.recipient}. Reason: ${eventData.reason || eventData.description}`);
  }
  res.status(200).send("OK");
});
var ttsAudioCache = /* @__PURE__ */ new Map();
app.post("/api/tts/speech", async (req, res) => {
  const TTS_TIMEOUT_MS = 25e3;
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      console.warn("[TTS Timeout] Speech synthesis exceeded 25s limit");
      res.status(504).json({ error: { message: "TTS generation timed out" } });
    }
  }, TTS_TIMEOUT_MS);
  try {
    const { input } = req.body;
    if (!input || !input.trim()) {
      clearTimeout(timer);
      return res.status(400).json({ error: { message: "Missing required field: 'input'" } });
    }
    const cleanInput = input.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1").replace(/\[.*?\]/g, "").replace(/`/g, "").replace(/→/g, "").replace(/✓/g, "").replace(/•/g, "").replace(/\$(\d+)/g, "$1 dollars").replace(/\bSUV\b/gi, "S.U.V.").replace(/\bYNA\b/gi, "Your New Auto").replace(/\bSIN\b/gi, "Social Insurance Number").replace(/\s+/g, " ").trim();
    if (ttsAudioCache.has(cleanInput)) {
      clearTimeout(timer);
      const cached = ttsAudioCache.get(cleanInput);
      res.setHeader("Content-Type", cached.contentType);
      res.setHeader("Content-Length", cached.buffer.length);
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.send(cached.buffer);
    }
    if (process.env.CHATTERBOX_API_URL && process.env.CHATTERBOX_API_URL !== "http://localhost:4123") {
      try {
        const chatterboxUrl = process.env.CHATTERBOX_API_URL;
        const ttsResponse = await fetch(`${chatterboxUrl}/v1/audio/speech`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: cleanInput,
            voice: "onyx",
            exaggeration: 0.28,
            cfg_weight: 0.75,
            temperature: 0.55
          })
        });
        if (ttsResponse.ok) {
          clearTimeout(timer);
          res.setHeader("Content-Type", "audio/wav");
          const arrayBuffer = await ttsResponse.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          ttsAudioCache.set(cleanInput, { buffer, contentType: "audio/wav" });
          return res.send(buffer);
        }
      } catch (e) {
        console.warn("[Custom Chatterbox fallback to Neural]", e.message);
      }
    }
    const tts = new MsEdgeTTS();
    const jarvisVoice = process.env.JARVIS_VOICE || "en-GB-RyanNeural";
    const jarvisRate = process.env.JARVIS_VOICE_RATE || "+4%";
    const jarvisPitch = process.env.JARVIS_VOICE_PITCH || "-2Hz";
    await tts.setMetadata(jarvisVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(cleanInput, { rate: jarvisRate, pitch: jarvisPitch });
    const chunks = [];
    audioStream.on("data", (chunk) => chunks.push(chunk));
    audioStream.on("end", () => {
      clearTimeout(timer);
      const audioBuffer = Buffer.concat(chunks);
      ttsAudioCache.set(cleanInput, { buffer: audioBuffer, contentType: "audio/mpeg" });
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Length", audioBuffer.length);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(audioBuffer);
    });
    audioStream.on("error", (streamErr) => {
      clearTimeout(timer);
      console.error("[TTS Stream Error]", streamErr);
      if (!res.headersSent) res.status(500).json({ error: { message: "TTS Stream Error" } });
    });
  } catch (err) {
    clearTimeout(timer);
    console.error("[Neural TTS Error]", err);
    return res.status(500).json({ error: { message: "TTS generation failed" } });
  }
});
app.post("/api/lead", leadLimiter, async (req, res) => {
  const lead = req.body;
  const hasContactInfo = lead.name && lead.name.trim() !== "" || lead.email && lead.email.trim() !== "" || lead.phone && lead.phone.trim() !== "";
  if (!hasContactInfo) {
    return res.status(200).json({ success: true, message: "Partial lead ignored (no contact info)" });
  }
  console.log("\u{1F4B0} LEAD CAPTURED (Revenue Machine):", lead);
  try {
    if (lead.id) {
      const delCheck = await queryDB("SELECT 1 FROM deleted_leads WHERE id = $1", [lead.id]);
      if (delCheck.rows && delCheck.rows.length > 0) {
        console.log("[LEAD_IGNORED_DELETED]", lead.id);
        return res.status(200).json({ success: true, ignored: true, reason: "deleted" });
      }
    }
    const existingResult = lead.id ? await queryDB("SELECT * FROM leads WHERE id = $1", [lead.id]) : { rows: [] };
    const isExisting = existingResult.rows.length > 0;
    const l = lead;
    const id = l.id || `lead_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const status = l.status || (isExisting ? existingResult.rows[0].status : "NEW");
    const createdAt = isExisting ? existingResult.rows[0].createdAt : (/* @__PURE__ */ new Date()).toISOString();
    const insertQuery = `
      INSERT INTO leads (
        id, name, first_name, last_name, email, phone, location, employment, income, 
        "creditScore", "monthlyDebt", "downPayment", "housingStatus", vehicle, "selectedModel", "selectedModelYear",
        "approvalScore", "riskTier", "maxLoan", "monthlyEstimate", tdsr, pti, status, "createdAt",
        "marketingConsent", "privacyConsent", source, intent_score, intent_stage, contactability_score,
        qualification_score, lead_completeness, lead_quality_score, buying_commitment, next_best_action,
        vehicle_type, payment_target, budget, purchase_timeline, urgency, financing_needed, credit_situation,
        monthly_income, has_trade, trade_vehicle, pain_points, objections, active_objection, customer_summary,
        sales_brief, recommended_next_action, outcome_status, signals_json, forensics_json
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22, $23, $24,
        $25, $26, $27, $28, $29, $30,
        $31, $32, $33, $34, $35,
        $36, $37, $38, $39, $40, $41, $42,
        $43, $44, $45, $46, $47, $48, $49,
        $50, $51, $52, $53, $54
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
        email = EXCLUDED.email, phone = EXCLUDED.phone, location = EXCLUDED.location,
        employment = EXCLUDED.employment, income = EXCLUDED.income, "creditScore" = EXCLUDED."creditScore",
        "monthlyDebt" = EXCLUDED."monthlyDebt", "downPayment" = EXCLUDED."downPayment", "housingStatus" = EXCLUDED."housingStatus",
        vehicle = EXCLUDED.vehicle, "selectedModel" = EXCLUDED."selectedModel", "selectedModelYear" = EXCLUDED."selectedModelYear",
        "approvalScore" = EXCLUDED."approvalScore", "riskTier" = EXCLUDED."riskTier", "maxLoan" = EXCLUDED."maxLoan",
        "monthlyEstimate" = EXCLUDED."monthlyEstimate", tdsr = EXCLUDED.tdsr, pti = EXCLUDED.pti, status = EXCLUDED.status,
        "marketingConsent" = EXCLUDED."marketingConsent", "privacyConsent" = EXCLUDED."privacyConsent", source = EXCLUDED.source,
        intent_score = EXCLUDED.intent_score, intent_stage = EXCLUDED.intent_stage,
        contactability_score = EXCLUDED.contactability_score, qualification_score = EXCLUDED.qualification_score,
        lead_completeness = EXCLUDED.lead_completeness, lead_quality_score = EXCLUDED.lead_quality_score,
        buying_commitment = EXCLUDED.buying_commitment, next_best_action = EXCLUDED.next_best_action,
        vehicle_type = EXCLUDED.vehicle_type, payment_target = EXCLUDED.payment_target, budget = EXCLUDED.budget,
        purchase_timeline = EXCLUDED.purchase_timeline, urgency = EXCLUDED.urgency,
        financing_needed = EXCLUDED.financing_needed, credit_situation = EXCLUDED.credit_situation,
        monthly_income = EXCLUDED.monthly_income, has_trade = EXCLUDED.has_trade, trade_vehicle = EXCLUDED.trade_vehicle,
        pain_points = EXCLUDED.pain_points, objections = EXCLUDED.objections, active_objection = EXCLUDED.active_objection,
        customer_summary = EXCLUDED.customer_summary, sales_brief = EXCLUDED.sales_brief,
        recommended_next_action = EXCLUDED.recommended_next_action, outcome_status = EXCLUDED.outcome_status,
        signals_json = EXCLUDED.signals_json,
        forensics_json = EXCLUDED.forensics_json
    `;
    const values = [
      id,
      l.name || "",
      l.first_name || l.firstName || "",
      l.last_name || l.lastName || "",
      l.email || "",
      l.phone || "",
      l.location || "",
      l.employment || "",
      l.income || "",
      l.creditScore || "",
      l.monthlyDebt || "",
      l.downPayment || "",
      l.housingStatus || "",
      l.vehicle || "",
      l.selectedModel || "",
      l.selectedModelYear || null,
      l.approvalScore || null,
      l.riskTier || "",
      l.maxLoan || null,
      l.monthlyEstimate || null,
      l.tdsr || null,
      l.pti || null,
      status,
      createdAt,
      l.marketingConsent || false,
      l.privacyConsent || false,
      l.source || "MAIN",
      l.intent_score ?? l.intentScore ?? 0,
      l.intent_stage || l.intentStage || "CURIOUS",
      l.contactability_score ?? l.contactabilityScore ?? 0,
      l.qualification_score ?? l.qualificationScore ?? 0,
      l.lead_completeness ?? l.completenessScore ?? 0,
      l.lead_quality_score ?? l.leadQualityScore ?? 0,
      l.buying_commitment || l.buyingCommitment || "NONE",
      l.next_best_action || l.nextBestAction || "EDUCATE",
      l.vehicle_type || l.vehicleType || "",
      l.payment_target || l.paymentTarget || "",
      l.budget ? String(l.budget) : l.monthlyBudget ? String(l.monthlyBudget) : "",
      l.purchase_timeline || l.purchaseTimeline || "",
      l.urgency || "",
      l.financing_needed !== void 0 ? Boolean(l.financing_needed) : true,
      l.credit_situation || l.creditSituation || "",
      l.monthly_income ? String(l.monthly_income) : l.income || "",
      Boolean(l.has_trade || l.hasTrade),
      l.trade_vehicle || l.tradeVehicle || "",
      l.pain_points || l.painPoints || "",
      l.objections || "",
      l.active_objection || l.activeObjection || "",
      l.customer_summary || l.customerSummary || "",
      l.sales_brief || l.salesBrief || "",
      l.recommended_next_action || l.recommendedNextAction || "CALL_ASAP",
      l.outcome_status || l.outcomeStatus || "NEW",
      l.signals_json || (l.signals ? JSON.stringify(l.signals) : null),
      l.forensics_json || null
    ];
    await queryDB(insertQuery, values);
    if (isExisting) {
      return res.status(200).json({
        success: true,
        leadId: id,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        automationTriggered: ["SMS_SALES", "EMAIL_USER"]
      });
    }
    const newLead = { ...l, id, status, createdAt };
    try {
      const domain = process.env.MAILGUN_DOMAIN;
      if (domain) {
        const adminEmail = process.env.ADMIN_EMAIL || "stephan.sabeski12@gmail.com";
        const approvalString = newLead.maxLoan ? `$${newLead.maxLoan.toLocaleString()} Approved` : "Sales Desk Buyer";
        const isHighIntent = (newLead.intent_score ?? newLead.intentScore ?? 0) >= 70;
        const adminHtml = `
          <div style="font-family: sans-serif; padding: 20px; max-width: 600px; border: 1px solid #1a1a2e; border-radius: 8px;">
            <h2 style="color: ${isHighIntent ? "#f59e0b" : "#00f3ff"}; margin-bottom: 8px;">
              ${isHighIntent ? "\u{1F525} HIGH-INTENT BUYER ALERT" : "\u26A1 New Lead Alert"}: ${newLead.name || newLead.first_name || "Prospect"}
            </h2>
            <div style="background: #f8fafc; padding: 12px; border-radius: 6px; margin-bottom: 16px;">
              <p style="margin: 4px 0;"><strong>Quality Score:</strong> ${newLead.lead_quality_score ?? newLead.leadQualityScore ?? "N/A"}/100 | <strong>Intent:</strong> ${newLead.intent_score ?? newLead.intentScore ?? 0}/100 (${newLead.intent_stage || "CURIOUS"})</p>
              <p style="margin: 4px 0;"><strong>Recommended Action:</strong> <span style="color: #dc2626; font-weight: bold;">${newLead.recommended_next_action || newLead.recommendedNextAction || "CALL ASAP"}</span></p>
            </div>
            <p style="margin: 4px 0;"><strong>Phone:</strong> ${newLead.phone || "Not Provided"}</p>
            <p style="margin: 4px 0;"><strong>Email:</strong> ${newLead.email || "Not Provided"}</p>
            <p style="margin: 4px 0;"><strong>Target Vehicle & Budget:</strong> ${newLead.vehicle_type || newLead.vehicle || "Vehicle"} (${newLead.payment_target ? "$" + newLead.payment_target + "/mo" : newLead.income ? "$" + newLead.income + "/mo income" : "Flexible"})</p>
            <p style="margin: 4px 0;"><strong>Timeline:</strong> ${newLead.purchase_timeline || "Within 2 weeks"}</p>
            <p style="margin: 4px 0;"><strong>Trade-In:</strong> ${newLead.trade_vehicle || (newLead.has_trade ? "Yes" : "None Stated")}</p>
            ${newLead.sales_brief ? `<div style="margin-top: 16px; padding: 12px; background: #ecfdf5; border-left: 4px solid #10b981;"><p style="margin: 0; font-size: 13px; white-space: pre-wrap;"><strong>Sales Brief for Stephan:</strong><br />${newLead.sales_brief}</p></div>` : ""}
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #e2e8f0;" />
            <p><a href="https://www.yournewauto.ca" style="color: #2563eb; font-weight: bold;">Login to Admin CRM</a> to view full sales intelligence and initiate call.</p>
          </div>
        `;
        mg.messages.create(domain, {
          from: `YNA Sales Desk <hello@${domain}>`,
          to: [adminEmail],
          subject: `${isHighIntent ? "\u{1F525} HIGH INTENT" : "\u26A1 Lead"}: ${newLead.name || "Prospect"} - ${newLead.vehicle_type || "Vehicle"} ($${newLead.payment_target || newLead.income || "0"}/mo)`,
          html: adminHtml
        }).catch((err) => console.error("Failed to send admin notification:", err));
      }
    } catch (e) {
      console.error("Mailgun config error for admin notification:", e);
    }
    return res.status(200).json({
      success: true,
      leadId: id,
      capturedAt: createdAt,
      automationTriggered: ["SMS_SALES", "EMAIL_USER"]
    });
  } catch (err) {
    console.error("Database error saving lead:", err);
    return res.status(500).json({ error: "Failed to save lead" });
  }
});
var getHostUrl = (req) => {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const forwardedHost = req.headers["x-forwarded-host"];
  if (forwardedHost) {
    const proto = forwardedProto ? forwardedProto.split(",")[0].trim() : "https";
    return `${proto}://${forwardedHost}`;
  }
  return process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
};
app.get("/api/auth/google", authLimiter, (req, res) => {
  const clientID = process.env.GOOGLE_CLIENT_ID;
  if (!clientID) {
    console.error("GOOGLE_CLIENT_ID is not configured.");
    return res.status(500).send("Google OAuth is not configured on the server. Please set GOOGLE_CLIENT_ID.");
  }
  const hostUrl = getHostUrl(req);
  const redirectUri = `${hostUrl}/api/auth/google/callback`;
  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientID)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid%20email%20profile`;
  res.redirect(googleAuthUrl);
});
app.get("/api/auth/google/callback", authLimiter, async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    console.error("Google OAuth error parameter:", error);
    return res.redirect("/admin?error=auth_failed");
  }
  if (!code) {
    return res.redirect("/admin?error=no_code");
  }
  const clientID = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientID || !clientSecret) {
    console.error("Missing Google credentials in callback");
    return res.redirect("/admin?error=configuration_error");
  }
  const hostUrl = getHostUrl(req);
  const redirectUri = `${hostUrl}/api/auth/google/callback`;
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientID,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code"
      })
    });
    if (!tokenResponse.ok) {
      const errBody = await tokenResponse.text();
      console.error("Google token exchange failed:", errBody);
      return res.redirect("/admin?error=token_exchange_failed");
    }
    const tokenData = await tokenResponse.json();
    const userinfoResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    if (!userinfoResponse.ok) {
      console.error("Google userinfo fetch failed");
      return res.redirect("/admin?error=userinfo_failed");
    }
    const userData = await userinfoResponse.json();
    const email = userData.email?.toLowerCase();
    if (!email) {
      console.error("No email returned from Google profile");
      return res.redirect("/admin?error=no_email");
    }
    const allowedEmailsStr = process.env.ALLOWED_ADMIN_EMAILS || "";
    const allowedEmails = allowedEmailsStr.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (allowedEmails.length === 0) {
      console.warn("WARNING: ALLOWED_ADMIN_EMAILS is empty. Blocking all logins.");
    }
    if (!allowedEmails.includes(email)) {
      console.warn(`Unauthorized login attempt by: ${email}`);
      return res.redirect(`/admin?error=unauthorized_email&email=${encodeURIComponent(email)}`);
    }
    const sessionToken = signSession(email);
    res.setHeader(
      "Set-Cookie",
      `admin_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=7200${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
    );
    console.log(`Successfully authenticated admin: ${email}`);
    return res.redirect("/admin");
  } catch (err) {
    console.error("Error during Google OAuth process:", err);
    return res.redirect("/admin?error=server_error");
  }
});
app.post("/api/admin/logout", (req, res) => {
  res.setHeader(
    "Set-Cookie",
    "admin_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
  );
  return res.status(200).json({ success: true });
});
app.get("/api/leads", requireAdmin, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  try {
    let rows = [];
    try {
      const result = await queryDB('SELECT * FROM leads ORDER BY created_at DESC NULLS LAST, "createdAt" DESC NULLS LAST');
      rows = result.rows || [];
    } catch (queryErr) {
      console.warn("[DB] Primary leads query failed, attempting simple SELECT *:", queryErr.message);
      const fallback = await queryDB("SELECT * FROM leads");
      rows = fallback.rows || [];
    }
    const normalized = rows.map((r) => {
      const ts = r.createdAt || r.created_at || r.timestamp || (/* @__PURE__ */ new Date()).toISOString();
      return {
        ...r,
        createdAt: ts,
        created_at: ts,
        source: r.source || (r.intent_score !== void 0 ? "AI_SALES_DESK" : "MAIN"),
        status: r.status || "NEW"
      };
    });
    normalized.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.status(200).json(normalized);
  } catch (err) {
    console.error("GET /api/leads error:", err);
    res.status(500).json({ error: "Database error" });
  }
});
app.patch("/api/leads/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  try {
    const ALLOWED_LEAD_UPDATE_FIELDS = /* @__PURE__ */ new Set([
      "name",
      "first_name",
      "last_name",
      "email",
      "phone",
      "location",
      "employment",
      "income",
      "creditScore",
      "monthlyDebt",
      "downPayment",
      "housingStatus",
      "vehicle",
      "selectedModel",
      "selectedModelYear",
      "approvalScore",
      "riskTier",
      "maxLoan",
      "monthlyEstimate",
      "tdsr",
      "pti",
      "status",
      "marketingConsent",
      "privacyConsent",
      "source",
      "intent_score",
      "intent_stage",
      "contactability_score",
      "qualification_score",
      "lead_completeness",
      "lead_quality_score",
      "buying_commitment",
      "next_best_action",
      "vehicle_type",
      "payment_target",
      "budget",
      "purchase_timeline",
      "urgency",
      "financing_needed",
      "financing_context",
      "credit_situation",
      "monthly_income",
      "has_trade",
      "trade_vehicle",
      "pain_points",
      "goals",
      "preferences",
      "objections",
      "active_objection",
      "customer_summary",
      "sales_brief",
      "recommended_next_action",
      "outcome_status",
      "notes"
    ]);
    const setClause = [];
    const values = [id];
    let i = 2;
    for (const [key, value] of Object.entries(updates)) {
      if (!ALLOWED_LEAD_UPDATE_FIELDS.has(key)) continue;
      setClause.push(`"${key}" = $${i}`);
      values.push(value);
      i++;
    }
    if (setClause.length === 0) {
      return res.status(200).json({ success: true });
    }
    const query = `UPDATE leads SET ${setClause.join(", ")} WHERE id = $1 RETURNING *`;
    const result = await queryDB(query, values);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Lead not found" });
    }
    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});
app.delete("/api/leads/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await queryDB("INSERT INTO deleted_leads (id) VALUES ($1) ON CONFLICT (id) DO NOTHING", [id]);
    await queryDB("DELETE FROM leads WHERE id = $1", [id]);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("DELETE /api/leads error:", err);
    res.status(500).json({ error: "Database error" });
  }
});
app.use((err, req, res, next) => {
  const sanitized = RedactionService.redact(err);
  console.error("[UNHANDLED_ERROR]", sanitized.message);
  if (res.headersSent) {
    return next(err);
  }
  return res.status(err.status || 500).json({
    error: "INTERNAL_ERROR",
    message: "An unexpected internal error occurred. Please contact support.",
    code: "SEC_ERR_500"
  });
});
async function startServer() {
  await ensureDB();
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path2.join(process.cwd(), "dist");
    app.use("/", expressStaticGzip(distPath, {
      enableBrotli: true,
      customCompressions: [{
        encodingName: "deflate",
        fileExtension: "zz"
      }],
      orderPreference: ["br", "gz"],
      serveStatic: {
        maxAge: "1y",
        // Cache assets for 1 year (Vite hashes file names so this is safe)
        setHeaders: (res, filePath) => {
          if (filePath.endsWith("index.html")) {
            res.setHeader("Cache-Control", "no-cache");
          }
        }
      }
    }));
    app.get("*", (req, res) => {
      res.sendFile(path2.join(distPath, "index.html"));
    });
  }
  const httpServer = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
  setupVoiceGateway(httpServer);
}
if (!process.env.VERCEL && process.env.NODE_ENV !== "test" && !process.env.TEST_RUNNER) {
  startServer();
}
var server_default = app;
export {
  RedactionService,
  ai,
  calculateLeadIntelligence,
  server_default as default,
  peptideKnowledgeEngine
};
