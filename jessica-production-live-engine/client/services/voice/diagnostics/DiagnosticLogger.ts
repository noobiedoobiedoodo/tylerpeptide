/**
 * DiagnosticLogger.ts
 * 
 * Centralized, production-grade telemetry and diagnostics store for JARVIS Sales Desk.
 * Maintains bounded in-memory trace buffers, live subsystem health states,
 * and sanitized diagnostic export for zero-DevTools troubleshooting.
 */

import {
  DiagnosticCategory,
  DiagnosticEvent,
  DiagnosticLevel,
  INITIAL_SYSTEM_HEALTH,
  SystemHealthState
} from './DiagnosticTypes';
import { JARVIS_BUILD_INFO } from '../../../version';

export class DiagnosticStore {
  private static instance: DiagnosticStore | null = null;
  private static bannerLogged: boolean = false;

  private events: DiagnosticEvent[] = [];
  private readonly MAX_EVENTS = 250;

  private health: SystemHealthState = { ...INITIAL_SYSTEM_HEALTH };
  private activeError: string | null = null;
  private isHUDOpen: boolean = false;

  private listeners = new Set<() => void>();

  private constructor() {
    if (!DiagnosticStore.bannerLogged) {
      DiagnosticStore.bannerLogged = true;
      console.log(`[JARVIS] Build: ${JARVIS_BUILD_INFO.commitSha} (${JARVIS_BUILD_INFO.buildTime}) [${JARVIS_BUILD_INFO.environment}]`);
      console.log(`[JARVIS] GeminiLiveClient version: ${JARVIS_BUILD_INFO.geminiClientVersion}`);
      console.log(`[JARVIS] AudioEngine version: ${JARVIS_BUILD_INFO.audioEngineVersion}`);
    }
  }

  public static getInstance(): DiagnosticStore {
    if (!DiagnosticStore.instance) {
      DiagnosticStore.instance = new DiagnosticStore();
    }
    return DiagnosticStore.instance;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (e) {
        console.error('[DiagnosticStore] Error in listener:', e);
      }
    }
  }

  /**
   * Records a structured telemetry event.
   * Guarantees all required fields: timestamp, conversationId, sessionGeneration, socketId, event, details.
   */
  public log(entry: {
    event: string;
    level: DiagnosticLevel;
    category: DiagnosticCategory;
    conversationId?: string;
    sessionGeneration?: number;
    socketId?: string;
    details?: any;
  }): DiagnosticEvent {
    const event: DiagnosticEvent = {
      id: `diag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      level: entry.level,
      category: entry.category,
      event: entry.event,
      conversationId: entry.conversationId ?? this.health.conversationId ?? '',
      sessionGeneration: entry.sessionGeneration ?? this.health.sessionGeneration ?? 0,
      socketId: entry.socketId ?? '',
      details: entry.details ?? {}
    };

    this.events.push(event);
    if (this.events.length > this.MAX_EVENTS) {
      this.events.shift();
    }

    if (entry.level === 'ERROR') {
      this.activeError = entry.details?.message || entry.event || 'A critical system error occurred.';
    }

    // Console mirror with structured prefix
    const prefix = `[JARVIS:${entry.category}]`;
    if (entry.level === 'ERROR') {
      console.error(prefix, entry.event, entry.details || '');
    } else if (entry.level === 'WARN') {
      console.warn(prefix, entry.event, entry.details || '');
    } else if (entry.level === 'INFO') {
      console.log(prefix, entry.event, entry.details || '');
    } else {
      console.debug(prefix, entry.event, entry.details || '');
    }

    this.notify();
    return event;
  }

  public updateHealth(partial: Partial<SystemHealthState>): void {
    this.health = {
      ...this.health,
      ...partial
    };
    this.notify();
  }

  public setActiveError(error: string | null): void {
    this.activeError = error;
    this.notify();
  }

  public clearActiveError(): void {
    this.activeError = null;
    this.notify();
  }

  public setHUDOpen(open: boolean): void {
    this.isHUDOpen = open;
    this.notify();
  }

  public clearEvents(): void {
    this.events = [];
    this.notify();
  }

  public getEvents(): readonly DiagnosticEvent[] {
    return this.events;
  }

  public getHealth(): Readonly<SystemHealthState> {
    return this.health;
  }

  public getActiveError(): string | null {
    return this.activeError;
  }

  public isOpened(): boolean {
    return this.isHUDOpen;
  }

  /**
   * Sanitizes any object or value to prevent leaking API keys, cookies, auth headers,
   * SIN, credit card info, or sensitive credentials.
   */
  private sanitizeValue(val: any, depth = 0): any {
    if (depth > 5 || val === null || val === undefined) return val;
    if (typeof val === 'string') {
      // Redact potential API keys (e.g. AIza..., sk-...)
      if (/AIza[0-9A-Za-z-_]{35}/.test(val)) {
        return '[REDACTED_API_KEY]';
      }
      if (/sk-[0-9A-Za-z-_]{20,}/.test(val)) {
        return '[REDACTED_SECRET_KEY]';
      }
      // Redact potential SINs (9 digits)
      if (/\b\d{3}[-\s]?\d{3}[-\s]?\d{3}\b/.test(val)) {
        return '[REDACTED_SIN]';
      }
      return val;
    }
    if (Array.isArray(val)) {
      return val.map(item => this.sanitizeValue(item, depth + 1));
    }
    if (typeof val === 'object') {
      const sanitized: Record<string, any> = {};
      for (const [k, v] of Object.entries(val)) {
        const lowerKey = k.toLowerCase();
        if (
          lowerKey.includes('key') ||
          lowerKey.includes('secret') ||
          lowerKey.includes('token') ||
          lowerKey.includes('auth') ||
          lowerKey.includes('cookie') ||
          lowerKey.includes('sin') ||
          lowerKey.includes('password') ||
          lowerKey.includes('credential')
        ) {
          sanitized[k] = '[REDACTED]';
        } else {
          sanitized[k] = this.sanitizeValue(v, depth + 1);
        }
      }
      return sanitized;
    }
    return val;
  }

  /**
   * Exports fully sanitized diagnostics JSON for instant sharing and debugging.
   */
  public exportSanitizedDiagnostics(): string {
    const payload = {
      buildInfo: JARVIS_BUILD_INFO,
      exportedAt: new Date().toISOString(),
      timestamp: Date.now(),
      health: this.health,
      activeError: this.activeError,
      recentEvents: this.events.map(e => ({
        ...e,
        details: this.sanitizeValue(e.details)
      }))
    };

    return JSON.stringify(payload, null, 2);
  }

  /**
   * Copies sanitized diagnostics to clipboard.
   */
  public async copyDiagnostics(): Promise<boolean> {
    try {
      const text = this.exportSanitizedDiagnostics();
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      return false;
    } catch (e) {
      console.warn('[DiagnosticStore] Clipboard copy failed:', e);
      return false;
    }
  }
}

export const diagnosticStore = DiagnosticStore.getInstance();
