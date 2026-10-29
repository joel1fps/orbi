import { app } from 'electron';
import { join } from 'node:path';

/**
 * Files from `resources/`. In development they are read from the project;
 * installed, electron-builder copies them next to app.asar (extraResources).
 */
export const resource = (...parts: string[]) =>
  app.isPackaged ? join(process.resourcesPath, ...parts) : join(app.getAppPath(), 'resources', ...parts);
