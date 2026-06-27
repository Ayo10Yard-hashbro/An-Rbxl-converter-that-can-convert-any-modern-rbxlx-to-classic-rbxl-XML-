# RBXL → RBXLX Converter

A local Node.js + Express web app that converts Roblox binary place files
(`.rbxl`) into Roblox XML place files (`.rbxlx`), with an optional "target
year" that rewrites the file to be compatible with older versions of Roblox
Studio.

## Run it

```bash
npm install
npm start
```

Then open **http://localhost:3000** and upload a `.rbxl` file.

## How it works

- `lib/parser.js` + `lib/types.js` implement Roblox's binary chunk format
  (`META`/`SSTR`/`INST`/`PROP`/`PRNT`/`END`), including LZ4 (and ZSTD, via
  `fzstd`) chunk decompression, byte-interleaved integer/float arrays, and
  Roblox's non-standard float32 bit layout.
- `lib/dom.js` turns the raw chunk data into an instance tree.
- `lib/yearCompat.js` (only runs if you pick a year) walks that tree and, for
  any class/property introduced after the target year, swaps in whatever
  served a similar purpose back then — e.g. `Folder` → `Model`,
  `HingeConstraint` → `Weld`, `VectorForce` → `BodyForce`, `ProximityPrompt`
  → `ClickDetector` — recursively, falling back to a generic `Model` (or
  dropping the instance while keeping its children) only when nothing
  period-appropriate exists.
- `lib/xmlWriter.js` writes the result out as Roblox XML format v4.

## Limitations

- The year-compatibility table is hand-curated from public release history,
  not an official Roblox database — it covers the most common classes and
  properties but isn't exhaustive. Warnings are shown for everything it
  changed or removed so you can review them.
- A handful of obscure property types (raw script `Bytecode`) are
  intentionally dropped, since Studio itself disregards them and they're
  unsafe to copy verbatim from a third-party tool.
- Very large places (tens of thousands of instances) will work but may take
  a few seconds to convert.

## Hey, human here!

- So uh up top is ai by Claude
- Its for converting converting (of course)
- So uhm how can i use?
- Just go read.

## License
- Everything in the repo is in Gnu GpL v3
