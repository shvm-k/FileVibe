/**
 * FileVibe PDF tools: compress, protect, unlock, repair, and sign.
 *
 * Everything runs locally in the browser:
 *  - pdf-lib (loaded by index.html) parses, rewrites, and stamps PDFs.
 *  - qpdf compiled to WebAssembly (vendor/qpdf) handles encryption and stream optimization.
 *  - pdf.js renders page previews for placing signatures.
 *
 * Relies on helpers defined in index.html: showToast, formatSize, escapeHtml,
 * waitForPdfLib, downloadBlob, SPINNER_SVG.
 */
(() => {
  const PDFJS_VERSION = '3.11.174';
  const PDFJS_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

  // ---------------------------------------------------------------------------
  // Script loaders
  // ---------------------------------------------------------------------------

  const scriptCache = {};
  function loadScript(src) {
    if (!scriptCache[src]) {
      scriptCache[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => {
          delete scriptCache[src];
          reject(new Error('A PDF component failed to load. Please check your connection and try again.'));
        };
        document.head.appendChild(s);
      });
    }
    return scriptCache[src];
  }

  let qpdfFactory = null;
  async function loadQpdf() {
    if (!qpdfFactory) {
      await loadScript('vendor/qpdf/qpdf.js');
      qpdfFactory = window.Module; // the Emscripten build exposes its factory as a global
    }
    return qpdfFactory;
  }

  /**
   * Runs qpdf with `args` against `inputBytes` (available as /in.pdf) and returns /out.pdf.
   * A fresh instance per call keeps the in-memory filesystem clean between runs.
   */
  async function runQpdf(inputBytes, args) {
    const factory = await loadQpdf();
    const errors = [];
    // This build binds console.error when the instance is created and ignores a printErr
    // option, so capture qpdf's error output by swapping console.error for the run.
    const consoleError = console.error;
    console.error = (...parts) => errors.push(parts.join(' '));
    let qpdf, code;
    try {
      qpdf = await factory({ locateFile: () => 'vendor/qpdf/qpdf.wasm' });
      qpdf.FS.writeFile('/in.pdf', inputBytes);
      code = qpdf.callMain(args);
    } catch (err) {
      code = typeof err?.status === 'number' ? err.status : 2;
    } finally {
      console.error = consoleError;
    }
    // 0 = success, 3 = success with warnings.
    if (code !== 0 && code !== 3) {
      const detail = errors.join(' ');
      const e = new Error(detail || 'The PDF could not be processed.');
      e.invalidPassword = /invalid password/i.test(detail);
      throw e;
    }
    return qpdf.FS.readFile('/out.pdf');
  }

  async function loadPdfJs() {
    await loadScript(`${PDFJS_BASE}/pdf.min.js`);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.js`;
    return window.pdfjsLib;
  }

  /** Loads a PDF with pdf-lib, turning encryption errors into a friendly message. */
  async function loadPdfDoc(bytes, options = {}) {
    const { PDFDocument } = await waitForPdfLib();
    try {
      return await PDFDocument.load(bytes, options);
    } catch (err) {
      if (/encrypt/i.test(err?.message)) {
        throw new Error('This PDF is password-protected. Remove the password with the Unlock tool first.');
      }
      throw err;
    }
  }

  const baseName = (name) => name.replace(/\.pdf$/i, '');
  const isPdf = (f) => f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name));

  // ---------------------------------------------------------------------------
  // Tool implementations
  // ---------------------------------------------------------------------------

  const COMPRESSION_LEVELS = {
    lossless: null,
    balanced: { maxDim: 2400, quality: 0.82 },
    strong: { maxDim: 1600, quality: 0.65 },
  };

  /**
   * Re-encodes large JPEG photos inside the PDF. Only plain 8-bit RGB JPEGs are touched;
   * anything else (CMYK, grayscale, masks, multi-filter streams) is left exactly as-is.
   * A stream is only replaced when the new version is meaningfully smaller.
   */
  async function recompressImages(doc, { maxDim, quality }) {
    const { PDFName, PDFRawStream, PDFArray, PDFNumber } = PDFLib;
    const N = (n) => PDFName.of(n);
    let replaced = 0;

    const isRgb = (cs) => {
      if (cs === N('DeviceRGB')) return true;
      if (cs instanceof PDFArray && cs.get(0) === N('ICCBased')) {
        const profile = doc.context.lookup(cs.get(1));
        const n = profile?.dict?.get(N('N'));
        return n instanceof PDFNumber && n.asNumber() === 3;
      }
      return false;
    };

    for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const dict = obj.dict;
      if (dict.get(N('Subtype')) !== N('Image')) continue;
      const filter = dict.get(N('Filter'));
      const isDct = filter === N('DCTDecode') ||
        (filter instanceof PDFArray && filter.size() === 1 && filter.get(0) === N('DCTDecode'));
      if (!isDct || dict.has(N('Decode')) || dict.has(N('DecodeParms'))) continue;
      if (!isRgb(doc.context.lookup(dict.get(N('ColorSpace'))))) continue;
      const bpc = dict.get(N('BitsPerComponent'));
      if (!(bpc instanceof PDFNumber) || bpc.asNumber() !== 8) continue;

      const original = obj.contents;
      if (original.length < 20 * 1024) continue; // not worth it for small images

      let bitmap;
      try {
        // Keep raw pixel values: the PDF's own color space still applies to the new stream.
        bitmap = await createImageBitmap(new Blob([original], { type: 'image/jpeg' }), { colorSpaceConversion: 'none' });
      } catch {
        continue;
      }
      const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
      bitmap.close();

      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
      if (!blob) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.length > original.length * 0.9) continue;

      dict.set(N('Width'), PDFNumber.of(w));
      dict.set(N('Height'), PDFNumber.of(h));
      doc.context.assign(ref, PDFRawStream.of(dict, bytes));
      replaced++;
    }
    return replaced;
  }

  async function compressPdf(file, opts) {
    const input = new Uint8Array(await file.arrayBuffer());
    let bytes = input;

    const level = COMPRESSION_LEVELS[opts.level];
    if (level) {
      const doc = await loadPdfDoc(input, { updateMetadata: false });
      const replaced = await recompressImages(doc, level);
      if (replaced > 0) bytes = await doc.save({ useObjectStreams: true });
    }

    // Lossless pass: pack objects into compressed object streams and re-deflate everything.
    try {
      bytes = await runQpdf(bytes, [
        '--object-streams=generate', '--compress-streams=y', '--recompress-flate',
        '--compression-level=9', '--', '/in.pdf', '/out.pdf',
      ]);
    } catch (err) {
      if (err.invalidPassword) throw new Error('This PDF is password-protected. Remove the password with the Unlock tool first.');
      throw err;
    }

    if (bytes.length >= input.length) {
      return { noChange: true, message: 'This PDF is already well optimized; no smaller version could be made.' };
    }
    const saved = Math.round((1 - bytes.length / input.length) * 100);
    return {
      bytes,
      filename: `${baseName(file.name)}-compressed.pdf`,
      message: `${formatSize(input.length)} → ${formatSize(bytes.length)} (${saved}% smaller)`,
    };
  }

  function randomPassword() {
    const a = new Uint8Array(18);
    crypto.getRandomValues(a);
    return btoa(String.fromCharCode(...a));
  }

  async function protectPdf(file, opts) {
    if (!opts.password) throw new Error('Enter a password to open the PDF.');
    if (opts.password !== opts.confirm) throw new Error('Passwords do not match.');
    const input = new Uint8Array(await file.arrayBuffer());
    // Without an owner password anyone could lift the restrictions, so generate a strong one.
    const owner = opts.ownerPassword || randomPassword();
    const args = ['--encrypt', `--user-password=${opts.password}`, `--owner-password=${owner}`, '--bits=256'];
    if (!opts.allowPrint) args.push('--print=none');
    if (!opts.allowCopy) args.push('--extract=n');
    if (!opts.allowEdit) args.push('--modify=none', '--annotate=n', '--form=n', '--assemble=n');
    args.push('--', '/in.pdf', '/out.pdf');
    let bytes;
    try {
      bytes = await runQpdf(input, args);
    } catch (err) {
      if (err.invalidPassword) throw new Error('This PDF is already password-protected. Unlock it first.');
      throw err;
    }
    return {
      bytes,
      filename: `${baseName(file.name)}-protected.pdf`,
      message: 'Protected with 256-bit AES encryption.',
    };
  }

  async function unlockPdf(file, opts) {
    const input = new Uint8Array(await file.arrayBuffer());
    const args = ['--decrypt'];
    if (opts.password) args.push(`--password=${opts.password}`);
    args.push('--', '/in.pdf', '/out.pdf');
    let bytes;
    try {
      bytes = await runQpdf(input, args);
    } catch (err) {
      if (err.invalidPassword) {
        throw new Error(opts.password ? 'Incorrect password. Please try again.' : 'This PDF needs a password to open. Enter it above.');
      }
      throw err;
    }
    return {
      bytes,
      filename: `${baseName(file.name)}-unlocked.pdf`,
      message: 'Password and restrictions removed.',
    };
  }

  async function repairPdf(file) {
    const { PDFDocument } = await waitForPdfLib();
    const input = new Uint8Array(await file.arrayBuffer());
    const tolerant = { throwOnInvalidObject: false, updateMetadata: false };

    // pdf-lib parses the file object by object rather than trusting the cross-reference
    // table, so broken xrefs, bad offsets, and missing trailers are recovered naturally.
    let doc;
    try {
      doc = await loadPdfDoc(input, tolerant);
    } catch (err) {
      if (/password/i.test(err.message)) throw err;
      // Truncated file: retry with everything after the last complete object dropped.
      const text = new TextDecoder('latin1').decode(input);
      const cut = text.lastIndexOf('endobj');
      if (cut === -1) throw new Error('This file does not look like a PDF, so it cannot be repaired.');
      try {
        doc = await loadPdfDoc(input.slice(0, cut + 6), tolerant);
      } catch {
        throw new Error('This PDF is too badly damaged to recover.');
      }
    }

    let pageCount = 0;
    try { pageCount = doc.getPageCount(); } catch { /* broken page tree */ }
    if (pageCount === 0) throw new Error('No readable pages could be recovered from this PDF.');

    let bytes;
    try {
      bytes = await doc.save();
    } catch {
      // Fall back to copying just the pages into a brand-new document.
      const fresh = await PDFDocument.create();
      const pages = await fresh.copyPages(doc, doc.getPageIndices());
      pages.forEach(p => fresh.addPage(p));
      bytes = await fresh.save();
    }
    return {
      bytes,
      filename: `${baseName(file.name)}-repaired.pdf`,
      message: `Recovered ${pageCount} page${pageCount === 1 ? '' : 's'} and rebuilt the file structure.`,
    };
  }

  // ---------------------------------------------------------------------------
  // Shared single-file tool UI
  // ---------------------------------------------------------------------------

  const inputCls = 'w-full text-sm font-medium bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-shadow';
  const checkCls = 'flex items-center gap-2 text-xs font-medium text-zinc-600 cursor-pointer';
  const primaryBtnCls = 'btn-scale w-full bg-accent hover:bg-volt text-white hover:text-accent text-sm font-semibold py-3.5 rounded-xl flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 shadow-sm shadow-accent/10';

  const TOOLS = {
    compress: {
      title: 'Compress PDF',
      blurb: 'Shrink a PDF by repacking its structure and re-encoding oversized photos. Text and vector graphics stay razor sharp.',
      action: 'Compress PDF',
      run: compressPdf,
      options: `
        <fieldset class="space-y-2">
          <legend class="text-xs font-semibold text-zinc-600 mb-1.5">Compression level</legend>
          <label class="${checkCls}"><input type="radio" name="level" value="lossless" class="accent-accent"> <span><b class="text-zinc-800">Lossless</b> — no change to any pixel; smaller savings</span></label>
          <label class="${checkCls}"><input type="radio" name="level" value="balanced" class="accent-accent" checked> <span><b class="text-zinc-800">Balanced</b> — photos re-encoded at high quality; looks identical</span></label>
          <label class="${checkCls}"><input type="radio" name="level" value="strong" class="accent-accent"> <span><b class="text-zinc-800">Strong</b> — smallest file; photos slightly softer</span></label>
        </fieldset>`,
      readOptions: (root) => ({ level: root.querySelector('input[name=level]:checked').value }),
    },
    protect: {
      title: 'Protect PDF',
      blurb: 'Add a password so only people you share it with can open the PDF. Uses 256-bit AES encryption.',
      action: 'Protect PDF',
      run: protectPdf,
      options: `
        <div class="space-y-1.5">
          <label for="protectPw" class="text-xs font-semibold text-zinc-600">Password to open</label>
          <input id="protectPw" type="password" autocomplete="new-password" class="${inputCls}">
        </div>
        <div class="space-y-1.5">
          <label for="protectPw2" class="text-xs font-semibold text-zinc-600">Confirm password</label>
          <input id="protectPw2" type="password" autocomplete="new-password" class="${inputCls}">
        </div>
        <details class="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5">
          <summary class="text-xs font-semibold text-zinc-600 cursor-pointer">Permissions (optional)</summary>
          <div class="space-y-2 mt-3">
            <label class="${checkCls}"><input id="protectPrint" type="checkbox" checked class="accent-accent"> Allow printing</label>
            <label class="${checkCls}"><input id="protectCopy" type="checkbox" checked class="accent-accent"> Allow copying text and images</label>
            <label class="${checkCls}"><input id="protectEdit" type="checkbox" checked class="accent-accent"> Allow editing and comments</label>
            <div class="space-y-1.5 pt-1">
              <label for="protectOwner" class="text-xs font-semibold text-zinc-600">Permissions password</label>
              <input id="protectOwner" type="password" autocomplete="new-password" placeholder="Leave blank to generate a random one" class="${inputCls}">
              <p class="text-[11px] text-zinc-400 leading-snug">Needed to change the permissions later. Must differ from the open password.</p>
            </div>
          </div>
        </details>`,
      readOptions: (root) => ({
        password: root.querySelector('#protectPw').value,
        confirm: root.querySelector('#protectPw2').value,
        ownerPassword: root.querySelector('#protectOwner').value,
        allowPrint: root.querySelector('#protectPrint').checked,
        allowCopy: root.querySelector('#protectCopy').checked,
        allowEdit: root.querySelector('#protectEdit').checked,
      }),
    },
    unlock: {
      title: 'Unlock PDF',
      blurb: 'Remove the password and printing, copying, or editing restrictions from a PDF you have the password for.',
      action: 'Unlock PDF',
      run: unlockPdf,
      options: `
        <div class="space-y-1.5">
          <label for="unlockPw" class="text-xs font-semibold text-zinc-600">Password</label>
          <input id="unlockPw" type="password" autocomplete="current-password" class="${inputCls}">
          <p class="text-[11px] text-zinc-400 leading-snug">Leave blank if the PDF opens without a password but blocks printing or copying.</p>
        </div>`,
      readOptions: (root) => ({ password: root.querySelector('#unlockPw').value }),
    },
    repair: {
      title: 'Repair PDF',
      blurb: 'Recover PDFs that won’t open or show errors by rebuilding a broken cross-reference table, trailer, or file structure.',
      action: 'Repair PDF',
      run: repairPdf,
      options: '',
      readOptions: () => ({}),
    },
  };

  function renderSingleFileTool(key, container) {
    const tool = TOOLS[key];
    container.innerHTML = `
      <div class="max-w-2xl mx-auto w-full rounded-2xl border border-zinc-200 bg-white p-6 flex flex-col gap-5">
        <div>
          <h2 class="text-lg font-bold tracking-tight text-zinc-900">${tool.title}</h2>
          <p class="text-sm text-zinc-500 mt-1 leading-relaxed">${tool.blurb}</p>
        </div>

        <label data-role="drop" class="group cursor-pointer flex flex-col items-center justify-center text-center gap-2 rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50/60 hover:border-accent/30 transition-all px-6 py-10">
          <svg class="w-6 h-6 text-accent" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M12 12v9m0-9l-3 3m3-3l3 3"/></svg>
          <p class="text-sm font-semibold text-zinc-700">Drop a PDF here, or <span class="text-accent underline decoration-volt decoration-2">browse</span></p>
          <p data-role="fileInfo" class="text-xs text-zinc-400">Processed locally · never uploaded</p>
          <input data-role="input" type="file" accept="application/pdf,.pdf" class="hidden">
        </label>

        ${tool.options ? `<div class="space-y-4">${tool.options}</div>` : ''}

        <button data-role="run" class="${primaryBtnCls}" disabled>${tool.action}</button>
        <div data-role="result" class="hidden rounded-xl border px-4 py-3 text-sm"></div>
      </div>`;

    const drop = container.querySelector('[data-role=drop]');
    const input = container.querySelector('[data-role=input]');
    const fileInfo = container.querySelector('[data-role=fileInfo]');
    const runBtn = container.querySelector('[data-role=run]');
    const result = container.querySelector('[data-role=result]');
    let file = null;

    const setFile = (f) => {
      if (!f) return;
      if (!isPdf(f)) { showToast('Please choose a PDF file', 'error'); return; }
      file = f;
      fileInfo.innerHTML = `<span class="font-semibold text-zinc-700">${escapeHtml(f.name)}</span> · ${formatSize(f.size)}`;
      runBtn.disabled = false;
      result.classList.add('hidden');
    };
    input.addEventListener('change', () => { setFile(input.files[0]); input.value = ''; });
    wireDropzone(drop, (files) => setFile(files[0]));

    const showResult = (text, ok) => {
      result.className = `rounded-xl border px-4 py-3 text-sm ${ok ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-rose-50 border-rose-100 text-rose-600'}`;
      result.textContent = text;
    };

    runBtn.addEventListener('click', async () => {
      if (!file) return;
      const label = runBtn.innerHTML;
      runBtn.disabled = true;
      runBtn.innerHTML = `${SPINNER_SVG}<span>Working…</span>`;
      try {
        const out = await tool.run(file, tool.readOptions(container));
        if (out.noChange) {
          showResult(out.message, true);
        } else {
          downloadBlob(new Blob([out.bytes], { type: 'application/pdf' }), out.filename);
          showResult(`Done — ${out.message} Your download has started.`, true);
          showToast(`${tool.title}: done`, 'success');
        }
      } catch (err) {
        console.error(err);
        showResult(err.message || 'Something went wrong. Please try again.', false);
      } finally {
        runBtn.disabled = false;
        runBtn.innerHTML = label;
      }
    });
  }

  function wireDropzone(el, onFiles) {
    ['dragenter', 'dragover'].forEach(evt =>
      el.addEventListener(evt, (e) => { e.preventDefault(); el.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(evt =>
      el.addEventListener(evt, (e) => { e.preventDefault(); el.classList.remove('dragover'); }));
    el.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files); });
  }

  // ---------------------------------------------------------------------------
  // Sign tool
  // ---------------------------------------------------------------------------

  const SIGNATURE_FONTS = ['Dancing Script', 'Great Vibes', 'Caveat'];
  let signFontsRequested = false;
  function requestSignatureFonts() {
    if (signFontsRequested) return;
    signFontsRequested = true;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Caveat:wght@600&family=Dancing+Script:wght@600&family=Great+Vibes&display=swap';
    document.head.appendChild(link);
  }

  /** Crops transparent margins off a canvas and returns a PNG data URL (or null if empty). */
  function trimCanvas(src) {
    const ctx = src.getContext('2d');
    const { width, height } = src;
    const data = ctx.getImageData(0, 0, width, height).data;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    const pad = 4;
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
    const out = document.createElement('canvas');
    out.width = maxX - minX + 1;
    out.height = maxY - minY + 1;
    out.getContext('2d').drawImage(src, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  function renderSignTool(container) {
    requestSignatureFonts();
    const tabBtn = 'text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors';
    container.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <aside class="lg:col-span-4 rounded-2xl border border-zinc-200 bg-white p-6 flex flex-col gap-4">
          <div>
            <h2 class="text-lg font-bold tracking-tight text-zinc-900">Sign PDF</h2>
            <p class="text-sm text-zinc-500 mt-1 leading-relaxed">Create your signature, then drag it into place on the page.</p>
          </div>

          <div class="flex gap-1 bg-zinc-100 rounded-xl p-1" role="tablist">
            <button data-mode="draw" class="${tabBtn}">Draw</button>
            <button data-mode="type" class="${tabBtn}">Type</button>
            <button data-mode="upload" class="${tabBtn}">Upload</button>
          </div>

          <div data-panel="draw" class="space-y-2">
            <canvas data-role="pad" class="w-full h-40 rounded-xl border border-zinc-200 bg-zinc-50 touch-none cursor-crosshair"></canvas>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2" data-role="colors">
                <button data-color="#18181b" aria-label="Black ink" class="w-5 h-5 rounded-full bg-zinc-900 ring-2 ring-offset-1 ring-zinc-400"></button>
                <button data-color="#1d4ed8" aria-label="Blue ink" class="w-5 h-5 rounded-full bg-blue-700 ring-offset-1"></button>
              </div>
              <button data-role="clearPad" class="text-xs font-semibold text-zinc-500 hover:text-zinc-800">Clear</button>
            </div>
          </div>

          <div data-panel="type" class="space-y-2 hidden">
            <input data-role="typed" type="text" placeholder="Your full name" class="${inputCls}">
            <div class="grid grid-cols-1 gap-2" data-role="fontChoices">
              ${SIGNATURE_FONTS.map((f, i) => `
                <label class="flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 cursor-pointer has-[:checked]:border-accent/60 has-[:checked]:bg-zinc-50">
                  <input type="radio" name="sigFont" value="${f}" ${i === 0 ? 'checked' : ''} class="accent-accent">
                  <span data-role="fontPreview" style="font-family: '${f}', cursive" class="text-2xl text-zinc-800 truncate">Your name</span>
                </label>`).join('')}
            </div>
          </div>

          <div data-panel="upload" class="space-y-2 hidden">
            <label class="flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-zinc-200 bg-zinc-50/60 px-4 py-8 cursor-pointer hover:border-accent/30 text-center">
              <span class="text-sm font-semibold text-zinc-700">Choose a signature image</span>
              <span class="text-xs text-zinc-400">PNG with a transparent background works best</span>
              <input data-role="sigUpload" type="file" accept="image/png,image/jpeg,image/webp" class="hidden">
            </label>
          </div>

          <button data-role="useSig" class="${primaryBtnCls}">Use this signature</button>
          <p class="text-[11px] text-zinc-400 leading-snug">This adds a visual electronic signature to the page. It is not a certificate-based digital signature.</p>
        </aside>

        <section class="lg:col-span-8 rounded-2xl border border-zinc-200 bg-white p-6 flex flex-col gap-4 min-h-[480px]">
          <label data-role="drop" class="cursor-pointer flex flex-col items-center justify-center text-center gap-2 rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50/60 hover:border-accent/30 transition-all px-6 py-10">
            <p class="text-sm font-semibold text-zinc-700">Drop the PDF to sign, or <span class="text-accent underline decoration-volt decoration-2">browse</span></p>
            <p data-role="fileInfo" class="text-xs text-zinc-400">Processed locally · never uploaded</p>
            <input data-role="input" type="file" accept="application/pdf,.pdf" class="hidden">
          </label>

          <div data-role="viewer" class="hidden flex-col gap-3">
            <div class="flex items-center justify-between flex-wrap gap-2">
              <div class="flex items-center gap-2">
                <button data-role="prev" class="w-8 h-8 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-40" aria-label="Previous page">‹</button>
                <span data-role="pageLabel" class="text-xs font-semibold text-zinc-700"></span>
                <button data-role="next" class="w-8 h-8 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-40" aria-label="Next page">›</button>
              </div>
              <label class="flex items-center gap-2 text-xs font-semibold text-zinc-600">Size
                <input data-role="size" type="range" min="8" max="60" value="25" class="w-28 accent-accent" aria-label="Signature size">
              </label>
            </div>
            <div class="rounded-xl bg-zinc-100 p-3 overflow-auto flex justify-center">
              <div data-role="stage" class="relative shadow-sm bg-white select-none">
                <canvas data-role="page"></canvas>
                <div data-role="sigBox" class="hidden absolute cursor-move outline outline-2 outline-dashed outline-indigo-400 touch-none">
                  <img data-role="sigImg" alt="Your signature" class="w-full h-full pointer-events-none" draggable="false">
                </div>
              </div>
            </div>
            <p data-role="hint" class="text-[11px] text-zinc-400">Create a signature on the left, then drag it where it should go.</p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button data-role="place" class="btn-scale w-full bg-white hover:bg-zinc-50 border border-zinc-200 text-zinc-700 text-sm font-semibold py-3 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100" disabled>Add signature to this page</button>
              <button data-role="download" class="${primaryBtnCls} !py-3" disabled>Download signed PDF</button>
            </div>
          </div>
        </section>
      </div>`;

    const $ = (sel) => container.querySelector(sel);
    const state = { mode: 'draw', color: '#18181b', sigUrl: null, sigRatio: 1, file: null, doc: null, pdfjsDoc: null, pageIndex: 0, viewport: null, placedCount: 0 };

    // --- Signature creation -------------------------------------------------
    const setMode = (mode) => {
      state.mode = mode;
      container.querySelectorAll('[data-mode]').forEach(b => {
        const on = b.dataset.mode === mode;
        b.className = `${tabBtn} ${on ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'}`;
        b.setAttribute('aria-selected', on);
      });
      container.querySelectorAll('[data-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== mode));
      if (mode === 'draw') sizePad();
    };
    container.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

    const pad = $('[data-role=pad]');
    const padCtx = pad.getContext('2d');
    let padHasInk = false;
    function sizePad() {
      const r = pad.getBoundingClientRect();
      if (!r.width) return;
      const dpr = window.devicePixelRatio || 1;
      if (pad.width === Math.round(r.width * dpr)) return;
      pad.width = Math.round(r.width * dpr);
      pad.height = Math.round(r.height * dpr);
      padCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      padHasInk = false;
    }
    let drawing = false, last = null;
    const padPoint = (e) => { const r = pad.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    pad.addEventListener('pointerdown', (e) => {
      sizePad();
      drawing = true; last = padPoint(e); pad.setPointerCapture(e.pointerId);
      padCtx.fillStyle = state.color;
      padCtx.beginPath(); padCtx.arc(last.x, last.y, 1.2, 0, Math.PI * 2); padCtx.fill();
      padHasInk = true;
    });
    pad.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = padPoint(e);
      padCtx.strokeStyle = state.color; padCtx.lineWidth = 2.4; padCtx.lineCap = 'round'; padCtx.lineJoin = 'round';
      padCtx.beginPath(); padCtx.moveTo(last.x, last.y); padCtx.lineTo(p.x, p.y); padCtx.stroke();
      last = p;
    });
    ['pointerup', 'pointercancel'].forEach(evt => pad.addEventListener(evt, () => { drawing = false; }));
    $('[data-role=clearPad]').addEventListener('click', () => { padCtx.clearRect(0, 0, pad.width, pad.height); padHasInk = false; });
    container.querySelectorAll('[data-color]').forEach(b => b.addEventListener('click', () => {
      state.color = b.dataset.color;
      container.querySelectorAll('[data-color]').forEach(o => o.classList.toggle('ring-2', o === b));
      container.querySelectorAll('[data-color]').forEach(o => o.classList.toggle('ring-zinc-400', o === b));
    }));

    const typed = $('[data-role=typed]');
    typed.addEventListener('input', () => {
      container.querySelectorAll('[data-role=fontPreview]').forEach(el => { el.textContent = typed.value || 'Your name'; });
    });

    let uploadedSig = null;
    $('[data-role=sigUpload]').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        uploadedSig = c.toDataURL('image/png');
        URL.revokeObjectURL(img.src);
        showToast('Signature image loaded', 'success');
      };
      img.onerror = () => showToast('Could not read that image', 'error');
      img.src = URL.createObjectURL(f);
    });

    async function buildSignature() {
      if (state.mode === 'draw') {
        if (!padHasInk) throw new Error('Draw your signature first.');
        return trimCanvas(pad);
      }
      if (state.mode === 'type') {
        const text = typed.value.trim();
        if (!text) throw new Error('Type your name first.');
        const font = container.querySelector('input[name=sigFont]:checked').value;
        await document.fonts.load(`96px "${font}"`);
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d');
        ctx.font = `96px "${font}"`;
        c.width = Math.ceil(ctx.measureText(text).width) + 80;
        c.height = 200;
        ctx.font = `96px "${font}"`;
        ctx.fillStyle = state.color;
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 40, 100);
        return trimCanvas(c);
      }
      if (!uploadedSig) throw new Error('Choose a signature image first.');
      return uploadedSig;
    }

    const sigBox = $('[data-role=sigBox]');
    const sigImg = $('[data-role=sigImg]');
    const sizeInput = $('[data-role=size]');
    const stage = $('[data-role=stage]');

    $('[data-role=useSig]').addEventListener('click', async () => {
      try {
        const url = await buildSignature();
        if (!url) throw new Error('The signature is empty.');
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
        state.sigUrl = url;
        state.sigRatio = img.naturalHeight / img.naturalWidth;
        sigImg.src = url;
        if (state.doc) showSigBox(true);
        else showToast('Signature ready — now add a PDF', 'info');
        updateButtons();
      } catch (err) {
        showToast(err.message || 'Could not create the signature', 'error');
      }
    });

    // --- Placement ----------------------------------------------------------
    function layoutSigBox(center) {
      const stageW = stage.clientWidth, stageH = stage.clientHeight;
      const w = stageW * (sizeInput.value / 100);
      const h = w * state.sigRatio;
      sigBox.style.width = `${w}px`;
      sigBox.style.height = `${h}px`;
      let left = center ? (stageW - w) / 2 : sigBox.offsetLeft;
      let top = center ? stageH * 0.75 - h / 2 : sigBox.offsetTop;
      sigBox.style.left = `${Math.min(Math.max(0, left), Math.max(0, stageW - w))}px`;
      sigBox.style.top = `${Math.min(Math.max(0, top), Math.max(0, stageH - h))}px`;
    }
    function showSigBox(center) {
      if (!state.sigUrl || !state.viewport) return;
      sigBox.classList.remove('hidden');
      layoutSigBox(center);
    }
    sizeInput.addEventListener('input', () => { if (!sigBox.classList.contains('hidden')) layoutSigBox(false); });

    let drag = null;
    sigBox.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, left: sigBox.offsetLeft, top: sigBox.offsetTop };
      sigBox.setPointerCapture(e.pointerId);
    });
    sigBox.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const maxL = stage.clientWidth - sigBox.offsetWidth, maxT = stage.clientHeight - sigBox.offsetHeight;
      sigBox.style.left = `${Math.min(Math.max(0, drag.left + e.clientX - drag.x), maxL)}px`;
      sigBox.style.top = `${Math.min(Math.max(0, drag.top + e.clientY - drag.y), maxT)}px`;
    });
    ['pointerup', 'pointercancel'].forEach(evt => sigBox.addEventListener(evt, () => { drag = null; }));

    // --- PDF loading & rendering --------------------------------------------
    const viewer = $('[data-role=viewer]');
    const pageCanvas = $('[data-role=page]');
    const placeBtn = $('[data-role=place]');
    const downloadBtn = $('[data-role=download]');

    function updateButtons() {
      placeBtn.disabled = !(state.doc && state.sigUrl);
      downloadBtn.disabled = state.placedCount === 0;
      $('[data-role=prev]').disabled = state.pageIndex === 0;
      $('[data-role=next]').disabled = !state.doc || state.pageIndex >= state.doc.getPageCount() - 1;
    }

    async function refreshPdfJs() {
      const pdfjsLib = await loadPdfJs();
      const bytes = await state.doc.save();
      if (state.pdfjsDoc) state.pdfjsDoc.destroy();
      state.pdfjsDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
    }

    async function renderPage() {
      const page = await state.pdfjsDoc.getPage(state.pageIndex + 1);
      const available = Math.min(stage.parentElement.clientWidth - 24, 900);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: available / base.width });
      const dpr = window.devicePixelRatio || 1;
      pageCanvas.width = Math.floor(viewport.width * dpr);
      pageCanvas.height = Math.floor(viewport.height * dpr);
      pageCanvas.style.width = `${viewport.width}px`;
      pageCanvas.style.height = `${viewport.height}px`;
      await page.render({
        canvasContext: pageCanvas.getContext('2d'),
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
      }).promise;
      state.viewport = viewport;
      $('[data-role=pageLabel]').textContent = `Page ${state.pageIndex + 1} of ${state.doc.getPageCount()}`;
      updateButtons();
    }

    async function setFile(f) {
      if (!f) return;
      if (!isPdf(f)) { showToast('Please choose a PDF file', 'error'); return; }
      try {
        state.doc = await loadPdfDoc(new Uint8Array(await f.arrayBuffer()));
        state.file = f;
        state.pageIndex = 0;
        state.placedCount = 0;
        $('[data-role=fileInfo]').innerHTML = `<span class="font-semibold text-zinc-700">${escapeHtml(f.name)}</span> · ${formatSize(f.size)} · ${state.doc.getPageCount()} pages`;
        viewer.classList.remove('hidden');
        viewer.classList.add('flex');
        await refreshPdfJs();
        await renderPage();
        showSigBox(true);
      } catch (err) {
        console.error(err);
        showToast(err.message || 'Could not open this PDF', 'error');
      }
    }
    const input = $('[data-role=input]');
    input.addEventListener('change', () => { setFile(input.files[0]); input.value = ''; });
    wireDropzone($('[data-role=drop]'), (files) => setFile(files[0]));

    const goTo = async (delta) => {
      state.pageIndex = Math.min(Math.max(0, state.pageIndex + delta), state.doc.getPageCount() - 1);
      await renderPage();
      if (!sigBox.classList.contains('hidden')) layoutSigBox(false);
    };
    $('[data-role=prev]').addEventListener('click', () => goTo(-1));
    $('[data-role=next]').addEventListener('click', () => goTo(1));

    placeBtn.addEventListener('click', async () => {
      if (placeBtn.disabled) return;
      placeBtn.disabled = true;
      try {
        const { degrees } = PDFLib;
        const vp = state.viewport;
        const page = state.doc.getPage(state.pageIndex);
        const png = await state.doc.embedPng(state.sigUrl);
        const left = sigBox.offsetLeft, top = sigBox.offsetTop;
        const w = sigBox.offsetWidth, h = sigBox.offsetHeight;
        // The box's bottom-left corner on screen is the image origin. Converting through the
        // pdf.js viewport accounts for page rotation and crop-box offsets; rotating the image
        // by the page's /Rotate keeps it upright when the page is displayed.
        const [x, y] = vp.convertToPdfPoint(left, top + h);
        page.drawImage(png, {
          x, y,
          width: w / vp.scale,
          height: h / vp.scale,
          rotate: degrees(page.getRotation().angle),
        });
        state.placedCount++;
        await refreshPdfJs();
        await renderPage();
        showToast('Signature added — place another or download', 'success');
      } catch (err) {
        console.error(err);
        showToast('Could not add the signature to this page', 'error');
      } finally {
        updateButtons();
      }
    });

    downloadBtn.addEventListener('click', async () => {
      if (!state.placedCount) return;
      const bytes = await state.doc.save();
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${baseName(state.file.name)}-signed.pdf`);
      showToast('Signed PDF downloaded', 'success');
    });

    setMode('draw');
    updateButtons();
  }

  // ---------------------------------------------------------------------------
  // Tool switching (hash based, so every tool has a shareable URL)
  // ---------------------------------------------------------------------------

  const convertView = document.getElementById('tool-convert');
  const toolView = document.getElementById('tool-view');
  const navButtons = document.querySelectorAll('#toolNav [data-tool]');
  const rendered = {};

  function showTool(name) {
    if (name !== 'sign' && !TOOLS[name]) name = 'convert';
    navButtons.forEach(b => {
      const on = b.dataset.tool === name;
      b.classList.toggle('bg-accent', on);
      b.classList.toggle('text-white', on);
      b.classList.toggle('text-zinc-600', !on);
      b.classList.toggle('hover:bg-zinc-100', !on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    });
    convertView.classList.toggle('hidden', name !== 'convert');
    toolView.classList.toggle('hidden', name === 'convert');
    Array.from(toolView.children).forEach(c => c.classList.add('hidden'));
    if (name === 'convert') return;

    if (!rendered[name]) {
      const el = document.createElement('div');
      toolView.appendChild(el);
      if (name === 'sign') renderSignTool(el); else renderSingleFileTool(name, el);
      rendered[name] = el;
    }
    rendered[name].classList.remove('hidden');
  }

  navButtons.forEach(b => b.addEventListener('click', () => {
    const name = b.dataset.tool;
    history.replaceState(null, '', name === 'convert' ? location.pathname : `#${name}`);
    showTool(name);
  }));
  window.addEventListener('hashchange', () => showTool(location.hash.slice(1)));
  showTool(location.hash.slice(1));
})();
