const { dirname, join } = require('node:path');

function sanitizePdfFileName(value) {
  const baseName = (value ?? '')
    .trim()
    .replace(/[/\\?%*:|"<>]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || 'paper-document';

  return /\.pdf$/i.test(baseName) ? baseName : `${baseName}.pdf`;
}

function ensurePdfExtension(filePath) {
  return /\.pdf$/i.test(filePath) ? filePath : `${filePath}.pdf`;
}

function buildPaperPdfDefaultPath(request, currentProjectPath) {
  const fileName = sanitizePdfFileName(request?.fileName || request?.title || 'paper-document');
  return currentProjectPath ? join(dirname(currentProjectPath), fileName) : fileName;
}

function buildPaperPdfPrintOptions(request) {
  const pageSize = buildPaperPdfPageSize(request);
  return {
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: false,
    scale: 1,
    ...(pageSize ? { pageSize } : {}),
    margins: { marginType: 'custom', top: 0, bottom: 0, left: 0, right: 0 },
  };
}

function buildPaperPdfRenderReadyScript(options = {}) {
  const fontTimeoutMs = sanitizePositiveInteger(options.fontTimeoutMs, 30000);
  const imageTimeoutMs = sanitizePositiveInteger(options.imageTimeoutMs, 8000);
  const frameTimeoutMs = sanitizePositiveInteger(options.frameTimeoutMs, 350);

  return `
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitBounded = (promise, timeoutMs) => Promise.race([
        Promise.resolve(promise).catch(() => undefined),
        sleep(timeoutMs),
      ]);

      if (document.fonts?.ready) {
        await waitBounded(document.fonts.ready, ${fontTimeoutMs});
      }

      // The renderer puts the exact managed-face manifest beside its @font-face payload. Waiting
      // for document.fonts alone is insufficient: Chromium can resolve a human-family fallback and
      // still report ready. Native PDF must make the same requested-alias decision as browser print.
      const manifestMatch = document.documentElement?.innerHTML?.match(/signal-loom-managed-font-manifest:([A-Za-z0-9_-]+)/);
      if (manifestMatch) {
        if (!document.fonts?.load || !document.fonts?.check) {
          throw new Error('Browser does not expose requested-face verification.');
        }
        let manifest;
        try {
          const encoded = manifestMatch[1].replace(/-/g, '+').replace(/_/g, '/');
          manifest = JSON.parse(atob(encoded));
        } catch {
          throw new Error('Managed font payload has no readable exact identity manifest.');
        }
        if (manifest?.version !== 1 || !Array.isArray(manifest.faces)) {
          throw new Error('Managed font payload has an invalid exact identity manifest.');
        }
        for (const face of manifest.faces) {
          if ((face.format !== 'truetype' && face.format !== 'opentype-cff') || face.collectionIndex !== 0) {
            throw new Error('Managed face ' + face.identity + ' is not an authenticated standalone font; collection member paint is blocked. Extract it to a standalone .ttf/.otf and retry.');
          }
          const style = face.style === 'oblique' ? 'oblique ' + (face.obliqueAngleDeg ?? 14) + 'deg' : face.style;
          const stretchKeywords = { '50': 'ultra-condensed', '62.5': 'extra-condensed', '75': 'condensed', '87.5': 'semi-condensed', '100': 'normal', '112.5': 'semi-expanded', '125': 'expanded', '150': 'extra-expanded', '200': 'ultra-expanded' };
          const stretch = stretchKeywords[String(face.stretchPercent)];
          if (!stretch) {
            throw new Error('Managed face ' + face.identity + ' has no exact CSS shorthand stretch keyword.');
          }
          const descriptor = style + ' ' + face.weight + ' ' + stretch + ' 16px "' + face.familyAlias + '"';
          const loaded = await Promise.race([
            Promise.resolve(document.fonts.load(descriptor, 'WMWMWMiiiii012345')),
            sleep(${fontTimeoutMs}).then(() => { throw new Error('Managed face ' + face.identity + ' timed out.'); }),
          ]);
          const exact = Array.from(loaded ?? []).some((candidate) => candidate.family === face.familyAlias && candidate.status === 'loaded');
          if (!exact || !document.fonts.check(descriptor, 'WMWMWMiiiii012345')) {
            throw new Error('Managed face did not load with its requested identity: ' + face.identity + '.');
          }
        }
      }

      await Promise.all(Array.from(document.images).map((image) => {
        if (image.complete) return undefined;
        return waitBounded(new Promise((resolve) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        }), ${imageTimeoutMs});
      }));

      await Promise.race([
        new Promise((resolve) => {
          if (typeof requestAnimationFrame !== 'function') {
            resolve(true);
            return;
          }
          let frameCount = 0;
          const step = () => {
            frameCount += 1;
            if (frameCount >= 2) {
              resolve(true);
              return;
            }
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }),
        sleep(${frameTimeoutMs}),
      ]);

      return true;
    })()
  `;
}

function buildPaperPdfPageSize(request) {
  const widthMm = Number(request?.page?.widthMm);
  const heightMm = Number(request?.page?.heightMm);
  if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm) || widthMm <= 0 || heightMm <= 0) {
    return undefined;
  }
  return {
    width: Number((widthMm / 25.4).toFixed(3)),
    height: Number((heightMm / 25.4).toFixed(3)),
  };
}

function sanitizePositiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.round(numeric);
}

module.exports = {
  buildPaperPdfDefaultPath,
  buildPaperPdfPageSize,
  buildPaperPdfPrintOptions,
  buildPaperPdfRenderReadyScript,
  ensurePdfExtension,
  sanitizePdfFileName,
};
