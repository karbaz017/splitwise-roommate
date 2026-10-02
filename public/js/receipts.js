import { esc, formatBytes, icons, toast } from './util.js';
import { API } from './api.js';

const ACCEPT = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 10;

/**
 * Receipt attachment widget: click-to-browse, drag & drop, and paste (Ctrl/Cmd+V).
 * Holds not-yet-uploaded files in memory; `existing` are receipts already saved.
 */
export class ReceiptPicker {
  constructor(root) {
    this.root = root;
    this.pending = [];
    this.existing = [];
    this.expenseId = null;
    this.onRemoveExisting = null;
    this.onDuplicate = null; // (File, duplicateInfo) => void
    this.onAdded = null; // (File[]) => void, called with newly accepted files
    this.render();
  }

  reset(existing = [], expenseId = null) {
    this.pending.forEach((p) => p.url && URL.revokeObjectURL(p.url));
    this.pending = [];
    this.existing = existing;
    this.expenseId = expenseId;
    this.render();
  }

  get files() { return this.pending.map((p) => p.file); }

  add(fileList) {
    const accepted = [];
    for (const file of fileList) {
      const type = file.type || '';
      const looksOk = ACCEPT.includes(type) || /\.(heic|heif|pdf|jpe?g|png|gif|webp)$/i.test(file.name);
      if (!looksOk) { toast(`"${file.name}" isn't a supported file. Use an image or PDF.`, 'error'); continue; }
      if (file.size > MAX_BYTES) { toast(`"${file.name}" is over 10 MB.`, 'error'); continue; }
      if (this.pending.length + this.existing.length >= MAX_FILES) { toast(`At most ${MAX_FILES} receipts per entry.`, 'error'); break; }
      // Pasted screenshots are called "image.png"; give them a useful name.
      const named = file.name === 'image.png' || !file.name
        ? new File([file], `pasted-${Date.now()}.${(type.split('/')[1] || 'png')}`, { type })
        : file;
      accepted.push(named);
      this.pending.push({ file: named, url: named.type.startsWith('image/') && !/heic|heif/.test(named.type) ? URL.createObjectURL(named) : null });
    }
    this.render();
    if (accepted.length) this.onAdded?.(accepted);
    accepted.forEach((f) => this.checkDuplicate(f));
  }

  // Warn when the same file is already attached to another entry (double-entry guard).
  async checkDuplicate(file) {
    try {
      if (!window.crypto?.subtle) return; // needs a secure context (https or localhost)
      const buf = await file.arrayBuffer();
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('');
      const { duplicate } = await API.lookupReceipt(hash);
      if (duplicate && duplicate.id !== this.expenseId) this.onDuplicate?.(file, duplicate);
    } catch { /* best effort */ }
  }

  // Wire paste for the lifetime of a modal; returns a disposer.
  listenForPaste(scopeEl) {
    const handler = (e) => {
      if (scopeEl.classList.contains('hidden')) return;
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) { e.preventDefault(); this.add(files); toast(`Added ${files.length} pasted file${files.length > 1 ? 's' : ''}.`); }
    };
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }

  render() {
    const chips = [
      ...this.existing.map((r) => `
        <div class="receipt-chip" data-existing="${esc(r.id)}">
          <a href="${API.receiptUrl(r.file)}" target="_blank" rel="noopener" class="receipt-thumb">
            ${r.mime.startsWith('image/') && r.mime !== 'image/heic' ? `<img src="${API.receiptUrl(r.file)}" alt="">` : `<span class="receipt-file-icon">${r.mime === 'application/pdf' ? 'PDF' : 'IMG'}</span>`}
          </a>
          <span class="receipt-name" title="${esc(r.name)}">${esc(r.name)}</span>
          <span class="receipt-size">${formatBytes(r.size)}</span>
          <button type="button" class="receipt-remove" data-remove-existing="${esc(r.id)}" aria-label="Remove ${esc(r.name)}">&times;</button>
        </div>`),
      ...this.pending.map((p, i) => `
        <div class="receipt-chip pending">
          <span class="receipt-thumb">${p.url ? `<img src="${p.url}" alt="">` : `<span class="receipt-file-icon">${p.file.type === 'application/pdf' ? 'PDF' : 'IMG'}</span>`}</span>
          <span class="receipt-name" title="${esc(p.file.name)}">${esc(p.file.name)}</span>
          <span class="receipt-size">${formatBytes(p.file.size)}</span>
          <button type="button" class="receipt-remove" data-remove-pending="${i}" aria-label="Remove ${esc(p.file.name)}">&times;</button>
        </div>`),
    ].join('');

    this.root.innerHTML = `
      <div class="dropzone" tabindex="0" role="button" aria-label="Attach receipts: click, drop files, or paste">
        <div class="dropzone-text"><strong>Attach receipts</strong><span>Click to browse, drag &amp; drop, or paste (Ctrl/⌘+V)</span><small>JPG, PNG, WebP, HEIC or PDF · up to 10 MB each</small></div>
        <input type="file" accept="image/*,application/pdf,.heic,.pdf" multiple hidden>
      </div>
      <div class="receipt-list">${chips}</div>`;

    const zone = this.root.querySelector('.dropzone');
    const input = this.root.querySelector('input');
    zone.onclick = () => input.click();
    zone.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
    input.onchange = () => { this.add([...input.files]); input.value = ''; };
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('drag'); }));
    zone.addEventListener('drop', (e) => this.add([...e.dataTransfer.files]));

    this.root.querySelectorAll('[data-remove-pending]').forEach((b) => {
      b.onclick = () => {
        const [removed] = this.pending.splice(Number(b.dataset.removePending), 1);
        if (removed?.url) URL.revokeObjectURL(removed.url);
        this.render();
      };
    });
    this.root.querySelectorAll('[data-remove-existing]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('Remove this receipt permanently?')) return;
        try {
          await API.deleteReceipt(this.expenseId, b.dataset.removeExisting);
          this.existing = this.existing.filter((r) => r.id !== b.dataset.removeExisting);
          this.render();
          this.onRemoveExisting?.();
        } catch (err) { toast(err.message, 'error'); }
      };
    });
    icons();
  }
}
