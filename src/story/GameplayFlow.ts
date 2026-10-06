import { Vector3, type Group } from 'three';

import { TOWER_REVEAL_RADIUS, VILLAGE_REVEAL_RADIUS } from '../config';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { GameState } from '../core/GameState';
import type { System } from '../core/System';
import { DIALOG_SCRIPTS, INTRO_SCRIPT } from '../data/dialogs';
import { getEnemyDef } from '../data/enemies';
import { QUEST_DEFS } from '../data/quests';
import { selectScript, type DialogContext, type DialogEffect } from '../dialog/DialogRuntime';
import { Enemy } from '../entities/Enemy';
import { Npc } from '../entities/Npc';
import type { Interactable } from '../items/Interactable';
import type { InteractionSystem } from '../items/InteractionSystem';
import type { Inventory } from '../items/Inventory';
import type { PlayerController } from '../player/PlayerController';
import { QuestManager } from '../quests/QuestManager';
import type { QuestChange } from '../quests/types';
import type { Hud } from '../ui/Hud';
import type { DialogBox } from '../ui/DialogBox';
import type { MinimapMarker } from '../ui/Minimap';
import type { WorldLabelLayer } from '../ui/WorldLabelLayer';
import type { Landmarks, TowerSite } from '../world/SiteMeshes';
import type { PlacedPoint } from '../world/landmarkPlacement';
import type { Terrain, Vec3Like } from '../world/Terrain';
import { StoryManager, storyAfterQuest, type StoryPoint } from './StoryManager';

const SHRINE_RADIUS = 8;
const ARENA_RADIUS = 14;

export interface TravelPoint {
  readonly id: string;
  readonly label: string;
}

export interface GameplayFlowDeps {
  readonly bus: EventBus<GameEvents>;
  readonly state: GameState;
  readonly player: PlayerController;
  readonly inventory: Inventory;
  readonly terrain: Terrain;
  readonly enemyGroup: Group;
  readonly labels: WorldLabelLayer;
  readonly interactions: InteractionSystem;
  readonly hud: Hud;
  readonly landmarks: Landmarks;
  readonly spawn: Readonly<Vec3Like>;
  readonly dialog: DialogBox;
  readonly save: () => void;
  readonly resetCamera: () => void;
}

/** Connects dialogs, quests, towers, the boss and the objective guide. */
export class GameplayFlow implements System {
  readonly quests = new QuestManager(QUEST_DEFS);
  readonly story = new StoryManager();
  readonly npcs: Npc[] = [];
  private readonly towers: readonly TowerSite[];
  private readonly shrine: PlacedPoint;
  private readonly arena: PlacedPoint;
  private boss: Enemy | null = null;
  private shrineVisited = false;
  private readonly unsubscribers: (() => void)[] = [];

  constructor(private readonly deps: GameplayFlowDeps) {
    const built = deps.landmarks.build(deps.spawn);
    this.towers = built.towers;
    this.shrine = built.shrine;
    this.arena = built.arena;
    for (const spot of built.npcs) {
      const npc = new Npc({
        ...spot,
        parent: deps.landmarks.group,
        labels: deps.labels,
        onTalk: (talker) => this.talk(talker),
      });
      this.npcs.push(npc);
      deps.interactions.register(npc);
    }
    for (const tower of this.towers) {
      deps.interactions.register(this.towerInteractable(tower));
    }
    deps.interactions.register(this.shrineInteractable());
    this.unsubscribers.push(
      deps.bus.on('enemy:killed', ({ defId }) => {
        if (defId === 'blight-lord') {
          deps.bus.emit('boss:defeated', { bossId: defId });
          this.publish(this.quests.apply({ type: 'defeatBoss', bossId: defId }));
          return;
        }
        this.publish(this.quests.apply({ type: 'kill', enemyDefId: defId }));
      }),
      deps.bus.on('camp:cleared', () => {
        this.publish(this.quests.apply({ type: 'clearCamps' }));
      }),
      deps.bus.on('item:acquired', ({ itemId }) => {
        this.publish(
          this.quests.apply({ type: 'collect', itemId, owned: deps.inventory.count(itemId) }),
        );
      }),
    );
    this.refreshPresentation();
  }

  get extraEnemies(): readonly Enemy[] {
    return this.boss?.isAlive ? [this.boss] : [];
  }

  onNewGame(): void {
    this.story.reset();
    this.quests.reset();
    this.clearBoss();
    this.shrineVisited = false;
    this.story.setRespawn(this.deps.spawn);
    this.deps.landmarks.resetTowers();
    this.publish(this.quests.start('main-wake', true));
    this.deps.dialog.play(INTRO_SCRIPT, (effects) => this.applyEffects(effects));
    this.refreshPresentation();
  }

  /** Restores visuals after a save is applied. Does not open dialog. */
  onRestored(): void {
    this.clearBoss();
    this.shrineVisited = this.quests.status('side-shrine') === 'completed';
    for (const tower of this.towers) {
      if (this.story.hasTower(tower.id)) this.deps.landmarks.setTowerActive(tower.id);
    }
    this.publish(this.quests.syncOwned((itemId) => this.deps.inventory.count(itemId)));
    this.refreshPresentation();
  }

  journalLines(): readonly string[] {
    return this.quests.journalLines();
  }

  travelPoints(): readonly TravelPoint[] {
    const points: TravelPoint[] = [{ id: 'village', label: '始まりの里' }];
    for (const tower of this.towers) {
      if (!this.story.hasTower(tower.id)) continue;
      points.push({ id: tower.id, label: towerLabel(tower.id) });
    }
    return points;
  }

  travel(id: string): void {
    const point = this.pointFor(id);
    if (!point) return;
    this.deps.player.placeAt(point);
    this.story.setRespawn(point);
    this.deps.resetCamera();
  }

  frameUpdate(): void {
    if (!this.deps.state.isSimulating) {
      this.updateBossBar();
      return;
    }
    this.touchShrine();
    this.maybeSpawnBoss();
    this.refreshPresentation();
    this.updateBossBar();
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.clearBoss();
  }

  private talk(npc: Npc): void {
    if (this.deps.dialog.isOpen) return;
    npc.lookAt(this.deps.player.position.x, this.deps.player.position.z);
    const script = selectScript(DIALOG_SCRIPTS, npc.id, this.dialogContext());
    if (!script) return;
    this.deps.dialog.play(script, (effects) => this.applyEffects(effects));
  }

  private dialogContext(): DialogContext {
    return {
      questStatus: (id) => this.quests.status(id),
      storyChapter: this.story.chapter,
      hasFlag: (flag) => this.story.hasFlag(flag),
    };
  }

  private applyEffects(effects: readonly DialogEffect[]): void {
    const changes: QuestChange[] = [];
    for (const effect of effects) {
      switch (effect.type) {
        case 'flag':
          this.story.setFlag(effect.id);
          break;
        case 'startQuest':
          changes.push(...this.quests.start(effect.id));
          break;
        case 'completeQuest':
          changes.push(...this.quests.complete(effect.id));
          break;
        case 'turnIn':
          changes.push(...this.quests.turnIn(effect.id));
          break;
        default:
          break;
      }
    }
    this.publish(changes);
  }

  private publish(changes: readonly QuestChange[]): void {
    for (const change of changes) {
      const title = this.quests.definition(change.questId)?.title ?? change.questId;
      if (change.type === 'started') {
        this.deps.hud.showBanner(`${title} 開始`);
        this.deps.bus.emit('quest:started', { questId: change.questId });
      } else if (change.type === 'progress') {
        this.deps.bus.emit('quest:progress', { questId: change.questId });
      } else if (change.type === 'ready') {
        this.deps.hud.showBanner('報告できる');
        this.deps.bus.emit('quest:readyToTurnIn', { questId: change.questId });
      } else if (change.type === 'completed') {
        this.applyReward(change);
        this.deps.hud.showBanner(`${title} 完了`);
        this.deps.bus.emit('quest:completed', { questId: change.questId });
        const next = storyAfterQuest(this.story.chapter, change.questId);
        if (next !== this.story.chapter) {
          this.story.setChapter(next);
          this.deps.bus.emit('story:chapter', { chapterId: next });
          if (next === 'towers') {
            this.publish(this.quests.start('main-towers', true));
            this.publish(this.quests.start('side-shrine'));
          } else if (next === 'boss') {
            this.publish(this.quests.start('main-boss', true));
          } else if (next === 'report') {
            this.publish(this.quests.start('main-report', true));
          }
        }
        this.deps.save();
      }
    }
    this.refreshPresentation();
  }

  private applyReward(change: QuestChange): void {
    for (const item of change.remove) this.deps.inventory.remove(item.itemId, item.count);
    const reward = change.reward;
    if (!reward) return;
    for (const item of reward.items ?? []) this.deps.inventory.add(item.itemId, item.count);
    if (reward.maxHp) {
      this.deps.player.stats.maxHp += reward.maxHp;
      this.deps.player.heal(reward.maxHp);
    }
    if (reward.maxStamina) {
      const next = this.deps.player.stats.maxStamina + reward.maxStamina;
      this.deps.player.stats.maxStamina = next;
      this.deps.player.stamina.setMax(next);
      this.deps.player.stamina.refill();
    }
  }

  private activateTower(tower: TowerSite): void {
    if (!this.story.activateTower(tower.id)) return;
    this.deps.landmarks.setTowerActive(tower.id);
    const point = { x: tower.terminalX, y: tower.terminalY, z: tower.terminalZ };
    this.story.setRespawn(point);
    this.deps.hud.showBanner('塔が目覚めた');
    this.deps.bus.emit('tower:activated', { towerId: tower.id });
    this.deps.save();
    this.publish(this.quests.apply({ type: 'activateTower', towerId: tower.id }));
  }

  private touchShrine(): void {
    if (this.shrineVisited || this.quests.status('side-shrine') !== 'active') return;
    const player = this.deps.player.position;
    if (Math.hypot(player.x - this.shrine.x, player.z - this.shrine.z) > SHRINE_RADIUS) return;
    this.shrineVisited = true;
    this.story.setRespawn({ x: this.shrine.x, y: this.shrine.y, z: this.shrine.z });
    this.publish(this.quests.apply({ type: 'reach', locationId: 'shrine' }));
  }

  private maybeSpawnBoss(): void {
    if (this.boss?.isAlive || this.quests.status('main-boss') !== 'active') return;
    const player = this.deps.player.position;
    if (Math.hypot(player.x - this.arena.x, player.z - this.arena.z) > ARENA_RADIUS) return;
    const def = getEnemyDef('blight-lord');
    if (!def) return;
    this.deps.hud.showBanner('禍の王');
    this.boss = new Enemy({
      id: 'boss:blight-lord',
      def,
      x: this.arena.x,
      z: this.arena.z,
      terrain: this.deps.terrain,
      player: this.deps.player,
      bus: this.deps.bus,
      labels: this.deps.labels,
      onFinishedDeath: (enemy) => {
        enemy.dispose();
        if (this.boss === enemy) this.boss = null;
      },
    });
    this.boss.setActive(true, this.deps.enemyGroup);
  }

  private refreshPresentation(): void {
    for (const npc of this.npcs) npc.setMark(this.quests.markerFor(npc.id));
    const line = this.quests.objectiveLine();
    const guide = this.locate(this.quests.trackedLocationId());
    this.deps.landmarks.setGuide(guide);
    if (!guide) {
      this.deps.hud.setObjective(line);
    } else {
      const distance = Math.hypot(
        guide.x - this.deps.player.position.x,
        guide.z - this.deps.player.position.z,
      );
      this.deps.hud.setObjective(`${line}  ${Math.round(distance)}m`);
    }
    this.deps.hud.setMapReveals(this.revealCircles());
  }

  private updateBossBar(): void {
    const boss = this.boss;
    if (!boss?.isAlive) {
      this.deps.hud.setBoss(null, 0, 1);
      return;
    }
    this.deps.hud.setBoss(boss.def.name, boss.hp, boss.def.hp);
  }

  markers(): MinimapMarker[] {
    const markers: MinimapMarker[] = [];
    for (const tower of this.towers) {
      markers.push({
        id: `tower:${tower.id}`,
        x: tower.x,
        z: tower.z,
        color: this.story.hasTower(tower.id) ? '#f2d276' : '#7ec8ff',
        shape: 'diamond',
      });
    }
    markers.push({
      id: 'shrine',
      x: this.shrine.x,
      z: this.shrine.z,
      color: '#d7fff2',
      shape: 'diamond',
    });
    const guide = this.locate(this.quests.trackedLocationId());
    if (guide) {
      markers.push({
        id: 'quest-target',
        x: guide.x,
        z: guide.z,
        color: '#ffe08a',
        shape: 'quest',
      });
    }
    if (this.quests.status('main-boss') === 'active') {
      markers.push({
        id: 'arena',
        x: this.arena.x,
        z: this.arena.z,
        color: '#e84242',
        shape: 'quest',
      });
    }
    return markers;
  }

  private revealCircles(): { x: number; z: number; radius: number }[] {
    const circles = [
      {
        x: this.deps.spawn.x,
        z: this.deps.spawn.z,
        radius: VILLAGE_REVEAL_RADIUS,
      },
    ];
    for (const tower of this.towers) {
      if (!this.story.hasTower(tower.id)) continue;
      circles.push({ x: tower.x, z: tower.z, radius: TOWER_REVEAL_RADIUS });
    }
    return circles;
  }

  private locate(id: string | null): StoryPoint | null {
    if (!id) return null;
    if (id.startsWith('npc:')) {
      const npc = this.npcs.find((candidate) => candidate.id === id.slice(4));
      return npc ? { x: npc.position.x, y: npc.position.y, z: npc.position.z } : null;
    }
    if (id === 'shrine') return this.shrine;
    if (id === 'arena') return this.arena;
    const tower = this.towers.find((candidate) => candidate.id === id);
    return tower ? { x: tower.x, y: tower.y, z: tower.z } : null;
  }

  private pointFor(id: string): StoryPoint | null {
    if (id === 'village')
      return { x: this.deps.spawn.x, y: this.deps.spawn.y, z: this.deps.spawn.z };
    const tower = this.towers.find((candidate) => candidate.id === id);
    return tower ? { x: tower.terminalX, y: tower.terminalY, z: tower.terminalZ } : null;
  }

  private towerInteractable(tower: TowerSite): Interactable {
    const position = new Vector3(tower.terminalX, tower.terminalY, tower.terminalZ);
    return {
      position,
      radius: 1.4,
      promptLabel: '起動',
      isAvailable: () => !this.story.hasTower(tower.id),
      interact: () => this.activateTower(tower),
    };
  }

  private shrineInteractable(): Interactable {
    const position = new Vector3(this.shrine.x, this.shrine.y, this.shrine.z);
    return {
      position,
      radius: 1.8,
      promptLabel: '調べる',
      isAvailable: () => true,
      interact: () => {
        if (this.quests.status('side-shrine') === 'active') this.touchShrine();
        else this.deps.hud.enqueueToast('風化した祠だ。台座だけが残っている。');
      },
    };
  }

  private clearBoss(): void {
    this.boss?.dispose();
    this.boss = null;
  }
}

function towerLabel(id: string): string {
  if (id === 'tower-0') return '東の塔';
  if (id === 'tower-1') return '北の塔';
  if (id === 'tower-2') return '西の塔';
  return id;
}
