declare module 'hyphenated' {
  export interface HyphenatedLanguage {
    id: string;
    patterns: string[];
    exceptions?: string[];
  }

  export function hyphenated(text: string, options?: {
    language?: HyphenatedLanguage;
  }): string;
}
