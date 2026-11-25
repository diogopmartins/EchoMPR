import { DASH, cm2, deg, fixed, frameLabel, ml, mm, mmSigned, pct } from './format';

describe('number formatting', () => {
  test('lengths in mm, one decimal, never "-0.0"', () => {
    expect(mm(4.24)).toBe('4.2 mm');
    expect(mm(-0.04)).toBe('0.0 mm');
    expect(mm(48.4, 0)).toBe('48 mm');
    expect(fixed(-0.001, 2)).toBe('0.00');
  });

  test('signed heights with a real minus sign', () => {
    expect(mmSigned(2.34)).toBe('+2.3 mm');
    expect(mmSigned(-1.06)).toBe('−1.1 mm');
    expect(mmSigned(-0.02)).toBe('0.0 mm');
  });

  test('areas in cm², volumes in mL', () => {
    expect(cm2(167)).toBe('1.67 cm²');
    expect(cm2(2)).toBe('0.02 cm²');
    expect(ml(2400)).toBe('2.40 mL');
  });

  test('angles, ratios and frames', () => {
    expect(deg(119.6)).toBe('120°');
    expect(pct(20.4)).toBe('20%');
    expect(frameLabel(2, 12)).toBe('T3/12');
  });

  test('missing values read as a dash', () => {
    [mm, mmSigned, cm2, ml, deg, pct].forEach((f) => {
      expect(f(null)).toBe(DASH);
      expect(f(undefined)).toBe(DASH);
      expect(f(NaN)).toBe(DASH);
    });
  });
});
