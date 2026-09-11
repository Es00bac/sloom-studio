export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 100) return 100;
  return value;
}

export function titleCase(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

export function pascalCase(value: string): string {
  return value
    .split('-')
    .map((part) => titleCase(part))
    .join('');
}

export function titleLabel(value: string): string {
  return value
    .split('-')
    .map((part) => titleCase(part))
    .join(' ');
}

export function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}
