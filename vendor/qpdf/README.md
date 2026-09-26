# qpdf (WebAssembly)

`qpdf.js` and `qpdf.wasm` are copied unmodified from
[`@neslinesli93/qpdf-wasm`](https://github.com/neslinesli93/qpdf-wasm) v0.3.0
(ISC license), a WebAssembly build of [qpdf](https://github.com/qpdf/qpdf)
(Apache License 2.0).

FileVibe uses it in the browser to encrypt, decrypt, and optimize PDFs. The
files are served from this repo rather than a CDN so the tools keep working
offline and no third party sees when they are used.

To update, install the package and copy `dist/qpdf.js` and `dist/qpdf.wasm`
over these files.
