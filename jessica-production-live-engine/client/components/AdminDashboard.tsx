import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../store/useStore';
import { Lock, Eye, Users, ShieldCheck, Wallet, TrendingUp, Search, Download, LogOut, ChevronDown, ChevronUp, AlertCircle, Building2, User, X, Phone, Mail, MapPin, Trash2, Car, Fingerprint, Shield, Globe, Wifi, Monitor, Cpu, Smartphone } from 'lucide-react';
import { playSound } from '../../lib/sounds';

interface Lead {
  id: string;
  name: string;
  first_name?: string;
  last_name?: string;
  email: string;
  phone: string;
  location?: string;
  employment: string;
  income: string;
  creditScore: string;
  monthlyDebt: string;
  downPayment: string;
  housingStatus: string;
  vehicle: string;
  selectedModel?: string;
  selectedModelYear?: number;
  approvalScore?: number;
  riskTier?: string;
  maxLoan?: number;
  monthlyEstimate?: number;
  tdsr?: number;
  pti?: number;
  status: string;
  outcome_status?: string;
  createdAt: string;
  marketingConsent?: boolean;
  privacyConsent?: boolean;
  source?: string;
  intent_score?: number;
  intent_stage?: string;
  contactability_score?: number;
  qualification_score?: number;
  lead_completeness?: number;
  lead_quality_score?: number;
  buying_commitment?: string;
  next_best_action?: string;
  vehicle_type?: string;
  payment_target?: string;
  budget?: string;
  purchase_timeline?: string;
  urgency?: string;
  financing_needed?: boolean;
  credit_situation?: string;
  monthly_income?: string;
  has_trade?: boolean;
  trade_vehicle?: string;
  pain_points?: string;
  objections?: string;
  active_objection?: string;
  customer_summary?: string;
  sales_brief?: string;
  recommended_next_action?: string;
  forensics_json?: string;
  conversation_id?: string;
}

export const AdminDashboard = ({ onClose }: { onClose: () => void }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'HIGH_INTENT' | 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'APPLICATION' | 'APPROVED' | 'SOLD'>('ALL');
  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'MAIN' | 'SALES_DESK' | 'JARVIS_LIVE'>('ALL');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [forensicsLead, setForensicsLead] = useState<Lead | null>(null);

  // Close contact card modal on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedLead) {
        setSelectedLead(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedLead]);

  // Fetch leads from server (implicitly verifies session cookie)
  const fetchLeads = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/leads', { cache: 'no-store' });

      if (res.status === 401) {
        setIsAuthenticated(false);
        return;
      }

      if (!res.ok) throw new Error('Failed to fetch leads');
      const data = await res.json();
      setLeads(data);
      setIsAuthenticated(true);
    } catch (err) {
      console.error('Error fetching leads:', err);
      setIsAuthenticated(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeads();

    // Check for Google OAuth redirect error query params
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    const emailParam = params.get('email');
    
    if (err) {
      if (err === 'unauthorized_email') {
        setError(`Access Denied: The Google account ${emailParam || ''} is not authorized as an administrator.`);
      } else if (err === 'configuration_error') {
        setError('Configuration Error: Google OAuth is not set up correctly on the server.');
      } else if (err === 'token_exchange_failed' || err === 'userinfo_failed') {
        setError('Authentication Error: Failed to exchange credentials with Google.');
      } else {
        setError('Authentication Failed: Google Sign-In was unsuccessful.');
      }
      
      // Clean up URL query parameters dynamically
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const handleGoogleLogin = () => {
    playSound('selection');
    window.location.href = '/api/auth/google';
  };

  // Log Out / Lock Dashboard
  const handleLogOut = async () => {
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout error:', err);
    }
    setIsAuthenticated(false);
    setLeads([]);
    setSelectedLead(null);
  };

  // Update lead outcome / sales status
  const handleUpdateStatus = async (id: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/leads/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          status: newStatus,
          outcome_status: newStatus 
        })
      });

      if (res.status === 401) {
        setIsAuthenticated(false);
        setLeads([]);
        return;
      }

      if (!res.ok) throw new Error('Failed to update status');
      
      const updatedLead = await res.json();
      setLeads(prevLeads => prevLeads.map(l => l.id === id ? updatedLead : l));
      setSelectedLead(prev => (prev && prev.id === id ? updatedLead : prev));
      playSound('selection');
    } catch (err) {
      console.error('Error updating status:', err);
    }
  };

  // Delete lead record (PIPEDA Compliance right-to-be-forgotten request)
  const handleDeleteLead = async (id: string, name: string) => {
    const confirmed = window.confirm(`[Privacy Compliance] Are you sure you want to permanently delete all collected personal and financial data for: "${name}"?\n\nThis will permanently remove the record from the leads file to satisfy a data deletion request.`);
    if (!confirmed) return;
    
    try {
      const res = await fetch(`/api/leads/${id}`, {
        method: 'DELETE'
      });

      if (res.status === 401) {
        setIsAuthenticated(false);
        setLeads([]);
        return;
      }

      if (!res.ok) throw new Error('Failed to delete lead');
      
      setLeads(prevLeads => prevLeads.filter(l => l.id !== id));
      setSelectedLead(prev => (prev && prev.id === id ? null : prev));
    } catch (err) {
      console.error('Error deleting lead:', err);
      alert('Failed to delete lead. Please try again.');
    }
  };

  // CSV Exporter
  const handleExportCSV = () => {
    if (leads.length === 0) return;
    playSound('selection');

    const headers = [
      'ID', 'Date Created', 'Name', 'Email', 'Phone', 'Location', 'Lead Quality', 'Intent Score', 
      'Intent Stage', 'Target Vehicle', 'Payment Target', 'Timeline', 'Trade Vehicle', 'Sales Brief',
      'Recommended Action', 'Status'
    ];

    const rows = filteredLeads.map(l => {
      return [
        l.id,
        new Date(l.createdAt).toLocaleDateString(),
        `"${(l.name || l.first_name || '').replace(/"/g, '""')}"`,
        l.email || '',
        l.phone || '',
        l.location || '',
        l.lead_quality_score ?? 'N/A',
        l.intent_score ?? 'N/A',
        l.intent_stage || 'N/A',
        `"${(l.vehicle_type || l.selectedModel || l.vehicle || '').replace(/"/g, '""')}"`,
        l.payment_target || l.budget || '',
        `"${(l.purchase_timeline || '').replace(/"/g, '""')}"`,
        `"${(l.trade_vehicle || '').replace(/"/g, '""')}"`,
        `"${(l.sales_brief || l.customer_summary || '').replace(/"/g, '""')}"`,
        l.recommended_next_action || 'CALL_ASAP',
        l.status
      ];
    });

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `your_new_auto_sales_intelligence_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filter and search computation
  const filteredLeads = leads.filter(l => {
    const searchTarget = `${l.name || ''} ${l.first_name || ''} ${l.last_name || ''} ${l.email || ''} ${l.phone || ''} ${l.vehicle || ''} ${l.selectedModel || ''} ${l.vehicle_type || ''} ${l.trade_vehicle || ''} ${l.location || ''}`.toLowerCase();
    const matchesSearch = searchTarget.includes(search.toLowerCase());

    let matchesStatus = true;
    if (statusFilter === 'HIGH_INTENT') {
      matchesStatus = (l.intent_score !== undefined && l.intent_score >= 75) || 
                      l.status === 'HIGH_INTENT' || 
                      l.recommended_next_action === 'CALL_ASAP' ||
                      l.outcome_status === 'CALL_ASAP';
    } else if (statusFilter !== 'ALL') {
      matchesStatus = l.status === statusFilter || l.outcome_status === statusFilter;
    }

    // Normalize source into dashboard filter buckets:
    // MAIN = form submissions (MAIN, AUTO_CAPTURE_ON_RESULT, empty/undefined)
    // SALES_DESK = AI sales desk (AI_SALES_DESK)
    // JARVIS_LIVE = voice leads (JARVIS_LIVE)
    const rawSource = l.source || '';
    const isJarvis = rawSource === 'JARVIS_LIVE';
    const isSalesDesk = rawSource === 'AI_SALES_DESK' || rawSource === 'SALES_DESK';
    const lSource = isJarvis ? 'JARVIS_LIVE' : isSalesDesk ? 'SALES_DESK' : 'MAIN';
    const matchesSource = sourceFilter === 'ALL' || lSource === sourceFilter;

    return matchesSearch && matchesStatus && matchesSource;
  });

  // Calculate HUD Metrics
  const totalLeads = leads.length;
  const highIntentCount = leads.filter(l => (l.intent_score && l.intent_score >= 75) || l.recommended_next_action === 'CALL_ASAP' || l.status === 'HIGH_INTENT').length;
  const preApprovedLeads = leads.filter(l => l.maxLoan && l.maxLoan > 0).length;
  const preApprovalRate = totalLeads > 0 ? Math.round((preApprovedLeads / totalLeads) * 100) : 0;
  const totalCapitalApproved = leads.reduce((sum, l) => sum + (l.maxLoan || 0), 0);
  const avgQualityScore = totalLeads > 0 
    ? Math.round(leads.reduce((sum, l) => sum + (l.lead_quality_score || (l.approvalScore ? Math.round(l.approvalScore * 0.8) : 50)), 0) / totalLeads) 
    : 0;

  // Initial loading check state
  if (isAuthenticated === null) {
    return (
      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-bg-dark text-white gap-3">
        <div className="w-8 h-8 border-2 border-brand-purple/20 border-t-brand-purple rounded-full animate-spin" />
        <span className="text-[10px] uppercase font-mono tracking-widest text-white/30">Securing environment...</span>
      </div>
    );
  }

  // Lock Screen Render
  if (!isAuthenticated) {
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-bg-dark text-white overflow-hidden p-6">
        <div className="fixed inset-0 bg-radial-at-center from-brand-purple/10 to-transparent pointer-none" />
        
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-panel w-full max-w-[420px] p-8 md:p-12 border border-white/10 rounded-3xl relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-brand-purple/10 blur-3xl rounded-full -mr-16 -mt-16" />
          
          <div className="text-center space-y-6">
            <div className="w-16 h-16 bg-brand-purple/10 border border-brand-purple/20 rounded-2xl flex items-center justify-center mx-auto shadow-[0_0_30px_rgba(255,255,255,0.15)]">
              <Lock className="w-6 h-6 text-brand-purple" />
            </div>
            
            <div className="space-y-2">
              <h2 className="text-2xl font-display font-medium tracking-[0.1em] uppercase">Security Portal</h2>
              <p className="text-xs text-white/40 uppercase tracking-widest leading-relaxed">
                Sign in with Google to access the administrative console
              </p>
            </div>

            <div className="space-y-4 pt-2">
              {error && (
                <motion.div 
                  initial={{ opacity: 0, y: -5 }} 
                  animate={{ opacity: 1, y: 0 }}
                  className="text-red-400 text-xs bg-red-950/20 border border-red-900/30 p-4 rounded-xl font-medium tracking-wide flex items-start gap-3"
                >
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-500 animate-pulse" />
                  <span className="text-left font-sans text-[11px] leading-normal uppercase">{error}</span>
                </motion.div>
              )}

              <button
                onClick={handleGoogleLogin}
                className="w-full py-4 bg-white hover:bg-white/95 text-black hover:text-black font-display font-bold uppercase tracking-widest text-xs hover:scale-102 active:scale-98 transition-all rounded-xl cursor-pointer shadow-[0_0_20px_rgba(255,255,255,0.1)] flex items-center justify-center gap-3"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                Sign in with Google
              </button>
            </div>

            <button 
              onClick={onClose}
              className="text-[10px] uppercase tracking-widest text-white/20 hover:text-white/60 transition-colors pt-2 block mx-auto cursor-pointer"
            >
              [ Return to Showroom ]
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // Dashboard Render
  return (
    <div className="absolute inset-0 z-40 bg-bg-dark flex flex-col p-4 sm:p-6 lg:p-8 overflow-hidden text-white font-sans">
      {/* HUD Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div>
          <span className="text-[9px] sm:text-[10px] font-mono tracking-[0.3em] sm:tracking-[0.4em] text-brand-purple uppercase font-bold">
            Console v2.0 // Lead Center
          </span>
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-display font-medium uppercase tracking-tight">
            Underwriting Dashboard
          </h1>
          <div className="flex flex-wrap items-center gap-2 mt-1 text-[8px] sm:text-[9px] tracking-wider uppercase font-mono">
            <span className="text-white/30">Custodian: 17421745 Canada Ltd.</span>
            <span className="text-white/10">•</span>
            <span className="text-brand-cyan/80">Secure & Confidential Data Mode</span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <button 
            onClick={handleExportCSV}
            disabled={leads.length === 0}
            className="px-3.5 sm:px-5 py-2 sm:py-2.5 border border-white/10 hover:border-brand-purple/40 hover:bg-white/5 text-white/80 hover:text-white text-[10px] sm:text-xs font-mono uppercase tracking-wider rounded-xl transition-all flex items-center gap-2 cursor-pointer disabled:opacity-30 disabled:pointer-events-none"
          >
            <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Export CSV
          </button>
          <button 
            onClick={handleLogOut}
            className="px-3.5 sm:px-5 py-2 sm:py-2.5 bg-red-950/20 hover:bg-red-950/60 border border-red-900/30 hover:border-red-500/50 text-red-400 text-[10px] sm:text-xs font-mono uppercase tracking-wider rounded-xl transition-all flex items-center gap-2 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Lock
          </button>
          <button 
            onClick={onClose}
            className="w-8 h-8 sm:w-10 sm:h-10 border border-white/10 hover:border-white/30 rounded-xl flex items-center justify-center hover:bg-white/5 transition-all cursor-pointer"
            title="Return to Showroom"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      {/* Metrics HUD Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4 mb-4 sm:mb-6">
        {[
          { label: 'Total Prospects', val: totalLeads, desc: 'captured', icon: <Users className="w-4 h-4 text-brand-purple" /> },
          { label: '🔥 High-Intent Buyers', val: highIntentCount, desc: 'actionable leads', icon: <ShieldCheck className="w-4 h-4 text-amber-400" /> },
          { label: 'Avg Lead Quality', val: `${avgQualityScore}/100`, desc: 'composite score', icon: <TrendingUp className="w-4 h-4 text-brand-cyan" /> },
          { label: 'Pre-Approved Capital', val: `$${(totalCapitalApproved / 1000).toFixed(0)}k`, desc: 'locked limits', icon: <Wallet className="w-4 h-4 text-green-400" /> }
        ].map((m, i) => (
          <div key={i} className="glass-panel p-3.5 sm:p-4 lg:p-5 rounded-2xl border-white/5 relative overflow-hidden flex flex-col justify-between">
            <div className="absolute top-0 right-0 p-2 sm:p-3 opacity-20">{m.icon}</div>
            <div>
              <p className="text-[8px] sm:text-[9px] uppercase tracking-widest text-white/30 font-bold mb-1">{m.label}</p>
              <h3 className="text-xl sm:text-2xl lg:text-3xl font-display font-medium tracking-tight text-white">{m.val}</h3>
            </div>
            <p className="text-[7px] sm:text-[8px] uppercase tracking-wider text-white/15 mt-1.5 sm:mt-2 font-mono">{m.desc}</p>
          </div>
        ))}
      </div>

      {/* Toolbar / Filters */}
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-4 sm:mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 sm:left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 sm:w-4 sm:h-4 text-white/20" />
          <input
            type="text"
            placeholder="Search leads by name, email, phone, vehicle, or trade..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white/5 border border-white/5 pl-10 sm:pl-11 pr-4 py-2.5 sm:py-3 rounded-xl focus:outline-hidden focus:border-brand-purple transition-all text-xs sm:text-sm placeholder:text-white/20 text-white/80"
          />
        </div>
        
        <div className="flex gap-2 overflow-x-auto pb-1 sm:pb-0 items-center">
          <div className="flex bg-white/5 p-1 rounded-xl">
            {(['ALL', 'MAIN', 'SALES_DESK', 'JARVIS_LIVE'] as const).map(src => (
              <button
                key={src}
                onClick={() => { setSourceFilter(src); playSound('selection'); }}
                className={`px-2.5 sm:px-3 py-1.5 sm:py-2 text-[9px] sm:text-[10px] font-mono uppercase tracking-wider sm:tracking-widest rounded-lg transition-all ${
                  sourceFilter === src 
                    ? (src === 'JARVIS_LIVE' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-sm' : 'bg-white/10 text-brand-cyan shadow-sm')
                    : 'text-white/40 hover:text-white/80'
                }`}
              >
                {src === 'JARVIS_LIVE' ? '🎙️ JESSICA LIVE' : src.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Status Workflow Tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-4 sm:mb-5">
        {(['ALL', 'HIGH_INTENT', 'NEW', 'CONTACTED', 'QUALIFIED', 'APPLICATION', 'APPROVED', 'SOLD'] as const).map(f => (
          <button
            key={f}
            onClick={() => {
              setStatusFilter(f);
              playSound('selection');
            }}
            className={`px-3 sm:px-4 py-2 sm:py-2.5 text-[10px] sm:text-xs font-mono uppercase tracking-wider rounded-xl transition-all border cursor-pointer whitespace-nowrap ${
              statusFilter === f 
                ? (f === 'HIGH_INTENT' ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.3)]' : 'bg-brand-purple border-brand-purple text-white shadow-[0_0_15px_rgba(255,255,255,0.3)]')
                : 'bg-white/5 border-white/5 text-white/40 hover:border-white/10 hover:text-white/60'
            }`}
          >
            {f === 'HIGH_INTENT' ? '🔥 HIGH INTENT (CALL ASAP)' : f}
          </button>
        ))}
      </div>

      {/* Leads CRM Table / Cards */}
      <div className="flex-1 overflow-y-auto custom-scrollbar glass-panel rounded-2xl border-white/5 p-4 relative">
        {loading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <div className="w-8 h-8 border-2 border-brand-purple/20 border-t-brand-purple rounded-full animate-spin" />
            <span className="text-[10px] uppercase font-mono tracking-widest text-white/30">Loading database...</span>
          </div>
        ) : filteredLeads.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 gap-2">
            <AlertCircle className="w-8 h-8 text-white/10" />
            <p className="text-sm font-medium text-white/40">No matching leads found</p>
            <p className="text-xs text-white/20 uppercase tracking-widest">Adjust filters or search parameters</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Table Header Labels */}
            <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-2 text-[9px] uppercase tracking-widest text-white/30 font-bold font-mono">
              <div className="col-span-4">Buyer & Contact</div>
              <div className="col-span-2">Quality & Intent</div>
              <div className="col-span-2">Vehicle Need</div>
              <div className="col-span-2">Payment / Budget</div>
              <div className="col-span-2 text-right">Recommended Action</div>
            </div>

            {/* Leads List */}
            {filteredLeads.map(l => {
              const isSelected = selectedLead?.id === l.id;
              const isHighIntent = (l.intent_score !== undefined && l.intent_score >= 75) || 
                                   l.recommended_next_action === 'CALL_ASAP' || 
                                   l.status === 'HIGH_INTENT';
              const leadQuality = l.lead_quality_score || (l.approvalScore ? Math.round(l.approvalScore * 0.8) : 60);

              return (
                <div 
                  key={l.id} 
                  onClick={() => {
                    setSelectedLead(l);
                    playSound('selection');
                  }}
                  className={`border transition-all duration-200 rounded-xl overflow-hidden cursor-pointer ${
                    isHighIntent 
                      ? 'border-amber-500/30 bg-amber-500/[0.03] shadow-[0_0_15px_rgba(245,158,11,0.05)] hover:border-amber-500/50 hover:bg-amber-500/[0.06]' 
                      : isSelected 
                        ? 'border-brand-purple/40 bg-brand-purple/[0.04]' 
                        : 'border-white/5 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05]'
                  }`}
                >
                  {/* Summary Grid Item */}
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4 px-4 py-4 items-center text-sm">
                    {/* Buyer & Contact */}
                    <div className="col-span-1 md:col-span-4 flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${
                        isHighIntent ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-white/5 border border-white/10 text-white/60'
                      }`}>
                        {isHighIntent ? '🔥' : <User className="w-4 h-4 text-white/40" />}
                      </div>
                      <div className="truncate flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-white/90">{l.first_name || l.name || 'Prospect'}</p>
                          {l.source === 'JARVIS_LIVE' && (
                            <span className="px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-widest bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 rounded-sm">
                              🎙️ JESSICA LIVE
                            </span>
                          )}
                          {isHighIntent && (
                            <span className="px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-widest bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-sm">
                              High Intent
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-white/40 truncate font-mono">
                          {l.phone || l.email || 'Contact Pending'} {l.location ? `• ${l.location}` : ''}
                        </p>
                      </div>
                    </div>

                    {/* Quality & Intent Scores */}
                    <div className="col-span-1 md:col-span-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md ${
                          leadQuality >= 80 ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                          leadQuality >= 60 ? 'bg-brand-cyan/20 text-brand-cyan border border-brand-cyan/30' :
                          'bg-white/10 text-white/60'
                        }`}>
                          Quality {leadQuality}/100
                        </span>
                        {l.intent_score !== undefined && (
                          <span className="text-[9px] font-mono text-white/40">
                            Intent {l.intent_score}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Vehicle Need */}
                    <div className="col-span-1 md:col-span-2 font-mono text-xs text-white/80">
                      <p className="font-semibold text-white/90 truncate">{l.vehicle_type || l.selectedModel || l.vehicle || 'Vehicle'}</p>
                      {l.trade_vehicle && (
                        <p className="text-[9px] text-brand-cyan truncate">Trade: {l.trade_vehicle}</p>
                      )}
                    </div>

                    {/* Payment / Budget */}
                    <div className="col-span-1 md:col-span-2 font-mono text-xs text-white/80">
                      <p className="font-bold text-white/95">
                        {l.payment_target ? `$${l.payment_target}/mo` : (l.maxLoan ? `$${l.maxLoan.toLocaleString()} Approved` : (l.income ? `$${l.income}/mo inc.` : 'Flexible'))}
                      </p>
                      {l.purchase_timeline && (
                        <p className="text-[9px] text-white/40 truncate">{l.purchase_timeline}</p>
                      )}
                    </div>

                    {/* Recommended Next Action & Status */}
                    <div className="col-span-1 md:col-span-2 flex items-center justify-between md:justify-end gap-2.5">
                      {l.phone && isHighIntent ? (
                        <a
                          href={`tel:${l.phone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-[10px] font-mono font-bold uppercase tracking-wider rounded-lg shadow-[0_0_10px_rgba(220,38,38,0.4)] flex items-center gap-1.5 transition-all"
                        >
                          📞 CALL ASAP
                        </a>
                      ) : (
                        <span className={`text-[9px] uppercase font-mono tracking-wider px-2.5 py-1 rounded-lg border font-bold ${
                          l.status === 'HIGH_INTENT' || l.status === 'NEW' ? 'border-brand-cyan/20 bg-brand-cyan/5 text-brand-cyan' :
                          l.status === 'CONTACTED' ? 'border-yellow-500/20 bg-yellow-500/5 text-yellow-400' :
                          l.status === 'QUALIFIED' || l.status === 'APPLICATION' ? 'border-brand-purple/20 bg-brand-purple/5 text-brand-purple' :
                          'border-green-500/20 bg-green-500/5 text-green-400'
                        }`}>
                          {l.outcome_status || l.status}
                        </span>
                      )}
                      <div className="flex items-center gap-1 text-white/40 hover:text-white transition-colors" title="View Full Contact Card">
                        <Eye className="w-4 h-4" />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Centered Modal Contact Card Popup */}
      <AnimatePresence>
        {selectedLead && (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md"
            onClick={() => setSelectedLead(null)}
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-4xl max-h-[92vh] bg-[#0c0d14] border border-white/15 rounded-2xl shadow-[0_25px_80px_rgba(0,0,0,0.9)] flex flex-col overflow-hidden text-white"
            >
              {/* Modal Top Header */}
              <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between gap-4 bg-white/[0.03]">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center font-bold text-base shrink-0 ${
                    ((selectedLead.intent_score !== undefined && selectedLead.intent_score >= 75) || selectedLead.status === 'HIGH_INTENT')
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-[0_0_15px_rgba(245,158,11,0.2)]'
                      : 'bg-white/5 border border-white/10 text-white/70'
                  }`}>
                    {((selectedLead.intent_score !== undefined && selectedLead.intent_score >= 75) || selectedLead.status === 'HIGH_INTENT') ? '🔥' : <User className="w-5 h-5 text-white/70" />}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-xl font-bold font-display tracking-tight text-white truncate">
                        {selectedLead.name || selectedLead.first_name || 'Prospect'}
                      </h2>
                      {selectedLead.source === 'JARVIS_LIVE' && (
                        <span className="px-2 py-0.5 text-[9px] font-mono uppercase tracking-widest bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 rounded-sm font-bold">
                          🎙️ JESSICA LIVE
                        </span>
                      )}
                      {((selectedLead.intent_score !== undefined && selectedLead.intent_score >= 75) || selectedLead.status === 'HIGH_INTENT') && (
                        <span className="px-2 py-0.5 text-[9px] font-mono uppercase tracking-widest bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-sm font-bold">
                          🔥 High Intent
                        </span>
                      )}
                      <span className="text-[10px] font-mono text-white/40">
                        Captured: {new Date(selectedLead.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-xs text-white/50 font-mono flex items-center gap-2 mt-0.5">
                      <span>{selectedLead.location || 'Location Not Specified'}</span>
                      {selectedLead.source && <span>• Source: {selectedLead.source === 'JARVIS_LIVE' ? 'Jessica Voice Concierge' : selectedLead.source}</span>}
                    </p>
                  </div>
                </div>

                {/* Header Actions */}
                <div className="flex items-center gap-2.5 shrink-0">
                  {selectedLead.phone && (
                    <a
                      href={`tel:${selectedLead.phone}`}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-mono font-bold text-xs rounded-xl shadow-[0_0_15px_rgba(16,185,129,0.3)] flex items-center gap-2 transition-all"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>CALL {selectedLead.phone}</span>
                    </a>
                  )}
                  <button
                    onClick={() => {
                      setForensicsLead(selectedLead);
                      playSound('selection');
                    }}
                    className="px-3 py-2 bg-violet-600/30 hover:bg-violet-500/40 border border-violet-500/40 text-violet-200 font-mono font-bold text-xs rounded-xl flex items-center gap-2 transition-all cursor-pointer"
                    title="View Device Forensics & Security Intel"
                  >
                    <Fingerprint className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Forensics</span>
                  </button>
                  <button
                    onClick={() => {
                      setSelectedLead(null);
                      playSound('selection');
                    }}
                    className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-all border border-white/5 hover:border-white/20 cursor-pointer"
                    title="Close (Esc)"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Scrollable Modal Content */}
              <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar flex-1">
                {/* Executive Sales Brief for Stephan */}
                {(selectedLead.sales_brief || selectedLead.customer_summary) && (
                  <div className="p-4 rounded-xl bg-emerald-950/25 border border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.06)]">
                    <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                      <h4 className="text-[11px] font-mono uppercase tracking-widest text-emerald-400 font-bold flex items-center gap-2">
                        <span>📋 Executive Sales Brief for Stephan</span>
                      </h4>
                      {selectedLead.buying_commitment && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          Commitment: {selectedLead.buying_commitment}
                        </span>
                      )}
                    </div>
                    <p className="text-white/95 text-sm font-sans whitespace-pre-wrap leading-relaxed">
                      {selectedLead.sales_brief || selectedLead.customer_summary}
                    </p>
                  </div>
                )}

                {/* 3-Column Contact Card Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Col 1: Contact & Buyer Context */}
                  <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 space-y-3 font-mono text-xs">
                    <h4 className="text-[10px] font-mono uppercase tracking-widest text-brand-purple font-bold flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-brand-purple" />
                      Buyer Profile
                    </h4>
                    
                    <div>
                      <p className="text-white/30 uppercase text-[9px]">Full Name</p>
                      <p className="text-white/90 font-semibold text-sm">{selectedLead.name || selectedLead.first_name || 'Prospect'}</p>
                    </div>

                    <div>
                      <p className="text-white/30 uppercase text-[9px]">Phone Number</p>
                      {selectedLead.phone ? (
                        <a href={`tel:${selectedLead.phone}`} className="text-amber-300 font-bold hover:underline flex items-center gap-1.5 mt-0.5">
                          <Phone className="w-3 h-3 shrink-0" />
                          <span>{selectedLead.phone}</span>
                          <span className="text-[9px] text-amber-300/70 font-normal">(Click to Call)</span>
                        </a>
                      ) : (
                        <p className="text-white/30">Phone not provided yet</p>
                      )}
                    </div>

                    <div>
                      <p className="text-white/30 uppercase text-[9px]">Email Address</p>
                      {selectedLead.email ? (
                        <a href={`mailto:${selectedLead.email}`} className="text-brand-cyan hover:underline flex items-center gap-1.5 mt-0.5 truncate">
                          <Mail className="w-3 h-3 shrink-0" />
                          <span className="truncate">{selectedLead.email}</span>
                        </a>
                      ) : (
                        <p className="text-white/30">Email not provided yet</p>
                      )}
                    </div>

                    <div>
                      <p className="text-white/30 uppercase text-[9px]">Location</p>
                      <div className="flex items-center gap-1.5 text-white/80 mt-0.5">
                        <MapPin className="w-3 h-3 text-white/40 shrink-0" />
                        <span>{selectedLead.location || 'Not Specified'}</span>
                      </div>
                    </div>

                    {(selectedLead.income || selectedLead.employment) && (
                      <div className="pt-2 border-t border-white/5">
                        <p className="text-white/30 uppercase text-[9px]">Income & Employment</p>
                        <p className="text-white/80 mt-0.5">
                          {selectedLead.income ? `$${selectedLead.income}/mo` : ''} {selectedLead.employment ? `• ${selectedLead.employment}` : ''}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Col 2: Deal & Vehicle Terms */}
                  <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 space-y-3 font-mono text-xs">
                    <h4 className="text-[10px] font-mono uppercase tracking-widest text-brand-purple font-bold flex items-center gap-1.5">
                      <Car className="w-3.5 h-3.5 text-brand-purple" />
                      Deal Parameters
                    </h4>

                    <div>
                      <p className="text-white/30 uppercase text-[9px]">Target Vehicle</p>
                      <p className="text-white/90 font-bold text-sm mt-0.5">
                        {selectedLead.vehicle_type || selectedLead.selectedModel || selectedLead.vehicle || 'Not Specified'}
                      </p>
                    </div>

                    <div>
                      <p className="text-white/30 uppercase text-[9px]">Payment Budget</p>
                      <p className="text-white/90 font-bold text-sm mt-0.5 text-brand-cyan">
                        {selectedLead.payment_target ? `$${selectedLead.payment_target}/mo` : (selectedLead.budget ? `$${selectedLead.budget}` : (selectedLead.income ? `$${selectedLead.income}/mo Income` : 'Flexible'))}
                      </p>
                    </div>

                    <div>
                      <p className="text-white/30 uppercase text-[9px]">Purchase Timeline</p>
                      <p className="text-white/80 mt-0.5">{selectedLead.purchase_timeline || 'Standard Timeline'}</p>
                    </div>

                    <div>
                      <p className="text-white/30 uppercase text-[9px]">Trade-In Vehicle</p>
                      <p className="text-emerald-300 font-semibold mt-0.5">
                        {selectedLead.trade_vehicle || (selectedLead.has_trade ? 'Yes (Details Pending)' : 'No Trade')}
                      </p>
                    </div>

                    {(selectedLead.downPayment || selectedLead.creditScore || selectedLead.credit_situation) && (
                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/5">
                        {selectedLead.downPayment && (
                          <div>
                            <p className="text-white/30 uppercase text-[9px]">Down Payment</p>
                            <p className="text-white/80">${selectedLead.downPayment}</p>
                          </div>
                        )}
                        {(selectedLead.creditScore || selectedLead.credit_situation) && (
                          <div>
                            <p className="text-white/30 uppercase text-[9px]">Credit</p>
                            <p className="text-white/80">{selectedLead.creditScore || selectedLead.credit_situation}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {selectedLead.pain_points && (
                      <div className="pt-2 border-t border-white/5">
                        <p className="text-white/30 uppercase text-[9px]">Primary Motivation / Pain Point</p>
                        <p className="text-white/70 font-sans text-xs italic mt-0.5">"{selectedLead.pain_points}"</p>
                      </div>
                    )}
                  </div>

                  {/* Col 3: Intelligence & Outcome Workflow */}
                  <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 space-y-4 font-mono text-xs">
                    <h4 className="text-[10px] font-mono uppercase tracking-widest text-brand-purple font-bold flex items-center gap-1.5">
                      <TrendingUp className="w-3.5 h-3.5 text-brand-purple" />
                      Sales Desk Feedback Loop
                    </h4>
                    
                    <div className="p-3 bg-black/40 rounded-lg border border-white/5 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-white/40 text-[9px] uppercase">Lead Quality</span>
                        <span className="text-emerald-400 font-bold">{selectedLead.lead_quality_score ?? (selectedLead.approvalScore ? Math.round(selectedLead.approvalScore * 0.8) : 60)}/100</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-white/40 text-[9px] uppercase">Intent Score</span>
                        <span className="text-amber-300 font-bold">{selectedLead.intent_score ?? 'N/A'}/100</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-white/40 text-[9px] uppercase">Contactability</span>
                        <span className="text-brand-cyan font-bold">{selectedLead.contactability_score ?? 'N/A'}/100</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-white/40 text-[9px] uppercase">Qualification</span>
                        <span className="text-green-400 font-bold">{selectedLead.qualification_score ?? 'N/A'}/100</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-white/40 text-[9px] uppercase">Completeness</span>
                        <span className="text-white/80 font-bold">{selectedLead.lead_completeness ?? 'N/A'}%</span>
                      </div>
                    </div>

                    {/* Workflow Outcome Dropdown */}
                    <div>
                      <p className="text-white/30 uppercase text-[9px] mb-1.5 font-bold">Advance Deal Outcome (Feedback Loop)</p>
                      <select 
                        value={selectedLead.outcome_status || selectedLead.status}
                        onChange={(e) => handleUpdateStatus(selectedLead.id, e.target.value)}
                        className="w-full bg-white/5 border border-white/10 p-2.5 rounded-lg text-white font-mono text-xs focus:outline-hidden focus:border-brand-purple cursor-pointer"
                      >
                        <option value="CALL_ASAP" className="bg-bg-dark text-amber-300">🔥 CALL ASAP</option>
                        <option value="NEW" className="bg-bg-dark text-white">NEW</option>
                        <option value="CONTACTED" className="bg-bg-dark text-white">CONTACTED</option>
                        <option value="QUALIFIED" className="bg-bg-dark text-white">QUALIFIED</option>
                        <option value="APPLICATION" className="bg-bg-dark text-white">APPLICATION</option>
                        <option value="APPROVED" className="bg-bg-dark text-white">APPROVED</option>
                        <option value="SOLD" className="bg-bg-dark text-green-400">🎉 SOLD</option>
                        <option value="LOST" className="bg-bg-dark text-red-400">LOST</option>
                      </select>
                    </div>

                    {/* Delete Action */}
                    <div className="pt-1">
                      <button
                        onClick={() => handleDeleteLead(selectedLead.id, selectedLead.name || selectedLead.first_name || 'Prospect')}
                        className="w-full py-2 bg-red-950/20 hover:bg-red-950/60 border border-red-900/30 hover:border-red-500/50 text-red-400 text-xs font-mono uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete Lead Record
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-3 border-t border-white/10 bg-black/40 flex items-center justify-between text-xs font-mono text-white/40">
                <span>Lead ID: {selectedLead.id}</span>
                <button
                  onClick={() => {
                    setSelectedLead(null);
                    playSound('selection');
                  }}
                  className="px-3.5 py-1.5 bg-white/5 hover:bg-white/10 text-white/80 hover:text-white rounded-lg transition-all border border-white/10 text-[11px] cursor-pointer"
                >
                  Close (Esc)
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ═══════════════════════════════════════════════════════════════════════════
           DEVICE FORENSICS & SECURITY INTEL POPUP
           ═══════════════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {forensicsLead && (() => {
          let f: any = null;
          try {
            f = forensicsLead.forensics_json ? JSON.parse(forensicsLead.forensics_json) : null;
          } catch { f = null; }

          const server = f?.server || {};
          const geo = server?.geo || {};
          const network = server?.network || {};
          const vpnRisk = network?.vpnRisk || 'UNKNOWN';
          const vpnColor = vpnRisk === 'LOW' ? 'text-emerald-400' : vpnRisk === 'MEDIUM' ? 'text-amber-400' : vpnRisk === 'HIGH' ? 'text-red-400' : 'text-white/40';
          const vpnBg = vpnRisk === 'LOW' ? 'bg-emerald-950/40 border-emerald-500/30' : vpnRisk === 'MEDIUM' ? 'bg-amber-950/40 border-amber-500/30' : vpnRisk === 'HIGH' ? 'bg-red-950/40 border-red-500/30' : 'bg-white/5 border-white/10';
          const vpnLabel = vpnRisk === 'LOW' ? '🟢 Clean Residential' : vpnRisk === 'MEDIUM' ? '🟡 Suspicious' : vpnRisk === 'HIGH' ? '🔴 VPN / Proxy Detected' : '⚪ Not Analyzed';

          // Jessica conversation log location
          const isJessica = forensicsLead.source === 'JARVIS_LIVE';
          const convId = forensicsLead.conversation_id;

          const Row = ({ label, value, icon }: { label: string; value: string | number | null | undefined; icon?: React.ReactNode }) => (
            <div className="flex items-start justify-between gap-2 py-1.5 border-b border-white/5 last:border-0">
              <span className="text-white/40 text-[9px] uppercase tracking-wider shrink-0 flex items-center gap-1.5">{icon}{label}</span>
              <span className="text-white/90 text-[11px] font-mono text-right break-all">{value || '—'}</span>
            </div>
          );

          return (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-lg"
              onClick={() => setForensicsLead(null)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.92, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.92, y: 20 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                onClick={(e) => e.stopPropagation()}
                className="relative w-full max-w-3xl max-h-[90vh] bg-[#080510] border border-violet-500/30 rounded-2xl shadow-[0_25px_80px_rgba(124,58,237,0.3)] flex flex-col overflow-hidden text-white"
              >
                {/* Header */}
                <div className="px-5 py-3.5 border-b border-violet-500/20 flex items-center justify-between bg-violet-950/20 shrink-0">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-violet-500/20 border border-violet-500/40 flex items-center justify-center">
                      <Fingerprint className="w-4.5 h-4.5 text-violet-300" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold font-display tracking-tight text-white">Device Forensics & Security Intel</h3>
                      <p className="text-[10px] font-mono text-white/40">
                        {forensicsLead.name || forensicsLead.first_name || 'Prospect'} • {forensicsLead.id}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setForensicsLead(null)}
                    className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-all cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Scrollable Content */}
                <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar flex-1">
                  {!f ? (
                    <div className="text-center py-12">
                      <Shield className="w-12 h-12 text-white/10 mx-auto mb-3" />
                      <p className="text-white/40 text-sm">No forensic data collected for this lead yet.</p>
                      <p className="text-white/20 text-xs mt-1">Forensics are captured when the visitor interacts with Jessica or submits a lead form.</p>
                    </div>
                  ) : (
                    <>
                      {/* VPN Risk Banner */}
                      <div className={`p-3.5 rounded-xl border ${vpnBg} flex items-center justify-between`}>
                        <div className="flex items-center gap-2.5">
                          <Shield className={`w-5 h-5 ${vpnColor}`} />
                          <div>
                            <p className={`text-sm font-bold ${vpnColor}`}>{vpnLabel}</p>
                            {network.vpnSignals && network.vpnSignals.length > 0 && (
                              <p className="text-[10px] text-white/40 mt-0.5 font-mono">{network.vpnSignals.join(' • ')}</p>
                            )}
                          </div>
                        </div>
                        <span className="text-[9px] font-mono text-white/30 uppercase">Risk Level: {vpnRisk}</span>
                      </div>

                      {/* 3-Column Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Col 1: Network & Location */}
                        <div className="bg-white/[0.02] border border-white/5 rounded-xl p-3.5 space-y-0.5">
                          <h4 className="text-[10px] font-mono uppercase tracking-widest text-violet-400 font-bold flex items-center gap-1.5 mb-2">
                            <Globe className="w-3.5 h-3.5 text-violet-400" />
                            Network & Location
                          </h4>
                          <Row label="IP Address" value={server.ip} icon={<Wifi className="w-2.5 h-2.5" />} />
                          <Row label="City" value={geo.city} />
                          <Row label="Province / Region" value={geo.region} />
                          <Row label="Country" value={geo.country} />
                          <Row label="Postal Code" value={geo.postalCode} />
                          {geo.latitude && geo.longitude && (
                            <Row label="Coordinates" value={`${geo.latitude}, ${geo.longitude}`} />
                          )}
                          <Row label="Proxy Hops" value={network.forwardedHops} />
                          <Row label="Connection" value={f.connectionType} />
                          {f.connectionDownlink && <Row label="Downlink" value={`${f.connectionDownlink} Mbps`} />}
                          {f.connectionRtt && <Row label="RTT" value={`${f.connectionRtt}ms`} />}
                        </div>

                        {/* Col 2: Device & Hardware */}
                        <div className="bg-white/[0.02] border border-white/5 rounded-xl p-3.5 space-y-0.5">
                          <h4 className="text-[10px] font-mono uppercase tracking-widest text-violet-400 font-bold flex items-center gap-1.5 mb-2">
                            <Monitor className="w-3.5 h-3.5 text-violet-400" />
                            Device & Hardware
                          </h4>
                          <Row label="Platform" value={f.platform} icon={<Cpu className="w-2.5 h-2.5" />} />
                          <Row label="CPU Cores" value={f.cpuCores} />
                          <Row label="RAM" value={f.deviceMemoryGB ? `${f.deviceMemoryGB} GB` : null} />
                          <Row label="GPU" value={f.gpuRenderer} />
                          <Row label="GPU Vendor" value={f.gpuVendor} />
                          <Row label="Screen" value={f.screenWidth ? `${f.screenWidth}×${f.screenHeight}` : null} />
                          <Row label="Pixel Ratio" value={f.screenPixelRatio ? `${f.screenPixelRatio}x` : null} />
                          <Row label="Color Depth" value={f.screenColorDepth ? `${f.screenColorDepth}-bit` : null} />
                          <Row label="Touch Points" value={f.maxTouchPoints} icon={<Smartphone className="w-2.5 h-2.5" />} />
                          {f.batteryLevel !== null && f.batteryLevel !== undefined && (
                            <Row label="Battery" value={`${Math.round(f.batteryLevel * 100)}%${f.batteryCharging ? ' ⚡ Charging' : ''}`} />
                          )}
                        </div>

                        {/* Col 3: Browser & Identity */}
                        <div className="bg-white/[0.02] border border-white/5 rounded-xl p-3.5 space-y-0.5">
                          <h4 className="text-[10px] font-mono uppercase tracking-widest text-violet-400 font-bold flex items-center gap-1.5 mb-2">
                            <Fingerprint className="w-3.5 h-3.5 text-violet-400" />
                            Browser & Identity
                          </h4>
                          <Row label="Device ID" value={f.deviceId} />
                          <Row label="Session ID" value={f.sessionId} />
                          <Row label="Browser" value={f.vendor} />
                          <Row label="Language" value={f.language} />
                          <Row label="Timezone" value={f.timezone} />
                          <Row label="TZ Offset" value={f.timezoneOffset !== undefined ? `UTC${f.timezoneOffset > 0 ? '-' : '+'}${Math.abs(f.timezoneOffset / 60)}` : null} />
                          <Row label="Locale" value={f.locale} />
                          <Row label="Cookies" value={f.cookiesEnabled ? '✅ Enabled' : '❌ Disabled'} />
                          <Row label="Do Not Track" value={f.doNotTrack ? '🔒 Yes' : '— No'} />
                          <Row label="Incognito" value={f.isIncognito === true ? '🕶️ Yes' : f.isIncognito === false ? '— No' : null} />
                          <Row label="Ad Blocker" value={f.adBlockDetected === true ? '🛡️ Active' : f.adBlockDetected === false ? '— None' : null} />
                          <Row label="Mic/Cam Count" value={f.mediaDevicesCount} />
                        </div>
                      </div>

                      {/* Fingerprint Hashes */}
                      {(f.canvasHash || f.audioHash) && (
                        <div className="bg-white/[0.02] border border-white/5 rounded-xl p-3.5">
                          <h4 className="text-[10px] font-mono uppercase tracking-widest text-violet-400 font-bold mb-2">
                            🔐 Device Fingerprint Hashes
                          </h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] font-mono">
                            {f.canvasHash && (
                              <div className="bg-black/40 rounded-lg p-2 border border-white/5">
                                <span className="text-white/30 uppercase text-[8px]">Canvas 2D Hash</span>
                                <p className="text-white/70 break-all mt-0.5">{f.canvasHash}</p>
                              </div>
                            )}
                            {f.audioHash && (
                              <div className="bg-black/40 rounded-lg p-2 border border-white/5">
                                <span className="text-white/30 uppercase text-[8px]">Audio Fingerprint</span>
                                <p className="text-white/70 break-all mt-0.5">{f.audioHash}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Traffic Source */}
                      {(f.referrer || f.utmSource || f.landingUrl) && (
                        <div className="bg-white/[0.02] border border-white/5 rounded-xl p-3.5">
                          <h4 className="text-[10px] font-mono uppercase tracking-widest text-violet-400 font-bold mb-2">
                            📊 Traffic Source
                          </h4>
                          <div className="space-y-0.5">
                            <Row label="Referrer" value={f.referrer || 'Direct'} />
                            <Row label="Landing URL" value={f.landingUrl} />
                            {f.utmSource && <Row label="UTM Source" value={f.utmSource} />}
                            {f.utmMedium && <Row label="UTM Medium" value={f.utmMedium} />}
                            {f.utmCampaign && <Row label="UTM Campaign" value={f.utmCampaign} />}
                          </div>
                        </div>
                      )}

                      {/* Jessica Conversation Log Reference */}
                      {isJessica && (
                        <div className="bg-cyan-950/20 border border-cyan-500/25 rounded-xl p-3.5">
                          <h4 className="text-[10px] font-mono uppercase tracking-widest text-cyan-400 font-bold flex items-center gap-1.5 mb-2">
                            🎙️ Jessica Voice Conversation Log
                          </h4>
                          <div className="space-y-2 text-xs font-mono">
                            {convId && (
                              <div>
                                <span className="text-white/30 text-[9px] uppercase">Conversation ID</span>
                                <p className="text-cyan-300 font-bold break-all">{convId}</p>
                              </div>
                            )}
                            <div className="bg-black/40 rounded-lg p-3 border border-cyan-500/15 space-y-1.5">
                              <p className="text-white/50 text-[10px] uppercase font-bold tracking-wider">How to Find the Full Transcript:</p>
                              <div className="text-white/70 text-[10px] leading-relaxed space-y-1">
                                <p>1. Open <span className="text-cyan-300">Vercel Dashboard</span> → Deployments → Runtime Logs</p>
                                <p>2. Search for: <span className="text-amber-300 bg-amber-950/30 px-1.5 py-0.5 rounded">[JARVIS_CRM_SYNC_STARTED]</span></p>
                                {convId && (
                                  <p>3. Filter by conversation ID: <span className="text-cyan-300 bg-cyan-950/30 px-1.5 py-0.5 rounded break-all">{convId}</span></p>
                                )}
                                <p className="text-white/40 mt-1">Related log tags: <span className="text-white/50">[JARVIS_LEAD_UPSERTED]</span>, <span className="text-white/50">[JARVIS_TRANSCRIPT_EXTRACTION]</span>, <span className="text-white/50">[JARVIS_CRM_SYNC_SUCCESS]</span></p>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* User Agent (Full) */}
                      {(f.userAgent || network.userAgentServer) && (
                        <div className="bg-white/[0.02] border border-white/5 rounded-xl p-3.5">
                          <h4 className="text-[10px] font-mono uppercase tracking-widest text-white/30 font-bold mb-1.5">Full User Agent</h4>
                          <p className="text-[9px] font-mono text-white/50 break-all leading-relaxed">{f.userAgent || network.userAgentServer}</p>
                        </div>
                      )}

                      {/* Collection Timestamp */}
                      <div className="text-center text-[9px] font-mono text-white/20 pt-1">
                        Forensics collected: {f.collectedAt ? new Date(f.collectedAt).toLocaleString() : 'N/A'} • Server timestamp: {server.serverTimestamp ? new Date(server.serverTimestamp).toLocaleString() : 'N/A'}
                      </div>
                    </>
                  )}
                </div>

                {/* Footer */}
                <div className="px-5 py-2.5 border-t border-violet-500/15 bg-black/40 flex items-center justify-between text-[10px] font-mono text-white/30">
                  <span>🔒 PIPEDA Compliant — Fraud Prevention & Identity Verification</span>
                  <button
                    onClick={() => setForensicsLead(null)}
                    className="px-3 py-1 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white rounded-lg transition-all border border-white/10 cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
};
