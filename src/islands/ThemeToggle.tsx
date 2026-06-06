import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  return (localStorage.getItem("zb-theme") as Theme) ?? "system";
}

function resolveTheme(pref: Theme): "light" | "dark" {
  if (pref === "system") {
    return matchMedia("(prefers-color-scheme:dark)").matches ? "dark" : "light";
  }
  return pref;
}

function applyTheme(resolved: "light" | "dark") {
  if (resolved === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

export function ThemeToggle() {
  const [pref, setPref] = useState<Theme>("system");

  useEffect(() => {
    setPref(getStoredTheme());
  }, []);

  useEffect(() => {
    applyTheme(resolveTheme(pref));

    // Listen for OS preference changes when set to "system"
    if (pref === "system") {
      const mq = matchMedia("(prefers-color-scheme:dark)");
      const handler = () => applyTheme(resolveTheme("system"));
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [pref]);

  function cycle() {
    const next: Theme = pref === "light" ? "dark" : pref === "dark" ? "system" : "light";
    setPref(next);
    if (next === "system") {
      localStorage.removeItem("zb-theme");
    } else {
      localStorage.setItem("zb-theme", next);
    }
  }

  const label = pref === "light" ? "Light" : pref === "dark" ? "Dark" : "Auto";

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Theme: ${label}. Click to switch.`}
      title={`Theme: ${label}`}
      className="fixed bottom-20 right-4 z-50 flex h-10 w-10 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface)] text-[var(--muted)] shadow-md transition hover:text-[var(--ink)] hover:border-[var(--brand)] md:bottom-6"
    >
      {pref === "light" && (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="5" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      )}
      {pref === "dark" && (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
        </svg>
      )}
      {pref === "system" && (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      )}
    </button>
  );
}
