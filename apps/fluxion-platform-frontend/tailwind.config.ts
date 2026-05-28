import type { Config } from "tailwindcss";

// Editorial Cream + Terracotta tokens. Single source of truth, mirrored in
// src/styles/tokens.css for the @layer component classes. Lifted from
// docs/design-proposals/_shared/editorial-cream.css :root.
const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Sidebar = deeper aged paper (cream). Not "sb-" prefixed so the
        // legacy dark-theme grep gate (`grep -r "sb-" src`) stays clean.
        sidebar: "#ebe2cc",
        "sidebar-2": "#e3d9be",
        "sidebar-hover": "rgba(0,0,0,.04)",
        bg: "#f4f1ea",
        paper: "#ffffff",
        "paper-2": "#fbf8f1",
        // Recessed surface (e.g. quiet icon-button backgrounds) — one step
        // darker than paper-2, still lighter than rule.
        sunk: "#efeadf",
        ink: "#1a1a1a",
        "ink-soft": "#3a3a3a",
        muted: "#7a7466",
        // Lowest-emphasis text/icon tint — quieter than muted, used for
        // timeline markers and section eyebrows.
        faint: "#a8a294",
        rule: "#e4ddca",
        "rule-2": "#d9d2c2",
        accent: "#c44a2c",
        "accent-dark": "#8a2f1a",
        "accent-soft": "#fdeee8",
        state: {
          idle: "#9a9389",
          registered: "#b88a3a",
          enrolled: "#3a4a8c",
          active: "#2a6f5b",
          locked: "#b04545",
          released: "#6a6a6a",
        },
        "state-bg": {
          idle: "#f1efea",
          registered: "#fbf2dd",
          enrolled: "#e7ecf7",
          active: "#e2f0e8",
          locked: "#fbe5e5",
          released: "#ececec",
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        xxs: '10px',
      },
    },
  },
  plugins: [],
};
export default config;
