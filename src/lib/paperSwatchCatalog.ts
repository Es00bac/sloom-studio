import { cmykToRgb, type PaperCmyk, type PaperSwatch } from './paperSwatches';

// Default print-oriented swatch palette for the Paper workspace: the four process inks, a rich black,
// a registration spot, and the process RGB secondaries. Each carries its CMYK definition and a screen
// RGB derived from it, so the canvas preview and the swatch chip agree. Custom/document swatches build
// on this in a later slice.

function processSwatch(id: string, name: string, cmyk: PaperCmyk): PaperSwatch {
  return { id, name, type: 'process', model: 'cmyk', cmyk, rgb: cmykToRgb(cmyk) };
}

export const PAPER_DEFAULT_SWATCHES: PaperSwatch[] = [
  processSwatch('paper', 'Paper', { c: 0, m: 0, y: 0, k: 0 }),
  processSwatch('cyan', 'Cyan', { c: 100, m: 0, y: 0, k: 0 }),
  processSwatch('magenta', 'Magenta', { c: 0, m: 100, y: 0, k: 0 }),
  processSwatch('yellow', 'Yellow', { c: 0, m: 0, y: 100, k: 0 }),
  processSwatch('black', 'Black', { c: 0, m: 0, y: 0, k: 100 }),
  processSwatch('rich-black', 'Rich Black', { c: 60, m: 40, y: 40, k: 100 }),
  {
    id: 'registration',
    name: 'Registration',
    type: 'spot',
    model: 'cmyk',
    cmyk: { c: 100, m: 100, y: 100, k: 100 },
    rgb: { r: 0, g: 0, b: 0 },
    spotName: 'All',
  },
  processSwatch('process-red', 'Process Red', { c: 0, m: 100, y: 100, k: 0 }),
  processSwatch('process-green', 'Process Green', { c: 100, m: 0, y: 100, k: 0 }),
  processSwatch('process-blue', 'Process Blue', { c: 100, m: 100, y: 0, k: 0 }),
];
