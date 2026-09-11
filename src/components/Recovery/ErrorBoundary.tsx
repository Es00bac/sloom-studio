import { Component, type ErrorInfo, type ReactNode } from 'react';
import {
  clearNonSecretPersistedRecoveryState,
  CONFIRMED_CRASH_RECOVERY_RESET,
  resetDockableAndWorkspaceLayout,
  resetProjectToBlank,
} from '../../lib/appRecovery';
import { formatErrorDetails } from '../../lib/errorRecoveryDetails';
import { recordRendererCrashReport } from '../../lib/crashReportCapture';

export type RecoveryBoundaryLevel = 'root' | 'workspace' | 'panel' | 'canvas';

export interface ErrorBoundaryProps {
  children: ReactNode;
  level?: RecoveryBoundaryLevel;
  title?: string;
  resetKeys?: readonly unknown[];
  className?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
  actionStatus: string | null;
  confirmProjectReset: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
    errorInfo: null,
    copied: false,
    actionStatus: null,
    confirmProjectReset: false,
  };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error, copied: false, actionStatus: null, confirmProjectReset: false };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    console.error(`[Sloom Studio recovery] ${this.props.title ?? this.props.level ?? 'surface'} failed`, error, errorInfo);
    recordRendererCrashReport({
      kind: 'renderer-render',
      message: error,
      stack: error.stack,
      componentStack: errorInfo.componentStack ?? undefined,
      surface: this.props.title ?? this.props.level ?? 'unknown surface',
    });
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.error && didResetKeysChange(prevProps.resetKeys, this.props.resetKeys)) {
      this.resetBoundary('Recovered after context change.');
    }
  }

  resetBoundary = (actionStatus: string | null = null): void => {
    this.setState({ error: null, errorInfo: null, copied: false, actionStatus, confirmProjectReset: false });
  };

  reloadApp = (): void => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  resetProject = (): void => {
    this.setState({
      actionStatus: 'Choose Cancel Reset or Reset with Recovery. No project state has changed.',
      confirmProjectReset: true,
    });
  };

  cancelProjectReset = (): void => {
    this.setState({
      actionStatus: 'Blank project reset canceled. Your Image and Paper documents remain open.',
      confirmProjectReset: false,
    });
  };

  confirmProjectReset = (): void => {
    this.setState({
      actionStatus: 'Capturing dirty Image and Paper tabs before reset…',
      confirmProjectReset: false,
    });
    void resetProjectToBlank(CONFIRMED_CRASH_RECOVERY_RESET).then(
      ({ capturedDirtyImageDocuments, capturedDirtyPaperDocuments }) => this.resetBoundary(
        formatCrashRecoveryResetStatus(capturedDirtyImageDocuments, capturedDirtyPaperDocuments),
      ),
      (error) => this.setState({
        actionStatus: error instanceof Error
          ? error.message
          : 'The project reset failed. The previous workspace remains open.',
      }),
    );
  };

  resetLayout = (): void => {
    resetDockableAndWorkspaceLayout();
    this.resetBoundary('Dockable and workspace layouts were reset.');
  };

  clearPersistedState = (): void => {
    const results = clearNonSecretPersistedRecoveryState();
    const failed = results.filter((result) => !result.removed).length;
    this.resetBoundary(
      failed > 0
        ? `Cleared recoverable state with ${failed} storage warning${failed === 1 ? '' : 's'}. Provider keys were preserved.`
        : 'Cleared recoverable persisted state. Provider keys were preserved.',
    );
  };

  copyDetails = (): void => {
    const details = formatErrorDetails(this.state.error, this.state.errorInfo, this.props.title);
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(details).then(
        () => this.setState({ copied: true, actionStatus: 'Error details copied.' }),
        () => this.setState({ copied: false, actionStatus: details }),
      );
      return;
    }

    this.setState({ copied: false, actionStatus: details });
  };

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <RecoveryFallback
        actionStatus={this.state.actionStatus}
        className={this.props.className}
        copied={this.state.copied}
        error={this.state.error}
        errorInfo={this.state.errorInfo}
        level={this.props.level ?? 'workspace'}
        onClearPersistedState={this.clearPersistedState}
        onConfirmResetProject={this.confirmProjectReset}
        onCancelResetProject={this.cancelProjectReset}
        onCopyDetails={this.copyDetails}
        onReloadApp={this.reloadApp}
        onResetBoundary={() => this.resetBoundary()}
        onResetLayout={this.resetLayout}
        onResetProject={this.resetProject}
        confirmProjectReset={this.state.confirmProjectReset}
        title={this.props.title}
      />
    );
  }
}

export interface RecoveryFallbackProps {
  error: Error;
  errorInfo?: ErrorInfo | null;
  level: RecoveryBoundaryLevel;
  title?: string;
  copied?: boolean;
  actionStatus?: string | null;
  className?: string;
  onResetBoundary: () => void;
  onReloadApp: () => void;
  onResetProject: () => void;
  onResetLayout: () => void;
  onClearPersistedState: () => void;
  onCopyDetails: () => void;
  confirmProjectReset?: boolean;
  onCancelResetProject?: () => void;
  onConfirmResetProject?: () => void;
}

export function RecoveryFallback({
  error,
  level,
  title,
  copied = false,
  actionStatus,
  className = '',
  onResetBoundary,
  onReloadApp,
  onResetProject,
  onResetLayout,
  onClearPersistedState,
  onCopyDetails,
  confirmProjectReset = false,
  onCancelResetProject,
  onConfirmResetProject,
}: RecoveryFallbackProps) {
  const isRoot = level === 'root';
  const heading = title ?? (isRoot ? 'Sloom Studio recovered from a render crash' : 'This surface crashed');
  const summary = isRoot
    ? 'The app shell caught a render exception before it could blank the window.'
    : 'Only this area was paused. Other Sloom Studio workspaces and panels should remain usable.';

  return (
    <div
      className={`flex h-full min-h-[12rem] w-full items-center justify-center bg-[#070b12] p-4 text-gray-100 ${className}`}
      role="alert"
    >
      <div className="w-full max-w-3xl rounded-2xl border border-red-300/20 bg-[#101722]/95 p-5 shadow-2xl shadow-black/40">
        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-red-200/70">Recovery Boundary</div>
        <h1 className="mt-2 text-xl font-semibold text-white">{heading}</h1>
        <p className="mt-2 text-sm text-gray-300">{summary}</p>
        <pre className="mt-4 max-h-36 overflow-auto rounded-lg border border-red-300/10 bg-black/35 p-3 text-xs text-red-100/90">
          {error.name}: {error.message}
        </pre>
        {actionStatus ? <p className="mt-3 text-xs text-cyan-100/80">{actionStatus}</p> : null}
        {confirmProjectReset ? (
          <div className="mt-4 rounded-lg border border-amber-300/25 bg-amber-300/10 p-3">
            <p className="text-xs text-amber-50">
              Reset Blank Project will replace every open workspace. Every dirty Image and Paper tab will be captured in bounded local recovery first.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <RecoveryButton onClick={onCancelResetProject ?? (() => undefined)}>Cancel Reset</RecoveryButton>
              <RecoveryButton onClick={onConfirmResetProject ?? (() => undefined)}>Reset with Recovery</RecoveryButton>
            </div>
          </div>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2">
          <RecoveryButton onClick={onResetBoundary}>Try Again</RecoveryButton>
          <RecoveryButton onClick={onReloadApp}>Reload App</RecoveryButton>
          <RecoveryButton onClick={onResetProject}>Reset Blank Project</RecoveryButton>
          <RecoveryButton onClick={onResetLayout}>Reset Layout</RecoveryButton>
          <RecoveryButton onClick={onClearPersistedState}>Clear Recoverable State</RecoveryButton>
          <RecoveryButton onClick={onCopyDetails}>{copied ? 'Copied Details' : 'Copy Error Details'}</RecoveryButton>
        </div>
        <p className="mt-4 text-xs text-amber-100/75">
          A render crash cannot safely offer or guarantee an asynchronous editable save. Reset Blank Project requires explicit confirmation and captures every dirty Image and Paper tab in bounded local recovery; Reset Layout and Clear Recoverable State do not clear live Paper or Image documents.
        </p>
        <p className="mt-4 text-xs text-gray-500">
          Provider and API keys are preserved by these recovery actions.
        </p>
      </div>
    </div>
  );
}

function formatCrashRecoveryResetStatus(imageCount: number, paperCount: number): string {
  if (imageCount === 0 && paperCount === 0) return 'Project reset to a blank workspace.';
  return `Project reset to a blank workspace. Captured ${imageCount} dirty Image tab${imageCount === 1 ? '' : 's'} and ${paperCount} dirty Paper tab${paperCount === 1 ? '' : 's'} in bounded local recovery.`;
}

function RecoveryButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      className="rounded-md border border-cyan-300/15 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-50 transition-colors hover:border-cyan-200/40 hover:bg-cyan-300/20"
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function didResetKeysChange(previous?: readonly unknown[], next?: readonly unknown[]): boolean {
  if (!previous || !next) return false;
  if (previous.length !== next.length) return true;
  return previous.some((value, index) => !Object.is(value, next[index]));
}
