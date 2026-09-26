/**
 * server/peptide/evidenceModel.ts
 * 
 * Structured Evidence Repository & Evidence Hierarchy Engine.
 * Implements strict separation of evidence tiers:
 * - ANECDOTAL REPORTS: Public community/athlete reports, forums, testimonials
 * - PRECLINICAL RESEARCH: Animal & in-vitro laboratory studies
 * - HUMAN / CLINICAL EVIDENCE: Human trials, RCTs, Phase 3 data, regulatory status
 * - EVIDENCE SUMMARY: Concise 4-part synthesis ("What the evidence actually says")
 * 
 * Enforces metadata: peptide, evidence_type, source, source_url, publication_date,
 * population_or_model, claim, finding, limitations, evidence_status, citation.
 */

import { StructuredEvidenceRecord, EvidenceSummaryBlock, EvidenceType } from './types.js';

export interface PeptideEvidenceDossier {
  peptideId: string;
  peptideName: string;
  records: StructuredEvidenceRecord[];
  summary: EvidenceSummaryBlock;
}

const DOSSIERS: Record<string, PeptideEvidenceDossier> = {
  'bpc-157': {
    peptideId: 'bpc-157',
    peptideName: 'BPC-157',
    records: [
      {
        id: 'bpc-anecdotal-1',
        peptide: 'bpc-157',
        peptideName: 'BPC-157',
        evidence_type: 'ANECDOTAL',
        source: 'Bodybuilding communities, online athlete forums, and public self-reports',
        source_url: 'https://www.reddit.com/r/peptides/',
        publication_date: '2018-2026',
        population_or_model: 'Online athletic community self-reports (uncontrolled)',
        claim: 'Cures tendonitis, rotator cuff tears, and severe soft tissue injuries within days to weeks',
        finding: 'Some users report rapid relief from chronic joint pain and accelerated tendonitis healing, often injecting subcutaneously or near injury sites.',
        limitations: 'Individual self-reports are uncontrolled, subject to strong placebo and self-selection bias, and cannot establish clinical efficacy or safety.',
        evidence_status: 'COMMUNITY_REPORT',
        citation: 'Bodybuilding & Fitness Community Discussions (Public self-reported experiences)'
      },
      {
        id: 'bpc-preclinical-1',
        peptide: 'bpc-157',
        peptideName: 'BPC-157',
        evidence_type: 'PRECLINICAL',
        source: 'Journal of Orthopaedic Research (Chang et al.)',
        source_url: 'https://pubmed.ncbi.nlm.nih.gov/21031536/',
        publication_date: '2011',
        population_or_model: 'Sprague-Dawley rat models and in-vitro tendon fibroblasts (tenocytes)',
        claim: 'Accelerates collagen type I synthesis and tendon outgrowth in mechanical transection models',
        finding: 'BPC-157 significantly promoted tendon outgrowth, cell survival, and migration of tendon fibroblasts in vitro and in rat Achilles tendon transections.',
        limitations: 'Laboratory animal and cell models do not establish that the same effect, dosing, or safety profile occurs in humans.',
        evidence_status: 'VERIFIED',
        citation: 'Chang CH, et al. The promoting effect of pentadecapeptide BPC 157 on tendon healing involves tendon outgrowth, cell survival, and cell migration. J Orthop Res. 2011;29(5):674-680.'
      },
      {
        id: 'bpc-preclinical-2',
        peptide: 'bpc-157',
        peptideName: 'BPC-157',
        evidence_type: 'PRECLINICAL',
        source: 'Current Pharmaceutical Design (Sikiric et al.)',
        source_url: 'https://pubmed.ncbi.nlm.nih.gov/20192865/',
        publication_date: '2010',
        population_or_model: 'Rodent models of tissue ischemia and vascular disruption',
        claim: 'Promotes collateral blood vessel formation (angiogenesis) via VEGFR2 activation',
        finding: 'BPC-157 upregulated Vascular Endothelial Growth Factor Receptor 2 (VEGFR2) and activated the early growth response gene-1 (egr-1) pathway in rodent models.',
        limitations: 'Preclinical rodent data cannot be extrapolated to human athletic recovery or clinical healing.',
        evidence_status: 'VERIFIED',
        citation: 'Sikiric P, et al. Stable gastric pentadecapeptide BPC 157-NO-system relation. Curr Pharm Des. 2010;16(10):1224-1234.'
      },
      {
        id: 'bpc-human-1',
        peptide: 'bpc-157',
        peptideName: 'BPC-157',
        evidence_type: 'HUMAN_CLINICAL',
        source: 'ClinicalTrials.gov / European Clinical Trial Registries',
        source_url: 'https://clinicaltrials.gov/',
        publication_date: '2015-2024',
        population_or_model: 'No completed human clinical trials in athletes or musculoskeletal injuries',
        claim: 'Proven treatment for tendon, joint, or athletic injury recovery in humans',
        finding: 'No adequate completed human clinical trials have been published validating BPC-157 for tendonitis, muscle healing, or athletic recovery.',
        limitations: 'Early exploratory safety evaluations conducted in Europe for inflammatory bowel disease lack published Phase 3 randomized controlled trial verification.',
        evidence_status: 'INSUFFICIENT',
        citation: 'Clinical evidence is limited / No completed Phase 3 randomized controlled human trials located for musculoskeletal indications.'
      },
      {
        id: 'bpc-regulatory-1',
        peptide: 'bpc-157',
        peptideName: 'BPC-157',
        evidence_type: 'REGULATORY',
        source: 'WADA Prohibited List & US FDA Category 2 Bulks Evaluation',
        source_url: 'https://www.wada-ama.org/en/prohibited-list',
        publication_date: '2022-2024',
        population_or_model: 'Regulatory and anti-doping bodies',
        claim: 'Approved pharmaceutical substance for human clinical therapy',
        finding: 'BPC-157 is an unapproved research chemical, prohibited at all times in sport under WADA Category S0, and restricted by the FDA from compounding due to safety risks.',
        limitations: 'Not approved by the FDA or EMA for any therapeutic indication.',
        evidence_status: 'REGULATORY_APPROVED',
        citation: 'World Anti-Doping Code Prohibited List (Category S0); FDA Category 2 Bulks Nominations.'
      }
    ],
    summary: {
      anecdotal: 'Some users report rapid relief from chronic joint pain and accelerated tendonitis healing, but these individual reports cannot establish efficacy or safety.',
      preclinical: 'Research in Sprague-Dawley rodent and cell models shows accelerated collagen organization, tenocyte migration, and VEGFR2-mediated angiogenesis.',
      human: 'No adequate human clinical trial evidence located. Controlled Phase 3 trials in human athletic populations have not been conducted.',
      bottomLine: 'The evidence should be interpreted according to the strongest available evidence (preclinical animal data), not the volume of online bodybuilding testimonials.'
    }
  },

  'tb-500': {
    peptideId: 'tb-500',
    peptideName: 'TB-500',
    records: [
      {
        id: 'tb-anecdotal-1',
        peptide: 'tb-500',
        peptideName: 'TB-500',
        evidence_type: 'ANECDOTAL',
        source: 'Bodybuilding communities and athlete self-reports',
        source_url: 'https://www.reddit.com/r/peptides/',
        publication_date: '2019-2026',
        population_or_model: 'Online athletic logs and bodybuilding community discussions',
        claim: 'Provides systemic full-body recovery, tendon repair, and reduced post-workout soreness',
        finding: 'Online reports commonly describe improved flexibility, reduced joint inflammation, and faster bounce-back between heavy training sessions.',
        limitations: 'Uncontrolled anecdotal experiences subject to placebo effect and lack objective clinical validation.',
        evidence_status: 'COMMUNITY_REPORT',
        citation: 'Athletic and Bodybuilding Community Discussions (Uncontrolled self-reports)'
      },
      {
        id: 'tb-preclinical-1',
        peptide: 'tb-500',
        peptideName: 'TB-500',
        evidence_type: 'PRECLINICAL',
        source: 'Annals of the New York Academy of Sciences (Goldstein et al.)',
        source_url: 'https://pubmed.ncbi.nlm.nih.gov/20536465/',
        publication_date: '2010',
        population_or_model: 'Animal wound models and cell culture assays',
        claim: 'Regulates actin sequestration and promotes endothelial cell migration for tissue repair',
        finding: 'Thymosin Beta-4 sequesters G-actin, upregulates laminin-5, and accelerates dermal and myocardial tissue regeneration in animal models.',
        limitations: 'Animal model healing does not demonstrate athletic recovery or musculoskeletal regeneration in healthy humans.',
        evidence_status: 'VERIFIED',
        citation: 'Goldstein AL, et al. Thymosin beta4: actin-sequestering protein and its multifunctional role in tissue repair. Ann N Y Acad Sci. 2010;1194:1-11.'
      },
      {
        id: 'tb-human-1',
        peptide: 'tb-500',
        peptideName: 'TB-500',
        evidence_type: 'HUMAN_CLINICAL',
        source: 'ClinicalTrials.gov',
        source_url: 'https://clinicaltrials.gov/',
        publication_date: '2016-2024',
        population_or_model: 'Human ophthalmic and dermal ulcer trials (Full Thymosin Beta-4)',
        claim: 'Clinically proven systemic recovery peptide for athletic musculoskeletal injuries',
        finding: 'Full-length Thymosin Beta-4 has been studied in human trials for dry eye syndrome and dermal ulcers, but no completed trials exist for TB-500 injections in athletic recovery.',
        limitations: 'No completed human clinical trials evaluate systemic TB-500 fragment administration in healthy or athletic human subjects.',
        evidence_status: 'INSUFFICIENT',
        citation: 'No adequate human clinical trials located for systemic athletic recovery or tendon repair.'
      }
    ],
    summary: {
      anecdotal: 'Athletes commonly report reduced inflammation, improved joint mobility, and accelerated soft tissue recovery in gym forums.',
      preclinical: 'Research in animal and in-vitro models found enhanced actin sequestration, endothelial cell migration, and accelerated wound closure.',
      human: 'No completed human clinical trials have evaluated systemic TB-500 injections for athletic performance or muscle recovery.',
      bottomLine: 'Scientific support is strictly preclinical; community discussions regarding athletic recovery remain unverified anecdotes.'
    }
  },

  'cjc-1295': {
    peptideId: 'cjc-1295',
    peptideName: 'CJC-1295',
    records: [
      {
        id: 'cjc-anecdotal-1',
        peptide: 'cjc-1295',
        peptideName: 'CJC-1295',
        evidence_type: 'ANECDOTAL',
        source: 'Bodybuilding communities and physique coaching logs',
        source_url: 'https://www.reddit.com/r/peptides/',
        publication_date: '2018-2026',
        population_or_model: 'Bodybuilding and physique athlete logs',
        claim: 'Directly burns body fat, adds pure muscle mass, and deepens REM/slow-wave sleep',
        finding: 'Lifters commonly report deeper sleep, enhanced vascularity, improved morning recovery, and mild fat loss, typically stacked with Ipamorelin.',
        limitations: 'Subjective self-assessments with concurrent diet, training, and multiple compound variables.',
        evidence_status: 'COMMUNITY_REPORT',
        citation: 'Physique Community Discussions & Fitness Coaching Forums'
      },
      {
        id: 'cjc-preclinical-1',
        peptide: 'cjc-1295',
        peptideName: 'CJC-1295',
        evidence_type: 'PRECLINICAL',
        source: 'Endocrinology (Castaigne et al.)',
        source_url: 'https://pubmed.ncbi.nlm.nih.gov/16352683/',
        publication_date: '2005',
        population_or_model: 'Mammalian pharmacokinetic rodent models',
        claim: 'Bioconjugates with serum albumin to extend half-life to several days',
        finding: 'Maleimidopropionic acid linker technology enabled irreversible binding to endogenous albumin, significantly prolonging bioactivity and GH secretion in animals.',
        limitations: 'Preclinical bioconjugation kinetics require clinical pharmacokinetic validation.',
        evidence_status: 'VERIFIED',
        citation: 'Castaigne JP, et al. Prolonged half-life and extended growth hormone stimulation by albumin-conjugated GHRH analogs. Endocrinology. 2005.'
      },
      {
        id: 'cjc-human-1',
        peptide: 'cjc-1295',
        peptideName: 'CJC-1295',
        evidence_type: 'HUMAN_CLINICAL',
        source: 'Journal of Clinical Endocrinology & Metabolism (JCEM)',
        source_url: 'https://pubmed.ncbi.nlm.nih.gov/16352683/',
        publication_date: '2006',
        population_or_model: 'Human clinical trial (n=65 healthy adult subjects aged 21-50)',
        claim: 'Elevates endogenous growth hormone and IGF-1 secretion while preserving pulsatility',
        finding: 'A single subcutaneous injection of CJC-1295 produced sustained, dose-dependent 2-to-10 fold increases in GH and 1.5-to-3 fold increases in IGF-1 for 6 to 8 days.',
        limitations: 'Demonstrated endocrine hormone kinetics; did not measure athletic performance, muscle hypertrophy, or body composition in athletes.',
        evidence_status: 'VERIFIED',
        citation: 'Teichman SL, et al. Prolonged stimulation of growth hormone (GH) and insulin-like growth factor I secretion by CJC-1295, a long-acting analog of GH-releasing hormone, in healthy adults. J Clin Endocrinol Metab. 2006;91(3):799-805.'
      }
    ],
    summary: {
      anecdotal: 'Lifters commonly report enhanced sleep depth, recovery, and subtle body recomposition when stacked with GHRPs.',
      preclinical: 'Animal pharmacokinetic studies demonstrated extended plasma half-life via endogenous albumin bioconjugation.',
      human: 'Clinical evidence in healthy human adults confirms prolonged pulsatile GH and IGF-1 elevation without shutting down normal pituitary rhythm.',
      bottomLine: 'Endocrine GH elevation is clinically supported; direct body recomposition and athletic recovery claims rely primarily on community lore.'
    }
  },

  'ipamorelin': {
    peptideId: 'ipamorelin',
    peptideName: 'Ipamorelin',
    records: [
      {
        id: 'ipam-anecdotal-1',
        peptide: 'ipamorelin',
        peptideName: 'Ipamorelin',
        evidence_type: 'ANECDOTAL',
        source: 'Bodybuilding discussion boards and fitness communities',
        source_url: 'https://www.reddit.com/r/peptides/',
        publication_date: '2019-2026',
        population_or_model: 'Physique athletes and fitness enthusiasts',
        claim: 'Builds lean muscle and burns fat without water bloat, gynecomastia, or extreme hunger',
        finding: 'Users describe it as the "cleanest" GHRP, reporting improved skin quality, faster training recovery, and quality sleep without ravenous appetite.',
        limitations: 'Subjective anecdotes without standardized nutritional or training controls.',
        evidence_status: 'COMMUNITY_REPORT',
        citation: 'Bodybuilding & Fitness Community Discussions'
      },
      {
        id: 'ipam-preclinical-1',
        peptide: 'ipamorelin',
        peptideName: 'Ipamorelin',
        evidence_type: 'PRECLINICAL',
        source: 'European Journal of Endocrinology (Raun et al.)',
        source_url: 'https://pubmed.ncbi.nlm.nih.gov/9849822/',
        publication_date: '1998',
        population_or_model: 'In-vitro rat pituitary cell cultures and rodent in-vivo assays',
        claim: 'Highly selective GHRP that does not elevate ACTH, cortisol, or prolactin',
        finding: 'Ipamorelin stimulated GH release with potency comparable to GHRP-6, but with no significant effect on ACTH, cortisol, or prolactin levels in animal models.',
        limitations: 'Cellular receptor selectivity does not establish clinical athletic outcomes.',
        evidence_status: 'VERIFIED',
        citation: 'Raun K, et al. Ipamorelin, the first selective growth hormone secretagogue. Eur J Endocrinol. 1998;139(5):552-561.'
      },
      {
        id: 'ipam-human-1',
        peptide: 'ipamorelin',
        peptideName: 'Ipamorelin',
        evidence_type: 'HUMAN_CLINICAL',
        source: 'Pharmaceutical Research (Gobburu et al.)',
        source_url: 'https://pubmed.ncbi.nlm.nih.gov/10496324/',
        publication_date: '1999',
        population_or_model: 'Human clinical pharmacology study in healthy male volunteers',
        claim: 'Selectively stimulates growth hormone in humans without endocrine stress hormone spikes',
        finding: 'Pharmacodynamic modeling confirmed robust, dose-dependent GH release in healthy human volunteers without clinically significant elevations in cortisol or prolactin.',
        limitations: 'Evaluated acute endocrine release; no clinical trial has evaluated long-term muscle growth or athletic performance.',
        evidence_status: 'VERIFIED',
        citation: 'Gobburu JV, et al. Pharmacokinetic-pharmacodynamic modeling of ipamorelin, a growth hormone releasing peptide, in human volunteers. Pharm Res. 1999;16(9):1412-1416.'
      }
    ],
    summary: {
      anecdotal: 'Physique athletes praise Ipamorelin for clean recovery and sleep support without water retention or uncontrollable hunger.',
      preclinical: 'Extensive in-vitro and animal assays confirmed selective GHS-R1a binding without triggering ACTH or prolactin release.',
      human: 'Clinical pharmacology studies in human volunteers establish potent, selective GH secretion with minimal cortisol elevation.',
      bottomLine: 'Receptor selectivity and endocrine GH release are clinically validated; direct muscle-building claims remain community lore.'
    }
  },

  'tesamorelin': {
    peptideId: 'tesamorelin',
    peptideName: 'Tesamorelin',
    records: [
      {
        id: 'tesa-anecdotal-1',
        peptide: 'tesamorelin',
        peptideName: 'Tesamorelin',
        evidence_type: 'ANECDOTAL',
        source: 'Competitive bodybuilding forums and prep coaching circles',
        source_url: 'https://www.reddit.com/r/peptides/',
        publication_date: '2020-2026',
        population_or_model: 'Competitive bodybuilders and fitness competitors',
        claim: 'Eliminates stubborn lower abdominal fat and tightens the waistline for competition',
        finding: 'Competitors report dramatic reduction in midsection thickness and visceral tightness leading into bodybuilding shows.',
        limitations: 'Anecdotes in physique athletes represent unapproved off-label use; effects fade upon cessation.',
        evidence_status: 'COMMUNITY_REPORT',
        citation: 'Competitive Physique Athlete Discussions'
      },
      {
        id: 'tesa-preclinical-1',
        peptide: 'tesamorelin',
        peptideName: 'Tesamorelin',
        evidence_type: 'PRECLINICAL',
        source: 'Pharmacology and Experimental Therapeutics (Ferdinandi et al.)',
        source_url: 'https://pubmed.ncbi.nlm.nih.gov/17392476/',
        publication_date: '2007',
        population_or_model: 'Preclinical animal and in-vitro adipocyte lipolysis models',
        claim: 'Selectively stimulates GHRH receptors and promotes lipolysis in deep visceral adipocytes',
        finding: 'Hexenoyl modification provided resistance to enzymatic DPP-IV degradation while preserving high affinity for human pituitary GHRH receptors.',
        limitations: 'Enzymatic stability data in animals preceded pivotal human registration trials.',
        evidence_status: 'VERIFIED',
        citation: 'Ferdinandi ES, et al. Preclinical pharmacokinetics of tesamorelin, a stabilized GHRH analog. J Pharmacol Exp Ther. 2007.'
      },
      {
        id: 'tesa-human-1',
        peptide: 'tesamorelin',
        peptideName: 'Tesamorelin',
        evidence_type: 'HUMAN_CLINICAL',
        source: 'New England Journal of Medicine (NEJM) (Falutz et al.)',
        source_url: 'https://pubmed.ncbi.nlm.nih.gov/18057338/',
        publication_date: '2007-2010',
        population_or_model: 'Phase 3 randomized, double-blind, placebo-controlled clinical trials (n=806 human adults)',
        claim: 'Significantly reduces visceral adipose tissue (VAT) while preserving subcutaneous fat',
        finding: 'Tesamorelin produced a statistically significant ~18% reduction in visceral abdominal fat in human patients with HIV-associated lipodystrophy, resulting in FDA approval (Egrifta).',
        limitations: 'Studied in patients with HIV-associated abdominal lipodystrophy; visceral fat re-accumulates if therapy is discontinued.',
        evidence_status: 'VERIFIED',
        citation: 'Falutz J, et al. Effects of tesamorelin, a growth hormone-releasing factor analog, in patients with HIV-associated abdominal fat accumulation. N Engl J Med. 2007;357(23):2359-2370.'
      },
      {
        id: 'tesa-regulatory-1',
        peptide: 'tesamorelin',
        peptideName: 'Tesamorelin',
        evidence_type: 'REGULATORY',
        source: 'US Food and Drug Administration (FDA)',
        source_url: 'https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=022505',
        publication_date: '2010',
        population_or_model: 'FDA Approved Drug (NDA 022505 - Egrifta)',
        claim: 'FDA-approved clinical therapeutic agent',
        finding: 'Approved by the FDA specifically for the reduction of excess abdominal fat in HIV-infected patients with lipodystrophy.',
        limitations: 'Approval is indication-specific; not approved for cosmetic weight loss or athletic enhancement.',
        evidence_status: 'REGULATORY_APPROVED',
        citation: 'FDA Approval Package: Egrifta (tesamorelin for injection). NDA 022505, 2010.'
      }
    ],
    summary: {
      anecdotal: 'Bodybuilders and fitness competitors report targeted reduction in abdominal visceral fullness during contest prep.',
      preclinical: 'Animal studies confirmed resistance to DPP-IV degradation and selective lipolytic signaling in visceral fat deposits.',
      human: 'Level A human clinical evidence (Phase 3 RCTs in NEJM, FDA approval) establishes an ~18% reduction in deep visceral abdominal fat.',
      bottomLine: 'Human clinical evidence definitively proves visceral fat loss in studied cohorts; cosmetic athletic applications remain off-label.'
    }
  },

  'tirzepatide': {
    peptideId: 'tirzepatide',
    peptideName: 'Tirzepatide',
    records: [
      {
        id: 'tirz-anecdotal-1',
        peptide: 'tirzepatide',
        peptideName: 'Tirzepatide',
        evidence_type: 'ANECDOTAL',
        source: 'Bodybuilding cutting logs and fitness communities',
        source_url: 'https://www.reddit.com/r/peptides/',
        publication_date: '2023-2026',
        population_or_model: 'Athletes, bodybuilders, and fitness community members',
        claim: 'Provides effortless contest prep dieting by completely wiping out hunger and cravings',
        finding: 'Lifters report unprecedented appetite suppression and rapid fat loss, but emphasize the necessity of high protein and heavy lifting to avoid lean mass loss.',
        limitations: 'Rapid weight loss can include lean tissue loss without disciplined resistance training and adequate dietary protein.',
        evidence_status: 'COMMUNITY_REPORT',
        citation: 'Bodybuilding & Fitness Cutting Discussions'
      },
      {
        id: 'tirz-preclinical-1',
        peptide: 'tirzepatide',
        peptideName: 'Tirzepatide',
        evidence_type: 'PRECLINICAL',
        source: 'Cell Metabolism (Coskun et al.)',
        source_url: 'https://pubmed.ncbi.nlm.nih.gov/30043758/',
        publication_date: '2018',
        population_or_model: 'Diet-induced obese mouse models and in-vitro receptor assays',
        claim: 'Dual GIP and GLP-1 receptor co-agonism produces synergistic metabolic and fat-loss effects',
        finding: 'Tirzepatide demonstrated balanced dual agonism, driving greater weight loss, improved insulin sensitivity, and lipid clearance than selective GLP-1 agonists alone.',
        limitations: 'Preclinical animal synergies served as the foundation for subsequent human clinical trials.',
        evidence_status: 'VERIFIED',
        citation: 'Coskun T, et al. LY3298176, a novel dual GIP and GLP-1 receptor agonist for the treatment of type 2 diabetes mellitus. Cell Metab. 2018;28(4):534-547.'
      },
      {
        id: 'tirz-human-1',
        peptide: 'tirzepatide',
        peptideName: 'Tirzepatide',
        evidence_type: 'HUMAN_CLINICAL',
        source: 'New England Journal of Medicine (NEJM) (Jastreboff et al. - SURMOUNT-1)',
        source_url: 'https://pubmed.ncbi.nlm.nih.gov/35658024/',
        publication_date: '2022',
        population_or_model: 'Phase 3 randomized, double-blind, placebo-controlled trial (n=2,539 human adults with obesity)',
        claim: 'Produces substantial, clinically proven reductions in human body weight and adiposity',
        finding: 'Tirzepatide demonstrated up to a 20.9% mean body weight reduction (average 52 lbs) over 72 weeks in human adults with obesity.',
        limitations: 'Requires chronic administration; gastrointestinal adverse effects (nausea, constipation) are common.',
        evidence_status: 'VERIFIED',
        citation: 'Jastreboff AM, et al. Tirzepatide Once Weekly for the Treatment of Obesity. N Engl J Med. 2022;387(3):205-216.'
      },
      {
        id: 'tirz-regulatory-1',
        peptide: 'tirzepatide',
        peptideName: 'Tirzepatide',
        evidence_type: 'REGULATORY',
        source: 'US FDA',
        source_url: 'https://www.accessdata.fda.gov/',
        publication_date: '2022-2023',
        population_or_model: 'FDA Approved Drug (Mounjaro for T2D; Zepbound for chronic weight management)',
        claim: 'FDA-approved pharmaceutical peptide for weight management',
        finding: 'Approved by the FDA for glycemic control in T2D and chronic weight management in adults with obesity or overweight with comorbidities.',
        limitations: 'Black box warning for thyroid C-cell tumors in rodents; contraindicated in MEN2.',
        evidence_status: 'REGULATORY_APPROVED',
        citation: 'FDA Approval Packages for Mounjaro (2022) and Zepbound (2023).'
      }
    ],
    summary: {
      anecdotal: 'Athletes describe dramatic appetite suppression and effortless caloric restriction, noting the need to preserve muscle through high protein intake.',
      preclinical: 'Rodent models established synergistic metabolic benefits of dual GIP and GLP-1 receptor activation.',
      human: 'Level A human clinical evidence from large Phase 3 RCTs in the NEJM and FDA approvals establishes up to 20.9% average body weight loss.',
      bottomLine: 'Fat loss is supported by the highest level of human clinical evidence; lifters must maintain resistance training to retain contractile lean mass.'
    }
  },

  'semaglutide': {
    peptideId: 'semaglutide',
    peptideName: 'Semaglutide',
    records: [
      {
        id: 'sema-anecdotal-1',
        peptide: 'semaglutide',
        peptideName: 'Semaglutide',
        evidence_type: 'ANECDOTAL',
        source: 'Bodybuilding communities and fitness forums',
        source_url: 'https://www.reddit.com/r/peptides/',
        publication_date: '2021-2026',
        population_or_model: 'Athletes and fitness community members',
        claim: 'Facilitates extreme contest leanness by eliminating food cravings',
        finding: 'Commonly used in cutting cycles to maintain strict caloric deficits; users caution about nausea and the risk of losing muscle fullness if calories drop too low.',
        limitations: 'Unmonitored aggressive caloric deficits can accelerate skeletal muscle catabolism.',
        evidence_status: 'COMMUNITY_REPORT',
        citation: 'Bodybuilding & Fitness Cutting Discussions'
      },
      {
        id: 'sema-preclinical-1',
        peptide: 'semaglutide',
        peptideName: 'Semaglutide',
        evidence_type: 'PRECLINICAL',
        source: 'Journal of Medicinal Chemistry (Lau et al.)',
        source_url: 'https://pubmed.ncbi.nlm.nih.gov/26372551/',
        publication_date: '2015',
        population_or_model: 'Porcine and rodent animal models',
        claim: 'Albumin-binding fatty acid chain extends half-life to 1 week with potent hypothalamic satiety signaling',
        finding: 'Demonstrated high affinity for the human GLP-1 receptor with enzymatic resistance to DPP-4 and extended half-life across animal species.',
        limitations: 'Preclinical animal pharmacokinetics preceded human STEP registration trials.',
        evidence_status: 'VERIFIED',
        citation: 'Lau J, et al. Discovery of the Once-Weekly Glucagon-Like Peptide-1 (GLP-1) Analogue Semaglutide. J Med Chem. 2015;58(18):7370-7380.'
      },
      {
        id: 'sema-human-1',
        peptide: 'semaglutide',
        peptideName: 'Semaglutide',
        evidence_type: 'HUMAN_CLINICAL',
        source: 'New England Journal of Medicine (NEJM) (Wilding et al. - STEP 1)',
        source_url: 'https://pubmed.ncbi.nlm.nih.gov/33567185/',
        publication_date: '2021',
        population_or_model: 'Phase 3 randomized, double-blind, placebo-controlled trial (n=1,961 human adults)',
        claim: 'Produces clinically proven substantial body weight and adipose reduction',
        finding: 'Semaglutide 2.4 mg once weekly produced a mean 14.9% body weight reduction over 68 weeks in human adults with obesity.',
        limitations: 'Gastrointestinal adverse effects (nausea, vomiting, diarrhea) occur in a substantial percentage of participants.',
        evidence_status: 'VERIFIED',
        citation: 'Wilding JPH, et al. Once-Weekly Semaglutide in Adults with Overweight or Obesity. N Engl J Med. 2021;384(11):989-1002.'
      },
      {
        id: 'sema-regulatory-1',
        peptide: 'semaglutide',
        peptideName: 'Semaglutide',
        evidence_type: 'REGULATORY',
        source: 'US FDA',
        source_url: 'https://www.accessdata.fda.gov/',
        publication_date: '2017-2021',
        population_or_model: 'FDA Approved Drug (Ozempic for T2D; Wegovy for chronic weight management)',
        claim: 'FDA-approved pharmaceutical peptide for weight management and T2D',
        finding: 'Approved by the FDA for glycemic control in T2D, cardiovascular event reduction, and chronic weight management in adults with obesity.',
        limitations: 'Boxed warning for thyroid C-cell tumors in rodent studies; contraindicated with medullary thyroid carcinoma.',
        evidence_status: 'REGULATORY_APPROVED',
        citation: 'FDA Approval Packages for Ozempic (2017) and Wegovy (2021).'
      }
    ],
    summary: {
      anecdotal: 'Lifters report strict appetite suppression enabling easy caloric deficits, with caution regarding potential loss of muscle fullness.',
      preclinical: 'Animal models demonstrated selective hypothalamic satiety receptor activation and delayed gastric transit.',
      human: 'Phase 3 randomized clinical trials in the NEJM and FDA approval establish a mean 14.9% body weight loss in clinical cohorts.',
      bottomLine: 'Fat loss is supported by Level A human clinical evidence; lifters must prioritize adequate protein and strength training to retain muscle mass.'
    }
  },

  'sermorelin': {
    peptideId: 'sermorelin',
    peptideName: 'Sermorelin',
    records: [
      {
        id: 'sermo-anecdotal-1',
        peptide: 'sermorelin',
        peptideName: 'Sermorelin',
        evidence_type: 'ANECDOTAL',
        source: 'Anti-aging clinics and master lifter community forums',
        source_url: 'https://www.reddit.com/r/peptides/',
        publication_date: '2018-2026',
        population_or_model: 'Master lifters and wellness clinic patients',
        claim: 'Restores youthful vitality, improves skin elasticity, and enhances workout recovery',
        finding: 'Users frequently report better recovery from resistance training, deeper sleep, and improved morning joint comfort.',
        limitations: 'Anecdotal testimonials from anti-aging clinic clients lack blinded clinical controls.',
        evidence_status: 'COMMUNITY_REPORT',
        citation: 'Master Lifter & Wellness Community Discussions'
      },
      {
        id: 'sermo-preclinical-1',
        peptide: 'sermorelin',
        peptideName: 'Sermorelin',
        evidence_type: 'PRECLINICAL',
        source: 'Science (Guillemin et al.)',
        source_url: 'https://pubmed.ncbi.nlm.nih.gov/6291151/',
        publication_date: '1982',
        population_or_model: 'Preclinical mammalian pituitary receptor assays',
        claim: 'Contains the complete biological activity of endogenous 44-amino acid GHRH',
        finding: 'The 1-29 amino acid sequence was confirmed to retain full receptor binding affinity and biological potency of native human GHRH in animal models.',
        limitations: 'Preclinical bioequivalence laid the groundwork for subsequent human pediatric and adult trials.',
        evidence_status: 'VERIFIED',
        citation: 'Guillemin R, et al. Growth hormone-releasing factor from a human pancreatic tumor that caused acromegaly. Science. 1982;218(4572):585-587.'
      },
      {
        id: 'sermo-human-1',
        peptide: 'sermorelin',
        peptideName: 'Sermorelin',
        evidence_type: 'HUMAN_CLINICAL',
        source: 'American Journal of Physiology (Corpas et al.)',
        source_url: 'https://pubmed.ncbi.nlm.nih.gov/9082531/',
        publication_date: '1997',
        population_or_model: 'Randomized clinical trial (n=38 healthy older men aged 60-78)',
        claim: 'Stimulates pituitary GH secretion and elevates IGF-1 in human adults',
        finding: 'Nightly sermorelin administration in healthy older men restored nocturnal GH peaks and significantly increased serum IGF-1 levels toward young adult levels.',
        limitations: 'Demonstrated pituitary stimulation; did not demonstrate athletic hypertrophy or sports performance enhancement in healthy younger athletes.',
        evidence_status: 'VERIFIED',
        citation: 'Corpas E, et al. Continuous subcutaneous infusions of GHRH 1-29 stimulate growth hormone secretion in elderly men. Am J Physiol. 1997;272(3 Pt 1):E365-E373.'
      },
      {
        id: 'sermo-regulatory-1',
        peptide: 'sermorelin',
        peptideName: 'Sermorelin',
        evidence_type: 'REGULATORY',
        source: 'US FDA',
        source_url: 'https://www.accessdata.fda.gov/',
        publication_date: '1997',
        population_or_model: 'FDA Approved Drug (Geref - NDA 020443)',
        claim: 'FDA approved for pediatric growth hormone deficiency and pituitary diagnostic testing',
        finding: 'Originally approved by the FDA as Geref for the treatment of idiopathic growth hormone deficiency in children and evaluation of pituitary somatotroph function.',
        limitations: 'Commercial manufacturing discontinued in 2008 for business reasons; widely compounded off-label in wellness and anti-aging medicine.',
        evidence_status: 'REGULATORY_APPROVED',
        citation: 'FDA Approved Drug: Geref (sermorelin acetate). NDA 020443.'
      }
    ],
    summary: {
      anecdotal: 'Master lifters and clinic clients report improved sleep depth, recovery, and joint comfort.',
      preclinical: 'Animal and cell studies confirmed that the 1-29 fragment retains full biological activity of endogenous GHRH.',
      human: 'Clinical trials in human adults establish that nightly administration stimulates pituitary GH release and elevates IGF-1 toward youthful levels.',
      bottomLine: 'Pituitary secretagogue function is clinically proven; claims of significant muscle hypertrophy in healthy young athletes remain anecdotal.'
    }
  },

  'ibutamoren-mk677': {
    peptideId: 'ibutamoren-mk677',
    peptideName: 'MK-677 (Ibutamoren)',
    records: [
      {
        id: 'mk-anecdotal-1',
        peptide: 'mk677',
        peptideName: 'MK-677',
        evidence_type: 'ANECDOTAL',
        source: 'Bodybuilding forums and fitness logs',
        source_url: 'https://www.reddit.com/r/peptides/',
        publication_date: '2017-2026',
        population_or_model: 'Bodybuilders and fitness enthusiasts',
        claim: 'Massive bulking compound that packs on 10 lbs of pure muscle quickly',
        finding: 'Lifters commonly report intense hunger, major fullness/pumps, rapid scale weight gain, and deep sleep, often accompanied by swollen hands and fluid retention.',
        limitations: 'Scale weight increases are heavily driven by intracellular and extracellular water retention rather than contractile muscle fibers.',
        evidence_status: 'COMMUNITY_REPORT',
        citation: 'Bodybuilding Community Bulking Discussions'
      },
      {
        id: 'mk-preclinical-1',
        peptide: 'mk677',
        peptideName: 'MK-677',
        evidence_type: 'PRECLINICAL',
        source: 'Science (Patchett et al.)',
        source_url: 'https://pubmed.ncbi.nlm.nih.gov/7541559/',
        publication_date: '1995',
        population_or_model: 'In-vitro ghrelin receptor assays and rodent bioassays',
        claim: 'Orally active non-peptide mimetic of the endogenous growth hormone secretagogue receptor',
        finding: 'Demonstrated high oral bioavailability and potent, selective binding to the GHS-R1a receptor in animal models without steroid hormone cross-reactivity.',
        limitations: 'Preclinical animal data demonstrated endocrine mechanism, not athletic hypertrophy.',
        evidence_status: 'VERIFIED',
        citation: 'Patchett AA, et al. Design and biological activities of L-163,191 (MK-0677): a potent, orally active growth hormone secretagogue. Proc Natl Acad Sci USA. 1995.'
      },
      {
        id: 'mk-human-1',
        peptide: 'mk677',
        peptideName: 'MK-677',
        evidence_type: 'HUMAN_CLINICAL',
        source: 'Annals of Internal Medicine (Nass et al.)',
        source_url: 'https://pubmed.ncbi.nlm.nih.gov/18981485/',
        publication_date: '2008',
        population_or_model: 'Two-year randomized, double-blind, placebo-controlled clinical trial (n=65 healthy older adults)',
        claim: 'Increases fat-free mass and elevates sustained 24-hour GH and IGF-1 levels',
        finding: 'Daily oral MK-677 sustained elevated GH and IGF-1 levels and increased fat-free mass by an average of 1.1 kg, but this did not result in increased muscle strength and was accompanied by increased fasting blood glucose and transient edema.',
        limitations: 'The increase in fat-free mass was primarily intracellular water and connective tissue hydration rather than contractile myofibrillar hypertrophy.',
        evidence_status: 'VERIFIED',
        citation: 'Nass R, et al. Effects of an oral ghrelin mimetic on body composition and clinical outcomes in healthy older adults. Ann Intern Med. 2008;149(9):601-611.'
      }
    ],
    summary: {
      anecdotal: 'Users commonly report extreme appetite surges, intense gym pumps, and rapid scale weight increases accompanied by water retention.',
      preclinical: 'Laboratory receptor assays confirmed oral bioavailability and high-affinity selective binding to the GHS-R1a receptor.',
      human: 'Human clinical trials confirm sustained oral GH/IGF-1 elevation and an increase in fat-free mass, but this reflects fluid retention rather than contractile muscle hypertrophy.',
      bottomLine: 'Endocrine elevation and water retention are clinically verified; claims of direct steroid-like muscle accretion are false.'
    }
  }
};

/**
 * Get the structured evidence dossier for a given peptide
 */
export function getStructuredEvidenceDossier(peptideId: string): PeptideEvidenceDossier | undefined {
  const normalized = peptideId.toLowerCase().replace(/[^a-z0-9]/g, '-');
  return DOSSIERS[normalized] || DOSSIERS[peptideId];
}

/**
 * Get records by specific evidence type to guarantee strict category isolation
 */
export function getRecordsByEvidenceType(
  peptideId: string, 
  evidenceType: EvidenceType
): StructuredEvidenceRecord[] {
  const dossier = getStructuredEvidenceDossier(peptideId);
  if (!dossier) return [];
  return dossier.records.filter(r => r.evidence_type === evidenceType);
}

/**
 * Get the 4-part concise evidence summary block for a peptide
 */
export function getEvidenceSummaryBlock(peptideId: string): EvidenceSummaryBlock | undefined {
  const dossier = getStructuredEvidenceDossier(peptideId);
  return dossier?.summary;
}

/**
 * Build a structured evidence record dynamically for any peptide
 */
export function buildFallbackEvidenceDossier(peptide: { id: string; name: string; classification: string; mechanism: string }): PeptideEvidenceDossier {
  return {
    peptideId: peptide.id,
    peptideName: peptide.name,
    records: [
      {
        id: `${peptide.id}-anecdotal-fallback`,
        peptide: peptide.id,
        peptideName: peptide.name,
        evidence_type: 'ANECDOTAL',
        source: 'Online bodybuilding forums and community discussions',
        publication_date: '2020-2026',
        population_or_model: 'Online user reports (uncontrolled)',
        claim: `Discussed in fitness communities for potential ${peptide.classification} effects`,
        finding: `Some community members report subjective experiences with ${peptide.name}, though reports are uncontrolled and anecdotal.`,
        limitations: 'These are individual reports, not clinical evidence and not proof of efficacy.',
        evidence_status: 'COMMUNITY_REPORT',
        citation: 'Community discussions and athlete self-reports'
      },
      {
        id: `${peptide.id}-preclinical-fallback`,
        peptide: peptide.id,
        peptideName: peptide.name,
        evidence_type: 'PRECLINICAL',
        source: 'Preclinical scientific literature',
        publication_date: 'Peer-reviewed studies',
        population_or_model: 'Cellular and animal experimental models',
        claim: `Mechanism of action: ${peptide.mechanism}`,
        finding: `Preclinical and laboratory research investigates ${peptide.name} via ${peptide.mechanism}`,
        limitations: 'A result in an animal or laboratory model does not establish that the same effect occurs in humans.',
        evidence_status: 'PRELIMINARY',
        citation: `Preclinical laboratory investigations for ${peptide.name}`
      },
      {
        id: `${peptide.id}-human-fallback`,
        peptide: peptide.id,
        peptideName: peptide.name,
        evidence_type: 'HUMAN_CLINICAL',
        source: 'Clinical trial registries',
        publication_date: 'Current',
        population_or_model: 'Human clinical populations',
        claim: 'Evaluation of human clinical trials',
        finding: `No adequate large-scale completed human clinical trials have established therapeutic efficacy for ${peptide.name} in athletic populations.`,
        limitations: 'Human clinical trials are limited or not located for sports performance.',
        evidence_status: 'INSUFFICIENT',
        citation: 'No adequate completed human clinical trial evidence located'
      }
    ],
    summary: {
      anecdotal: `Users report anecdotal experiences with ${peptide.name} in fitness communities, but individual reports cannot establish effectiveness or safety.`,
      preclinical: `Laboratory research investigates its biochemical mechanism (${peptide.mechanism}), but animal findings do not equal human proof.`,
      human: `No adequate human clinical trials located establishing athletic recovery or performance benefits in humans.`,
      bottomLine: `The evidence should be interpreted according to the strongest available evidence, not the volume of online testimonials.`
    }
  };
}
