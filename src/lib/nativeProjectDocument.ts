import { buildCurrentProjectDocument } from './projectDocumentActions';
import type { FlowProjectDocument } from './projectLibrary';

export function buildNativeSaveProjectDocument(name?: string): Promise<FlowProjectDocument> {
  return buildCurrentProjectDocument({
    name,
    includeAssetData: true,
  });
}
