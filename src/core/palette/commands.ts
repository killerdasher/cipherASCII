/**
 * Command palette model: command definitions and the ranking used to filter
 * them while the user types.
 *
 * This module is deliberately UI-free and DOM-free so the ranking — the only
 * part with real behaviour — can be unit tested. The React side only has to
 * supply commands (each is a plain closure) and render the ranked list.
 *
 * Ranking rules, in order:
 *
 * 1. Every whitespace-separated query token must match the command in
 *    **some** field (id, title, keywords, group). Tokens are ANDed.
 * 2. A token scores highest against an id/title prefix, then a word prefix,
 *    then a keyword prefix, then a substring; a group match is the weakest.
 * 3. A query that prefixes the whole title (or id) gets a bonus, so typing
 *    more never ranks an earlier, worse match above the exact one.
 * 4. Ties keep input order, so the list does not reshuffle between keystrokes.
 *
 * The same ranking is used by the palette, the effect browser and any future
 * "jump to anything" surface.
 */

export type CommandGroup =
  | 'Project'
  | 'Edit'
  | 'View'
  | 'Tools'
  | 'Render'
  | 'Effects'
  | 'Theme'
  | 'Export';

export interface CommandDef {
  /** Stable identifier, e.g. `cell.add.cipherlock`. Also searched. */
  readonly id: string;
  /** Human title shown in the palette, e.g. `Add cell effect: Cipherlock`. */
  readonly title: string;
  readonly group: CommandGroup;
  /** Display-only shortcut hint, e.g. `Ctrl+K`. */
  readonly shortcut?: string;
  /** Extra search terms (synonyms, abbreviations, the effect category). */
  readonly keywords?: readonly string[];
  /** The action itself; closures read live state at run time. */
  readonly run: () => void;
}

export interface CommandMatch {
  readonly command: CommandDef;
  /** Higher is better; comparable only within one query. */
  readonly score: number;
}

export const SCORE_ID_PREFIX = 3;
export const SCORE_TITLE_PREFIX = 3;
export const SCORE_WORD_PREFIX = 2;
export const SCORE_KEYWORD_PREFIX = 2;
export const SCORE_TITLE_SUBSTRING = 1;
export const SCORE_KEYWORD_SUBSTRING = 1;
export const SCORE_GROUP_SUBSTRING = 0.5;
export const SCORE_WHOLE_QUERY_PREFIX = 1;

/** Split a query into lowercase, non-empty tokens. */
export function queryTokens(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

interface Ranked extends CommandMatch {
  readonly index: number;
}

function scoreToken(command: CommandDef, token: string): number | null {
  const title = command.title.toLowerCase();
  const id = command.id.toLowerCase();
  const group = command.group.toLowerCase();
  const words = title.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const keywords = command.keywords?.map((k) => k.toLowerCase());

  if (id.startsWith(token)) return SCORE_ID_PREFIX;
  if (title.startsWith(token)) return SCORE_TITLE_PREFIX;
  if (words.some((w) => w.startsWith(token))) return SCORE_WORD_PREFIX;
  if (keywords?.some((k) => k.startsWith(token))) return SCORE_KEYWORD_PREFIX;
  if (title.includes(token)) return SCORE_TITLE_SUBSTRING;
  if (keywords?.some((k) => k.includes(token))) return SCORE_KEYWORD_SUBSTRING;
  if (group.includes(token)) return SCORE_GROUP_SUBSTRING;
  return null;
}

/**
 * Rank `commands` against `query`. An empty/whitespace query returns every
 * command in input order; a query with no match returns an empty list.
 */
export function rankCommands(commands: readonly CommandDef[], query: string): CommandMatch[] {
  const tokens = queryTokens(query);
  const ranked: Ranked[] = [];

  commands.forEach((command, index) => {
    if (tokens.length === 0) {
      ranked.push({ command, score: 0, index });
      return;
    }
    let score = 0;
    for (const token of tokens) {
      const s = scoreToken(command, token);
      if (s === null) return; // one unmatched token kills the candidate
      score += s;
    }
    const q = tokens.join(' ');
    if (command.title.toLowerCase().startsWith(q) || command.id.toLowerCase().startsWith(q)) {
      score += SCORE_WHOLE_QUERY_PREFIX;
    }
    ranked.push({ command, score, index });
  });

  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked.map(({ command, score }) => ({ command, score }));
}

/** {@link rankCommands} stripped to the ranked command list. */
export function matchCommands(commands: readonly CommandDef[], query: string): CommandDef[] {
  return rankCommands(commands, query).map((m) => m.command);
}

/** Commands grouped for display, preserving rank order inside each group. */
export function groupMatches(matches: readonly CommandDef[]): Map<CommandGroup, CommandDef[]> {
  const out = new Map<CommandGroup, CommandDef[]>();
  for (const command of matches) {
    const list = out.get(command.group);
    if (list) list.push(command);
    else out.set(command.group, [command]);
  }
  return out;
}

/** Stable section order when the palette is displayed grouped. */
export const COMMAND_GROUP_ORDER: readonly CommandGroup[] = [
  'Project',
  'Edit',
  'View',
  'Tools',
  'Render',
  'Effects',
  'Theme',
  'Export',
];
