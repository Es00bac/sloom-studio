import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guards the fix for "AI/API calls fail on Android but work on desktop".
//
// Provider API calls in flowExecution / imageEditorAi use plain fetch(). On desktop the Electron
// renderer bypasses CORS; in the Android WebView, CORS is enforced and provider endpoints send no
// CORS headers, so those fetches fail. Enabling CapacitorHttp patches window.fetch on native to
// route http(s) requests through the Java HTTP stack (no CORS), while data:/blob:/file: and
// app-origin requests pass through to the real fetch unchanged. This must stay enabled or Android
// generation breaks again.
describe('Capacitor native HTTP bridge', () => {
  it('enables CapacitorHttp so Android provider API calls bypass the WebView CORS policy', () => {
    const config = readFileSync(join(process.cwd(), 'capacitor.config.ts'), 'utf8');
    expect(config).toMatch(/CapacitorHttp\s*:\s*\{[\s\S]*?enabled\s*:\s*true/);
  });
});
