import { useShallow } from 'zustand/react/shallow';
import { useFlowStore, type FlowState } from '../flowStore';

export type FlowDocumentStoreSlice = Pick<
  FlowState,
  | 'exportProjectFlowSnapshot'
  | 'replaceFlowSnapshot'
  | 'restoreImportedAssets'
  | 'removeEditorSourceReferences'
>;

export function useFlowDocumentStore(): FlowDocumentStoreSlice {
  return useFlowStore(useShallow((state) => ({
    exportProjectFlowSnapshot: state.exportProjectFlowSnapshot,
    replaceFlowSnapshot: state.replaceFlowSnapshot,
    restoreImportedAssets: state.restoreImportedAssets,
    removeEditorSourceReferences: state.removeEditorSourceReferences,
  })));
}

export function getFlowDocumentStoreState(): FlowDocumentStoreSlice {
  const state = useFlowStore.getState();

  return {
    exportProjectFlowSnapshot: state.exportProjectFlowSnapshot,
    replaceFlowSnapshot: state.replaceFlowSnapshot,
    restoreImportedAssets: state.restoreImportedAssets,
    removeEditorSourceReferences: state.removeEditorSourceReferences,
  };
}

export type { FlowProjectFlowSnapshot } from '../../lib/flowProjectWorkspaces';
