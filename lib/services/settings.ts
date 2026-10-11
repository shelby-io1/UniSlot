import { eq } from "drizzle-orm";
import type { Database } from "../db";
import { appSettings, auditLogs } from "../db/schema";
import { DEFAULT_THEME, isThemeId } from "../theme";
import type { ThemeId } from "../theme";
import { AdminError } from "./admin";

/** Key under which the active theme is stored in `app_settings`. */
export const THEME_SETTING_KEY = "theme";

/** Reads the active theme, falling back to the default for an unset/unknown value. */
export async function getTheme(db: Database): Promise<ThemeId> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, THEME_SETTING_KEY));
  return row && isThemeId(row.value) ? row.value : DEFAULT_THEME;
}

/**
 * Persists the active theme and writes an audit entry. Rejects unknown theme ids
 * so the stored value can never drift from the preset registry.
 */
export async function setTheme(
  db: Database,
  themeRaw: unknown,
  actor: string,
): Promise<ThemeId> {
  const value = typeof themeRaw === "string" ? themeRaw.trim() : "";
  if (!isThemeId(value)) throw new AdminError(`Unknown theme '${String(themeRaw)}'`);

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, THEME_SETTING_KEY));

    await tx
      .insert(appSettings)
      .values({ key: THEME_SETTING_KEY, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, updatedAt: new Date() },
      });

    await tx.insert(auditLogs).values({
      action: "admin.theme",
      entity: "app_settings",
      entityId: THEME_SETTING_KEY,
      actor,
      detail: { before: before?.value ?? null, after: value },
    });

    return value;
  });
}
