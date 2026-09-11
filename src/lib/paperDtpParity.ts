export type PaperDtpPriority = 'highest' | 'high' | 'medium';
export type PaperDtpStatus = 'available' | 'partial' | 'gap' | 'done';

export interface PaperDtpParityFeature {
  id: string;
  feature: string;
  priority: PaperDtpPriority;
  indesign: string;
  signalLoom: string;
  status: PaperDtpStatus;
  comicImpact: string;
  actionTarget?: 'linked-assets' | 'spreads' | 'preflight';
}

export const PAPER_DTP_PARITY_FEATURES: PaperDtpParityFeature[] = [
  {
    id: 'linked-flow-assets',
    feature: 'Linked Flow/Image assets',
    priority: 'highest',
    indesign: 'Links panel, relink, effective PPI, missing-link preflight',
    signalLoom: 'Linked-assets panel with source IDs, missing/embedded/stale/unknown states, selection actions, and effective PPI when metadata exists',
    status: 'available',
    comicImpact: 'Critical for generated panel art staying traceable from Flow/Image into print pages.',
    actionTarget: 'linked-assets',
  },
  {
    id: 'facing-pages',
    feature: 'Facing pages/spreads',
    priority: 'highest',
    indesign: 'Facing-page document view with left/right page semantics',
    signalLoom: 'Facing-page view, start-on-right native commands, gutter labels/guides, and reader-spread HTML export while keeping page PDF/print as default',
    status: 'available',
    comicImpact: 'Essential for checking page turns, reveals, and splash-page rhythm.',
    actionTarget: 'spreads',
  },
  {
    id: 'print-preflight',
    feature: 'Print preflight',
    priority: 'highest',
    indesign: 'Configurable preflight profiles for links, overset text, bleed, color, and resolution',
    signalLoom: 'Profiled preflight for generic PDF, comic print, manga, and webtoon with grouped link/font/color/production/resolution/text/layout checks and export warning gates',
    status: 'available',
    comicImpact: 'Catches the most common comic handoff failures before PDF/export review.',
    actionTarget: 'preflight',
  },
  {
    id: 'color-management',
    feature: 'Color management / output intent',
    priority: 'highest',
    indesign: 'Document CMYK/RGB policies, PDF/X presets, ICC output intents, overprint preview, separations, and ink-limit warnings',
    signalLoom: 'A document swatch library (process CMYK + spot defaults plus saved custom swatches), a numeric CMYK fill editor with total-ink coverage warnings, document-level PDF target, output-intent profile metadata, ink-limit/black/spot policies, package metadata, and honest preflight warnings for the browser PDF proof path (true ICC separations land with PDF/X export)',
    status: 'partial',
    comicImpact: 'Lets letterers build a reusable press palette and dial fills in CMYK, while keeping generated RGB artwork from being mistaken for a certified PDF/X deliverable.',
    actionTarget: 'preflight',
  },
  {
    id: 'master-pages',
    feature: 'Parent/master pages',
    priority: 'high',
    indesign: 'Reusable page furniture, folios, guides, and templates',
    signalLoom: 'Document parent pages, per-page assignment, inherited locked frames/guides, detach override, and render/export inheritance',
    status: 'done',
    comicImpact: 'Speeds repeated credits, folios, recap pages, guides, and publisher marks.',
  },
  {
    id: 'styles',
    feature: 'Paragraph/object styles',
    priority: 'high',
    indesign: 'Named paragraph, character, and object styles',
    signalLoom: 'Named paragraph, character, and object style catalogs with comic dialogue, caption, SFX, panel, caption box, and bubble defaults',
    status: 'done',
    comicImpact: 'Important for consistent captions, dialogue, SFX labels, and editorial pages.',
  },
  {
    id: 'packaging',
    feature: 'Package for print',
    priority: 'medium',
    indesign: 'Collect fonts, links, and report for printer handoff',
    signalLoom: 'Browser-safe Paper package bundle with document JSON, manifest, preflight report, linked asset inventory, font inventory, and color inventory',
    status: 'done',
    comicImpact: 'Provides a practical printer handoff artifact alongside PDF proofs.',
  },
  {
    id: 'multi-column-text',
    feature: 'Multi-column text frames',
    priority: 'high',
    indesign: 'Per-frame column count, gutter, balancing, and column rules',
    signalLoom: 'Per-frame column count and gutter with optional balanced fill and a column-rule divider in the canvas renderer',
    status: 'done',
    comicImpact: 'Supports editorial pages, letters columns, and text-heavy backmatter in comic collections.',
  },
  {
    id: 'text-threading',
    feature: 'Threaded text frames',
    priority: 'high',
    indesign: 'Linked text frames with a continuing story and overset flow ports',
    signalLoom: 'Thread/unthread selected text frames so a head-frame story flows across linked frames and columns, rendered on canvas with per-frame slices and an overset indicator on the last frame',
    status: 'available',
    comicImpact: 'Lets long letters pages, prose backmatter, and recap text flow across columns and pages.',
  },
  {
    id: 'text-wrap',
    feature: 'Text wrap / runaround',
    priority: 'high',
    indesign: 'Wrap text around an object — bounding box, jump object, or its contour (incl. free-form and image shapes) — with a standoff offset',
    signalLoom: 'Per-object text wrap (bounding box, jump-object, or contour from a shape’s vertices/ellipse) with a standoff; the text-flow core narrows each line box to the widest clear band around the obstacle',
    status: 'available',
    comicImpact: 'Flows captions and editorial copy around panels, logos, and free-form art the way letterers expect.',
  },
];

export function getPaperDtpParityPriorities(features = PAPER_DTP_PARITY_FEATURES): PaperDtpParityFeature[] {
  const rank: Record<PaperDtpPriority, number> = { highest: 0, high: 1, medium: 2 };
  return [...features].sort((a, b) => rank[a.priority] - rank[b.priority]);
}
