// ICC profile catalog for Sloom Studio's print color management (docs/notes/835).
//
// Three tiers (owner's design):
//   1. BUNDLED  — redistribution-cleared CMYK output profiles shipped in `public/icc/` (every profile
//                 embeds "free of known copyright restrictions"). Available to everyone, offline.
//   2. SYSTEM   — profiles already installed on the host OS (Linux/macOS/Windows standard ICC dirs),
//                 enumerated by the Electron main process; lets anyone with Adobe/OS profiles use them.
//   3. CUSTOM   — a user-supplied `.icc` the user points at (their printer's exact condition).
//
// This module is pure metadata + path helpers (no fs, no wasm) so it is safe in the browser and tests.

export type IccProfileRegion = 'us' | 'europe' | 'japan' | 'newsprint' | 'generic';
export type IccProfileSource = 'bundled' | 'system' | 'custom';
export type IccPaperStock = 'coated' | 'uncoated' | 'web-coated' | 'newsprint' | 'special';

export interface IccProfileRef {
  id: string;
  /** Human label for the picker. */
  displayName: string;
  source: IccProfileSource;
  region: IccProfileRegion;
  stock: IccPaperStock;
  /** Bundled: the static app URL to fetch the bytes from (`/icc/<file>`). */
  url?: string;
  /** System/custom: absolute filesystem path (read by the main process or a file input). */
  path?: string;
  /** Short description of the press condition. */
  description: string;
  /** Exact condition identifier written into the managed record and PDF output intent. */
  outputConditionId?: string;
  /** Registry associated with the characterization data, when published. */
  registryName?: string;
  /** License/provenance identifier retained in the managed record. */
  licenseId?: string;
}

/** The redistribution-cleared CMYK profiles bundled in `public/icc/` (see public/icc/README.md). */
export const BUNDLED_CMYK_PROFILES: readonly IccProfileRef[] = [
  { id: 'gracol-tr006', displayName: 'US GRACoL 2006 (coated)', source: 'bundled', region: 'us', stock: 'coated', url: '/icc/GRACoL_TR006_coated.icc', description: 'US commercial sheetfed, coated stock (GRACoL / CGATS TR006).', outputConditionId: 'CGATS TR 006' },
  { id: 'swop-tr003', displayName: 'US SWOP grade 3 (coated web)', source: 'bundled', region: 'us', stock: 'web-coated', url: '/icc/SWOP_TR003_coated_3.icc', description: 'US publication web offset, #3 coated (SWOP TR003).', outputConditionId: 'CGATS TR 003' },
  { id: 'swop-tr005', displayName: 'US SWOP grade 5 (coated web)', source: 'bundled', region: 'us', stock: 'web-coated', url: '/icc/SWOP_TR005_coated_5.icc', description: 'US publication web offset, #5 coated (SWOP TR005).', outputConditionId: 'CGATS TR 005' },
  { id: 'fogra39', displayName: 'ISO Coated v2 / FOGRA39 (coated)', source: 'bundled', region: 'europe', stock: 'coated', url: '/icc/FOGRA39L_coated.icc', description: 'European coated offset, the common ISO Coated v2 condition (FOGRA39).', outputConditionId: 'FOGRA39' },
  { id: 'fogra27', displayName: 'FOGRA27 (coated)', source: 'bundled', region: 'europe', stock: 'coated', url: '/icc/FOGRA27L_coated.icc', description: 'Older European coated offset (FOGRA27).', outputConditionId: 'FOGRA27' },
  { id: 'fogra28', displayName: 'FOGRA28 (web coated)', source: 'bundled', region: 'europe', stock: 'web-coated', url: '/icc/FOGRA28L_webcoated.icc', description: 'European web offset, coated (FOGRA28).', outputConditionId: 'FOGRA28' },
  { id: 'fogra29', displayName: 'FOGRA29 (uncoated)', source: 'bundled', region: 'europe', stock: 'uncoated', url: '/icc/FOGRA29L_uncoated.icc', description: 'European uncoated offset (FOGRA29).', outputConditionId: 'FOGRA29' },
  { id: 'fogra47', displayName: 'FOGRA47 (uncoated)', source: 'bundled', region: 'europe', stock: 'uncoated', url: '/icc/FOGRA47L_uncoated.icc', description: 'European uncoated offset, newer (FOGRA47 / PSO Uncoated).', outputConditionId: 'FOGRA47' },
  { id: 'fogra30', displayName: 'FOGRA30 (uncoated yellowish)', source: 'bundled', region: 'europe', stock: 'uncoated', url: '/icc/FOGRA30L_uncoated_yellowish.icc', description: 'European uncoated, yellowish stock (FOGRA30).', outputConditionId: 'FOGRA30' },
  { id: 'fogra40', displayName: 'FOGRA40 (SC paper)', source: 'bundled', region: 'europe', stock: 'special', url: '/icc/FOGRA40L_SC_paper.icc', description: 'European super-calendered paper (FOGRA40).', outputConditionId: 'FOGRA40' },
  { id: 'fogra45', displayName: 'FOGRA45 (lightweight coated)', source: 'bundled', region: 'europe', stock: 'web-coated', url: '/icc/FOGRA45L_lwc.icc', description: 'European lightweight coated web (FOGRA45 / LWC).', outputConditionId: 'FOGRA45' },
  { id: 'snap-tr002', displayName: 'US SNAP newsprint', source: 'bundled', region: 'newsprint', stock: 'newsprint', url: '/icc/SNAP_TR002_newsprint.icc', description: 'US newspaper cold-set (SNAP TR002).', outputConditionId: 'CGATS TR 002' },
  { id: 'ifra26', displayName: 'IFRA newsprint', source: 'bundled', region: 'newsprint', stock: 'newsprint', url: '/icc/IFRA26S_2004_newsprint.icc', description: 'European newspaper (IFRA26 2004).', outputConditionId: 'IFRA26' },
];

export const DEFAULT_CMYK_PROFILE_ID = 'fogra39';

export function findBundledProfile(id: string): IccProfileRef | undefined {
  return BUNDLED_CMYK_PROFILES.find((profile) => profile.id === id);
}

/**
 * Standard per-OS directories to scan for installed ICC profiles (the SYSTEM tier). The Electron main
 * process reads these; the renderer never touches fs directly.
 */
export function systemIccSearchDirs(platform: NodeJS.Platform, home = ''): string[] {
  if (platform === 'darwin') {
    return [
      '/System/Library/ColorSync/Profiles',
      '/Library/ColorSync/Profiles',
      '/Library/Application Support/Adobe/Color/Profiles',
      home ? `${home}/Library/ColorSync/Profiles` : '',
    ].filter(Boolean);
  }
  if (platform === 'win32') {
    const root = process.env.SystemRoot || 'C:\\Windows';
    return [
      `${root}\\System32\\spool\\drivers\\color`,
      'C:\\Program Files\\Common Files\\Adobe\\Color\\Profiles',
      'C:\\Program Files (x86)\\Common Files\\Adobe\\Color\\Profiles',
    ];
  }
  // linux / other unix
  return [
    '/usr/share/color/icc',
    '/usr/local/share/color/icc',
    home ? `${home}/.local/share/icc` : '',
    home ? `${home}/.color/icc` : '',
  ].filter(Boolean);
}

/** True when a filename looks like an ICC profile. */
export function isIccProfileFile(name: string): boolean {
  return /\.(icc|icm)$/i.test(name);
}
