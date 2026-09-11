export type ManagedBundledFontStyle = 'normal' | 'italic' | 'oblique';

/** Serializable exact identity for a face shipped in Sloom Studio's audited font library. */
export interface ManagedBundledFontFaceReference {
  kind: 'bundled';
  schemaVersion: 2;
  faceId: string;
  family: string;
  weight: number;
  style: ManagedBundledFontStyle;
  /** Exact oblique descriptor; omitted only when the style is not oblique. */
  obliqueAngleDeg?: number;
  stretchPercent: number;
  /** Exact variable-font coordinates selected for this managed composition. */
  variationSettings?: Record<string, number>;
  collectionIndex: number;
  sha256: string;
  byteLength: number;
}

export type ManagedBundledFontFaceIssueReason =
  | 'invalid-reference'
  | 'legacy-reference'
  | 'typography-mismatch';

export type ManagedBundledFontSerializableValue =
  | boolean
  | number
  | string
  | null
  | ManagedBundledFontSerializableValue[]
  | { [key: string]: ManagedBundledFontSerializableValue };

/**
 * Serializable evidence that a text item previously claimed a managed face but cannot currently
 * prove an exact v2 identity. Keeping this adjacent to the text style prevents project validation
 * from silently converting previously-exact text into an ordinary family fallback.
 */
export interface ManagedBundledFontFaceIssue {
  kind: 'bundled-font-issue';
  reason: ManagedBundledFontFaceIssueReason;
  message: string;
  original: ManagedBundledFontSerializableValue;
}

export interface ManagedBundledFontFaceState {
  managedFace?: ManagedBundledFontFaceReference;
  managedFaceIssue?: ManagedBundledFontFaceIssue;
}
