// Makes a small folder of sample files (picture, PDF, source, archive, fake PDF) in ./testfiles,
// used by previews.mjs and shellmenu4.mjs.
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const folder = 'testfiles';
mkdirSync(folder, { recursive: true });

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

// A 64x40 gradient picture.
const width = 64;
const height = 40;
const rows = [];
for (let y = 0; y < height; y++) {
  const row = [0];
  for (let x = 0; x < width; x++) row.push((x * 4) % 256, (y * 6) % 256, 180);
  rows.push(Buffer.from(row));
}
const header = Buffer.alloc(13);
header.writeUInt32BE(width, 0);
header.writeUInt32BE(height, 4);
header.set([8, 2, 0, 0, 0], 8);
writeFileSync(
  `${folder}/picture.png`,
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]),
);

const pdf = [
  '%PDF-1.1',
  '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
  '4 0 obj<</Length 44>>stream',
  'BT /F1 24 Tf 40 100 Td (Hello PDF) Tj ET',
  'endstream endobj',
  '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
  'trailer<</Root 1 0 R/Size 6>>',
  '%%EOF',
].join('\n');
writeFileSync(`${folder}/doc.pdf`, pdf);

// A page that only pretends to be a PDF. The preview must refuse it.
writeFileSync(`${folder}/evil.pdf`, '<html><body><script>document.title="pwned"</script>hello</body></html>');

const code = Array.from({ length: 300 }, (_, index) => `fn line_${index + 1}() { let needle = ${index + 1}; }`).join('\n');
writeFileSync(`${folder}/code.rs`, code);
writeFileSync(`${folder}/archive.zip`, Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(100)]));
console.log(`wrote sample files to ${folder}`);
