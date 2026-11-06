import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Igor is always served under /igor/, standalone and through Pantheon's proxy.
export default defineConfig({ plugins: [react()], base: '/igor/' });
