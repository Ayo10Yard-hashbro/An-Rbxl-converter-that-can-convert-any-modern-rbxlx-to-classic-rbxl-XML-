'use strict';

/*
 * Mesh compatibility conversion.
 *
 * Old Roblox (pre-2017) used SpecialMesh children on Parts for custom geometry.
 * Modern Roblox uses MeshPart (introduced ~2017) which has geometry built in.
 *
 * This module performs two conversions when targeting old years:
 *   1. MeshPart → Part + SpecialMesh child (full conversion with mesh/texture IDs)
 *   2. Modern SpecialMesh Content-type props → classic string props
 *
 * It also handles UnionOperation → Part + SpecialMesh (brick shape fallback, since
 * CSG geometry cannot be represented in old clients, but at least something shows up).
 *
 * MeshType enum token values (stable across all Roblox versions):
 *   Head=0, Torso=1, Wedge=2,
 *   Prism=3 / Pyramid=4 / ParallelRamp=5 / RightAngleRamp=6 / CornerWedge=7 (all deprecated ~2012)
 *   Brick=8, Sphere=9, Cylinder=10, FileMesh=11
 *
 * For old clients (pre-2012) the deprecated prism/pyramid types existed but FileMesh
 * has always serialised as token 4 in pre-2012 .rbxlx files found in the wild.
 * We use 4 for maximum compatibility. Modern Studio exports it as 4 too.
 */

const MESHTYPE_FILE   = 4;   // FileMesh  (custom asset)
const MESHTYPE_BRICK  = 8;   // Brick     (box, same as plain Part)
const MESHTYPE_SPHERE = 9;   // Sphere
const MESHTYPE_WEDGE  = 2;   // Wedge

// Properties on MeshPart/UnionOperation that are NOT valid on a plain Part
// and must be stripped when downgrading.
const MESHPART_DROP_PROPS = new Set([
  'MeshContent', 'TextureContent', 'MeshId', 'MeshSizeOffset',
  'InitialSize', 'DoubleSided', 'RenderFidelity', 'LevelOfDetail',
  'FluidFidelity', 'HasJointOffset', 'JointOffset',
  // CSG-specific
  'ChildData', 'MeshData', 'PhysicsData', 'SmoothingAngle',
]);

// Modern SpecialMesh properties that don't exist on old clients.
// We handle these separately below, since MeshId/TextureId are still valid
// but may arrive as Content type (0x22) in modern binary files.
const SPECIALMESH_MODERN_PROPS = new Set([
  'MeshContent', 'TextureContent',
  'RenderFidelity', 'DoubleSided', 'FluidFidelity',
]);

// ------------------------------------------------------------------
// Utility: extract a URI string from a Content value (type 0x22).
// Returns '' if empty/object-ref.
// ------------------------------------------------------------------
function contentUri(val) {
  if (!val) return '';
  if (val.kind === 'uri') return val.uri || '';
  return '';
}

// ------------------------------------------------------------------
// Utility: make a simple string property Map entry
// ------------------------------------------------------------------
function strProp(value)   { return { typeId: 0x01, value }; }
function tokenProp(value) { return { typeId: 0x12, value }; }
function v3Prop(x, y, z)  { return { typeId: 0x0e, value: { x, y, z } }; }

// ------------------------------------------------------------------
// Allocate a fresh referent ID that doesn't collide with anything in the DOM.
// ------------------------------------------------------------------
function allocRef(dom) {
  let max = -1;
  for (const ref of dom.instances.keys()) {
    if (ref > max) max = ref;
  }
  return max + 1;
}

// ------------------------------------------------------------------
// Inject a new node into the DOM as a child of `parent`.
// ------------------------------------------------------------------
function injectChild(dom, parent, className, properties, insertAfterIndex) {
  const ref = allocRef(dom);
  const node = {
    referent: ref,
    className,
    isService: false,
    properties: new Map(Object.entries(properties)),
    children: [],
    parent,
  };
  dom.instances.set(ref, node);

  // Insert at `insertAfterIndex` in parent's children, or append at end
  if (insertAfterIndex != null && insertAfterIndex >= 0) {
    parent.children.splice(insertAfterIndex + 1, 0, node);
  } else {
    parent.children.push(node);
  }
  return node;
}

// ------------------------------------------------------------------
// Convert a single MeshPart node → Part + SpecialMesh child.
// Mutates node in place.
// ------------------------------------------------------------------
function convertMeshPart(dom, node, warnings) {
  const props = node.properties;

  // Pull out mesh and texture URIs before we strip them
  const meshContent   = props.get('MeshContent')   || props.get('MeshId');
  const texContent    = props.get('TextureContent') || props.get('TextureId');
  const meshUri   = meshContent ? (meshContent.typeId === 0x22 ? contentUri(meshContent.value) : (meshContent.value || '')) : '';
  const texUri    = texContent  ? (texContent.typeId  === 0x22 ? contentUri(texContent.value)  : (texContent.value  || '')) : '';

  // Original name for the SpecialMesh child
  const nameProp  = props.get('Name');
  const partName  = nameProp ? nameProp.value : 'MeshPart';

  // Strip all MeshPart-specific properties
  for (const k of MESHPART_DROP_PROPS) props.delete(k);

  // Rename to Part
  node.className = 'Part';
  warnings.push(`MeshPart "${partName}" converted to Part + SpecialMesh child (mesh: ${meshUri || 'none'}).`);

  // Build SpecialMesh properties
  const smProps = {
    Name:     strProp('Mesh'),
    MeshType: tokenProp(meshUri ? MESHTYPE_FILE : MESHTYPE_BRICK),
  };
  if (meshUri) smProps.MeshId = strProp(meshUri);
  if (texUri)  smProps.TextureId = strProp(texUri);
  // Scale defaults to (1,1,1); old Studio always wrote it
  smProps.Scale  = v3Prop(1, 1, 1);
  smProps.Offset = v3Prop(0, 0, 0);

  injectChild(dom, node, 'SpecialMesh', smProps, null);
}

// ------------------------------------------------------------------
// Convert a single UnionOperation node → Part + SpecialMesh (Brick).
// This preserves geometry as a plain box — actual CSG data is unloadable
// in old clients, but a brick placeholder is better than nothing.
// ------------------------------------------------------------------
function convertUnion(dom, node, warnings) {
  const props = node.properties;
  const nameProp = props.get('Name');
  const partName = nameProp ? nameProp.value : 'Union';

  for (const k of MESHPART_DROP_PROPS) props.delete(k);
  node.className = 'Part';
  warnings.push(`UnionOperation "${partName}" converted to Part (CSG mesh geometry cannot be represented in old clients; a plain brick is used instead).`);
}

// ------------------------------------------------------------------
// Normalise modern SpecialMesh/BlockMesh properties for old clients.
//   - MeshContent (0x22) → MeshId (string 0x01)
//   - TextureContent (0x22) → TextureId (string 0x01)
//   - Drop modern-only props
// ------------------------------------------------------------------
function normaliseSpecialMesh(node, warnings) {
  const props = node.properties;
  let changed = false;

  const mc = props.get('MeshContent');
  if (mc && mc.typeId === 0x22) {
    const uri = contentUri(mc.value);
    props.delete('MeshContent');
    if (uri) {
      props.set('MeshId', strProp(uri));
      changed = true;
    }
  }

  const tc = props.get('TextureContent');
  if (tc && tc.typeId === 0x22) {
    const uri = contentUri(tc.value);
    props.delete('TextureContent');
    if (uri) {
      props.set('TextureId', strProp(uri));
      changed = true;
    }
  }

  for (const k of SPECIALMESH_MODERN_PROPS) {
    if (props.has(k)) { props.delete(k); changed = true; }
  }

  if (changed) {
    warnings.push(`Normalised SpecialMesh/BlockMesh "${(props.get('Name') || { value: '' }).value}" for old client (Content→string, modern props stripped).`);
  }
}

// ------------------------------------------------------------------
// Convert Decal / Texture Content props to legacy string format.
// Decal.TextureContent (0x22) → Decal.Texture (string)
// Texture.TextureContent (0x22) → Texture.Texture (string)
// ImageLabel.ImageContent (0x22) → ImageLabel.Image (string)
// ImageButton.ImageContent (0x22) → ImageButton.Image (string)
// Sound.AudioContent (0x22) → Sound.SoundId (string)
// ------------------------------------------------------------------
const CONTENT_TO_STRING_MAP = {
  'Decal.TextureContent':          'Texture',
  'Texture.TextureContent':        'Texture',
  'ImageLabel.ImageContent':       'Image',
  'ImageButton.ImageContent':      'Image',
  'Sound.AudioContent':            'SoundId',
  'MeshPart.MeshContent':          'MeshId',       // fallback (shouldn't reach here post-convert)
  'SurfaceAppearance.ColorMapContent':      null,   // drop (no old equivalent)
  'SurfaceAppearance.MetalnessMapContent':  null,
  'SurfaceAppearance.NormalMapContent':     null,
  'SurfaceAppearance.RoughnessMapContent':  null,
  'WrapTarget.CageMeshContent':             null,
  'ScrollingFrame.BottomImageContent':      'BottomImage',
  'ScrollingFrame.MidImageContent':         'MidImage',
  'ScrollingFrame.TopImageContent':         'TopImage',
};

function normaliseContentProps(node, warnings) {
  const props = node.properties;
  let changed = false;

  for (const [propName, prop] of props.entries()) {
    if (prop.typeId !== 0x22) continue;
    const key = `${node.className}.${propName}`;
    if (!(key in CONTENT_TO_STRING_MAP)) continue;

    const targetProp = CONTENT_TO_STRING_MAP[key];
    props.delete(propName);

    if (targetProp === null) {
      // no old equivalent — just drop it
      changed = true;
      continue;
    }

    const uri = contentUri(prop.value);
    if (uri && !props.has(targetProp)) {
      props.set(targetProp, strProp(uri));
    }
    changed = true;
  }
  return changed;
}

// ------------------------------------------------------------------
// Main entry point — call from yearCompat.filterDomForYear BEFORE
// the generic class-replacement loop so MeshPart is converted
// before it would otherwise be naively renamed to Part.
// ------------------------------------------------------------------
function convertMeshesForYear(dom, year, warnings) {
  if (!year) return;

  // Snapshot: conversion may add children
  const nodes = Array.from(dom.instances.values());

  for (const node of nodes) {
    if (!dom.instances.has(node.referent)) continue;

    // ------------------------------------------------------------------
    // 1. MeshPart → Part + SpecialMesh  (MeshPart arrived ~2017)
    // ------------------------------------------------------------------
    if (node.className === 'MeshPart' && year < 2017) {
      convertMeshPart(dom, node, warnings);
      continue;
    }

    // ------------------------------------------------------------------
    // 2. UnionOperation/NegateOperation → Part
    //    (CSG arrived 2014, but geometry can never load in old clients)
    // ------------------------------------------------------------------
    if ((node.className === 'UnionOperation' || node.className === 'NegateOperation') && year < 2014) {
      convertUnion(dom, node, warnings);
      continue;
    }

    // ------------------------------------------------------------------
    // 3. SpecialMesh / BlockMesh: normalise Content-type props → strings
    //    (SpecialMesh has existed since the beginning; only its
    //     modern Content-type variants of MeshId/TextureId are new)
    // ------------------------------------------------------------------
    if (node.className === 'SpecialMesh' || node.className === 'BlockMesh') {
      normaliseSpecialMesh(node, warnings);
      continue;
    }

    // ------------------------------------------------------------------
    // 4. All other classes: convert Content-type asset-ref props
    //    (Decal.TextureContent, Sound.AudioContent, ImageLabel.ImageContent …)
    //    to the classic string property that old clients understand.
    // ------------------------------------------------------------------
    normaliseContentProps(node, warnings);
  }
}

module.exports = { convertMeshesForYear, MESHTYPE_FILE, MESHTYPE_BRICK, MESHTYPE_SPHERE };
