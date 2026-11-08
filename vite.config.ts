import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { dataMiddleware, defaultDataPath, legacyDataPath, migrateDataFile } from './server/dataFile.ts';

/** Data saved before the rename (~/outliner) moves to the default location. */
async function moveLegacy(path: string, log: (m: string) => void) {
  if (process.env.YAMOLI_DATA) return;
  const legacy = legacyDataPath();
  if (await migrateDataFile(path, legacy)) log(`  moved ${legacy} to ${path}`);
}

/** Serve the outline file at /api/data (see server/dataFile.ts). */
function dataFile(): Plugin {
  const path = defaultDataPath();
  return {
    name: 'yamoli-data-file',
    async configureServer(server) {
      await moveLegacy(path, (m) => server.config.logger.info(m));
      server.middlewares.use(dataMiddleware(path));
      server.config.logger.info(`  outline file: ${path}`);
    },
    async configurePreviewServer(server) {
      await moveLegacy(path, (m) => server.config.logger.info(m));
      server.middlewares.use(dataMiddleware(path));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [preact(), dataFile()],
});
