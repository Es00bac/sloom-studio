export function buildGeminiTtsPrompt(transcript: string, styleDescription?: string): string {
  const normalizedTranscript = transcript.trim();
  const normalizedStyle = styleDescription?.trim();

  if (!normalizedTranscript) {
    return '';
  }

  if (!normalizedStyle) {
    return normalizedTranscript;
  }

  return [
    'Read the transcript exactly as written. Do not add, remove, or rewrite any words.',
    '',
    "# DIRECTOR'S NOTES",
    normalizedStyle,
    '',
    '# TRANSCRIPT',
    normalizedTranscript,
  ].join('\n');
}
