/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0A0A0F",
        card: "#111117",
        primary: "#7C3AED",
        secondary: "#06B6D4",
        energy: "#F97316",
        success: "#22C55E",
        muted: "#A1A1AA",
      },
    },
  },
  plugins: [],
}