/**
 * client/src/components/PeptideKnowledgeAdmin.tsx
 * 
 * Basic Peptide Knowledge Administration & Update Mechanism.
 * Enables:
 * - Viewing, searching, and filtering the 20-peptide knowledge base
 * - Adding new peptide knowledge records
 * - Updating existing peptide claims, evidence levels, adverse effects, and citations
 * - Deleting outdated records
 * - Live Evidence Classifier & Grounding Tester
 */

import React, { useState } from 'react';
import { usePeptideStore, PeptideRecord, EvidenceLevel } from '@/store/peptideStore';
import { EvidenceBadge } from './PeptideVoicePage';
import { 
  Database, Search, Plus, Edit2, Trash2, CheckCircle2,
  AlertTriangle, BookOpen, ExternalLink, RefreshCw, X, Check, Activity, Sparkles
} from 'lucide-react';

export function PeptideKnowledgeAdmin() {
  const {
    peptides,
    isLoadingPeptides,
    searchFilter,
    setSearchFilter,
    categoryFilter,
    setCategoryFilter,
    evidenceFilter,
    setEvidenceFilter,
    loadPeptides,
    createPeptide,
    updatePeptide,
    deletePeptide,
    setActivePeptide
  } = usePeptideStore();

  const [selectedPeptide, setSelectedPeptide] = useState<PeptideRecord | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Evidence Classifier Tester State
  const [testClaim, setTestClaim] = useState('');
  const [testResult, setTestResult] = useState<any>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Form State for Create/Edit
  const [formData, setFormData] = useState<Partial<PeptideRecord>>({
    id: '',
    name: '',
    commonNames: [],
    category: 'gh_secretagogues',
    classification: '',
    mechanism: '',
    regulatoryStatus: '',
    clinicalEvidenceSummary: '',
    preclinicalEvidenceSummary: '',
    anecdotalSummary: '',
    contraindications: [],
    unknowns: [],
    investigatedUses: [],
    adverseEffects: [],
    sources: [],
    claims: []
  });

  // Filtered Peptides
  const filteredPeptides = peptides.filter(p => {
    if (categoryFilter && p.category !== categoryFilter) return false;
    if (searchFilter) {
      const q = searchFilter.toLowerCase();
      const matchName = p.name.toLowerCase().includes(q);
      const matchAlias = p.commonNames.some(a => a.toLowerCase().includes(q));
      const matchClass = p.classification.toLowerCase().includes(q);
      if (!matchName && !matchAlias && !matchClass) return false;
    }
    if (evidenceFilter) {
      const hasLevel = p.claims.some(c => c.evidenceLevel === evidenceFilter) ||
                       p.investigatedUses.some(u => u.evidenceLevel === evidenceFilter);
      if (!hasLevel) return false;
    }
    return true;
  });

  const handleOpenEdit = (peptide: PeptideRecord) => {
    setSelectedPeptide(peptide);
    setFormData({ ...peptide });
    setIsEditing(true);
    setIsCreating(false);
  };

  const handleOpenCreate = () => {
    setFormData({
      id: '',
      name: '',
      commonNames: [],
      category: 'healing_repair',
      classification: '',
      mechanism: '',
      regulatoryStatus: 'Investigational / Research Chemical Only',
      clinicalEvidenceSummary: '',
      preclinicalEvidenceSummary: '',
      anecdotalSummary: '',
      contraindications: [],
      unknowns: [],
      investigatedUses: [
        {
          conditionOrGoal: 'Investigated Goal',
          evidenceLevel: 'LEVEL_C',
          status: 'Preclinical Research',
          summary: 'Studied in animal or cellular models.',
          sources: []
        }
      ],
      adverseEffects: [
        {
          effect: 'Injection site redness',
          type: 'established',
          description: 'Localized subcutaneous irritation.',
          evidenceLevel: 'LEVEL_A'
        }
      ],
      sources: [],
      claims: []
    });
    setIsCreating(true);
    setIsEditing(false);
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreating) {
      if (!formData.id || !formData.name) {
        alert('Peptide ID and Name are required.');
        return;
      }
      const success = await createPeptide(formData);
      if (success) {
        setStatusMessage(`Peptide "${formData.name}" created successfully.`);
        setIsCreating(false);
      } else {
        alert('Failed to create peptide. Ensure ID is unique.');
      }
    } else if (isEditing && selectedPeptide) {
      const success = await updatePeptide(selectedPeptide.id, formData);
      if (success) {
        setStatusMessage(`Peptide "${formData.name}" updated successfully.`);
        setIsEditing(false);
      } else {
        alert('Failed to update peptide.');
      }
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (window.confirm(`Are you sure you want to delete "${name}" from the peptide knowledge base?`)) {
      const success = await deletePeptide(id);
      if (success) {
        setStatusMessage(`Peptide "${name}" deleted.`);
      }
    }
  };

  const handleTestClassifier = async () => {
    if (!testClaim.trim()) return;
    setIsTesting(true);
    try {
      const res = await fetch('/api/peptides/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim: testClaim })
      });
      if (res.ok) {
        const data = await res.json();
        setTestResult(data);
      }
    } catch (err) {
      console.error('Classification test failed:', err);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-[#06080d] text-zinc-100 overflow-y-auto">
      
      {/* Admin Header */}
      <div className="p-4 sm:p-6 border-b border-zinc-800/80 bg-zinc-950/70 backdrop-blur-md flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-cyan-400" />
            <h1 className="text-lg sm:text-xl font-bold text-white tracking-tight">
              Peptide Knowledge Administration
            </h1>
            <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 font-mono text-[10px] font-bold border border-cyan-500/30 uppercase">
              Live Engine Store
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Maintain the structured clinical knowledge base, claim-level evidence classifications, and citations.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => loadPeptides()}
            className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white transition-all cursor-pointer"
            title="Reload Knowledge Base"
          >
            <RefreshCw className={`w-4 h-4 ${isLoadingPeptides ? 'animate-spin text-cyan-400' : ''}`} />
          </button>

          <button
            onClick={handleOpenCreate}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-xs sm:text-sm shadow-lg shadow-emerald-600/20 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Peptide</span>
          </button>
        </div>
      </div>

      {statusMessage && (
        <div className="m-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center justify-between font-mono">
          <span>{statusMessage}</span>
          <button onClick={() => setStatusMessage(null)} className="cursor-pointer text-zinc-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Content Layout */}
      <div className="flex-1 p-4 sm:p-6 space-y-6 max-w-7xl mx-auto w-full">
        
        {/* ── INTERACTIVE EVIDENCE CLASSIFIER TESTER ─────────────────────── */}
        <div className="p-4 sm:p-5 rounded-2xl bg-zinc-900/60 border border-zinc-800 shadow-xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              <h2 className="text-xs sm:text-sm font-bold text-white font-mono uppercase tracking-wider">
                Direct Evidence Classifier & Grounding Tester
              </h2>
            </div>
            <span className="text-[10px] font-mono text-zinc-500">
              Evaluates Levels A–E & Emergent Safety Triage
            </span>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={testClaim}
              onChange={(e) => setTestClaim(e.target.value)}
              placeholder="Test any claim (e.g. 'Is BPC-157 proven to heal human torn ligaments?' or 'Can you prescribe Tirzepatide?')"
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500/60 font-mono"
            />
            <button
              onClick={handleTestClassifier}
              disabled={!testClaim.trim() || isTesting}
              className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-mono text-xs font-semibold disabled:opacity-40 transition-all cursor-pointer flex items-center gap-1.5"
            >
              {isTesting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
              <span>Test Claim</span>
            </button>
          </div>

          {testResult && (
            <div className="p-4 rounded-xl bg-black/60 border border-zinc-800/80 text-xs font-mono space-y-2 mt-2 animate-in fade-in duration-200">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-zinc-400">Classification:</span>
                <EvidenceBadge level={testResult.classification?.evidenceLevel} />
                <span className="text-zinc-500">•</span>
                <span className="text-white font-semibold">{testResult.classification?.claimTopic}</span>
              </div>

              <div className="p-2.5 rounded-lg bg-zinc-900/80 border border-zinc-800 text-zinc-300">
                <span className="text-cyan-400 font-bold">Mandatory Voice Phrasing:</span> {testResult.classification?.recommendedLanguage}
              </div>

              {testResult.safety?.hasEmergentSymptoms && (
                <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-500/40 text-rose-300">
                  <span className="font-bold text-rose-200">⚠️ Emergent Safety Trigger:</span> {testResult.safety?.safetyGuidance}
                </div>
              )}

              {testResult.safety?.isPrescribingRequest && (
                <div className="p-2.5 rounded-lg bg-amber-950/40 border border-amber-500/40 text-amber-300">
                  <span className="font-bold text-amber-200">🛑 Prescribing Guardrail:</span> {testResult.safety?.prescribingGuidance}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── FILTER & SEARCH BAR ────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-zinc-900/40 border border-zinc-800/60">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-3" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Search by peptide name, alias, or class..."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-4 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Category Filter */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setCategoryFilter(null)}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all cursor-pointer ${
                categoryFilter === null ? 'bg-cyan-600 text-white font-bold' : 'bg-zinc-900 text-zinc-400 hover:text-white'
              }`}
            >
              All ({peptides.length})
            </button>
            <button
              onClick={() => setCategoryFilter('gh_secretagogues')}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all cursor-pointer ${
                categoryFilter === 'gh_secretagogues' ? 'bg-cyan-600 text-white font-bold' : 'bg-zinc-900 text-zinc-400 hover:text-white'
              }`}
            >
              GHRP / GHRH
            </button>
            <button
              onClick={() => setCategoryFilter('healing_repair')}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all cursor-pointer ${
                categoryFilter === 'healing_repair' ? 'bg-cyan-600 text-white font-bold' : 'bg-zinc-900 text-zinc-400 hover:text-white'
              }`}
            >
              Healing & Repair
            </button>
            <button
              onClick={() => setCategoryFilter('metabolic_fatloss')}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all cursor-pointer ${
                categoryFilter === 'metabolic_fatloss' ? 'bg-cyan-600 text-white font-bold' : 'bg-zinc-900 text-zinc-400 hover:text-white'
              }`}
            >
              Metabolic & Fat-Loss
            </button>
            <button
              onClick={() => setCategoryFilter('advanced_anabolic')}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all cursor-pointer ${
                categoryFilter === 'advanced_anabolic' ? 'bg-cyan-600 text-white font-bold' : 'bg-zinc-900 text-zinc-400 hover:text-white'
              }`}
            >
              Advanced Anabolic
            </button>
          </div>
        </div>

        {/* ── PEPTIDE CATALOG GRID ───────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPeptides.map((peptide) => (
            <div 
              key={peptide.id}
              className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/80 hover:border-zinc-700 transition-all flex flex-col justify-between group shadow-lg"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="font-mono text-[10px] text-cyan-400 px-2 py-0.5 rounded bg-cyan-950/40 border border-cyan-800/40 uppercase font-semibold">
                    {formatCategory(peptide.category)}
                  </span>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold ${
                    peptide.regulatoryStatus.toLowerCase().includes('fda approved')
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                      : 'bg-zinc-800 text-zinc-400'
                  }`}>
                    {peptide.regulatoryStatus.split('.')[0]}
                  </span>
                </div>

                <h3 className="text-base font-bold text-white group-hover:text-cyan-400 transition-colors">
                  {peptide.name}
                </h3>
                <div className="text-xs text-zinc-400 font-mono mt-0.5 line-clamp-1">
                  {peptide.classification}
                </div>

                <p className="text-xs text-zinc-300 mt-2.5 line-clamp-2 leading-relaxed">
                  {peptide.mechanism}
                </p>

                {/* Evidence Badges for investigated uses */}
                <div className="mt-3 flex flex-wrap gap-1">
                  {peptide.investigatedUses.slice(0, 2).map((use, idx) => (
                    <EvidenceBadge key={idx} level={use.evidenceLevel} />
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-4 pt-3 border-t border-zinc-800/60 flex items-center justify-between">
                <button
                  onClick={() => {
                    setActivePeptide(peptide);
                    alert(`Loaded "${peptide.name}" into the Voice Specialist Dossier.`);
                  }}
                  className="text-xs font-mono text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer"
                >
                  <Activity className="w-3.5 h-3.5" /> View in Dossier
                </button>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleOpenEdit(peptide)}
                    className="p-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors cursor-pointer"
                    title="Edit Peptide Record"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(peptide.id, peptide.name)}
                    className="p-1.5 rounded-lg bg-zinc-800/80 hover:bg-rose-900/60 text-zinc-400 hover:text-rose-300 transition-colors cursor-pointer"
                    title="Delete Peptide Record"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

      </div>

      {/* ── CREATE / EDIT MODAL ────────────────────────────────────────── */}
      {(isCreating || isEditing) && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in duration-200">
            {/* Modal Header */}
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/60">
              <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
                <Database className="w-4 h-4 text-cyan-400" />
                {isCreating ? 'Add New Peptide Record' : `Edit Peptide: ${formData.name}`}
              </h3>
              <button 
                onClick={() => { setIsCreating(false); setIsEditing(false); }}
                className="text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Form Body */}
            <form onSubmit={handleSaveForm} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 text-xs font-mono">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-zinc-400 block mb-1">ID (Slug):</label>
                  <input
                    type="text"
                    disabled={isEditing}
                    value={formData.id}
                    onChange={(e) => setFormData({ ...formData, id: e.target.value.toLowerCase() })}
                    placeholder="e.g. bpc-157"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500 disabled:opacity-50"
                    required
                  />
                </div>
                <div>
                  <label className="text-zinc-400 block mb-1">Display Name:</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. BPC-157"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-zinc-400 block mb-1">Category:</label>
                  <select
                    value={formData.category}
                    onChange={(e: any) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500 cursor-pointer"
                  >
                    <option value="gh_secretagogues">GHRH & GH Secretagogues</option>
                    <option value="healing_repair">Healing & Anti-Inflammatory</option>
                    <option value="metabolic_fatloss">Metabolic & Fat-Loss</option>
                    <option value="advanced_anabolic">Advanced Anabolic & Niche</option>
                  </select>
                </div>
                <div>
                  <label className="text-zinc-400 block mb-1">Regulatory Status:</label>
                  <input
                    type="text"
                    value={formData.regulatoryStatus}
                    onChange={(e) => setFormData({ ...formData, regulatoryStatus: e.target.value })}
                    placeholder="e.g. Research Chemical Only / FDA Approved"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-zinc-400 block mb-1">Classification:</label>
                <input
                  type="text"
                  value={formData.classification}
                  onChange={(e) => setFormData({ ...formData, classification: e.target.value })}
                  placeholder="e.g. Synthetic Gastric Pentadecapeptide Fragment"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-zinc-400 block mb-1">Biochemical Mechanism:</label>
                <textarea
                  value={formData.mechanism}
                  onChange={(e) => setFormData({ ...formData, mechanism: e.target.value })}
                  rows={2}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-zinc-400 block mb-1">Clinical Evidence Summary (Level A/B):</label>
                <textarea
                  value={formData.clinicalEvidenceSummary}
                  onChange={(e) => setFormData({ ...formData, clinicalEvidenceSummary: e.target.value })}
                  rows={2}
                  placeholder="Summary of human clinical trials, RCTs, or absence thereof..."
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-zinc-400 block mb-1">Preclinical Evidence Summary (Level C):</label>
                <textarea
                  value={formData.preclinicalEvidenceSummary}
                  onChange={(e) => setFormData({ ...formData, preclinicalEvidenceSummary: e.target.value })}
                  rows={2}
                  placeholder="Animal and cell culture findings..."
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-zinc-400 block mb-1">Anecdotal Claims Summary (Level D):</label>
                <textarea
                  value={formData.anecdotalSummary}
                  onChange={(e) => setFormData({ ...formData, anecdotalSummary: e.target.value })}
                  rows={2}
                  placeholder="Community reports, fitness claims..."
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              {/* Modal Action Buttons */}
              <div className="pt-4 border-t border-zinc-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setIsCreating(false); setIsEditing(false); }}
                  className="px-4 py-2 rounded-xl bg-zinc-900 text-zinc-300 hover:text-white font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold transition-all shadow-md shadow-cyan-600/30 cursor-pointer flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>Save to Knowledge Base</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

function formatCategory(cat: string): string {
  switch (cat) {
    case 'gh_secretagogues': return 'GHRH / GHRP';
    case 'healing_repair': return 'Healing & Repair';
    case 'metabolic_fatloss': return 'Metabolic & Fat-Loss';
    case 'advanced_anabolic': return 'Advanced Anabolic';
    default: return cat;
  }
}
