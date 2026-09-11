// Real ICC color engine — Little-CMS (lcms2) compiled to WASM (MIT), wrapping profile transforms so
// the color-management seam in `paperColorManagement.ts` gets a genuine, press-accurate `icc` backend
// instead of the naive device formula. Runs in the browser, Electron, and Node (tests).
//
// This is the piece that makes CMYK real: sRGB→CMYK through a chosen output profile, with rendering
// intent + black-point compensation, exactly like InDesign/Photoshop's conversion.

import { instantiate, TYPE_CMYK_8, TYPE_RGB_8, cmsInfoDescription, type LcmsModule } from 'lcms-wasm';
import {
  disposeOwnedPaperResources,
  usingOwnedPaperResource,
  type IccCmykTransform,
} from './paperColorManagement';
import type { PaperCmyk, PaperRgb } from './paperSwatches';
import { resolveBundledAssetUrl } from './bundledAssetUrl';

export type IccRenderingIntent = 'perceptual' | 'relative' | 'saturation' | 'absolute';
const INTENT_CODE: Record<IccRenderingIntent, number> = { perceptual: 0, relative: 1, saturation: 2, absolute: 3 };
const FLAGS_BLACKPOINTCOMPENSATION = 0x2000;
const FLAGS_SOFTPROOFING = 0x4000;

let wasmLocator: ((file: string) => string) | null = null;
/** App boot can override where the engine loads `lcms.wasm` from (rarely needed — see the default below). */
export function setIccWasmLocator(locate: (file: string) => string): void {
  wasmLocator = locate;
}

let enginePromise: Promise<LcmsModule> | null = null;
/** Lazily instantiate the shared lcms2 module (cached and borrowed by every operation; never per-call disposed). */
export function getIccEngine(): Promise<LcmsModule> {
  if (!enginePromise) {
    const browserRuntime = typeof window !== 'undefined' && typeof (globalThis as { process?: unknown }).process === 'undefined';
    // Resolve `lcms.wasm` against the document base so it loads under both a served origin and the bare
    // `file://` the packaged Electron renderer uses (a root-absolute `/lcms.wasm` 404s under file://).
    const locateFile = wasmLocator ?? (browserRuntime ? (file: string) => resolveBundledAssetUrl(file) : undefined);
    enginePromise = instantiate(locateFile ? { locateFile } : undefined);
  }
  return enginePromise;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
function to100(value: number): number {
  return Math.round((value / 255) * 100);
}
function safeProfileName(lcms: LcmsModule, profile: number): string {
  try {
    return (lcms.cmsGetProfileInfoASCII(profile, cmsInfoDescription, 'en', 'US') || '').trim();
  } catch {
    return '';
  }
}

export interface IccProfileInfo {
  name: string;
  colorSpace: string;
}

export const ICC_DISPOSED_RESOURCE_ERROR = 'This ICC transform has been disposed.';

function assertIccTransformOpen(disposed: boolean): void {
  if (disposed) throw new Error(ICC_DISPOSED_RESOURCE_ERROR);
}

interface LcmsOwnedHandles {
  sRgb?: number;
  cmyk?: number;
  transform?: number;
}

/**
 * lcms allocates profiles/transforms independently. Release in dependency order and continue after a
 * failed delete/close so a broken cleanup cannot strand the remaining handles.
 */
function disposeLcmsHandles(lcms: LcmsModule, handles: LcmsOwnedHandles, primaryError?: unknown, hasPrimaryError = false): void {
  disposeOwnedPaperResources([
    handles.transform ? { dispose: () => lcms.cmsDeleteTransform(handles.transform!) } : undefined,
    handles.cmyk ? { dispose: () => lcms.cmsCloseProfile(handles.cmyk!) } : undefined,
    handles.sRgb ? { dispose: () => lcms.cmsCloseProfile(handles.sRgb!) } : undefined,
  ], primaryError, hasPrimaryError);
}

/** Read a profile's name + data color space (for the picker + validating a user-supplied .icc). */
export async function describeIccProfile(profileBytes: Uint8Array): Promise<IccProfileInfo> {
  const lcms = await getIccEngine();
  const profile = lcms.cmsOpenProfileFromMem(profileBytes, profileBytes.length);
  if (!profile) throw new Error('That file is not a readable ICC profile.');
  return usingOwnedPaperResource({ dispose: () => lcms.cmsCloseProfile(profile) }, () => {
    return { name: safeProfileName(lcms, profile) || 'ICC profile', colorSpace: lcms.cmsGetColorSpaceASCII(profile) };
  });
}

/**
 * Opens and closes a real sRGB-to-CMYK lcms transform to prove that an ICC profile is usable for
 * production conversion. This intentionally does not hand a transform back to callers, so validation
 * cannot retain WASM profiles or transforms past the check.
 */
export async function validateCmykOutputProfileTransform(profileBytes: Uint8Array): Promise<void> {
  const lcms = await getIccEngine();
  const handles: LcmsOwnedHandles = {};
  try {
    handles.sRgb = lcms.cmsCreate_sRGBProfile();
    if (!handles.sRgb) throw new Error('Could not create the sRGB validation profile.');
    handles.cmyk = lcms.cmsOpenProfileFromMem(profileBytes, profileBytes.length);
    if (!handles.cmyk) throw new Error('Could not open the CMYK ICC profile.');
    const space = lcms.cmsGetColorSpaceASCII(handles.cmyk);
    if (space !== 'CMYK') throw new Error(`Expected a CMYK output profile but got "${space}".`);
    handles.transform = lcms.cmsCreateTransform(handles.sRgb, TYPE_RGB_8, handles.cmyk, TYPE_CMYK_8, INTENT_CODE.relative, FLAGS_BLACKPOINTCOMPENSATION);
    if (!handles.transform) throw new Error('Could not create the ICC color transform.');
  } catch (error) {
    disposeLcmsHandles(lcms, handles, error, true);
    throw error;
  }
  disposeLcmsHandles(lcms, handles);
}

export interface IccTransformOptions {
  intent?: IccRenderingIntent;
  /** Black-point compensation (default true, matching Adobe's default for relative colorimetric). */
  blackPointCompensation?: boolean;
}

/**
 * Build a press-accurate sRGB→CMYK transform against a CMYK output profile. The returned object
 * satisfies `IccCmykTransform` (kind `icc`), so every color resolved through it is press-accurate
 * (`approximate: false`) in `paperColorManagement`.
 */
export async function createRgbToCmykTransform(
  cmykProfileBytes: Uint8Array,
  options: IccTransformOptions = {},
): Promise<IccCmykTransform & { dispose(): void }> {
  const lcms = await getIccEngine();
  const handles: LcmsOwnedHandles = {};
  try {
    handles.sRgb = lcms.cmsCreate_sRGBProfile();
    if (!handles.sRgb) throw new Error('Could not create the sRGB profile.');
    handles.cmyk = lcms.cmsOpenProfileFromMem(cmykProfileBytes, cmykProfileBytes.length);
    if (!handles.cmyk) throw new Error('Could not open the CMYK ICC profile.');
    const space = lcms.cmsGetColorSpaceASCII(handles.cmyk);
    if (space !== 'CMYK') throw new Error(`Expected a CMYK output profile but got "${space}".`);
    const intent = INTENT_CODE[options.intent ?? 'relative'];
    const flags = options.blackPointCompensation === false ? 0 : FLAGS_BLACKPOINTCOMPENSATION;
    handles.transform = lcms.cmsCreateTransform(handles.sRgb, TYPE_RGB_8, handles.cmyk, TYPE_CMYK_8, intent, flags);
    if (!handles.transform) throw new Error('Could not create the ICC color transform.');
  } catch (error) {
    disposeLcmsHandles(lcms, handles, error, true);
    throw error;
  }
  const { sRgb, cmyk, transform } = handles;
  const profileName = safeProfileName(lcms, cmyk!) || 'CMYK profile';
  let disposed = false;
  return {
    kind: 'icc',
    profileName,
    rgbToCmyk: (rgb: PaperRgb): PaperCmyk => {
      assertIccTransformOpen(disposed);
      const out = lcms.cmsDoTransform(transform!, new Uint8Array([clampByte(rgb.r), clampByte(rgb.g), clampByte(rgb.b)]), 1);
      return { c: to100(out[0]), m: to100(out[1]), y: to100(out[2]), k: to100(out[3]) };
    },
    // Whole-image path for the raster PDF/X exporter: one lcms2 call converts the entire page. lcms
    // returns raw 0–255 CMYK samples, which are exactly the DeviceCMYK image data a PDF wants.
    transformRgbBuffer: (rgb: Uint8Array, pixelCount: number): Uint8Array => {
      assertIccTransformOpen(disposed);
      return lcms.cmsDoTransform(transform!, rgb, pixelCount);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      disposeLcmsHandles(lcms, { sRgb, cmyk, transform });
    },
  };
}

export interface SoftProofOptions {
  /** Source→CMYK rendering intent (how the design is mapped into the press gamut). Default relative. */
  intent?: IccRenderingIntent;
  /**
   * Simulate the paper's white point on screen (Adobe's "Simulate Paper Color"). Uses an absolute
   * colorimetric proof→display step so white shifts toward the stock's tint. Default false.
   */
  simulatePaperWhite?: boolean;
}

export interface SoftProofTransform {
  profileName: string;
  /** Simulate how one sRGB color will look printed on this CMYK condition; returns display sRGB. */
  proofRgb(rgb: PaperRgb): PaperRgb;
  /** Whole-image soft proof: RGB in → simulated display RGB out (0–255, same length). */
  proofRgbBuffer(rgb: Uint8Array, pixelCount: number): Uint8Array;
  /** Release the lcms2 transform + profiles (call when the preview is torn down). */
  dispose(): void;
}

/**
 * Build a press-accurate soft-proof: sRGB → display sRGB while simulating how the CMYK output profile
 * will render it (lcms2 proofing transform with the SOFTPROOFING flag). This is what lets a pro *see*
 * the gamut-mapped CMYK on screen before exporting — dull blues, muddy greens, and (optionally) the
 * paper's off-white all show up, matching InDesign/Photoshop's soft-proof.
 */
export async function createSoftProofTransform(
  cmykProfileBytes: Uint8Array,
  options: SoftProofOptions = {},
): Promise<SoftProofTransform> {
  const lcms = await getIccEngine();
  const handles: LcmsOwnedHandles = {};
  try {
    handles.sRgb = lcms.cmsCreate_sRGBProfile();
    if (!handles.sRgb) throw new Error('Could not create the sRGB soft-proof profile.');
    handles.cmyk = lcms.cmsOpenProfileFromMem(cmykProfileBytes, cmykProfileBytes.length);
    if (!handles.cmyk) throw new Error('Could not open the CMYK ICC profile.');
    const space = lcms.cmsGetColorSpaceASCII(handles.cmyk);
    if (space !== 'CMYK') throw new Error(`Expected a CMYK output profile but got "${space}".`);
    const intent = INTENT_CODE[options.intent ?? 'relative'];
  // Paper-white simulation uses absolute colorimetric on the proof→display leg (and drops BPC, which
  // absolute intent ignores anyway); otherwise relative with black-point compensation.
    const simulatePaper = options.simulatePaperWhite === true;
    const proofingIntent = simulatePaper ? INTENT_CODE.absolute : INTENT_CODE.relative;
    const flags = FLAGS_SOFTPROOFING | (simulatePaper ? 0 : FLAGS_BLACKPOINTCOMPENSATION);
    handles.transform = lcms.cmsCreateProofingTransform(handles.sRgb, TYPE_RGB_8, handles.sRgb, TYPE_RGB_8, handles.cmyk, intent, proofingIntent, flags);
    if (!handles.transform) throw new Error('Could not create the ICC soft-proof transform.');
  } catch (error) {
    disposeLcmsHandles(lcms, handles, error, true);
    throw error;
  }
  const { sRgb, cmyk, transform } = handles;
  const profileName = safeProfileName(lcms, cmyk!) || 'CMYK profile';
  let disposed = false;
  return {
    profileName,
    proofRgb: (rgb: PaperRgb): PaperRgb => {
      assertIccTransformOpen(disposed);
      const out = lcms.cmsDoTransform(transform!, new Uint8Array([clampByte(rgb.r), clampByte(rgb.g), clampByte(rgb.b)]), 1);
      return { r: out[0], g: out[1], b: out[2] };
    },
    proofRgbBuffer: (rgb: Uint8Array, pixelCount: number): Uint8Array => {
      assertIccTransformOpen(disposed);
      return lcms.cmsDoTransform(transform!, rgb, pixelCount);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      disposeLcmsHandles(lcms, { sRgb, cmyk, transform });
    },
  };
}
