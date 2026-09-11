import { useShallow } from 'zustand/react/shallow';
import { useFlowStore, type FlowState } from '../flowStore';

export type FlowRuntimeStoreSlice = Pick<
  FlowState,
  | 'nodes'
  | 'edges'
  | 'onNodesChange'
  | 'onEdgesChange'
  | 'onConnect'
  | 'addNode'
  | 'patchNodeData'
  | 'copySelection'
  | 'cutSelection'
  | 'pasteClipboard'
  | 'deleteSelection'
  | 'selectAllNodes'
  | 'deselectAll'
  | 'createGroupFromSelection'
  | 'collapseSelectionToFunction'
  | 'registerCenterOnNodeCallback'
  | 'insertTemplate'
>;

export function useFlowRuntimeStore(): FlowRuntimeStoreSlice {
  return useFlowStore(useShallow((state) => ({
    nodes: state.nodes,
    edges: state.edges,
    onNodesChange: state.onNodesChange,
    onEdgesChange: state.onEdgesChange,
    onConnect: state.onConnect,
    addNode: state.addNode,
    patchNodeData: state.patchNodeData,
    copySelection: state.copySelection,
    cutSelection: state.cutSelection,
    pasteClipboard: state.pasteClipboard,
    deleteSelection: state.deleteSelection,
    selectAllNodes: state.selectAllNodes,
    deselectAll: state.deselectAll,
    createGroupFromSelection: state.createGroupFromSelection,
    collapseSelectionToFunction: state.collapseSelectionToFunction,
    registerCenterOnNodeCallback: state.registerCenterOnNodeCallback,
    insertTemplate: state.insertTemplate,
  })));
}
