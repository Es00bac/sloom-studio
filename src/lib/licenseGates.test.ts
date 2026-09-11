import { describe, expect, it } from 'vitest';
import { useSettingsStore } from '../store/settingsStore';
import {
  isCommercialPrintProductionTarget,
  isTiltmarkBrushUnlocked,
} from './licenseGates';

describe('commercial print license gate', () => {
  it('keeps both PDF/X standards and CMYK press targets licensed while browser PDF stays free', () => {
    expect(isCommercialPrintProductionTarget({ pdfStandard: 'pdf-x-1a' })).toBe(true);
    expect(isCommercialPrintProductionTarget({ pdfStandard: 'pdf-x-4' })).toBe(true);
    expect(isCommercialPrintProductionTarget({ pdfStandard: 'browser-pdf', outputIntentColorSpace: 'cmyk' })).toBe(true);
    expect(isCommercialPrintProductionTarget({ pdfStandard: 'browser-pdf', outputIntentColorSpace: 'rgb' })).toBe(false);
  });

  it('keeps Tiltmark unavailable in Community and unlocks it only with a verified license', () => {
    const previous = useSettingsStore.getState().license;
    useSettingsStore.setState({ license: { licensed: false } });
    expect(isTiltmarkBrushUnlocked()).toBe(false);
    useSettingsStore.setState({
      license: {
        licensed: true,
        email: 'licensed@example.test',
        edition: 'commercial',
      },
    });
    expect(isTiltmarkBrushUnlocked()).toBe(true);
    useSettingsStore.setState({ license: previous });
  });
});
