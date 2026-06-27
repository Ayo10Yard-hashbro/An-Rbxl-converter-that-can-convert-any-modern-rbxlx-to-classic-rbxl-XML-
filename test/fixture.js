'use strict';
const { transformI32, interleave, floatToRobloxBits } = require('../lib/transform');

function strBuf(s) {
  const b = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(b.length, 0);
  return Buffer.concat([len, b]);
}

function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }
function u8(n) { return Buffer.from([n & 0xff]); }

function interleavedI32Array(values) {
  const flat = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => flat.writeUInt32BE(transformI32(v), i * 4));
  return interleave(flat, values.length, 4);
}

function interleavedF32Array(values) {
  const flat = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => flat.writeUInt32BE(floatToRobloxBits(v), i * 4));
  return interleave(flat, values.length, 4);
}

function referentArrayDeltas(values) {
  // turn absolute referents into deltas, then interleave as i32
  const deltas = values.map((v, i) => (i === 0 ? v : v - values[i - 1]));
  return interleavedI32Array(deltas);
}

function chunk(name, data) {
  const header = Buffer.alloc(16);
  header.write(name.padEnd(4, '\0').slice(0, 4), 0, 'ascii');
  header.writeUInt32LE(0, 4); // compressedLength = 0 -> uncompressed
  header.writeUInt32LE(data.length, 8);
  header.writeUInt32LE(0, 12);
  return Buffer.concat([header, data]);
}

function buildFixture() {
  // Class 0: Workspace (service), referent 0
  const inst0 = Buffer.concat([
    u32(0), strBuf('Workspace'), u8(1), u32(1),
    referentArrayDeltas([0]),
    u8(1), // service marker
  ]);

  // Class 1: Part, referent 1
  const inst1 = Buffer.concat([
    u32(1), strBuf('Part'), u8(0), u32(1),
    referentArrayDeltas([1]),
  ]);

  // PROP: Part.Name (string)
  const propName = Buffer.concat([u32(1), strBuf('Name'), u8(0x01), strBuf('MyTestPart')]);

  // PROP: Part.Size (Vector3)
  const propSize = Buffer.concat([
    u32(1), strBuf('Size'), u8(0x0e),
    interleavedF32Array([4]), interleavedF32Array([1.2]), interleavedF32Array([2]),
  ]);

  // PROP: Part.Transparency (float32)
  const propTrans = Buffer.concat([u32(1), strBuf('Transparency'), u8(0x04), interleavedF32Array([0.5])]);

  // PROP: Part.Anchored (bool)
  const propAnchored = Buffer.concat([u32(1), strBuf('Anchored'), u8(0x02), u8(1)]);

  // PROP: Part.BrickColor (BrickColor, u32 interleaved big-endian, untransformed)
  const bcFlat = Buffer.alloc(4);
  bcFlat.writeUInt32BE(194, 0);
  const propBrickColor = Buffer.concat([u32(1), strBuf('BrickColor'), u8(0x0b), interleave(bcFlat, 1, 4)]);

  // PRNT chunk: Workspace(0) is a root (-1 parent), Part(1) parented to Workspace(0)
  const prnt = Buffer.concat([
    u8(0), u32(2),
    referentArrayDeltas([0, 1]), // child referents
    referentArrayDeltas([-1, 0]), // parent referents
  ]);

  const end = Buffer.from('</roblox>', 'ascii');

  const header = Buffer.alloc(32);
  header.write('<roblox!', 0, 'ascii');
  Buffer.from([0x89, 0xff, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 8);
  header.writeUInt16LE(0, 14); // version
  header.writeInt32LE(2, 16); // class count
  header.writeInt32LE(2, 20); // instance count
  // 8 bytes reserved at 24

  return Buffer.concat([
    header,
    chunk('INST', inst0),
    chunk('INST', inst1),
    chunk('PROP', propName),
    chunk('PROP', propSize),
    chunk('PROP', propTrans),
    chunk('PROP', propAnchored),
    chunk('PROP', propBrickColor),
    chunk('PRNT', prnt),
    chunk('END', end),
  ]);
}

module.exports = { buildFixture };
