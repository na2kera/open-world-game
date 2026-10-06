import type { QuestSaveData } from '../save/SaveData';
import type { QuestChange, QuestDef, QuestEvent, QuestObjective, QuestStatus } from './types';

interface Runtime {
  counts: number[];
  status: 'active' | 'readyToTurnIn' | 'completed';
}

/** Pure quest state. Callers apply rewards and publish the returned changes. */
export class QuestManager {
  private readonly defs: ReadonlyMap<string, QuestDef>;
  private readonly entries = new Map<string, Runtime>();
  private tracked: string | null = null;

  constructor(definitions: readonly QuestDef[]) {
    this.defs = new Map(definitions.map((def) => [def.id, def]));
  }

  reset(): void {
    this.entries.clear();
    this.tracked = null;
  }

  /** Quest the HUD guides toward: an unfinished main quest first, then the last side quest. */
  get trackedId(): string | null {
    return this.resolveTracked();
  }

  definition(id: string): QuestDef | undefined {
    return this.defs.get(id);
  }

  status(id: string): QuestStatus {
    const runtime = this.entries.get(id);
    if (runtime) return runtime.status;
    const def = this.defs.get(id);
    if (!def || !this.prerequisitesMet(def)) return 'locked';
    return 'available';
  }

  /** `!` when this NPC can give a quest, `?` when one is ready to report. */
  markerFor(npcId: string): '!' | '?' | null {
    let offer = false;
    let report = false;
    for (const def of this.defs.values()) {
      if (def.giverNpcId !== npcId) continue;
      const status = this.status(def.id);
      if (status === 'available') offer = true;
      if (status === 'readyToTurnIn') report = true;
    }
    if (report) return '?';
    if (offer) return '!';
    return null;
  }

  /** Starts a quest. `force` ignores availability and is used by the main story. */
  start(id: string, force = false): QuestChange[] {
    const def = this.defs.get(id);
    if (!def || this.entries.has(id)) return [];
    if (!force && this.status(id) !== 'available') return [];
    this.entries.set(id, {
      counts: def.objectives.map(() => 0),
      status: 'active',
    });
    this.tracked = id;
    return [{ type: 'started', questId: id, remove: [] }];
  }

  /** Forces completion. Used when a dialog resolves a talk objective. */
  complete(id: string): QuestChange[] {
    const def = this.defs.get(id);
    const runtime = this.entries.get(id);
    if (!def || !runtime || runtime.status === 'completed') return [];
    return [this.finish(def, runtime)];
  }

  /** Accepts a ready-to-report quest and returns its reward. */
  turnIn(id: string): QuestChange[] {
    const def = this.defs.get(id);
    const runtime = this.entries.get(id);
    if (!def || !runtime || runtime.status !== 'readyToTurnIn') return [];
    return [this.finish(def, runtime)];
  }

  setTracked(id: string | null): void {
    if (id !== null && !this.entries.has(id)) return;
    this.tracked = id;
  }

  apply(event: QuestEvent): QuestChange[] {
    const changes: QuestChange[] = [];
    for (const [id, runtime] of this.entries) {
      if (runtime.status !== 'active') continue;
      const def = this.defs.get(id);
      if (!def) continue;
      let changed = false;
      for (let index = 0; index < def.objectives.length; index++) {
        const objective = def.objectives[index];
        if (!objective) continue;
        if (def.sequential && index !== firstIncomplete(def.objectives, runtime.counts)) break;
        const before = runtime.counts[index] ?? 0;
        const next = advanceObjective(objective, before, event);
        if (next !== before) {
          runtime.counts[index] = next;
          changed = true;
        }
        if (def.sequential) break;
      }
      if (changed) changes.push(...this.refresh(id));
    }
    return changes;
  }

  syncOwned(getCount: (itemId: string) => number): QuestChange[] {
    const itemIds = new Set<string>();
    for (const def of this.defs.values()) {
      for (const objective of def.objectives) {
        if (objective.kind === 'collect') itemIds.add(objective.itemId);
      }
    }
    const changes: QuestChange[] = [];
    for (const itemId of itemIds) {
      changes.push(...this.apply({ type: 'collect', itemId, owned: getCount(itemId) }));
    }
    return changes;
  }

  objectiveLine(): string {
    const id = this.resolveTracked();
    const def = id ? this.defs.get(id) : undefined;
    const runtime = id ? this.entries.get(id) : undefined;
    if (!id || !def || !runtime || runtime.status === 'completed') return '自由に探索しよう';
    if (runtime.status === 'readyToTurnIn') return `${def.title}：報告する`;
    const index = firstIncomplete(def.objectives, runtime.counts);
    const objective = def.objectives[index] ?? def.objectives[0];
    return objective ? `${def.title}：${objective.label}` : def.title;
  }

  /** Location id of the current tracked step, when it points somewhere. */
  trackedLocationId(): string | null {
    const id = this.resolveTracked();
    const def = id ? this.defs.get(id) : undefined;
    const runtime = id ? this.entries.get(id) : undefined;
    if (!def || !runtime || runtime.status === 'completed') return null;
    if (runtime.status === 'readyToTurnIn') return `npc:${def.giverNpcId}`;
    const index = firstIncomplete(def.objectives, runtime.counts);
    return locationIdOf(def.objectives[index]);
  }

  journalLines(): string[] {
    const lines: string[] = [];
    for (const def of this.defs.values()) {
      const status = this.status(def.id);
      if (status === 'locked') continue;
      const runtime = this.entries.get(def.id);
      const mark =
        status === 'completed'
          ? '済'
          : status === 'readyToTurnIn'
            ? '!'
            : status === 'active'
              ? '…'
              : '新';
      lines.push(`[${mark}] ${def.title}`);
      lines.push(def.description);
      if (runtime && status !== 'completed' && status !== 'available') {
        def.objectives.forEach((objective, index) => {
          const count = runtime.counts[index] ?? 0;
          lines.push(
            `  ${objective.label}（${Math.min(count, targetOf(objective))}/${targetOf(objective)}）`,
          );
        });
      }
    }
    return lines.length > 0 ? lines : ['まだ依頼はない'];
  }

  toJSON(): QuestSaveData {
    const started: { id: string; counts: number[] }[] = [];
    const active: string[] = [];
    const completed: string[] = [];
    for (const [id, runtime] of this.entries) {
      started.push({ id, counts: [...runtime.counts] });
      if (runtime.status === 'completed') completed.push(id);
      else active.push(id);
    }
    const data: QuestSaveData = { active, completed, started };
    return this.tracked ? { ...data, trackedId: this.tracked } : data;
  }

  restore(data: QuestSaveData): void {
    this.reset();
    for (const entry of data.started ?? []) {
      const def = this.defs.get(entry.id);
      if (!def) continue;
      const counts = def.objectives.map((_, index) => entry.counts[index] ?? 0);
      this.entries.set(entry.id, { counts, status: 'active' });
      this.refresh(entry.id);
    }
    for (const id of data.completed ?? []) {
      const def = this.defs.get(id);
      if (!def) continue;
      this.entries.set(id, {
        counts: def.objectives.map((objective) => targetOf(objective)),
        status: 'completed',
      });
    }
    if (data.trackedId && this.entries.has(data.trackedId)) this.tracked = data.trackedId;
  }

  /**
   * The main story always wins over side quests, so starting or finishing a side quest cannot
   * hide the main objective. `tracked` only remembers the preferred side quest in between.
   */
  private resolveTracked(): string | null {
    const preferred = this.tracked ? this.entries.get(this.tracked) : undefined;
    const preferredIsMain = this.tracked ? this.defs.get(this.tracked)?.type === 'main' : false;
    if (preferred && preferredIsMain && preferred.status !== 'completed') return this.tracked;
    for (const [id, runtime] of this.entries) {
      if (runtime.status !== 'completed' && this.defs.get(id)?.type === 'main') return id;
    }
    if (preferred && preferred.status !== 'completed') return this.tracked;
    let latest: string | null = null;
    for (const [id, runtime] of this.entries) {
      if (runtime.status !== 'completed') latest = id;
    }
    return latest;
  }

  private prerequisitesMet(def: QuestDef): boolean {
    return (def.requiresCompleted ?? []).every((id) => this.status(id) === 'completed');
  }

  private refresh(id: string): QuestChange[] {
    const def = this.defs.get(id);
    const runtime = this.entries.get(id);
    if (!def || !runtime || runtime.status === 'completed') return [];
    const done = def.objectives.every(
      (objective, index) => (runtime.counts[index] ?? 0) >= targetOf(objective),
    );
    if (!done) {
      runtime.status = 'active';
      return [{ type: 'progress', questId: id, remove: [] }];
    }
    if (def.turnIn) {
      runtime.status = 'readyToTurnIn';
      return [{ type: 'ready', questId: id, remove: [] }];
    }
    return [this.finish(def, runtime)];
  }

  private finish(def: QuestDef, runtime: Runtime): QuestChange {
    runtime.status = 'completed';
    runtime.counts = def.objectives.map((objective) => targetOf(objective));
    const remove: { itemId: string; count: number }[] = [];
    for (const objective of def.objectives) {
      if (objective.kind === 'collect')
        remove.push({ itemId: objective.itemId, count: objective.count });
    }
    const change: QuestChange = { type: 'completed', questId: def.id, remove };
    return def.reward ? { ...change, reward: def.reward } : change;
  }
}

function targetOf(objective: QuestObjective): number {
  if (
    objective.kind === 'collect' ||
    objective.kind === 'kill' ||
    objective.kind === 'clearCamps'
  ) {
    return objective.count;
  }
  return 1;
}

function firstIncomplete(objectives: readonly QuestObjective[], counts: readonly number[]): number {
  const index = objectives.findIndex((objective, i) => (counts[i] ?? 0) < targetOf(objective));
  return index === -1 ? objectives.length : index;
}

function locationIdOf(objective: QuestObjective | undefined): string | null {
  if (!objective) return null;
  switch (objective.kind) {
    case 'activateTower':
      return objective.towerId;
    case 'reach':
      return objective.locationId;
    case 'talk':
      return `npc:${objective.npcId}`;
    case 'defeatBoss':
      return 'arena';
    default:
      return null;
  }
}

function advanceObjective(objective: QuestObjective, before: number, event: QuestEvent): number {
  const target = targetOf(objective);
  switch (objective.kind) {
    case 'collect':
      return event.type === 'collect' && event.itemId === objective.itemId
        ? Math.min(target, event.owned)
        : before;
    case 'kill':
      return event.type === 'kill' && event.enemyDefId === objective.enemyDefId
        ? Math.min(target, before + 1)
        : before;
    case 'clearCamps':
      return event.type === 'clearCamps' ? Math.min(target, before + 1) : before;
    case 'talk':
      return event.type === 'talk' && event.npcId === objective.npcId ? 1 : before;
    case 'reach':
      return event.type === 'reach' && event.locationId === objective.locationId ? 1 : before;
    case 'activateTower':
      return event.type === 'activateTower' && event.towerId === objective.towerId ? 1 : before;
    case 'defeatBoss':
      return event.type === 'defeatBoss' && event.bossId === objective.bossId ? 1 : before;
    default:
      return before;
  }
}
