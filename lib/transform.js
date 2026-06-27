'use strict';

// ---- Integer zig-zag style transform (32-bit) ----
function untransformI32(u) {
  // u is an unsigned 32-bit value (big-endian read already converted to JS number 0..2^32-1)
  // equivalent to (x >> 1) ^ -(x & 1) using 32-bit semantics
  const x = u | 0; // reinterpret as signed 32-bit
  return (x >>> 1) ^ -(x & 1);
}

function transformI32(v) {
  // v is a signed 32-bit JS number
  return ((v << 1) ^ (v >> 31)) >>> 0;
}

// ---- Integer zig-zag transform (64-bit, using BigInt) ----
function untransformI64(u) {
  // u: BigInt, unsigned 64-bit
  const mask63 = 1n;
  const x = BigInt.asIntN(64, u);
  return (x >> 1n) ^ -(x & mask63);
}

function transformI64(v) {
  // v: BigInt signed
  const out = (v << 1n) ^ (v >> 63n);
  return BigInt.asUintN(64, out);
}

// ---- Byte interleaving ----
// De-interleave: input buffer of length count*elemSize, columns -> rows
function deinterleave(buf, count, elemSize) {
  const out = Buffer.alloc(count * elemSize);
  if (count === 0) return out;
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < elemSize; col++) {
      // interleaved layout: byte at [col * count + row] belongs to element `row`, byte position `col`
      out[row * elemSize + col] = buf[col * count + row];
    }
  }
  return out;
}

function interleave(buf, count, elemSize) {
  const out = Buffer.alloc(count * elemSize);
  if (count === 0) return out;
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < elemSize; col++) {
      out[col * count + row] = buf[row * elemSize + col];
    }
  }
  return out;
}

// ---- Roblox proprietary float format (sign bit moved to LSB of mantissa) ----
// Standard:  s eeeeeeee mmmmmmmmmmmmmmmmmmmmmmm  (bit31=sign)
// Roblox:    eeeeeeee mmmmmmmmmmmmmmmmmmmmmmm s  (bit0=sign, rest shifted up by 1)
function robloxBitsToFloat(u32) {
  // u32: unsigned 32-bit integer as read big-endian from file
  const sign = u32 & 1;
  const rest = u32 >>> 1; // eeeeeeee mmmm....mmm (31 bits: 8 exponent + 23 mantissa)
  const standard = (sign << 31) | rest;
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(standard >>> 0, 0);
  return buf.readFloatBE(0);
}

function floatToRobloxBits(f) {
  const buf = Buffer.alloc(4);
  buf.writeFloatBE(f, 0);
  const standard = buf.readUInt32BE(0);
  const sign = (standard >>> 31) & 1;
  const rest = standard & 0x7fffffff;
  const roblox = ((rest << 1) | sign) >>> 0;
  return roblox;
}

module.exports = {
  untransformI32,
  transformI32,
  untransformI64,
  transformI64,
  deinterleave,
  interleave,
  robloxBitsToFloat,
  floatToRobloxBits,
};
