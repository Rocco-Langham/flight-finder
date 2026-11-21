"use client";

import { useEffect, useState } from "react";
import { THEME_KEY, type Theme } from "@/lib/theme";

function apply(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

const OPTIONS: { value: Theme; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "☀️" },
  { value: "dark", label: "Dark", icon: "🌙" },
  { value: "auto", label: "Auto", icon: "🖥️" },
];

/** Light / Dark / Auto (follows the device setting). Remembered in this browser. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("auto");

  useEffect(() => {
    const saved = (localStorage.getItem(THEME_KEY) as Theme | null) ?? "auto";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from this browser's storage
    setTheme(saved);
  }, []);

  // On "Auto", follow the device if it switches while the page is open.
  useEffect(() => {
    if (theme !== "auto") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("auto");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const choose = (t: Theme) => {
    setTheme(t);
    localStorage.setItem(THEME_KEY, t);
    apply(t);
  };

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="flex gap-0.5 rounded-lg bg-slate-200 p-0.5 text-xs dark:bg-slate-800"
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={theme === o.value}
          onClick={() => choose(o.value)}
          title={
            o.value === "auto"
              ? "Follow this device's setting"
              : `${o.label} mode`
          }
          className={`rounded-md px-2 py-1 font-medium transition ${
            theme === o.value
              ? "bg-white text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white"
              : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          }`}
        >
          <span aria-hidden>{o.icon}</span> {o.label}
        </button>
      ))}
    </div>
  );
}
