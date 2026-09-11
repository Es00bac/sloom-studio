import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'studio.sloom.slstapp',
  appName: 'Sloom Studio',
  webDir: 'dist',
  plugins: {
    // Route http(s) requests through the native HTTP stack on Android/iOS so provider API calls
    // (OpenAI, Gemini, Atlas, FLUX, …) aren't blocked by the WebView's CORS policy — most provider
    // endpoints send no CORS headers. Capacitor's patched fetch passes data:/blob:/file: and
    // app-origin requests through to the real fetch untouched, and handles FormData uploads, so
    // local asset/blob fetches and multipart uploads keep working. Desktop (Electron) is unaffected
    // by this Capacitor config. See src/lib/capacitorNativeHttp.test.ts.
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
