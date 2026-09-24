import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [react()],
	server: {
		// Loopback only: the canvas is a local tool, not something to expose on the network.
		host: '127.0.0.1',
		port: 5173,
	},
})
