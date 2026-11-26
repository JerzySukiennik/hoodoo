// Hoodoo storage: autosave of the open scene in IndexedDB and .hoodoo file export/import.

import { sceneToJSON, sceneFromJSON } from './scene/scene.js';

const DB = 'hoodoo', STORE = 'scenes';

function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function autosave(scene) {
  try {
    const d = await db();
    const json = sceneToJSON(scene, true);
    await new Promise((res, rej) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(json, 'current');
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  } catch (e) { console.warn('autosave failed', e); }
}

export async function loadAutosave() {
  try {
    const d = await db();
    const json = await new Promise((res, rej) => {
      const tx = d.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get('current');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return json ? sceneFromJSON(json) : null;
  } catch (e) { console.warn('autoload failed', e); return null; }
}

export function sceneFile(scene) {
  return new Blob([JSON.stringify(sceneToJSON(scene, true))], { type: 'application/json' });
}

export async function readSceneFile(file) {
  const j = JSON.parse(await file.text());
  if (j.app !== 'hoodoo') throw new Error('Not a Hoodoo scene');
  return sceneFromJSON(j);
}
