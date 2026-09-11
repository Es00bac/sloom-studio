import { BRAND_NAME, BRAND_NAME_KATAKANA } from '../../lib/i18n';

/**
 * Bilingual brand wordmark, styled like an anime/manga title logo: the Latin "Sloom Studio" reads on
 * top, with its katakana reading (スルーム・スタジオ) both as a faint oversized ghost floating behind
 * the logo AND as a small tracked subtitle beneath it. Used on the startup splash and the first-run
 * language gate so the app's identity is bilingual from the very first frame.
 *
 * `scale` multiplies the whole lockup (1 = splash size). Everything is em-relative so a single number
 * rescales it cleanly; it never sets its own colour background so it composites over any artwork.
 */
export function BrandWordmark({ scale = 1, className }: { scale?: number; className?: string }) {
  return (
    <div
      className={className}
      style={{ fontSize: `${scale}rem`, lineHeight: 1, textAlign: 'center', userSelect: 'none' }}
    >
      <div style={{ position: 'relative', display: 'inline-block', padding: '0.35em 0.1em 0' }}>
        {/* Ghost reading — oversized, faint, tucked up and behind the Latin logo (the "manga" layer). */}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: '50%',
            top: '-0.18em',
            transform: 'translateX(-50%)',
            fontSize: '1.9em',
            fontWeight: 800,
            letterSpacing: '0.18em',
            whiteSpace: 'nowrap',
            color: 'rgba(103, 232, 249, 0.10)',
            pointerEvents: 'none',
          }}
        >
          {BRAND_NAME_KATAKANA}
        </span>

        {/* Latin logo — the thing you actually read. */}
        <span
          style={{
            position: 'relative',
            display: 'block',
            fontSize: '3em',
            fontWeight: 800,
            letterSpacing: '-0.01em',
            color: '#eef6ff',
            textShadow: '0 2px 18px rgba(4, 10, 24, 0.65)',
          }}
        >
          {BRAND_NAME}
        </span>
      </div>

      {/* Katakana subtitle — small, wide-tracked, flanked by hairlines, like a title's furigana line. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.9em',
          marginTop: '0.55em',
        }}
      >
        <span style={{ height: 1, width: '2.2em', background: 'linear-gradient(90deg, transparent, rgba(103,232,249,0.55))' }} />
        <span
          style={{
            fontSize: '0.92em',
            fontWeight: 600,
            letterSpacing: '0.42em',
            paddingLeft: '0.42em',
            color: 'rgba(125, 224, 245, 0.92)',
            whiteSpace: 'nowrap',
          }}
        >
          {BRAND_NAME_KATAKANA}
        </span>
        <span style={{ height: 1, width: '2.2em', background: 'linear-gradient(90deg, rgba(103,232,249,0.55), transparent)' }} />
      </div>
    </div>
  );
}
