import type { ErrorInfo } from 'react';

export function formatErrorDetails(error: Error | null, errorInfo?: ErrorInfo | null, title?: string): string {
  return [
    `Surface: ${title ?? 'Unknown'}`,
    error ? `${error.name}: ${error.message}` : 'No error object available',
    error?.stack ? `Stack:\n${error.stack}` : undefined,
    errorInfo?.componentStack ? `Component stack:\n${errorInfo.componentStack}` : undefined,
  ].filter(Boolean).join('\n\n');
}
