/**
 * Helper to check if standard user confirmation dialogs (window.confirm)
 * should be bypassed in headless, unit test, or automated execution settings.
 */
export function shouldBypassConfirmations(): boolean {
  if (typeof window !== 'undefined') {
    const w = window as unknown as Record<string, unknown>;
    if (w.SIGNAL_LOOM_AUTOMATION === true) return true;
    if (w.SIGNAL_LOOM_ENABLE_AUTOMATION_PATHS === '1' || w.SIGNAL_LOOM_ENABLE_AUTOMATION_PATHS === 1) return true;
  }

  try {
    if (typeof process !== 'undefined' && process.env) {
      if (process.env.SIGNAL_LOOM_AUTOMATION === 'true' || process.env.SIGNAL_LOOM_AUTOMATION === '1') return true;
      if (process.env.SIGNAL_LOOM_ENABLE_AUTOMATION_PATHS === '1') return true;
      if (process.env.NODE_ENV === 'test') return true;
    }
  } catch {
    // process or process.env might not exist in standard browser environments
  }

  return false;
}
