import path from "path";
import type { Config } from "tailwindcss";

// Swiss-utility scoreboard: slate-black ground, hairline rules, one electric-lime accent.
const config: Config = {
  content: [path.join(__dirname, "app/**/*.{ts,tsx}"), path.join(__dirname, "components/**/*.{ts,tsx}")],
  theme: {
    extend: {
      colors: {
        ink: "#0D0F12", // page ground
        panel: "#13161B", // raised surface
        line: "#262A31", // hairline rules
        fg: "#ECEDEE",
        muted: "#8A8F98",
        accent: "#C6FF3D", // the one accent: < 10% of any screen
        pass: "#C6FF3D",
        fail: "#FF5A4E",
        watch: "#ECEDEE",
        human: "#FFB020",
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        sans: ["var(--font-body)", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      letterSpacing: { tightest: "-0.055em" },
      borderRadius: { DEFAULT: "2px" },
    },
  },
  plugins: [],
};
export default config;
