'use strict';

const { XMLParser } = require('fast-xml-parser');

/*
 * Property tags that can appear more than once inside a single <Properties>
 * block (different Name attributes).  Forcing them to always be arrays gives
 * uniform iteration regardless of whether 1 or 50 <string> props are present.
 */
const PROP_ARRAY_TAGS = new Set([
  'string', 'ProtectedString', 'BinaryString', 'SharedString',
  'bool', 'int', 'float', 'double', 'int64', 'token', 'Ref',
  'BrickColor',
  'UDim', 'UDim2', 'Ray', 'Faces', 'Axes',
  'Color3', 'Color3uint8', 'Vector2', 'Vector3', 'Vector3int16',
  'CoordinateFrame', 'OptionalCoordinateFrame',
  'NumberSequence', 'ColorSequence', 'NumberRange',
  'Rect2D', 'PhysicalProperties',
  'UniqueId', 'Font', 'SecurityCapabilities', 'Content',
]);

const xmlParser = new XMLParser({
  ignoreAttributes:    false,
  attributeNamePrefix: '@_',
  parseTagValue:       false,   // keep everything as plain strings
  processEntities:     true,    // &amp; &lt; &#13; etc.
  trimValues:          false,   // preserve whitespace in script source
  textNodeName:        '#text',
  isArray: (name) => name === 'Item' || PROP_ARRAY_TAGS.has(name),
});

// ── value-extraction helpers ───────────────────────────────────────────────────

function getText(node) {
  if (node === null || node === undefined) return '';
  if (typeof node !== 'object') return String(node);
  return String(node['#text'] ?? '');
}

function getF(obj, key) { return parseFloat(getText(obj?.[key])) || 0; }
function getI(obj, key) { return parseInt(getText(obj?.[key]), 10) || 0; }

// ── property-node parser ───────────────────────────────────────────────────────

function parseProp(tag, node) {
  switch (tag) {
    case 'string':
    case 'ProtectedString':
    case 'SharedString':
      return { typeId: 0x01, value: getText(node) };

    case 'BinaryString': {
      const b64 = getText(node).replace(/\s/g, '');
      try { return { typeId: 0x01, value: Buffer.from(b64, 'base64').toString('binary') }; }
      catch { return { typeId: 0x01, value: '' }; }
    }

    case 'bool':
      return { typeId: 0x02, value: getText(node).trim() === 'true' };

    case 'int':
    case 'BrickColor':   // BrickColor serialised as <int> in our writer
      return { typeId: 0x03, value: parseInt(getText(node).trim(), 10) || 0 };

    case 'float':
      return { typeId: 0x04, value: parseFloat(getText(node).trim()) || 0 };

    case 'double':
      return { typeId: 0x05, value: parseFloat(getText(node).trim()) || 0 };

    case 'UDim':
      return { typeId: 0x06, value: { scale: getF(node, 'S'), offset: getI(node, 'O') } };

    case 'UDim2':
      return {
        typeId: 0x07,
        value: {
          x: { scale: getF(node, 'XS'), offset: getI(node, 'XO') },
          y: { scale: getF(node, 'YS'), offset: getI(node, 'YO') },
        },
      };

    case 'Ray': {
      const o = node.origin    || {};
      const d = node.direction || {};
      return {
        typeId: 0x08,
        value: {
          origin:    { x: getF(o,'X'), y: getF(o,'Y'), z: getF(o,'Z') },
          direction: { x: getF(d,'X'), y: getF(d,'Y'), z: getF(d,'Z') },
        },
      };
    }

    case 'Faces': return { typeId: 0x09, value: getI(node, 'faces') };
    case 'Axes':  return { typeId: 0x0a, value: getI(node, 'axes') };

    case 'Color3':
      return { typeId: 0x0c, value: { r: getF(node,'R'), g: getF(node,'G'), b: getF(node,'B') } };

    case 'Vector2':
      return { typeId: 0x0d, value: { x: getF(node,'X'), y: getF(node,'Y') } };

    case 'Vector3':
      return { typeId: 0x0e, value: { x: getF(node,'X'), y: getF(node,'Y'), z: getF(node,'Z') } };

    case 'CoordinateFrame':
      return {
        typeId: 0x10,
        value: {
          position: { x: getF(node,'X'), y: getF(node,'Y'), z: getF(node,'Z') },
          rotation: [
            getF(node,'R00'), getF(node,'R01'), getF(node,'R02'),
            getF(node,'R10'), getF(node,'R11'), getF(node,'R12'),
            getF(node,'R20'), getF(node,'R21'), getF(node,'R22'),
          ],
        },
      };

    case 'token':
      return { typeId: 0x12, value: parseInt(getText(node).trim(), 10) || 0 };

    case 'Ref':
      // Store string referent; resolved → integer in second pass
      return { typeId: 0x13, value: getText(node).trim(), _unresolved: true };

    case 'Vector3int16':
      return { typeId: 0x14, value: { x: getI(node,'X'), y: getI(node,'Y'), z: getI(node,'Z') } };

    case 'NumberSequence': {
      const pts = getText(node).trim().split(/\s+/);
      const kps = [];
      for (let i = 0; i + 2 < pts.length; i += 3)
        kps.push({ time: +pts[i]||0, value: +pts[i+1]||0, envelope: +pts[i+2]||0 });
      return { typeId: 0x15, value: kps };
    }

    case 'ColorSequence': {
      const pts = getText(node).trim().split(/\s+/);
      const kps = [];
      for (let i = 0; i + 4 < pts.length; i += 5)
        kps.push({ time: +pts[i]||0, r: +pts[i+1]||0, g: +pts[i+2]||0, b: +pts[i+3]||0, envelope: +pts[i+4]||0 });
      return { typeId: 0x16, value: kps };
    }

    case 'NumberRange': {
      const pts = getText(node).trim().split(/\s+/);
      return { typeId: 0x17, value: { min: +pts[0]||0, max: +pts[1]||0 } };
    }

    case 'Rect2D': {
      const mn = node.min || {};
      const mx = node.max || {};
      return {
        typeId: 0x18,
        value: {
          min: { x: getF(mn,'X'), y: getF(mn,'Y') },
          max: { x: getF(mx,'X'), y: getF(mx,'Y') },
        },
      };
    }

    case 'PhysicalProperties': {
      const isCustom = getText(node.CustomPhysics).trim() === 'true';
      if (!isCustom) return { typeId: 0x19, value: null };
      return {
        typeId: 0x19,
        value: {
          density:            getF(node,'Density'),
          friction:           getF(node,'Friction'),
          elasticity:         getF(node,'Elasticity'),
          frictionWeight:     getF(node,'FrictionWeight'),
          elasticityWeight:   getF(node,'ElasticityWeight'),
          acousticAbsorption: getF(node,'AcousticAbsorption') || 1.0,
        },
      };
    }

    case 'Color3uint8': {
      const packed = parseInt(getText(node).trim(), 10) >>> 0;
      return { typeId: 0x1a, value: { r: (packed>>>16)&0xff, g: (packed>>>8)&0xff, b: packed&0xff } };
    }

    case 'int64':
      try { return { typeId: 0x1b, value: BigInt(getText(node).trim()) }; }
      catch { return { typeId: 0x1b, value: 0n }; }

    case 'UniqueId': {
      const hex = getText(node).trim();
      try {
        return {
          typeId: 0x1f,
          value: {
            random: BigInt('0x' + hex.slice(0, 16)),
            time:   parseInt(hex.slice(16, 24), 16),
            index:  parseInt(hex.slice(24, 32), 16),
          },
        };
      } catch { return { typeId: 0x1f, value: { random: 0n, time: 0, index: 0 } }; }
    }

    case 'Font': {
      // <Family><url>rbxasset://...</url></Family>
      const fam = node.Family;
      let family = '';
      if (fam) {
        family = typeof fam === 'object'
          ? getText(fam.url ?? fam['#text'] ?? '')
          : getText(fam);
      }
      const styleMap = { Normal: 0, Italic: 1 };
      return {
        typeId: 0x20,
        value: {
          family,
          weight:       parseInt(getText(node.Weight).trim(), 10) || 400,
          style:        styleMap[getText(node.Style).trim()] ?? 0,
          cachedFaceId: '',
        },
      };
    }

    case 'SecurityCapabilities':
      try { return { typeId: 0x21, value: BigInt(getText(node).trim() || '0') }; }
      catch { return { typeId: 0x21, value: 0n }; }

    case 'Content': {
      // New:  <uri>url</uri>
      // Old:  <url>url</url>
      // Empty: <null/> or nothing
      const uriNode = node.uri ?? node.url;
      if (uriNode !== undefined)
        return { typeId: 0x22, value: { kind: 'uri', uri: getText(uriNode) } };
      if (node.Ref !== undefined)
        return { typeId: 0x22, value: { kind: 'object', ref: getText(node.Ref).trim(), _unresolved: true } };
      return { typeId: 0x22, value: { kind: 'none' } };
    }

    case 'OptionalCoordinateFrame': {
      const cf = node.CFrame;
      if (!cf) return { typeId: 0x1e, value: null };
      return {
        typeId: 0x1e,
        value: {
          position: { x: getF(cf,'X'), y: getF(cf,'Y'), z: getF(cf,'Z') },
          rotation: [
            getF(cf,'R00'), getF(cf,'R01'), getF(cf,'R02'),
            getF(cf,'R10'), getF(cf,'R11'), getF(cf,'R12'),
            getF(cf,'R20'), getF(cf,'R21'), getF(cf,'R22'),
          ],
        },
      };
    }

    default:
      return null; // unknown tag — skip silently
  }
}

// ── main parser ───────────────────────────────────────────────────────────────

function parseRbxlx(buf) {
  const hasBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const text   = buf.toString('utf8', hasBom ? 3 : 0);

  let rootObj;
  try {
    const parsed = xmlParser.parse(text);
    rootObj = parsed.roblox;
  } catch (e) {
    throw new Error(`XML parse error: ${e.message}`);
  }
  if (!rootObj) throw new Error('Not a valid Roblox XML file (no <roblox> root element)');

  const instances      = new Map(); // int ref → node
  const refStringToInt = new Map(); // 'RBX00000000' → int
  const roots          = [];
  const warnings       = [];
  let   nextRef        = 0;

  function alloc(refStr) {
    if (!refStr) return nextRef++;
    if (!refStringToInt.has(refStr)) refStringToInt.set(refStr, nextRef++);
    return refStringToInt.get(refStr);
  }

  function visitItem(itemNode, parent) {
    const className = itemNode['@_class'] || 'Model';
    const ref       = alloc(itemNode['@_referent'] || '');

    const node = {
      referent: ref, className,
      isService: false,
      properties: new Map(),
      children: [], parent: parent || null,
    };
    instances.set(ref, node);
    if (parent) parent.children.push(node);
    else        roots.push(node);

    // properties
    const props = itemNode.Properties;
    if (props && typeof props === 'object') {
      for (const [tag, val] of Object.entries(props)) {
        if (tag.startsWith('@') || tag === '#text') continue;
        const arr = Array.isArray(val) ? val : [val];
        for (const pn of arr) {
          if (!pn || typeof pn !== 'object') continue;
          const name = pn['@_name'];
          if (!name) continue;
          try {
            const r = parseProp(tag, pn);
            if (r) node.properties.set(name, r);
          } catch (e) {
            warnings.push(`${className}.${name} (${tag}): ${e.message}`);
          }
        }
      }
    }

    // children
    if (Array.isArray(itemNode.Item))
      for (const c of itemNode.Item) visitItem(c, node);
  }

  if (Array.isArray(rootObj.Item))
    for (const item of rootObj.Item) visitItem(item, null);

  // second pass — resolve Ref string → integer
  for (const node of instances.values()) {
    for (const prop of node.properties.values()) {
      if (prop.typeId === 0x13 && prop._unresolved) {
        const s = prop.value;
        prop.value = (s === 'null' || s === 'nil' || !s) ? -1
          : (refStringToInt.get(s) ?? -1);
        delete prop._unresolved;
      }
      if (prop.typeId === 0x22 && prop.value?._unresolved) {
        prop.value = { kind: 'object', ref: refStringToInt.get(prop.value.ref) ?? -1 };
      }
    }
  }

  return { instances, roots, warnings };
}

// ── format detection ──────────────────────────────────────────────────────────
// Binary rbxl starts with '<roblox!\x89\xff…' — the '!' distinguishes it.

function isXmlFormat(buf) {
  if (buf.length < 4) return false;
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return true; // BOM
  const h = buf.toString('ascii', 0, 9);
  if (h.startsWith('<?xml'))    return true;
  if (h.startsWith('<roblox!')) return false; // binary magic
  if (h.startsWith('<roblox'))  return true;
  return false;
}

module.exports = { parseRbxlx, isXmlFormat };
