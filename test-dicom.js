/**
 * Smoke test: parse local 1.dcm with the same geometry rules as the app.
 * Usage: node test-dicom.js [path/to/file.dcm]
 */
const fs = require('fs');
const path = require('path');
const dicomParser = require('dicom-parser');

const filePath = process.argv[2] || path.join(__dirname, '1.dcm');
if (!fs.existsSync(filePath)) {
  console.error('File not found:', filePath);
  process.exit(1);
}

const buf = fs.readFileSync(filePath);
const ds = dicomParser.parseDicom(new Uint8Array(buf));

function read(tag) {
  const el = ds.elements[tag];
  if (!el) return null;
  if (el.vr === 'UL') return ds.uint32(tag);
  if (el.vr === 'US') return ds.uint16(tag);
  if (el.vr === 'FD') return ds.double(tag);
  if (el.vr === 'DS' || el.vr === 'IS') return parseFloat(ds.string(tag));
  return ds.string(tag);
}

const rows = read('x00280010');
const cols = read('x00280011');
const t = read('x00280008') || 1;
const z = read('x30011001');
const pe = ds.elements.x7fe00010;
const totalSlices = pe.length / (rows * cols);

console.log('File:', filePath);
console.log('Manufacturer:', read('x00080070'));
console.log('Comments:', read('x00204000'));
console.log('Dims T,Z,Y,X:', t, z, rows, cols);
console.log('Pixel slices:', totalSlices, 'expected', t * z);
console.log('Spacing cm X/Y/Z:', read('x0018602c'), read('x0018602e'), read('x30011003'));
console.log('FrameTime ms:', read('x00181063'));
console.log(totalSlices === t * z ? 'OK: Philips Cartesian layout matches' : 'WARN: layout mismatch');
