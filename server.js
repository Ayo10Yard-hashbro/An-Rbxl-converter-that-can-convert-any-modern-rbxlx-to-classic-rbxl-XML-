'use strict';

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const { convert }          = require('./lib/convert');
const { parseMesh }        = require('./lib/meshParser');
const { meshToObj, meshSummary } = require('./lib/meshExport');

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

app.use(express.static(path.join(__dirname, 'public')));

// ── /convert  (rbxl / rbxm / rbxlx / rbxmx → rbxlx / rbxmx) ────────────────
app.post('/convert', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const year = req.body.year ? parseInt(req.body.year, 10) : null;
  const orig = req.file.originalname;
  const base = orig.replace(/\.[^.]+$/, '');
  const isModel = /\.rbxm(x)?$/i.test(orig);
  const outName = base + (isModel ? '.rbxmx' : '.rbxlx');

  try {
    const result = convert(req.file.buffer, { year, filename: orig });

    const warnJson = JSON.stringify(result.warnings.slice(0, 20));
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
    res.setHeader('X-Instance-Count', String(result.stats.instanceCount));
    res.setHeader('X-Input-Bytes',    String(result.stats.inputBytes));
    res.setHeader('X-Output-Bytes',   String(result.stats.outputBytes));
    res.setHeader('X-Year',           String(result.stats.year || ''));
    res.setHeader('X-Warning-Count',  String(result.warnings.length));
    if (warnJson.length < 7000) res.setHeader('X-Warnings', warnJson);
    res.setHeader('Access-Control-Expose-Headers',
      'X-Instance-Count,X-Input-Bytes,X-Output-Bytes,X-Year,X-Warning-Count,X-Warnings');
    res.end(result.xml, 'utf8');
  } catch (err) {
    console.error('[/convert]', err.message);
    res.status(400).json({ error: err.message || 'Conversion failed.' });
  }
});

// ── /convert-mesh  (.mesh → .obj + .mtl, JSON summary) ──────────────────────
app.post('/convert-mesh', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const orig     = req.file.originalname;
  const baseName = orig.replace(/\.[^.]+$/, '');

  try {
    const mesh    = parseMesh(req.file.buffer);
    const summary = meshSummary(mesh);
    const { obj, mtl } = meshToObj(mesh, baseName);

    res.json({
      objName: baseName + '.obj',
      mtlName: baseName + '.mtl',
      obj,
      mtl,
      summary,
      inputBytes: req.file.buffer.length,
    });
  } catch (err) {
    console.error('[/convert-mesh]', err.message);
    res.status(400).json({ error: err.message || 'Mesh conversion failed.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`RBXL/M/MESH converter running at http://localhost:${PORT}`)
);
