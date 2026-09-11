import { describe, expect, it } from 'vitest';
import {
  buildFlowWorkspaceMetricLabel,
  buildFlowWorkspaceMetricSnapshot,
  shouldShowFlowWorkspaceDiagnostics,
} from './flowWorkspaceMetrics';

describe('flowWorkspaceMetrics', () => {
  it('builds a stable metric snapshot from Flow and Source Library counts', () => {
    expect(buildFlowWorkspaceMetricSnapshot({
      workspaceId: 'main',
      nodeCount: 42,
      edgeCount: 51,
      sourceItemCount: 18,
      importDurationMs: 135,
      switchDurationMs: 88,
    })).toEqual({
      workspaceId: 'main',
      nodeCount: 42,
      edgeCount: 51,
      sourceItemCount: 18,
      importDurationMs: 135,
      switchDurationMs: 88,
    });
  });

  it('renders a compact diagnostic label for topbar display', () => {
    expect(buildFlowWorkspaceMetricLabel({
      workspaceId: 'main',
      nodeCount: 42,
      edgeCount: 51,
      sourceItemCount: 18,
      importDurationMs: 135,
      switchDurationMs: 88,
    })).toBe('Flow main N42 E51 S18 I135ms W88ms');
  });

  it('keeps diagnostics off unless explicitly enabled', () => {
    expect(shouldShowFlowWorkspaceDiagnostics(undefined)).toBe(false);
    expect(shouldShowFlowWorkspaceDiagnostics('0')).toBe(false);
    expect(shouldShowFlowWorkspaceDiagnostics('1')).toBe(true);
  });
});
