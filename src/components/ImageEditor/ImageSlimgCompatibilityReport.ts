import {
  translate,
  translateFormat,
  type AppLocale,
  type MessageKey,
} from '../../lib/i18n';
import type { SlimgV1CompatibilityReport } from '../../lib/slimgV2';

type FlattenReason =
  SlimgV1CompatibilityReport['flattenedLayers'][number]['reasons'][number];
type OmittedFeature =
  SlimgV1CompatibilityReport['omittedDocumentFeatures'][number]['feature'];

const REASON_KEYS = {
  'vector-recipe': 'image.slimg.v1Report.reason.vector',
  'editable-text': 'image.slimg.v1Report.reason.text',
  'adjustment-layer': 'image.slimg.v1Report.reason.adjustment',
  'affine-scale-or-shear': 'image.slimg.v1Report.reason.affine',
  skew: 'image.slimg.v1Report.reason.skew',
  perspective: 'image.slimg.v1Report.reason.perspective',
  'corner-distort': 'image.slimg.v1Report.reason.cornerDistort',
  'warp-mesh': 'image.slimg.v1Report.reason.warpMesh',
} as const satisfies Record<FlattenReason, MessageKey>;

const FEATURE_KEYS = {
  guides: 'image.slimg.v1Report.feature.guides',
  'managed-color': 'image.slimg.v1Report.feature.managedColor',
  'soft-proof': 'image.slimg.v1Report.feature.softProof',
  timelapse: 'image.slimg.v1Report.feature.timelapse',
  'physical-state': 'image.slimg.v1Report.feature.physicalState',
} as const satisfies Record<OmittedFeature, MessageKey>;

function assetList(assetIds: readonly string[], locale: AppLocale): string {
  if (assetIds.length === 0) return translate('image.slimg.v1Report.noAssets', locale);
  return assetIds.join(', ');
}

/**
 * Human-readable, localized rendering of the machine-readable compatibility
 * report. Asset and layer identifiers remain verbatim so the report can be
 * compared directly with the exported archive.
 */
export function formatSlimgV1CompatibilityReport(
  report: SlimgV1CompatibilityReport,
  locale: AppLocale,
): string {
  const lines = [
    translateFormat('image.slimg.v1Report.summary', locale, {
      layerCount: report.flattenedLayers.length,
      featureCount: report.omittedDocumentFeatures.length,
    }),
    '',
    translate('image.slimg.v1Report.flattenedHeading', locale),
  ];

  if (report.flattenedLayers.length === 0) {
    lines.push(translate('image.slimg.v1Report.noneFlattened', locale));
  } else {
    for (const layer of report.flattenedLayers) {
      lines.push(
        `• ${layer.layerName} [${layer.layerId}]: ${layer.reasons
          .map((reason) => translate(REASON_KEYS[reason], locale))
          .join(locale === 'ja' ? '、' : ', ')}`,
        `  ${translate('image.slimg.v1Report.fallback', locale)}: ${layer.fallbackAssetId}`,
      );
    }
  }

  lines.push('', translate('image.slimg.v1Report.omittedHeading', locale));
  if (report.omittedDocumentFeatures.length === 0) {
    lines.push(translate('image.slimg.v1Report.noneOmitted', locale));
  } else {
    for (const omission of report.omittedDocumentFeatures) {
      lines.push(
        `• ${translate(FEATURE_KEYS[omission.feature], locale)}`,
        `  ${translate('image.slimg.v1Report.assets', locale)}: ${
          assetList(omission.assetIds, locale)
        }`,
      );
    }
  }

  lines.push(
    '',
    translate('image.slimg.v1Report.retainedAssets', locale),
    assetList(report.retainedAssetIds, locale),
    '',
    translate('image.slimg.v1Report.omittedAssets', locale),
    assetList(report.omittedAssetIds, locale),
  );
  return lines.join('\n');
}
