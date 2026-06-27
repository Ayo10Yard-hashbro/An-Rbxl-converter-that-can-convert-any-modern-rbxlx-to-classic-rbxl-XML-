'use strict';

const { Reader } = require('./reader');
const {
  untransformI32,
  untransformI64,
  deinterleave,
  robloxBitsToFloat,
} = require('./transform');

// Read `count` raw bytes-per-element interleaved big-endian u32 array, return array of plain JS numbers (unsigned 32-bit)
function readInterleavedU32Array(r, count) {
  const raw = r.bytes(count * 4);
  const flat = deinterleave(Buffer.from(raw), count, 4);
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = flat.readUInt32BE(i * 4);
  }
  return out;
}

function readInterleavedI32Array(r, count) {
  const u32arr = readInterleavedU32Array(r, count);
  return u32arr.map(untransformI32);
}

function readInterleavedF32Array(r, count) {
  const u32arr = readInterleavedU32Array(r, count);
  return u32arr.map(robloxBitsToFloat);
}

function readInterleavedReferentArray(r, count) {
  const deltas = readInterleavedI32Array(r, count);
  const out = new Array(count);
  let running = 0;
  for (let i = 0; i < count; i++) {
    running += deltas[i];
    out[i] = running;
  }
  return out;
}

function readInterleavedI64Array(r, count) {
  const raw = r.bytes(count * 8);
  const flat = deinterleave(Buffer.from(raw), count, 8);
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const u = flat.readBigUInt64BE(i * 8);
    out[i] = untransformI64(u);
  }
  return out;
}

// SecurityCapabilities is an opaque 64-bit flag set: big-endian, interleaved,
// but NOT zigzag-transformed (it's a bitmask, not a signed magnitude).
function readInterleavedU64Array(r, count) {
  const raw = r.bytes(count * 8);
  const flat = deinterleave(Buffer.from(raw), count, 8);
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = flat.readBigUInt64BE(i * 8);
  }
  return out;
}

// Derived from the (X,Y,Z) Euler angle table in the rbx-dom binary format spec,
// composed as M = Rz * Rx * Ry (rotation order Y -> X -> Z), which yields clean
// orthonormal +-1/0 matrices matching Roblox's special-case CFrame orientation IDs.
const CFRAME_ROTATIONS = {
  0x02: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  0x03: [1, 0, 0, 0, 0, -1, 0, 1, 0],
  0x05: [1, 0, 0, 0, -1, 0, 0, 0, -1],
  0x06: [1, 0, 0, 0, 0, 1, 0, -1, 0],
  0x07: [0, -1, 0, -1, 0, 0, 0, 0, -1],
  0x09: [0, -1, 0, 0, 0, 1, -1, 0, 0],
  0x0a: [0, -1, 0, 1, 0, 0, 0, 0, 1],
  0x0c: [0, -1, 0, 0, 0, -1, 1, 0, 0],
  0x0d: [0, 0, -1, 1, 0, 0, 0, -1, 0],
  0x0e: [0, 0, -1, 0, 1, 0, 1, 0, 0],
  0x10: [0, 0, -1, -1, 0, 0, 0, 1, 0],
  0x11: [0, 0, -1, 0, -1, 0, -1, 0, 0],
  0x14: [-1, 0, 0, 0, 1, 0, 0, 0, -1],
  0x15: [-1, 0, 0, 0, 0, -1, 0, -1, 0],
  0x17: [-1, 0, 0, 0, -1, 0, 0, 0, 1],
  0x18: [-1, 0, 0, 0, 0, 1, 0, 1, 0],
  0x19: [0, 1, 0, -1, 0, 0, 0, 0, 1],
  0x1b: [0, 1, 0, 0, 0, 1, 1, 0, 0],
  0x1c: [0, 1, 0, 1, 0, 0, 0, 0, -1],
  0x1e: [0, 1, 0, 0, 0, -1, -1, 0, 0],
  0x1f: [0, 0, 1, 1, 0, 0, 0, 1, 0],
  0x20: [0, 0, 1, 0, 1, 0, -1, 0, 0],
  0x22: [0, 0, 1, -1, 0, 0, 0, -1, 0],
  0x23: [0, 0, 1, 0, -1, 0, 1, 0, 0],
};

function readNumberSequence(r) {
  const n = r.u32le();
  const keypoints = [];
  for (let i = 0; i < n; i++) {
    keypoints.push({ time: r.f32le(), value: r.f32le(), envelope: r.f32le() });
  }
  return keypoints;
}

function readColorSequence(r) {
  const n = r.u32le();
  const keypoints = [];
  for (let i = 0; i < n; i++) {
    keypoints.push({
      time: r.f32le(),
      r: r.f32le(),
      g: r.f32le(),
      b: r.f32le(),
      envelope: r.f32le(),
    });
  }
  return keypoints;
}

function readPhysicalProperties(r) {
  const flags = r.u8();
  if ((flags & 1) === 0) {
    return null; // default/no custom properties
  }
  const density = r.f32le();
  const friction = r.f32le();
  const elasticity = r.f32le();
  const frictionWeight = r.f32le();
  const elasticityWeight = r.f32le();
  let acousticAbsorption = 1.0;
  if (flags & 2) acousticAbsorption = r.f32le();
  return { density, friction, elasticity, frictionWeight, elasticityWeight, acousticAbsorption };
}

// Reads the values array for `typeId` given `count` instances.
// `ctx` provides: sharedStrings (array of {hash, value})
function readContent(r, count) {
  // SourceTypes is serialized exactly like an Enum array: interleaved big-endian u32.
  const sourceTypes = readInterleavedU32Array(r, count);

  const uriCount = r.u32le();
  const uris = [];
  for (let i = 0; i < uriCount; i++) uris.push(r.string());

  const objectCount = r.u32le();
  const objectRefs = objectCount > 0 ? readInterleavedReferentArray(r, objectCount) : [];

  const externalObjectCount = r.u32le();
  if (externalObjectCount > 0) {
    // Not meaningful outside Studio's internal copy/paste; still must be consumed.
    readInterleavedReferentArray(r, externalObjectCount);
  }

  let uriIdx = 0;
  let objIdx = 0;
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const t = sourceTypes[i];
    if (t === 1) {
      out[i] = { kind: 'uri', uri: uris[uriIdx++] };
    } else if (t === 2) {
      out[i] = { kind: 'object', ref: objectRefs[objIdx++] };
    } else {
      out[i] = { kind: 'none' };
    }
  }
  return out;
}

function readPropertyArray(typeId, r, count, ctx) {
  switch (typeId) {
    case 0x01: { // String
      const out = [];
      for (let i = 0; i < count; i++) out.push(r.string());
      return out;
    }
    case 0x02: { // Bool
      const out = [];
      for (let i = 0; i < count; i++) out.push(r.u8() !== 0);
      return out;
    }
    case 0x03: // Int32
      return readInterleavedI32Array(r, count);
    case 0x04: // Float32
      return readInterleavedF32Array(r, count);
    case 0x05: { // Float64
      const out = [];
      for (let i = 0; i < count; i++) out.push(r.f64le());
      return out;
    }
    case 0x06: { // UDim
      const scales = readInterleavedF32Array(r, count);
      const offsets = readInterleavedI32Array(r, count);
      const out = [];
      for (let i = 0; i < count; i++) out.push({ scale: scales[i], offset: offsets[i] });
      return out;
    }
    case 0x07: { // UDim2
      const xs = readInterleavedF32Array(r, count);
      const ys = readInterleavedF32Array(r, count);
      const xo = readInterleavedI32Array(r, count);
      const yo = readInterleavedI32Array(r, count);
      const out = [];
      for (let i = 0; i < count; i++) {
        out.push({ x: { scale: xs[i], offset: xo[i] }, y: { scale: ys[i], offset: yo[i] } });
      }
      return out;
    }
    case 0x08: { // Ray
      const out = [];
      for (let i = 0; i < count; i++) {
        out.push({
          origin: { x: r.f32le(), y: r.f32le(), z: r.f32le() },
          direction: { x: r.f32le(), y: r.f32le(), z: r.f32le() },
        });
      }
      return out;
    }
    case 0x09: { // Faces
      const out = [];
      for (let i = 0; i < count; i++) out.push(r.u8());
      return out;
    }
    case 0x0a: { // Axes
      const out = [];
      for (let i = 0; i < count; i++) out.push(r.u8());
      return out;
    }
    case 0x0b: // BrickColor
      return readInterleavedU32Array(r, count);
    case 0x0c: { // Color3
      const rs = readInterleavedF32Array(r, count);
      const gs = readInterleavedF32Array(r, count);
      const bs = readInterleavedF32Array(r, count);
      const out = [];
      for (let i = 0; i < count; i++) out.push({ r: rs[i], g: gs[i], b: bs[i] });
      return out;
    }
    case 0x0d: { // Vector2
      const xs = readInterleavedF32Array(r, count);
      const ys = readInterleavedF32Array(r, count);
      const out = [];
      for (let i = 0; i < count; i++) out.push({ x: xs[i], y: ys[i] });
      return out;
    }
    case 0x0e: { // Vector3
      const xs = readInterleavedF32Array(r, count);
      const ys = readInterleavedF32Array(r, count);
      const zs = readInterleavedF32Array(r, count);
      const out = [];
      for (let i = 0; i < count; i++) out.push({ x: xs[i], y: ys[i], z: zs[i] });
      return out;
    }
    case 0x10: { // CFrame
      const ids = [];
      const rotations = [];
      for (let i = 0; i < count; i++) {
        const id = r.u8();
        ids.push(id);
        if (id === 0) {
          const m = [];
          for (let k = 0; k < 9; k++) m.push(r.f32le());
          rotations.push(m);
        } else {
          rotations.push(CFRAME_ROTATIONS[id] || [1, 0, 0, 0, 1, 0, 0, 0, 1]);
        }
      }
      const xs = readInterleavedF32Array(r, count);
      const ys = readInterleavedF32Array(r, count);
      const zs = readInterleavedF32Array(r, count);
      const out = [];
      for (let i = 0; i < count; i++) {
        out.push({ position: { x: xs[i], y: ys[i], z: zs[i] }, rotation: rotations[i] });
      }
      return out;
    }
    case 0x12: // Enum
      return readInterleavedU32Array(r, count);
    case 0x13: // Referent
      return readInterleavedReferentArray(r, count);
    case 0x14: { // Vector3int16
      const out = [];
      for (let i = 0; i < count; i++) {
        const x = r.buf.readInt16LE(r.pos); r.pos += 2;
        const y = r.buf.readInt16LE(r.pos); r.pos += 2;
        const z = r.buf.readInt16LE(r.pos); r.pos += 2;
        out.push({ x, y, z });
      }
      return out;
    }
    case 0x15: { // NumberSequence
      const out = [];
      for (let i = 0; i < count; i++) out.push(readNumberSequence(r));
      return out;
    }
    case 0x16: { // ColorSequence
      const out = [];
      for (let i = 0; i < count; i++) out.push(readColorSequence(r));
      return out;
    }
    case 0x17: { // NumberRange
      const out = [];
      for (let i = 0; i < count; i++) out.push({ min: r.f32le(), max: r.f32le() });
      return out;
    }
    case 0x18: { // Rect
      const minX = readInterleavedF32Array(r, count);
      const minY = readInterleavedF32Array(r, count);
      const maxX = readInterleavedF32Array(r, count);
      const maxY = readInterleavedF32Array(r, count);
      const out = [];
      for (let i = 0; i < count; i++) {
        out.push({ min: { x: minX[i], y: minY[i] }, max: { x: maxX[i], y: maxY[i] } });
      }
      return out;
    }
    case 0x19: { // PhysicalProperties
      const out = [];
      for (let i = 0; i < count; i++) out.push(readPhysicalProperties(r));
      return out;
    }
    case 0x1a: { // Color3uint8
      const rs = []; const gs = []; const bs = [];
      for (let i = 0; i < count; i++) rs.push(r.u8());
      for (let i = 0; i < count; i++) gs.push(r.u8());
      for (let i = 0; i < count; i++) bs.push(r.u8());
      const out = [];
      for (let i = 0; i < count; i++) out.push({ r: rs[i], g: gs[i], b: bs[i] });
      return out;
    }
    case 0x1b: // Int64
      return readInterleavedI64Array(r, count);
    case 0x1c: { // SharedString (index into SSTR, big-endian u32 interleaved)
      const idxs = readInterleavedU32Array(r, count);
      return idxs.map((idx) => (ctx.sharedStrings && ctx.sharedStrings[idx] ? ctx.sharedStrings[idx].value : ''));
    }
    case 0x1d: { // Bytecode - treat like String, kept raw (base64) and not written to XML by default
      const out = [];
      for (let i = 0; i < count; i++) out.push(r.string());
      return out;
    }
    case 0x1e: { // OptionalCoordinateFrame
      const innerTypeId = r.u8(); // should be 0x10
      const cframes = readPropertyArray(innerTypeId, r, count, ctx);
      const boolTypeId = r.u8(); // should be 0x02
      const out = [];
      for (let i = 0; i < count; i++) out.push(r.u8() !== 0);
      const merged = [];
      for (let i = 0; i < count; i++) {
        merged.push(out[i] ? cframes[i] : null);
      }
      return merged;
    }
    case 0x1f: { // UniqueId
      const raw = r.bytes(count * 16);
      const flat = deinterleave(Buffer.from(raw), count, 16);
      const out = [];
      for (let i = 0; i < count; i++) {
        const base = i * 16;
        const index = flat.readUInt32BE(base);
        const time = flat.readUInt32BE(base + 4);
        const random = flat.readBigUInt64BE(base + 8);
        out.push({ index, time, random });
      }
      return out;
    }
    case 0x20: { // Font
      const out = [];
      for (let i = 0; i < count; i++) {
        const family = r.string();
        const weight = r.u16le();
        const style = r.u8();
        const cachedFaceId = r.string();
        out.push({ family, weight, style, cachedFaceId });
      }
      return out;
    }
    case 0x21: // SecurityCapabilities (opaque 64-bit flag set, e.g. Instance.Capabilities)
      return readInterleavedU64Array(r, count);
    case 0x22: // Content
      return readContent(r, count);
    default:
      throw new Error(`Unsupported property type id 0x${typeId.toString(16)}`);
  }
}

module.exports = { readPropertyArray, readInterleavedReferentArray };
