import type { QuestStatus } from '../quests/types';

export type DialogEffect =
  | { readonly type: 'flag'; readonly id: string }
  | { readonly type: 'startQuest'; readonly id: string }
  | { readonly type: 'completeQuest'; readonly id: string }
  | { readonly type: 'turnIn'; readonly id: string };

export interface DialogChoice {
  readonly label: string;
  readonly next: string;
}

export interface DialogNode {
  readonly id: string;
  readonly speaker: string;
  readonly text: string;
  readonly next?: string;
  readonly choices?: readonly DialogChoice[];
  readonly effects?: readonly DialogEffect[];
}

export interface DialogCondition {
  readonly questStatus?: { readonly id: string; readonly status: QuestStatus };
  readonly storyChapter?: string;
  readonly flag?: string;
  readonly missingFlag?: string;
}

export interface DialogScript {
  readonly id: string;
  readonly npcId: string;
  readonly priority: number;
  readonly when?: DialogCondition;
  readonly start: string;
  readonly nodes: readonly DialogNode[];
}

export interface DialogContext {
  questStatus(id: string): QuestStatus | 'unknown';
  storyChapter: string;
  hasFlag(flag: string): boolean;
}

export function matchesCondition(
  condition: DialogCondition | undefined,
  context: DialogContext,
): boolean {
  if (!condition) return true;
  if (
    condition.questStatus &&
    context.questStatus(condition.questStatus.id) !== condition.questStatus.status
  ) {
    return false;
  }
  if (condition.storyChapter && context.storyChapter !== condition.storyChapter) return false;
  if (condition.flag && !context.hasFlag(condition.flag)) return false;
  if (condition.missingFlag && context.hasFlag(condition.missingFlag)) return false;
  return true;
}

/** Highest priority script for an NPC whose condition matches. */
export function selectScript(
  scripts: readonly DialogScript[],
  npcId: string,
  context: DialogContext,
): DialogScript | null {
  let best: DialogScript | null = null;
  for (const script of scripts) {
    if (script.npcId !== npcId || !matchesCondition(script.when, context)) continue;
    if (!best || script.priority > best.priority) best = script;
  }
  return best;
}

export function findNode(script: DialogScript, nodeId: string): DialogNode | undefined {
  return script.nodes.find((node) => node.id === nodeId);
}

export interface DialogStep {
  readonly node: DialogNode;
  readonly effects: readonly DialogEffect[];
}

/** Cursor over a script. `advance` returns null when the conversation ends. */
export class DialogCursor {
  readonly effects: readonly DialogEffect[];
  private current: DialogNode;

  constructor(readonly script: DialogScript) {
    const start = findNode(script, script.start);
    if (!start) throw new Error(`Dialog ${script.id} is missing start node ${script.start}`);
    this.current = start;
    this.effects = start.effects ?? [];
  }

  get node(): DialogNode {
    return this.current;
  }

  advance(choiceIndex = 0): DialogStep | null {
    const choices = this.current.choices;
    const nextId = choices && choices.length > 0 ? choices[choiceIndex]?.next : this.current.next;
    if (!nextId) return null;
    const next = findNode(this.script, nextId);
    if (!next) return null;
    this.current = next;
    return { node: next, effects: next.effects ?? [] };
  }
}
