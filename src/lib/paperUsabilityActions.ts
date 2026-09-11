import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import type {
  PaperDocument,
  PaperFrame,
  PaperFrameKind,
  PaperFramePatch,
  PaperFrameVertex,
} from '../types/paper';
import {
  addFrameToPaperPage,
  duplicatePaperPage,
  nextPaperFrameZIndex,
  placeSourceAssetInPaperFrame,
} from './paperDocument';
import { paperBarcodeSymbolSizeMm } from './paperBarcode';
import type { PaperPoint } from './paperLayoutTools';

export type PaperFrameContextActionId =
  | 'bring-to-front'
  | 'bring-forward'
  | 'send-backward'
  | 'send-to-back'
  | 'duplicate-frame'
  | 'delete-frame'
  | 'lock-frame'
  | 'unlock-frame'
  | 'snap-to-grid'
  | 'center-on-page'
  | 'center-horizontally'
  | 'center-vertically'
  | 'fit-to-margins'
  | 'fill-page'
  | 'reset-frame-rotation'
  | 'rotate-frame-90'
  | 'rotate-frame-minus-90'
  | 'convert-to-text'
  | 'convert-to-image'
  | 'convert-to-panel'
  | 'convert-to-speech'
  | 'convert-to-thought'
  | 'convert-to-caption'
  | 'convert-to-barcode'
  | 'fit-image-cover'
  | 'fit-image-contain'
  | 'fit-image-stretch'
  | 'reset-image-crop'
  | 'image-zoom-in'
  | 'image-zoom-out'
  | 'rotate-image-90'
  | 'clear-asset'
  | 'border-solid'
  | 'border-dashed'
  | 'border-dotted'
  | 'border-thinner'
  | 'border-thicker'
  | 'border-black'
  | 'border-cyan'
  | 'border-magenta'
  | 'fill-none'
  | 'fill-white'
  | 'fill-comic-yellow'
  | 'opacity-100'
  | 'opacity-75'
  | 'opacity-50'
  | 'opacity-25'
  | 'toggle-gradient-fill'
  | 'gradient-cyan-magenta'
  | 'gradient-warm'
  | 'gradient-cool'
  | 'style-caption'
  | 'style-speech-bubble'
  | 'style-thought-bubble'
  | 'bubble-organic'
  | 'bubble-oval'
  | 'bubble-cloud'
  | 'bubble-wide-tail'
  | 'bubble-narrow-tail'
  | 'bubble-soft-warp'
  | 'bubble-strong-warp'
  | 'tail-bottom-left'
  | 'tail-bottom-center'
  | 'tail-bottom-right';

export type PaperPageContextActionId =
  | 'add-text-here'
  | 'add-image-here'
  | 'add-document-here'
  | 'add-panel-here'
  | 'add-speech-here'
  | 'add-thought-here'
  | 'add-caption-here'
  | 'add-shape-here'
  | 'add-barcode-here'
  | 'add-page-after'
  | 'duplicate-page';

export interface PaperContextActionDefinition<TActionId extends string> {
  id: TActionId;
  label: string;
  /** Japanese label (interface language 'ja'); English `label` is the fallback. */
  labelJa?: string;
  group: string;
}

export interface PaperActionResult {
  document: PaperDocument;
  selectedFrameId?: string | null;
  selectedPageId?: string;
}

/** Japanese labels for the context-action group headers (English key is the fallback). */
export const PAPER_ACTION_GROUP_LABELS_JA: Record<string, string> = {
  Border: '境界線',
  Comic: 'コミック',
  Convert: '変換',
  Edit: '編集',
  Fill: '塗り',
  Geometry: '配置',
  Image: '画像',
  Insert: '挿入',
  Page: 'ページ',
  Stacking: '重ね順',
};

/** Resolve a context-action label for the interface language (falls back to English). */
export function paperActionLabel(action: { label: string; labelJa?: string }, locale: 'en' | 'ja'): string {
  return locale === 'ja' && action.labelJa ? action.labelJa : action.label;
}

/** Resolve a context-action group header for the interface language (falls back to English). */
export function paperActionGroupLabel(group: string, locale: 'en' | 'ja'): string {
  return locale === 'ja' ? PAPER_ACTION_GROUP_LABELS_JA[group] ?? group : group;
}

export const PAPER_FRAME_CONTEXT_ACTIONS: Array<PaperContextActionDefinition<PaperFrameContextActionId>> = [
  { id: 'bring-to-front', label: 'Bring to Front', labelJa: '最前面へ', group: 'Stacking' },
  { id: 'bring-forward', label: 'Bring Forward', labelJa: '前面へ', group: 'Stacking' },
  { id: 'send-backward', label: 'Send Backward', labelJa: '背面へ', group: 'Stacking' },
  { id: 'send-to-back', label: 'Send to Back', labelJa: '最背面へ', group: 'Stacking' },
  { id: 'duplicate-frame', label: 'Duplicate Frame', labelJa: 'フレームを複製', group: 'Edit' },
  { id: 'delete-frame', label: 'Delete Frame', labelJa: 'フレームを削除', group: 'Edit' },
  { id: 'lock-frame', label: 'Lock Frame', labelJa: 'フレームをロック', group: 'Edit' },
  { id: 'unlock-frame', label: 'Unlock Frame', labelJa: 'フレームのロック解除', group: 'Edit' },
  { id: 'snap-to-grid', label: 'Snap to Grid', labelJa: 'グリッドにスナップ', group: 'Geometry' },
  { id: 'center-on-page', label: 'Center on Page', labelJa: 'ページ中央に配置', group: 'Geometry' },
  { id: 'center-horizontally', label: 'Center Horizontally', labelJa: '水平方向に中央揃え', group: 'Geometry' },
  { id: 'center-vertically', label: 'Center Vertically', labelJa: '垂直方向に中央揃え', group: 'Geometry' },
  { id: 'fit-to-margins', label: 'Fit to Margins', labelJa: 'マージンに合わせる', group: 'Geometry' },
  { id: 'fill-page', label: 'Fill Page', labelJa: 'ページ全体に広げる', group: 'Geometry' },
  { id: 'reset-frame-rotation', label: 'Reset Rotation', labelJa: '回転をリセット', group: 'Geometry' },
  { id: 'rotate-frame-90', label: 'Rotate Frame 90', labelJa: 'フレームを90°回転', group: 'Geometry' },
  { id: 'rotate-frame-minus-90', label: 'Rotate Frame -90', labelJa: 'フレームを-90°回転', group: 'Geometry' },
  { id: 'convert-to-text', label: 'Convert to Text Frame', labelJa: 'テキストフレームに変換', group: 'Convert' },
  { id: 'convert-to-image', label: 'Convert to Image Frame', labelJa: '画像フレームに変換', group: 'Convert' },
  { id: 'convert-to-panel', label: 'Convert to Comic Panel', labelJa: 'コマに変換', group: 'Convert' },
  { id: 'convert-to-speech', label: 'Convert to Speech Bubble', labelJa: '吹き出しに変換', group: 'Convert' },
  { id: 'convert-to-thought', label: 'Convert to Thought Bubble', labelJa: '思考の吹き出しに変換', group: 'Convert' },
  { id: 'convert-to-caption', label: 'Convert to Caption', labelJa: 'キャプションに変換', group: 'Convert' },
  { id: 'convert-to-barcode', label: 'Convert to ISBN Barcode', labelJa: 'ISBNバーコードに変換', group: 'Convert' },
  { id: 'fit-image-cover', label: 'Image Fit: Cover', labelJa: '画像の合わせ方：切り抜き', group: 'Image' },
  { id: 'fit-image-contain', label: 'Image Fit: Contain', labelJa: '画像の合わせ方：全体表示', group: 'Image' },
  { id: 'fit-image-stretch', label: 'Image Fit: Stretch', labelJa: '画像の合わせ方：引き伸ばし', group: 'Image' },
  { id: 'reset-image-crop', label: 'Reset Image Crop', labelJa: '画像の切り抜きをリセット', group: 'Image' },
  { id: 'image-zoom-in', label: 'Zoom Image In', labelJa: '画像を拡大', group: 'Image' },
  { id: 'image-zoom-out', label: 'Zoom Image Out', labelJa: '画像を縮小', group: 'Image' },
  { id: 'rotate-image-90', label: 'Rotate Image 90', labelJa: '画像を90°回転', group: 'Image' },
  { id: 'clear-asset', label: 'Clear Placed Asset', labelJa: '配置したアセットをクリア', group: 'Image' },
  { id: 'border-solid', label: 'Solid Border', labelJa: '実線の境界線', group: 'Border' },
  { id: 'border-dashed', label: 'Dashed Border', labelJa: '破線の境界線', group: 'Border' },
  { id: 'border-dotted', label: 'Dotted Border', labelJa: '点線の境界線', group: 'Border' },
  { id: 'border-thinner', label: 'Thinner Border', labelJa: '境界線を細く', group: 'Border' },
  { id: 'border-thicker', label: 'Thicker Border', labelJa: '境界線を太く', group: 'Border' },
  { id: 'border-black', label: 'Black Border', labelJa: '黒い境界線', group: 'Border' },
  { id: 'border-cyan', label: 'Cyan Border', labelJa: 'シアンの境界線', group: 'Border' },
  { id: 'border-magenta', label: 'Magenta Border', labelJa: 'マゼンタの境界線', group: 'Border' },
  { id: 'fill-none', label: 'Transparent Fill', labelJa: '透明な塗り', group: 'Fill' },
  { id: 'fill-white', label: 'White Fill', labelJa: '白の塗り', group: 'Fill' },
  { id: 'fill-comic-yellow', label: 'Comic Yellow Fill', labelJa: 'コミックイエローで塗り', group: 'Fill' },
  { id: 'opacity-100', label: 'Opacity 100%', labelJa: '不透明度 100%', group: 'Fill' },
  { id: 'opacity-75', label: 'Opacity 75%', labelJa: '不透明度 75%', group: 'Fill' },
  { id: 'opacity-50', label: 'Opacity 50%', labelJa: '不透明度 50%', group: 'Fill' },
  { id: 'opacity-25', label: 'Opacity 25%', labelJa: '不透明度 25%', group: 'Fill' },
  { id: 'toggle-gradient-fill', label: 'Toggle Gradient Fill', labelJa: 'グラデーション塗りの切り替え', group: 'Fill' },
  { id: 'gradient-cyan-magenta', label: 'Cyan to Magenta Gradient', labelJa: 'シアン→マゼンタのグラデーション', group: 'Fill' },
  { id: 'gradient-warm', label: 'Warm Gradient', labelJa: 'ウォームなグラデーション', group: 'Fill' },
  { id: 'gradient-cool', label: 'Cool Gradient', labelJa: 'クールなグラデーション', group: 'Fill' },
  { id: 'style-caption', label: 'Caption Style', labelJa: 'キャプションスタイル', group: 'Comic' },
  { id: 'style-speech-bubble', label: 'Speech Bubble Style', labelJa: '吹き出しスタイル', group: 'Comic' },
  { id: 'style-thought-bubble', label: 'Thought Bubble Style', labelJa: '思考の吹き出しスタイル', group: 'Comic' },
  { id: 'bubble-organic', label: 'Organic Bubble', labelJa: '有機的な吹き出し', group: 'Comic' },
  { id: 'bubble-oval', label: 'Plain Oval Bubble', labelJa: '楕円の吹き出し', group: 'Comic' },
  { id: 'bubble-cloud', label: 'Cloud Bubble', labelJa: '雲形の吹き出し', group: 'Comic' },
  { id: 'bubble-wide-tail', label: 'Wider Tail', labelJa: 'しっぽを太く', group: 'Comic' },
  { id: 'bubble-narrow-tail', label: 'Narrower Tail', labelJa: 'しっぽを細く', group: 'Comic' },
  { id: 'bubble-soft-warp', label: 'Softer Bubble Warp', labelJa: '吹き出しの歪みを弱める', group: 'Comic' },
  { id: 'bubble-strong-warp', label: 'Stronger Bubble Warp', labelJa: '吹き出しの歪みを強める', group: 'Comic' },
  { id: 'tail-bottom-left', label: 'Tail Bottom Left', labelJa: 'しっぽ：左下', group: 'Comic' },
  { id: 'tail-bottom-center', label: 'Tail Bottom Center', labelJa: 'しっぽ：下中央', group: 'Comic' },
  { id: 'tail-bottom-right', label: 'Tail Bottom Right', labelJa: 'しっぽ：右下', group: 'Comic' },
];

export const PAPER_PAGE_CONTEXT_ACTIONS: Array<PaperContextActionDefinition<PaperPageContextActionId>> = [
  { id: 'add-text-here', label: 'Add Text Frame Here', labelJa: 'テキストフレームを追加', group: 'Insert' },
  { id: 'add-image-here', label: 'Add Image Frame Here', labelJa: '画像フレームを追加', group: 'Insert' },
  { id: 'add-document-here', label: 'Add Document Frame Here', labelJa: 'ドキュメントフレームを追加', group: 'Insert' },
  { id: 'add-panel-here', label: 'Add Comic Panel Here', labelJa: 'コマを追加', group: 'Insert' },
  { id: 'add-speech-here', label: 'Add Speech Bubble Here', labelJa: '吹き出しを追加', group: 'Insert' },
  { id: 'add-thought-here', label: 'Add Thought Bubble Here', labelJa: '思考の吹き出しを追加', group: 'Insert' },
  { id: 'add-caption-here', label: 'Add Caption Here', labelJa: 'キャプションを追加', group: 'Insert' },
  { id: 'add-shape-here', label: 'Add Polygon Shape Here', labelJa: '多角形シェイプを追加', group: 'Insert' },
  { id: 'add-barcode-here', label: 'Add ISBN Barcode Here', labelJa: 'ISBNバーコードを追加', group: 'Insert' },
  { id: 'add-page-after', label: 'Add Page After', labelJa: '後にページを追加', group: 'Page' },
  { id: 'duplicate-page', label: 'Duplicate Page', labelJa: 'ページを複製', group: 'Page' },
];

export function applyPaperFrameContextAction(
  doc: PaperDocument,
  pageId: string,
  frameIdOrActionId: string,
  actionId?: PaperFrameContextActionId,
): PaperActionResult {
  const page = doc.pages.find((candidate) => candidate.id === pageId);
  const frameId = actionId ? frameIdOrActionId : page?.frames[0]?.id;
  const resolvedActionId = actionId ?? (frameIdOrActionId as PaperFrameContextActionId);
  if (!page || !frameId) return { document: doc };
  const frame = page.frames.find((candidate) => candidate.id === frameId);
  if (!frame) return { document: doc };

  if (isStackingAction(resolvedActionId)) {
    return {
      document: withUpdatedPage(doc, pageId, {
        frames: reorderFrames(page.frames, frameId, resolvedActionId),
      }),
      selectedFrameId: frameId,
    };
  }

  switch (resolvedActionId) {
    case 'duplicate-frame':
      return duplicateFrame(doc, pageId, frame);
    case 'delete-frame':
      return {
        document: withUpdatedPage(doc, pageId, {
          frames: normalizeFrameStack(page.frames.filter((candidate) => candidate.id !== frameId)),
        }),
        selectedFrameId: null,
      };
    case 'lock-frame':
      return patchFrame(doc, pageId, frameId, { locked: true });
    case 'unlock-frame':
      return patchFrame(doc, pageId, frameId, { locked: false });
    case 'snap-to-grid':
      return patchFrame(doc, pageId, frameId, snapFrameToGrid(frame, gridSizeForDocument(doc)));
    case 'center-on-page':
      return patchFrame(doc, pageId, frameId, {
        xMm: roundMm((doc.page.widthMm - frame.widthMm) / 2),
        yMm: roundMm((doc.page.heightMm - frame.heightMm) / 2),
      });
    case 'center-horizontally':
      return patchFrame(doc, pageId, frameId, {
        xMm: roundMm((doc.page.widthMm - frame.widthMm) / 2),
      });
    case 'center-vertically':
      return patchFrame(doc, pageId, frameId, {
        yMm: roundMm((doc.page.heightMm - frame.heightMm) / 2),
      });
    case 'fit-to-margins':
      return patchFrame(doc, pageId, frameId, {
        xMm: doc.layout.marginsMm.left,
        yMm: doc.layout.marginsMm.top,
        widthMm: roundMm(doc.page.widthMm - doc.layout.marginsMm.left - doc.layout.marginsMm.right),
        heightMm: roundMm(doc.page.heightMm - doc.layout.marginsMm.top - doc.layout.marginsMm.bottom),
      });
    case 'fill-page':
      return patchFrame(doc, pageId, frameId, {
        xMm: 0,
        yMm: 0,
        widthMm: doc.page.widthMm,
        heightMm: doc.page.heightMm,
      });
    case 'reset-frame-rotation':
      return patchFrame(doc, pageId, frameId, { rotationDeg: 0 });
    case 'rotate-frame-90':
      return patchFrame(doc, pageId, frameId, { rotationDeg: normalizeDegrees(frame.rotationDeg + 90) });
    case 'rotate-frame-minus-90':
      return patchFrame(doc, pageId, frameId, { rotationDeg: normalizeDegrees(frame.rotationDeg - 90) });
    case 'convert-to-text':
      return patchFrame(doc, pageId, frameId, frameKindPatch(frame, 'text'));
    case 'convert-to-image':
      return patchFrame(doc, pageId, frameId, frameKindPatch(frame, 'image'));
    case 'convert-to-panel':
      return patchFrame(doc, pageId, frameId, frameKindPatch(frame, 'panel'));
    case 'convert-to-speech':
      return patchFrame(doc, pageId, frameId, frameKindPatch(frame, 'speechBubble'));
    case 'convert-to-thought':
      return patchFrame(doc, pageId, frameId, frameKindPatch(frame, 'thoughtBubble'));
    case 'convert-to-caption':
      return patchFrame(doc, pageId, frameId, frameKindPatch(frame, 'caption'));
    case 'convert-to-barcode':
      return patchFrame(doc, pageId, frameId, frameKindPatch(frame, 'barcode'));
    case 'fit-image-cover':
      return patchFrame(doc, pageId, frameId, { fit: 'cover' });
    case 'fit-image-contain':
      return patchFrame(doc, pageId, frameId, { fit: 'contain' });
    case 'fit-image-stretch':
      return patchFrame(doc, pageId, frameId, { fit: 'stretch' });
    case 'reset-image-crop':
      return patchFrame(doc, pageId, frameId, {
        imageScale: 1,
        imageOffsetXPercent: 0,
        imageOffsetYPercent: 0,
        imageRotationDeg: 0,
        imageFlipX: false,
        imageFlipY: false,
      });
    case 'image-zoom-in':
      return patchFrame(doc, pageId, frameId, { imageScale: roundScale(frame.imageScale + 0.1) });
    case 'image-zoom-out':
      return patchFrame(doc, pageId, frameId, { imageScale: roundScale(frame.imageScale - 0.1) });
    case 'rotate-image-90':
      return patchFrame(doc, pageId, frameId, { imageRotationDeg: normalizeDegrees(frame.imageRotationDeg + 90) });
    case 'clear-asset':
      return patchFrame(doc, pageId, frameId, { asset: undefined });
    case 'border-solid':
      return patchFrame(doc, pageId, frameId, { strokeStyle: 'solid' });
    case 'border-dashed':
      return patchFrame(doc, pageId, frameId, { strokeStyle: 'dashed' });
    case 'border-dotted':
      return patchFrame(doc, pageId, frameId, { strokeStyle: 'dotted' });
    case 'border-thinner':
      return patchFrame(doc, pageId, frameId, { strokeWidthMm: roundMm(Math.max(0, frame.strokeWidthMm - 0.2)) });
    case 'border-thicker':
      return patchFrame(doc, pageId, frameId, { strokeWidthMm: roundMm(frame.strokeWidthMm + 0.25) });
    case 'border-black':
      return patchFrame(doc, pageId, frameId, { strokeColor: '#111827', strokeOpacity: 1 });
    case 'border-cyan':
      return patchFrame(doc, pageId, frameId, { strokeColor: '#0891b2', strokeOpacity: 1 });
    case 'border-magenta':
      return patchFrame(doc, pageId, frameId, { strokeColor: '#c026d3', strokeOpacity: 1 });
    case 'fill-none':
      return patchFrame(doc, pageId, frameId, { fillColor: 'transparent', fillGradient: undefined });
    case 'fill-white':
      return patchFrame(doc, pageId, frameId, { fillColor: '#ffffff', fillOpacity: 1, fillGradient: undefined });
    case 'fill-comic-yellow':
      return patchFrame(doc, pageId, frameId, { fillColor: '#fff4bf', fillOpacity: 1, fillGradient: undefined });
    case 'opacity-100':
      return patchFrame(doc, pageId, frameId, { opacity: 1, fillOpacity: 1, strokeOpacity: 1 });
    case 'opacity-75':
      return patchFrame(doc, pageId, frameId, { opacity: 0.75, fillOpacity: 0.75, strokeOpacity: 0.75 });
    case 'opacity-50':
      return patchFrame(doc, pageId, frameId, { opacity: 0.5, fillOpacity: 0.5, strokeOpacity: 0.5 });
    case 'opacity-25':
      return patchFrame(doc, pageId, frameId, { opacity: 0.25, fillOpacity: 0.25, strokeOpacity: 0.25 });
    case 'toggle-gradient-fill':
      return patchFrame(doc, pageId, frameId, {
        fillGradient: frame.fillGradient
          ? undefined
          : { type: 'linear', fromColor: '#67e8f9', toColor: '#f9a8d4', angleDeg: 135 },
      });
    case 'gradient-cyan-magenta':
      return patchFrame(doc, pageId, frameId, {
        fillGradient: { type: 'linear', fromColor: '#67e8f9', toColor: '#f9a8d4', angleDeg: 135 },
        fillOpacity: 1,
      });
    case 'gradient-warm':
      return patchFrame(doc, pageId, frameId, {
        fillGradient: { type: 'linear', fromColor: '#fde68a', toColor: '#fb7185', angleDeg: 120 },
        fillOpacity: 1,
      });
    case 'gradient-cool':
      return patchFrame(doc, pageId, frameId, {
        fillGradient: { type: 'linear', fromColor: '#bfdbfe', toColor: '#99f6e4', angleDeg: 120 },
        fillOpacity: 1,
      });
    case 'style-caption':
      return patchFrame(doc, pageId, frameId, frameKindPatch(frame, 'caption'));
    case 'style-speech-bubble':
      return patchFrame(doc, pageId, frameId, frameKindPatch(frame, 'speechBubble'));
    case 'style-thought-bubble':
      return patchFrame(doc, pageId, frameId, frameKindPatch(frame, 'thoughtBubble'));
    case 'bubble-organic':
      return patchFrame(doc, pageId, frameId, { kind: 'speechBubble', bubbleShape: 'organic', bubbleWarp: 0.18 });
    case 'bubble-oval':
      return patchFrame(doc, pageId, frameId, { kind: 'speechBubble', bubbleShape: 'oval', bubbleWarp: 0 });
    case 'bubble-cloud':
      return patchFrame(doc, pageId, frameId, { kind: 'thoughtBubble', bubbleShape: 'cloud', bubbleWarp: 0.2 });
    case 'bubble-wide-tail':
      return patchFrame(doc, pageId, frameId, { bubbleTailWidthPercent: Math.min(38, (frame.bubbleTailWidthPercent ?? 18) + 6) });
    case 'bubble-narrow-tail':
      return patchFrame(doc, pageId, frameId, { bubbleTailWidthPercent: Math.max(5, (frame.bubbleTailWidthPercent ?? 18) - 6) });
    case 'bubble-soft-warp':
      return patchFrame(doc, pageId, frameId, { bubbleWarp: Math.max(-0.35, (frame.bubbleWarp ?? 0.18) - 0.08) });
    case 'bubble-strong-warp':
      return patchFrame(doc, pageId, frameId, { bubbleWarp: Math.min(0.5, (frame.bubbleWarp ?? 0.18) + 0.08) });
    case 'tail-bottom-left':
      return patchFrame(doc, pageId, frameId, { tailXPercent: 22, tailYPercent: 92 });
    case 'tail-bottom-center':
      return patchFrame(doc, pageId, frameId, { tailXPercent: 50, tailYPercent: 94 });
    case 'tail-bottom-right':
      return patchFrame(doc, pageId, frameId, { tailXPercent: 78, tailYPercent: 92 });
  }
}

export function applyPaperFrameGroupContextAction(
  doc: PaperDocument,
  pageId: string,
  frameIds: string[],
  actionId: PaperFrameContextActionId,
): PaperActionResult {
  const page = doc.pages.find((candidate) => candidate.id === pageId);
  const selectedFrameIds = page
    ? frameIds.filter((frameId, index) =>
      frameIds.indexOf(frameId) === index && page.frames.some((frame) => frame.id === frameId),
    )
    : [];
  const anchorFrameId = selectedFrameIds[selectedFrameIds.length - 1];
  if (!page || !anchorFrameId) return { document: doc };
  if (!isStackingAction(actionId) || selectedFrameIds.length < 2) {
    return applyPaperFrameContextAction(doc, pageId, anchorFrameId, actionId);
  }

  return {
    document: withUpdatedPage(doc, pageId, {
      frames: reorderFrameGroup(page.frames, selectedFrameIds, actionId),
    }),
    selectedFrameId: anchorFrameId,
    selectedPageId: pageId,
  };
}

export function applyPaperPageContextAction(
  doc: PaperDocument,
  pageId: string,
  actionId: PaperPageContextActionId,
  options: {
    point?: PaperPoint;
    sourceItem?: SourceBinLibraryItem;
  } = {},
): PaperActionResult {
  if (!doc.pages.some((candidate) => candidate.id === pageId)) return { document: doc };

  if (actionId === 'add-page-after') {
    const added = addPageAfter(doc, pageId);
    return { document: added.document, selectedPageId: added.selectedPageId, selectedFrameId: null };
  }

  if (actionId === 'duplicate-page') {
    const document = duplicatePaperPage(doc, pageId);
    return {
      document,
      selectedPageId: document.pages[document.pages.length - 1]?.id ?? pageId,
      selectedFrameId: null,
    };
  }

  const point = options.point ?? { xMm: doc.layout.marginsMm.left, yMm: doc.layout.marginsMm.top };
  const kind = pageActionKind(actionId);
  const added = addFrameToPaperPage(doc, pageId, {
    ...frameDefaultsForKind(kind, point),
    label: options.sourceItem?.label,
  });
  const placedDocument = options.sourceItem
    ? placeSourceAssetInPaperFrame(added.document, {
        pageId,
        frameId: added.frameId,
        item: options.sourceItem,
      })
    : added.document;

  return {
    document: normalizePageFrameStack(placedDocument, pageId),
    selectedFrameId: added.frameId,
    selectedPageId: pageId,
  };
}

export function addPaperPolygonShapeFrame(
  doc: PaperDocument,
  pageId: string,
  points: PaperPoint[],
): PaperActionResult {
  if (points.length < 3 || !doc.pages.some((candidate) => candidate.id === pageId)) {
    return { document: doc };
  }

  const minX = Math.min(...points.map((point) => point.xMm));
  const minY = Math.min(...points.map((point) => point.yMm));
  const maxX = Math.max(...points.map((point) => point.xMm));
  const maxY = Math.max(...points.map((point) => point.yMm));
  const widthMm = Math.max(1, roundMm(maxX - minX));
  const heightMm = Math.max(1, roundMm(maxY - minY));
  const vertices: PaperFrameVertex[] = points.map((point) => ({
    xPercent: roundMm(((point.xMm - minX) / widthMm) * 100),
    yPercent: roundMm(((point.yMm - minY) / heightMm) * 100),
  }));
  const added = addFrameToPaperPage(doc, pageId, {
    kind: 'shape',
    label: points.length === 3 ? 'Triangle Shape' : 'Polygon Shape',
    xMm: roundMm(minX),
    yMm: roundMm(minY),
    widthMm,
    heightMm,
    vertices,
    fillColor: '#e0f2fe',
    strokeColor: '#111827',
    strokeWidthMm: 0.35,
    strokeStyle: 'solid',
  });

  return {
    document: normalizePageFrameStack(added.document, pageId),
    selectedFrameId: added.frameId,
    selectedPageId: pageId,
  };
}

export function nudgePaperFrame(
  doc: PaperDocument,
  pageId: string,
  frameId: string,
  deltaXMm: number,
  deltaYMm: number,
): PaperActionResult {
  const page = doc.pages.find((candidate) => candidate.id === pageId);
  const frame = page?.frames.find((candidate) => candidate.id === frameId);
  if (!page || !frame || frame.locked) return { document: doc, selectedFrameId: frameId, selectedPageId: pageId };

  return patchFrame(doc, pageId, frameId, {
    xMm: roundMm(frame.xMm + deltaXMm),
    yMm: roundMm(frame.yMm + deltaYMm),
  });
}

export function placeSourceAssetOnPaperPage(
  doc: PaperDocument,
  {
    pageId,
    frameId,
    item,
    point,
  }: {
    pageId: string;
    frameId?: string | null;
    item: SourceBinLibraryItem;
    point?: PaperPoint;
  },
): PaperActionResult {
  if (frameId) {
    return {
      document: placeSourceAssetInPaperFrame(doc, { pageId, frameId, item }),
      selectedFrameId: frameId,
      selectedPageId: pageId,
    };
  }

  return applyPaperPageContextAction(
    doc,
    pageId,
    item.kind === 'text' || (item.kind === 'document' && item.text) ? 'add-text-here' : item.kind === 'document' ? 'add-document-here' : 'add-image-here',
    { point, sourceItem: item },
  );
}

function duplicateFrame(doc: PaperDocument, pageId: string, frame: PaperFrame): PaperActionResult {
  const page = doc.pages.find((candidate) => candidate.id === pageId);
  if (!page) return { document: doc };

  const cloneId = makeId('frame-copy');
  const clone: PaperFrame = {
    ...frame,
    id: cloneId,
    label: `${frame.label} copy`,
    xMm: roundMm(frame.xMm + 4),
    yMm: roundMm(frame.yMm + 4),
    zIndex: nextPaperFrameZIndex(page.frames),
    locked: false,
  };

  return {
    document: withUpdatedPage(doc, pageId, {
      frames: normalizeFrameStack([...page.frames, clone]),
    }),
    selectedFrameId: cloneId,
  };
}

function reorderFrames(
  frames: PaperFrame[],
  frameId: string,
  actionId: Extract<PaperFrameContextActionId, 'bring-to-front' | 'bring-forward' | 'send-backward' | 'send-to-back'>,
): PaperFrame[] {
  const sorted = normalizeFrameStack(frames).sort((a, b) => a.zIndex - b.zIndex);
  const index = sorted.findIndex((frame) => frame.id === frameId);
  if (index === -1) return sorted;
  const [target] = sorted.splice(index, 1);

  if (actionId === 'bring-to-front') {
    sorted.push(target);
  } else if (actionId === 'send-to-back') {
    sorted.unshift(target);
  } else if (actionId === 'bring-forward') {
    sorted.splice(Math.min(sorted.length, index + 1), 0, target);
  } else {
    sorted.splice(Math.max(0, index - 1), 0, target);
  }

  return sorted.map((frame, zIndex) => ({ ...frame, zIndex }));
}

function reorderFrameGroup(
  frames: PaperFrame[],
  frameIds: string[],
  actionId: Extract<PaperFrameContextActionId, 'bring-to-front' | 'bring-forward' | 'send-backward' | 'send-to-back'>,
): PaperFrame[] {
  const selected = new Set(frameIds);
  const sorted = normalizeFrameStack(frames).sort((a, b) => a.zIndex - b.zIndex);
  const group = sorted.filter((frame) => selected.has(frame.id));
  if (group.length < 2) return sorted;
  const remaining = sorted.filter((frame) => !selected.has(frame.id));

  if (actionId === 'bring-to-front') {
    return assignFrameStackOrder([...remaining, ...group]);
  }

  if (actionId === 'send-to-back') {
    return assignFrameStackOrder([...group, ...remaining]);
  }

  const selectedIndexes = sorted
    .map((frame, index) => selected.has(frame.id) ? index : -1)
    .filter((index) => index >= 0);

  if (actionId === 'bring-forward') {
    const highestSelectedIndex = Math.max(...selectedIndexes);
    const nextUnselected = sorted.find((frame, index) => index > highestSelectedIndex && !selected.has(frame.id));
    if (!nextUnselected) return sorted;
    const targetIndex = remaining.findIndex((frame) => frame.id === nextUnselected.id);
    return assignFrameStackOrder([
      ...remaining.slice(0, targetIndex + 1),
      ...group,
      ...remaining.slice(targetIndex + 1),
    ]);
  }

  const lowestSelectedIndex = Math.min(...selectedIndexes);
  const previousUnselected = [...sorted]
    .slice(0, lowestSelectedIndex)
    .reverse()
    .find((frame) => !selected.has(frame.id));
  if (!previousUnselected) return sorted;
  const targetIndex = remaining.findIndex((frame) => frame.id === previousUnselected.id);
  return assignFrameStackOrder([
    ...remaining.slice(0, targetIndex),
    ...group,
    ...remaining.slice(targetIndex),
  ]);
}

function assignFrameStackOrder(frames: PaperFrame[]): PaperFrame[] {
  return frames.map((frame, zIndex) => ({ ...frame, zIndex }));
}

function patchFrame(
  doc: PaperDocument,
  pageId: string,
  frameId: string,
  patch: PaperFramePatch,
): PaperActionResult {
  return {
    document: withUpdatedPage(doc, pageId, {
      frames: doc.pages
        .find((page) => page.id === pageId)
        ?.frames.map((frame) =>
          frame.id === frameId
            ? {
                ...frame,
                ...patch,
                typography: patch.typography
                  ? { ...frame.typography, ...patch.typography }
                  : frame.typography,
              }
            : frame,
        ) ?? [],
    }),
    selectedFrameId: frameId,
    selectedPageId: pageId,
  };
}

function withUpdatedPage(
  doc: PaperDocument,
  pageId: string,
  patch: Partial<PaperDocument['pages'][number]>,
): PaperDocument {
  return {
    ...doc,
    updatedAt: Date.now(),
    pages: doc.pages.map((page) => (page.id === pageId ? { ...page, ...patch } : page)),
  };
}

function normalizePageFrameStack(doc: PaperDocument, pageId: string): PaperDocument {
  const page = doc.pages.find((candidate) => candidate.id === pageId);
  if (!page) return doc;
  return withUpdatedPage(doc, pageId, { frames: normalizeFrameStack(page.frames) });
}

function normalizeFrameStack(frames: PaperFrame[]): PaperFrame[] {
  return [...frames]
    .sort((a, b) => (a.zIndex === b.zIndex ? frames.indexOf(a) - frames.indexOf(b) : a.zIndex - b.zIndex))
    .map((frame, zIndex) => ({ ...frame, zIndex }));
}

function isStackingAction(
  actionId: PaperFrameContextActionId,
): actionId is Extract<PaperFrameContextActionId, 'bring-to-front' | 'bring-forward' | 'send-backward' | 'send-to-back'> {
  return actionId === 'bring-to-front'
    || actionId === 'bring-forward'
    || actionId === 'send-backward'
    || actionId === 'send-to-back';
}

function snapFrameToGrid(frame: PaperFrame, gridSizeMm: number): PaperFramePatch {
  return {
    xMm: snapMm(frame.xMm, gridSizeMm),
    yMm: snapMm(frame.yMm, gridSizeMm),
    widthMm: Math.max(gridSizeMm, snapMm(frame.widthMm, gridSizeMm)),
    heightMm: Math.max(gridSizeMm, snapMm(frame.heightMm, gridSizeMm)),
  };
}

function snapMm(value: number, gridSizeMm: number): number {
  return roundMm(Math.round(value / gridSizeMm) * gridSizeMm);
}

function gridSizeForDocument(doc: PaperDocument): number {
  return Math.max(0.5, doc.layout.grid.enabled ? doc.layout.grid.sizeMm : 5);
}

function pageActionKind(actionId: Exclude<PaperPageContextActionId, 'add-page-after' | 'duplicate-page'>): PaperFrameKind {
  switch (actionId) {
    case 'add-text-here':
      return 'text';
    case 'add-image-here':
      return 'image';
    case 'add-document-here':
      return 'document';
    case 'add-panel-here':
      return 'panel';
    case 'add-speech-here':
      return 'speechBubble';
    case 'add-thought-here':
      return 'thoughtBubble';
    case 'add-caption-here':
      return 'caption';
    case 'add-shape-here':
      return 'shape';
    case 'add-barcode-here':
      return 'barcode';
  }
}

function frameDefaultsForKind(kind: PaperFrameKind, point: PaperPoint): Pick<PaperFrame, 'kind' | 'xMm' | 'yMm' | 'widthMm' | 'heightMm'> {
  return {
    kind,
    xMm: roundMm(point.xMm),
    yMm: roundMm(point.yMm),
    widthMm: defaultFrameWidth(kind),
    heightMm: defaultFrameHeight(kind),
  };
}

function defaultFrameWidth(kind: PaperFrameKind): number {
  if (kind === 'caption') return 72;
  if (kind === 'speechBubble' || kind === 'thoughtBubble') return 58;
  if (kind === 'shape') return 48;
  if (kind === 'document') return 96;
  if (kind === 'barcode') return paperBarcodeSymbolSizeMm(1, true).widthMm;
  return 84;
}

function defaultFrameHeight(kind: PaperFrameKind): number {
  if (kind === 'caption') return 22;
  if (kind === 'speechBubble' || kind === 'thoughtBubble') return 34;
  if (kind === 'shape') return 48;
  if (kind === 'document') return 110;
  if (kind === 'barcode') return paperBarcodeSymbolSizeMm(1, true).heightMm;
  return kind === 'text' ? 58 : 62;
}

function frameKindPatch(frame: PaperFrame, kind: PaperFrameKind): PaperFramePatch {
  const text = frame.text ?? frame.asset?.text;
  switch (kind) {
    case 'text':
      return {
        kind,
        text: text || 'Text frame',
        fillColor: '#ffffff',
        strokeColor: '#94a3b8',
        strokeWidthMm: 0.2,
        cornerRadiusMm: 0.75,
        columns: Math.max(1, frame.columns || 2),
        tailXPercent: undefined,
        tailYPercent: undefined,
      };
    case 'image':
      return {
        kind,
        fillColor: 'transparent',
        strokeColor: '#94a3b8',
        strokeWidthMm: 0.2,
        cornerRadiusMm: 0,
        tailXPercent: undefined,
        tailYPercent: undefined,
      };
    case 'document':
      return {
        kind,
        fillColor: '#f8fafc',
        strokeColor: '#64748b',
        strokeWidthMm: 0.25,
        cornerRadiusMm: 1,
        tailXPercent: undefined,
        tailYPercent: undefined,
      };
    case 'panel':
      return {
        kind,
        fillColor: 'transparent',
        strokeColor: '#111827',
        strokeWidthMm: 0.6,
        cornerRadiusMm: 0,
        tailXPercent: undefined,
        tailYPercent: undefined,
      };
    case 'shape':
      return {
        kind,
        fillColor: '#e0f2fe',
        strokeColor: '#111827',
        strokeWidthMm: 0.35,
        strokeStyle: 'solid',
        cornerRadiusMm: 0,
        vertices: frame.vertices ?? [
          { xPercent: 50, yPercent: 0 },
          { xPercent: 100, yPercent: 100 },
          { xPercent: 0, yPercent: 100 },
        ],
        tailXPercent: undefined,
        tailYPercent: undefined,
      };
    case 'speechBubble':
      return {
        kind,
        text: text || 'Speech text',
        fillColor: '#ffffff',
        strokeColor: '#111827',
        strokeWidthMm: 0.45,
        cornerRadiusMm: Math.min(frame.widthMm, frame.heightMm) / 2,
        bubbleShape: 'organic',
        bubbleWarp: 0.18,
        bubblePinchXPercent: 58,
        bubblePinchYPercent: 75,
        bubbleTailWidthPercent: 18,
        bubbleTailCurvePercent: 55,
        tailXPercent: 72,
        tailYPercent: 92,
      };
    case 'thoughtBubble':
      return {
        kind,
        text: text || 'Thought text',
        fillColor: '#ffffff',
        strokeColor: '#111827',
        strokeWidthMm: 0.45,
        cornerRadiusMm: Math.min(frame.widthMm, frame.heightMm) / 2,
        bubbleShape: 'cloud',
        bubbleWarp: 0.2,
        bubblePinchXPercent: 58,
        bubblePinchYPercent: 75,
        bubbleTailWidthPercent: 18,
        bubbleTailCurvePercent: 55,
        tailXPercent: 72,
        tailYPercent: 92,
      };
    case 'caption':
      return {
        kind,
        text: text || 'Narration',
        fillColor: '#fff7cc',
        strokeColor: '#111827',
        strokeWidthMm: 0.3,
        cornerRadiusMm: 1.5,
        tailXPercent: undefined,
        tailYPercent: undefined,
      };
    case 'barcode':
      return {
        kind,
        barcode: { symbology: 'ean13', value: '', showHumanReadable: true },
        fillColor: '#ffffff',
        strokeColor: '#000000',
        strokeWidthMm: 0,
        cornerRadiusMm: 0,
        tailXPercent: undefined,
        tailYPercent: undefined,
      };
  }
}

function addPageAfter(doc: PaperDocument, pageId: string): { document: PaperDocument; selectedPageId: string } {
  const currentIndex = doc.pages.findIndex((page) => page.id === pageId);
  if (currentIndex === -1) return { document: doc, selectedPageId: pageId };
  const newPageId = makeId('page');
  const newPage = {
    id: newPageId,
    pageNumber: currentIndex + 2,
    frames: [],
    guides: doc.pages[currentIndex]?.guides.map((guide) => ({
      ...guide,
      id: makeId('guide'),
    })) ?? [],
  };
  const pages = [
    ...doc.pages.slice(0, currentIndex + 1),
    newPage,
    ...doc.pages.slice(currentIndex + 1),
  ].map((page, index) => ({ ...page, pageNumber: index + 1 }));

  return { document: { ...doc, pages, updatedAt: Date.now() }, selectedPageId: newPageId };
}

function clipPolygonByDirectedLine(polygon: PaperPoint[], pA: PaperPoint, pB: PaperPoint): PaperPoint[] {
  const result: PaperPoint[] = [];
  if (polygon.length === 0) return result;

  const isLeft = (p: PaperPoint) => {
    return (pB.xMm - pA.xMm) * (p.yMm - pA.yMm) - (pB.yMm - pA.yMm) * (p.xMm - pA.xMm) >= -1e-9;
  };

  const intersection = (p1: PaperPoint, p2: PaperPoint): PaperPoint => {
    const x1 = p1.xMm, y1 = p1.yMm;
    const x2 = p2.xMm, y2 = p2.yMm;
    const x3 = pA.xMm, y3 = pA.yMm;
    const x4 = pB.xMm, y4 = pB.yMm;

    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-9) {
      return p1;
    }
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    return {
      xMm: x1 + t * (x2 - x1),
      yMm: y1 + t * (y2 - y1),
    };
  };

  let s = polygon[polygon.length - 1];
  for (const p of polygon) {
    if (isLeft(p)) {
      if (!isLeft(s)) {
        result.push(intersection(s, p));
      }
      result.push(p);
    } else if (isLeft(s)) {
      result.push(intersection(s, p));
    }
    s = p;
  }
  return result;
}

function segmentsIntersect(a1: PaperPoint, a2: PaperPoint, b1: PaperPoint, b2: PaperPoint): boolean {
  const det = (a2.xMm - a1.xMm) * (b2.yMm - b1.yMm) - (b2.xMm - b1.xMm) * (a2.yMm - a1.yMm);
  if (Math.abs(det) < 1e-9) return false;

  const t = ((b1.xMm - a1.xMm) * (b2.yMm - b1.yMm) - (b2.xMm - b1.xMm) * (b1.yMm - a1.yMm)) / det;
  const u = ((b1.xMm - a1.xMm) * (a2.yMm - a1.yMm) - (a2.xMm - a1.xMm) * (b1.yMm - a1.yMm)) / det;

  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function isPointInPolygon(p: PaperPoint, polygon: PaperPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].xMm, yi = polygon[i].yMm;
    const xj = polygon[j].xMm, yj = polygon[j].yMm;

    const intersect = ((yi > p.yMm) !== (yj > p.yMm))
        && (p.xMm < (xj - xi) * (p.yMm - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function splitPaperPanelFrame(
  doc: PaperDocument,
  pageId: string,
  start: PaperPoint,
  current: PaperPoint,
): PaperActionResult {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) return { document: doc };

  const dx = current.xMm - start.xMm;
  const dy = current.yMm - start.yMm;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length < 1) return { document: doc };

  const nx = -dy / length;
  const ny = dx / length;

  const gutter = doc.layout?.columns?.gutterMm ?? 5;
  const shift = gutter / 2;

  const p1a = { xMm: start.xMm + shift * nx, yMm: start.yMm + shift * ny };
  const p1b = { xMm: current.xMm + shift * nx, yMm: current.yMm + shift * ny };

  const p2a = { xMm: start.xMm - shift * nx, yMm: start.yMm - shift * ny };
  const p2b = { xMm: current.xMm - shift * nx, yMm: current.yMm - shift * ny };

  let docChanged = false;
  let updatedFrames = [...page.frames];
  let lastNewFrameId: string | null = null;

  for (const frame of page.frames) {
    if (frame.kind !== 'panel' || frame.locked) continue;

    const vertices = frame.vertices && frame.vertices.length >= 3
      ? frame.vertices
      : [
          { xPercent: 0, yPercent: 0 },
          { xPercent: 100, yPercent: 0 },
          { xPercent: 100, yPercent: 100 },
          { xPercent: 0, yPercent: 100 },
        ];

    const absolutePoints: PaperPoint[] = vertices.map((v) => ({
      xMm: frame.xMm + (v.xPercent / 100) * frame.widthMm,
      yMm: frame.yMm + (v.yPercent / 100) * frame.heightMm,
    }));

    let intersected = false;
    for (let i = 0; i < absolutePoints.length; i++) {
      const nextIdx = (i + 1) % absolutePoints.length;
      if (segmentsIntersect(absolutePoints[i], absolutePoints[nextIdx], start, current)) {
        intersected = true;
        break;
      }
    }
    if (!intersected) {
      if (isPointInPolygon(start, absolutePoints) || isPointInPolygon(current, absolutePoints)) {
        intersected = true;
      }
    }

    if (!intersected) continue;

    const clipped1 = clipPolygonByDirectedLine(absolutePoints, p1a, p1b);
    const clipped2 = clipPolygonByDirectedLine(absolutePoints, p2b, p2a);

    if (clipped1.length < 3 || clipped2.length < 3) continue;

    const xs1 = clipped1.map((p) => p.xMm);
    const ys1 = clipped1.map((p) => p.yMm);
    const minX1 = Math.min(...xs1);
    const maxX1 = Math.max(...xs1);
    const minY1 = Math.min(...ys1);
    const maxY1 = Math.max(...ys1);
    const w1 = maxX1 - minX1;
    const h1 = maxY1 - minY1;

    const xs2 = clipped2.map((p) => p.xMm);
    const ys2 = clipped2.map((p) => p.yMm);
    const minX2 = Math.min(...xs2);
    const maxX2 = Math.max(...xs2);
    const minY2 = Math.min(...ys2);
    const maxY2 = Math.max(...ys2);
    const w2 = maxX2 - minX2;
    const h2 = maxY2 - minY2;

    if (w1 < 1 || h1 < 1 || w2 < 1 || h2 < 1) continue;

    const vertices1 = clipped1.map((p) => ({
      xPercent: roundMm(((p.xMm - minX1) / w1) * 100),
      yPercent: roundMm(((p.yMm - minY1) / h1) * 100),
    }));

    const vertices2 = clipped2.map((p) => ({
      xPercent: roundMm(((p.xMm - minX2) / w2) * 100),
      yPercent: roundMm(((p.yMm - minY2) / h2) * 100),
    }));

    const frame1Id = makeId('frame-panel');
    const frame2Id = makeId('frame-panel');

    const subFrame1: PaperFrame = {
      ...frame,
      id: frame1Id,
      label: `${frame.label} (split A)`,
      xMm: roundMm(minX1),
      yMm: roundMm(minY1),
      widthMm: roundMm(w1),
      heightMm: roundMm(h1),
      vertices: vertices1,
    };

    const subFrame2: PaperFrame = {
      ...frame,
      id: frame2Id,
      label: `${frame.label} (split B)`,
      xMm: roundMm(minX2),
      yMm: roundMm(minY2),
      widthMm: roundMm(w2),
      heightMm: roundMm(h2),
      vertices: vertices2,
    };

    updatedFrames = updatedFrames.filter((f) => f.id !== frame.id);
    updatedFrames.push(subFrame1, subFrame2);
    lastNewFrameId = frame2Id;
    docChanged = true;
  }

  if (!docChanged) return { document: doc };

  return {
    document: withUpdatedPage(doc, pageId, {
      frames: normalizeFrameStack(updatedFrames),
    }),
    selectedFrameId: lastNewFrameId,
    selectedPageId: pageId,
  };
}

function makeId(prefix: string): string {
  return globalThis.crypto?.randomUUID?.()
    ? `${prefix}-${globalThis.crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeDegrees(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function roundScale(value: number): number {
  return Math.round(Math.max(0.1, Math.min(8, value)) * 100) / 100;
}

function roundMm(value: number): number {
  return Math.round(value * 1000) / 1000;
}
