import React, { useEffect, useState } from 'react';
import { debugOverlayStore, DebugState } from '../../services/voice/telemetry/DebugOverlayState';
import { VoiceConversationEngine } from '../../services/voice/VoiceConversationEngine';
import { SalesDeskState } from '../../services/salesDesk/salesOrchestrator';
import { Activity, Radio, Volume2, ShieldCheck, X, CheckCircle2, XCircle, AlertTriangle, Play, Sparkles } from 'lucide-react';

interface DebugOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  salesDeskState?: SalesDeskState;
}

export const DebugOverlay: React.FC<DebugOverlayProps> = ({ isOpen, onClose, salesDeskState }) => {
  const [debugState, setDebugState] = useState<DebugState>(debugOverlayStore.getState());
  const [isSelfTesting, setIsSelfTesting] = useState(false);

  useEffect(() => {
    return debugOverlayStore.subscribe(setDebugState);
  }, []);

  if (!isOpen) return null;

  const handleRunSelfTest = async () => {
    setIsSelfTesting(true);
    try {
      await VoiceConversationEngine.getInstance().runHardwareSelfTest();
    } finally {
      setIsSelfTesting(false);
    }
  };

  const diag = debugState.diagnosticTest;
  const leadIntel = salesDeskState?.leadIntelligence;
  const fieldMem = salesDeskState?.fieldMemory;

  return (
    <div className="fixed top-3 right-3 z-50 w-84 sm:w-96 max-h-[92vh] bg-black/95 backdrop-blur-2xl border border-brand-cyan/40 rounded-2xl p-4 shadow-[0_0_35px_rgba(0,243,255,0.25)] text-white font-mono text-xs select-none flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-2.5 mb-2.5">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-brand-cyan animate-pulse" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-brand-cyan">SalesDesk Voice Debug HUD</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-all cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
        {/* Sales Intelligence Diagnostics */}
        {leadIntel && (
          <div className="bg-amber-950/20 p-2.5 rounded-xl border border-amber-500/30 text-[10px] space-y-1.5">
            <div className="flex items-center justify-between border-b border-amber-500/20 pb-1">
              <span className="font-bold text-amber-300 flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> LEAD INTELLIGENCE
              </span>
              <span className="text-amber-200 font-bold">QUALITY: {leadIntel.leadQualityScore}/100</span>
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1">
              <div><span className="text-white/40">INTENT:</span> <span className="text-amber-400 font-bold">{leadIntel.intentScore} ({leadIntel.intentStage})</span></div>
              <div><span className="text-white/40">CONTACT:</span> <span className="text-brand-cyan font-bold">{leadIntel.contactabilityScore}/100</span></div>
              <div><span className="text-white/40">QUALIFICATION:</span> <span className="text-green-400 font-bold">{leadIntel.qualificationScore}/100</span></div>
              <div><span className="text-white/40">COMPLETENESS:</span> <span className="text-white/80">{leadIntel.completenessScore}%</span></div>
              <div className="col-span-2"><span className="text-white/40">COMMITMENT:</span> <span className="text-purple-300 font-bold">{leadIntel.buyingCommitment}</span></div>
              <div className="col-span-2"><span className="text-white/40">NEXT ACTION:</span> <span className="text-emerald-300 font-bold">{leadIntel.nextBestAction}</span></div>
              {leadIntel.activeObjection && (
                <div className="col-span-2"><span className="text-white/40">ACTIVE OBJECTION:</span> <span className="text-red-300">{leadIntel.activeObjection}</span></div>
              )}
            </div>
            {fieldMem && fieldMem.knownFields.length > 0 && (
              <div className="pt-1 border-t border-amber-500/15 text-[9px]">
                <span className="text-white/40">CAPTURED FIELDS:</span> <span className="text-white/80">{fieldMem.knownFields.join(', ')}</span>
              </div>
            )}
          </div>
        )}
        {/* Real-Time Acoustic & Signal Meters */}
        <div className="grid grid-cols-2 gap-2 bg-white/5 p-2 rounded-xl border border-white/5">
          <div className="flex items-center justify-between">
            <span className="text-white/50 text-[10px]">MIC STATUS:</span>
            <span className={`font-bold text-[11px] flex items-center gap-1.5 ${debugState.micActive ? 'text-green-400' : 'text-red-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${debugState.micActive ? 'bg-green-400 animate-ping' : 'bg-red-400'}`} />
              {debugState.micActive ? 'ACTIVE' : 'IDLE'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/50 text-[10px]">VAD STATE:</span>
            <span className="font-bold text-amber-400 text-[11px]">{debugState.vadState}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/50 text-[10px]">RMS ENERGY:</span>
            <span className="font-bold text-brand-cyan text-[11px]">{debugState.audioLevels.rms.toFixed(3)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/50 text-[10px]">PEAK LEVEL:</span>
            <span className="font-bold text-brand-cyan text-[11px]">{debugState.audioLevels.peak.toFixed(3)}</span>
          </div>
        </div>

        {/* State Machine Status */}
        <div className="grid grid-cols-2 gap-2 bg-white/5 p-2 rounded-xl border border-white/5 text-[10px]">
          <div className="flex justify-between">
            <span className="text-white/50">VOICE STATE:</span>
            <span className="font-bold text-brand-cyan">{debugState.voiceState}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/50">TURN ID:</span>
            <span className="font-bold text-white">#{debugState.turnId}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/50">API STATUS:</span>
            <span className={`font-bold ${debugState.apiStatus === '200' ? 'text-green-400' : debugState.apiStatus === 'ERROR' ? 'text-red-400' : 'text-amber-400'}`}>
              {debugState.apiStatus}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/50">TTS STATUS:</span>
            <span className="font-bold text-purple-400">{debugState.ttsStatus}</span>
          </div>
        </div>

        {/* Live Transcript Buffer */}
        <div className="bg-white/5 p-2 rounded-xl border border-white/5">
          <span className="text-[9px] uppercase tracking-wider text-white/40 block mb-1">Live Transcript Buffer</span>
          <p className="text-[11px] text-white/90 italic min-h-[24px] break-words">
            {debugState.transcript ? `"${debugState.transcript}"` : <span className="text-white/30">(Awaiting user speech...)</span>}
          </p>
        </div>

        {/* Hardware Self-Test Diagnostic Button & Results */}
        <div className="bg-white/5 p-2.5 rounded-xl border border-white/5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] uppercase tracking-wider text-white/50 font-bold">Hardware Signal Diagnostic</span>
            <button
              onClick={handleRunSelfTest}
              disabled={isSelfTesting}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-brand-cyan/20 hover:bg-brand-cyan/30 text-brand-cyan border border-brand-cyan/40 text-[9px] font-bold cursor-pointer disabled:opacity-50"
            >
              <Play className="w-2.5 h-2.5" />
              {isSelfTesting ? 'Testing...' : 'Run Self-Test'}
            </button>
          </div>

          {diag.microphoneDetected !== null && (
            <div className="space-y-1 text-[9px]">
              <div className="flex items-center justify-between">
                <span>Microphone detected:</span>
                <span className={diag.microphoneDetected ? 'text-green-400 font-bold' : 'text-red-400'}>
                  {diag.microphoneDetected ? 'YES' : 'NO'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Audio stream active:</span>
                <span className={diag.audioStreamActive ? 'text-green-400 font-bold' : 'text-red-400'}>
                  {diag.audioStreamActive ? 'YES' : 'NO'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Audio energy detected:</span>
                <span className={diag.audioEnergyDetected ? 'text-green-400 font-bold' : 'text-amber-400'}>
                  {diag.audioEnergyDetected ? 'YES' : 'LOW'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>VAD detected speech:</span>
                <span className={diag.vadDetectedSpeech ? 'text-green-400 font-bold' : 'text-red-400'}>
                  {diag.vadDetectedSpeech ? 'YES' : 'NO'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>STT received audio:</span>
                <span className={diag.sttReceivedAudio ? 'text-green-400 font-bold' : 'text-red-400'}>
                  {diag.sttReceivedAudio ? 'YES' : 'NO'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Transcript generated:</span>
                <span className={diag.transcriptGenerated ? 'text-green-400 font-bold' : 'text-red-400'}>
                  {diag.transcriptGenerated ? 'YES' : 'NO'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Detailed Last Error Diagnosis (If any failure occurred) */}
        {debugState.lastErrorDetails && (
          <div className="bg-red-500/15 border border-red-500/30 p-2.5 rounded-xl text-[9px] text-red-200">
            <div className="flex items-center gap-1.5 text-red-400 font-bold mb-1">
              <AlertTriangle className="w-3 h-3" />
              <span>TURN #{debugState.lastErrorDetails.turnId} FAILED</span>
            </div>
            <div><span className="text-white/40">LAST SUCCESS:</span> {debugState.lastErrorDetails.lastSuccessfulEvent}</div>
            <div><span className="text-white/40">FAILED EVENT:</span> {debugState.lastErrorDetails.failedEvent}</div>
            <div><span className="text-white/40">REASON:</span> {debugState.lastErrorDetails.reason}</div>
          </div>
        )}

        {/* Live Millisecond Event Trace Stream */}
        <div className="bg-white/5 p-2 rounded-xl border border-white/5">
          <span className="text-[9px] uppercase tracking-wider text-white/40 block mb-1.5">
            Production Trace Stream ({debugState.recentTraces.length})
          </span>
          <div className="space-y-1 max-h-36 overflow-y-auto font-mono text-[9px]">
            {debugState.recentTraces.map((trace) => (
              <div
                key={trace.id}
                className={`p-1 rounded flex items-start gap-1.5 ${
                  trace.isError
                    ? 'bg-red-500/20 text-red-300'
                    : trace.type === 'COMMIT' || trace.type === 'API_RESPONSE'
                    ? 'bg-brand-cyan/15 text-brand-cyan font-bold'
                    : 'bg-black/30 text-white/75'
                }`}
              >
                <span className="text-white/40 shrink-0">[{trace.relativeTimeStr}]</span>
                <span className="shrink-0 font-bold text-white/90">{trace.type}</span>
                <span className="truncate">{trace.description}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
