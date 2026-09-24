/**
 * A small SYNTHETIC corpus, so `npm run demo` works with no database, no embeddings and no
 * network beyond the model call.
 *
 * Every document here is invented for demonstration. The ids are `DEMO-*` and the findings are
 * not scientific claims — do not quote them. A package whose purpose is citation integrity has
 * no business shipping plausible-looking fake PMIDs. Point `InMemoryCorpus` at the real corpus,
 * or implement `RetrievalPort` against the existing RAG service, before reading anything into
 * the output.
 */

export type DemoDocument = { documentId: string; title: string; year: string; sections: Array<{ name: string; text: string }> }

export const DEMO_DOCUMENTS: DemoDocument[] = [
  {
    documentId: 'DEMO-0001',
    title: 'CRBN neosubstrate recruitment determines degrader potency across cell lineages',
    year: '2025',
    sections: [
      { name: 'Results', text: 'Cereblon-directed degraders showed a 40-fold range in DC50 across 28 lineages despite uniform target expression. Potency tracked with baseline CRBN protein abundance rather than with target abundance, and lineages in the lowest CRBN quartile required sustained exposure to reach 50% degradation.' },
      { name: 'Discussion', text: 'These data argue that E3 ligase abundance, not target abundance, is the primary determinant of degrader potency in this panel. Selecting an E3 partner expressed in the intended tissue may matter more than optimising target affinity.' },
    ],
  },
  {
    documentId: 'DEMO-0002',
    title: 'Acquired CRBN loss-of-function underlies resistance to molecular glue degraders',
    year: '2025',
    sections: [
      { name: 'Results', text: 'In 14 of 19 resistant clones derived by continuous degrader exposure, resistance was explained by frameshift or splice-site mutations in CRBN. Resistant clones remained fully sensitive to a VHL-recruiting degrader of the same target, and re-expression of wild-type CRBN restored sensitivity.' },
      { name: 'Discussion', text: 'Resistance in this system is ligase-specific rather than target-specific. Cross-resistance was not observed between CRBN- and VHL-recruiting degraders, which suggests sequential or combined use of degraders recruiting different ligases as a mitigation strategy.' },
    ],
  },
  {
    documentId: 'DEMO-0003',
    title: 'VHL-recruiting PROTACs retain activity in cereblon-null backgrounds',
    year: '2024',
    sections: [
      { name: 'Results', text: 'VHL-recruiting PROTACs degraded the target to below 10% of baseline in CRBN-knockout lines. Degradation kinetics were slower than with the cereblon-recruiting comparator, with maximal degradation at 12 hours rather than 4 hours.' },
      { name: 'Discussion', text: 'Slower kinetics did not translate into reduced antiproliferative effect over 72 hours, suggesting that the duration of target suppression rather than the rate of onset governs the phenotype in this model.' },
    ],
  },
  {
    documentId: 'DEMO-0004',
    title: 'Proteasome subunit upregulation is a ligase-independent route to degrader escape',
    year: '2026',
    sections: [
      { name: 'Results', text: 'A subset of resistant clones retained intact CRBN but upregulated PSMD and PSMA subunits by two- to three-fold. These clones showed reduced ternary complex half-life measured by NanoBRET, and resistance was partially reversed by low-dose proteasome inhibition.' },
      { name: 'Discussion', text: 'Ligase-independent resistance mechanisms complicate the strategy of switching E3 partners, since they would be expected to confer cross-resistance across degraders regardless of the ligase recruited.' },
    ],
  },
  {
    documentId: 'DEMO-0005',
    title: 'Ternary complex half-life predicts degradation efficiency better than binary affinity',
    year: '2024',
    sections: [
      { name: 'Results', text: 'Across a 62-compound series, binary target affinity correlated poorly with cellular degradation (r = 0.21), whereas ternary complex half-life measured by surface plasmon resonance correlated strongly (r = 0.78).' },
      { name: 'Methods', text: 'Ternary complex half-life was measured at 25 degrees Celsius with immobilised E3 ligase and a fixed target concentration, and cellular degradation was quantified by HiBiT tagging at six hours.' },
    ],
  },
  {
    documentId: 'DEMO-0006',
    title: 'KRAS G12D degraders achieve deeper suppression than occupancy-based inhibitors',
    year: '2025',
    sections: [
      { name: 'Results', text: 'A KRAS G12D-directed degrader reduced total KRAS protein by 85% and suppressed phospho-ERK for over 48 hours after washout. The matched occupancy-based inhibitor suppressed phospho-ERK for under 8 hours after washout at equivalent exposure.' },
      { name: 'Discussion', text: 'The durability difference after washout is consistent with degradation removing the protein rather than blocking it, requiring resynthesis before signalling can recover.' },
    ],
  },
  {
    documentId: 'DEMO-0007',
    title: 'Adaptive RTK feedback limits single-agent KRAS degrader response in vivo',
    year: '2026',
    sections: [
      { name: 'Results', text: 'Tumours treated with a KRAS degrader showed upregulation of EGFR and HER3 phosphorylation within 72 hours. Combination with an EGFR inhibitor extended median time to progression from 21 to 48 days in the same model.' },
      { name: 'Discussion', text: 'Adaptive receptor tyrosine kinase feedback appears to limit single-agent activity even where target suppression is near complete, which argues for upfront combination rather than sequential use.' },
    ],
  },
  {
    documentId: 'DEMO-0008',
    title: 'Plasma proteomic signature of on-target degradation in a first-in-human study',
    year: '2026',
    sections: [
      { name: 'Results', text: 'A three-protein plasma signature separated patients achieving greater than 70% tumour target degradation from those below that threshold, with an area under the curve of 0.84 in a 41-patient cohort.' },
      { name: 'Limitations', text: 'The cohort was single-arm and the signature has not been validated in an independent population. Tumour degradation was assessed in only 41 of 96 enrolled patients, who were those with accessible paired biopsies.' },
    ],
  },
  {
    documentId: 'DEMO-0009',
    title: 'Intermittent dosing preserves degrader sensitivity in long-term culture',
    year: '2025',
    sections: [
      { name: 'Results', text: 'Continuous exposure produced resistant outgrowth by week 6 in 8 of 10 replicates. A four-days-on, three-days-off schedule at the same weekly dose delayed outgrowth beyond week 16 in 9 of 10 replicates.' },
      { name: 'Discussion', text: 'Schedule, not cumulative dose, governed the emergence of resistance in this system. Whether the effect reflects reduced selective pressure or recovery of ligase expression between cycles was not established.' },
    ],
  },
  {
    documentId: 'DEMO-0010',
    title: 'Degrader-antibody conjugates restrict cereblon engagement to antigen-positive cells',
    year: '2026',
    sections: [
      { name: 'Results', text: 'Conjugating a cereblon-recruiting degrader to an antigen-targeting antibody reduced degradation in antigen-negative bystander cells by more than 30-fold while preserving potency in antigen-positive cells.' },
      { name: 'Discussion', text: 'Restricting delivery rather than re-engineering ligase selectivity offers a route to tissue-selective degradation, at the cost of the oral bioavailability that small-molecule degraders offer.' },
    ],
  },
  {
    documentId: 'DEMO-0011',
    title: 'Single-cell profiling reveals a pre-existing low-CRBN subpopulation before treatment',
    year: '2025',
    sections: [
      { name: 'Results', text: 'Single-cell RNA sequencing of untreated tumours identified a subpopulation of 0.3 to 2.1% of cells with CRBN expression below the assay detection limit. This subpopulation was enriched 40-fold in post-progression biopsies.' },
      { name: 'Discussion', text: 'Resistance in these tumours appears to involve selection of a pre-existing state rather than acquisition of new mutations, which would predict a shorter time to progression in tumours with a larger baseline subpopulation.' },
    ],
  },
  {
    documentId: 'DEMO-0012',
    title: 'E3 ligase expression atlas across normal and malignant tissue',
    year: '2024',
    sections: [
      { name: 'Results', text: 'Of 612 annotated E3 ligases, 44 showed tumour-enriched expression with at least four-fold higher median expression in tumour than in matched normal tissue. Only 9 of those 44 have a reported small-molecule handle.' },
      { name: 'Discussion', text: 'The gap between ligases with attractive expression profiles and ligases with tractable chemistry is the principal constraint on expanding beyond cereblon and VHL.' },
    ],
  },
  {
    documentId: 'DEMO-0013',
    title: 'Hook effect at high degrader concentration is attenuated by intracellular sequestration',
    year: '2024',
    sections: [
      { name: 'Results', text: 'Degradation efficiency declined above 1 micromolar in biochemical assays but not in cells, where efficiency plateaued rather than declined. Measured free intracellular concentration remained below 200 nanomolar at all doses tested.' },
      { name: 'Methods', text: 'Free intracellular concentration was estimated by equilibrium dialysis of cell lysate, which does not distinguish cytosolic from lysosomal compartments.' },
    ],
  },
  {
    documentId: 'DEMO-0014',
    title: 'RNA-targeting degraders extend the modality beyond ligandable proteins',
    year: '2026',
    sections: [
      { name: 'Results', text: 'Bifunctional molecules recruiting RNase L to a structured viral RNA element reduced transcript abundance by 70% without detectable off-target transcript loss in a 12,000-transcript panel.' },
      { name: 'Discussion', text: 'Extending induced-proximity pharmacology to RNA addresses targets with no protein binding pocket, though the delivery and stability constraints differ substantially from those of protein degraders.' },
    ],
  },
  {
    documentId: 'DEMO-0015',
    title: 'Neosubstrate off-target degradation drives dose-limiting toxicity',
    year: '2025',
    sections: [
      { name: 'Results', text: 'Global proteomics identified degradation of three zinc-finger transcription factors alongside the intended target. Two of the three were subsequently linked to the observed haematological toxicity in a genetic rescue experiment.' },
      { name: 'Discussion', text: 'Off-target neosubstrate degradation is a property of the molecular glue surface rather than of the target-binding element, so it must be screened for directly rather than predicted from target selectivity.' },
    ],
  },
  {
    documentId: 'DEMO-0016',
    title: 'Baseline CRBN transcript level predicts depth of response in a retrospective cohort',
    year: '2026',
    sections: [
      { name: 'Results', text: 'In a retrospective cohort of 208 patients, baseline CRBN transcript level in the upper tertile was associated with a higher rate of deep response, 54% versus 23% in the lower tertile.' },
      { name: 'Limitations', text: 'The association is retrospective and unadjusted for prior lines of therapy, which differed between tertiles. No causal claim is supported by these data.' },
    ],
  },
]
