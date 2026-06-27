'use strict';

const { convertMeshesForYear } = require('./meshConvert');

/*
 * Best-effort, hand-curated approximation of when Roblox engine classes and
 * properties became available, plus a "what existed back then that did a
 * similar job" fallback system. Roblox has never published an official
 * machine-readable timeline of its class/property history, so treat all of
 * this as a heuristic aimed at the common cases (services/instances people
 * actually put in places), not a guarantee. Classes/properties not listed
 * are assumed to have always existed (no filtering applied to them).
 */

// Year a class first existed.
const CLASS_INTRO_YEAR = {
  // --- Containers / scripting ---
  Folder: 2014,
  Configuration: 2013,
  ModuleScript: 2013,
  LocalScript: 2008,

  // --- CSG / parts ---
  UnionOperation: 2014,
  NegateOperation: 2014,
  MeshPart: 2017,
  WedgePart: 2008,
  CornerWedgePart: 2010,
  TrussPart: 2008,
  VehicleSeat: 2009,
  SurfaceAppearance: 2021,

  // --- Constraints (rigid + force, 2014-2018 "Constraints" system) ---
  RopeConstraint: 2014,
  SpringConstraint: 2014,
  RodConstraint: 2014,
  CylindricalConstraint: 2014,
  PrismaticConstraint: 2014,
  HingeConstraint: 2014,
  BallSocketConstraint: 2014,
  UniversalConstraint: 2016,
  VectorForce: 2014,
  Torque: 2014,
  LineForce: 2018,
  AlignPosition: 2017,
  AlignOrientation: 2017,
  LinearVelocity: 2018,
  AngularVelocity: 2018,
  WeldConstraint: 2017,
  NoCollisionConstraint: 2018,

  // --- Particles / effects ---
  ParticleEmitter: 2013,
  Beam: 2017,
  Trail: 2017,
  Atmosphere: 2018,
  DepthOfFieldEffect: 2018,
  BlurEffect: 2013,
  ColorCorrectionEffect: 2013,
  SunRaysEffect: 2014,
  BloomEffect: 2013,

  // --- Interaction ---
  ProximityPrompt: 2020,
  ClickDetector: 2008,
  Dialog: 2012,
  DialogChoice: 2012,
  TextChatService: 2021,
  Chat: 2008,

  // --- Services added over time ---
  CollectionService: 2014,
  TweenService: 2014,
  PathfindingService: 2015,
  HttpService: 2013,
  TestService: 2013,
  BadgeService: 2008,
  GamePassService: 2013,
  MarketplaceService: 2013,
  TeleportService: 2010,
  DataStoreService: 2013,
  RunService: 2008,
  UserInputService: 2013,
  ContextActionService: 2014,
  StarterGui: 2008,
  StarterPack: 2008,
  StarterPlayer: 2014,

  // --- GUI ---
  ScrollingFrame: 2012,
  ViewportFrame: 2015,
  UIListLayout: 2014,
  UIGridLayout: 2014,
  UIPageLayout: 2015,
  UITableLayout: 2016,
  UIPadding: 2016,
  UISizeConstraint: 2015,
  UITextSizeConstraint: 2015,
  UIAspectRatioConstraint: 2016,
  UICorner: 2019,
  UIStroke: 2019,
  UIGradient: 2017,

  // --- Terrain ---
  Terrain: 2011, // classic blocky terrain; smooth terrain landed in 2015 (see PROPERTY_INTRO_YEAR)
};

// Year a specific ClassName.PropertyName became available.
const PROPERTY_INTRO_YEAR = {
  'BasePart.Massless': 2018,
  'BasePart.CollisionGroupId': 2014,
  'BasePart.CustomPhysicalProperties': 2015,
  'BasePart.Material': 2012,
  'BasePart.MaterialVariant': 2021,
  'BasePart.CastShadow': 2013,
  'Part.Shape': 2008,
  'Humanoid.DisplayName': 2019,
  'Humanoid.RigType': 2016,
  'Humanoid.BreakJointsOnDeath': 2019,
  'Humanoid.HealthDisplayDistance': 2017,
  'Humanoid.NameDisplayDistance': 2017,
  'Lighting.Technology': 2014,
  'Lighting.ExposureCompensation': 2020,
  'Workspace.StreamingEnabled': 2018,
  'Workspace.FilteringEnabled': 2014,
  'Instance.Tags': 2018,
  'Instance.AttributesSerialize': 2020,
  'Instance.SourceAssetId': 2019,
  'Script.LinkedSource': 2013,
  'Terrain.Decoration': 2015,
  'Terrain.WaterColor': 2015,
  'Terrain.WaterTransparency': 2015,
  'Terrain.WaterWaveSize': 2015,
  'Terrain.WaterWaveSpeed': 2015,
};

// Properties that, regardless of class, indicate modern attribute/tag storage.
const ALWAYS_MODERN_PROPS = new Set(['AttributesSerialize', 'Tags', 'CollisionGroupId', 'SourceAssetId']);

// Classes with no period-correct equivalent, where the safest move is to drop
// the instance but keep its children (reparenting them up one level) rather
// than leave a broken/renamed class behind. Mostly cosmetic UI modifiers.
const DROP_CLASSES = new Set([
  'UICorner', 'UIStroke', 'UIGradient', 'UIPadding', 'UIAspectRatioConstraint',
  'UISizeConstraint', 'UITextSizeConstraint', 'SurfaceAppearance', 'Atmosphere',
  'DepthOfFieldEffect', 'NoCollisionConstraint',
]);

// Ordered "what did a similar job back then" candidates. The resolver tries
// each in order and picks the first one that's actually available for the
// target year (recursively, so a chain can fall through more than one step).
const FALLBACK_CHAIN = {
  Folder: ['Model'],
  Configuration: ['Model'],
  ModuleScript: ['Script'],

  // MeshPart and UnionOperation/NegateOperation are handled by meshConvert.js
  // BEFORE this loop runs, so they won't appear here for old-year targets.
  // Leave them here as a safety fallback for years where meshConvert skips them.
  MeshPart: ['Part'],
  UnionOperation: ['Part'],
  NegateOperation: ['Part'],
  WeldConstraint: ['Weld'],

  // Rigid/joint-style constraints behave most like an old rigid Weld once
  // their physics simulation is unavailable.
  RopeConstraint: ['Weld'],
  SpringConstraint: ['Weld'],
  RodConstraint: ['Weld'],
  CylindricalConstraint: ['Weld'],
  PrismaticConstraint: ['Weld'],
  HingeConstraint: ['Weld'],
  BallSocketConstraint: ['Weld'],
  UniversalConstraint: ['Weld'],

  // Force-style constraints map onto the old "Body mover" objects that did
  // the same conceptual job (apply forces/velocities to a part).
  VectorForce: ['BodyForce'],
  LineForce: ['BodyForce'],
  Torque: ['BodyAngularVelocity'],
  AlignPosition: ['BodyPosition'],
  AlignOrientation: ['BodyGyro'],
  LinearVelocity: ['BodyVelocity'],
  AngularVelocity: ['BodyAngularVelocity'],

  ProximityPrompt: ['ClickDetector'],
  TextChatService: ['Chat'],
  Dialog: ['ClickDetector'],

  ScrollingFrame: ['Frame'],
  ViewportFrame: ['Frame'],
  UIListLayout: [], // no good substitute; resolver will fall back to generic handling
  UIGridLayout: [],
  UIPageLayout: ['Frame'],
  UITableLayout: [],

  ParticleEmitter: ['Sparkles'],
  Beam: ['Sparkles'],
  Trail: ['Sparkles'],
  BlurEffect: [],
  ColorCorrectionEffect: [],
  SunRaysEffect: [],
  BloomEffect: [],
};

function isAvailable(className, year) {
  const introYear = CLASS_INTRO_YEAR[className];
  return !introYear || introYear <= year;
}

// Recursively resolve a class to something available in `year`.
// Returns { className } or { drop: true }.
function resolveClassForYear(className, year, warnings, visited = new Set()) {
  if (isAvailable(className, year)) return { className };
  if (visited.has(className)) return { className: 'Model' }; // safety net against cycles
  visited.add(className);

  if (DROP_CLASSES.has(className)) {
    return { drop: true };
  }

  const candidates = FALLBACK_CHAIN[className];
  if (candidates && candidates.length) {
    for (const candidate of candidates) {
      const resolved = resolveClassForYear(candidate, year, warnings, visited);
      if (!resolved.drop) {
        return resolved;
      }
    }
  }

  // No usable candidate: fall back to a generic container so the hierarchy
  // and any descendants survive, but the specific behavior is lost.
  return { className: 'Model', genericFallback: true };
}

function dropInstance(dom, node) {
  const children = node.children;
  if (node.parent) {
    const siblings = node.parent.children;
    const idx = siblings.indexOf(node);
    if (idx !== -1) siblings.splice(idx, 1, ...children);
    children.forEach((c) => { c.parent = node.parent; });
  } else {
    const idx = dom.roots.indexOf(node);
    if (idx !== -1) dom.roots.splice(idx, 1, ...children);
    children.forEach((c) => { c.parent = null; });
  }
  dom.instances.delete(node.referent);
}

function filterDomForYear(dom, year, warnings) {
  if (!year) return; // no filtering requested

  // Phase 1: dedicated mesh conversion (MeshPart→Part+SpecialMesh, Content→string, etc.)
  // Must run BEFORE the generic class-replacement loop.
  // Also normalises Decal/Sound/ImageLabel Content props for any year target.
  convertMeshesForYear(dom, year, warnings);

  // Phase 2: generic class replacement / dropping
  const nodes = Array.from(dom.instances.values());

  for (const node of nodes) {
    if (!dom.instances.has(node.referent)) continue; // already dropped as someone else's child
    if (isAvailable(node.className, year)) continue;

    const resolved = resolveClassForYear(node.className, year, warnings);
    if (resolved.drop) {
      warnings.push(`"${node.className}" did not exist by ${year} and has no period-correct equivalent, so it was removed (its children were kept).`);
      dropInstance(dom, node);
      continue;
    }
    const introYear = CLASS_INTRO_YEAR[node.className];
    if (resolved.genericFallback) {
      warnings.push(`"${node.className}" (introduced ~${introYear}) has no period-correct equivalent for ${year}; converted to a plain "Model" to preserve the hierarchy.`);
    } else if (resolved.className !== node.className) {
      warnings.push(`"${node.className}" (introduced ~${introYear}) didn't exist by ${year}; replaced with "${resolved.className}", which served a similar role back then.`);
    }
    node.className = resolved.className;
  }

  for (const node of dom.instances.values()) {
    for (const propName of Array.from(node.properties.keys())) {
      const key = `${node.className}.${propName}`;
      const introP = PROPERTY_INTRO_YEAR[key] || (ALWAYS_MODERN_PROPS.has(propName) ? 2018 : undefined);
      if (introP && introP > year) {
        node.properties.delete(propName);
        warnings.push(`Removed property "${propName}" on "${node.className}" (introduced around ${introP}, after ${year}).`);
      }
    }
  }
}

module.exports = { filterDomForYear, CLASS_INTRO_YEAR, PROPERTY_INTRO_YEAR, resolveClassForYear };
