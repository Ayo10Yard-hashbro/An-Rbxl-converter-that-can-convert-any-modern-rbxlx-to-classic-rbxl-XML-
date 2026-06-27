'use strict';

const { meshBounds } = require('./meshParser');

function f(n, dp = 6) { return n.toFixed(dp); }

// ── OBJ builder ───────────────────────────────────────────────────────────────

function meshToObj(mesh, baseName = 'mesh') {
  const { vertices, faces, lods, bones, versionStr,
          hasTangents, hasVertexColors, hasSkinning, hasLods } = mesh;

  const bounds = meshBounds(mesh);
  const lines  = [];
  const mtlName = `${baseName}.mtl`;

  // Header comment
  lines.push(`# Roblox mesh — version ${versionStr}`);
  lines.push(`# Vertices: ${mesh.numVerts}   Faces: ${mesh.numFaces}`);
  if (bounds) {
    lines.push(`# Bounding box size: ${f(bounds.sizeX,4)} × ${f(bounds.sizeY,4)} × ${f(bounds.sizeZ,4)} studs`);
  }
  if (hasLods)    lines.push(`# LOD levels: ${lods.length}`);
  if (hasSkinning) lines.push(`# Skinning: yes   Bones: ${bones.length}`);
  if (hasVertexColors) lines.push('# Vertex colours: yes (stored in material below)');
  lines.push(`mtllib ${mtlName}`);
  lines.push(`o ${baseName}`);
  lines.push('');

  // Positions
  for (const v of vertices) {
    lines.push(`v ${f(v.x)} ${f(v.y)} ${f(v.z)}`);
  }
  lines.push('');

  // UVs
  for (const v of vertices) {
    lines.push(`vt ${f(v.u)} ${f(1 - v.v)}`); // flip V for OBJ convention
  }
  lines.push('');

  // Normals
  for (const v of vertices) {
    lines.push(`vn ${f(v.nx)} ${f(v.ny)} ${f(v.nz)}`);
  }
  lines.push('');

  // Vertex colours as comments (no standard OBJ encoding)
  if (hasVertexColors) {
    lines.push('# Vertex colours (RGBA, per vertex index, 1-based):');
    vertices.forEach((v, i) => {
      if (v.cr !== 255 || v.cg !== 255 || v.cb !== 255 || v.ca !== 255) {
        lines.push(`# vc ${i + 1} ${v.cr} ${v.cg} ${v.cb} ${v.ca}`);
      }
    });
    lines.push('');
  }

  // Skinning info as comments
  if (hasSkinning && bones.length > 0) {
    lines.push('# Bone offsets (index, tx, ty, tz):');
    bones.forEach((b, i) => lines.push(`# bone ${i} ${f(b.tx,4)} ${f(b.ty,4)} ${f(b.tz,4)}`));
    lines.push('');
    lines.push('# Vertex skinning weights (vert-index, bone-idx0..3, weight0..3):');
    vertices.forEach((v, i) => {
      if (v.boneIndices && v.boneWeights) {
        const bi = v.boneIndices.join(' ');
        const bw = v.boneWeights.map(w => w.toFixed(4)).join(' ');
        lines.push(`# skin ${i + 1} ${bi} | ${bw}`);
      }
    });
    lines.push('');
  }

  // LOD table as comments
  if (hasLods && lods.length > 0) {
    lines.push('# LOD face split indices (faces 0..N for LOD0, N+1.. for LOD1, etc.):');
    lines.push('# lods ' + lods.join(' '));
    lines.push('');
  }

  // Faces
  lines.push(`usemtl ${baseName}`);
  lines.push('s 1');
  for (const [i0, i1, i2] of faces) {
    // OBJ is 1-based; v/vt/vn all share the same index (stored per-vertex)
    const a = i0 + 1, b = i1 + 1, c = i2 + 1;
    lines.push(`f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}`);
  }

  const obj = lines.join('\n');

  // ── MTL ────────────────────────────────────────────────────────────────────
  const mtl = [
    `# Material for ${baseName} (exported from Roblox mesh v${versionStr})`,
    `newmtl ${baseName}`,
    'Ka 1.000 1.000 1.000',    // ambient
    'Kd 0.800 0.800 0.800',    // diffuse
    'Ks 0.000 0.000 0.000',    // specular
    'd 1.0',                   // opacity
    'illum 1',
    '# Assign your own texture map_Kd here',
  ].join('\n');

  return { obj, mtl };
}

// ── human-readable summary ────────────────────────────────────────────────────

function meshSummary(mesh) {
  const bounds = meshBounds(mesh);
  const features = [];
  if (mesh.hasTangents)      features.push('tangents');
  if (mesh.hasVertexColors)  features.push('vertex colours');
  if (mesh.hasSkinning)      features.push(`skinning (${mesh.bones.length} bones)`);
  if (mesh.hasLods)          features.push(`${mesh.lods.length} LOD levels`);

  return {
    version:    mesh.versionStr,
    numVerts:   mesh.numVerts,
    numFaces:   mesh.numFaces,
    features:   features.join(', ') || 'none',
    boundsSize: bounds
      ? `${bounds.sizeX.toFixed(3)} × ${bounds.sizeY.toFixed(3)} × ${bounds.sizeZ.toFixed(3)}`
      : 'n/a',
    center: bounds
      ? {
          x: ((bounds.minX + bounds.maxX) / 2).toFixed(3),
          y: ((bounds.minY + bounds.maxY) / 2).toFixed(3),
          z: ((bounds.minZ + bounds.maxZ) / 2).toFixed(3),
        }
      : null,
  };
}

module.exports = { meshToObj, meshSummary };
