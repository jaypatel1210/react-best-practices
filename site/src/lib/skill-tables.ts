import { readRepoFile } from './repo';

/** Parses the tables in the skills' Markdown so the site shows them without copying them. */

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Renders the inline Markdown used in table cells: `code` and **bold**. */
export function inlineMarkdown(text: string): string {
  return text
    .split(/(`[^`]+`)/)
    .map((part) =>
      part.startsWith('`') && part.endsWith('`')
        ? `<code>${escapeHtml(part.slice(1, -1))}</code>`
        : escapeHtml(part).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'),
    )
    .join('');
}

const SKILL_NAME = /`(react-[a-z-]+)`/g;

function skillsIn(text: string): string[] {
  return [...text.matchAll(SKILL_NAME)].map((m) => m[1]);
}

/** Removes trailing skill references such as "`react-rerenders`" from a fix cell. */
function withoutSkillNames(text: string): string {
  return text.replace(/(?:\s*,?\s*`react-[a-z-]+`)+\s*$/, '').trim();
}

function tableRows(block: string): string[][] {
  return block
    .split('\n')
    .filter((line) => line.trim().startsWith('|'))
    .slice(2) // header and separator
    .map((line) =>
      line
        .trim()
        .replace(/^\||\|$/g, '')
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim()),
    );
}

export interface ChecklistItem {
  id: string;
  lookFor: string;
  why: string;
  fix: string;
  skills: string[];
}

export interface ChecklistSection {
  id: string;
  number: number;
  title: string;
  items: ChecklistItem[];
}

export interface Checklist {
  intro: string;
  severity: { label: string; text: string }[];
  sections: ChecklistSection[];
  outputFormat: string;
}

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function loadChecklist(): Checklist {
  const md = readRepoFile('skills/react-best-practices/references/review-checklist.md');
  const parts = md.split(/^## /m);
  const intro = parts[0].split('\n').filter((l) => l && !l.startsWith('#')).join(' ').trim();

  const severityPart = parts.find((p) => p.startsWith('Severity guide')) ?? '';
  const severity = [...severityPart.matchAll(/^- \*\*([^*]+):\*\*\s*(.+)$/gm)].map((m) => ({
    label: m[1].trim(),
    text: m[2].trim(),
  }));

  const sections: ChecklistSection[] = [];
  for (const part of parts) {
    const heading = part.match(/^(\d+)\.\s+(.+)$/m);
    if (!heading || part.indexOf(heading[0]) !== 0) continue;
    const number = Number(heading[1]);
    const title = heading[2].trim();
    const id = slugify(title);
    const items = tableRows(part).map((cells, index) => {
      const [lookFor = '', why = '', fix = ''] = cells;
      return { id: `${id}-${index + 1}`, lookFor, why, fix: withoutSkillNames(fix), skills: skillsIn(fix) };
    });
    sections.push({ id, number, title, items });
  }

  const outputPart = parts.find((p) => p.startsWith('Output format')) ?? '';
  const outputFormat = outputPart.match(/```markdown\n([\s\S]*?)```/)?.[1].trim() ?? '';

  return { intro, severity, sections, outputFormat };
}

export interface SymptomRow {
  symptom: string;
  cause: string;
  skill: string;
}

/** The "Symptom map" table from the entry skill. */
export function loadSymptomMap(): SymptomRow[] {
  const md = readRepoFile('skills/react-best-practices/SKILL.md');
  const section = md.split(/^## /m).find((p) => p.startsWith('Symptom map')) ?? '';
  return tableRows(section)
    .map(([symptom = '', cause = '', load = '']) => ({ symptom, cause, skill: skillsIn(load)[0] ?? '' }))
    .filter((row) => row.symptom && row.skill);
}

/** The numbered "mental model" list from the entry skill. */
export function loadMentalModel(): string[] {
  const md = readRepoFile('skills/react-best-practices/SKILL.md');
  const section = md.split(/^## /m).find((p) => p.startsWith('The mental model')) ?? '';
  return [...section.matchAll(/^\d+\.\s+(.+)$/gm)].map((m) => m[1].trim());
}
