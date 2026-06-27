'use strict';

const crypto = require('crypto');
const { Reader } = require('./reader');
const { decompressChunk } = require('./decompress');
const { readPropertyArray, readInterleavedReferentArray } = require('./types');

const MAGIC = Buffer.from('<roblox!\x89\xff\r\n\x1a\n', 'binary');

function readChunks(buf, headerLen) {
  const chunks = [];
  let pos = headerLen;
  while (pos < buf.length) {
    if (pos + 16 > buf.length) break;
    const name = buf.toString('ascii', pos, pos + 4).replace(/\0+$/, '');
    const compressedLength = buf.readUInt32LE(pos + 4);
    const uncompressedLength = buf.readUInt32LE(pos + 8);
    // 4 bytes reserved at pos+12
    const dataStart = pos + 16;
    let data;
    if (compressedLength === 0) {
      data = buf.subarray(dataStart, dataStart + uncompressedLength);
      pos = dataStart + uncompressedLength;
    } else {
      const compressed = buf.subarray(dataStart, dataStart + compressedLength);
      data = decompressChunk(compressed, uncompressedLength);
      pos = dataStart + compressedLength;
    }
    chunks.push({ name, data: Buffer.from(data) });
    if (name === 'END') break;
  }
  return chunks;
}

function parseRbxl(buf) {
  if (buf.length < 32 || !buf.subarray(0, 14).equals(MAGIC.subarray(0, 14))) {
    throw new Error('Not a valid Roblox binary file (bad header signature). Make sure you uploaded an .rbxl/.rbxm binary file, not XML.');
  }
  const headerReader = new Reader(buf);
  headerReader.pos = 14;
  const version = headerReader.u16le();
  const classCount = headerReader.i32le();
  const instanceCount = headerReader.i32le();
  headerReader.pos += 8; // reserved

  const chunks = readChunks(buf, 32);

  const warnings = [];
  const metadata = {};
  let sharedStrings = [];
  const classes = new Map(); // classId -> {className, isService, referents:[]}
  const properties = []; // {classId, name, typeId, values:[]}
  let parentChildren = [];
  let parentParents = [];

  for (const chunk of chunks) {
    const r = new Reader(chunk.data);
    try {
      if (chunk.name === 'META') {
        const n = r.u32le();
        for (let i = 0; i < n; i++) {
          const k = r.string();
          const v = r.string();
          metadata[k] = v;
        }
      } else if (chunk.name === 'SSTR') {
        r.u32le(); // version
        const n = r.u32le();
        sharedStrings = new Array(n);
        for (let i = 0; i < n; i++) {
          const hash = r.bytes(16);
          const value = r.string();
          sharedStrings[i] = { hash: Buffer.from(hash), value };
        }
      } else if (chunk.name === 'INST') {
        const classId = r.u32le();
        const className = r.string();
        const objectFormat = r.u8();
        const n = r.u32le();
        const referents = readInterleavedReferentArray(r, n);
        let serviceMarkers = null;
        if (objectFormat === 1) {
          serviceMarkers = [];
          for (let i = 0; i < n; i++) serviceMarkers.push(r.u8() !== 0);
        }
        classes.set(classId, { className, isService: objectFormat === 1, referents, serviceMarkers });
      } else if (chunk.name === 'PROP') {
        const classId = r.u32le();
        const propName = r.string();
        const typeId = r.u8();
        const cls = classes.get(classId);
        if (!cls) {
          warnings.push(`PROP chunk referenced unknown classId ${classId}, skipped`);
          continue;
        }
        const count = cls.referents.length;
        let values;
        try {
          values = readPropertyArray(typeId, r, count, { sharedStrings });
        } catch (e) {
          warnings.push(`Could not decode property ${cls.className}.${propName} (type 0x${typeId.toString(16)}): ${e.message}`);
          continue;
        }
        properties.push({ classId, className: cls.className, name: propName, typeId, values });
      } else if (chunk.name === 'PRNT') {
        r.u8(); // version
        const n = r.u32le();
        parentChildren = readInterleavedReferentArray(r, n);
        parentParents = readInterleavedReferentArray(r, n);
      } else if (chunk.name === 'END') {
        // done
      } else {
        warnings.push(`Unknown chunk type "${chunk.name}" ignored`);
      }
    } catch (e) {
      warnings.push(`Error reading chunk "${chunk.name}": ${e.message}`);
    }
  }

  return {
    version,
    classCount,
    instanceCount,
    metadata,
    sharedStrings,
    classes,
    properties,
    parentChildren,
    parentParents,
    warnings,
  };
}

module.exports = { parseRbxl };
