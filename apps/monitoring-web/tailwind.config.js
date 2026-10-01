/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0e1116",
        panel: "#171c24",
        line: "#2a3340",
        sos: "#e23b3b",
        ok: "#3ddc97",
        warn: "#f5c451",
      },
    },
  },
  plugins: [],
};
