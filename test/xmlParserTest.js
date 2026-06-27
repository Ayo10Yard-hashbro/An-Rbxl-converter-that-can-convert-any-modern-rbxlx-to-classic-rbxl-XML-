'use strict';

const { parseRbxlx, isXmlFormat } = require('../lib/xmlParser');
const { writeRbxlx }              = require('../lib/xmlWriter');
const { filterDomForYear }        = require('../lib/yearCompat');
const { convert }                 = require('../lib/convert');

let passed = 0, total = 0;
function ok(label, cond) {
  total++;
  if (cond) { passed++; console.log('OK  ', label); }
  else       console.log('FAIL', label);
}

// ── minimal XML fixture ───────────────────────────────────────────────────────
const SAMPLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<roblox xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="4">
  <External>null</External>
  <External>nil</External>
  <Item class="Workspace" referent="R0">
    <Properties>
      <string name="Name">Workspace</string>
      <bool name="FilteringEnabled">false</bool>
      <int name="StreamingRadius">0</int>
      <float name="Gravity">196.2</float>
      <SecurityCapabilities name="Capabilities">31</SecurityCapabilities>
      <UniqueId name="UniqueId">0102030405060708090a0b0c0d0e0f10</UniqueId>
    </Properties>
    <Item class="Part" referent="R1">
      <Properties>
        <string name="Name">MyPart</string>
        <bool name="Anchored">true</bool>
        <float name="Transparency">0.5</float>
        <int name="BrickColor">194</int>
        <Vector3 name="Size"><X>4</X><Y>1.2</Y><Z>2</Z></Vector3>
        <CoordinateFrame name="CFrame">
          <X>10</X><Y>5</Y><Z>0</Z>
          <R00>1</R00><R01>0</R01><R02>0</R02>
          <R10>0</R10><R11>1</R11><R12>0</R12>
          <R20>0</R20><R21>0</R21><R22>1</R22>
        </CoordinateFrame>
        <Color3 name="Color"><R>1</R><G>0</G><B>0</B></Color3>
        <token name="Material">256</token>
        <Ref name="SomePrimaryPart">R1</Ref>
        <Content name="TextureId"><url>rbxassetid://123456</url></Content>
        <NumberRange name="AttachmentForward">0 1 </NumberRange>
      </Properties>
    </Item>
    <Item class="SpecialMesh" referent="R2">
      <Properties>
        <string name="Name">Mesh</string>
        <token name="MeshType">4</token>
        <string name="MeshId">rbxassetid://999</string>
        <Vector3 name="Scale"><X>1</X><Y>1</Y><Z>1</Z></Vector3>
      </Properties>
    </Item>
    <Item class="MeshPart" referent="R3">
      <Properties>
        <string name="Name">AlienShip</string>
        <Content name="MeshContent"><uri>rbxassetid://77777</uri></Content>
        <Content name="TextureContent"><uri>rbxassetid://88888</uri></Content>
        <Vector3 name="Size"><X>6</X><Y>3</Y><Z>6</Z></Vector3>
      </Properties>
    </Item>
  </Item>
</roblox>`;

const buf = Buffer.from(SAMPLE_XML, 'utf8');

// ── format detection ──────────────────────────────────────────────────────────
ok('isXmlFormat XML',    isXmlFormat(buf));
ok('isXmlFormat binary', !isXmlFormat(Buffer.from('<roblox!\x89\xff\r\n\x1a\n')));
ok('isXmlFormat BOM',    isXmlFormat(Buffer.concat([Buffer.from([0xef,0xbb,0xbf]), buf])));

// ── parse XML ────────────────────────────────────────────────────────────────
const { instances, roots, warnings: pw } = parseRbxlx(buf);
ok('parse: no errors',        pw.length === 0);
ok('parse: root count',       roots.length === 1);
ok('parse: root class',       roots[0].className === 'Workspace');
ok('parse: 4 instances',      instances.size === 4);

const ws  = roots[0];
const pt  = ws.children.find(c => c.className === 'Part');
const sm  = ws.children.find(c => c.className === 'SpecialMesh');
const mp  = ws.children.find(c => c.className === 'MeshPart');

ok('parse: Part found',           !!pt);
ok('parse: SpecialMesh found',    !!sm);
ok('parse: MeshPart found',       !!mp);

// string
ok('string prop',          pt?.properties.get('Name')?.value === 'MyPart');
// bool
ok('bool prop (true)',     pt?.properties.get('Anchored')?.value === true);
// float
ok('float prop',           Math.abs((pt?.properties.get('Transparency')?.value ?? -1) - 0.5) < 1e-5);
// int
ok('int prop',             pt?.properties.get('BrickColor')?.value === 194);
// Vector3
const sz = pt?.properties.get('Size')?.value;
ok('Vector3 prop X',       Math.abs((sz?.x ?? 0) - 4) < 1e-4);
ok('Vector3 prop Y',       Math.abs((sz?.y ?? 0) - 1.2) < 1e-3);
// CoordinateFrame
const cf = pt?.properties.get('CFrame')?.value;
ok('CFrame position X',    Math.abs((cf?.position.x ?? 0) - 10) < 1e-4);
ok('CFrame rotation R00',  Math.abs((cf?.rotation[0] ?? 0) - 1) < 1e-5);
// Color3
const col = pt?.properties.get('Color')?.value;
ok('Color3 R',             Math.abs((col?.r ?? 0) - 1) < 1e-5);
// token (Enum)
ok('token prop',           pt?.properties.get('Material')?.value === 256);
// Ref (resolved to integer)
ok('Ref resolved to int',  typeof pt?.properties.get('SomePrimaryPart')?.value === 'number');
// Content — old <url> format parsed as uri
const tex = pt?.properties.get('TextureId')?.value;
ok('Content <url> parsed', tex?.kind === 'uri' && tex?.uri === 'rbxassetid://123456');
// Content — new <uri> format
const mc = mp?.properties.get('MeshContent')?.value;
ok('Content <uri> parsed', mc?.kind === 'uri' && mc?.uri === 'rbxassetid://77777');
// NumberRange
const nr = pt?.properties.get('AttachmentForward')?.value;
ok('NumberRange min',      (nr?.min ?? -1) === 0);
ok('NumberRange max',      Math.abs((nr?.max ?? 0) - 1) < 1e-5);
// SecurityCapabilities
ok('SecurityCapabilities', ws.properties.get('Capabilities')?.value === 31n);
// UniqueId
const uid = ws.properties.get('UniqueId')?.value;
ok('UniqueId parsed',      uid?.time === 0x090a0b0c);
// SpecialMesh props
ok('SpecialMesh MeshType', sm?.properties.get('MeshType')?.value === 4);
ok('SpecialMesh MeshId',   sm?.properties.get('MeshId')?.value === 'rbxassetid://999');

// ── write → re-parse round-trip ───────────────────────────────────────────────
const dom1 = { instances, roots };
const { xml: xml1 } = writeRbxlx(dom1.roots, dom1.instances, { year: null });
const rt = parseRbxlx(Buffer.from(xml1, 'utf8'));
const pt2 = [...rt.roots[0]?.children].find(c => c.className === 'Part');
ok('round-trip: Name',         pt2?.properties.get('Name')?.value === 'MyPart');
ok('round-trip: Anchored',     pt2?.properties.get('Anchored')?.value === true);
ok('round-trip: BrickColor',   pt2?.properties.get('BrickColor')?.value === 194);

// ── year-filter on XML input via convert() ────────────────────────────────────
const r2012 = convert(buf, { year: 2012, filename: 'test.rbxlx' });
ok('convert xml: no crash',      typeof r2012.xml === 'string');
ok('convert xml: inputFormat',   r2012.stats.inputFormat === 'xml');
ok('convert xml: instances > 0', r2012.stats.instanceCount > 0);
// MeshPart → Part+SpecialMesh; MeshContent → MeshId string
ok('convert xml: no MeshPart class',     !r2012.xml.includes('class="MeshPart"'));
ok('convert xml: SpecialMesh injected',  r2012.xml.includes('class="SpecialMesh"'));
ok('convert xml: MeshId string',         r2012.xml.includes('rbxassetid://77777'));
// SecurityCapabilities dropped for 2012
ok('convert xml: Capabilities dropped',  !r2012.xml.includes('SecurityCapabilities'));
// UniqueId dropped for 2012
ok('convert xml: UniqueId dropped',      !r2012.xml.includes('UniqueId'));
// Content <url> written for legacy
ok('convert xml: legacy url format',     r2012.xml.includes('<url>rbxassetid://123456</url>'));
// isModel false for .rbxlx
ok('convert xml: not isModel',           r2012.isModel === false);

// ── .rbxmx → isModel true ────────────────────────────────────────────────────
const rm = convert(buf, { year: null, filename: 'test.rbxmx' });
ok('rbxmx: isModel true', rm.isModel === true);

console.log(`\n${passed}/${total} checks passed`);
process.exit(passed === total ? 0 : 1);
