export const THEME_KEY = "flight-finder:theme";
export type Theme = "auto" | "light" | "dark";

/** Inlined in <head> so the saved theme applies before the page paints (no flash). */
export const themeScript = `(function(){try{var t=localStorage.getItem("${THEME_KEY}")||"auto";var d=t==="dark"||(t==="auto"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;
