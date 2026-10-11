import path from "path";
import type { Config } from "tailwindcss";

// Cash Cow: milk-white ground, charcoal spots, one pink accent (the nose). Light theme.
const config: Config = {
  content: [path.join(__dirname, "app/**/*.{ts,tsx}"), path.join(__dirname, "components/**/*.{ts,tsx}")],
  theme: {
    extend: {
      colors: {
        ink: "#FBF8F1", // page ground: milk
        panel: "#F2EDE2", // raised surface: cream, no border needed
        line: "#E1DACB", // dividers
        fg: "#1E1E1E", // text and outlines: cow-spot charcoal
        muted: "#6D685F",
        spot: "#4A4A4A", // secondary dark, matches the cow's patches
        accent: "#1E1E1E", // primary buttons and focus: solid charcoal
        nose: "#F4A9BC", // the one colour accent, < 10% of any screen
        "nose-deep": "#BE3F66", // pink that passes contrast for text on milk
        pass: "#2F7A3E", // pasture green
        fail: "#C2372C",
        watch: "#1E1E1E",
        human: "#9A6200",
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        sans: ["var(--font-body)", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      letterSpacing: { tightest: "-0.03em" },
      borderRadius: { DEFAULT: "10px" },
    },
  },
  plugins: [],
};
export default config;
