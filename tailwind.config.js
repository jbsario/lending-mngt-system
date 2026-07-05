/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#14231F',        // near-black green-black for text
        vault: '#0F3D3E',      // deep teal - primary
        vaultdark: '#0A2B2C',
        ledger: '#F6F3EC',     // warm paper background
        ledgerline: '#E4DFD1', // hairline rule on paper
        brass: '#B8863B',      // accent - gold/brass, ledger-stamp feel
        brassdark: '#8F6A2E',
        moss: '#3E6B4F',       // success/active
        rust: '#A6432E',       // overdue/danger
        slatey: '#5B6B66'      // muted text
      },
      fontFamily: {
        display: ['"Fraunces"', 'serif'],
        body: ['"Inter"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace']
      }
    }
  },
  plugins: []
}
