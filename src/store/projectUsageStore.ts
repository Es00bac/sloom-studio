import { create } from 'zustand';
import {
  appendProjectUsageEntry,
  createProjectUsageEntryFromTelemetry,
  sanitizeProjectUsageLedgerSnapshot,
  summarizeProjectUsageLedger,
  type ProjectUsageLedgerSnapshot,
  type ProjectUsageLedgerSummary,
} from '../lib/projectUsageLedger';
import { refreshProviderBalances, type ProviderBalance } from '../lib/providerBalance';
import type { ApiKeys, FlowNodeType, NodeData, UsageTelemetry, WorkspaceView } from '../types/flow';

interface RecordUsageInput {
  nodeId?: string;
  nodeType?: FlowNodeType;
  nodeData?: Pick<NodeData, 'imageOperation' | 'audioGenerationMode' | 'mediaMode' | 'mode'>;
  workspace: WorkspaceView;
  flowWorkspaceId?: string;
  flowWorkspaceName?: string;
  usage: UsageTelemetry;
  createdAt?: number;
  operation?: string;
}

interface ProjectUsageState {
  ledger: ProjectUsageLedgerSnapshot;
  summary: ProjectUsageLedgerSummary;
  balances: ProviderBalance[];
  balancesLoading: boolean;
  recordUsage: (input: RecordUsageInput) => void;
  exportSnapshot: () => ProjectUsageLedgerSnapshot;
  restoreSnapshot: (snapshot?: ProjectUsageLedgerSnapshot) => void;
  refreshBalances: (apiKeys: Pick<ApiKeys, 'bfl' | 'stability'> & Partial<ApiKeys>) => Promise<void>;
}

const EMPTY_LEDGER: ProjectUsageLedgerSnapshot = { version: 1, entries: [] };

export const useProjectUsageStore = create<ProjectUsageState>()((set, get) => ({
  ledger: EMPTY_LEDGER,
  summary: summarizeProjectUsageLedger(EMPTY_LEDGER),
  balances: [],
  balancesLoading: false,
  recordUsage: (input) => {
    const entry = createProjectUsageEntryFromTelemetry(input);
    const ledger = appendProjectUsageEntry(get().ledger, entry);
    set({
      ledger,
      summary: summarizeProjectUsageLedger(ledger),
    });
  },
  exportSnapshot: () => sanitizeProjectUsageLedgerSnapshot(get().ledger),
  restoreSnapshot: (snapshot) => {
    const ledger = sanitizeProjectUsageLedgerSnapshot(snapshot);
    set({
      ledger,
      summary: summarizeProjectUsageLedger(ledger),
    });
  },
  refreshBalances: async (apiKeys) => {
    set({ balancesLoading: true });
    try {
      set({ balances: await refreshProviderBalances(apiKeys) });
    } finally {
      set({ balancesLoading: false });
    }
  },
}));
