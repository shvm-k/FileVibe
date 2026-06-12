# FileVibe

**Free, 100% client-side JPG/PNG/WEBP → PDF converter.** No uploads, no servers, no limits.

🔗 **Live App:** [https://file-vibe.vercel.app/](https://file-vibe.vercel.app/)

---

## ✨ Features

- **100% Secure & Serverless** — all image processing and PDF compilation happens locally in your browser using the HTML5 Canvas and File APIs. Your files never leave your device.
- **Bulk image → PDF** — convert unlimited JPG, PNG, and WEBP images into a single PDF document.
- **Drag-and-drop reordering** — visually reorder queued images to control the final page order.
- **Rotate images** — rotate any queued image in 90° increments before compiling.
- **Configurable output** — choose page size (A4 / US Letter / Fit to Image), orientation, and margins.
- **No ads, no watermarks, no sign-up** — completely free and open-source, with zero hosting costs.
- **Toast notifications & polished UX** — clear feedback for adding, removing, and compiling files, plus loading states during PDF generation.

## 🛠️ Tech Stack

- Vanilla HTML, JavaScript, and [Tailwind CSS](https://tailwindcss.com/) (via CDN)
- [jsPDF](https://github.com/parallax/jsPDF) for client-side PDF generation
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
