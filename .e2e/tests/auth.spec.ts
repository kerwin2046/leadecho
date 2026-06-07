import { test, expect } from "@playwright/test";

/**
 * Auth feature — REAL UI login + register flows.
 *
 * Routes:  dashboard/src/routes/_auth/login.tsx  (/app/login)
 *          dashboard/src/routes/_auth/register.tsx (/app/register)
 * API:     POST /api/v1/auth/{register,login}  (see backend internal/auth/email.go)
 *
 * This spec deliberately runs in a FRESH, LOGGED-OUT context: it overrides the
 * project-wide authenticated storageState with an empty one. The `_auth.tsx`
 * layout redirects authenticated users away (<Navigate to="/inbox" />), so we
 * MUST be logged out to see the login/register forms at all.
 *
 * Self-cleaning / idempotent: register uses a unique epoch-ms email so reruns
 * never collide; the seeded login account is read-only (never mutated).
 *
 * The login/register components render native <input> (getByPlaceholder works)
 * and a native <button> (getByRole works). On success they do a RAW
 *   window.location.href = "/inbox"
 * which is NOT router-basepath-aware (basepath is "/app"), so the browser lands
 * on /inbox — a 404 — instead of /app/inbox. We assert the ACTUAL post-auth URL
 * and flag the bug below.
 */

// Fresh context: discard the authenticated storageState the config injects.
test.use({ storageState: { cookies: [], origins: [] } });

// Seeded account from auth.setup.ts — exists with onboarding complete.
const SEEDED = {
  email: "e2e-tester@leadecho.test",
  password: "e2e-password-123",
};

test.describe("auth — real UI login + register flows (fresh context)", () => {
  test("login page renders the real form for a logged-out visitor", async ({
    page,
  }) => {
    await page.goto("/app/login");

    // Not redirected away (we are genuinely logged out).
    await expect(page).toHaveURL(/\/app\/login/);

    await expect(
      page.getByRole("heading", { name: "Welcome to LeadEcho" }),
    ).toBeVisible();
    await expect(page.getByPlaceholder("Email")).toBeVisible();
    await expect(page.getByPlaceholder("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
    // Google SSO + link to register exist in the JSX.
    await expect(
      page.getByRole("button", { name: /Continue with Google/i }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Register" })).toBeVisible();
  });

  test("register: brand-new unique account submits and lands on /app/inbox (basepath-aware redirect)", async ({
    page,
  }) => {
    const unique = Date.now();
    const newEmail = `e2e-reg-${unique}@leadecho.test`;
    const newPassword = "e2e-register-pass-123"; // >= 8 chars

    await page.goto("/app/register");
    await expect(
      page.getByRole("heading", { name: "Create Account" }),
    ).toBeVisible();

    await page.getByPlaceholder("Full name").fill(`E2E Reg ${unique}`);
    await page.getByPlaceholder("Email").fill(newEmail);
    await page
      .getByPlaceholder("Password (min 8 characters)")
      .fill(newPassword);

    // Capture the real network result of the register mutation.
    const [registerResp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/v1/auth/register") &&
          r.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Create Account" }).click(),
    ]);

    // Backend returns 201 Created. (Don't read the body: the app navigates
    // immediately on success, discarding the response body — identity is
    // verified via auth/me below.)
    expect(registerResp.status(), "register API status").toBe(201);

    // After the fix, register navigates to the basepath-aware /app/inbox.
    await page.waitForURL(/\/app\/inbox(\?|#|$)/, { timeout: 15_000 });
    expect(new URL(page.url()).pathname, "post-register pathname").toBe(
      "/app/inbox",
    );
    // The dashboard shell actually renders (not a 404 / blank page).
    await expect(page.locator("#root")).not.toBeEmpty();

    // The session cookie WAS set by register, so the new user is truly authed.
    const me = await page.request.get("/api/v1/auth/me");
    expect(me.ok(), "auth/me after register").toBeTruthy();
    expect((await me.json()).email).toBe(newEmail);

    // Self-clean note: register creates a fresh workspace+user per unique email;
    // there is no public delete-account endpoint, so we rely on the unique-suffix
    // email to keep reruns collision-free (no shared state mutated).
  });

  test("register: client-side guard rejects passwords shorter than 8 chars before any API call", async ({
    page,
  }) => {
    await page.goto("/app/register");

    // The native input has minLength=8; bypass HTML validation by also asserting
    // the JS guard. Use a 7-char password and watch that NO register call fires.
    let registerCalled = false;
    page.on("request", (req) => {
      if (req.url().includes("/api/v1/auth/register")) registerCalled = true;
    });

    await page.getByPlaceholder("Full name").fill("Shorty");
    await page.getByPlaceholder("Email").fill(`e2e-short-${Date.now()}@leadecho.test`);
    // Remove minLength so the browser doesn't block submit, exercising the JS guard.
    await page.evaluate(() => {
      const el = document.querySelector<HTMLInputElement>(
        'input[placeholder="Password (min 8 characters)"]',
      );
      if (el) el.removeAttribute("minlength");
    });
    await page.getByPlaceholder("Password (min 8 characters)").fill("short12"); // 7 chars
    await page.getByRole("button", { name: "Create Account" }).click();

    await expect(
      page.getByText("Password must be at least 8 characters"),
    ).toBeVisible();
    // Still on register; no network mutation happened.
    await expect(page).toHaveURL(/\/app\/register/);
    expect(registerCalled, "no register API call for short password").toBe(false);
  });

  test("login: seeded account signs in via the UI and lands on /app/inbox", async ({
    page,
  }) => {
    await page.goto("/app/login");

    await page.getByPlaceholder("Email").fill(SEEDED.email);
    await page.getByPlaceholder("Password").fill(SEEDED.password);

    const [loginResp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/v1/auth/login") &&
          r.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Sign In" }).click(),
    ]);

    // Only assert status here: the app navigates (window.location) immediately
    // after a 200, which tears down the response body before .json() can read it.
    // Identity is verified via auth/me below instead.
    expect(loginResp.status(), "login API status").toBe(200);

    // Basepath-aware redirect to /app/inbox after login.
    await page.waitForURL(/\/app\/inbox(\?|#|$)/, { timeout: 15_000 });
    expect(new URL(page.url()).pathname, "post-login pathname").toBe(
      "/app/inbox",
    );

    // Session is valid and tied to the seeded account.
    const me = await page.request.get("/api/v1/auth/me");
    expect(me.ok(), "auth/me after login").toBeTruthy();
    expect((await me.json()).email).toBe(SEEDED.email);
  });

  test("login: invalid credentials surface the backend error in the UI and do not navigate", async ({
    page,
  }) => {
    await page.goto("/app/login");

    await page
      .getByPlaceholder("Email")
      .fill(`no-such-user-${Date.now()}@leadecho.test`);
    await page.getByPlaceholder("Password").fill("definitely-wrong-pass");

    const [loginResp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/v1/auth/login") &&
          r.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Sign In" }).click(),
    ]);

    // Backend returns 401 with {"error":"invalid email or password"}.
    expect(loginResp.status(), "invalid login API status").toBe(401);

    // The api.ts request() helper throws `${status}: ${rawBody}`, and login.tsx
    // renders err.message verbatim. So the visible error contains both the 401
    // and the backend message. Assert on the stable substring.
    await expect(page.getByText(/invalid email or password/i)).toBeVisible();

    // Stays on the login route; no spurious navigation to /inbox.
    await expect(page).toHaveURL(/\/app\/login/);

    // And no session was established.
    const me = await page.request.get("/api/v1/auth/me");
    expect(me.ok(), "auth/me should be unauthorized after failed login").toBe(
      false,
    );
  });
});
