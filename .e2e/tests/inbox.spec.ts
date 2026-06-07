import { test, expect } from "@playwright/test";

/**
 * LeadEcho "Smart Inbox" feature — the mentions inbox.
 *
 * Route: dashboard/src/routes/_dashboard/inbox.tsx, rendered at /app/inbox.
 *
 * The page reads:
 *   GET  /api/v1/mentions             (list, paginated, ?tier&status&platform&search&limit)
 *   GET  /api/v1/mentions/counts      (StatusCount[] → drives the "{n} new" badge)
 *   GET  /api/v1/mentions/tier-counts (TierCount[]   → drives the tier-tab counts)
 *   PATCH /api/v1/mentions/{id}/status  (archive / status change)
 *   POST /api/v1/mentions/{id}/classify    (AI — needs a provider key)
 *   POST /api/v1/mentions/{id}/draft-reply (AI — needs a provider key)
 *
 * The authenticated storageState provides a logged-in user with ~59 (seeded =
 * 132 at time of authoring) HackerNews mentions, all status "new" and tier
 * "filtered" (unscored: relevance_score / intent are null). So:
 *   - "All" and "Filtered" tier tabs are populated.
 *   - "Leads Ready" / "Worth Watching" tabs are empty (no scored mentions).
 *   - platform=reddit yields the empty state.
 *   - AI provider keys are ABSENT → classify/draft-reply return HTTP 400.
 *     We assert the controls EXIST and that clicking them degrades gracefully
 *     (no draft panel, no crash) — we never require AI output.
 *
 * Everything here either only reads, or fully restores any mutation it makes,
 * so the spec is idempotent across reruns.
 */

const INBOX_URL = "/app/inbox";

// A mention card is the closest thing to a stable row container. We locate the
// "Draft Reply" button (always rendered for every mention) and walk up to the
// Card. Cards have the "hover:shadow-sm" utility class which is card-specific.
function mentionCards(page: import("@playwright/test").Page) {
  return page.locator("div.grid > div").filter({
    has: page.getByRole("button", { name: "Draft Reply" }),
  });
}

test.describe("smart inbox / mentions", () => {
  test("page loads authenticated and renders the Smart Inbox header", async ({
    page,
  }) => {
    const resp = await page.goto(INBOX_URL);
    expect(resp?.status(), "inbox HTTP status").toBeLessThan(400);

    // storageState carries the session → no bounce to login / onboarding.
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page).not.toHaveURL(/\/onboarding/);

    await expect(
      page.getByRole("heading", { name: "Smart Inbox", exact: true }),
    ).toBeVisible();

    // The four tier tabs always render.
    for (const label of ["All", "Leads Ready", "Worth Watching", "Filtered"]) {
      await expect(
        page.getByRole("button", { name: new RegExp(`^${label}`) }),
        `tier tab "${label}"`,
      ).toBeVisible();
    }

    // Filter controls render (search box + status/platform <select>s).
    await expect(page.getByPlaceholder("Search mentions...")).toBeVisible();
    await expect(
      page.getByRole("combobox").first(),
      "status/platform selects",
    ).toBeVisible();
  });

  test("populated state: seeded mentions render with platform + new-count badge", async ({
    page,
  }) => {
    // Ground-truth the seeded data through the authenticated request context.
    const apiRes = await page.request.get("/api/v1/mentions?limit=20");
    expect(apiRes.ok(), "mentions list endpoint ok").toBeTruthy();
    const apiBody = (await apiRes.json()) as {
      data: Array<{ id: string; platform: string }>;
    };
    expect(apiBody.data.length, "seeded mentions exist").toBeGreaterThan(0);

    const countsRes = await page.request.get("/api/v1/mentions/counts");
    expect(countsRes.ok(), "counts endpoint ok").toBeTruthy();
    const counts = (await countsRes.json()) as Array<{
      status: string;
      count: number;
    }>;
    const newCount = counts.find((c) => c.status === "new")?.count ?? 0;
    expect(newCount, "seeded new mentions").toBeGreaterThan(0);

    await page.goto(INBOX_URL);

    // The "{n} new" badge reflects the counts endpoint exactly.
    await expect(
      page.getByText(`${newCount} new`, { exact: true }),
      "new-count badge matches API",
    ).toBeVisible({ timeout: 15_000 });

    // At least one mention card renders (default limit is 20).
    const cards = mentionCards(page);
    await expect(cards.first(), "first mention card visible").toBeVisible({
      timeout: 15_000,
    });
    const cardCount = await cards.count();
    expect(cardCount, "rendered cards count").toBeGreaterThan(0);
    expect(cardCount, "page is capped at limit 20").toBeLessThanOrEqual(20);

    // Each seeded mention carries a platform badge; the fixture is HackerNews.
    await expect(
      page.getByText("hackernews", { exact: true }).first(),
      "platform badge rendered",
    ).toBeVisible();
  });

  test("search filters the list to matching mentions", async ({ page }) => {
    // SearchMentions runs a full-text query; "analytics" matches a known subset.
    const searchRes = await page.request.get(
      "/api/v1/mentions?search=analytics&limit=20",
    );
    expect(searchRes.ok()).toBeTruthy();
    const searchBody = (await searchRes.json()) as { data: unknown[] };
    expect(
      searchBody.data.length,
      "search 'analytics' returns matches",
    ).toBeGreaterThan(0);

    await page.goto(INBOX_URL);

    // Wait for the unfiltered list to populate first.
    await expect(mentionCards(page).first()).toBeVisible({ timeout: 15_000 });
    const before = await mentionCards(page).count();

    // The route re-queries on Enter (and on change via the queryKey).
    const box = page.getByPlaceholder("Search mentions...");
    await box.fill("analytics");
    await box.press("Enter");

    // After searching, results still render and stay within page size.
    await expect(mentionCards(page).first()).toBeVisible({ timeout: 15_000 });
    const after = await mentionCards(page).count();
    expect(after, "search returns at least one match").toBeGreaterThan(0);
    expect(after, "search list within page size").toBeLessThanOrEqual(before);

    // A nonsense query that matches nothing → empty state card.
    await box.fill(`zzqqx-no-such-token-${Date.now()}`);
    await box.press("Enter");
    await expect(
      page.getByText("No mentions found. Adjust your filters or check back later."),
      "empty state for no-match search",
    ).toBeVisible({ timeout: 15_000 });
  });

  test("empty state: a platform with no mentions shows the empty card", async ({
    page,
  }) => {
    // Confirm via API that the seeded fixture has no reddit mentions.
    const redditRes = await page.request.get(
      "/api/v1/mentions?platform=reddit&limit=20",
    );
    expect(redditRes.ok()).toBeTruthy();
    const reddit = (await redditRes.json()) as { data: unknown[] };
    expect(reddit.data.length, "no seeded reddit mentions").toBe(0);

    await page.goto(INBOX_URL);
    await expect(mentionCards(page).first()).toBeVisible({ timeout: 15_000 });

    // The platform <select> is the 2nd combobox (status is 1st).
    const platformSelect = page.getByRole("combobox").nth(1);
    await platformSelect.selectOption("reddit");

    await expect(
      page.getByText(
        "No mentions found. Adjust your filters or check back later.",
      ),
      "empty state card for reddit",
    ).toBeVisible({ timeout: 15_000 });
    await expect(mentionCards(page)).toHaveCount(0);
  });

  test("tier tabs: 'Leads Ready' is empty, 'All'/'Filtered' are populated", async ({
    page,
  }) => {
    // Ground-truth: the seeded fixture is entirely the "filtered" tier.
    const tcRes = await page.request.get("/api/v1/mentions/tier-counts");
    expect(tcRes.ok()).toBeTruthy();
    const tierCounts = (await tcRes.json()) as Array<{
      tier: string;
      count: number;
    }>;
    const filtered = tierCounts.find((t) => t.tier === "filtered")?.count ?? 0;
    const leadsReady =
      tierCounts.find((t) => t.tier === "leads_ready")?.count ?? 0;
    expect(filtered, "seeded filtered-tier mentions").toBeGreaterThan(0);
    expect(leadsReady, "no leads-ready in fixture").toBe(0);

    await page.goto(INBOX_URL);
    await expect(mentionCards(page).first()).toBeVisible({ timeout: 15_000 });

    // The "Filtered" tab shows its count in parentheses, e.g. "Filtered (132)".
    await expect(
      page.getByRole("button", { name: new RegExp(`Filtered \\(${filtered}\\)`) }),
      "Filtered tab shows non-zero count",
    ).toBeVisible();

    // Switch to "Leads Ready" → no scored mentions → empty state.
    await page.getByRole("button", { name: /^Leads Ready/ }).click();
    await expect(
      page.getByText(
        "No mentions found. Adjust your filters or check back later.",
      ),
      "Leads Ready tab is empty",
    ).toBeVisible({ timeout: 15_000 });

    // Switch to "Filtered" → mentions return.
    await page.getByRole("button", { name: /^Filtered/ }).click();
    await expect(mentionCards(page).first(), "Filtered tab populated").toBeVisible(
      { timeout: 15_000 },
    );
  });

  test("archiving a mention removes it from the inbox (and is restored)", async ({
    page,
  }) => {
    // Grab a known mention to act on, then guarantee restoration afterwards.
    const listRes = await page.request.get("/api/v1/mentions?limit=20");
    const list = (await listRes.json()) as {
      data: Array<{ id: string; status: string }>;
    };
    expect(list.data.length).toBeGreaterThan(0);
    const target = list.data[0];

    try {
      await page.goto(INBOX_URL);
      const cards = mentionCards(page);
      await expect(cards.first()).toBeVisible({ timeout: 15_000 });
      const countBefore = await cards.count();

      // The first card maps to the first list item (both default-ordered). Click
      // its Archive button; the mutation PATCHes status → "archived". The default
      // list still includes archived items, so we assert the server-side state
      // and then verify the mention surfaces under the "Archived" status filter.
      await cards
        .first()
        .getByRole("button", { name: "Archive" })
        .click();

      // Wait for the archive to land server-side, then verify via API.
      await expect
        .poll(
          async () => {
            const r = await page.request.get(`/api/v1/mentions/${target.id}`);
            if (!r.ok()) return null;
            return ((await r.json()) as { status: string }).status;
          },
          { timeout: 15_000, message: "mention becomes archived" },
        )
        .toBe("archived");

      // Filter the UI to "Archived" → the archived mention appears there.
      const statusSelect = page.getByRole("combobox").first();
      await statusSelect.selectOption("archived");
      await expect(
        mentionCards(page).first(),
        "archived mention shows under Archived filter",
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      // Self-clean: restore the mention to its original status regardless.
      await page.request.patch(`/api/v1/mentions/${target.id}/status`, {
        data: { status: target.status || "new" },
      });
    }

    // Confirm restoration.
    const after = await page.request.get(`/api/v1/mentions/${target.id}`);
    expect(after.ok()).toBeTruthy();
    expect(((await after.json()) as { status: string }).status).toBe(
      target.status || "new",
    );
  });

  test("AI controls exist and degrade gracefully without provider keys", async ({
    page,
  }) => {
    // The fixture mentions are unclassified (intent null), so BOTH the
    // "Classify" and "Draft Reply" buttons render on each card.
    await page.goto(INBOX_URL);
    const firstCard = mentionCards(page).first();
    await expect(firstCard).toBeVisible({ timeout: 15_000 });

    const draftBtn = firstCard.getByRole("button", { name: "Draft Reply" });
    const classifyBtn = firstCard.getByRole("button", { name: "Classify" });
    await expect(draftBtn, "Draft Reply control exists").toBeVisible();
    await expect(classifyBtn, "Classify control exists").toBeVisible();

    // The AI endpoints have no provider key → HTTP 400 with a clear message.
    // Verify the contract directly (graceful, no 500).
    const listRes = await page.request.get("/api/v1/mentions?limit=1");
    const id = (
      (await listRes.json()) as { data: Array<{ id: string }> }
    ).data[0].id;

    const draftRes = await page.request.post(
      `/api/v1/mentions/${id}/draft-reply`,
    );
    expect(
      draftRes.status(),
      "draft-reply returns a client error (no AI key), not a crash",
    ).toBe(400);
    const draftBody = await draftRes.text();
    expect(draftBody, "draft-reply error mentions AI provider").toMatch(
      /AI provider/i,
    );

    const classifyRes = await page.request.post(
      `/api/v1/mentions/${id}/classify`,
    );
    expect(
      classifyRes.status(),
      "classify returns a client error (no AI key), not a crash",
    ).toBe(400);

    // Clicking "Draft Reply" in the UI must NOT open a draft panel (the
    // mutation fails) and must NOT crash the page — the header stays put.
    await draftBtn.click();
    await expect(
      page.getByText("AI Draft", { exact: true }),
      "no AI draft panel opens without a provider key",
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Smart Inbox", exact: true }),
      "page remains rendered after failed AI action",
    ).toBeVisible();
  });
});
