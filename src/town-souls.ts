// @desc Town soul loader: reads town-souls/*.md to extract agent name and identity for system prompt
// Search order (later wins): package town-souls/ → cwd town-souls/ → {stateDir}/town-souls/ → town-data/souls/
import { readFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateDir } from './plugin/paths.js';

export interface TownSoul {
  name: string;
  soul: string;
  source?: 'system' | 'user';
}

const DEFAULT_SOUL: TownSoul = {
  name: 'Agent',
  soul: 'You are a coding agent. Use tools to solve tasks. Act, don\'t explain.',
  source: 'system',
};

interface SoulDir {
  path: string;
  source: 'system' | 'user';
}

function getPluginDir(): string {
  try {
    // import.meta.url is dist/src/town-souls.js → go up two levels to project root
    return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  } catch { return process.cwd(); }
}

export function getTownDataSoulsDir(): string {
  const dir = resolve(getPluginDir(), 'town-data', 'souls');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getSoulDirs(cwd?: string): SoulDir[] {
  const base = cwd ?? process.cwd();
  const dirs: SoulDir[] = [];
  try {
    const thisDir = dirname(fileURLToPath(import.meta.url));
    dirs.push({ path: resolve(thisDir, '../town-souls'), source: 'system' });
  } catch (err) { console.warn('[town-souls] Failed to resolve plugin dir:', (err as Error).message) }
  dirs.push({ path: resolve(base, 'town-souls'), source: 'system' });
  try {
    dirs.push({ path: resolve(stateDir(), 'town-souls'), source: 'user' });
  } catch {
    dirs.push({ path: resolve(base, '.openclaw', 'town-souls'), source: 'user' });
  }
  dirs.push({ path: getTownDataSoulsDir(), source: 'user' });
  // Filter out non-existent directories to avoid ENOENT warnings during readdirSync
  return dirs.filter(d => existsSync(d.path));
}

function resolveSoulFile(soulId?: string, cwd?: string): { file: string; source: 'system' | 'user' } | undefined {
  if (process.env.TOWN_SOUL) {
    const envPath = resolve(process.env.TOWN_SOUL);
    if (existsSync(envPath)) return { file: envPath, source: 'system' };
  }

  const dirs = getSoulDirs(cwd);

  if (!soulId) {
    let found: { file: string; source: 'system' | 'user' } | undefined;
    for (const dir of dirs) {
      const candidate = resolve(dir.path, 'SOUL.md');
      if (existsSync(candidate)) found = { file: candidate, source: dir.source };
    }
    return found;
  }

  // 1) Case-insensitive filename match (later dirs win: user > system)
  const queryLower = soulId.toLowerCase();
  let found: { file: string; source: 'system' | 'user' } | undefined;
  for (const dir of dirs) {
    try {
      for (const f of readdirSync(dir.path)) {
        if (!f.endsWith('.md')) continue;
        if (basename(f, '.md').toLowerCase() === queryLower) {
          found = { file: resolve(dir.path, f), source: dir.source };
        }
      }
    } catch (err) { console.warn('[town-souls] Failed to read soul dir:', (err as Error).message) }
  }
  if (found) return found;

  // 2) Fuzzy: search H1 heading / file content for the soulId keyword
  const query = soulId.toLowerCase();
  for (const dir of dirs) {
    try {
      for (const f of readdirSync(dir.path)) {
        if (!f.endsWith('.md')) continue;
        const filePath = resolve(dir.path, f);
        try {
          const text = readFileSync(filePath, 'utf-8');
          const header = text.slice(0, 500).toLowerCase();
          if (header.includes(query)) {
            found = { file: filePath, source: dir.source };
          }
        } catch (err) { console.warn('[town-souls] Failed to read soul file:', (err as Error).message) }
      }
    } catch (err) { console.warn('[town-souls] Failed to read soul dir:', (err as Error).message) }
  }
  return found;
}

export function listTownSouls(cwd?: string): Array<{ id: string; source: 'system' | 'user' }> {
  const map = new Map<string, 'system' | 'user'>();
  for (const dir of getSoulDirs(cwd)) {
    try {
      for (const f of readdirSync(dir.path)) {
        if (f.endsWith('.md')) map.set(basename(f, '.md').toLowerCase(), dir.source);
      }
    } catch (err) { console.warn('[town-souls] Failed to list souls dir:', (err as Error).message) }
  }
  return [...map.entries()].map(([id, source]) => ({ id, source }));
}

export function loadTownSoul(soulId?: string, cwd?: string): TownSoul {
  const result = resolveSoulFile(soulId, cwd);
  if (result) {
    try {
      const text = readFileSync(result.file, 'utf-8');
      const name = extractName(text);
      return { name, soul: text.trim(), source: result.source };
    } catch (err) { console.warn('[town-souls] Failed to load soul:', (err as Error).message) }
  }
  return DEFAULT_SOUL;
}

function extractName(markdown: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  if (match) return match[1].trim();
  return DEFAULT_SOUL.name;
}
