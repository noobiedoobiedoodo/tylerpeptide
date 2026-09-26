import cookieParser from 'cookie-parser';
import "dotenv/config";
import express from "express";
import compression from "compression";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import formData from "form-data";
import Mailgun from "mailgun.js";
import expressStaticGzip from "express-static-gzip";
import pg from "pg";
const { Client } = pg;
import { GoogleGenAI, Type } from "@google/genai";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { sessionRouter } from './server_routes/session.js';
import { chatRouter } from './server_routes/chat.js';
import { voiceLeadRouter } from './server_routes/voiceLeadSync.js';
import { initWinstonDB, queryDB } from './server_routes/db.js';
import { ai, calculateLeadIntelligence } from './server_routes/ai.js';
import { setupVoiceGateway } from './server_routes/voiceGateway.js';
import { peptideRouter } from './server_routes/peptideRoutes.js';
import { peptideKnowledgeEngine } from './peptide/peptideKnowledgeEngine.js';
export { ai, calculateLeadIntelligence, peptideKnowledgeEngine };

// Production Log Redaction Interceptor
// Masks API keys, tokens, and credentials from console output
export const RedactionService = {
  redact: (item: any): any => {
    if (typeof item === 'string') {
      return item.replace(/(AIzaSy[A-Za-z0-9_-]{33}|Bearer\s+[A-Za-z0-9._-]+)/g, '[REDACTED]');
    }
    return item;
  }
};

const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;
console.log = (...args: any[]) => originalConsoleLog(...args.map(a => RedactionService.redact(a)));
console.warn = (...args: any[]) => originalConsoleWarn(...args.map(a => RedactionService.redact(a)));
console.error = (...args: any[]) => originalConsoleError(...args.map(a => RedactionService.redact(a)));

// Mailgun setup
const mailgun = new Mailgun(formData);
const mg = mailgun.client({
  username: 'api',
  key: process.env.MAILGUN_API_KEY || 'dummy_key',
});

const app = express();
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT) || 3000;

// PostgreSQL Setup
const isProduction = process.env.NODE_ENV === "production" || !!process.env.VERCEL;



const initDB = async () => {
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

let dbInitPromise: Promise<void> | null = null;
const ensureDB = async () => {
  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      await initDB().catch(e => console.warn('[DB] initDB non-fatal notice:', e.message));
      await initWinstonDB().catch(e => console.warn('[DB] initWinstonDB non-fatal notice:', e.message));

      // Diagnostic: verify Postgres is reachable (not falling back to ephemeral in-memory)
      try {
        const healthCheck = await queryDB('SELECT 1 as ok');
        const connStr = process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.POSTGRES_DATABASE_URL || process.env.POSTGRES_PRISMA_URL;
        if (connStr) {
          console.log('[DB] ✅ PostgreSQL connected — leads will persist across deploys');
        } else {
          console.warn('[DB] ⚠️  No POSTGRES_URL/DATABASE_URL set — using IN-MEMORY fallback. Leads will be LOST on cold start/redeploy!');
        }
      } catch (e: any) {
        console.error('[DB] ❌ PostgreSQL health check failed:', e.message, '— leads may be lost on redeploy');
      }
    })();
  }
  return dbInitPromise;
};



interface ScoreData {
  name: string;
  email: string;
  score: number;
  createdAt: string;
}

// Google OAuth is used instead of administrative passcodes.

// Cookie Parser Helper for HTTP-Only sessions
const parseCookies = (cookieHeader?: string): Record<string, string> => {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach((cookie) => {
    const parts = cookie.split("=");
    if (parts.length >= 2) {
      cookies[parts[0].trim()] = parts.slice(1).join("=").trim();
    }
  });
  return cookies;
};

const SESSION_SECRET = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || process.env.GOOGLE_CLIENT_SECRET || "yna-production-signing-secret-key-2026";

interface SessionPayload {
  email: string;
  exp: number;
}

const signSession = (email: string): string => {
  const payload: SessionPayload = {
    email,
    exp: Date.now() + 2 * 60 * 60 * 1000 // 2 hours expiration
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
};

const verifySession = (token?: string): SessionPayload | null => {
  if (!token || !token.includes(".")) return null;
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return null;
  
  const expectedSig = crypto.createHmac("sha256", SESSION_SECRET).update(payloadB64).digest("base64url");
  if (sig.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
  
  try {
    const payload: SessionPayload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
};

// Security Gate middleware for Admin Routes (HttpOnly Cookies check)
const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["admin_session"];
  const session = verifySession(token);
  
  if (!session) {
    return res.status(401).json({ error: "Unauthorized: Invalid or expired session" });
  }
  (req as any).adminUser = session;
  next();
};

app.set('trust proxy', 1);

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ limit: '15mb', extended: true }));
app.use(cookieParser());

// Middleware to ensure DB schema is initialized on serverless cold starts
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api')) {
    try {
      await ensureDB();
    } catch (e) {
      console.error("DB initialization error on request:", e);
    }
  }
  next();
});

// Security Headers
app.use(helmet({
  contentSecurityPolicy: false, // Disabled to prevent blocking external resources (Google Auth, Images)
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// Gzip/Brotli Compression (skip binary files that are already compressed)
app.use(compression({
  filter: (req, res) => {
    const url = req.url || '';
    if (url.endsWith('.glb') || url.endsWith('.gltf') || url.endsWith('.bin')) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

// Rate Limiting Protection (per-IP enforcement with trust-proxy and load test support)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.RATE_LIMIT_MAX ? parseInt(process.env.RATE_LIMIT_MAX, 10) : 1000, // Limit each IP to 1000 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests from this IP, please try again later.",
  validate: {
    keyGeneratorIpFallback: false,
    xForwardedForHeader: false
  },
  skip: (req) => {
    // Only rate-limit API calls; never rate-limit 3D assets (.glb), images, scripts, stylesheets, or Vite bundles
    return !req.path.startsWith('/api');
  },
  keyGenerator: (req) => {
    const forwarded = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim();
    if (forwarded) return forwarded;
    return req.ip || req.socket.remoteAddress || 'unknown';
  }
});
app.use(globalLimiter);

// Explicit Static Asset Serving for 3D Models & Public Assets
app.use(express.static(path.join(process.cwd(), "public")));
app.use(express.static(path.join(process.cwd(), "client", "public")));

// ── Direct Voice Endpoints (registered before voiceLeadRouter to avoid route shadowing) ──
// These time-critical voice routes must match first, before the /api/voice router intercepts.

// Peptide Knowledge Engine & Administration API (Single-Purpose Build)
app.use("/api/peptides", peptideRouter);

// Gemini 2.5 Native 1-to-1 Multimodal Live Voice Session Config
app.get("/api/voice/live-config", (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Gemini API key not configured on server." });
  }
  // Vercel Serverless Functions do not support long-lived bidirectional WebSockets.
  // When running on Vercel, direct client-to-Gemini Live WebSocket streaming is used.
  const isVercel = Boolean(process.env.VERCEL);
  return res.json({
    useGateway: !isVercel,
    apiKey: isVercel ? apiKey : undefined,
    model: process.env.GEMINI_LIVE_MODEL || "models/gemini-2.5-flash-native-audio-latest",
    voiceName: process.env.GEMINI_VOICE_NAME || "Charon",
    whatsappNumber: process.env.PEPTIDE_SALES_WHATSAPP_NUMBER || "15557378433",
    systemPrompt: peptideKnowledgeEngine.generateVoiceSystemPrompt()
  });
});


// 100% Silent Conversational Text Chat for Sales Desk (Gemini REST)
app.post("/api/voice/text-chat", async (req, res) => {
  try {
    const { message, profile = {}, history = [] } = req.body || {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ ok: false, error: "Message is required." });
    }

    const cleanMessage = message.trim();
    const apiKey = process.env.GEMINI_API_KEY;

    // Grounded fallback generator using peptideKnowledgeEngine
    const generateFallback = () => {
      const q = peptideKnowledgeEngine.query(cleanMessage);
      return q.answer;
    };

    if (!apiKey) {
      return res.json({ ok: true, reply: generateFallback() });
    }

    // Compile pre-existing customer memory
    const knownFacts: string[] = [];
    if (profile.name) knownFacts.push(`- Customer Name: ${profile.name}`);
    if (profile.targetVehicle) knownFacts.push(`- Target Vehicle Model: ${profile.targetVehicle}`);
    else if (profile.vehicleType) knownFacts.push(`- Target Vehicle Category: ${profile.vehicleType}`);
    if (profile.monthlyBudget) knownFacts.push(`- Comfortable Monthly Budget: $${profile.monthlyBudget}/month`);
    if (profile.creditSituation) knownFacts.push(`- Credit Situation: ${profile.creditSituation}`);
    if (profile.monthlyIncome) knownFacts.push(`- Monthly Take-Home Income: $${profile.monthlyIncome}/month`);
    if (profile.downPayment !== undefined) knownFacts.push(`- Down Payment: $${profile.downPayment}`);
    if (profile.employment) knownFacts.push(`- Employment Status: ${profile.employment}`);
    if (profile.phone) knownFacts.push(`- Phone: ${profile.phone}`);
    if (profile.email) knownFacts.push(`- Email: ${profile.email}`);

    const systemInstruction = peptideKnowledgeEngine.generateVoiceSystemPrompt();

    const contents: any[] = [];
    if (Array.isArray(history) && history.length > 0) {
      for (const turn of history.slice(-4)) {
        if (turn.text && turn.sender) {
          contents.push({
            role: turn.sender === 'user' ? 'user' : 'model',
            parts: [{ text: turn.text }]
          });
        }
      }
    }
    contents.push({
      role: 'user',
      parts: [{ text: cleanMessage }]
    });

    const candidateModels = [
      process.env.GEMINI_MODEL || 'gemini-3.8-flash',
      'gemini-3.8-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-2.5-flash',
      'gemini-flash-latest'
    ].filter((m, i, arr) => arr.indexOf(m) === i);

    let replyText = '';
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
        } catch (modelErr: any) {
          console.warn(`[Text Chat LLM Failover] Model ${model} failed:`, modelErr.message);
        }
      }
    }

    if (!replyText) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const directRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents,
            systemInstruction: { parts: [{ text: systemInstruction }] },
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 250
            }
          }),
          signal: AbortSignal.timeout(8000)
        });
        if (directRes.ok) {
          const data: any = await directRes.json();
          replyText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        }
      } catch (directErr: any) {
        console.warn('[Text Chat Direct Fetch Error]', directErr.message);
      }
    }

    if (!replyText) {
      replyText = generateFallback();
    }

    const cleanReply = replyText
      .replace(/^["']|["']$/g, '')
      .replace(/[*_#`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    return res.json({
      ok: true,
      reply: cleanReply
    });
  } catch (error: any) {
    console.error('[Text Chat Endpoint Error]', error);
    return res.status(500).json({
      ok: false,
      error: "Internal server error processing text chat.",
      reply: "I am an educational AI peptide information assistant. How can I help you with peptide clinical evidence, potential benefits, or research?"
    });
  }
});

// Cloud Acoustic STT (Whisper / Gemini) with 20s request timeout
app.post("/api/voice/transcribe", async (req, res) => {
  // 20-second hard timeout to prevent Vercel/Render from killing us silently
  const TRANSCRIBE_TIMEOUT_MS = 20_000;
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      console.warn('[STT Timeout] Transcription exceeded 20s limit');
      res.status(504).json({ error: "Transcription timed out", transcript: "" });
    }
  }, TRANSCRIBE_TIMEOUT_MS);

  try {
    const { audioBase64, mimeType = "audio/webm" } = req.body;
    if (!audioBase64) {
      clearTimeout(timer);
      return res.status(400).json({ error: "Missing audioBase64 payload." });
    }

    // Normalize MIME type to base format acceptable by Gemini (strip codec suffix e.g. ';codecs=opus')
    const baseMime = (mimeType || "audio/webm").split(";")[0].trim().toLowerCase();
    const normalizedMimeType = ["audio/webm", "audio/mp4", "audio/wav", "audio/ogg", "audio/x-m4a", "audio/mpeg"].includes(baseMime)
      ? baseMime
      : "audio/webm";

    // 1. High-Precision Open-Source Whisper (Groq / OpenAI Whisper-Large-V3)
    const groqKey = process.env.GROQ_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (groqKey || openaiKey) {
      try {
        const audioBuffer = Buffer.from(audioBase64, 'base64');
        const formData = new FormData();
        const blob = new Blob([audioBuffer], { type: normalizedMimeType });
        
        let fileExt = normalizedMimeType.split('/')[1] || 'webm';
        if (fileExt === 'x-m4a') fileExt = 'm4a';
        if (fileExt === 'mpeg') fileExt = 'mp3'; // Sometimes mpeg is sent for mp3

        formData.append('file', blob, `audio.${fileExt}`);
        formData.append('model', groqKey ? 'whisper-large-v3' : 'whisper-1');
        formData.append('temperature', '0.0');
        formData.append('prompt', 'Peptide consultation: BPC-157, Semaglutide, Tirzepatide, Sermorelin, Tesamorelin, Ipamorelin, CJC-1295, MK-677, clinical evidence, dosage, mechanism, adverse effects, research.');

        const endpoint = groqKey
          ? 'https://api.groq.com/openai/v1/audio/transcriptions'
          : 'https://api.openai.com/v1/audio/transcriptions';

        const whisperRes = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${groqKey || openaiKey}`
          },
          body: formData,
          signal: AbortSignal.timeout(15_000) // 15s fetch timeout for Whisper API
        });

        if (whisperRes.ok) {
          const data: any = await whisperRes.json();
          if (data && data.text) {
            clearTimeout(timer);
            return res.json({ transcript: data.text.trim(), engine: groqKey ? 'groq-whisper-v3' : 'openai-whisper' });
          }
        }
      } catch (whisperErr: any) {
        console.warn('[Whisper STT fallback to Gemini]', whisperErr.message);
      }
    }

    if (ai) {
      try {
        const modelName = (process.env.GEMINI_MODEL && process.env.GEMINI_MODEL !== 'gemini-3.6-flash')
          ? process.env.GEMINI_MODEL
          : "gemini-3.8-flash";
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
            temperature: 0.0,
            maxOutputTokens: 250
          }
        });

        const transcript = response.text ? response.text.trim() : "";
        const cleanTranscript = transcript.replace(/^["']|["']$/g, '').trim();
        if (cleanTranscript) {
          clearTimeout(timer);
          return res.json({ transcript: cleanTranscript, engine: 'gemini-acoustic-flash' });
        }
      } catch (geminiErr: any) {
        console.warn("[Gemini Acoustic STT Error]", geminiErr.message);
      }
    }

    // If no dedicated STT engine could process the audio, return empty transcript
    clearTimeout(timer);
    return res.json({ transcript: "" });
  } catch (err: any) {
    clearTimeout(timer);
    console.error('[STT Route Error]', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: "Transcription failed", transcript: "" });
    }
  }
});

// ── Winston Canonical Modular Routers (Eliminating Dual Routing) ──
app.use('/api/session', sessionRouter);
app.use('/api/chat', chatRouter);
app.use('/api/voice', voiceLeadRouter);

// ── Device Forensics Enrichment Endpoint ──
// Captures server-side network forensics (IP, geo, VPN signals) and merges with client-side device fingerprint
app.post('/api/forensics/collect', async (req, res) => {
  try {
    const clientForensics = req.body || {};
    
    // Extract true IP from edge network
    const forwarded = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim();
    const ip = forwarded || req.ip || req.socket?.remoteAddress || 'unknown';
    
    // Vercel Edge Geo Headers (free, automatic on Vercel deployments)
    const geoCity = req.headers['x-vercel-ip-city'] as string || null;
    const geoRegion = req.headers['x-vercel-ip-country-region'] as string || null;
    const geoCountry = req.headers['x-vercel-ip-country'] as string || null;
    const geoPostal = req.headers['x-vercel-ip-postal-code'] as string || null;
    const geoLatitude = req.headers['x-vercel-ip-latitude'] as string || null;
    const geoLongitude = req.headers['x-vercel-ip-longitude'] as string || null;
    
    // VPN / Proxy Detection Signals
    const hasViaHeader = !!req.headers['via'];
    const forwardedHops = (req.headers['x-forwarded-for'] as string)?.split(',').length || 0;
    const clientTimezone = clientForensics.timezone || null; // e.g. "America/Toronto"
    
    // Cross-reference client-reported timezone vs IP geolocation
    // Known Canadian timezone-to-province mapping for VPN detection
    const CA_TIMEZONE_MAP: Record<string, string[]> = {
      'America/Toronto': ['ON', 'QC'],
      'America/Montreal': ['QC'],
      'America/Winnipeg': ['MB'],
      'America/Regina': ['SK'],
      'America/Edmonton': ['AB'],
      'America/Vancouver': ['BC'],
      'America/Halifax': ['NS', 'NB', 'PE'],
      'America/St_Johns': ['NL'],
      'America/Yellowknife': ['NT'],
      'America/Whitehorse': ['YT'],
      'America/Iqaluit': ['NU'],
    };
    
    let vpnRisk: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
    const vpnSignals: string[] = [];
    
    if (hasViaHeader) {
      vpnSignals.push('VIA_HEADER_PRESENT');
      vpnRisk = 'MEDIUM';
    }
    if (forwardedHops > 2) {
      vpnSignals.push(`MULTI_HOP_PROXY_${forwardedHops}`);
      vpnRisk = 'HIGH';
    }
    
    // Timezone vs Geo mismatch check
    if (clientTimezone && geoRegion && geoCountry === 'CA') {
      const expectedProvinces = CA_TIMEZONE_MAP[clientTimezone];
      if (expectedProvinces && !expectedProvinces.includes(geoRegion)) {
        vpnSignals.push(`TZ_GEO_MISMATCH:${clientTimezone}_vs_${geoRegion}`);
        vpnRisk = 'HIGH';
      }
    }
    if (clientTimezone && geoCountry && geoCountry !== 'CA') {
      // Client says Canadian timezone but IP is from another country
      if (clientTimezone.startsWith('America/') && ['Toronto','Montreal','Winnipeg','Regina','Edmonton','Vancouver','Halifax','St_Johns'].some(c => clientTimezone.includes(c))) {
        vpnSignals.push(`COUNTRY_MISMATCH:client_CA_ip_${geoCountry}`);
        vpnRisk = 'HIGH';
      }
    }
    
    // Check for known datacenter/VPN IP ranges via ASN heuristic
    // Common datacenter IP prefixes (simplified check)
    const ipParts = ip.split('.');
    const firstOctet = parseInt(ipParts[0] || '0', 10);
    // Most residential IPs are NOT in these datacenter-heavy ranges
    if ([104, 172, 185, 193, 198, 23, 40, 52, 13, 34, 35, 54].includes(firstOctet)) {
      vpnSignals.push('DATACENTER_IP_RANGE');
      if (vpnRisk !== 'HIGH') vpnRisk = 'MEDIUM';
    }
    
    const serverForensics = {
      ip: ip,
      geo: {
        city: geoCity ? decodeURIComponent(geoCity) : null,
        region: geoRegion,
        country: geoCountry,
        postalCode: geoPostal,
        latitude: geoLatitude ? parseFloat(geoLatitude) : null,
        longitude: geoLongitude ? parseFloat(geoLongitude) : null,
      },
      network: {
        vpnRisk,
        vpnSignals,
        forwardedHops,
        hasViaHeader,
        userAgentServer: req.headers['user-agent'] || null,
      },
      serverTimestamp: new Date().toISOString(),
    };
    
    // Merge client + server forensics
    const merged = {
      ...clientForensics,
      server: serverForensics,
    };
    
    console.log('[FORENSICS_COLLECTED]', {
      deviceId: clientForensics.deviceId,
      ip,
      geo: `${geoCity || '?'}, ${geoRegion || '?'}, ${geoCountry || '?'}`,
      vpnRisk,
      vpnSignals: vpnSignals.join(', ') || 'none',
    });
    
    return res.status(200).json({ success: true, forensics: merged });
  } catch (err: any) {
    console.error('[FORENSICS_ERROR]', err);
    return res.status(200).json({ success: false });
  }
});

// Specific Rate Limiters for sensitive endpoints
const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000, // Max 1000 AI chat interactions per 15 minutes per IP for continuous voice sessions
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Chat rate limit reached. Please wait a few moments before trying again." }
});

const leadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25, // Max 25 lead submissions per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Submission rate limit reached. Please try again later." }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15, // Max 15 auth attempts per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." }
});

// Health Check Endpoint (to keep the Render instance awake)

app.get('/api/health/database', async (req, res) => {
  const start = Date.now();
  try {
    const result = await queryDB('SELECT 1 as ok');
    const latency = Date.now() - start;
    res.status(200).json({
      status: 'healthy',
      database: 'reachable',
      latency_ms: latency,
      query_result: result.rows[0].ok
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      database: 'unreachable',
      error_type: err.code || err.name,
      message: err.message
    });
  }
});

app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "OK", timestamp: new Date().toISOString() });
});

// Scoreboard APIs for Easter Egg Spin Challenge
app.get("/api/scores", async (req, res) => {
  try {
    const result = await queryDB("SELECT name, email, score, created_at as \"createdAt\" FROM scores ORDER BY score DESC LIMIT 3");
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
});

app.post("/api/scores", async (req, res) => {
  const { name, email, score } = req.body;
  if (!name || !email || typeof score !== 'number') {
    return res.status(400).json({ error: "Missing required fields: name, email, score" });
  }

  // Basic validation to prevent vulnerabilities and spam
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
      [name.trim().substring(0, 25), email.trim().toLowerCase(), Math.max(0, score), new Date().toISOString()]
    );
    const result = await queryDB("SELECT name, email, score, created_at as \"createdAt\" FROM scores ORDER BY score DESC LIMIT 3");
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// 🎯 CORE MODEL: Weighted Risk Scoring Engine
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
  const reasons: string[] = [];

  // Employment
  if (employmentStatus === "full-time") { score += 25; reasons.push("Stable full-time employment"); }
  else if (employmentStatus === "part-time") { score += 18; reasons.push("Part-time income verified"); }
  else if (employmentStatus === "self-employed") { score += 15; reasons.push("Entrepreneurial revenue path"); }
  else { score += 5; reasons.push("Status verification required"); }

  // Credit
  const isApprovedCredit = creditScoreRange === "excellent" || creditScoreRange === "good";
  if (creditScoreRange === "excellent") { score += 25; reasons.push("Excellent credit profile"); }
  else if (creditScoreRange === "good") { score += 20; reasons.push("Good credit profile"); }
  else if (creditScoreRange === "fair") { score += 14; reasons.push("Fair credit profile"); }
  else { score += 8; reasons.push("Challenged credit pathway"); }

  // DTI
  if (DTI < 0.2) { score += 20; reasons.push("Low debt-to-income load"); }
  else if (DTI < 0.35) score += 16;
  else if (DTI < 0.5) score += 10;
  else { score += 5; reasons.push("Higher DTI ratio threshold"); }

  // Income strength
  if (incomeMonthly > 6000) { score += 15; reasons.push("Tier 1 income strength"); }
  else if (incomeMonthly > 4500) score += 12;
  else if (incomeMonthly > 3000) score += 9;
  else score += 6;

  // Down payment
  if (downPayment >= 5000) score += 10;
  else if (downPayment >= 2500) score += 7;
  else if (downPayment >= 1000) score += 5;

  score = Math.min(score, 100);

  // Risk tier
  let riskTier = "moderate";
  if (score >= 80) riskTier = "low";
  else if (score >= 60) riskTier = "moderate";
  else if (score >= 40) riskTier = "high";
  else riskTier = "very_high";

  // Underwriting Limits: TDSR and PTI (Payment to Income)
  const tdsrLimit = isApprovedCredit ? 0.48 : 0.40;
  const ptiLimit = isApprovedCredit ? 0.205 : 0.18; // 18% standard, up to 20.5% exception for approved credit

  // Calculate maximum compliant auto monthly payment:
  // 1. TDSR Constraint: (monthlyDebt + autoPayment) / incomeMonthly <= tdsrLimit
  const maxPaymentTDSR = (tdsrLimit * incomeMonthly) - monthlyDebt;
  // 2. PTI Constraint: autoPayment / incomeMonthly <= ptiLimit
  const maxPaymentPTI = ptiLimit * incomeMonthly;

  // Maximum allowed payment is the more restrictive of the two
  let maxPayment = Math.min(maxPaymentTDSR, maxPaymentPTI);
  
  // Floor of $150 to guarantee a basic loan offer calculation
  if (maxPayment < 150) {
    maxPayment = 150;
  }

  // Convert maximum payment to maximum loan amount using loan amortization factor
  const loanFactor = 0.0203;
  let maxLoan = maxPayment / loanFactor;

  // Adjust max loan size based on risk tier
  if (riskTier === "low") maxLoan *= 1.1;
  if (riskTier === "high") maxLoan *= 0.75;
  if (riskTier === "very_high") maxLoan *= 0.55;

  // Estimate final monthly payment based on risk-adjusted loan size
  let monthlyEstimate = maxLoan * loanFactor;

  // Hard-cap the final estimate to make sure it doesn't violate limits (especially after the 1.1x low-risk multiplier)
  if (monthlyEstimate > maxPayment) {
    monthlyEstimate = maxPayment;
    maxLoan = monthlyEstimate / loanFactor;
  }

  // Calculate the final TDSR and PTI based on the approved terms
  const finalPTI = monthlyEstimate / (incomeMonthly || 1);
  const finalTDSR = (monthlyDebt + monthlyEstimate) / (incomeMonthly || 1);

  // Dynamic reason codes reflecting underwriting metrics
  reasons.push(`TDSR: ${(finalTDSR * 100).toFixed(1)}% (Limit: ${tdsrLimit * 100}%)`);
  reasons.push(`PTI: ${(finalPTI * 100).toFixed(1)}% (Limit: ${(ptiLimit * 100).toFixed(1)}%)`);

  // Revenue Machine Logic: Strategic Status Mapping
  let status: "APPROVED" | "CONDITIONAL" | "REVIEW" = "REVIEW";
  let priority: "LOW" | "NORMAL" | "HIGH" | "URGENT" = "LOW";
  let routing = "general_queue";
  let offer = "standard_terms";

  // Downgrade status if limits are exceeded (precautionary underwriting)
  const isExceeded = finalTDSR > tdsrLimit || finalPTI > ptiLimit;

  if (score >= 70 && !isExceeded) {
    status = "APPROVED";
    priority = "HIGH";
    routing = "senior_closers";
    offer = "preferred_rate_0.9";
  } else if (score >= 45 && !isExceeded) {
    status = "CONDITIONAL"; // The Money Tier
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
    tdsr: Math.round(finalTDSR * 1000) / 10,
    pti: Math.round(finalPTI * 1000) / 10,
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

  const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const gameLink = `${appUrl}/?scene=GAME_GARAGE`;

  const htmlTemplate = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
      <h2 style="color: #00f3ff; background: #111; padding: 20px; text-align: center; text-transform: uppercase;">Your New Auto</h2>
      <div style="padding: 20px; border: 1px solid #eee;">
        <p>Hi ${name || 'there'},</p>
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

const verifyMailgunWebhook = (timestamp: string, token: string, signature: string): boolean => {
  const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
  if (!signingKey) return false;
  
  const encodedToken = crypto
    .createHmac("sha256", signingKey)
    .update(timestamp.concat(token))
    .digest("hex");
    
  // Use timingSafeEqual to prevent timing attacks
  if (encodedToken.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(encodedToken), Buffer.from(signature));
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
  
  // Handle specific events (e.g., bounced, dropped, complained)
  if (eventData.event === "bounced" || eventData.event === "dropped") {
    console.warn(`Email delivery failed to ${eventData.recipient}. Reason: ${eventData.reason || eventData.description}`);
  }
  
  res.status(200).send("OK");
});

// ── Server-Side Idempotency Cache for Voice Turns (Directive 8) ────────────
interface IdempotencyRecord {
  timestamp: number;
  response: any;
}

// NOTE: /api/voice/live-config and /api/voice/transcribe are now registered ABOVE
// the voiceLeadRouter mount (line ~256) to avoid route shadowing.

// ── Studio-Grade Neural British Butler TTS Endpoint (100% Free) with Instant Audio Cache ──
const ttsAudioCache = new Map<string, { buffer: Buffer; contentType: string }>();

app.post("/api/tts/speech", async (req, res) => {
  // 25-second hard timeout — prevents Vercel/Render from killing the function silently
  const TTS_TIMEOUT_MS = 25_000;
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      console.warn('[TTS Timeout] Speech synthesis exceeded 25s limit');
      res.status(504).json({ error: { message: "TTS generation timed out" } });
    }
  }, TTS_TIMEOUT_MS);

  try {
    const { input } = req.body;
    if (!input || !input.trim()) {
      clearTimeout(timer);
      return res.status(400).json({ error: { message: "Missing required field: 'input'" } });
    }

    const cleanInput = input
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/\[.*?\]/g, '')
      .replace(/`/g, '')
      .replace(/→/g, '')
      .replace(/✓/g, '')
      .replace(/•/g, '')
      .replace(/\$(\d+)/g, '$1 dollars')
      .replace(/\bSUV\b/gi, 'S.U.V.')
      .replace(/\bYNA\b/gi, 'Your New Auto')
      .replace(/\bSIN\b/gi, 'Social Insurance Number')
      .replace(/\s+/g, ' ')
      .trim();

    // Check in-memory audio cache for zero-latency instant playback
    if (ttsAudioCache.has(cleanInput)) {
      clearTimeout(timer);
      const cached = ttsAudioCache.get(cleanInput)!;
      res.setHeader("Content-Type", cached.contentType);
      res.setHeader("Content-Length", cached.buffer.length);
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.send(cached.buffer);
    }

    // 1. If explicit custom Chatterbox server configured, try forwarding
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
            temperature: 0.55,
          }),
        });

        if (ttsResponse.ok) {
          clearTimeout(timer);
          res.setHeader("Content-Type", "audio/wav");
          const arrayBuffer = await ttsResponse.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          ttsAudioCache.set(cleanInput, { buffer, contentType: "audio/wav" });
          return res.send(buffer);
        }
      } catch (e: any) {
        console.warn("[Custom Chatterbox fallback to Neural]", e.message);
      }
    }

    // 2. High-Quality Open-Source Neural JARVIS Voice Engine (100% Free, Studio Quality)
    const tts = new MsEdgeTTS();
    const jarvisVoice = process.env.JARVIS_VOICE || "en-GB-RyanNeural";
    const jarvisRate = process.env.JARVIS_VOICE_RATE || "+4%";
    const jarvisPitch = process.env.JARVIS_VOICE_PITCH || "-2Hz";
    await tts.setMetadata(jarvisVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(cleanInput, { rate: jarvisRate, pitch: jarvisPitch });

    const chunks: Buffer[] = [];
    audioStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    audioStream.on('end', () => {
      clearTimeout(timer);
      const audioBuffer = Buffer.concat(chunks);
      ttsAudioCache.set(cleanInput, { buffer: audioBuffer, contentType: "audio/mpeg" });
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Length", audioBuffer.length);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(audioBuffer);
    });
    audioStream.on('error', (streamErr) => {
      clearTimeout(timer);
      console.error("[TTS Stream Error]", streamErr);
      if (!res.headersSent) res.status(500).json({ error: { message: "TTS Stream Error" } });
    });
  } catch (err: any) {
    clearTimeout(timer);
    console.error("[Neural TTS Error]", err);
    return res.status(500).json({ error: { message: "TTS generation failed" } });
  }
});

app.post("/api/lead", leadLimiter, async (req, res) => {
  const lead = req.body;
  
  // Prevent saving anonymous partial leads that have no contact info
  const hasContactInfo = (lead.name && lead.name.trim() !== '') || 
                         (lead.email && lead.email.trim() !== '') || 
                         (lead.phone && lead.phone.trim() !== '');

  if (!hasContactInfo) {
    return res.status(200).json({ success: true, message: "Partial lead ignored (no contact info)" });
  }

  console.log("💰 LEAD CAPTURED (Revenue Machine):", lead);
  
  try {
    // Check if lead has been deleted (prevent resurrection)
    if (lead.id) {
      const delCheck = await queryDB("SELECT 1 FROM deleted_leads WHERE id = $1", [lead.id]);
      if (delCheck.rows && delCheck.rows.length > 0) {
        console.log("[LEAD_IGNORED_DELETED]", lead.id);
        return res.status(200).json({ success: true, ignored: true, reason: 'deleted' });
      }
    }

    const existingResult = lead.id ? await queryDB("SELECT * FROM leads WHERE id = $1", [lead.id]) : { rows: [] };
    const isExisting = existingResult.rows.length > 0;

    const l = lead;
    const id = l.id || `lead_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const status = l.status || (isExisting ? existingResult.rows[0].status : 'NEW');
    const createdAt = isExisting ? existingResult.rows[0].createdAt : new Date().toISOString();

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
      id, l.name || '', l.first_name || l.firstName || '', l.last_name || l.lastName || '',
      l.email || '', l.phone || '', l.location || '', l.employment || '', l.income || '',
      l.creditScore || '', l.monthlyDebt || '', l.downPayment || '', l.housingStatus || '',
      l.vehicle || '', l.selectedModel || '', l.selectedModelYear || null,
      l.approvalScore || null, l.riskTier || '', l.maxLoan || null, l.monthlyEstimate || null,
      l.tdsr || null, l.pti || null, status, createdAt,
      l.marketingConsent || false, l.privacyConsent || false,
      l.source || 'MAIN',
      l.intent_score ?? l.intentScore ?? 0,
      l.intent_stage || l.intentStage || 'CURIOUS',
      l.contactability_score ?? l.contactabilityScore ?? 0,
      l.qualification_score ?? l.qualificationScore ?? 0,
      l.lead_completeness ?? l.completenessScore ?? 0,
      l.lead_quality_score ?? l.leadQualityScore ?? 0,
      l.buying_commitment || l.buyingCommitment || 'NONE',
      l.next_best_action || l.nextBestAction || 'EDUCATE',
      l.vehicle_type || l.vehicleType || '',
      l.payment_target || l.paymentTarget || '',
      l.budget ? String(l.budget) : (l.monthlyBudget ? String(l.monthlyBudget) : ''),
      l.purchase_timeline || l.purchaseTimeline || '',
      l.urgency || '',
      l.financing_needed !== undefined ? Boolean(l.financing_needed) : true,
      l.credit_situation || l.creditSituation || '',
      l.monthly_income ? String(l.monthly_income) : (l.income || ''),
      Boolean(l.has_trade || l.hasTrade),
      l.trade_vehicle || l.tradeVehicle || '',
      l.pain_points || l.painPoints || '',
      l.objections || '',
      l.active_objection || l.activeObjection || '',
      l.customer_summary || l.customerSummary || '',
      l.sales_brief || l.salesBrief || '',
      l.recommended_next_action || l.recommendedNextAction || 'CALL_ASAP',
      l.outcome_status || l.outcomeStatus || 'NEW',
      l.signals_json || (l.signals ? JSON.stringify(l.signals) : null),
      l.forensics_json || null
    ];
    
    await queryDB(insertQuery, values);

    if (isExisting) {
      return res.status(200).json({
        success: true,
        leadId: id,
        updatedAt: new Date().toISOString(),
        automationTriggered: ["SMS_SALES", "EMAIL_USER"]
      });
    }

    // New Lead logic (admin email notification with executive sales brief)
    const newLead = { ...l, id, status, createdAt };
    try {
      const domain = process.env.MAILGUN_DOMAIN;
      if (domain) {
        const adminEmail = process.env.ADMIN_EMAIL || "stephan.sabeski12@gmail.com";
        const approvalString = newLead.maxLoan ? `$${newLead.maxLoan.toLocaleString()} Approved` : "Sales Desk Buyer";
        const isHighIntent = (newLead.intent_score ?? newLead.intentScore ?? 0) >= 70;
        
        const adminHtml = `
          <div style="font-family: sans-serif; padding: 20px; max-width: 600px; border: 1px solid #1a1a2e; border-radius: 8px;">
            <h2 style="color: ${isHighIntent ? '#f59e0b' : '#00f3ff'}; margin-bottom: 8px;">
              ${isHighIntent ? '🔥 HIGH-INTENT BUYER ALERT' : '⚡ New Lead Alert'}: ${newLead.name || newLead.first_name || 'Prospect'}
            </h2>
            <div style="background: #f8fafc; padding: 12px; border-radius: 6px; margin-bottom: 16px;">
              <p style="margin: 4px 0;"><strong>Quality Score:</strong> ${newLead.lead_quality_score ?? newLead.leadQualityScore ?? 'N/A'}/100 | <strong>Intent:</strong> ${newLead.intent_score ?? newLead.intentScore ?? 0}/100 (${newLead.intent_stage || 'CURIOUS'})</p>
              <p style="margin: 4px 0;"><strong>Recommended Action:</strong> <span style="color: #dc2626; font-weight: bold;">${newLead.recommended_next_action || newLead.recommendedNextAction || 'CALL ASAP'}</span></p>
            </div>
            <p style="margin: 4px 0;"><strong>Phone:</strong> ${newLead.phone || 'Not Provided'}</p>
            <p style="margin: 4px 0;"><strong>Email:</strong> ${newLead.email || 'Not Provided'}</p>
            <p style="margin: 4px 0;"><strong>Target Vehicle & Budget:</strong> ${newLead.vehicle_type || newLead.vehicle || 'Vehicle'} (${newLead.payment_target ? '$' + newLead.payment_target + '/mo' : (newLead.income ? '$' + newLead.income + '/mo income' : 'Flexible')})</p>
            <p style="margin: 4px 0;"><strong>Timeline:</strong> ${newLead.purchase_timeline || 'Within 2 weeks'}</p>
            <p style="margin: 4px 0;"><strong>Trade-In:</strong> ${newLead.trade_vehicle || (newLead.has_trade ? 'Yes' : 'None Stated')}</p>
            ${newLead.sales_brief ? `<div style="margin-top: 16px; padding: 12px; background: #ecfdf5; border-left: 4px solid #10b981;"><p style="margin: 0; font-size: 13px; white-space: pre-wrap;"><strong>Sales Brief for Stephan:</strong><br />${newLead.sales_brief}</p></div>` : ''}
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #e2e8f0;" />
            <p><a href="https://www.yournewauto.ca" style="color: #2563eb; font-weight: bold;">Login to Admin CRM</a> to view full sales intelligence and initiate call.</p>
          </div>
        `;

        mg.messages.create(domain, {
          from: `YNA Sales Desk <hello@${domain}>`,
          to: [adminEmail],
          subject: `${isHighIntent ? '🔥 HIGH INTENT' : '⚡ Lead'}: ${newLead.name || 'Prospect'} - ${newLead.vehicle_type || 'Vehicle'} ($${newLead.payment_target || newLead.income || '0'}/mo)`,
          html: adminHtml
        }).catch(err => console.error("Failed to send admin notification:", err));
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

const getHostUrl = (req: express.Request): string => {
  const forwardedProto = req.headers['x-forwarded-proto'] as string;
  const forwardedHost = req.headers['x-forwarded-host'] as string;
  if (forwardedHost) {
    const proto = forwardedProto ? forwardedProto.split(',')[0].trim() : 'https';
    return `${proto}://${forwardedHost}`;
  }
  return process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
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
    // 1. Exchange authorization code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: code as string,
        client_id: clientID,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    
    if (!tokenResponse.ok) {
      const errBody = await tokenResponse.text();
      console.error("Google token exchange failed:", errBody);
      return res.redirect("/admin?error=token_exchange_failed");
    }
    
    const tokenData = await tokenResponse.json() as { access_token: string; id_token: string };
    
    // 2. Fetch user profile (specifically email)
    const userinfoResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    
    if (!userinfoResponse.ok) {
      console.error("Google userinfo fetch failed");
      return res.redirect("/admin?error=userinfo_failed");
    }
    
    const userData = await userinfoResponse.json() as { email: string; name?: string };
    const email = userData.email?.toLowerCase();
    
    if (!email) {
      console.error("No email returned from Google profile");
      return res.redirect("/admin?error=no_email");
    }
    
    // 3. Verify against allowed admin emails
    const allowedEmailsStr = process.env.ALLOWED_ADMIN_EMAILS || "";
    const allowedEmails = allowedEmailsStr
      .split(",")
      .map(e => e.trim().toLowerCase())
      .filter(Boolean);
      
    if (allowedEmails.length === 0) {
      console.warn("WARNING: ALLOWED_ADMIN_EMAILS is empty. Blocking all logins.");
    }
    
    if (!allowedEmails.includes(email)) {
      console.warn(`Unauthorized login attempt by: ${email}`);
      return res.redirect(`/admin?error=unauthorized_email&email=${encodeURIComponent(email)}`);
    }
    
    // 4. Authenticate session using stateless HMAC token
    const sessionToken = signSession(email);
    
    // Set HTTP-Only Secure Cookie
    res.setHeader(
      "Set-Cookie",
      `admin_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=7200${
        process.env.NODE_ENV === "production" ? "; Secure" : ""
      }`
    );
    
    console.log(`Successfully authenticated admin: ${email}`);
    return res.redirect("/admin");
  } catch (err) {
    console.error("Error during Google OAuth process:", err);
    return res.redirect("/admin?error=server_error");
  }
});

app.post("/api/admin/logout", (req, res) => {
  // Clear the cookie in response
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
    let rows: any[] = [];
    try {
      const result = await queryDB('SELECT * FROM leads ORDER BY created_at DESC NULLS LAST, "createdAt" DESC NULLS LAST');
      rows = result.rows || [];
    } catch (queryErr: any) {
      console.warn("[DB] Primary leads query failed, attempting simple SELECT *:", queryErr.message);
      const fallback = await queryDB('SELECT * FROM leads');
      rows = fallback.rows || [];
    }

    // Normalize all rows so createdAt, created_at, and source exist on every object
    const normalized = rows.map((r: any) => {
      const ts = r.createdAt || r.created_at || r.timestamp || new Date().toISOString();
      return {
        ...r,
        createdAt: ts,
        created_at: ts,
        source: r.source || (r.intent_score !== undefined ? 'AI_SALES_DESK' : 'MAIN'),
        status: r.status || 'NEW',
      };
    });

    // Sort newest first
    normalized.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

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
    const ALLOWED_LEAD_UPDATE_FIELDS = new Set([
      "name", "first_name", "last_name", "email", "phone", "location", "employment", "income",
      "creditScore", "monthlyDebt", "downPayment", "housingStatus", "vehicle", "selectedModel",
      "selectedModelYear", "approvalScore", "riskTier", "maxLoan", "monthlyEstimate",
      "tdsr", "pti", "status", "marketingConsent", "privacyConsent", "source",
      "intent_score", "intent_stage", "contactability_score", "qualification_score",
      "lead_completeness", "lead_quality_score", "buying_commitment", "next_best_action",
      "vehicle_type", "payment_target", "budget", "purchase_timeline", "urgency",
      "financing_needed", "financing_context", "credit_situation", "monthly_income",
      "has_trade", "trade_vehicle", "pain_points", "goals", "preferences", "objections",
      "active_objection", "customer_summary", "sales_brief", "recommended_next_action",
      "outcome_status", "notes"
    ]);

    const setClause: string[] = [];
    const values: any[] = [id];
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
    
    const query = `UPDATE leads SET ${setClause.join(', ')} WHERE id = $1 RETURNING *`;
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

// Sanitized Global Error Handler (Phase 8 & 13)
// Prevents secret leakage, stack traces, and internal database connection details in HTTP responses
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const sanitized = RedactionService.redact(err);
  console.error('[UNHANDLED_ERROR]', sanitized.message);
  if (res.headersSent) {
    return next(err);
  }
  return res.status(err.status || 500).json({
    error: 'INTERNAL_ERROR',
    message: 'An unexpected internal error occurred. Please contact support.',
    code: 'SEC_ERR_500'
  });
});

async function startServer() {
  await ensureDB();
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    
    // Serve static files with express-static-gzip to leverage pre-computed .br and .gz files
    app.use("/", expressStaticGzip(distPath, {
      enableBrotli: true,
      customCompressions: [{
        encodingName: "deflate",
        fileExtension: "zz"
      }],
      orderPreference: ['br', 'gz'],
      serveStatic: {
        maxAge: '1y', // Cache assets for 1 year (Vite hashes file names so this is safe)
        setHeaders: (res, filePath) => {
          // Do not cache index.html so updates are visible immediately
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        }
      }
    }));
    
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const httpServer = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
  setupVoiceGateway(httpServer);
}

// Only start standalone HTTP listener if not running in Vercel Serverless or Test environment
if (!process.env.VERCEL && process.env.NODE_ENV !== 'test' && !process.env.TEST_RUNNER) {
  startServer();
}

export default app;
