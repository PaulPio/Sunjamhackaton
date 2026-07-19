/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        p1: '#ff2d75',
        p2: '#00e5ff',
        arena: '#05010d',
        panel: 'rgba(12, 6, 28, 0.86)',
        neon: '#d9f1ff',
      },
      fontFamily: {
        display: ['Orbitron', 'Segoe UI', 'sans-serif'],
        body: ['Rajdhani', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
