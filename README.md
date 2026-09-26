# FileVibe

**Free, 100% client-side JPG/PNG/WEBP → PDF converter and PDF merger.** No uploads, no servers, no limits.

🔗 **Live App:** [FV](https://file-vibe.vercel.app/)

---

## ✨ Features

- **100% Secure & Serverless** — all image processing and PDF compilation happens locally in your browser using the HTML5 Canvas and File APIs. Your files never leave your device.
- **Bulk image → PDF** — convert unlimited JPG, PNG, and WEBP images into a single PDF document.
- **Merge PDFs** — drop multiple PDFs (mixed with images if you like) into the queue and combine them into one PDF; merged pages keep their original size.
- **Drag-and-drop reordering** — visually reorder queued files to control the final page order.
- **Rotate pages** — rotate any queued image or PDF in 90° increments before compiling.
- **Configurable output** — choose page size (A4 / US Letter / Fit to Image), orientation, and margins.
- **No ads, no watermarks, no sign-up** — completely free and open-source, with zero hosting costs.
- **Toast notifications & polished UX** — clear feedback for adding, removing, and compiling files, plus loading states during PDF generation.

## 🛠️ Tech Stack

- Vanilla HTML, JavaScript, and [Tailwind CSS](https://tailwindcss.com/) (via CDN)
- [pdf-lib](https://github.com/Hopding/pdf-lib) for client-side PDF generation and merging
- Deployed on [Vercel](https://vercel.com/)

## 🚀 Running Locally

This is a single static `index.html` file — no build step required.

```bash
git clone https://github.com/<your-username>/filevibe.git
cd filevibe
open index.html   # or serve with any static server
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
