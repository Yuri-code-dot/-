import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // καλλιτέχνις is served from the /-/ path on tensoramax.me.
  base: '/-/',
  plugins: [react()],
})