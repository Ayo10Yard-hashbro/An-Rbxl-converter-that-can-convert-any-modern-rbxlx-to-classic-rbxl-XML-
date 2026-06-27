'use strict';

const { parseMesh, meshBounds } = require('../lib/meshParser');
const { meshToObj, meshSummary } = require('../lib/meshExport');
const { Reader } = require('../lib/reader');

// ── helpers ───────────────────────────────────────────────────────────────────
function f32le(v) { const b = Buffer.alloc(4); b.writeFloatLE(v, 0); return b; }
function u16le(v) { const b = Buffer.alloc(2); b.writeUInt16LE(v, 0); return b; }
function u32le(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v, 0); return b; }
function u8b(...vs) { return Buffer.from(vs.map(v => v & 0xff)); }
function i8b(...vs) { return Buffer.from(vs.map(v => ((v % 256) + 256) % 256)); }

function buildVertex(x, y, z,  nx, ny, nz,  u, v,  tx = 127, ty = 0, tz = 0, tw = 127,  cr = 255, cg = 128, cb = 64, ca = 255) {
  return Buffer.concat([
    f32le(x), f32le(y), f32le(z),
    f32le(nx), f32le(ny), f32le(nz),
    f32le(u), f32le(v),
    i8b(tx, ty, tz, tw),  // tangent  (36 bytes so far)
    u8b(cr, cg, cb, ca),  // colour   (40 bytes total)
  ]);
}

// ── v1.00 text mesh ──────────────────────────────────────────────────────────
function buildV1Mesh() {
  return Buffer.from([
    'version 1.00',
    '2',
    '[0.0, 1.0, 0.0][0.0, 1.0, 0.0][0.5, 0.0, 0.0]',
    '[-1.0, 0.0, -1.0][0.0, 1.0, 0.0][0.0, 1.0, 0.0]',
    '[1.0, 0.0, -1.0][0.0, 1.0, 0.0][1.0, 1.0, 0.0]',
    '[0.0, 1.0, 0.0][0.0, 0.0, 1.0][0.5, 0.0, 0.0]',
    '[1.0, 0.0, -1.0][0.0, 0.0, 1.0][1.0, 0.0, 0.0]',
    '[1.0, 0.0, 1.0][0.0, 0.0, 1.0][1.0, 1.0, 0.0]',
    '',
  ].join('\n'), 'utf8');
}

// ── v2.00 binary mesh ────────────────────────────────────────────────────────
function buildV2Mesh() {
  const sizeof_header = 12;
  const sizeof_vertex = 40; // with colour
  const sizeof_face   = 12;
  const numVerts = 4;
  const numFaces = 2;

  const hdr = Buffer.concat([
    u16le(sizeof_header), u8b(sizeof_vertex), u8b(sizeof_face),
    u32le(numVerts), u32le(numFaces),
  ]);

  const verts = Buffer.concat([
    buildVertex( 0, 1, 0,  0,1,0,  0.5, 0),
    buildVertex(-1, 0,-1,  0,1,0,  0.0, 1),
    buildVertex( 1, 0,-1,  0,1,0,  1.0, 1),
    buildVertex( 1, 0, 1,  0,1,0,  1.0, 0),
  ]);

  const faces = Buffer.concat([
    u32le(0), u32le(1), u32le(2),
    u32le(0), u32le(2), u32le(3),
  ]);

  return Buffer.concat([Buffer.from('version 2.00\r\n'), hdr, verts, faces]);
}

// ── v3.00 binary mesh (with LOD) ─────────────────────────────────────────────
function buildV3Mesh() {
  const sizeof_header = 16;
  const sizeof_vertex = 40;
  const sizeof_face   = 12;
  const numLods  = 2;
  const numVerts = 4;
  const numFaces = 2;

  const hdr = Buffer.concat([
    u16le(sizeof_header), u8b(sizeof_vertex), u8b(sizeof_face),
    u16le(numLods), u16le(0), // reserved
    u32le(numVerts), u32le(numFaces),
  ]);

  const verts = Buffer.concat([
    buildVertex( 0, 1, 0,  0,1,0,  0.5, 0),
    buildVertex(-1, 0,-1,  0,1,0,  0.0, 1),
    buildVertex( 1, 0,-1,  0,1,0,  1.0, 1),
    buildVertex( 1, 0, 1,  0,1,0,  1.0, 0),
  ]);

  const faces = Buffer.concat([
    u32le(0), u32le(1), u32le(2),
    u32le(0), u32le(2), u32le(3),
  ]);

  const lodTable = Buffer.concat([u32le(2), u32le(2)]); // lod0=2 faces, lod1=2 faces

  return Buffer.concat([Buffer.from('version 3.00\r\n'), hdr, verts, faces, lodTable]);
}

// ── u16-index face mesh ───────────────────────────────────────────────────────
function buildV2MeshU16() {
  const sizeof_header = 12;
  const sizeof_vertex = 36;
  const sizeof_face   = 6; // u16 indices
  const numVerts = 3;
  const numFaces = 1;

  const hdr = Buffer.concat([
    u16le(sizeof_header), u8b(sizeof_vertex), u8b(sizeof_face),
    u32le(numVerts), u32le(numFaces),
  ]);

  function v36(x, y, z,  nx, ny, nz,  u, v) {
    return Buffer.concat([
      f32le(x),f32le(y),f32le(z),
      f32le(nx),f32le(ny),f32le(nz),
      f32le(u),f32le(v),
      i8b(127,0,0,127),
    ]);
  }

  const verts = Buffer.concat([
    v36(0,1,0, 0,1,0, 0.5,0),
    v36(-1,0,-1, 0,1,0, 0,1),
    v36(1,0,-1, 0,1,0, 1,1),
  ]);

  const face = Buffer.concat([u16le(0), u16le(1), u16le(2)]);

  return Buffer.concat([Buffer.from('version 2.00\r\n'), hdr, verts, face]);
}

// ── run tests ─────────────────────────────────────────────────────────────────
let passed = 0; let total = 0;
function check(label, cond) {
  total++;
  if (cond) { passed++; console.log('OK  ', label); }
  else       console.log('FAIL', label);
}

// --- v1.00 ---
const m1 = parseMesh(buildV1Mesh());
check('v1: version', m1.versionStr === '1.00');
check('v1: numFaces', m1.numFaces === 2);
check('v1: vertex count', m1.numVerts === 6);
check('v1: first vertex position', Math.abs(m1.vertices[0].y - 1.0) < 1e-5);
check('v1: first face indices', m1.faces[0].join(',') === '0,1,2');
check('v1: uv', Math.abs(m1.vertices[0].u - 0.5) < 1e-5);

// --- v2.00 u32 index ---
const m2 = parseMesh(buildV2Mesh());
check('v2: version',   m2.versionStr === '2.00');
check('v2: numVerts',  m2.numVerts === 4);
check('v2: numFaces',  m2.numFaces === 2);
check('v2: pos vert0', Math.abs(m2.vertices[0].y - 1.0) < 1e-5);
check('v2: normal',    Math.abs(m2.vertices[0].ny - 1.0) < 1e-5);
check('v2: uv vert2',  Math.abs(m2.vertices[2].u - 1.0) < 1e-5);
check('v2: colour',    m2.vertices[0].cg === 128);
check('v2: face0',     m2.faces[0].join(',') === '0,1,2');
check('v2: face1',     m2.faces[1].join(',') === '0,2,3');
check('v2: hasVertexColors', m2.hasVertexColors);

// --- v2.00 u16 index ---
const m2u = parseMesh(buildV2MeshU16());
check('v2u16: face index', m2u.faces[0].join(',') === '0,1,2');
check('v2u16: hasTangents', m2u.hasTangents);
check('v2u16: no colour', !m2u.hasVertexColors);

// --- v3.00 with LOD ---
const m3 = parseMesh(buildV3Mesh());
check('v3: version', m3.versionStr === '3.00');
check('v3: numVerts', m3.numVerts === 4);
check('v3: numFaces', m3.numFaces === 2);
check('v3: hasLods', m3.hasLods);
check('v3: lod count', m3.lods.length === 2);
check('v3: lod0', m3.lods[0] === 2);

// --- bounds ---
const b = meshBounds(m2);
check('bounds: sizeX', b.sizeX > 1.5);
check('bounds: sizeY', b.sizeY > 0.9);

// --- OBJ export ---
const { obj, mtl } = meshToObj(m2, 'testmesh');
check('obj: has vertices',   obj.includes('v 0.000000 1.000000 0.000000'));
check('obj: has normals',    obj.includes('vn 0.000000 1.000000 0.000000'));
check('obj: has uvs',        obj.includes('vt 0.500000'));
check('obj: has faces',      obj.includes('f 1/1/1 2/2/2 3/3/3'));
check('obj: mtllib',         obj.includes('mtllib testmesh.mtl'));
check('mtl: newmtl',         mtl.includes('newmtl testmesh'));

const s = meshSummary(m2);
check('summary: version',  s.version === '2.00');
check('summary: verts',    s.numVerts === 4);
check('summary: features', s.features.includes('vertex colour'));

console.log(`\n${passed}/${total} checks passed`);
process.exit(passed === total ? 0 : 1);
