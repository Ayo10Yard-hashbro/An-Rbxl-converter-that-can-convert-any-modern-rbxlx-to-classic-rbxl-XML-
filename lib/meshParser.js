'use strict';

const { Reader } = require('./reader');

/*
 * Roblox Binary Mesh Format
 * ─────────────────────────
 * Version 1.00 / 1.01  — ASCII text (triangle soup)
 * Version 2.00          — Binary, indexed, sizeof-prefixed header (headerSize=12)
 * Version 3.00          — Binary + LOD table (headerSize=16)
 * Version 4.00          — Binary + LOD + bone/skinning block (headerSize=24)
 * Version 5.00          — Binary + LOD + bones + physics convex hull (headerSize=24+)
 *
 * Binary vertex layout (field sizes depend on sizeof_vertex from header):
 *   Offset  Size  Field
 *    0      12    position    (f32 x,y,z)
 *   12      12    normal      (f32 nx,ny,nz)
 *   24       8    uv          (f32 u,v)
 *   32       4    tangent     (i8 tx,ty,tz,tw)   — if sizeof_vertex >= 36
 *   36       4    color       (u8 r,g,b,a)        — if sizeof_vertex >= 40
 *   40      16    bone wts    (f32 × 4)           — if sizeof_vertex >= 60 (v4+)
 *   56       4    bone idx    (u8 × 4)            — if sizeof_vertex >= 60
 *
 * Binary face layout (from sizeof_face):
 *   sizeof_face=12  → three u32 indices
 *   sizeof_face= 6  → three u16 indices
 */

// ── helpers ──────────────────────────────────────────────────────────────────

function findLineEnd(buf, start) {
  for (let i = start; i < buf.length; i++) {
    if (buf[i] === 0x0a) return i + 1; // past the \n
  }
  return buf.length;
}

// ── v1.xx text parser ────────────────────────────────────────────────────────

const BRACKET_GROUP_RE = /\[([^\]]+)\]/g;

function parseMeshV1(buf, versionStr) {
  const text = buf.toString('utf8');
  const rawLines = text.split('\n');
  const lines = rawLines.map(l => l.trim()).filter(l => l.length > 0);

  let li = 1; // skip version line

  // v1.01 has an extra "0" line between the version and face count
  if (versionStr === '1.01' || versionStr === '1.1') li++;

  const numFaces = parseInt(lines[li++], 10);
  if (isNaN(numFaces) || numFaces < 0) {
    throw new Error(`Bad face count "${lines[li - 1]}" in v${versionStr} mesh`);
  }

  const vertices = [];
  const faces    = [];

  for (let fi = 0; fi < numFaces; fi++) {
    const triVerts = [];
    for (let vi = 0; vi < 3; vi++) {
      const line = lines[li++];
      if (line === undefined) throw new Error(`Unexpected EOF at face ${fi} vertex ${vi}`);

      const groups = [];
      let m;
      BRACKET_GROUP_RE.lastIndex = 0;
      while ((m = BRACKET_GROUP_RE.exec(line)) !== null) {
        groups.push(m[1].split(',').map(s => parseFloat(s.trim())));
      }
      if (groups.length < 2) throw new Error(`Malformed vertex line: "${line}"`);

      const [pos, nrm, uvw = [0, 0, 0]] = groups;
      triVerts.push(vertices.length);
      vertices.push({
        x: pos[0] ?? 0, y: pos[1] ?? 0, z: pos[2] ?? 0,
        nx: nrm[0] ?? 0, ny: nrm[1] ?? 0, nz: nrm[2] ?? 0,
        u: uvw[0] ?? 0, v: uvw[1] ?? 0,
        hasTangent: false, hasColor: false,
        tx: 0, ty: 0, tz: 0, tw: 127,
        cr: 255, cg: 255, cb: 255, ca: 255,
        boneWeights: null, boneIndices: null,
      });
    }
    faces.push(triVerts);
  }

  return {
    versionStr, versionMajor: 1,
    numVerts: vertices.length,
    numFaces,
    vertices,
    faces,
    lods: [],
    bones: [],
    hasTangents: false,
    hasVertexColors: false,
    hasSkinning: false,
    hasLods: false,
  };
}

// ── v2.xx / v3.xx / v4.xx / v5.xx binary parser ──────────────────────────────

function parseMeshBinary(buf, versionMajor, versionStr) {
  // Find the end of the version text line (handles \r\n and \n)
  const lineEnd = findLineEnd(buf, 0);
  const r = new Reader(buf);
  r.pos = lineEnd;

  // ── header ─────────────────────────────────────────────────────────────────
  const headerStart = r.pos;
  const sizeof_header = r.u16le();
  const sizeof_vertex = r.u8();
  const sizeof_face   = r.u8();

  // Validate minimums
  if (sizeof_vertex < 32) throw new Error(`sizeof_vertex too small: ${sizeof_vertex}`);
  if (sizeof_face !== 6 && sizeof_face !== 12) {
    throw new Error(`Unexpected sizeof_face: ${sizeof_face} (expected 6 or 12)`);
  }

  let numLods = 0, numBones = 0, sizeof_skeleton = 0;
  let numVerts, numFaces;

  if (versionMajor <= 2) {
    // v2: header = sizeof_header(2) + sizeof_vertex(1) + sizeof_face(1) + numVerts(4) + numFaces(4) = 12
    numVerts = r.u32le();
    numFaces = r.u32le();
  } else if (versionMajor === 3) {
    // v3: adds num_lods (u16) + padding (u16)
    numLods  = r.u16le();
    r.u16le(); // reserved
    numVerts = r.u32le();
    numFaces = r.u32le();
  } else {
    // v4 / v5: adds skinning & skeleton block sizes
    numLods        = r.u16le();
    numBones       = r.u16le();
    numVerts       = r.u32le();
    numFaces       = r.u32le();
    sizeof_skeleton = (sizeof_header >= 24) ? r.u32le() : 0;
    // More optional fields in v5 — skip to end of header below
  }

  // Seek to end of declared header (vertex data starts here)
  r.pos = headerStart + sizeof_header;

  if (numVerts < 0 || numVerts > 10_000_000) throw new Error(`Implausible vertex count: ${numVerts}`);
  if (numFaces < 0 || numFaces > 10_000_000) throw new Error(`Implausible face count: ${numFaces}`);

  // ── vertex data ────────────────────────────────────────────────────────────
  const hasTangent  = sizeof_vertex >= 36;
  const hasColor    = sizeof_vertex >= 40;
  const hasSkinning = sizeof_vertex >= 60;

  const vertices = [];

  for (let i = 0; i < numVerts; i++) {
    const vStart = r.pos;

    const x = r.f32le(), y = r.f32le(), z = r.f32le();   //  0–11  position
    const nx = r.f32le(), ny = r.f32le(), nz = r.f32le(); // 12–23  normal
    const u = r.f32le(), v = r.f32le();                    // 24–31  uv

    let tx = 0, ty = 0, tz = 0, tw = 127;
    if (hasTangent) { tx = r.i8(); ty = r.i8(); tz = r.i8(); tw = r.i8(); } // 32–35

    let cr = 255, cg = 255, cb = 255, ca = 255;
    if (hasColor) { cr = r.u8(); cg = r.u8(); cb = r.u8(); ca = r.u8(); }   // 36–39

    let boneWeights = null, boneIndices = null;
    if (hasSkinning) {
      boneWeights = [r.f32le(), r.f32le(), r.f32le(), r.f32le()]; // 40–55
      boneIndices = [r.u8(),    r.u8(),    r.u8(),    r.u8()   ]; // 56–59
    }

    r.pos = vStart + sizeof_vertex; // stride safely over any extra fields

    vertices.push({ x, y, z, nx, ny, nz, u, v, tx, ty, tz, tw, cr, cg, cb, ca, boneWeights, boneIndices });
  }

  // ── face data ──────────────────────────────────────────────────────────────
  const faces = [];
  const is16 = sizeof_face === 6;

  for (let i = 0; i < numFaces; i++) {
    const i0 = is16 ? r.u16le() : r.u32le();
    const i1 = is16 ? r.u16le() : r.u32le();
    const i2 = is16 ? r.u16le() : r.u32le();
    faces.push([i0, i1, i2]);
  }

  // ── LOD table (v3+) ────────────────────────────────────────────────────────
  const lods = [];
  for (let i = 0; i < numLods; i++) lods.push(r.u32le());

  // ── bone/skeleton (v4+) ────────────────────────────────────────────────────
  // We read enough to give useful info but don't attempt to reconstruct the rig.
  const bones = [];
  if (versionMajor >= 4 && numBones > 0 && r.remaining() >= numBones * 60) {
    for (let b = 0; b < numBones; b++) {
      // Bone struct: 4×4 CFrame (64 bytes) + name string? — layout uncertain across tools.
      // We grab the translation as a rough sanity check.
      const bStart = r.pos;
      const tx = r.f32le(), ty = r.f32le(), tz = r.f32le();
      bones.push({ tx, ty, tz });
      r.pos = bStart + 60; // stride: empirically 60 bytes per bone entry in v4
    }
  }

  return {
    versionStr, versionMajor,
    numVerts, numFaces,
    vertices, faces,
    lods, bones,
    hasTangents: hasTangent,
    hasVertexColors: hasColor,
    hasSkinning,
    hasLods: numLods > 0,
  };
}

// ── public API ────────────────────────────────────────────────────────────────

function parseMesh(buf) {
  if (buf.length < 12) throw new Error('Buffer too small to be a .mesh file');

  const versionLine = buf.toString('ascii', 0, Math.min(buf.length, 20)).split('\n')[0].trim().replace('\r', '');

  if (!versionLine.startsWith('version ')) {
    throw new Error('Not a valid Roblox mesh file (missing "version " prefix)');
  }

  const versionStr  = versionLine.slice(8).trim(); // e.g. "1.00", "2.00"
  const versionNum  = parseFloat(versionStr);
  const versionMajor = Math.floor(versionNum);

  if (isNaN(versionNum)) throw new Error(`Unrecognised mesh version string: "${versionStr}"`);

  if (versionMajor <= 1) return parseMeshV1(buf, versionStr);
  if (versionMajor <= 5) return parseMeshBinary(buf, versionMajor, versionStr);

  throw new Error(`Unsupported mesh version ${versionStr} (supported: 1.00–5.00)`);
}

// ── bounding box helper ───────────────────────────────────────────────────────

function meshBounds(mesh) {
  if (mesh.vertices.length === 0) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const v of mesh.vertices) {
    if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
    if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
  }
  return { minX, minY, minZ, maxX, maxY, maxZ,
    sizeX: maxX - minX, sizeY: maxY - minY, sizeZ: maxZ - minZ };
}

module.exports = { parseMesh, meshBounds };
