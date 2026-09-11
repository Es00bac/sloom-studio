const GENERATED_TEXT_PLACEHOLDER = 'Generated text will appear here.';

export function getGeneratedTextDisplay(result: unknown): string {
  return typeof result === 'string' && result.trim().length > 0
    ? result
    : GENERATED_TEXT_PLACEHOLDER;
}
