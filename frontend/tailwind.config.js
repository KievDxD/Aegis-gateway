/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        obsidian: {
          950: "#07090d",
          900: "#0b0e14",
          850: "#10151e",
          800: "#151c27",
          700: "#1e2837",
        },
        aegis: {
          cyan: "#06b6d4",
          emerald: "#10b981",
          amber: "#f59e0b",
          crimson: "#f43f5e",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};
