/** Page-level behaviours shared by every public page. */

// Scroll-to-top
const scrollBtn = document.getElementById("scroll-top-btn");
if (scrollBtn) {
  window.addEventListener("scroll", () => scrollBtn.classList.toggle("visible", window.scrollY > 400), { passive: true });
  scrollBtn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
}

// Centre the active filter chip
const filterScroll = document.getElementById("filter-scroll");
const activeChip = filterScroll?.querySelector<HTMLElement>(".filter-chip.active");
if (activeChip) setTimeout(() => activeChip.scrollIntoView({ inline: "center", behavior: "smooth", block: "nearest" }), 100);

// PWA install prompt (Android) and guide (iOS Safari)
let deferredPrompt: any = null;
const installBanner = document.getElementById("install-banner");
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (installBanner && !sessionStorage.getItem("pwa-dismissed")) installBanner.style.display = "flex";
});
document.getElementById("install-btn")?.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBanner!.style.display = "none";
});
document.getElementById("install-dismiss")?.addEventListener("click", () => {
  installBanner!.style.display = "none";
  sessionStorage.setItem("pwa-dismissed", "1");
});
(() => {
  if (sessionStorage.getItem("pwa_banner_dismissed")) return;
  if ((navigator as any).standalone || window.matchMedia("(display-mode: standalone)").matches) return;
  const ua = navigator.userAgent;
  if (!/iphone|ipad|ipod/i.test(ua) || !/^((?!chrome|android).)*safari/i.test(ua)) return;
  const banner = document.getElementById("ios-install-banner");
  setTimeout(() => { if (banner) banner.style.display = "block"; }, 3000);
  document.getElementById("ios-install-dismiss")?.addEventListener("click", () => {
    banner!.style.display = "none";
    sessionStorage.setItem("pwa_banner_dismissed", "1");
  });
})();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

// Flash auto-dismiss
const flash = document.querySelector<HTMLElement>(".flash");
if (flash) setTimeout(() => Object.assign(flash.style, { transition: "all 0.4s ease", opacity: "0", height: "0", padding: "0", margin: "0", overflow: "hidden" }), 4000);

// Scroll reveal
export const revealObserver = new IntersectionObserver((entries, observer) => {
  for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add("is-visible"); observer.unobserve(entry.target); }
}, { threshold: 0.1 });
document.querySelectorAll(".fade-in, .slide-up").forEach((el) => revealObserver.observe(el));

// Count-up numbers
const counterObserver = new IntersectionObserver((entries, observer) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const el = entry.target as HTMLElement;
    const target = parseInt(el.dataset.count ?? "0", 10);
    let start: number | null = null;
    const step = (ts: number) => {
      start ??= ts;
      const progress = Math.min((ts - start) / 2000, 1);
      el.innerText = String(progress < 1 ? Math.floor(progress * target) : target);
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    observer.unobserve(el);
  }
}, { threshold: 0.5 });
document.querySelectorAll("[data-count]").forEach((el) => counterObserver.observe(el));

export function toast(message?: string) {
  const el = document.getElementById("copy-toast");
  if (!el) return;
  if (message) el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2500);
}

// Card share: Web Share API, falling back to the clipboard
document.addEventListener("click", async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>(".share-event-card");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  const { title, text, url } = btn.dataset;
  const payload = `${title}\n\n${text}\n\n${url}`;
  if (navigator.share) {
    try { await navigator.share({ title, text: payload }); } catch (err: any) { if (err.name !== "AbortError") console.error("Share failed", err); }
  } else {
    await navigator.clipboard.writeText(payload);
    toast("Event info copied!");
  }
}, true);

// Mobile drawer
(() => {
  const toggle = document.getElementById("mobile-menu-toggle");
  const drawer = document.getElementById("mobile-nav-drawer");
  const overlay = document.getElementById("mobile-drawer-overlay");
  if (!toggle || !drawer || !overlay) return;
  const set = (open: boolean) => {
    drawer.classList.toggle("open", open);
    overlay.classList.toggle("open", open);
    toggle.classList.toggle("active", open);
    toggle.setAttribute("aria-expanded", String(open));
    document.body.classList.toggle("drawer-open", open);
    document.body.style.overflow = open ? "hidden" : "";
  };
  toggle.addEventListener("click", (e) => { e.stopPropagation(); set(!drawer.classList.contains("open")); });
  document.getElementById("mobile-drawer-close")?.addEventListener("click", () => set(false));
  overlay.addEventListener("click", () => set(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") set(false); });
  window.addEventListener("resize", () => { if (window.innerWidth > 768) set(false); });
  drawer.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
    const href = link.getAttribute("href");
    if (link.classList.contains("needs-auth-ticket-btn") || link.hasAttribute("data-open-profile") || (href && !href.startsWith("http"))) set(false);
  }));
})();

// Form submit: spinner, contextual label, double-submit guard
document.addEventListener("submit", (e) => {
  if (e.defaultPrevented) return;
  const form = e.target as HTMLFormElement;
  if (form.tagName !== "FORM" || form.hasAttribute("data-no-loading") || form.getAttribute("role") === "search" || form.method.toUpperCase() === "GET") return;
  if (!form.checkValidity()) return;
  if (form.dataset.submitting === "true") { e.preventDefault(); return; }
  const btn = (e as SubmitEvent).submitter as HTMLButtonElement | null ?? form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!btn) return;
  form.dataset.submitting = "true";
  btn.classList.add("is-submitting");
  if (btn.offsetWidth > 0) btn.style.minWidth = `${btn.offsetWidth}px`;
  const text = btn.innerText.trim().toLowerCase();
  const label = btn.dataset.loadingText ?? (text.includes("submit") ? "Submitting..." : /save|update/.test(text) ? "Saving..." : text.includes("register") ? "Registering..." : /book|pay/.test(text) ? "Processing..." : "Please wait...");
  const original = btn.innerHTML;
  // Defer so the submitter's name/value is still part of the form data.
  setTimeout(() => { btn.innerHTML = `<span class="btn-spinner"></span> ${label}`; }, 0);
  const banner = form.querySelector<HTMLElement>(".form-submitting-banner");
  if (banner) banner.style.display = "flex";
  setTimeout(() => { form.dataset.submitting = "false"; btn.classList.remove("is-submitting"); btn.innerHTML = original; if (banner) banner.style.display = "none"; }, 25000);
});

// Marks the page as loaded so CSS can bring in below-the-fold / later imagery (second hero slide).
if (document.readyState === "complete") document.documentElement.classList.add("page-loaded");
else window.addEventListener("load", () => document.documentElement.classList.add("page-loaded"));
