/**
 * client/src/App.tsx
 * 
 * Production Application Shell for the Peptide Voice Specialist.
 * Delivers:
 * 1. Customer-Facing Clean Voice Experience:
 *    - Minimalist, high-end, conversational AI consultation interface
 *    - Zero developer dashboard clutter, zero internal test chips
 * 2. Dedicated Administrative & Intelligence Suite (/admin or settings link):
 *    - 20-Peptide Knowledge Repository CRUD & Claim Classifier
 *    - 5-Tier Evidence Classification Framework (Level A through E)
 *    - Real-time Diagnostic HUD
 */

import React, { useState, useEffect } from 'react';
import { PeptideVoicePage } from './components/PeptideVoicePage';
import { PeptideKnowledgeAdmin } from './components/PeptideKnowledgeAdmin';
import { EvidenceFrameworkGuide } from './components/EvidenceFrameworkGuide';
import { DiagnosticHUD } from './components/DiagnosticHUD';
import { usePeptideStore } from '@/store/peptideStore';
import { 
  Sparkles, CheckCircle2, Database, Scale, Activity, ArrowLeft, ShieldCheck
} from 'lucide-react';

export function App() {
  const { activeTab, setActiveTab } = usePeptideStore();
  const [adminSubTab, setAdminSubTab] = useState<'knowledge' | 'framework' | 'hud'>('knowledge');
  const [isGatewayOnline, setIsGatewayOnline] = useState<boolean | null>(null);

  // Strictly route-based Admin access (/admin or #admin) - Zero user-facing links
  useEffect(() => {
    const handleLocationChange = () => {
      if (window.location.pathname === '/admin' || window.location.hash === '#admin') {
        setActiveTab('admin');
      } else if (activeTab === 'admin' && window.location.pathname !== '/admin' && window.location.hash !== '#admin') {
        setActiveTab('voice');
      }
    };

    handleLocationChange();
    window.addEventListener('popstate', handleLocationChange);
    window.addEventListener('hashchange', handleLocationChange);

    // Check if voice gateway is online
    fetch('/api/voice/live-config')
      .then(res => res.json())
      .then(data => {
        setIsGatewayOnline(Boolean(data && data.model));
      })
      .catch(() => {
        setIsGatewayOnline(false);
      });

    return () => {
      window.removeEventListener('popstate', handleLocationChange);
      window.removeEventListener('hashchange', handleLocationChange);
    };
  }, [setActiveTab, activeTab]);

  const isAdminView = activeTab === 'admin' || activeTab === 'knowledge' || activeTab === 'framework';

  return (
    <div className="min-h-screen bg-[#06080d] text-zinc-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-white">
      
      {/* ── HEADER NAVIGATION ────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-[#070b12]/95 backdrop-blur-md border-b border-zinc-800/80 px-3 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between shadow-lg">
        {!isAdminView ? (
          /* Customer Header */
          <>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-gradient-to-tr from-cyan-600 to-emerald-500 flex items-center justify-center shadow-lg shadow-cyan-600/30 shrink-0">
                <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <span className="font-bold tracking-tight text-white text-xs sm:text-base truncate">
                    PEPTIDE SPECIALIST
                  </span>
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-mono text-[9px] sm:text-[10px] font-semibold border border-emerald-500/20 shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Online
                  </span>
                </div>
                <div className="text-[9px] sm:text-[10px] text-zinc-400 font-mono truncate hidden xs:block">
                  Built for the Bodybuilding & Performance Community
                </div>
              </div>
            </div>

            {/* Customer view: Zero admin buttons or settings links */}
          </>
        ) : (
          /* Admin Header (Only accessible directly via /admin or #admin) */
          <>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setActiveTab('voice');
                  if (window.location.hash === '#admin') window.location.hash = '';
                  if (window.location.pathname === '/admin') window.history.pushState(null, '', '/');
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-xs font-semibold text-zinc-200 transition-all cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back to Specialist</span>
              </button>

              <div className="hidden sm:block">
                <span className="font-bold text-sm tracking-tight text-white">
                  KNOWLEDGE BASE & EVIDENCE ENGINE
                </span>
                <div className="text-[10px] font-mono text-zinc-400">
                  Administrative Intelligence & Diagnostic Suite
                </div>
              </div>
            </div>

            {/* Admin Subtabs */}
            <div className="flex items-center gap-1 sm:gap-2 bg-black/60 p-1 rounded-xl border border-zinc-800 text-xs font-medium">
              <button
                onClick={() => setAdminSubTab('knowledge')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  adminSubTab === 'knowledge'
                    ? 'bg-gradient-to-r from-cyan-600 to-emerald-600 text-white shadow-md font-semibold'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Database className="w-3.5 h-3.5" />
                <span>Peptides (20)</span>
              </button>

              <button
                onClick={() => setAdminSubTab('framework')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  adminSubTab === 'framework'
                    ? 'bg-gradient-to-r from-cyan-600 to-emerald-600 text-white shadow-md font-semibold'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Scale className="w-3.5 h-3.5" />
                <span>Framework (A–E)</span>
              </button>

              <button
                onClick={() => setAdminSubTab('hud')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  adminSubTab === 'hud'
                    ? 'bg-gradient-to-r from-cyan-600 to-emerald-600 text-white shadow-md font-semibold'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>HUD</span>
              </button>
            </div>
          </>
        )}
      </header>

      {/* ── MAIN CONTENT ─────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        {!isAdminView ? (
          /* Customer Voice Specialist Page */
          <PeptideVoicePage />
        ) : (
          /* Admin Intelligence Pages */
          <div className="flex-1 overflow-y-auto">
            {adminSubTab === 'knowledge' && <PeptideKnowledgeAdmin />}
            {adminSubTab === 'framework' && <EvidenceFrameworkGuide />}
            {adminSubTab === 'hud' && (
              <div className="p-4 sm:p-6 max-w-5xl mx-auto">
                <DiagnosticHUD />
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── FOOTER (When in customer view: Zero admin buttons or links) ── */}
      {!isAdminView && (
        <footer className="border-t border-zinc-900 bg-[#05070a] px-4 py-2.5 flex items-center justify-center text-[10px] sm:text-[11px] font-mono text-zinc-500">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500/80" />
            <span className="hidden sm:inline">5-Tier Evidence Classification & Clinical Safety Guard Active</span>
            <span className="sm:hidden">Evidence Guard Active</span>
          </div>
        </footer>
      )}

    </div>
  );
}

export default App;
