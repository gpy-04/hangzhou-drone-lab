import { clamp, setupHiDPICanvas } from './canvas-utils';
import { CODEX_ENTRIES } from './codex-data';
import type {
  GameHostAPI,
  GameInstance,
  GameMeta,
  GameModule,
  GameResult,
  LevelMeta,
  MetricSpec,
} from './game-interface';

export interface MiniGameLevel extends Omit<LevelMeta, 'index'> {
  codexId: string;
  duration: number;
  lesson: string;
  scienceAction: string;
}

export interface MiniGameButton {
  id: string;
  label: string;
  key?: string;
  tone?: 'gold' | 'danger';
  title?: string;
}

export interface MiniGamePointer {
  type: 'down' | 'move' | 'up' | 'cancel';
  x: number;
  y: number;
  button: number;
}

export interface MiniGameOutcome {
  won: boolean;
  resultKind?: GameResult['resultKind'];
  score: number;
  summary: string;
  metrics: GameResult['metrics'];
}

export interface CanvasMiniGame<State, Level extends MiniGameLevel = MiniGameLevel> {
  meta: Omit<GameMeta, 'levels' | 'codexIds'>;
  levels: Level[];
  controls: MiniGameButton[];
  createState(level: Level, index: number): State;
  update(state: State, dt: number, level: Level, time: number): void;
  draw(ctx: CanvasRenderingContext2D, state: State, level: Level, width: number, height: number, time: number): void;
  pointer?(state: State, event: MiniGamePointer, level: Level): void;
  key?(state: State, key: string, phase: 'down' | 'up', level: Level): void;
  control?(state: State, controlId: string, phase: 'down' | 'up', level: Level): void;
  metrics(state: State, level: Level, time: number): MetricSpec[];
  progress(state: State, level: Level): { current: number; total: number };
  outcome(state: State, level: Level, time: number): MiniGameOutcome | null;
  lessonToast?: boolean;
}

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 700;

/** Stable GameModule shell for genuinely different canvas-based mini-game loops. */
export function createCanvasMiniGame<State, Level extends MiniGameLevel>(
  definition: CanvasMiniGame<State, Level>
): GameModule {
  const meta: GameMeta = {
    ...definition.meta,
    levels: definition.levels.map((level, index) => ({
      index,
      name: level.name,
      subtitle: level.subtitle,
      objective: level.objective,
    })),
    codexIds: definition.levels.map((level) => level.codexId),
  };

  return {
    meta,
    mount(canvasHost, host) {
      const handle = setupHiDPICanvas(canvasHost);
      const { canvas, ctx } = handle;
      canvas.style.touchAction = 'none';
      let levelIndex = clamp(host.getLevel(), 0, definition.levels.length - 1);
      let state = definition.createState(definition.levels[levelIndex], levelIndex);
      let destroyed = false;
      let paused = host.isPaused();
      let finished = false;
      let elapsed = 0;
      let lastTs = performance.now();
      let lastHudAt = 0;
      let rafId = 0;
      let scale = 1;
      let offsetX = 0;
      let offsetY = 0;
      let touchId: number | null = null;
      const held = new Set<string>();
      const buttonEls = new Map<string, HTMLButtonElement>();

      function level(): Level {
        return definition.levels[levelIndex];
      }

      function updateTransform(): void {
        const size = handle.getSize();
        scale = Math.min(size.width / WORLD_WIDTH, size.height / WORLD_HEIGHT);
        offsetX = (size.width - WORLD_WIDTH * scale) / 2;
        offsetY = (size.height - WORLD_HEIGHT * scale) / 2;
      }

      function worldPointer(event: PointerEvent): MiniGamePointer {
        const rect = canvas.getBoundingClientRect();
        const localX = event.clientX - rect.left;
        const localY = event.clientY - rect.top;
        return {
          type: event.type === 'pointerdown' ? 'down' : event.type === 'pointermove' ? 'move' : event.type === 'pointercancel' ? 'cancel' : 'up',
          x: (localX - offsetX) / scale,
          y: (localY - offsetY) / scale,
          button: event.button,
        };
      }

      function toastLesson(): void {
        if (definition.lessonToast === false) return;
        host.hud.pushToast(`小知识 · ${level().lesson}`, 'info', '原理');
      }

      function refreshDeck(): void {
        const deck = host.hud.getTactileDeck();
        deck.replaceChildren();
        buttonEls.clear();
        for (const control of definition.controls) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = `deck-ctrl-btn${control.tone === 'gold' ? ' is-gold' : control.tone === 'danger' ? ' is-danger' : ''}`;
          btn.textContent = control.key ? `${control.label}  [${control.key}]` : control.label;
          btn.title = control.title ?? control.label;
          btn.setAttribute('aria-label', control.title ?? control.label);
          btn.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            if (paused || finished) return;
            btn.setPointerCapture?.(event.pointerId);
            btn.classList.add('is-active');
            definition.control?.(state, control.id, 'down', level());
          });
          const release = () => {
            btn.classList.remove('is-active');
            definition.control?.(state, control.id, 'up', level());
          };
          btn.addEventListener('pointerup', release);
          btn.addEventListener('pointercancel', release);
          btn.addEventListener('lostpointercapture', release);
          btn.addEventListener('click', (event) => {
            // Keyboard activation dispatches a click without pointer events.
            if (event.detail === 0 && !paused && !finished) {
              definition.control?.(state, control.id, 'down', level());
              definition.control?.(state, control.id, 'up', level());
            }
            host.audio.playClick();
          });
          deck.appendChild(btn);
          buttonEls.set(control.id, btn);
        }
      }

      function reset(): void {
        elapsed = 0;
        finished = false;
        held.clear();
        touchId = null;
        state = definition.createState(level(), levelIndex);
        host.hud.setObjective(level().objective);
        host.hud.setControlsHint(definition.meta.controlsHint);
        host.hud.setMetrics(definition.metrics(state, level(), elapsed));
        refreshDeck();
        toastLesson();
      }

      function finish(result: MiniGameOutcome): void {
        if (finished) return;
        finished = true;
        const codex = CODEX_ENTRIES.find((entry) => entry.id === level().codexId);
        const normalizedScore = clamp(Math.round(result.score), 0, 1000);
        const stars: 0 | 1 | 2 | 3 = !result.won ? 0 : normalizedScore >= 850 ? 3 : normalizedScore >= 650 ? 2 : 1;
        const completed: GameResult = {
          levelIndex,
          won: result.won,
          resultKind: result.resultKind,
          stars,
          score: normalizedScore,
          summary: result.summary,
          metrics: result.metrics,
          scienceCard: {
            title: codex?.title ?? `${meta.shortTitle} · 低空科普`,
            gameAction: level().scienceAction,
            realStationFact: codex?.summary ?? level().lesson,
            realData: codex?.realParam ?? '本关为浏览器内的教学模拟，不代表真实设备参数。',
            codexId: level().codexId,
          },
        };
        host.audio[result.won ? 'playSuccess' : 'playCritical']();
        host.completeLevel(completed);
      }

      function onPointer(event: PointerEvent): void {
        if (paused || finished || !definition.pointer) return;
        if (event.type === 'pointerdown') {
          touchId = event.pointerId;
          canvas.setPointerCapture?.(event.pointerId);
        } else if (touchId !== null && event.pointerId !== touchId) return;
        definition.pointer(state, worldPointer(event), level());
        if (event.type === 'pointerup' || event.type === 'pointercancel') touchId = null;
      }

      function onKey(event: KeyboardEvent, phase: 'down' | 'up'): void {
        const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
        const control = definition.controls.find((item) => item.key?.toLowerCase() === key.toLowerCase());
        if (phase === 'down' && control && !event.repeat && !paused && !finished) {
          definition.control?.(state, control.id, 'down', level());
          buttonEls.get(control.id)?.classList.add('is-active');
        }
        if (phase === 'up' && control) {
          definition.control?.(state, control.id, 'up', level());
          buttonEls.get(control.id)?.classList.remove('is-active');
        }
        if (!control && phase === 'down' && !event.repeat && !paused && !finished) definition.key?.(state, key, 'down', level());
        if (!control && phase === 'up') definition.key?.(state, key, 'up', level());
        if (phase === 'down') held.add(key);
        else held.delete(key);
      }

      function onKeyDown(event: KeyboardEvent): void {
        const target = event.target as HTMLElement | null;
        if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
        if (target?.closest('.hud-tactile-deck button')) return;
        onKey(event, 'down');
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Backspace'].includes(event.key)) event.preventDefault();
      }

      function onKeyUp(event: KeyboardEvent): void {
        const target = event.target as HTMLElement | null;
        if (target?.closest('.hud-tactile-deck button')) return;
        onKey(event, 'up');
      }

      function onBlur(): void {
        for (const key of [...held]) definition.key?.(state, key, 'up', level());
        held.clear();
        for (const id of buttonEls.keys()) {
          definition.control?.(state, id, 'up', level());
          buttonEls.get(id)?.classList.remove('is-active');
        }
        touchId = null;
      }

      function frame(now: number): void {
        if (destroyed) return;
        const dt = Math.min(0.04, Math.max(0, (now - lastTs) / 1000));
        lastTs = now;
        updateTransform();
        if (!paused && !finished) {
          elapsed += dt;
          definition.update(state, dt, level(), elapsed);
          const result = definition.outcome(state, level(), elapsed);
          if (result) finish(result);
          else if (elapsed >= level().duration) finish({
            won: false,
            resultKind: 'incomplete',
            score: 0,
            summary: `未完成任务：任务时间已耗尽。${level().objective}`,
            metrics: definition.metrics(state, level(), elapsed),
          });
        }
        const size = handle.getSize();
        ctx.clearRect(0, 0, size.width, size.height);
        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);
        definition.draw(ctx, state, level(), WORLD_WIDTH, WORLD_HEIGHT, elapsed);
        ctx.restore();
        if (now - lastHudAt >= 220) {
          host.hud.setMetrics(definition.metrics(state, level(), elapsed));
          lastHudAt = now;
        }
        rafId = requestAnimationFrame(frame);
      }

      canvas.addEventListener('pointerdown', onPointer);
      canvas.addEventListener('pointermove', onPointer);
      canvas.addEventListener('pointerup', onPointer);
      canvas.addEventListener('pointercancel', onPointer);
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', onBlur);
      reset();
      rafId = requestAnimationFrame(frame);

      return {
        destroy(): void {
          destroyed = true;
          cancelAnimationFrame(rafId);
          onBlur();
          canvas.removeEventListener('pointerdown', onPointer);
          canvas.removeEventListener('pointermove', onPointer);
          canvas.removeEventListener('pointerup', onPointer);
          canvas.removeEventListener('pointercancel', onPointer);
          window.removeEventListener('keydown', onKeyDown);
          window.removeEventListener('keyup', onKeyUp);
          window.removeEventListener('blur', onBlur);
          host.hud.clearTactileDeck();
          handle.destroy();
        },
        setLevel(index: number): void {
          levelIndex = clamp(index, 0, definition.levels.length - 1);
          reset();
        },
        restart(): void { reset(); },
        setPaused(value: boolean): void {
          paused = value;
          if (paused) onBlur();
          lastTs = performance.now();
        },
      };
    },
  };
}

export function drawConsoleBackdrop(ctx: CanvasRenderingContext2D, width = WORLD_WIDTH, height = WORLD_HEIGHT): void {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#08182a');
  gradient.addColorStop(0.6, '#071222');
  gradient.addColorStop(1, '#030912');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.strokeStyle = 'rgba(80, 150, 196, 0.10)';
  ctx.lineWidth = 1;
  for (let x = 20; x < width; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
  for (let y = 20; y < height; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(67, 180, 223, 0.20)';
  ctx.strokeRect(12, 12, width - 24, height - 24);
  ctx.restore();
}

export function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = '#dff7ff'): void {
  ctx.save();
  ctx.font = '600 14px "Noto Sans SC", sans-serif';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}
