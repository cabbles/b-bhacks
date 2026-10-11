import path from "path";
import type { Config } from "tailwindcss";

const config: Config = {
  content: [path.join(__dirname, "app/**/*.{ts,tsx}"), path.join(__dirname, "components/**/*.{ts,tsx}")],
  theme: {
    extend: {
      colors: {
        pass: "#16a34a",
        fail: "#dc2626",
        watch: "#2563eb",
        human: "#d97706",
      },
      fontFamily: { mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"] },
    },
  },
  plugins: [],
};
export default config;
