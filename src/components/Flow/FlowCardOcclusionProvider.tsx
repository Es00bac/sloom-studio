import { useStore, type ReactFlowState } from '@xyflow/react';
import { createContext, useContext, type ReactNode } from 'react';
import {
  buildCardOccluderClipPath,
  collectFlowCardRects,
  FLOW_CARD_OCCLUDER_CLIP_ID,
} from './flowCardOcclusion';

/**
 * Wires only opt into card clipping when a canvas actually publishes the shared
 * occluder clip. Referencing a missing clip path would hide the wire entirely,
 * so the default stays off for canvases (and tests) without the defs mounted.
 */
const FlowCardOcclusionContext = createContext(false);

export function useFlowCardOcclusionEnabled(): boolean {
  return useContext(FlowCardOcclusionContext);
}

/** Wraps the canvas so its wires know the shared occluder clip is available. */
export function FlowCardOcclusionProvider({ children }: { children: ReactNode }) {
  return (
    <FlowCardOcclusionContext.Provider value>{children}</FlowCardOcclusionContext.Provider>
  );
}

const selectCardOccluderPath = (state: ReactFlowState): string =>
  buildCardOccluderClipPath(collectFlowCardRects(state.nodeLookup.values()));

/**
 * Publishes the "everything except node cards" clip path. Rendered as a child of
 * `ReactFlow` so it tracks live node positions; wires reference it by id, which
 * keeps every wire in sync without re-rendering them when unrelated cards move.
 */
export function FlowCardOcclusionDefs() {
  const clipPath = useStore(selectCardOccluderPath);

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute h-0 w-0 overflow-hidden"
      data-testid="flow-card-occluder-defs"
      focusable="false"
      height={0}
      width={0}
    >
      <defs>
        <clipPath clipPathUnits="userSpaceOnUse" id={FLOW_CARD_OCCLUDER_CLIP_ID}>
          <path clipRule="evenodd" d={clipPath} />
        </clipPath>
      </defs>
    </svg>
  );
}
