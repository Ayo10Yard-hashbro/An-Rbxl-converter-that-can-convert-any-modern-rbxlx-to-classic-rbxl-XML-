'use strict';
const { buildDom } = require('../lib/dom');
const { filterDomForYear } = require('../lib/yearCompat');
const { writeRbxlx } = require('../lib/xmlWriter');

const fakeParsed = {
  classes: new Map([
    [0, { className: 'Workspace',      isService: true,  referents: [0] }],
    [1, { className: 'MeshPart',       isService: false, referents: [1] }],
    [2, { className: 'Part',           isService: false, referents: [2] }],
    [3, { className: 'SpecialMesh',    isService: false, referents: [3] }],
    [4, { className: 'Decal',          isService: false, referents: [4] }],
    [5, { className: 'Sound',          isService: false, referents: [5] }],
    [6, { className: 'UnionOperation', isService: false, referents: [6] }],
    [7, { className: 'ImageLabel',     isService: false, referents: [7] }],
  ]),
  properties: [
    { classId: 1, name: 'Name',           typeId: 0x01, values: ['AlienShip'] },
    { classId: 1, name: 'MeshContent',    typeId: 0x22, values: [{ kind: 'uri', uri: 'rbxassetid://11111' }] },
    { classId: 1, name: 'TextureContent', typeId: 0x22, values: [{ kind: 'uri', uri: 'rbxassetid://22222' }] },
    { classId: 1, name: 'Size',           typeId: 0x0e, values: [{ x: 4, y: 4, z: 4 }] },
    { classId: 1, name: 'RenderFidelity', typeId: 0x12, values: [0] },
    { classId: 1, name: 'DoubleSided',    typeId: 0x02, values: [false] },
    { classId: 3, name: 'Name',           typeId: 0x01, values: ['Mesh'] },
    { classId: 3, name: 'MeshContent',    typeId: 0x22, values: [{ kind: 'uri', uri: 'rbxassetid://33333' }] },
    { classId: 3, name: 'TextureContent', typeId: 0x22, values: [{ kind: 'uri', uri: 'rbxassetid://44444' }] },
    { classId: 3, name: 'RenderFidelity', typeId: 0x12, values: [0] },
    { classId: 4, name: 'Name',           typeId: 0x01, values: ['MyDecal'] },
    { classId: 4, name: 'TextureContent', typeId: 0x22, values: [{ kind: 'uri', uri: 'rbxassetid://55555' }] },
    { classId: 5, name: 'Name',           typeId: 0x01, values: ['Boom'] },
    { classId: 5, name: 'AudioContent',   typeId: 0x22, values: [{ kind: 'uri', uri: 'rbxassetid://66666' }] },
    { classId: 6, name: 'Name',           typeId: 0x01, values: ['ArchDoor'] },
    { classId: 6, name: 'Size',           typeId: 0x0e, values: [{ x: 8, y: 6, z: 1 }] },
    { classId: 7, name: 'Name',           typeId: 0x01, values: ['Banner'] },
    { classId: 7, name: 'ImageContent',   typeId: 0x22, values: [{ kind: 'uri', uri: 'rbxassetid://77777' }] },
  ],
  parentChildren: [0, 1, 2, 3, 4, 5, 6, 7],
  parentParents:  [-1, 0, 0, 2, 2, 0, 0, 0],
};

const dom = buildDom(fakeParsed);
const warnings = [];
filterDomForYear(dom, 2012, warnings);
const { xml } = writeRbxlx(dom.roots, dom.instances, { year: 2012 });

console.log('=== WARNINGS ===');
warnings.forEach(w => console.log(' •', w));

console.log('\n=== CHECKS ===');
const checks = [
  ['No MeshPart class in output',             !xml.includes('class="MeshPart"')],
  ['AlienShip is now a Part',                  xml.includes('class="Part"')],
  ['SpecialMesh child exists',                 xml.includes('class="SpecialMesh"')],
  ['MeshId from MeshContent',                  xml.includes('rbxassetid://11111')],
  ['TextureId from TextureContent',            xml.includes('rbxassetid://22222')],
  ['MeshId is string not Content',             xml.includes('<string name="MeshId">')],
  ['MeshType token FileMesh=4',                xml.includes('<token name="MeshType">4<')],
  ['Existing SpecialMesh MeshId extracted',    xml.includes('rbxassetid://33333')],
  ['Existing SpecialMesh TextureId extracted', xml.includes('rbxassetid://44444')],
  ['No MeshContent in output',                !xml.includes('"MeshContent"')],
  ['Decal Texture extracted',                  xml.includes('rbxassetid://55555')],
  ['Decal prop name is Texture',               xml.includes('<string name="Texture">')],
  ['Sound SoundId extracted',                  xml.includes('rbxassetid://66666')],
  ['Sound prop name is SoundId',               xml.includes('<string name="SoundId">')],
  ['No UnionOperation class',                 !xml.includes('class="UnionOperation"')],
  ['ArchDoor name preserved',                  xml.includes('ArchDoor')],
  ['ImageLabel Image extracted',               xml.includes('rbxassetid://77777')],
  ['ImageLabel prop name is Image',            xml.includes('<string name="Image">')],
];
checks.forEach(([l, p]) => console.log(p ? 'OK' : 'FAIL', l));
const passed = checks.filter(c => c[1]).length;
console.log(`\n${passed}/${checks.length} checks passed`);
