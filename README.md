# FileVibe

**Free, 100% client-side PDF toolkit: image → PDF, merge, compress, protect, unlock, repair, and sign.** No uploads, no servers, no limits.

🔗 **Live App:** [FV](https://file-vibe.vercel.app/)

---

## ✨ Features

- **100% Secure & Serverless** — all image processing and PDF compilation happens locally in your browser using the HTML5 Canvas and File APIs. Your files never leave your device.
- **Bulk image → PDF** — convert unlimited JPG, PNG, and WEBP images into a single PDF document.
- **Merge PDFs** — drop multiple PDFs (mixed with images if you like) into the queue and combine them into one PDF; merged pages keep their original size.
- **Compress PDFs** — lossless structure optimization, plus optional re-encoding of oversized photos (Balanced / Strong).
- **Protect & unlock** — add a password with 256-bit AES encryption and optional print/copy/edit restrictions, or remove a password you know.
- **Repair PDFs** — rebuild broken cross-reference tables, trailers, and truncated files.
- **Sign PDFs** — draw, type, or upload a signature and drag it onto any page (visual electronic signature).
- **Office ↔ PDF** — Word (.docx) and Excel (.xlsx, .csv) to PDF; PDF to Word, Excel, or PowerPoint. Basic, browser-only conversion: complex layouts are simplified.
- **Drag-and-drop reordering** — visually reorder queued files to control the final page order.
- **Rotate pages** — rotate any queued image or PDF in 90° increments before compiling.
- **Configurable output** — choose page size (A4 / US Letter / Fit to Image), orientation, and margins.
- **No ads, no watermarks, no sign-up** — completely free and open-source, with zero hosting costs.
- **Toast notifications & polished UX** — clear feedback for adding, removing, and compiling files, plus loading states during PDF generation.

## 🛠️ Tech Stack

- Vanilla HTML, JavaScript, and [Tailwind CSS](https://tailwindcss.com/) (via CDN)
- [pdf-lib](https://github.com/Hopding/pdf-lib) for client-side PDF generation, merging, repair, and signing
- [qpdf](https://github.com/qpdf/qpdf) compiled to WebAssembly (vendored in `vendor/qpdf`) for encryption and compression
- [PDF.js](https://mozilla.github.io/pdf.js/) for page previews and text extraction
- [mammoth](https://github.com/mwilliamson/mammoth.js), [pdfmake](https://pdfmake.github.io/), [ExcelJS](https://github.com/exceljs/exceljs), [docx](https://docx.js.org/), and [PptxGenJS](https://gitbrent.github.io/PptxGenJS/) for Office conversion (loaded on demand)
- Deployed on [Vercel](https://vercel.com/)

## 🚀 Running Locally

This is a static site (`index.html`, `tools.js`, and `vendor/`) — no build step required. Serve it over HTTP so the qpdf WebAssembly file can load.

```bash
git clone https://github.com/<your-username>/filevibe.git
cd filevibe
npx serve .   # or any static server
```

## 📦 Deployment

Deployed via the [Vercel CLI](https://vercel.com/docs/cli):

```bash
npx vercel --prod
```

## 🤝 Support

If FileVibe saves you time, consider sending a small UPI tip via the "Support Open Software" card in the app — it helps keep the project free and ad-free.

## 📄 License

Open-source and free to use.
