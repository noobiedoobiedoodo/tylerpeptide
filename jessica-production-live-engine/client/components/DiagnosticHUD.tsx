import React, { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  Filter,
  Radio,
  RefreshCw,
  Terminal,
  Trash2,
  Volume2,
  X
} from 'lucide-react';
import { diagnosticStore } from '../../services/voice/diagnostics/DiagnosticLogger';
import { DiagnosticCategory, DiagnosticEvent, SystemHealthState } from '../../services/voice/diagnostics/DiagnosticTypes';
import { JARVIS_BUILD_INFO } from '../../version';

export const DiagnosticHUD: React.FC = () => {
  // Explicit component signature for build telemetry
  const _componentId = 'DiagnosticHUD';
  const [events, setEvents] = useState<readonly DiagnosticEvent[]>([]);
  const [health, setHealth] = useState<SystemHealthState>(diagnosticStore.getHealth());
  const [activeError, setActiveError] = useState<string | null>(diagnosticStore.getActiveError());
  const [isOpen, setIsOpen] = useState<boolean>(diagnosticStore.isOpened());
  const [copied, setCopied] = useState<boolean>(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = diagnosticStore.subscribe(() => {
      setEvents([...diagnosticStore.getEvents()]);
      setHealth({ ...diagnosticStore.getHealth() });
      setActiveError(diagnosticStore.getActiveError());
      setIsOpen(diagnosticStore.isOpened());
    });
    return unsubscribe;
  }, []);

  const filteredEvents = useMemo(() => {
    return events.filter(e => {
      if (selectedCategory === 'ERRORS' && e.level !== 'ERROR' && e.level !== 'WARN') {
        return false;
      }
      if (selectedCategory === 'AUDIO' && !e.category.includes('AUDIO') && e.category !== 'TTS' && e.category !== 'STT') {
        return false;
      }
      if (selectedCategory !== 'ALL' && selectedCategory !== 'ERRORS' && selectedCategory !== 'AUDIO' && e.category !== selectedCategory) {
        return false;
      }
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const text = `${e.event} ${e.category} ${JSON.stringify(e.details || '')}`.toLowerCase();
        return text.includes(query);
      }
      return true;
    });
  }, [events, selectedCategory, searchQuery]);

  const handleCopy = async () => {
    const success = await diagnosticStore.copyDiagnostics();
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.toTimeString().split(' ')[0]}.${d.getMilliseconds().toString().padStart(3, '0')}`;
  };

  const getHealthColor = (status: string) => {
    switch (status) {
      case 'CONNECTED':
      case 'READY':
      case 'RUNNING':
      case 'ACTIVE':
      case 'PRESENT':
      case 'SYNCED':
        return 'text-emerald-400 bg-emerald-950/60 border-emerald-500/40';
      case 'CONNECTING':
      case 'PENDING':
      case 'SUSPENDED':
      case 'IDLE':
        return 'text-amber-400 bg-amber-950/60 border-amber-500/40';
      case 'ERROR':
      case 'DENIED':
      case 'MISSING':
      case 'CLOSED':
      case 'FAILED':
      case 'UNAVAILABLE':
        return 'text-red-400 bg-red-950/60 border-red-500/40';
      default:
        return 'text-stone-400 bg-stone-900 border-stone-700';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-md flex flex-col justify-end sm:justify-center p-2 sm:p-4 md:p-6 select-text font-mono">
      <motion.div
        data-component="DiagnosticHUD"
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="w-full max-w-5xl mx-auto bg-[#0a0505] border border-red-500/40 rounded-2xl shadow-[0_0_50px_rgba(214,51,36,0.35)] flex flex-col max-h-[92vh] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-red-500/30 bg-red-950/30 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_#ef4444]" />
            <span className="text-xs sm:text-sm font-bold tracking-widest text-white uppercase flex items-center gap-1.5">
              <Terminal className="w-4 h-4 text-amber-400" />
              SYSTEM DIAGNOSTICS & TELEMETRY
            </span>
            <span className="text-[10px] text-amber-400/80 px-2 py-0.5 rounded bg-amber-950/50 border border-amber-500/30">
              GEN #{health.sessionGeneration}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Copy sanitized diagnostics JSON to clipboard"
            >
              {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-stone-300" />}
              <span>{copied ? 'Copied!' : 'Copy Diagnostics'}</span>
            </button>
            <button
              onClick={() => diagnosticStore.clearEvents()}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-stone-400 hover:text-white transition-colors cursor-pointer"
              title="Clear event logs"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => diagnosticStore.setHUDOpen(false)}
              className="p-1.5 rounded-lg bg-red-950/50 hover:bg-red-900/80 text-red-200 hover:text-white transition-colors cursor-pointer"
              title="Close diagnostics"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Permanent Build & Version Metadata */}
        <div className="flex flex-wrap items-center justify-between px-4 py-2 bg-[#040101] border-b border-red-500/20 text-[10px] font-mono text-stone-300 shrink-0 gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-amber-400 font-bold uppercase tracking-wider">JESSICA BUILD:</span>
            <span className="text-white font-semibold">{JARVIS_BUILD_INFO.buildTime}</span>
            <span className="px-1.5 py-0.5 rounded bg-white/10 border border-white/20 text-stone-200">
              commit: {JARVIS_BUILD_INFO.commitSha}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/40 text-emerald-400 uppercase font-bold text-[9px]">
              {JARVIS_BUILD_INFO.environment}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[9px] text-stone-400">
            <span>Client v{JARVIS_BUILD_INFO.geminiClientVersion}</span>
            <span>•</span>
            <span>AudioEngine v{JARVIS_BUILD_INFO.audioEngineVersion}</span>
            <span>•</span>
            <span className={health.activeSocketCount <= 1 ? "text-emerald-400 font-bold" : "text-red-400 font-bold"}>
              Active Sockets: {health.activeSocketCount} (max 1)
            </span>
          </div>
        </div>

        {/* Live Health Status Matrix */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 bg-[#060202] border-b border-red-500/20 text-[10px] sm:text-[11px] shrink-0">
          <div className={`p-2 rounded-xl border flex flex-col justify-between ${getHealthColor(health.websocket)}`}>
            <span className="text-[9px] opacity-70 uppercase">WebSocket</span>
            <span className="font-bold tracking-wider">{health.websocket}</span>
          </div>

          <div className={`p-2 rounded-xl border flex flex-col justify-between ${getHealthColor(health.gemini)}`}>
            <span className="text-[9px] opacity-70 uppercase">Gemini Bidi</span>
            <span className="font-bold tracking-wider">{health.gemini}</span>
          </div>

          <div className={`p-2 rounded-xl border flex flex-col justify-between ${getHealthColor(health.webaudio)}`}>
            <span className="text-[9px] opacity-70 uppercase">Web Audio</span>
            <span className="font-bold tracking-wider">{health.webaudio}</span>
          </div>

          <div className={`p-2 rounded-xl border flex flex-col justify-between ${getHealthColor(health.microphone)}`}>
            <span className="text-[9px] opacity-70 uppercase">Microphone</span>
            <span className="font-bold tracking-wider">{health.microphone}</span>
          </div>

          <div className={`p-2 rounded-xl border flex flex-col justify-between ${getHealthColor(health.geminiApiKey)}`}>
            <span className="text-[9px] opacity-70 uppercase">API Key</span>
            <span className="font-bold tracking-wider">{health.geminiApiKey}</span>
          </div>

          <div className={`p-2 rounded-xl border flex flex-col justify-between ${getHealthColor(health.voiceState)}`}>
            <span className="text-[9px] opacity-70 uppercase">Voice State</span>
            <span className="font-bold tracking-wider">{health.voiceState}</span>
          </div>

          <div className={`p-2 rounded-xl border flex flex-col justify-between ${getHealthColor(health.crm)}`}>
            <span className="text-[9px] opacity-70 uppercase">CRM Sync</span>
            <span className="font-bold tracking-wider">{health.crm}</span>
          </div>

          <div className="p-2 rounded-xl border border-stone-700 bg-stone-900/60 text-stone-300 flex flex-col justify-between">
            <span className="text-[9px] opacity-70 uppercase">Conv ID</span>
            <span className="font-bold tracking-wider truncate" title={health.conversationId}>
              {health.conversationId ? health.conversationId.slice(0, 10) + '...' : 'NONE'}
            </span>
          </div>
        </div>

        {/* Active Error Banner inside HUD if present */}
        {activeError && (
          <div className="mx-3 mt-2 p-2.5 rounded-xl bg-red-950/80 border border-red-500/60 text-red-200 text-xs flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span className="font-bold">{activeError}</span>
            </div>
            <button
              onClick={() => diagnosticStore.clearActiveError()}
              className="text-[10px] uppercase text-red-300 hover:text-white px-2 py-0.5 rounded bg-red-900/60 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Filters & Search */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-[#080303] border-b border-red-500/20 shrink-0">
          <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
            {['ALL', 'ERRORS', 'AUDIO', 'WEBSOCKET', 'GEMINI', 'CRM'].map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 rounded-lg font-bold uppercase transition-colors cursor-pointer ${
                  selectedCategory === cat
                    ? 'bg-amber-500 text-black shadow-[0_0_10px_rgba(245,158,11,0.4)]'
                    : 'bg-white/5 text-stone-400 hover:text-white hover:bg-white/10'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Filter events..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-black/60 border border-white/15 rounded-lg px-2.5 py-1 text-xs text-white placeholder-stone-500 focus:outline-none focus:border-amber-400 w-36 sm:w-48"
            />
            <span className="text-[10px] text-stone-500">
              {filteredEvents.length} / {events.length}
            </span>
          </div>
        </div>

        {/* Event Logs Stream */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1 text-[11px] select-text">
          {filteredEvents.length === 0 ? (
            <div className="text-center py-12 text-stone-500 text-xs">
              No diagnostic events recorded yet for this session.
            </div>
          ) : (
            filteredEvents.slice().reverse().map((ev) => {
              const isExpanded = expandedEventId === ev.id;
              const hasDetails = ev.details && Object.keys(ev.details).length > 0;

              return (
                <div
                  key={ev.id}
                  className={`p-1.5 sm:p-2 rounded-lg border transition-colors ${
                    ev.level === 'ERROR'
                      ? 'bg-red-950/40 border-red-500/40 text-red-200'
                      : ev.level === 'WARN'
                      ? 'bg-amber-950/30 border-amber-500/30 text-amber-200'
                      : 'bg-white/[0.02] border-white/5 text-stone-300 hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] text-stone-500">{formatTime(ev.timestamp)}</span>
                      <span
                        className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase ${
                          ev.level === 'ERROR'
                            ? 'bg-red-500 text-white'
                            : ev.level === 'WARN'
                            ? 'bg-amber-500 text-black'
                            : 'bg-stone-800 text-stone-300'
                        }`}
                      >
                        {ev.level}
                      </span>
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-white/10 text-amber-300 font-bold">
                        {ev.category}
                      </span>
                      <span className="font-semibold text-white tracking-wide">{ev.event}</span>
                      {ev.socketId && (
                        <span className="text-[9px] text-stone-500 font-mono">
                          sock:{ev.socketId.slice(-6)}
                        </span>
                      )}
                    </div>

                    <button
                      onClick={() => setExpandedEventId(isExpanded ? null : ev.id)}
                      className="text-[10px] text-stone-400 hover:text-amber-300 underline cursor-pointer shrink-0"
                    >
                      {isExpanded ? 'Hide' : 'Details'}
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="mt-2 p-2 rounded bg-black/80 border border-white/10 text-[10px] text-stone-300 font-mono space-y-1 select-text">
                      <div className="flex flex-wrap gap-3 text-stone-400 border-b border-white/10 pb-1 text-[9px]">
                        <span>conv: {ev.conversationId || 'none'}</span>
                        <span>gen: #{ev.sessionGeneration}</span>
                        <span>socket: {ev.socketId || 'none'}</span>
                      </div>
                      {hasDetails && (
                        <pre className="overflow-x-auto pt-1">
                          {JSON.stringify(ev.details, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer info strip */}
        <div className="px-4 py-2 bg-[#050101] border-t border-red-500/20 text-[9px] text-stone-500 flex items-center justify-between">
          <span>PII &amp; API keys are automatically sanitized prior to export</span>
          <span>Zero-DevTools Live Diagnostic Protocol</span>
        </div>
      </motion.div>
    </div>
  );
};
