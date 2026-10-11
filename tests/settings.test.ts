import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { appSettings, auditLogs } from "@/lib/db/schema";
import { DEFAULT_THEME, THEMES, THEME_IDS, isThemeId, normalizeThemeId } from "@/lib/theme";
import { AdminError } from "@/lib/services/admin";
import { getTheme, setTheme, THEME_SETTING_KEY } from "@/lib/services/settings";

async function clearTheme() {
  const db = await getDb();
  await db.delete(appSettings).where(eq(appSettings.key, THEME_SETTING_KEY));
  return db;
}

describe("theme registry", () => {
  it("exposes six unique presets with a valid default", () => {
    expect(THEMES).toHaveLength(6);
    expect(THEME_IDS).toContain(DEFAULT_THEME);
    expect(new Set(THEME_IDS).size).toBe(THEME_IDS.length);
    expect(THEMES.every((theme) => theme.swatch.length === 4)).toBe(true);
    expect(isThemeId(DEFAULT_THEME)).toBe(true);
    expect(isThemeId("not-a-theme")).toBe(false);
    expect(normalizeThemeId("not-a-theme")).toBe(DEFAULT_THEME);
    expect(normalizeThemeId(null)).toBe(DEFAULT_THEME);
  });
});

describe("getTheme", () => {
  it("returns the default when no theme is stored", async () => {
    const db = await clearTheme();
    expect(await getTheme(db)).toBe(DEFAULT_THEME);
  });
});

describe("setTheme", () => {
  it("persists a valid theme, upserts a single row and audits the change", async () => {
    const db = await clearTheme();
    expect(await setTheme(db, "indigo-night", "tester")).toBe("indigo-night");
    expect(await getTheme(db)).toBe("indigo-night");

    const target = THEME_IDS.find((id) => id !== "indigo-night")!;
    expect(await setTheme(db, target, "tester")).toBe(target);
    expect(await getTheme(db)).toBe(target);

    const rows = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, THEME_SETTING_KEY));
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(target);

    const audit = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(eq(auditLogs.action, "admin.theme"));
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects unknown or non-string theme ids and leaves the value untouched", async () => {
    const db = await clearTheme();
    await setTheme(db, "sage-calm", "tester");

    await expect(setTheme(db, "neon", "tester")).rejects.toBeInstanceOf(AdminError);
    await expect(setTheme(db, 42, "tester")).rejects.toBeInstanceOf(AdminError);
    await expect(setTheme(db, null, "tester")).rejects.toBeInstanceOf(AdminError);

    expect(await getTheme(db)).toBe("sage-calm");
  });
});
