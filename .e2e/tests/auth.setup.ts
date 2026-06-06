import { test as setup, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Deterministic shared test account. Reused across runs; register is idempotent
// (falls back to login on 409 "already registered").
export const TEST_USER = {
  name: "E2E Tester",
  email: "e2e-tester@leadecho.test",
  password: "e2e-password-123",
};

const AUTH_FILE = path.join(import.meta.dirname, "..", ".auth", "user.json");

setup("authenticate + complete onboarding", async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: "http://localhost:13100" });

  // 1. Register (or log in if the account already exists).
  let res = await ctx.request.post("/api/v1/auth/register", {
    data: TEST_USER,
  });
  if (res.status() === 409) {
    res = await ctx.request.post("/api/v1/auth/login", {
      data: { email: TEST_USER.email, password: TEST_USER.password },
    });
  }
  expect(res.ok(), `auth failed: ${res.status()} ${await res.text()}`).toBeTruthy();

  // 2. Confirm the session cookie works.
  const me = await ctx.request.get("/api/v1/auth/me");
  expect(me.ok(), `auth/me failed: ${me.status()}`).toBeTruthy();

  // 3. Complete onboarding so the dashboard gate doesn't redirect feature tests.
  //    Seeds a monitoring profile + keywords for downstream feature coverage.
  const done = await ctx.request.post("/api/v1/settings/onboarding/complete", {
    data: {
      product_name: "Acme Analytics",
      description: "Self-serve product analytics for SaaS teams",
      pain_points: [
        "hard to track product usage",
        "need better funnel analytics",
      ],
      keywords: ["product analytics", "funnel tracking", "user retention"],
      platforms: ["reddit", "hackernews"],
      subreddits: ["SaaS", "analytics"],
    },
  });
  expect(
    done.ok(),
    `onboarding complete failed: ${done.status()} ${await done.text()}`,
  ).toBeTruthy();

  // 4. Persist the authenticated storage state for all other specs.
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  await ctx.storageState({ path: AUTH_FILE });
  await ctx.close();
});
