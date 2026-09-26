import pg from 'pg';
const { Client } = pg;

const isProduction = process.env.NODE_ENV === "production" || !!process.env.VERCEL;

// In-Memory Storage Fallback when PostgreSQL is unavailable or unset
interface InMemoryStore {
  anonymousSessions: Map<string, any>;
  conversations: Map<string, any>;
  conversationTurns: Map<string, any>;
  leads: Map<string, any>;
  deletedLeads: Set<string>;
  scores: Array<{ id: number; name: string; email: string; score: number; created_at: string }>;
  integrations: Map<string, any>;
  tenantCredentials: Map<string, any>;
  credentialVersions: Map<string, any>;
  credentialAuditEvents: Array<any>;
}

const memoryStore: InMemoryStore = {
  anonymousSessions: new Map(),
  conversations: new Map(),
  conversationTurns: new Map(),
  leads: new Map(),
  deletedLeads: new Set(),
  scores: [],
  integrations: new Map(),
  tenantCredentials: new Map(),
  credentialVersions: new Map(),
  credentialAuditEvents: []
};

let dbDisabled = false;
let pool: any = null;

function normalizeConnectionString(rawUrl?: string): string | undefined {
  if (!rawUrl) return undefined;
  if (
    (rawUrl.includes('sslmode=require') || rawUrl.includes('sslmode=prefer') || rawUrl.includes('sslmode=verify-ca')) &&
    !rawUrl.includes('uselibpqcompat=')
  ) {
    return rawUrl.includes('?') ? `${rawUrl}&uselibpqcompat=true` : `${rawUrl}?uselibpqcompat=true`;
  }
  return rawUrl;
}

function getPool(connectionString: string) {
  if (!pool) {
    pool = new pg.Pool({
      connectionString,
      ssl: isProduction ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      max: 10,
    });
    pool.on('error', (err: any) => {
      console.warn('[DB] Unexpected error on idle pool client:', err.message);
    });
  }
  return pool;
}

export async function queryDB(text: string, params: any[] = []): Promise<{ rows: any[]; rowCount: number }> {
  const rawConnectionString = 
    process.env.POSTGRES_URL || 
    process.env.DATABASE_URL || 
    process.env.POSTGRES_DATABASE_URL || 
    process.env.POSTGRES_PRISMA_URL;
  const connectionString = normalizeConnectionString(rawConnectionString);

  if (connectionString && !dbDisabled) {
    try {
      const p = getPool(connectionString);
      const res = await p.query(text, params);
      return { rows: res.rows || [], rowCount: res.rowCount || 0 };
    } catch (err: any) {
      console.warn("[DB] PostgreSQL pool query error, retrying with dedicated client:", err.message);
      try {
        const client = new pg.Client({
          connectionString,
          ssl: isProduction ? { rejectUnauthorized: false } : undefined,
          connectionTimeoutMillis: 10000,
        });
        await client.connect();
        const res = await client.query(text, params);
        await client.end().catch(() => {});
        return { rows: res.rows || [], rowCount: res.rowCount || 0 };
      } catch (retryErr: any) {
        console.error("[DB] PostgreSQL retry failed:", retryErr.message);
        if (connectionString) {
          throw retryErr;
        }
      }
    }
  }

  // Execute against in-memory fallback only when no database connection string exists
  return executeInMemoryQuery(text, params);
}

function executeInMemoryQuery(text: string, params: any[]): { rows: any[]; rowCount: number } {
  const clean = text.trim().replace(/\s+/g, ' ');

  // Deleted leads tombstone check
  if (/SELECT\s+1\s+FROM\s+deleted_leads\s+WHERE\s+id\s*=\s*\$1/i.test(clean)) {
    const id = params[0];
    if (id && memoryStore.deletedLeads.has(id)) {
      return { rows: [{ '1': 1 }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  if (/INSERT\s+INTO\s+deleted_leads/i.test(clean)) {
    const id = params[0];
    if (id) memoryStore.deletedLeads.add(id);
    return { rows: [], rowCount: 1 };
  }

  // 1. Health check: SELECT 1 (standalone or with alias, without FROM clause)
  if (/^SELECT\s+1(\s+as\s+\w+)?\s*$/i.test(clean)) {
    return { rows: [{ ok: 1 }], rowCount: 1 };
  }

  // 2. Schema creation queries
  if (/^CREATE\s+(TABLE|INDEX)/i.test(clean) || /^ALTER\s+TABLE/i.test(clean)) {
    return { rows: [], rowCount: 0 };
  }

  // 3. Anonymous Sessions
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
    const expires_at = Date.now() + 24 * 60 * 60 * 1000;
    const record = { id, session_token_hash, expires_at, created_at: new Date().toISOString() };
    memoryStore.anonymousSessions.set(id, record);
    return { rows: [record], rowCount: 1 };
  }

  // 4. Conversations
  if (/SELECT id, version, status FROM conversations WHERE anonymous_session_id = \$1/i.test(clean)) {
    const sessionId = params[0];
    const userConvs = Array.from(memoryStore.conversations.values())
      .filter(c => c.anonymous_session_id === sessionId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

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
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    memoryStore.conversations.set(id, record);
    return { rows: [record], rowCount: 1 };
  }

  if (/UPDATE conversations SET version = \$1/i.test(clean)) {
    const [version, id, oldVersion] = params;
    const c = memoryStore.conversations.get(id);
    if (c && Number(c.version) === Number(oldVersion)) {
      c.version = version;
      c.updated_at = new Date().toISOString();
      return { rows: [c], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  // 5. Conversation Turns
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
    const turns = Array.from(memoryStore.conversationTurns.values())
      .filter(t => t.conversation_id === convId && t.status === 'COMPLETED')
      .sort((a, b) => (a.sequence_number || 0) - (b.sequence_number || 0));
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
      status: status || 'PROCESSING',
      execution_id,
      processing_started_at: new Date().toISOString(),
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
      t.status = 'COMPLETED';
      t.completed_at = new Date().toISOString();
      return { rows: [t], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  if (/UPDATE conversation_turns SET status = 'FAILED'/i.test(clean)) {
    const [id, execution_id] = params;
    const t = memoryStore.conversationTurns.get(id);
    if (t) {
      t.status = 'FAILED';
      t.failed_at = new Date().toISOString();
      return { rows: [t], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  if (/DELETE FROM conversation_turns WHERE id = \$1/i.test(clean)) {
    const [id] = params;
    const existed = memoryStore.conversationTurns.delete(id);
    return { rows: [], rowCount: existed ? 1 : 0 };
  }

  // 6. Leads
  if (/SELECT \* FROM leads WHERE id = \$1/i.test(clean)) {
    const [id] = params;
    const l = memoryStore.leads.get(id);
    return { rows: l ? [l] : [], rowCount: l ? 1 : 0 };
  }

  if (/SELECT \* FROM leads WHERE conversation_id = \$1/i.test(clean)) {
    const [convId] = params;
    const found = Array.from(memoryStore.leads.values()).find((l: any) => l.conversation_id === convId);
    return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
  }

  if (/SELECT \*.*FROM leads/i.test(clean) && !/WHERE/i.test(clean)) {
    const allLeads = Array.from(memoryStore.leads.values())
      .sort((a: any, b: any) => new Date(b.createdAt || b.created_at || 0).getTime() - new Date(a.createdAt || a.created_at || 0).getTime());
    return { rows: allLeads, rowCount: allLeads.length };
  }

  if (/INSERT INTO leads/i.test(clean)) {
    const id = params[0];
    const existing = memoryStore.leads.get(id) || {};
    const record: any = { ...existing, id };
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
      record.has_trade = params[17] !== undefined ? params[17] : record.has_trade;
      record.trade_vehicle = params[18] || record.trade_vehicle;
      record.purchase_timeline = params[19] || record.purchase_timeline;
      record.urgency = params[20] || record.urgency;
      record.source = params[21] || record.source || 'JARVIS_LIVE';
      record.status = params[22] || record.status || 'NEW';
      record.intent_score = params[23] !== undefined ? params[23] : record.intent_score;
      record.intent_stage = params[24] || record.intent_stage;
      record.contactability_score = params[25] !== undefined ? params[25] : record.contactability_score;
      record.qualification_score = params[26] !== undefined ? params[26] : record.qualification_score;
      record.lead_completeness = params[27] !== undefined ? params[27] : record.lead_completeness;
      record.lead_quality_score = params[28] !== undefined ? params[28] : record.lead_quality_score;
      record.buying_commitment = params[29] || record.buying_commitment;
      record.next_best_action = params[30] || record.next_best_action;
      record.recommended_next_action = params[31] || record.recommended_next_action;
      record.sales_brief = params[32] || record.sales_brief;
      record.customer_summary = params[33] || record.customer_summary;
      record.createdAt = params[34] || record.createdAt || new Date().toISOString();
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

  // 7. Scores
  if (/SELECT.*FROM scores/i.test(clean)) {
    const sorted = [...memoryStore.scores].sort((a, b) => b.score - a.score).slice(0, 3);
    const rows = sorted.map(s => ({
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
      created_at: created_at || new Date().toISOString()
    };
    memoryStore.scores.push(record);
    return { rows: [record], rowCount: 1 };
  }

  // 8. Integrations
  if (/INSERT INTO winston_integrations/i.test(clean)) {
    const [id, tenant_id, provider, integration_type, display_name, status, enabled] = params;
    const record = {
      id,
      tenant_id,
      provider,
      integration_type,
      display_name,
      status: status || 'ACTIVE',
      enabled: enabled !== false,
      credential_version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
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
    // Handling rotation and revocation updates
    const isRevoke = /SET status = 'REVOKED'/i.test(clean);
    const isVersionUpdate = /SET credential_version = \$1/i.test(clean);

    if (isRevoke) {
      const [integrationId, tenantId] = params;
      const item = memoryStore.integrations.get(integrationId);
      if (item && item.tenant_id === tenantId) {
        item.status = 'REVOKED';
        item.updated_at = new Date().toISOString();
        return { rows: [item], rowCount: 1 };
      }
    } else if (isVersionUpdate) {
      const [newVersion, integrationId, tenantId] = params;
      const item = memoryStore.integrations.get(integrationId);
      if (item && item.tenant_id === tenantId) {
        item.credential_version = newVersion;
        item.status = 'ACTIVE';
        item.updated_at = new Date().toISOString();
        return { rows: [item], rowCount: 1 };
      }
    }
    return { rows: [], rowCount: 0 };
  }

  // 9. Tenant Credentials
  if (/INSERT INTO winston_tenant_credentials/i.test(clean)) {
    const [id, tenant_id, integration_id, provider, auth_type] = params;
    const record = {
      id,
      tenant_id,
      integration_id,
      provider,
      auth_type,
      status: 'ACTIVE',
      active_version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
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

  // Active Credential Resolution Query
  if (/SELECT\s+c\.id\s+AS\s+credential_id/i.test(clean)) {
    const [tenantId, provider] = params;
    for (const cred of memoryStore.tenantCredentials.values()) {
      if (cred.tenant_id === tenantId && cred.provider === provider) {
        const intg = memoryStore.integrations.get(cred.integration_id);
        const ver = Array.from(memoryStore.credentialVersions.values()).find(
          v => v.credential_id === cred.id && v.status === 'ACTIVE'
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
        c.status = 'REVOKED';
        c.updated_at = new Date().toISOString();
        return { rows: [c], rowCount: 1 };
      }
    } else if (/SET active_version = \$1/i.test(clean)) {
      const [newVersion, credId, tenantId] = params;
      const c = memoryStore.tenantCredentials.get(credId);
      if (c && c.tenant_id === tenantId) {
        c.active_version = newVersion;
        c.status = 'ACTIVE';
        c.updated_at = new Date().toISOString();
        return { rows: [c], rowCount: 1 };
      }
    }
    return { rows: [], rowCount: 0 };
  }

  // 10. Credential Versions
  if (/INSERT INTO winston_credential_versions/i.test(clean)) {
    const [id, credential_id, tenant_id, integration_id, version, status, secret_ciphertext, secret_encryption_key_ref, secret_fingerprint, metadata, actor] = params;
    
    // Check Single Active Version Uniqueness invariant
    if (status === 'ACTIVE') {
      const existingActive = Array.from(memoryStore.credentialVersions.values()).find(
        v => v.credential_id === credential_id && v.status === 'ACTIVE'
      );
      if (existingActive) {
        throw new Error('UNIQUE CONSTRAINT VIOLATION: uq_winston_active_credential_version. Only one active version allowed per credential.');
      }
    }

    const record = {
      id,
      credential_id,
      tenant_id,
      integration_id,
      version,
      status: status || 'ACTIVE',
      secret_ciphertext,
      secret_encryption_key_ref,
      secret_fingerprint,
      metadata: typeof metadata === 'string' ? JSON.parse(metadata) : metadata,
      created_by: actor || 'SYSTEM',
      created_at: new Date().toISOString(),
      activated_at: new Date().toISOString()
    };
    memoryStore.credentialVersions.set(id, record);
    return { rows: [record], rowCount: 1 };
  }

  if (/UPDATE winston_credential_versions/i.test(clean)) {
    if (/SET status = 'ARCHIVED'/i.test(clean)) {
      const [credId] = params;
      for (const v of memoryStore.credentialVersions.values()) {
        if (v.credential_id === credId && v.status === 'ACTIVE') {
          v.status = 'ARCHIVED';
          v.retired_at = new Date().toISOString();
        }
      }
      return { rows: [], rowCount: 1 };
    } else if (/SET status = 'REVOKED'/i.test(clean)) {
      const [credId] = params;
      for (const v of memoryStore.credentialVersions.values()) {
        if (v.credential_id === credId && v.status !== 'REVOKED') {
          v.status = 'REVOKED';
          v.revoked_at = new Date().toISOString();
        }
      }
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  // 11. Credential Audit Events
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
      created_at: new Date().toISOString()
    };
    memoryStore.credentialAuditEvents.push(record);
    return { rows: [record], rowCount: 1 };
  }

  // 12. Client DTO list query
  if (/SELECT\s+i\.id,\s+i\.tenant_id/i.test(clean)) {
    const [tenantId] = params;
    const results: any[] = [];
    for (const intg of memoryStore.integrations.values()) {
      if (intg.tenant_id === tenantId) {
        const cred = Array.from(memoryStore.tenantCredentials.values()).find(c => c.integration_id === intg.id && c.tenant_id === tenantId);
        const ver = cred ? Array.from(memoryStore.credentialVersions.values()).find(v => v.credential_id === cred.id && v.status === 'ACTIVE') : null;
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

export async function initWinstonDB() {
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

