/**
 * Client-safe registry of the preset UI themes. The actual colour tokens live in
 * `app/globals.css` under `:root[data-theme="<id>"]`; this module only describes
 * the available themes (id, label, preview swatches) and validates theme ids.
 *
 * Keep this module free of server-only imports so both the admin UI (client) and
 * the settings service (server) can import it.
 */

export const THEME_IDS = [
  "institutional-blue",
  "margalla-mist",
  "ivory-press",
  "sage-calm",
  "indigo-night",
  "graphite",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export type ThemeMeta = {
  id: ThemeId;
  name: string;
  description: string;
  /** True when the theme uses a dark surface palette. */
  dark: boolean;
  /** Four representative colours used to preview the theme in the admin UI. */
  swatch: [string, string, string, string];
};

export const DEFAULT_THEME: ThemeId = "institutional-blue";

export const THEMES: ThemeMeta[] = [
  {
    id: "institutional-blue",
    name: "Institutional Blue",
    description: "Deep navy with a clean blue accent on bright, airy surfaces.",
    dark: false,
    swatch: ["#f1f4f8", "#1b4e8f", "#0f294a", "#ffffff"],
  },
  {
    id: "margalla-mist",
    name: "Margalla Mist",
    description: "Cool, hazy green-grey tones inspired by the Margalla hills.",
    dark: false,
    swatch: ["#eef2f1", "#2f6d5e", "#24413a", "#ffffff"],
  },
  {
    id: "ivory-press",
    name: "Ivory Press",
    description: "Warm paper background with an inked brick accent.",
    dark: false,
    swatch: ["#f7f3ea", "#9a3b2e", "#3a2a22", "#fffdf8"],
  },
  {
    id: "sage-calm",
    name: "Sage Calm",
    description: "Soft, muted greens for a relaxed, low-glare reading surface.",
    dark: false,
    swatch: ["#f0f4ee", "#4a7c3f", "#2f4a28", "#ffffff"],
  },
  {
    id: "indigo-night",
    name: "Indigo Night",
    description: "Dark indigo surfaces with a luminous periwinkle accent.",
    dark: true,
    swatch: ["#10122a", "#8fa8ff", "#1c1a4d", "#1a1d3a"],
  },
  {
    id: "graphite",
    name: "Graphite",
    description: "Neutral charcoal surfaces with a cool steel accent.",
    dark: true,
    swatch: ["#16181c", "#a9b8c9", "#1b1e22", "#20242a"],
  },
];

export function isThemeId(value: string): value is ThemeId {
  return (THEME_IDS as readonly string[]).includes(value);
}

export function getThemeMeta(id: ThemeId): ThemeMeta {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

/** Coerces an arbitrary stored value to a valid theme id, falling back to the default. */
export function normalizeThemeId(value: string | null | undefined): ThemeId {
  return value && isThemeId(value) ? value : DEFAULT_THEME;
}
