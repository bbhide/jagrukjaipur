/** Admin panel behaviours shared by every screen. */
const sidebar = document.getElementById("admin-sidebar");
const overlay = document.getElementById("sidebar-overlay");
const toggleSidebar = () => { sidebar?.classList.toggle("open"); overlay?.classList.toggle("show"); };
document.getElementById("sidebar-toggle")?.addEventListener("click", toggleSidebar);
overlay?.addEventListener("click", toggleSidebar);

// Destructive actions declare their confirmation text with data-confirm on the form or link.
document.addEventListener("submit", (e) => {
  const form = e.target as HTMLFormElement;
  const msg = form.dataset.confirm ?? ((e as SubmitEvent).submitter as HTMLElement | null)?.dataset.confirm;
  if (msg && !confirm(msg)) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
document.addEventListener("click", (e) => {
  const link = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-confirm]");
  if (link && !confirm(link.dataset.confirm!)) e.preventDefault();
});

// Selects that submit their form on change (filters, inline status updates).
document.querySelectorAll<HTMLSelectElement>("select[data-autosubmit]").forEach((s) => s.addEventListener("change", () => s.form?.requestSubmit()));

// Image upload preview + drag and drop
const imageInput = document.getElementById("image-input") as HTMLInputElement | null;
const imagePreview = document.getElementById("image-preview") as HTMLImageElement | null;
const placeholder = document.getElementById("upload-placeholder");
const uploadArea = document.getElementById("image-upload-area");
const showPreview = (file?: File) => {
  if (!file || !imagePreview) return;
  imagePreview.src = URL.createObjectURL(file);
  imagePreview.style.display = "block";
  if (placeholder) placeholder.style.display = "none";
};
imageInput?.addEventListener("change", () => showPreview(imageInput.files?.[0]));
uploadArea?.addEventListener("click", (e) => { if (e.target !== imageInput) imageInput?.click(); });
uploadArea?.addEventListener("dragover", (e) => { e.preventDefault(); uploadArea.classList.add("drag-over"); });
uploadArea?.addEventListener("dragleave", () => uploadArea.classList.remove("drag-over"));
uploadArea?.addEventListener("drop", (e) => {
  e.preventDefault(); uploadArea.classList.remove("drag-over");
  const file = (e as DragEvent).dataTransfer?.files[0];
  if (file && imageInput) { const dt = new DataTransfer(); dt.items.add(file); imageInput.files = dt.files; showPreview(file); }
});

// Flash auto-dismiss
const flash = document.querySelector<HTMLElement>(".a-flash");
if (flash) setTimeout(() => { flash.style.transition = "opacity .4s ease"; flash.style.opacity = "0"; setTimeout(() => flash.remove(), 400); }, 5000);

// Colour picker hex readout
document.getElementById("color")?.addEventListener("input", function (this: HTMLInputElement) {
  const hex = document.getElementById("color-hex"); if (hex) hex.textContent = this.value.toUpperCase();
});

// Submit spinner + double-submit guard
document.addEventListener("submit", (e) => {
  if (e.defaultPrevented) return;
  const form = e.target as HTMLFormElement;
  if (form.method.toUpperCase() === "GET" || form.hasAttribute("data-no-loading") || !form.checkValidity()) return;
  if (form.dataset.submitting === "true") { e.preventDefault(); return; }
  const btn = ((e as SubmitEvent).submitter as HTMLButtonElement | null) ?? form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!btn) return;
  form.dataset.submitting = "true";
  const original = btn.innerHTML;
  setTimeout(() => { btn.classList.add("is-submitting"); btn.innerHTML = `<span class="btn-spinner"></span> ${btn.dataset.loadingText ?? "Please wait..."}`; }, 0);
  setTimeout(() => { form.dataset.submitting = "false"; btn.classList.remove("is-submitting"); btn.innerHTML = original; }, 25000);
});
