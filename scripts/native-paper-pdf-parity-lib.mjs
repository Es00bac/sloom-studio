export function buildNativeWindowPageCrop({ focus, screenshot }) {
  const viewportWidth = positiveNumber(focus?.viewport?.width, screenshot?.width, 1);
  const viewportHeight = positiveNumber(focus?.viewport?.height, screenshot?.height, 1);
  const screenshotWidth = positiveNumber(screenshot?.width, viewportWidth, 1);
  const screenshotHeight = positiveNumber(screenshot?.height, viewportHeight, 1);
  const scaleX = screenshotWidth / viewportWidth;
  const scaleY = screenshotHeight / viewportHeight;
  const pageRect = focus?.pageRect ?? {};
  const rawX = finiteNumber(pageRect.x ?? pageRect.left, 0);
  const rawY = finiteNumber(pageRect.y ?? pageRect.top, 0);
  const rawWidth = positiveNumber(pageRect.width, viewportWidth, 1);
  const rawHeight = positiveNumber(pageRect.height, viewportHeight, 1);
  const x = clamp(Math.round(rawX * scaleX), 0, Math.max(0, screenshotWidth - 1));
  const y = clamp(Math.round(rawY * scaleY), 0, Math.max(0, screenshotHeight - 1));
  const width = clamp(Math.round(rawWidth * scaleX), 1, Math.max(1, screenshotWidth - x));
  const height = clamp(Math.round(rawHeight * scaleY), 1, Math.max(1, screenshotHeight - y));

  return {
    width,
    height,
    x,
    y,
    argument: `${width}x${height}+${x}+${y}`,
  };
}

function positiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 1;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
