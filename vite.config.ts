import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { dataMiddleware, defaultDataPath } from './server/dataFile';

/** Serve the outline file at /api/data (see server/dataFile.ts). */
function dataFile(): Plugin {
  const path = defaultDataPath();
  return {
    name: 'outliner-data-file',
    configureServer(server) {
      server.middlewares.use(dataMiddleware(path));
      server.config.logger.info(`  outline file: ${path}`);
    },
    configurePreviewServer(server) {
      server.middlewares.use(dataMiddleware(path));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [preact(), dataFile()],
});
