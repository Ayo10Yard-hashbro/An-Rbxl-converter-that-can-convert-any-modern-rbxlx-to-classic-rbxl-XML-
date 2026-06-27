'use strict';

/*
 * Properties that have a known default value and are safe to omit from XML —
 * the engine will apply the same default when it doesn't see the tag.
 *
 * Format: 'ClassName.PropertyName' or '*PropName' (any class) → { typeId, match }
 *
 * match() receives the decoded value and returns true when it equals the default
 * (so we can skip writing it). Keep this conservative — only include properties
 * where we are certain the old engine applies the same default, because a wrong
 * omission is worse than a redundant inclusion.
 */

const DEFAULTS = new Map([
  // ---- Instance (applies to everything) ----
  ['*.Archivable',       { typeId: 0x02, match: (v) => v === true }],

  // ---- BasePart (Part, WedgePart, TrussPart, VehicleSeat …) ----
  ['BasePart.Anchored',       { typeId: 0x02, match: (v) => v === false }],
  ['BasePart.Locked',         { typeId: 0x02, match: (v) => v === false }],
  ['BasePart.Transparency',   { typeId: 0x04, match: (v) => Math.abs(v) < 1e-7 }],
  ['BasePart.Reflectance',    { typeId: 0x04, match: (v) => Math.abs(v) < 1e-7 }],
  ['BasePart.CanQuery',       { typeId: 0x02, match: (v) => v === true }],
  ['BasePart.CanTouch',       { typeId: 0x02, match: (v) => v === true }],
  ['BasePart.Massless',       { typeId: 0x02, match: (v) => v === false }],
  ['BasePart.CastShadow',     { typeId: 0x02, match: (v) => v === true }],

  // Part defaults
  ['Part.Locked',         { typeId: 0x02, match: (v) => v === false }],
  ['Part.Anchored',       { typeId: 0x02, match: (v) => v === false }],
  ['Part.Transparency',   { typeId: 0x04, match: (v) => Math.abs(v) < 1e-7 }],
  ['Part.Reflectance',    { typeId: 0x04, match: (v) => Math.abs(v) < 1e-7 }],
  // BrickColor 194 = Medium stone grey (the studio default)
  ['Part.BrickColor',     { typeId: 0x0b, match: (v) => v === 194 }],
  // Material 256 = Plastic enum
  ['Part.Material',       { typeId: 0x12, match: (v) => v === 256 }],
  // TopSurface 3 = Studs (classic default)
  ['Part.TopSurface',     { typeId: 0x12, match: (v) => v === 3 }],
  // BottomSurface 4 = Weld/Inlet (classic default)
  ['Part.BottomSurface',  { typeId: 0x12, match: (v) => v === 4 }],
  // Front/Back/Left/Right surfaces 0 = Smooth
  ['Part.FrontSurface',   { typeId: 0x12, match: (v) => v === 0 }],
  ['Part.BackSurface',    { typeId: 0x12, match: (v) => v === 0 }],
  ['Part.LeftSurface',    { typeId: 0x12, match: (v) => v === 0 }],
  ['Part.RightSurface',   { typeId: 0x12, match: (v) => v === 0 }],
  // Shape 1 = Block (PartType.Block)
  ['Part.Shape',          { typeId: 0x12, match: (v) => v === 1 }],

  // ---- Script / LocalScript ----
  ['Script.Disabled',     { typeId: 0x02, match: (v) => v === false }],
  ['LocalScript.Disabled',{ typeId: 0x02, match: (v) => v === false }],

  // ---- GuiObject base ----
  ['GuiObject.Visible',   { typeId: 0x02, match: (v) => v === true }],
  ['GuiObject.ZIndex',    { typeId: 0x03, match: (v) => v === 1 }],
  ['GuiObject.BorderSizePixel', { typeId: 0x03, match: (v) => v === 1 }],

  // ---- Humanoid ----
  ['Humanoid.MaxHealth',     { typeId: 0x04, match: (v) => Math.abs(v - 100) < 1e-5 }],
  ['Humanoid.JumpPower',     { typeId: 0x04, match: (v) => Math.abs(v - 50) < 1e-5 }],
  ['Humanoid.WalkSpeed',     { typeId: 0x04, match: (v) => Math.abs(v - 16) < 1e-5 }],
  ['Humanoid.NameOcclusion', { typeId: 0x12, match: (v) => v === 1 }], // OccludeAll
  ['Humanoid.DisplayDistanceType', { typeId: 0x12, match: (v) => v === 1 }],

  // ---- Lighting ----
  ['Lighting.Ambient',    { typeId: 0x1a, match: (v) => v.r === 0 && v.g === 0 && v.b === 0 }],
  ['Lighting.Brightness', { typeId: 0x04, match: (v) => Math.abs(v - 1) < 1e-5 }],
  ['Lighting.FogEnd',     { typeId: 0x04, match: (v) => v >= 100000 }],

  // ---- Sound ----
  ['Sound.Volume',        { typeId: 0x04, match: (v) => Math.abs(v - 0.5) < 1e-5 }],
  ['Sound.Looped',        { typeId: 0x02, match: (v) => v === false }],
  ['Sound.Playing',       { typeId: 0x02, match: (v) => v === false }],
]);

// Properties that are ALWAYS safe to drop — they're engine-internal,
// used only by Studio, or cause old clients to crash.
const ALWAYS_DROP_PROPS = new Set([
  'AttributesSerialize',
  'Tags',
  'SourceAssetId',
  'ScriptGuid',
]);

// Properties that are safe to drop for any year-targeted conversion
// (they either didn't exist or their type crashes old parsers).
// Keys are property names; values are the minimum year when they're safe to keep.
const DROP_BEFORE_YEAR = new Map([
  ['UniqueId',            2016],  // UUID concept arrived in Studio ~2016
  ['Capabilities',        9999],  // SecurityCapabilities crashes old parsers — always drop for year-targeted
  ['AttributesSerialize', 9999],  // always drop
  ['Tags',                9999],  // always drop
  ['SourceAssetId',       9999],  // always drop
  ['MaterialVariant',     2022],
  ['StreamingEnabled',    2019],
  ['FilteringEnabled',    2015],
  ['CollisionGroupId',    2015],
  ['Massless',            2019],
  ['CastShadow',          2014],
  ['CustomPhysicalProperties', 2016],
]);

function isDefaultValue(className, propName, typeId, value) {
  // Check class-specific default first
  const classKey = `${className}.${propName}`;
  const wildcardKey = `*.${propName}`;
  const entry = DEFAULTS.get(classKey) || DEFAULTS.get(wildcardKey);
  if (!entry) return false;
  if (entry.typeId !== typeId) return false;
  try { return entry.match(value); } catch { return false; }
}

module.exports = { DEFAULTS, ALWAYS_DROP_PROPS, DROP_BEFORE_YEAR, isDefaultValue };
