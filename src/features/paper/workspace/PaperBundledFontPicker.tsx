import { useCallback, useState } from 'react';
import { BundledFontBrowser, type BundledFontSelectionAuthority } from '../../../components/Common/BundledFontBrowser';
import { installBundledPaperFontFace, type BundledFontFace, type BundledFontFamily } from '../../../lib/bundledFontLibrary';
import {
  capturePaperInspectorStoreAuthority,
  isPaperInspectorStoreAuthorityCurrent,
  usePaperStore,
} from '../../../store/paperStore';
import type { PaperImportedFont, PaperManagedFontStyle, PaperTypography } from '../../../types/paper';
import { paperAssetRepository } from '../assets/PaperAssetRuntime';
import { paperFontStyleFromCss } from '../../../lib/paperExactManagedFonts';

export function PaperBundledFontPicker({
  onChange,
  typography,
}: {
  onChange: (
    typography: PaperTypography,
    authority: BundledFontSelectionAuthority,
    installedFont: PaperImportedFont,
  ) => void | boolean | Promise<void | boolean>;
  typography: PaperTypography;
}) {
  return (
    <PaperBundledFontFaceBrowser
      fontFamily={typography.fontFamily}
      fontStyle={paperFontStyleFromCss(typography.fontStyle)}
      fontWeight={Number.parseInt(typography.fontWeight, 10) || 400}
      registerImportedFont={false}
      onSelect={(family, face, authority, installedFont) => {
        const variationSettings = Object.keys(face.axes).length
          ? Object.fromEntries(Object.entries(face.axes).map(([tag, axis]) => [tag, axis.default]))
          : undefined;
        return onChange({
          ...typography,
          fontFamily: family.family,
          fontStyle: face.style === 'oblique'
            ? (paperFontStyleFromCss(typography.fontStyle) === 'oblique' ? typography.fontStyle : 'oblique 14deg')
            : face.style,
          fontWeight: String(face.weight),
          fontStretch: `${face.stretchPercent}%`,
          ...(variationSettings ? { fontVariationSettings: variationSettings } : {}),
        }, authority, installedFont);
      }}
    />
  );
}

export function PaperBundledFontFaceBrowser({
  fontFamily,
  fontStyle,
  fontWeight,
  initiallyOpen = false,
  registerImportedFont = true,
  onSelect,
}: {
  fontFamily: string;
  fontStyle: PaperManagedFontStyle;
  fontWeight: number;
  initiallyOpen?: boolean;
  /** Inspector supplies its own one-history exact-target commit; rich toolbar retains direct registration. */
  registerImportedFont?: boolean;
  onSelect: (
    family: BundledFontFamily,
    face: BundledFontFace,
    authority: BundledFontSelectionAuthority,
    installedFont: PaperImportedFont,
  ) => void | boolean | Promise<void | boolean>;
}) {
  const addImportedFont = usePaperStore((state) => state.addImportedFont);
  const [notice, setNotice] = useState<string | null>(null);
  const selectBundledPaperFace = useCallback(async (
    family: BundledFontFamily,
    face: BundledFontFace,
    authority: BundledFontSelectionAuthority,
  ) => {
    if (!authority.isCurrent()) return;
    // Inspector defers every document mutation until its one atomic commit, so a store transition
    // during face installation is always external and revokes this operation. The rich toolbar has
    // its own live-editor transaction authority and may author intermediate state itself.
    const storeAuthority = registerImportedFont ? undefined : capturePaperInspectorStoreAuthority();
    const installed = await installBundledPaperFontFace({ family, face, repository: paperAssetRepository });
    // Pinning bytes has its own async boundary. The browser could have moved to another
    // renderer bridge while it was in flight, so no document or notice state may publish.
    if (!authority.isCurrent() || (storeAuthority && !isPaperInspectorStoreAuthorityCurrent(storeAuthority))) return;
    const committed = await onSelect(family, face, authority, installed);
    if (committed === false) return;
    if (!authority.isCurrent()) return;
    if (registerImportedFont) addImportedFont(installed);
    if (!authority.isCurrent()) return;
    setNotice(`${face.fullName} pinned to this document for exact print output.`);
  }, [addImportedFont, onSelect, registerImportedFont]);

  return (
    <div className="space-y-1.5">
      <BundledFontBrowser
        initiallyOpen={initiallyOpen}
        onSelect={selectBundledPaperFace}
        style={fontStyle}
        value={fontFamily}
        weight={fontWeight}
      />
      {notice ? <p className="text-[10px] leading-4 text-emerald-200/70">{notice}</p> : null}
    </div>
  );
}
