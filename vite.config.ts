import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { dirname, join } from 'node:path';
import { dataMiddleware, defaultDataPath, legacyDataPath, migrateDataFile } from './server/dataFile.ts';
import { filesMiddleware } from './server/files.ts';

/** Data saved before the rename (~/outliner) moves to the default location. */
async function moveLegacy(path: string, log: (m: string) => void) {
  if (process.env.YAMOLI_DATA) return;
  const legacy = legacyDataPath();
  if (await migrateDataFile(path, legacy)) log(`  moved ${legacy} to ${path}`);
}

/** Serve the outline file at /api/data (see server/dataFile.ts), and its images at /api/files (server/files.ts). */
function dataFile(): Plugin {
  const path = defaultDataPath();
  const files = join(dirname(path), 'files');
  return {
    name: 'yamoli-data-file',
    async configureServer(server) {
      await moveLegacy(path, (m) => server.config.logger.info(m));
      server.middlewares.use(dataMiddleware(path));
      server.middlewares.use(filesMiddleware(files, path));
      server.config.logger.info(`  outline file: ${path}`);
    },
    async configurePreviewServer(server) {
      await moveLegacy(path, (m) => server.config.logger.info(m));
      server.middlewares.use(dataMiddleware(path));
      server.middlewares.use(filesMiddleware(files, path));
    },
  };
}

/**
 * A change to a plain module (src/*.ts: the controller, the model, formats …) reloads the page. Fast refresh swaps
 * components but keeps their state, which holds the one Controller made at the start: it would go on with the old
 * code. Components (.tsx) are still refreshed in place.
 */
function reloadOnLogic(): Plugin {
  return {
    name: 'yamoli-reload-on-logic',
    hotUpdate({ file }) {
      if (this.environment.name !== 'client' || !/\/src\/[^/]+\.ts$/.test(file) || /\.test\.ts$/.test(file)) return;
      this.environment.hot.send({ type: 'full-reload' });
      return [];
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [preact(), dataFile(), reloadOnLogic()],
});
