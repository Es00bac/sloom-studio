declare module 'spectral.js' {
  class Color {
    constructor(arg: string | number[]);
    sRGB: number[];
    lRGB: number[];
    R: number[];
    XYZ: number[];
    KS: number[];
    luminance: number;
    tintingStrength: number;
    inGamut(options?: { epsilon?: number }): boolean;
    toGamut(options?: { method?: string }): Color;
    toString(options?: { format?: string; method?: string }): string;
  }
  function mix(...colors: [Color, number][]): Color;
  function palette(a: Color, b: Color, size: number): Color[];
  function gradient(t: number, ...colors: [Color, number][]): Color;
  const spectral: { Color: typeof Color; mix: typeof mix; palette: typeof palette; gradient: typeof gradient };
  export default spectral;
  export { Color, mix, palette, gradient };
}
