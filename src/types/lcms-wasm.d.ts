// Minimal ambient types for the untyped `lcms-wasm` package (only the surface Sloom Studio uses).
declare module 'lcms-wasm' {
  export const TYPE_RGB_8: number;
  export const TYPE_RGBA_8: number;
  export const TYPE_RGBA_16: number;
  export const TYPE_CMYK_8: number;
  export const TYPE_CMYKA_8: number;
  export const cmsFLAGS_BLACKPOINTCOMPENSATION: number;
  export const cmsFLAGS_COPY_ALPHA: number;
  export const cmsFLAGS_GAMUTCHECK: number;
  export const cmsFLAGS_SOFTPROOFING: number;
  export const cmsInfoDescription: number;

  export interface LcmsModule {
    cmsCreate_sRGBProfile(): number;
    cmsOpenProfileFromMem(data: Uint8Array, len: number): number;
    cmsCloseProfile(profile: number): void;
    cmsGetColorSpaceASCII(profile: number): string;
    cmsGetProfileInfoASCII(profile: number, info: number, lang: string, country: string): string;
    cmsCreateTransform(inProfile: number, inFormat: number, outProfile: number, outFormat: number, intent: number, flags: number): number;
    /** Soft-proof transform: input→display simulating `proofing` (e.g. the CMYK press condition). */
    cmsCreateProofingTransform(inProfile: number, inFormat: number, outProfile: number, outFormat: number, proofing: number, intent: number, proofingIntent: number, flags: number): number;
    cmsDeleteTransform(transform: number): void;
    cmsDoTransform(transform: number, input: Uint8Array, pixelCount: number): Uint8Array;
    cmsDoTransform(transform: number, input: Uint16Array, pixelCount: number): Uint8Array;
    cmsDoTransform(transform: number, input: Float32Array, pixelCount: number): Float32Array;
  }

  export function instantiate(options?: { locateFile?: (file: string) => string }): Promise<LcmsModule>;
}
