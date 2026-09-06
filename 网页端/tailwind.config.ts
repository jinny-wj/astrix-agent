import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      spacing: {
        'space-xs': 'var(--space-xs)',
        'space-sm': 'var(--space-sm)',
        'space-md': 'var(--space-md)',
        'space-lg': 'var(--space-lg)',
        'space-lg-plus': 'var(--space-lg-plus)',
        'space-xl': 'var(--space-xl)',
        'space-2xl': 'var(--space-2xl)',
        'space-2xl-plus': 'var(--space-2xl-plus)',
        'space-3xl': 'var(--space-3xl)',
        'space-4xl': 'var(--space-4xl)',
      },
      colors: {
        canvas: '#fbfbfc',
        hairline: '#ececee',
        muted: '#9a9aa0',
        ink: '#1d1d1f',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"PingFang SC"',
          '"Helvetica Neue"',
          'Inter',
          'sans-serif',
        ],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,18,27,0.04)',
        prompt: '0 2px 12px rgba(16,18,27,0.045)',
      },
      borderRadius: {
        xl2: '14px',
      },
    },
  },
  plugins: [],
} satisfies Config
