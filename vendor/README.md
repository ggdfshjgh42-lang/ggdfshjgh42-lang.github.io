# Reader dependencies

These files are hosted with the site; reading does not depend on a third-party CDN.

- **JSZip 3.10.1**: `jszip.min.js`. Copyright Stuart Knightley and contributors. MIT or GPLv3; used under the MIT license included in `JSZIP-LICENSE.markdown`. Upstream: https://github.com/Stuk/jszip
- **PDF.js / pdfjs-dist 5.6.205**: `pdfjs/pdf.mjs`, `pdfjs/pdf.worker.mjs` are the package's `legacy/build/pdf.min.mjs` and `legacy/build/pdf.worker.min.mjs`, renamed to these stable paths. Both legacy builds include compatibility code for browsers without newer JavaScript APIs such as `Promise.try` and `Promise.withResolvers`; keep the main module and worker on the same version. Character maps, standard fonts and WebAssembly helpers are kept in their original relative directories. Apache 2.0; see `pdfjs/LICENSE` and the licenses inside the resource directories. Upstream: https://github.com/mozilla/pdf.js

Copied from the installed, versioned runtime dependencies. No scripts from an EPUB book are executed by the reader.
