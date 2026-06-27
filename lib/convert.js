'use strict';

const { parseRbxl }            = require('./parser');
const { buildDom }             = require('./dom');
const { writeRbxlx }           = require('./xmlWriter');
const { filterDomForYear }     = require('./yearCompat');
const { parseRbxlx, isXmlFormat } = require('./xmlParser');

function isModelFile(filename) {
  return /\.rbxm(x)?$/i.test(filename || '');
}

function convert(buffer, options = {}) {
  const year    = options.year ? parseInt(options.year, 10) : null;
  const isModel = isModelFile(options.filename || '');

  let dom, parseWarnings;

  if (isXmlFormat(buffer)) {
    // ── XML input (.rbxlx / .rbxmx) ──────────────────────────────────────
    const result  = parseRbxlx(buffer);
    dom           = { instances: result.instances, roots: result.roots };
    parseWarnings = result.warnings;
  } else {
    // ── Binary input (.rbxl / .rbxm) ─────────────────────────────────────
    const parsed  = parseRbxl(buffer);
    dom           = buildDom(parsed);
    parseWarnings = parsed.warnings;
  }

  const warnings = [...parseWarnings];
  if (year) filterDomForYear(dom, year, warnings);

  const { xml, warnings: ww } = writeRbxlx(dom.roots, dom.instances, { year });
  warnings.push(...ww);

  return {
    xml,
    warnings,
    isModel,
    stats: {
      instanceCount: dom.instances.size,
      rootCount:     dom.roots.length,
      year:          year || null,
      inputBytes:    buffer.length,
      outputBytes:   Buffer.byteLength(xml, 'utf8'),
      inputFormat:   isXmlFormat(buffer) ? 'xml' : 'binary',
    },
  };
}

module.exports = { convert };
