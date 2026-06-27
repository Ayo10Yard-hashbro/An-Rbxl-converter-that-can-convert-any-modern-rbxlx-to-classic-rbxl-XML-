'use strict';

// Minimal pure-JS LZ4 *block* (not frame) decompressor.
// Roblox stores raw LZ4 blocks inside chunks (no LZ4 frame header).
function lz4DecompressBlock(input, outputSize) {
  const output = Buffer.alloc(outputSize);
  let ip = 0;
  let op = 0;
  const inLen = input.length;

  while (ip < inLen) {
    const token = input[ip++];
    let literalLength = token >>> 4;
    if (literalLength === 15) {
      let b;
      do {
        b = input[ip++];
        literalLength += b;
      } while (b === 255);
    }
    if (literalLength > 0) {
      input.copy(output, op, ip, ip + literalLength);
      ip += literalLength;
      op += literalLength;
    }

    if (ip >= inLen || op >= outputSize) break;

    const offset = input[ip] | (input[ip + 1] << 8);
    ip += 2;
    let matchLength = (token & 0x0f) + 4;
    if ((token & 0x0f) === 15) {
      let b;
      do {
        b = input[ip++];
        matchLength += b;
      } while (b === 255);
    }

    let matchPos = op - offset;
    if (matchPos < 0) throw new Error('Corrupt LZ4 stream: bad match offset');

    // Byte-by-byte copy (required since ranges can overlap for run-length patterns)
    for (let i = 0; i < matchLength; i++) {
      output[op] = output[matchPos];
      op++;
      matchPos++;
    }
  }

  if (op !== outputSize) {
    // Not always fatal, but flag it
    throw new Error(`LZ4 decompression size mismatch: got ${op}, expected ${outputSize}`);
  }

  return output;
}

function isZstd(buf) {
  return buf.length >= 4 &&
    buf[0] === 0x28 && buf[1] === 0xb5 && buf[2] === 0x2f && buf[3] === 0xfd;
}

function decompressChunk(compressed, uncompressedLength) {
  if (isZstd(compressed)) {
    let fzstd;
    try {
      fzstd = require('fzstd');
    } catch (e) {
      throw new Error('This file uses ZSTD-compressed chunks and the fzstd module is unavailable.');
    }
    const out = fzstd.decompress(compressed);
    return Buffer.from(out);
  }
  return lz4DecompressBlock(compressed, uncompressedLength);
}

module.exports = { lz4DecompressBlock, decompressChunk, isZstd };
