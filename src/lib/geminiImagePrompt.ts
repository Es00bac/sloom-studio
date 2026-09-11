interface GeminiImagePromptOptions {
  hasSourceImage: boolean;
  referenceImageCount: number;
}

export function buildGeminiImagePrompt(
  prompt: string,
  options: GeminiImagePromptOptions,
): string {
  const trimmedPrompt = prompt.trim();

  if (!trimmedPrompt) {
    return '';
  }

  if (options.hasSourceImage && options.referenceImageCount > 0) {
    return [
      'Edit the first attached image as the source image.',
      `Use the remaining ${options.referenceImageCount} attached image${options.referenceImageCount === 1 ? '' : 's'} as reference guidance only for style, outfit, materials, colors, accessories, or other visual cues explicitly requested.`,
      'Preserve the source image subject, pose, framing, and identity unless the prompt explicitly asks to change them.',
      '',
      `USER PROMPT: ${trimmedPrompt}`,
    ].join('\n');
  }

  if (options.hasSourceImage) {
    return [
      'Edit the attached source image according to the following prompt.',
      'Preserve the main subject unless the prompt explicitly asks for a change.',
      '',
      `USER PROMPT: ${trimmedPrompt}`,
    ].join('\n');
  }

  if (options.referenceImageCount > 0) {
    return [
      `Generate a new image using the attached reference image${options.referenceImageCount === 1 ? '' : 's'} as visual guidance.`,
      'Use the references for style, outfit, materials, composition, or other visual cues only when they match the prompt.',
      '',
      `USER PROMPT: ${trimmedPrompt}`,
    ].join('\n');
  }

  return trimmedPrompt;
}
