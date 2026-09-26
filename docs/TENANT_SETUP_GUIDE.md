# Jessica Multi-Tenant Setup & Deployment Guide

This guide walks through setting up the multi-tenant Jessica platform for new dealerships, configuring API keys, deploying the voice gateway, and embedding the client widget.

---

## 1. Environment Setup

Copy `.env.example` to `.env` in your deployment root:

```env
# Server Configuration
PORT=3001
NODE_ENV=production

# Security & Secrets
JWT_SECRET=your-secure-jwt-secret-minimum-32-chars
GEMINI_API_KEY=AIzaSy...your-gemini-live-api-key

# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/winston_production?sslmode=require

# CORS & Domain Restrictions
ALLOWED_ORIGINS=https://yourdealership.com,https://demo.yournewauto.ca

# Rate Limiting
MAX_CONCURRENT_VOICE_SESSIONS=50
RATE_LIMIT_REQUESTS_PER_MINUTE=120
```

---

## 2. Database Migration

Run the provided PostgreSQL schema to create all multi-tenant tables:

```bash
# Using psql command line
psql $DATABASE_URL -f winston-ai-platform/services/api/src/schema.sql
```

The schema creates:
- `tenants`: Primary tenant registry
- `dealers`: Individual rooftop store locations
- `tenant_api_keys`: Hashed API credentials
- `leads`: CRM leads captured by voice
- `sessions`: Voice session diagnostic telemetry
- `conversations`: Conversation transcripts
- `vehicles`: Dealer inventory catalog

---

## 3. Creating a New Dealership Tenant

Insert a tenant into the database via SQL or via the REST API:

### Via SQL:
```sql
INSERT INTO tenants (
    id, 
    name, 
    slug, 
    domain, 
    status, 
    config
) VALUES (
    't_dealer_metro_ford', 
    'Metro Ford Edmonton', 
    'metro-ford', 
    'metroford.ca', 
    'active', 
    '{
        "dealershipName": "Metro Ford Edmonton",
        "persona": {
            "name": "Jessica",
            "tone": "warm_professional",
            "greeting": "Hi! Thanks for calling Metro Ford. I am Jessica, your digital sales concierge. What vehicle can I help you find today?"
        },
        "voice": {
            "model": "gemini-2.0-flash-exp",
            "voiceName": "Aoede",
            "temperature": 0.4
        },
        "crm": {
            "provider": "webhook",
            "webhookUrl": "https://crm.metroford.ca/api/leads/v1"
        }
    }'::jsonb
);

-- Generate API Key for the widget
INSERT INTO tenant_api_keys (
    id,
    tenant_id,
    key_hash,
    label,
    created_at
) VALUES (
    'key_mf_live_01',
    't_dealer_metro_ford',
    crypt('sec_live_metroford_abc123', gen_salt('bf')),
    'Production Website Widget Key',
    NOW()
);
```

---

## 4. Embedding the Voice Concierge on Dealership Websites

Place the following script on the dealership's HTML page:

```html
<!-- Jessica Voice Concierge Widget -->
<script 
  src="https://cdn.yournewauto.ca/widgets/jessica-widget.js" 
  data-tenant-key="sec_live_metroford_abc123"
  data-position="bottom-right"
  data-theme="dark"
  async>
</script>
```

When the customer clicks the voice widget button:
1. The widget calls `/api/v1/widget/bootstrap` with `data-tenant-key`.
2. The server returns the dealership's branded `TenantConfig` and an ephemeral session token.
3. The widget establishes an audio duplex session over `wss://your-gateway.com/live-gateway`.
4. The customer speaks directly with Jessica in ultra-low latency (<850ms conversational turn).

---

## 5. CRM Lead Forwarding & Webhook Payloads

When a customer provides their contact info or expresses strong buying interest, Jessica's extraction pipeline posts a structured JSON payload to the dealer's CRM webhook:

```json
{
  "event": "lead.qualified",
  "tenantId": "t_dealer_metro_ford",
  "dealershipName": "Metro Ford Edmonton",
  "lead": {
    "name": "Sarah Miller",
    "phone": "+17805550192",
    "email": "sarah.miller@example.com",
    "budget": "$35,000",
    "desiredVehicle": {
        "year": 2024,
        "make": "Ford",
        "model": "Explorer",
        "trim": "XLT"
    },
    "tradeIn": {
        "year": 2018,
        "make": "Honda",
        "model": "CR-V",
        "mileage": "85,000 km"
    },
    "creditTier": "good",
    "leadScore": 92,
    "conversationSummary": "Customer looking to finance 2024 Ford Explorer XLT with trade-in. Prefers evening appointment.",
    "sessionId": "conv_live_8f9301da",
    "timestamp": "2026-09-24T22:30:00.000Z"
  }
}
```

---

## 6. Production Verification & Diagnostics

To verify your gateway and client audio health:
- Press `Ctrl + Shift + D` (or tap the telemetry icon) on the client page to open the **DiagnosticHUD**.
- View real-time WebSocket connection state, AudioContext sample rate (16kHz / 24kHz), VAD voice energy levels, and round-trip turn latencies.
- Access the server health check at `GET /health` to confirm database connectivity and active WebSocket session count.
