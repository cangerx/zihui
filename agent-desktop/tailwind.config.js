/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/src/**/*.{vue,js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // primary 各档引用 CSS 变量（由 utils/theme-color.ts 按云控端主色派生注入），
        // fallback 为浅色工作台墨绿——未注入时与 DEFAULT_PRIMARY 一致
        primary: {
          50: 'var(--color-primary-50, #f2f6f5)',
          100: 'var(--color-primary-100, #e6efed)',
          200: 'var(--color-primary-200, #c5d9d5)',
          300: 'var(--color-primary-300, #9bbfba)',
          400: 'var(--color-primary-400, #6a9a92)',
          500: 'var(--color-primary-500, #23574f)',
          600: 'var(--color-primary-600, #1f4d46)',
          700: 'var(--color-primary-700, #1a3f3a)',
          800: 'var(--color-primary-800, #15322e)',
          900: 'var(--color-primary-900, #0e2320)'
        },
        surface: {
          0: 'var(--surface-0)',
          1: 'var(--surface-1)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)',
          4: 'var(--surface-4)'
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          tertiary: 'var(--text-tertiary)',
          disabled: 'var(--text-disabled)'
        }
      },
      borderRadius: {
        'xl': '12px',
        '2xl': '14px',
        '3xl': '18px'
      },
      boxShadow: {
        'card': '0 1px 2px rgba(28, 27, 23, 0.04), 0 0 0 1px rgba(35, 87, 79, 0.04)',
        'card-hover': '0 8px 24px -12px rgba(28, 27, 23, 0.12), 0 0 0 1px rgba(35, 87, 79, 0.06)',
        'panel': '0 1px 3px rgba(28, 27, 23, 0.04), 0 0 0 1px rgba(35, 87, 79, 0.05)',
        'modal': '0 0 0 1px rgba(35, 87, 79, 0.06), 0 24px 48px -16px rgba(28, 27, 23, 0.18)'
      }
    }
  },
  plugins: [require('@tailwindcss/typography')]
}
