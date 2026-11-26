import { CODEX_ENTRIES } from './codex-data';
import type { GameId } from './game-interface';
import type { PerfPreference } from './perf-profile';

export interface GameProgressRecord {
  stars: [number, number, number];
  bestScores: [number, number, number];
  seenBriefing: boolean;
}

export interface SaveState {
  version: number;
  games: Record<GameId, GameProgressRecord>;
  unlockedCodex: string[];
  muted: boolean;
  perfMode?: PerfPreference;
}

// Keep Hangzhou drone progress separate from the original Tiangong orbital-lab save.
const STORAGE_KEY = 'hangzhou_drone_lab_save_v1';
const SAVE_VERSION = 2;

const ALL_GAME_IDS: GameId[] = [
  'docking',
  'solar',
  'eva',
  'robotic-arm',
  'eclss',
  'debris',
  'botany',
  'zero-g-lab',
];

const CODEX_IDS = new Set(CODEX_ENTRIES.map((entry) => entry.id));
const DEFAULT_UNLOCKED_CODEX = [
  'docking-flight-basics',
  'solar-route-safe-corridors',
  'eva-survey-grid',
  'zero-g-airspace-capacity',
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readBoundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function createDefaultState(): SaveState {
  const games = {} as Record<GameId, GameProgressRecord>;
  for (const id of ALL_GAME_IDS) {
    games[id] = {
      stars: [0, 0, 0],
      bestScores: [0, 0, 0],
      seenBriefing: false,
    };
  }
  return {
    version: SAVE_VERSION,
    games,
    unlockedCodex: [...DEFAULT_UNLOCKED_CODEX],
    muted: false,
    perfMode: 'auto',
  };
}

function readTriplet(value: unknown, max: number): [number, number, number] {
  const values = Array.isArray(value) ? value : [];
  return [
    readBoundedInteger(values[0], 0, 0, max),
    readBoundedInteger(values[1], 0, 0, max),
    readBoundedInteger(values[2], 0, 0, max),
  ];
}

export class SaveStore {
  private state: SaveState;
  private listeners = new Set<() => void>();

  constructor() {
    this.state = this.load();
  }

  private load(): SaveState {
    const fallback = createDefaultState();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;

      const parsed = asRecord(JSON.parse(raw));
      if (!parsed) return fallback;

      const merged = createDefaultState();
      const savedGames = asRecord(parsed.games);
      if (savedGames) {
        for (const id of ALL_GAME_IDS) {
          const savedGame = asRecord(savedGames[id]);
          if (!savedGame) continue;
          merged.games[id] = {
            stars: readTriplet(savedGame.stars, 3),
            bestScores: readTriplet(savedGame.bestScores, 1_000_000_000),
            seenBriefing: readBoolean(savedGame.seenBriefing, false),
          };
        }
      }

      const savedCodex = Array.isArray(parsed.unlockedCodex)
        ? parsed.unlockedCodex.filter(
            (id): id is string => typeof id === 'string' && CODEX_IDS.has(id)
          )
        : [];
      merged.unlockedCodex = Array.from(new Set([...DEFAULT_UNLOCKED_CODEX, ...savedCodex]));
      merged.muted = readBoolean(parsed.muted, false);
      if (parsed.perfMode === 'auto' || parsed.perfMode === 'high' || parsed.perfMode === 'low') {
        merged.perfMode = parsed.perfMode as PerfPreference;
      }
      return merged;
    } catch {
      // Storage can be unavailable in private browsing, and saved JSON may be malformed.
      return fallback;
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Ignore storage quota / private-mode failures; the current session remains playable.
    }
    this.listeners.forEach((fn) => fn());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getGameProgress(id: GameId): GameProgressRecord {
    return this.state.games[id];
  }

  getGameStars(id: GameId): number {
    const s = this.state.games[id].stars;
    return s[0] + s[1] + s[2];
  }

  isGameCleared(id: GameId): boolean {
    return this.getGameStars(id) > 0;
  }

  getTotalStars(): number {
    return ALL_GAME_IDS.reduce((acc, id) => acc + this.getGameStars(id), 0);
  }

  getClearedGamesCount(): number {
    return ALL_GAME_IDS.filter((id) => this.isGameCleared(id)).length;
  }

  /** Returns the city readiness score (0–100) for the existing hub UI API. */
  getStationReadiness(): number {
    return Math.round(25 + (this.getTotalStars() / 72) * 75);
  }

  recordLevelResult(id: GameId, levelIndex: number, stars: number, score: number): void {
    const rec = this.state.games[id];
    const idx = Math.max(0, Math.min(2, Math.round(levelIndex)));
    const safeStars = readBoundedInteger(stars, 0, 0, 3);
    const safeScore = readBoundedInteger(score, 0, 0, 1_000_000_000);
    if (safeStars > rec.stars[idx]) rec.stars[idx] = safeStars;
    if (safeScore > rec.bestScores[idx]) rec.bestScores[idx] = safeScore;
    this.persist();
  }

  markBriefingSeen(id: GameId): void {
    if (!this.state.games[id].seenBriefing) {
      this.state.games[id].seenBriefing = true;
      this.persist();
    }
  }

  isCodexUnlocked(codexId: string): boolean {
    return CODEX_IDS.has(codexId) && this.state.unlockedCodex.includes(codexId);
  }

  unlockCodex(codexId: string): void {
    if (!CODEX_IDS.has(codexId) || this.state.unlockedCodex.includes(codexId)) return;
    this.state.unlockedCodex.push(codexId);
    this.persist();
  }

  getUnlockedCodexCount(): number {
    return this.state.unlockedCodex.length;
  }

  isMuted(): boolean {
    return this.state.muted;
  }

  setMuted(muted: boolean): void {
    this.state.muted = muted;
    this.persist();
  }

  getPerfMode(): PerfPreference {
    return this.state.perfMode ?? 'auto';
  }

  setPerfMode(mode: PerfPreference): void {
    this.state.perfMode = mode;
    this.persist();
  }
}
