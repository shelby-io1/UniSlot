import { cacheLife, cacheTag } from "next/cache";
import { getDb } from "../db";
import { DEFAULT_THEME } from "../theme";
import type { ThemeId } from "../theme";
import { getTheme } from "./settings";

/** Cache tag invalidated whenever the admin changes the active theme. */
export const THEME_TAG = "app-theme";

/**
 * The active theme, cached in the static shell so pages stay prerenderable.
 * Invalidate with `updateTag(THEME_TAG)` after `setTheme` writes a new value.
 * Falls back to the default theme if the database is unreachable (e.g. during a
 * build without a database), so rendering never fails because of theming.
 */
export async function getActiveTheme(): Promise<ThemeId> {
  "use cache";
  cacheLife("max");
  cacheTag(THEME_TAG);
  try {
    const db = await getDb();
    return await getTheme(db);
  } catch (error) {
    console.error("Failed to read the active theme; using the default", error);
    return DEFAULT_THEME;
  }
}
