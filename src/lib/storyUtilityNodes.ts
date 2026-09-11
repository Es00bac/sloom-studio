export interface TextSentimentResult {
  score: number;
  label: 'positive' | 'neutral' | 'negative';
  positiveMatches: number;
  negativeMatches: number;
}

const POSITIVE_WORDS = new Set(['love', 'wonderful', 'joy', 'joyful', 'happy', 'hope', 'great', 'good', 'kind', 'safe', 'win', 'beautiful']);
const NEGATIVE_WORDS = new Set(['hate', 'terrible', 'anger', 'angry', 'fear', 'afraid', 'sad', 'bad', 'cruel', 'danger', 'lose', 'pain']);

export function analyzeTextSentiment(text: string): TextSentimentResult {
  const words = text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  const positiveMatches = words.filter((word) => POSITIVE_WORDS.has(word)).length;
  const negativeMatches = words.filter((word) => NEGATIVE_WORDS.has(word)).length;
  const matched = positiveMatches + negativeMatches;
  const score = matched === 0 ? 0 : Number(((positiveMatches - negativeMatches) / matched).toFixed(3));
  const label = score > 0.15 ? 'positive' : score < -0.15 ? 'negative' : 'neutral';
  return { score, label, positiveMatches, negativeMatches };
}

export function splitDialogueForPrefix(script: string, prefix: string): string[] {
  const normalizedPrefix = prefix.trim();
  if (!normalizedPrefix) return [];
  return script.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith(normalizedPrefix)) return [];
    const dialogue = trimmed.slice(normalizedPrefix.length).trim();
    return dialogue ? [dialogue] : [];
  });
}
