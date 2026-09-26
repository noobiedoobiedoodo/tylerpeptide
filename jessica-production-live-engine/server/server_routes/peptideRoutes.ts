/**
 * server/server_routes/peptideRoutes.ts
 * 
 * Express Router exposing the Peptide Knowledge Engine, Evidence Classifier,
 * and Knowledge Administration update mechanisms.
 */

import { Router, Request, Response } from 'express';
import { peptideKnowledgeEngine } from '../peptide/peptideKnowledgeEngine.js';
import { PeptideRecord } from '../peptide/types.js';

export const peptideRouter = Router();

// GET /api/peptides - List all peptides with optional filtering
peptideRouter.get('/', (req: Request, res: Response) => {
  try {
    const { category, search, evidenceLevel } = req.query;
    let list = peptideKnowledgeEngine.getAllPeptides();

    if (category && typeof category === 'string') {
      list = list.filter(p => p.category === category);
    }

    if (search && typeof search === 'string') {
      const q = search.toLowerCase();
      list = list.filter(p => 
        p.name.toLowerCase().includes(q) ||
        p.commonNames.some(a => a.toLowerCase().includes(q)) ||
        p.classification.toLowerCase().includes(q)
      );
    }

    if (evidenceLevel && typeof evidenceLevel === 'string') {
      list = list.filter(p => 
        p.claims.some(c => c.evidenceLevel === evidenceLevel) ||
        p.investigatedUses.some(u => u.evidenceLevel === evidenceLevel)
      );
    }

    return res.json({
      success: true,
      count: list.length,
      peptides: list
    });
  } catch (err: any) {
    console.error('[PeptideAPI] Error listing peptides:', err);
    return res.status(500).json({ error: 'Failed to retrieve peptide list.' });
  }
});

// GET /api/peptides/system-prompt - Retrieve voice system prompt
peptideRouter.get('/system-prompt', (req: Request, res: Response) => {
  try {
    const prompt = peptideKnowledgeEngine.generateVoiceSystemPrompt();
    return res.json({ success: true, systemPrompt: prompt });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to generate system prompt.' });
  }
});

// GET /api/peptides/config - Sales concierge configuration
peptideRouter.get('/config', (req: Request, res: Response) => {
  return res.json({
    success: true,
    whatsappNumber: peptideKnowledgeEngine.getWhatsAppNumber(),
    defaultWhatsAppUrl: peptideKnowledgeEngine.buildWhatsAppUrl(),
    defaultPrefill: peptideKnowledgeEngine.buildWhatsAppPrefill()
  });
});

// GET /api/peptides/:id - Retrieve specific peptide record
peptideRouter.get('/:id', (req: Request, res: Response) => {
  try {
    const peptide = peptideKnowledgeEngine.getPeptideById(req.params.id) ||
                    peptideKnowledgeEngine.findPeptideByName(req.params.id);

    if (!peptide) {
      return res.status(404).json({ error: `Peptide "${req.params.id}" not found.` });
    }

    return res.json({ success: true, peptide });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to retrieve peptide.' });
  }
});

// POST /api/peptides - Create new peptide (Administration mechanism)
peptideRouter.post('/', (req: Request, res: Response) => {
  try {
    const data: Omit<PeptideRecord, 'createdAt' | 'updatedAt'> = req.body;
    if (!data.id || !data.name || !data.category) {
      return res.status(400).json({ error: 'Peptide id, name, and category are required.' });
    }

    const created = peptideKnowledgeEngine.createPeptide(data);
    return res.status(201).json({ success: true, peptide: created });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to create peptide.' });
  }
});

// PUT /api/peptides/:id - Update peptide record (Administration mechanism)
peptideRouter.put('/:id', (req: Request, res: Response) => {
  try {
    const updated = peptideKnowledgeEngine.updatePeptide(req.params.id, req.body);
    return res.json({ success: true, peptide: updated });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to update peptide.' });
  }
});

// DELETE /api/peptides/:id - Delete peptide record (Administration mechanism)
peptideRouter.delete('/:id', (req: Request, res: Response) => {
  try {
    const deleted = peptideKnowledgeEngine.deletePeptide(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: `Peptide "${req.params.id}" not found.` });
    }
    return res.json({ success: true, message: 'Peptide successfully deleted.' });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to delete peptide.' });
  }
});


// GET /api/peptides/:id/evidence - Retrieve structured evidence dossier
peptideRouter.get('/:id/evidence', (req: Request, res: Response) => {
  try {
    const peptide = peptideKnowledgeEngine.getPeptideById(req.params.id) ||
                    peptideKnowledgeEngine.findPeptideByName(req.params.id);
    if (!peptide) {
      return res.status(404).json({ error: `Peptide "${req.params.id}" not found.` });
    }
    const evidence = peptideKnowledgeEngine.getPeptideStructuredEvidence(peptide.id);
    const summary = peptideKnowledgeEngine.getPeptideEvidenceSummary(peptide.id);
    return res.json({
      success: true,
      peptideId: peptide.id,
      peptideName: peptide.name,
      evidence,
      summary
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to retrieve evidence dossier.' });
  }
});

// POST /api/peptides/query - Grounded Q&A and safety evaluation
peptideRouter.post('/query', (req: Request, res: Response) => {
  try {
    const { query, sessionId = 'default' } = req.body;
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query string is required.' });
    }

    const response = peptideKnowledgeEngine.query(query, sessionId);
    return res.json({ success: true, ...response });
  } catch (err: any) {
    console.error('[PeptideAPI] Query error:', err);
    return res.status(500).json({ error: 'Failed to evaluate query.' });
  }
});

// POST /api/peptides/classify - Direct claim evidence classification tester
peptideRouter.post('/classify', (req: Request, res: Response) => {
  try {
    const claim = req.body.claim || req.body.text;
    const peptideId = req.body.peptideId;
    if (!claim || typeof claim !== 'string') {
      return res.status(400).json({ error: 'Claim string is required.' });
    }

    const peptide = peptideId ? peptideKnowledgeEngine.getPeptideById(peptideId) : undefined;
    const classification = peptideKnowledgeEngine.classifyClaim(claim, peptide);
    const safety = peptideKnowledgeEngine.evaluateSafety(claim);

    return res.json({
      success: true,
      classification,
      safety
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to classify claim.' });
  }
});
