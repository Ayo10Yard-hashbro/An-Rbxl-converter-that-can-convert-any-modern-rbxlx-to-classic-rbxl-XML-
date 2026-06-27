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

## Fixed bugs

- **LZ4 decompression failed on real (compressed) place files above roughly
  1MB.** The custom LZ4 block decompressor rejected any match sequence with
  an `offset === 0`, treating it as corrupt. That sequence shape is legal and
  common for highly-repetitive data (identical booleans, identity CFrames,
  zero transparency, etc.) — exactly the kind of data real place files are
  full of — so larger files reliably tripped it. Fixed by letting the copy
  proceed against the zero-initialized output buffer, matching how reference
  LZ4 decoders handle it. Verified against thousands of LZ4-compressed test
  chunks up to several MB.
- **`Instance.Capabilities` (type `0x21`, `SecurityCapabilities`) and
  `Content`-typed properties (type `0x22`: `TextureContent`, `ImageContent`,
  `MeshContent`, `AudioContent`, PBR material maps, etc.) were unsupported**
  and silently dropped, which is why they showed up as "Could not decode
  property" warnings. Both are now fully decoded and written to the XML
  output.

