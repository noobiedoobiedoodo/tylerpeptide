/**
 * client/src/components/PeptideVoicePage.tsx
 * 
 * Bodybuilding-Focused Peptide Research & Sales Concierge Interface.
 * Customer Journey: DISCOVER → RESEARCH → UNDERSTAND → BUILD INTEREST → WHATSAPP HANDOFF
 * 
 * Features:
 * - 80s Golden Era Bodybuilding Specialist Persona (Charon voice)
 * - "What are you researching today?" Discovery & Voice Engagement
 * - 4-Tier Strict Evidence Display:
 *   1. ANECDOTAL REPORTS (Community & athlete reports with explicit disclaimer & source)
 *   2. PRECLINICAL RESEARCH (Animal/in-vitro models, findings, human translation limitation)
 *   3. HUMAN / CLINICAL EVIDENCE (Human RCTs, populations, outcomes, limitations)
 *   4. WHAT THE EVIDENCE ACTUALLY SAYS (Concise 4-part synthesis & bottom line)
 * - Prominent, qualified WhatsApp Sales Concierge CTA: [ WHATSAPP PEPTIDE TEAM ]
 * - Interactive [ VIEW SOURCES ] modal with external PubMed/DOI links
 * - Full vertical isolation (zero automotive / Jessica / CRM contamination)
 */

import React, { useState, useEffect, useRef } from 'react';
import { usePeptideStore, EvidenceLevel, StructuredEvidenceRecord } from '@/store/peptideStore';
import { GeminiLiveClient } from '@/services/voice/live/GeminiLiveClient';
import { InteractiveVoicePortrait } from './avatar/InteractiveVoicePortrait';
import { 
  Mic, MicOff, Volume2, VolumeX, ShieldAlert, Sparkles, Send,
  BookOpen, ChevronDown, ChevronUp, RefreshCw, CheckCircle2, AlertCircle,
  ExternalLink, X, FileText, FlaskConical, MessageSquare, ArrowRight, ArrowLeft,
  HelpCircle, Info
} from 'lucide-react';

export function EvidenceBadge({ level }: { level?: EvidenceLevel }) {
  switch (level) {
    case 'LEVEL_A':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          Level A • Clinically Supported
        </span>
      );
    case 'LEVEL_B':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20">
          Level B • Limited Human Research
        </span>
      );
    case 'LEVEL_C':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
          Level C • Preclinical Only
        </span>
      );
    case 'LEVEL_D':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">
          Level D • Anecdotal Report
        </span>
      );
    case 'LEVEL_E':
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
          Level E • Insufficient Evidence
        </span>
      );
  }
}

export function PeptideVoicePage() {
  const {
    connectionState,
    setConnectionState,
    userAudioLevel,
    setUserAudioLevel,
    agentAudioLevel,
    setAgentAudioLevel,
    isMuted,
    setIsMuted,
    transcript,
    addTranscriptTurn,
    updateLastTurn,
    clearTranscript,
    activePeptide,
    setActivePeptide,
    activeStructuredEvidence,
    setActiveStructuredEvidence,
    activeEvidenceSummary,
    setActiveEvidenceSummary,
    isSourcesModalOpen,
    setSourcesModalOpen,
    uiState,
    setUiState,
    primaryEvidenceClass,
    setPrimaryEvidenceClass,
    whatsappNumber,
    salesHandoff,
    setSalesHandoff,
    sessionContext,
    setSessionContext,
    openWhatsApp,
    activeSafetyAlert,
    setActiveSafetyAlert,
    peptides,
    loadPeptides
  } = usePeptideStore();

  const [client, setClient] = useState<GeminiLiveClient | null>(null);
  const [inputText, setInputText] = useState('');
  const [isSubmittingText, setIsSubmittingText] = useState(false);
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});
  const transcriptContainerRef = useRef<HTMLDivElement>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Initialize peptide repository and WhatsApp configuration on mount
  useEffect(() => {
    loadPeptides();
  }, [loadPeptides]);

  // Auto-scroll transcript container when new dialogue turns arrive (preventing full window jump)
  useEffect(() => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTo({
        top: transcriptContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [transcript]);

  // Initialize Gemini Live Voice Client with 80s Golden Era Bodybuilder Persona
  useEffect(() => {
    const liveClient = new GeminiLiveClient({
      onStateChange: (state) => setConnectionState(state),
      onUserAudioLevel: (level) => setUserAudioLevel(level),
      onJarvisAudioLevel: (level) => setAgentAudioLevel(level),
      onTranscript: (turn) => {
        if (turn.sender === 'user') {
          addTranscriptTurn({
            sender: 'user',
            text: turn.text
          });
          detectAndSelectPeptide(turn.text);
        } else if (turn.sender === 'jarvis') {
          updateLastTurn(turn.text);
        }
      },
      onEvidenceClassification: (evidence) => {
        if (evidence?.peptideName) {
          const match = peptides.find(p => 
            p.name.toLowerCase() === evidence.peptideName.toLowerCase() ||
            p.commonNames.some(a => a.toLowerCase() === evidence.peptideName.toLowerCase())
          );
          if (match) setActivePeptide(match);
        }
      },
      onSafetyEscalation: (safety) => {
        if (safety?.severity === 'EMERGENT' || safety?.severity === 'URGENT') {
          setActiveSafetyAlert({
            level: safety.severity,
            symptoms: [safety.symptomType || 'Emergent symptoms'],
            guidance: safety.recommendation || 'Seek prompt medical evaluation immediately.'
          });
        }
      },
      onError: (err) => {
        console.error('[PeptideVoiceAgent] Live error:', err);
      }
    }, {
      agentType: 'PEPTIDE_SPECIALIST',
      enableTools: true
    });

    setClient(liveClient);

    return () => {
      try {
        liveClient.disconnect();
      } catch {}
    };
  }, []);

  const detectAndSelectPeptide = (text: string) => {
    const lower = text.toLowerCase();
    const found = peptides.find(p => 
      lower.includes(p.name.toLowerCase()) ||
      p.commonNames.some(a => lower.includes(a.toLowerCase()))
    );
    if (found) {
      setActivePeptide(found);
    }
  };

  const handleToggleVoice = async () => {
    if (!client) return;

    if (isConnected) {
      client.disconnect();
      setConnectionState('DISCONNECTED');
    } else {
      try {
        setConnectionState('CONNECTING');
        await client.connect();
      } catch (err: any) {
        console.error('[PeptideVoiceAgent] Connection failure:', err);
        setConnectionState('ERROR');
      }
    }
  };

  const handleToggleMute = () => {
    if (!client) return;
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    client.setMute(nextMute);
  };

  const toggleSource = (turnId: string) => {
    setExpandedSources(prev => ({
      ...prev,
      [turnId]: !prev[turnId]
    }));
  };

  const handleTextSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || isSubmittingText) return;

    const userQuery = inputText.trim();
    setInputText('');
    setIsSubmittingText(true);

    // 1. Add user turn
    addTranscriptTurn({
      sender: 'user',
      text: userQuery
    });

    try {
      // 2. Query grounded knowledge engine
      const res = await fetch('/api/peptides/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userQuery, sessionId: 'active-user-session' })
      });

      if (res.ok) {
        const data = await res.json();

        if (data.peptide) {
          setActivePeptide(data.peptide);
        }

        if (data.structuredEvidence) {
          setActiveStructuredEvidence(data.structuredEvidence);
        }

        if (data.evidenceSummary) {
          setActiveEvidenceSummary(data.evidenceSummary);
        }

        if (data.salesHandoff) {
          setSalesHandoff(data.salesHandoff);
        }

        if (data.uiState) {
          setUiState(data.uiState);
        }

        if (data.primaryEvidenceClass) {
          setPrimaryEvidenceClass(data.primaryEvidenceClass);
        }

        if (data.sessionContext) {
          setSessionContext(data.sessionContext);
        }

        if (data.safety?.hasEmergentSymptoms) {
          setActiveSafetyAlert({
            level: data.safety.emergencyLevel,
            symptoms: data.safety.detectedSymptoms,
            guidance: data.safety.safetyGuidance
          });
        }

        addTranscriptTurn({
          sender: 'assistant',
          text: data.answer,
          evidenceLevel: data.evidenceClassification?.evidenceLevel,
          evidenceTopic: data.evidenceClassification?.claimTopic,
          evidenceSummary: data.evidenceClassification?.evidenceSummary,
          citations: data.sources?.map((s: any) => `${s.journalOrPublisher} (${s.year}) - ${s.title}`)
        });
      } else {
        addTranscriptTurn({
          sender: 'assistant',
          text: "I don't have enough reliable evidence to answer that query right now.",
          evidenceLevel: 'LEVEL_E'
        });
      }
    } catch {
      addTranscriptTurn({
        sender: 'assistant',
        text: "There was a network issue connecting to the peptide knowledge engine.",
        evidenceLevel: 'LEVEL_E'
      });
    } finally {
      setIsSubmittingText(false);
    }
  };

  const ACTIVE_LIVE_STATES = ['CONNECTED', 'READY', 'LISTENING', 'THINKING', 'USER_SPEAKING', 'SPEAKING', 'WAITING_FOR_TURN_COMPLETE', 'INTERRUPTED'];
  const isConnected = ACTIVE_LIVE_STATES.includes(connectionState as any);
  const isSpeaking = isConnected && agentAudioLevel > 0.05;
  const isListening = isConnected && userAudioLevel > 0.05 && !isSpeaking;


  return (
    <div className="w-full flex flex-col min-h-screen max-w-4xl mx-auto px-3 sm:px-4 py-3 sm:py-6 space-y-4 sm:space-y-6">

      {/* ── 1. HERO & SPECIALIST VOICE INTERACTION ──────────────────────── */}
      <section className="flex flex-col items-center text-center space-y-3 sm:space-y-4 pt-1 sm:pt-4">

        {/* Interactive 2D Voice Specialist Portrait with Live Sound Waves & Radial Equalizer */}
        <InteractiveVoicePortrait
          connectionState={connectionState}
          userAudioLevel={userAudioLevel}
          agentAudioLevel={agentAudioLevel}
          outputAnalyser={client?.getOutputAnalyser()}
          onConnectClick={handleToggleVoice}
        />

        {/* Persona Identity & Tagline */}
        <div className="space-y-1 px-2">
          <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              PEPTIDE SPECIALIST
            </h1>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-mono text-[9px] sm:text-[10px] font-semibold border border-emerald-500/30 uppercase tracking-wider">
              Golden Era Veteran Concierge
            </span>
          </div>
          <p className="text-xs sm:text-sm text-zinc-300 font-medium">
            Experienced. Disciplined. Grounded in decades of physique development & modern research.
          </p>
          <p className="text-xs sm:text-sm font-semibold text-emerald-400">
            "What are you researching today?"
          </p>
        </div>

        {/* Primary Action Voice Button */}
        <div className="flex flex-wrap items-center justify-center gap-2.5 sm:gap-3 pt-1 w-full max-w-xs sm:max-w-md">
          {!isConnected ? (
            <button
              onClick={handleToggleVoice}
              disabled={connectionState === 'CONNECTING'}
              className="w-full sm:w-auto group flex items-center justify-center gap-2.5 sm:gap-3 px-6 sm:px-8 py-3.5 sm:py-4 rounded-full bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 hover:from-emerald-400 hover:via-teal-400 hover:to-cyan-400 text-white font-bold text-sm sm:text-base shadow-xl shadow-emerald-500/25 hover:shadow-emerald-500/40 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
            >
              <Mic className="w-5 h-5 transition-transform group-hover:scale-110 animate-bounce" />
              <span>{connectionState === 'CONNECTING' ? 'Connecting...' : 'Talk to Specialist'}</span>
            </button>
          ) : (
            <div className="flex items-center gap-2.5 w-full sm:w-auto justify-center">
              <button
                onClick={handleToggleMute}
                className={`p-3 rounded-full border transition-all cursor-pointer touch-manipulation ${
                  isMuted
                    ? 'bg-rose-500/20 border-rose-500/50 text-rose-300'
                    : 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500'
                }`}
                title={isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
              >
                {isMuted ? <MicOff className="w-5 h-5 text-rose-400" /> : <Mic className="w-5 h-5" />}
              </button>

              <button
                onClick={handleToggleVoice}
                className="flex-1 sm:flex-initial px-6 py-3 rounded-full bg-rose-600/90 hover:bg-rose-500 text-white text-xs sm:text-sm font-semibold transition-all cursor-pointer shadow-lg shadow-rose-600/20 touch-manipulation"
              >
                End Voice Session
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ── 2. SAFETY ESCALATION ALERT BANNER ─────────────────────────────── */}
      {activeSafetyAlert && activeSafetyAlert.level !== 'NONE' && (
        <section className={`p-4 rounded-xl border flex items-start gap-3 animate-in fade-in duration-300 ${
          activeSafetyAlert.level === 'EMERGENT'
            ? 'bg-rose-950/80 border-rose-500/70 text-rose-200'
            : 'bg-amber-950/80 border-amber-500/70 text-amber-200'
        }`}>
          <ShieldAlert className="w-5 h-5 mt-0.5 text-rose-400 shrink-0" />
          <div className="flex-1 space-y-1">
            <h4 className="font-bold text-sm text-white">
              {activeSafetyAlert.level === 'EMERGENT' ? 'EMERGENT MEDICAL ALERT' : 'CLINICAL SAFETY WARNING'}
            </h4>
            <p className="text-xs leading-relaxed">{activeSafetyAlert.guidance}</p>
          </div>
          <button 
            onClick={() => setActiveSafetyAlert(null)}
            className="text-zinc-400 hover:text-white text-xs p-1"
          >
            ✕
          </button>
        </section>
      )}

      {/* ── 3. WHATSAPP SALES CONCIERGE CTA BOX ─────────────────────────── */}
      <section className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-emerald-950/70 via-zinc-900 to-teal-950/70 border border-emerald-500/40 text-emerald-100 flex flex-col sm:flex-row items-center justify-between gap-3.5 sm:gap-4 shadow-xl">
        <div className="space-y-1 text-center sm:text-left w-full sm:w-auto">
          <div className="flex items-center gap-1.5 justify-center sm:justify-start text-emerald-400 font-semibold text-[11px] sm:text-xs uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Peptide Research & Availability Concierge</span>
          </div>
          <h3 className="text-sm sm:text-base font-bold text-white">
            Interested in researching availability or pricing?
          </h3>
          <p className="text-xs text-zinc-300 max-w-xl">
            Continue your research directly with the peptide supplier on WhatsApp to check current batch certificates of analysis (COA) and availability.
          </p>
        </div>
        <button
          onClick={openWhatsApp}
          className="w-full sm:w-auto flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-full bg-[#25D366] hover:bg-[#20bd5a] text-zinc-950 font-bold text-xs uppercase tracking-wider shadow-lg shadow-[#25D366]/25 hover:scale-105 active:scale-95 transition-all cursor-pointer shrink-0 touch-manipulation"
        >
          <MessageSquare className="w-4 h-4 fill-zinc-950" />
          <span>WhatsApp Peptide Team</span>
        </button>
      </section>

      {/* ── 4. CONVERSATIONAL TRANSCRIPT (Only rendered during active dialogue) ── */}
      {transcript.length > 0 && (
        <section 
          ref={transcriptContainerRef}
          className="bg-zinc-950/70 border border-zinc-800/80 rounded-2xl p-3.5 sm:p-5 max-h-[300px] sm:max-h-[340px] overflow-y-auto space-y-3 shadow-inner animate-in fade-in duration-200"
        >
          {transcript.map((turn) => {
            const isUser = turn.sender === 'user';
            const isExpanded = expandedSources[turn.id];

            return (
              <div 
                key={turn.id} 
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-full sm:max-w-2xl ${isUser ? 'ml-auto' : 'mr-auto'}`}
              >
                <div className={`px-3.5 py-2.5 rounded-2xl text-xs sm:text-sm leading-relaxed shadow-sm max-w-[90%] sm:max-w-full ${
                  isUser 
                    ? 'bg-zinc-800 text-white rounded-br-sm border border-zinc-700/60' 
                    : 'bg-zinc-900/90 text-zinc-100 rounded-bl-sm border border-zinc-800'
                }`}>
                  <p className="whitespace-pre-wrap">{turn.text}</p>
                </div>

                {/* Source & Evidence Pill */}
                {!isUser && (turn.citations?.length || turn.evidenceLevel) && (
                  <div className="mt-1 flex flex-col items-start max-w-full">
                    <button
                      onClick={() => toggleSource(turn.id)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-900 hover:bg-zinc-800 text-[10px] font-mono text-zinc-400 hover:text-zinc-200 border border-zinc-800 transition-colors cursor-pointer touch-manipulation max-w-full"
                    >
                      <BookOpen className="w-3 h-3 text-cyan-400 shrink-0" />
                      <span className="truncate">
                        {turn.evidenceLevel ? formatEvidenceLabel(turn.evidenceLevel) : 'Published Source'}
                      </span>
                      {turn.citations && turn.citations.length > 0 && (
                        <span className="text-zinc-500 truncate max-w-[140px] sm:max-w-[200px]">
                          • {turn.citations[0].split('-')[0]}
                        </span>
                      )}
                      {isExpanded ? <ChevronUp className="w-3 h-3 ml-0.5 shrink-0" /> : <ChevronDown className="w-3 h-3 ml-0.5 shrink-0" />}
                    </button>

                    {isExpanded && (
                      <div className="mt-1 p-2.5 rounded-xl bg-zinc-900/95 border border-zinc-800 text-[11px] text-zinc-300 space-y-1 shadow-lg max-w-full sm:max-w-lg animate-in fade-in duration-200">
                        {turn.evidenceTopic && (
                          <div className="font-semibold text-white flex items-center gap-1.5">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span>Topic: {turn.evidenceTopic}</span>
                          </div>
                        )}
                        {turn.evidenceSummary && (
                          <div className="text-zinc-400">
                            {turn.evidenceSummary}
                          </div>
                        )}
                        {turn.citations && turn.citations.map((c, i) => (
                          <div key={i} className="text-cyan-400 font-mono text-[10px] pt-0.5 border-t border-zinc-800/80 truncate">
                            Reference: {c}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <div ref={transcriptEndRef} />
        </section>
      )}

      {/* ── 6. TEXT INPUT & CONVERSATION PROMPTS ─────────────────────────── */}
      <footer className="w-full space-y-2.5 pt-1">
        {/* Quick Question Chips for Discovery */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px] font-medium text-zinc-400 scrollbar-none">
          <span className="text-zinc-500 shrink-0 text-[10px]">Quick:</span>
          <button
            onClick={() => { setInputText('What is BPC-157 and what are people reporting about it?'); }}
            className="px-2.5 py-1 rounded-full bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 whitespace-nowrap cursor-pointer transition-colors shrink-0 touch-manipulation text-[11px]"
          >
            "What is BPC-157?"
          </button>
          <button
            onClick={() => { setInputText('What peptides are people researching for recovery?'); }}
            className="px-2.5 py-1 rounded-full bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 whitespace-nowrap cursor-pointer transition-colors shrink-0 touch-manipulation text-[11px]"
          >
            "Recovery research"
          </button>
          <button
            onClick={() => { setInputText("What's proven versus what bodybuilders just say works?"); }}
            className="px-2.5 py-1 rounded-full bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 whitespace-nowrap cursor-pointer transition-colors shrink-0 touch-manipulation text-[11px]"
          >
            "Proven vs gym lore"
          </button>
          <button
            onClick={openWhatsApp}
            className="px-2.5 py-1 rounded-full bg-emerald-950/70 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/50 whitespace-nowrap cursor-pointer transition-colors shrink-0 touch-manipulation text-[11px]"
          >
            "WhatsApp Supplier"
          </button>
        </div>

        {/* Minimal Text Input Bar */}
        <form onSubmit={handleTextSubmit} className="flex items-center gap-2">
          <input
            id="peptide-query-input"
            name="query"
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Ask about peptides or research..."
            aria-label="Ask about peptides or research"
            className="flex-1 bg-zinc-900/90 border border-zinc-800 rounded-full px-4 py-3 text-base sm:text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/30 transition-all shadow-inner"
          />
          <button
            type="submit"
            disabled={!inputText.trim() || isSubmittingText}
            className="p-3 rounded-full bg-gradient-to-r from-cyan-600 to-emerald-600 text-white hover:from-cyan-500 hover:to-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer shadow-md shadow-cyan-600/20 touch-manipulation shrink-0"
            title="Send query"
          >
            <Send className="w-4 h-4" />
          </button>
          {transcript.length > 0 && (
            <button
              type="button"
              onClick={clearTranscript}
              className="p-3 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white transition-all cursor-pointer touch-manipulation shrink-0"
              title="Clear transcript"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
        </form>

        {/* Non-Prescribing Disclaimer */}
        <p className="text-center text-[9px] sm:text-[10px] font-mono text-zinc-500 pb-1">
          Educational & research concierge only. Not medical advice, diagnosis, or prescribing.
        </p>
      </footer>

      {/* ── 7. INTERACTIVE SOURCES MODAL ─────────────────────────────────── */}
      {isSourcesModalOpen && activePeptide && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-2xl w-full p-5 space-y-4 max-h-[85vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-cyan-400" />
                <h3 className="text-base font-bold text-white">
                  Published Sources & Evidence: {activePeptide.name}
                </h3>
              </div>
              <button 
                onClick={() => setSourcesModalOpen(false)}
                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              {activePeptide.sources && activePeptide.sources.length > 0 ? (
                activePeptide.sources.map((src, i) => (
                  <div key={i} className="p-3 rounded-xl bg-zinc-950/80 border border-zinc-800/80 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 font-mono text-[10px] font-bold border border-cyan-500/30">
                        {formatEvidenceLabel(src.evidenceLevel)}
                      </span>
                      <span className="text-[10px] font-mono text-zinc-500">{src.year}</span>
                    </div>
                    <p className="text-xs font-semibold text-white leading-snug">{src.title}</p>
                    <p className="text-[11px] text-zinc-400">{src.authorsOrOrg} — {src.journalOrPublisher}</p>
                    {src.pmidOrDoi && (
                      <p className="text-[10px] font-mono text-cyan-400">{src.pmidOrDoi}</p>
                    )}
                    {src.url && (
                      <a 
                        href={src.url} 
                        target="_blank" 
                        rel="noreferrer" 
                        className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:underline pt-1"
                      >
                        <span>View on PubMed / Journal</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                ))
              ) : (
                <div className="p-4 text-center text-xs text-zinc-400">
                  No published clinical sources indexed for this compound.
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-zinc-800 flex justify-end">
              <button
                onClick={() => setSourcesModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function formatEvidenceLabel(level: EvidenceLevel): string {
  switch (level) {
    case 'LEVEL_A':
      return 'HUMAN CLINICAL EVIDENCE';
    case 'LEVEL_B':
      return 'HUMAN RESEARCH';
    case 'LEVEL_C':
      return 'PRECLINICAL';
    case 'LEVEL_D':
      return 'BODYBUILDING COMMUNITY CLAIM';
    case 'LEVEL_E':
    default:
      return 'INSUFFICIENT EVIDENCE';
  }
}
