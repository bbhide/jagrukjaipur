import { expect, test, type Page } from "@playwright/test";

const OTP = process.env.OTP_DEV_CODE ?? "1234";
const ADMIN_USER = process.env.ADMIN_USERNAME ?? "admin";
const ADMIN_PASS = process.env.ADMIN_PASSWORD ?? "admin-dev-password";
const uniqueMobile = () => "9" + String(Date.now()).slice(-9);

const PUBLIC_ROUTES = ["/", "/?free=1", "/events-in-jaipur-today", "/events-this-weekend-in-jaipur", "/trending-events-in-jaipur", "/category/music",
  "/communities", "/organizer/kythera", "/podcast", "/tickiting", "/about", "/contact", "/privacy", "/search", "/organizer"];

/** Collects console errors and failed same-origin requests while a page is used. */
function watch(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 400 && new URL(r.url()).origin === new URL(page.url() || "http://127.0.0.1:4321").origin) problems.push(`${r.status()} ${r.url()}`); });
  return problems;
}

async function login(page: Page, mobile = uniqueMobile()) {
  await page.locator("#nav-profile-login-btn, .drawer-auth-btn").first().click();
  await page.fill("#auth-mobile", mobile);
  await page.click("#auth-btn-1");
  await page.fill("#auth-otp", OTP);
  await page.click("#auth-btn-2");
  await page.fill("#auth-name", "E2E Tester");
  await page.fill("#auth-email", "e2e@example.com");
  await Promise.all([page.waitForLoadState("load"), page.click("#auth-btn-3")]);
  await expect(page.locator("#nav-profile-btn .nav-profile-name")).toHaveText("E2E Tester");
}

test.describe("public pages", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} renders without console or network errors`, async ({ page }) => {
      const problems = watch(page);
      const res = await page.goto(route, { waitUntil: "networkidle" });
      expect(res?.status()).toBe(200);
      await expect(page.locator("nav.navbar")).toBeVisible();
      await expect(page.locator("footer.footer")).toBeVisible();
      await expect(page.locator("head title")).not.toBeEmpty();
      expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toBeTruthy();
      expect(problems).toEqual([]);
    });
  }

  test("every internal link on the main pages resolves", async ({ page, request }) => {
    const seen = new Set<string>();
    for (const route of ["/", "/communities", "/podcast", "/tickiting", "/trending-events-in-jaipur"]) {
      await page.goto(route);
      for (const href of await page.locator("a[href^='/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")!))) seen.add(href.split("#")[0]);
    }
    const broken: string[] = [];
    for (const href of seen) {
      if (!href || href.startsWith("/admin")) continue;
      const res = await request.get(href, { maxRedirects: 5 });
      if (res.status() >= 400) broken.push(`${res.status()} ${href}`);
    }
    expect(broken).toEqual([]);
  });

  test("unknown routes return a real 404 page", async ({ page }) => {
    const res = await page.goto("/this-page-does-not-exist");
    expect(res?.status()).toBe(404);
    await expect(page.locator("main")).toContainText(/couldn.t find that page/i);
    expect((await page.goto("/event/no-such-event"))?.status()).toBe(404);
    expect((await page.goto("/category/no-such-category"))?.status()).toBe(404);
  });

  test("legacy .php URLs redirect to clean URLs", async ({ request }) => {
    for (const [from, to] of [["/about.php", "/about"], ["/contact.php", "/contact"], ["/privacy.php", "/privacy"], ["/search.php?q=x", "/search?q=x"]]) {
      const res = await request.get(from, { maxRedirects: 0 });
      expect(res.status()).toBe(301);
      expect(res.headers()["location"]).toBe(to);
    }
  });

  test("sitemap, robots and manifest are served", async ({ request }) => {
    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain("<loc>");
    expect(await (await request.get("/robots.txt")).text()).toContain("Disallow: /admin/");
    expect((await request.get("/favicon/site.webmanifest")).status()).toBe(200);
  });
});

test.describe("homepage", () => {
  test("lists 12 events and loads more until the end of the lineup", async ({ page }) => {
    await page.goto("/");
    const cards = page.locator("#events-grid .event-card");
    await expect(cards).toHaveCount(12);
    await page.click("#load-more-btn");
    await expect(cards).toHaveCount(24);
    // Keep loading until the lineup is exhausted, however many events are seeded.
    for (let shown = 24; await page.locator("#load-more-btn").count(); ) {
      await page.click("#load-more-btn");
      await expect.poll(() => cards.count()).toBeGreaterThan(shown);
      shown = await cards.count();
    }
    await expect(page.locator("#end-of-events")).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(24);
  });

  test("free filter shows only free events and marks its chip active", async ({ page }) => {
    await page.goto("/?free=1");
    await expect(page.locator("#cat-free")).toHaveClass(/active/);
    const prices = await page.locator("#events-grid .event-price").allInnerTexts();
    expect(prices.length).toBeGreaterThan(0);
    expect(prices.every((p) => /free/i.test(p))).toBe(true);
  });

  test("mobile drawer opens, closes with Escape and hides desktop buttons @mobile", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#nav-podcast-btn")).toBeHidden();
    await page.click("#mobile-menu-toggle");
    await expect(page.locator("#mobile-nav-drawer")).toHaveClass(/open/);
    await expect(page.locator("#mobile-menu-toggle")).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(page.locator("#mobile-nav-drawer")).not.toHaveClass(/open/);
  });
});

test.describe("WhatsApp login", () => {
  test("gated actions open the login dialog with context-specific copy", async ({ page }) => {
    await page.goto("/");
    await page.locator("#events-grid .event-card").first().click();
    await expect(page.locator("#auth-modal-overlay")).toHaveClass(/active/);
    await expect(page.locator("#auth-modal-desc")).toContainText("access event tickets");
    await page.click("#auth-modal-close");
    await page.click("#nav-search-input");
    await expect(page.locator("#auth-modal-desc")).toContainText("search events & communities");
  });

  test("rejects a bad number and a wrong OTP, then registers, searches and edits the profile", async ({ page }) => {
    await page.goto("/");
    await page.click("#hero-search-btn");
    await page.fill("#auth-mobile", "12345");
    await page.click("#auth-btn-1");
    await expect(page.locator("#auth-step-1")).toBeVisible(); // browser validation keeps us on step 1

    await page.fill("#auth-mobile", uniqueMobile());
    await page.click("#auth-btn-1");
    await page.fill("#auth-otp", OTP === "0000" ? "1111" : "0000");
    await page.click("#auth-btn-2");
    await expect(page.locator("#auth-error-2")).toContainText(/invalid otp/i);

    await page.fill("#auth-otp", OTP);
    await page.click("#auth-btn-2");
    await page.fill("#auth-name", "E2E Tester");
    await page.fill("#auth-email", "e2e@example.com");
    await page.click("#auth-btn-3");
    await page.waitForURL("**/search");
    await expect(page.locator("#nav-profile-btn .nav-profile-name")).toHaveText("E2E Tester");

    await page.fill("#search-input", "jaipur");
    await page.keyboard.press("Enter");
    await page.waitForURL("**/search?q=jaipur");
    await expect(page.locator(".event-card").first()).toBeVisible();

    await page.click("#nav-profile-btn");
    await expect(page.locator("#profile-modal-overlay")).toHaveClass(/active/);
    await expect(page.locator("#profile-name")).toHaveValue("E2E Tester");
    await page.click("#profile-modal-close");
    await expect(page.locator("#profile-error")).toContainText("Please complete your profile.");
    await page.selectOption("#profile-gender", "Other");
    await page.fill("#profile-dob", "1995-04-12");
    await page.fill("#profile-instagram", "https://instagram.com/jagrukjaipur/");
    await page.click("#profile-btn-save");
    await expect(page.locator("#profile-success")).toContainText("Profile updated successfully!");
    await expect(page.locator("#profile-modal-overlay")).not.toHaveClass(/active/, { timeout: 5000 });
  });

  test("a logged-in visitor opens an event from a card", async ({ page }) => {
    await page.goto("/");
    await login(page);
    const card = page.locator("#events-grid .event-card").first();
    const title = (await card.locator(".event-card-title").innerText()).trim();
    await card.locator(".event-card-title").click();
    await page.waitForURL("**/event/**");
    await expect(page.locator("h1")).toContainText(title);
  });
});

test.describe("event detail", () => {
  test("shows meta, FAQ, sidebar and Event structured data", async ({ page }) => {
    const problems = watch(page);
    await page.goto("/event/jaipur-design-festival", { waitUntil: "networkidle" });
    await expect(page.locator("h1")).toHaveText("Jaipur Design Festival");
    await expect(page.locator(".event-sidebar-card")).toContainText("JAWAHAR KALA KENDRA");
    await expect(page.locator("main")).toContainText("Frequently Asked Questions");
    const ld = await page.locator('script[type="application/ld+json"]').allInnerTexts();
    expect(ld.some((t) => /"@type":\s*"Event"/.test(t))).toBe(true);
    expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toContain("/uploads/");
    expect(problems).toEqual([]);
  });
});

test.describe("podcast", () => {
  test("lists episodes and validates the guest application", async ({ page }) => {
    await page.goto("/podcast");
    await expect(page.locator("main")).toContainText("EP #12");
    const form = page.locator("#podcast-guest-form");
    await form.locator('[name="name"]').fill("E2E Applicant");
    await form.locator('[name="phone"]').fill("9876543210");
    await form.locator('[name="email"]').fill("applicant@example.com");
    await form.locator('[name="topic"]').fill("Building communities in Jaipur");
    await form.locator('[name="bio"]').fill("short");
    await form.locator('button[type="submit"]').click();
    await page.waitForLoadState("load");
    await expect(page.locator("main")).toContainText(/tell us a little more|at least/i);
    await expect(page.locator('#podcast-guest-form [name="name"]')).toHaveValue("E2E Applicant");
  });
});

test.describe("admin", () => {
  test("requires login, rejects bad credentials, then reaches every section", async ({ page }) => {
    await page.goto("/admin/events");
    await page.waitForURL("**/admin/login?redirect=%2Fadmin%2Fevents");
    await page.fill("#username", ADMIN_USER);
    await page.fill("#password", "wrong-password");
    await page.click("#login-submit-btn");
    await expect(page.locator(".a-flash-error")).toContainText("Invalid username or password");

    await page.fill("#username", ADMIN_USER);
    await page.fill("#password", ADMIN_PASS);
    await page.click("#login-submit-btn");
    await page.waitForURL("**/admin/events");
    await expect(page.locator(".a-table tbody tr").first()).toBeVisible();

    const problems = watch(page);
    const links = await page.locator(".sidebar-nav a.sidebar-link[href^='/admin']").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
    expect(links.length).toBe(15);
    for (const href of links) {
      const res = await page.goto(href, { waitUntil: "networkidle" });
      expect(res?.status(), href).toBe(200);
      await expect(page.locator(".admin-content")).toBeVisible();
    }
    expect(problems).toEqual([]);

    page.once("dialog", (d) => d.accept());
    await page.click("#nav-logout");
    await page.waitForURL("**/admin/login");
    await page.goto("/admin");
    await page.waitForURL("**/admin/login?redirect=%2Fadmin");
  });
});
