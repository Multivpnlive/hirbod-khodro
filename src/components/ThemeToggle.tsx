import { useEffect, useState } from "react";

type Theme = "dark" | "light";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const saved = window.localStorage.getItem("hirbod-theme");
    const next: Theme = saved === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setTheme(next);
  }, []);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("hirbod-theme", next);
    setTheme(next);
  }

  return (
    <button
      type="button"
      className="hirbod-theme-toggle"
      onClick={toggleTheme}
      aria-label={theme === "dark" ? "فعال کردن حالت روشن" : "فعال کردن حالت تاریک"}
      title={theme === "dark" ? "تغییر به حالت روشن" : "تغییر به حالت تاریک"}
    >
      <span className="hirbod-theme-toggle__icon" aria-hidden="true">
        {theme === "dark" ? "☀" : "☾"}
      </span>
      <span>{theme === "dark" ? "حالت روشن" : "حالت تاریک"}</span>
    </button>
  );
}
