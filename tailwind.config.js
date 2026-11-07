/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        wood: {
          light: '#d2b48c',
          dark: '#5c4033',
        }
      }
    },
  },
  plugins: [],
}
