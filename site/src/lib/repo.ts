import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Build-time access to files in the repository (the skills, their assets and tests). */

export function repoPath(relative: string): string {
  return join(__REPO_ROOT__, relative);
}

export function readRepoFile(relative: string): string {
  return readFileSync(repoPath(relative), 'utf8');
}

export function repoFileExists(relative: string): boolean {
  return existsSync(repoPath(relative));
}

export interface SkillFiles {
  examples: string[];
  references: string[];
  assets: string[];
  /** Approximate size of SKILL.md in tokens (characters / 4). */
  skillTokens: number;
}

/** Lists a skill's supporting files as repository-relative paths. */
export function skillFiles(id: string): SkillFiles {
  const list = (folder: string) => {
    const dir = repoPath(`skills/${id}/${folder}`);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => !name.startsWith('.') && statSync(join(dir, name)).isFile())
      .sort()
      .map((name) => `skills/${id}/${folder}/${name}`);
  };
  const skill = readRepoFile(`skills/${id}/SKILL.md`);
  return {
    examples: list('examples'),
    references: list('references'),
    assets: list('assets'),
    skillTokens: Math.round(skill.length / 4),
  };
}

/** Approximate token count of a repository file (characters / 4). */
export function approxTokens(relative: string): number {
  return Math.round(readRepoFile(relative).length / 4);
}
