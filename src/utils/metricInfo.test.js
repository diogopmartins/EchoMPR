import fs from 'fs';
import path from 'path';
import { METRIC_IDS, SOURCES, infoContext, metricInfo } from './metricInfo';

/** Every id the components ask for, read from their source. */
function idsUsedInComponents() {
  const dir = path.join(__dirname, '..', 'components');
  const files = [];
  const walk = (d) =>
    fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.js')) files.push(p);
    });
  walk(dir);
  const ids = new Set();
  files.forEach((f) => {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/<(?:Tip|MetricRow)\b[^>]*?\bid="([^"]+)"/g)) ids.add(m[1]);
    for (const m of src.matchAll(/\btip: '([^']+)'/g)) ids.add(m[1]);
    for (const m of src.matchAll(/: '(cr[A-Z]\w+)'/g)) ids.add(m[1]);
  });
  return ids;
}

describe('metric explanations', () => {
  test('every explained number in the components has an entry', () => {
    const used = idsUsedInComponents();
    expect(used.size).toBeGreaterThan(40);
    const missing = [...used].filter((id) => !METRIC_IDS.includes(id));
    expect(missing).toEqual([]);
    ['distance', 'area'].forEach((id) => expect(METRIC_IDS).toContain(id));
  });

  test('every entry has a title and text for both valves, and sources are links', () => {
    ['mv', 'tv'].forEach((kind) => {
      const ctx = { ...infoContext({ kind }, '3D annulus (saddle)'), centralCut: 'cut 5 (A2 / P2)' };
      METRIC_IDS.forEach((id) => {
        const info = metricInfo(id, ctx);
        expect(info.title).toEqual(expect.any(String));
        expect(info.text.length).toBeGreaterThan(20);
        expect(info.text).not.toMatch(/undefined|null/);
        expect(info.source ? info.source.url : 'https://none').toMatch(/^https:\/\//);
      });
    });
    Object.values(SOURCES).forEach((s) => expect(s.url).toMatch(/^https:\/\//));
  });

  test('texts follow the valve and the reference', () => {
    const tv = metricInfo('leafletHeight', infoContext({ kind: 'tv' }, 'annulus plane'));
    expect(tv.text).toMatch(/annulus plane/);
    expect(tv.text).toMatch(/RA/);
    expect(metricInfo('annulusArea3d', infoContext({ kind: 'mv' })).source).toBe(SOURCES.wase);
    expect(metricInfo('annulusArea3d', infoContext({ kind: 'tv' })).source).toBe(SOURCES.muraru);
    expect(metricInfo('nope')).toBeNull();
  });
});
