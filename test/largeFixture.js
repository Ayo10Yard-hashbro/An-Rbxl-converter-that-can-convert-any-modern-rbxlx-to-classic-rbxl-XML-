'use strict';
const LZ4 = require('lz4js');
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
  const deltas = values.map((v, i) => (i === 0 ? v : v - values[i - 1]));
  return interleavedI32Array(deltas);
}

function compressBlock(buf) {
  if (buf.length === 0) return null;
  const bound = LZ4.compressBound(buf.length);
  const out = LZ4.makeBuffer(bound);
  const size = LZ4.compressBlock(buf, out, 0, buf.length, {});
  if (size <= 0) return null; // incompressible; caller should fall back to uncompressed
  return Buffer.from(out.subarray(0, size));
}

function chunk(name, data) {
  const compressed = compressBlock(data);
  const header = Buffer.alloc(16);
  header.write(name.padEnd(4, '\0').slice(0, 4), 0, 'ascii');
  if (compressed) {
    header.writeUInt32LE(compressed.length, 4);
    header.writeUInt32LE(data.length, 8);
    header.writeUInt32LE(0, 12);
    return Buffer.concat([header, compressed]);
  }
  header.writeUInt32LE(0, 4);
  header.writeUInt32LE(data.length, 8);
  header.writeUInt32LE(0, 12);
  return Buffer.concat([header, data]);
}

function buildLargeFixture(partCount) {
  const referents = [];
  for (let i = 0; i < partCount; i++) referents.push(i + 1); // 0 reserved for Workspace

  const instWorkspace = Buffer.concat([
    u32(0), strBuf('Workspace'), u8(1), u32(1),
    referentArrayDeltas([0]),
    u8(1),
  ]);
  const instPart = Buffer.concat([
    u32(1), strBuf('Part'), u8(0), u32(partCount),
    referentArrayDeltas(referents),
  ]);

  const names = referents.map((_, i) => `Part_${i}_SomeReasonablyLongNameForTesting`);
  const propName = Buffer.concat([u32(1), strBuf('Name'), u8(0x01), ...names.map(strBuf)]);

  const sizeX = referents.map((_, i) => 4 + (i % 7) * 0.5);
  const sizeY = referents.map((_, i) => 1.2 + (i % 3) * 0.1);
  const sizeZ = referents.map((_, i) => 2);
  const propSize = Buffer.concat([
    u32(1), strBuf('Size'), u8(0x0e),
    interleavedF32Array(sizeX), interleavedF32Array(sizeY), interleavedF32Array(sizeZ),
  ]);

  const propTrans = Buffer.concat([
    u32(1), strBuf('Transparency'), u8(0x04),
    interleavedF32Array(referents.map((_, i) => (i % 10) / 10)),
  ]);
  const propAnchored = Buffer.concat([
    u32(1), strBuf('Anchored'), u8(0x02),
    Buffer.concat(referents.map((_, i) => Buffer.from([i % 2]))),
  ]);

  // CFrame: id=0 (full orientation) for variety + position
  const cfPositions = referents.map((_, i) => ({ x: i * 4, y: 10, z: (i % 50) * 4 }));
  let cfIdBytes = Buffer.alloc(0);
  let cfOrientBytes = Buffer.alloc(0);
  const orientFlat = Buffer.alloc(partCount * 9 * 4);
  referents.forEach((_, i) => {
    cfIdBytes = Buffer.concat([cfIdBytes, Buffer.from([0])]);
    const m = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    for (let k = 0; k < 9; k++) orientFlat.writeFloatBE(m[k], (i * 9 + k) * 4);
  });
  const propCFrame = Buffer.concat([
    u32(1), strBuf('CFrame'), u8(0x10),
    cfIdBytes,
    orientFlat,
    interleavedF32Array(cfPositions.map((p) => p.x)),
    interleavedF32Array(cfPositions.map((p) => p.y)),
    interleavedF32Array(cfPositions.map((p) => p.z)),
  ]);

  const childRefs = [0, ...referents];
  const parentRefs = [-1, ...referents.map(() => 0)];
  const prnt = Buffer.concat([
    u8(0), u32(childRefs.length),
    referentArrayDeltas(childRefs),
    referentArrayDeltas(parentRefs),
  ]);

  const end = Buffer.from('</roblox>', 'ascii');

  const header = Buffer.alloc(32);
  header.write('<roblox!', 0, 'ascii');
  Buffer.from([0x89, 0xff, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 8);
  header.writeUInt16LE(0, 14);
  header.writeInt32LE(2, 16);
  header.writeInt32LE(partCount + 1, 20);

  return Buffer.concat([
    header,
    chunk('INST', instWorkspace),
    chunk('INST', instPart),
    chunk('PROP', propName),
    chunk('PROP', propSize),
    chunk('PROP', propTrans),
    chunk('PROP', propAnchored),
    chunk('PROP', propCFrame),
    chunk('PRNT', prnt),
    chunk('END', end),
  ]);
}

module.exports = { buildLargeFixture };
