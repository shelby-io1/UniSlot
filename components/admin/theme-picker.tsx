"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { setThemeAction } from "@/app/admin/actions";
import { THEMES } from "@/lib/theme";
import type { ThemeId } from "@/lib/theme";

export default function ThemePicker({ current }: { current: ThemeId }) {
  const router = useRouter();
  const [active, setActive] = useState<ThemeId>(current);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    document.documentElement.dataset.theme = active;
  }, [active]);

  function choose(id: ThemeId) {
    if (pending || id === active) return;
    const previous = active;
    setActive(id);
    setError(null);
    start(async () => {
      const formData = new FormData();
      formData.set("theme", id);
      const result = await setThemeAction({}, formData);
      if (result.error) {
        setActive(previous);
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const activeMeta = THEMES.find((theme) => theme.id === active);

  return (
    <div className="admin-entity">
      <div className="admin-bar">
        <div>
          <h2 style={{ margin: 0 }}>Appearance</h2>
          <p className="muted" style={{ margin: "2px 0 0" }}>
            Choose the preset theme applied across the whole site.
          </p>
        </div>
      </div>

      {error ? <div className="note error">{error}</div> : null}

      <div className="theme-grid">
        {THEMES.map((theme) => (
          <button
            key={theme.id}
            type="button"
            className={theme.id === active ? "theme-card on" : "theme-card"}
            aria-pressed={theme.id === active}
            disabled={pending}
            onClick={() => choose(theme.id)}
          >
            <span className="theme-card-head">
              <strong>{theme.name}</strong>
              <span className="theme-card-flag">{theme.dark ? "Dark" : "Light"}</span>
            </span>
            <p>{theme.description}</p>
            <span className="theme-swatches">
              {theme.swatch.map((color) => (
                <span
                  key={color}
                  className="theme-swatch"
                  style={{ background: color }}
                  aria-hidden="true"
                />
              ))}
            </span>
          </button>
        ))}
      </div>

      <div className="theme-picker-actions muted">
        {pending ? "Applying…" : `Current theme: ${activeMeta?.name ?? active}`}
      </div>
    </div>
  );
}
