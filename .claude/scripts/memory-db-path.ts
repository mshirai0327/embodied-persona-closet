import { existsSync } from "fs";
import { dirname, resolve } from "path";

const CLAUDE_MARKER = "CLAUDE.md";
const MEMORY_DB_RELATIVE_PATH = ".claude/memories/memory.db";

function findProjectRoot(startDir: string): string | null {
  let current = resolve(startDir);

  while (true) {
    if (existsSync(resolve(current, CLAUDE_MARKER))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export function resolveMemoryDbPath(options?: {
  cwd?: string;
  scriptDir?: string;
}): string {
  const explicitPath = process.env.MEMORY_DB_PATH?.trim();
  if (explicitPath) {
    return explicitPath;
  }

  const projectDir = process.env.CLAUDE_PROJECT_DIR?.trim();
  if (projectDir) {
    return resolve(projectDir, MEMORY_DB_RELATIVE_PATH);
  }

  const cwdProjectRoot = findProjectRoot(options?.cwd ?? process.cwd());
  if (cwdProjectRoot) {
    return resolve(cwdProjectRoot, MEMORY_DB_RELATIVE_PATH);
  }

  if (options?.scriptDir) {
    const scriptProjectRoot = findProjectRoot(options.scriptDir);
    if (scriptProjectRoot) {
      return resolve(scriptProjectRoot, MEMORY_DB_RELATIVE_PATH);
    }
  }

  const homeDir = process.env.HOME?.trim();
  if (homeDir) {
    return resolve(homeDir, MEMORY_DB_RELATIVE_PATH);
  }

  return resolve(MEMORY_DB_RELATIVE_PATH);
}
