'use strict';

const { isDefaultValue, ALWAYS_DROP_PROPS, DROP_BEFORE_YEAR } = require('./defaults');

function escapeText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#13;');
}

function escapeAttr(s) {
  return escapeText(s).replace(/"/g, '&quot;');
}

// Full double precision for float64
function formatFloat(n) {
  if (Number.isNaN(n)) return 'NAN';
  if (n === Infinity) return 'INF';
  if (n === -Infinity) return '-INF';
  if (Object.is(n, -0)) return '-0';
  return String(n);
}

// 32-bit floats: 9 sig figs avoids noisy float32→double artifacts
function formatFloat32(n) {
  if (Number.isNaN(n)) return 'NAN';
  if (n === Infinity) return 'INF';
  if (n === -Infinity) return '-INF';
  if (n === 0) return Object.is(n, -0) ? '-0' : '0';
  return String(parseFloat(n.toPrecision(9)));
}

function formatInt(n) {
  return String(Math.trunc(n));
}

function rotl64(big, bits) {
  const m = (1n << 64n) - 1n;
  big &= m;
  return ((big << BigInt(bits)) | (big >> BigInt(64 - bits))) & m;
}

// Short referents save ~8 bytes per instance per reference (30%+ on ref-heavy files)
function buildReferentMap(instances) {
  const map = new Map();
  let i = 0;
  for (const ref of instances.keys()) {
    map.set(ref, 'R' + i++);
  }
  return map;
}

function v3(v) {
  return `<X>${formatFloat32(v.x)}</X><Y>${formatFloat32(v.y)}</Y><Z>${formatFloat32(v.z)}</Z>`;
}
function v2(v) {
  return `<X>${formatFloat32(v.x)}</X><Y>${formatFloat32(v.y)}</Y>`;
}

// opts.year   — target year (number) or null
// opts.legacy — if true, use <url> inside Content tags (old client format)
function propertyBody(typeId, value, refMap, opts) {
  const legacy = opts && opts.legacy;

  switch (typeId) {
    case 0x01: return { tag: 'string', body: escapeText(value) };
    case 0x02: return { tag: 'bool',   body: value ? 'true' : 'false' };
    case 0x03: return { tag: 'int',    body: formatInt(value) };
    case 0x04: return { tag: 'float',  body: formatFloat32(value) };
    case 0x05: return { tag: 'double', body: formatFloat(value) };
    case 0x06:
      return { tag: 'UDim', body: `<S>${formatFloat32(value.scale)}</S><O>${formatInt(value.offset)}</O>` };
    case 0x07:
      return {
        tag: 'UDim2',
        body: `<XS>${formatFloat32(value.x.scale)}</XS><XO>${formatInt(value.x.offset)}</XO>` +
              `<YS>${formatFloat32(value.y.scale)}</YS><YO>${formatInt(value.y.offset)}</YO>`,
      };
    case 0x08:
      return { tag: 'Ray', body: `<origin>${v3(value.origin)}</origin><direction>${v3(value.direction)}</direction>` };
    case 0x09: return { tag: 'Faces',  body: `<faces>${formatInt(value)}</faces>` };
    case 0x0a: return { tag: 'Axes',   body: `<axes>${formatInt(value)}</axes>` };
    case 0x0b: return { tag: 'int',    body: formatInt(value) }; // BrickColor
    case 0x0c:
      return { tag: 'Color3', body: `<R>${formatFloat32(value.r)}</R><G>${formatFloat32(value.g)}</G><B>${formatFloat32(value.b)}</B>` };
    case 0x0d:
      return { tag: 'Vector2', body: `<X>${formatFloat32(value.x)}</X><Y>${formatFloat32(value.y)}</Y>` };
    case 0x0e:
      return { tag: 'Vector3', body: v3(value) };
    case 0x10: { // CFrame → CoordinateFrame
      const m = value.rotation;
      const p = value.position;
      return {
        tag: 'CoordinateFrame',
        body: `<X>${formatFloat32(p.x)}</X><Y>${formatFloat32(p.y)}</Y><Z>${formatFloat32(p.z)}</Z>` +
              `<R00>${formatFloat32(m[0])}</R00><R01>${formatFloat32(m[1])}</R01><R02>${formatFloat32(m[2])}</R02>` +
              `<R10>${formatFloat32(m[3])}</R10><R11>${formatFloat32(m[4])}</R11><R12>${formatFloat32(m[5])}</R12>` +
              `<R20>${formatFloat32(m[6])}</R20><R21>${formatFloat32(m[7])}</R21><R22>${formatFloat32(m[8])}</R22>`,
      };
    }
    case 0x12: return { tag: 'token', body: formatInt(value) }; // Enum
    case 0x13: { // Referent
      if (value === -1 || !refMap.has(value)) return { tag: 'Ref', body: 'null' };
      return { tag: 'Ref', body: refMap.get(value) };
    }
    case 0x14:
      return { tag: 'Vector3int16', body: `<X>${formatInt(value.x)}</X><Y>${formatInt(value.y)}</Y><Z>${formatInt(value.z)}</Z>` };
    case 0x15: {
      let s = '';
      for (const kp of value) s += `${formatFloat32(kp.time)} ${formatFloat32(kp.value)} ${formatFloat32(kp.envelope)} `;
      return { tag: 'NumberSequence', body: s };
    }
    case 0x16: {
      let s = '';
      for (const kp of value) s += `${formatFloat32(kp.time)} ${formatFloat32(kp.r)} ${formatFloat32(kp.g)} ${formatFloat32(kp.b)} ${formatFloat32(kp.envelope)} `;
      return { tag: 'ColorSequence', body: s };
    }
    case 0x17:
      return { tag: 'NumberRange', body: `${formatFloat32(value.min)} ${formatFloat32(value.max)} ` };
    case 0x18:
      return { tag: 'Rect2D', body: `<min>${v2(value.min)}</min><max>${v2(value.max)}</max>` };
    case 0x19: {
      if (!value) return { tag: 'PhysicalProperties', body: '<CustomPhysics>false</CustomPhysics>' };
      return {
        tag: 'PhysicalProperties',
        body: '<CustomPhysics>true</CustomPhysics>' +
              `<Density>${formatFloat32(value.density)}</Density>` +
              `<Friction>${formatFloat32(value.friction)}</Friction>` +
              `<Elasticity>${formatFloat32(value.elasticity)}</Elasticity>` +
              `<FrictionWeight>${formatFloat32(value.frictionWeight)}</FrictionWeight>` +
              `<ElasticityWeight>${formatFloat32(value.elasticityWeight)}</ElasticityWeight>`,
      };
    }
    case 0x1a: { // Color3uint8
      const packed = (0xff000000 | ((value.r & 0xff) << 16) | ((value.g & 0xff) << 8) | (value.b & 0xff)) >>> 0;
      return { tag: 'Color3uint8', body: String(packed) };
    }
    case 0x1b: return { tag: 'int64', body: value.toString() };
    case 0x1c: return { tag: 'string', body: escapeText(value) }; // SharedString resolved
    case 0x1d: return null; // Bytecode: always drop
    case 0x1e: { // OptionalCoordinateFrame
      // Old clients (pre-2016) don't know this tag — emit as regular CoordinateFrame
      if (legacy) {
        if (!value) return null; // skip null optional CFrames entirely for old clients
        return propertyBody(0x10, value, refMap, opts);
      }
      if (!value) return { tag: 'OptionalCoordinateFrame', body: '' };
      const inner = propertyBody(0x10, value, refMap, opts);
      return { tag: 'OptionalCoordinateFrame', body: `<CFrame>${inner.body}</CFrame>` };
    }
    case 0x1f: { // UniqueId
      // Old clients crash on <UniqueId>; this should already be filtered by propShouldDrop
      // but we handle it here as a safety net: drop for legacy, keep for modern
      if (legacy) return null;
      const random = rotl64(value.random, 1);
      const hex = (n, len) => n.toString(16).padStart(len, '0');
      const hexStr = hex(random, 16) + hex(BigInt(value.time), 8) + hex(BigInt(value.index), 8);
      return { tag: 'UniqueId', body: hexStr };
    }
    case 0x20: { // Font
      if (legacy) {
        // Old clients: emit the family URL as a plain string (best we can do)
        return { tag: 'string', body: escapeText(value.family) };
      }
      const styleNames = { 0: 'Normal', 1: 'Italic' };
      let s = `<Family><url>${escapeText(value.family)}</url></Family><Weight>${formatInt(value.weight)}</Weight>` +
        `<Style>${styleNames[value.style] || 'Normal'}</Style>`;
      if (value.cachedFaceId) s += `<CachedFaceId><url>${escapeText(value.cachedFaceId)}</url></CachedFaceId>`;
      return { tag: 'Font', body: s };
    }
    case 0x21: { // SecurityCapabilities
      // <SecurityCapabilities> crashes old XML parsers — drop for legacy
      if (legacy) return null;
      return { tag: 'SecurityCapabilities', body: value.toString() };
    }
    case 0x22: { // Content
      // Old Roblox XML uses <Content><url>...</url></Content>
      // New format uses <uri>. We convert based on legacy flag.
      if (value.kind === 'uri') {
        const inner = legacy ? `<url>${escapeText(value.uri)}</url>` : `<uri>${escapeText(value.uri)}</uri>`;
        return { tag: 'Content', body: inner };
      }
      if (value.kind === 'object') {
        const ref = value.ref === -1 || !refMap.has(value.ref) ? 'null' : refMap.get(value.ref);
        return { tag: 'Content', body: legacy ? '<url></url>' : `<Ref>${ref}</Ref>` };
      }
      return { tag: 'Content', body: legacy ? '<url></url>' : '<null></null>' };
    }
    default:
      return null; // unknown type: silently drop rather than crash the client
  }
}

// Should this property be dropped entirely?
function propShouldDrop(propName, typeId, year) {
  if (ALWAYS_DROP_PROPS.has(propName)) return true;
  if (year) {
    const minYear = DROP_BEFORE_YEAR.get(propName);
    if (minYear && minYear > year) return true;
  }
  return false;
}

function writeRbxlx(roots, instances, opts = {}) {
  const warnings = [];
  const year = opts.year || null;
  // "legacy" mode: target old Roblox client parsers (anything before 2018 or so)
  const legacy = year && year < 2018;
  const refMap = buildReferentMap(instances);
  const writerOpts = { year, legacy };

  // Minified XML — no whitespace between tags.
  // Old and new Roblox parsers both handle minified XML fine.
  const parts = [];
  parts.push('<?xml version="1.0" encoding="utf-8"?>');
  parts.push('<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">');
  parts.push('<External>null</External>');
  parts.push('<External>nil</External>');

  let droppedDefaults = 0;
  let droppedModern = 0;

  function writeItem(node) {
    const referent = refMap.get(node.referent);
    parts.push(`<Item class="${escapeAttr(node.className)}" referent="${escapeAttr(referent)}"><Properties>`);

    for (const [name, prop] of node.properties.entries()) {
      // Drop always-unsafe / year-gated properties
      if (propShouldDrop(name, prop.typeId, year)) {
        droppedModern++;
        continue;
      }

      // Drop default values to reduce file size
      if (isDefaultValue(node.className, name, prop.typeId, prop.value)) {
        droppedDefaults++;
        continue;
      }

      const result = propertyBody(prop.typeId, prop.value, refMap, writerOpts);
      if (!result) continue;
      parts.push(`<${result.tag} name="${escapeAttr(name)}">${result.body}</${result.tag}>`);
    }

    parts.push('</Properties>');
    for (const child of node.children) writeItem(child);
    parts.push('</Item>');
  }

  for (const root of roots) writeItem(root);
  parts.push('</roblox>');

  if (droppedDefaults > 0) {
    warnings.push(`Stripped ${droppedDefaults} default-valued properties (safe; engine applies same defaults).`);
  }
  if (droppedModern > 0) {
    warnings.push(`Dropped ${droppedModern} modern/internal properties${year ? ` incompatible with ${year} clients` : ''} (UniqueId, Capabilities, Tags, Attributes etc.).`);
  }

  return { xml: parts.join(''), warnings };
}

module.exports = { writeRbxlx };
