/**
 * Minimal, dependency-free on-screen notice. The app has no global toast system and a Capacitor
 * WebView ignores `<a download>`, so native file operations that succeed OR fail otherwise give the
 * user no feedback at all — the "it just does nothing, no error" symptom. This is the smallest thing
 * that always shows something. Safe to call in non-DOM contexts (falls back to console).
 */
export function showUserNotice(message: string, kind: 'success' | 'error' = 'success'): void {
  if (typeof document === 'undefined' || !document.body) {
    (kind === 'error' ? console.error : console.log)(`[Sloom Studio] ${message}`);
    return;
  }
  const notice = document.createElement('div');
  notice.textContent = message;
  notice.setAttribute('role', 'status');
  notice.style.cssText = [
    'position:fixed', 'left:50%', 'bottom:24px', 'transform:translateX(-50%)',
    'max-width:88vw', 'z-index:2147483647', 'padding:12px 16px', 'border-radius:12px',
    'font:500 14px/1.4 system-ui,-apple-system,sans-serif', 'color:#e6f6ff', 'text-align:center',
    'box-shadow:0 8px 24px rgba(0,0,0,0.45)', 'pointer-events:none',
    `background:${kind === 'error' ? '#7f1d1d' : '#0e3a4a'}`,
    `border:1px solid ${kind === 'error' ? '#ef4444' : '#22d3ee'}`,
    'opacity:0', 'transition:opacity .2s ease',
  ].join(';');
  document.body.appendChild(notice);
  requestAnimationFrame(() => {
    notice.style.opacity = '1';
  });
  window.setTimeout(() => {
    notice.style.opacity = '0';
    window.setTimeout(() => notice.remove(), 250);
  }, kind === 'error' ? 6000 : 3500);
}
