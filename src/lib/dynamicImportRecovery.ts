const DYNAMIC_IMPORT_FAILURE_PATTERNS = [
  /dynamically imported module/i,
  /failed to fetch dynamically imported module/i,
  /importing a module script failed/i,
  /failed to load module script/i,
  /loading chunk .* failed/i,
  /chunkloaderror/i,
];

export function isDynamicImportLoadFailure(error: unknown): boolean {
  const message = extractErrorMessage(error);
  return DYNAMIC_IMPORT_FAILURE_PATTERNS.some((pattern) => pattern.test(message));
}

export function describeDynamicImportLoadFailure(error: unknown, runtimeLabel: string): string {
  if (!isDynamicImportLoadFailure(error)) {
    return extractErrorMessage(error) || `${runtimeLabel} failed to load.`;
  }

  return `The ${runtimeLabel} runtime could not be loaded because the app updated while this browser tab was open. Please refresh Sloom Studio and run the node again.`;
}

export async function loadProviderModule<TModule>(
  loader: () => Promise<TModule>,
  runtimeLabel: string,
): Promise<TModule> {
  try {
    return await loader();
  } catch (error) {
    if (isDynamicImportLoadFailure(error)) {
      throw new Error(describeDynamicImportLoadFailure(error, runtimeLabel));
    }

    throw error;
  }
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return '';
}
