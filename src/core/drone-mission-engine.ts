import { clamp, dist, setupHiDPICanvas } from './canvas-utils';
import { CODEX_ENTRIES } from './codex-data';
import type { GameHostAPI, GameInstance, GameMeta, GameModule, GameResult } from './game-interface';

export type DroneMissionMode =
  | 'flight'
  | 'routing'
  | 'survey'
  | 'inspection'
  | 'rescue'
  | 'swarm'
  | 'logistics'
  | 'dispatch';

export interface DronePoint {
  x: number;
  y: number;
  label: string;
}

export interface DroneZone {
  x: number;
  y: number;
  r: number;
  label: string;
}

export interface DroneLevelConfig {
  name: string;
  subtitle: string;
  objective: string;
  codexId: string;
  duration: number;
  battery: number;
  wind: number;
  points: DronePoint[];
  restrictedZones?: DroneZone[];
}

export interface DroneGameDefinition {
  mode: DroneMissionMode;
  meta: Omit<GameMeta, 'levels' | 'codexIds'>;
  levels: DroneLevelConfig[];
}

const WORLD_W = 1000;
const WORLD_H = 700;
const HOME = { x: 116, y: 566 };
const KEY_VECTOR: Record<string, { x: number; y: number }> = {
  w: { x: 0, y: -1 }, ArrowUp: { x: 0, y: -1 },
  s: { x: 0, y: 1 }, ArrowDown: { x: 0, y: 1 },
  a: { x: -1, y: 0 }, ArrowLeft: { x: -1, y: 0 },
  d: { x: 1, y: 0 }, ArrowRight: { x: 1, y: 0 },
};

interface Drone {
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  route: { x: number; y: number }[];
  routeIndex: number;
  assignedTarget: number;
}

const pointToWorld = (p: DronePoint) => ({ x: p.x * WORLD_W, y: p.y * WORLD_H });

/** Builds one stable GameModule adapter around the shared low-altitude mission runtime. */
export function createDroneGameModule(definition: DroneGameDefinition): GameModule {
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
      return mountDroneMission(canvasHost, host, { ...definition, meta });
    },
  };
}

function mountDroneMission(
  canvasHost: HTMLElement,
  host: GameHostAPI,
  definition: DroneGameDefinition & { meta: GameMeta }
): GameInstance {
  const handle = setupHiDPICanvas(canvasHost);
  const { canvas, ctx } = handle;
  const keys = new Set<string>();
  let levelIndex = clamp(host.getLevel(), 0, definition.levels.length - 1);
  let paused = host.isPaused();
  let physicsOverlay = host.hud.isPhysicsOverlayEnabled();
  let destroyed = false;
  let finished = false;
  let rafId = 0;
  let lastTs = performance.now();
  let lastHudAt = 0;
  let elapsed = 0;
  let battery = 100;
  let score = 0;
  let drones: Drone[] = [];
  let selectedDrone = 0;
  let targetIndex = 0;
  let selectedPoint = -1;
  let currentDispatch = -1;
  let delivered = new Set<number>();
  let captured = new Set<number>();
  let route: { x: number; y: number }[] = [];
  let routeIndex = 0;
  let routeActive = false;
  let routeRecommended = false;
  let routeObjectiveIndices = new Map<number, number>();
  let payloadLoaded = false;
  let returningHome = false;
  let actionHeld = false;
  let actionCooldown = 0;
  let scanProgress = 0;
  let collisionCount = 0;
  let toastCooldown = 0;

  const config = () => definition.levels[levelIndex];
  const points = () => config().points.map(pointToWorld);
  const activeDrone = () => drones[Math.min(selectedDrone, drones.length - 1)];
  const modeName: Record<DroneMissionMode, string> = {
    flight: '飞控训练', routing: '航线规划', survey: '航测建模', inspection: 'AI视觉巡检',
    rescue: '汛情救援', swarm: '机群协同', logistics: '低空物流', dispatch: '指挥调度',
  };

  function reset(): void {
    const level = config();
    elapsed = 0;
    battery = level.battery;
    score = 0;
    selectedDrone = 0;
    targetIndex = 0;
    selectedPoint = -1;
    currentDispatch = -1;
    delivered = new Set();
    captured = new Set();
    route = [];
    routeIndex = 0;
    routeActive = false;
    routeRecommended = false;
    routeObjectiveIndices = new Map();
    payloadLoaded = false;
    returningHome = false;
    actionHeld = false;
    actionCooldown = 0;
    scanProgress = 0;
    collisionCount = 0;
    finished = false;
    keys.clear();
    const droneCount = definition.mode === 'swarm' ? (levelIndex === 0 ? 2 : 3) : definition.mode === 'dispatch' ? 3 : 1;
    drones = Array.from({ length: droneCount }, (_, i) => ({
      x: HOME.x + i * 24,
      y: HOME.y - i * 10,
      vx: 0,
      vy: 0,
      heading: -0.4,
      route: [],
      routeIndex: 0,
      assignedTarget: -1,
    }));
    host.hud.setObjective(level.objective);
    host.hud.setMetrics([
      { id: 'battery', label: '电池余量', value: `${Math.round(battery)}%`, ratio: battery / 100, status: 'nominal' },
      { id: 'mission', label: '任务进度', value: `0 / ${targetCount()}`, ratio: 0, status: 'info' },
      { id: 'wind', label: '风场强度', value: level.wind.toFixed(1), status: level.wind > 0.45 ? 'caution' : 'nominal' },
      { id: 'safety', label: '飞行安全', value: '安全', status: 'nominal' },
    ]);
    host.hud.setControlsHint(definition.meta.controlsHint);
    buildDeck();
  }

  function targetCount(): number {
    return config().points.length;
  }

  function makeDeckButton(label: string, title: string, onDown: () => void, onUp?: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'deck-ctrl-btn';
    btn.textContent = label;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    let pressed = false;
    const press = () => {
      if (pressed || paused || finished || destroyed) return;
      pressed = true;
      onDown();
    };
    const release = () => {
      if (!pressed) return;
      pressed = false;
      onUp?.();
    };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.setPointerCapture?.(e.pointerId);
      press();
    });
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('lostpointercapture', release);
    btn.addEventListener('blur', release);
    btn.addEventListener('keydown', (e) => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) press();
    });
    btn.addEventListener('keyup', (e) => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();
      release();
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (e.detail === 0) {
        press();
        release();
      }
    });
    return btn;
  }

  function buildDeck(): void {
    const deck = host.hud.getTactileDeck();
    deck.innerHTML = '';
    const pad = document.createElement('div');
    pad.className = 'drone-dpad';
    const controls: [string, string, string][] = [
      ['▲', 'w', '向前飞行'], ['◀', 'a', '向左飞行'], ['▼', 's', '向后飞行'], ['▶', 'd', '向右飞行'],
    ];
    for (const [label, key, title] of controls) {
      pad.appendChild(makeDeckButton(label, title, () => keys.add(key), () => keys.delete(key)));
    }
    deck.appendChild(pad);

    if (definition.mode === 'flight') {
      deck.append(makeDeckButton('稳定悬停 Space', '按住减速并稳定飞行', () => pressAction(), () => releaseAction()));
    } else if (definition.mode === 'routing') {
      deck.append(
        makeDeckButton('AI 推荐航线', '生成避开模拟限飞区的航线', () => launchRecommendedRoute()),
        makeDeckButton('清空航点', '清除自定义航点', () => { route = []; routeActive = false; routeIndex = 0; routeRecommended = false; routeObjectiveIndices = new Map(); }),
        makeDeckButton('执行航线 Space', '按规划航点飞行、到达任务点并返航', () => executeRoute())
      );
    } else if (definition.mode === 'swarm') {
      deck.append(
        makeDeckButton('切换无人机', '选择下一架无人机', () => { selectedDrone = (selectedDrone + 1) % drones.length; host.audio.playSwitch(); }),
        makeDeckButton('AI 分配', '为待巡区域分配无人机', () => assignSwarmTargets())
      );
    } else if (definition.mode === 'dispatch') {
      deck.append(
        makeDeckButton('AI 派遣 Space', '派遣到选中的任务，未选择时按风险和距离自动派遣', () => performAction()),
        makeDeckButton('切换无人机', '选择下一架无人机', () => { selectedDrone = (selectedDrone + 1) % drones.length; host.audio.playSwitch(); })
      );
    } else if (definition.mode === 'logistics') {
      deck.append(
        makeDeckButton('选择订单', '切换待配送订单', () => { selectedPoint = (selectedPoint + 1) % config().points.length; host.audio.playSwitch(); }),
        makeDeckButton('装载 / 投送 Space', '在起降点装载或在收件点签收', () => performAction())
      );
    } else if (definition.mode === 'survey') {
      deck.append(makeDeckButton('拍摄 Space', '在目标区域按住拍摄', () => pressAction(), () => releaseAction()));
    } else if (definition.mode === 'inspection') {
      deck.append(makeDeckButton('扫描 E', '悬停后按住扫描目标', () => pressAction(), () => releaseAction()));
    } else if (definition.mode === 'rescue') {
      deck.append(makeDeckButton('投送 Space', '靠近目标后投放救援包', () => performAction()));
    }
  }

  function pressAction(): void {
    actionHeld = true;
    if (definition.mode === 'survey') performAction();
  }

  function releaseAction(): void {
    actionHeld = false;
    scanProgress = Math.max(0, scanProgress - 0.15);
  }

  function showAIHint(text: string): void {
    host.hud.pushToast(text, 'nominal', '低空 AI 建议');
    host.audio.playBeep(740, 0.06);
  }

  function launchRecommendedRoute(): void {
    const planned = buildSafeMissionRoute([], points());
    if (!planned) {
      host.hud.pushToast('当前任务点与模拟限飞区之间没有可用的安全航线，请调整目标或重置任务。', 'critical', '航线规划失败');
      return;
    }
    route = planned.waypoints;
    routeObjectiveIndices = planned.objectiveIndices;
    routeIndex = 0;
    routeActive = false;
    routeRecommended = true;
    showAIHint(`已生成绕开模拟限飞区的本地航线，包含 ${targetCount()} 个任务点和返航段；按 Space 执行。`);
  }

  function executeRoute(): void {
    if (finished || routeActive) return;
    if (!routeRecommended) {
      const targets = points();
      const custom = route.filter((waypoint) => !targets.some((target) => dist(waypoint.x, waypoint.y, target.x, target.y) < 38));
      const planned = buildSafeMissionRoute(custom, targets);
      if (!planned) {
        host.hud.pushToast('航线经过模拟限飞区，无法安全执行；请调整航点后重试。', 'critical', '航线检查未通过');
        return;
      }
      route = planned.waypoints;
      routeObjectiveIndices = planned.objectiveIndices;
    }
    routeIndex = 0;
    routeActive = true;
    host.audio.playSwitch();
    showAIHint(`航线已起飞：依序完成 ${targetCount()} 个任务点后沿安全路线返回起降点。`);
  }

  function buildSafeMissionRoute(
    customWaypoints: { x: number; y: number }[],
    targets: { x: number; y: number }[]
  ): { waypoints: { x: number; y: number }[]; objectiveIndices: Map<number, number> } | null {
    const legs = [...customWaypoints, ...targets, HOME];
    const waypoints: { x: number; y: number }[] = [];
    const objectiveIndices = new Map<number, number>();
    let origin = HOME;
    for (let legIndex = 0; legIndex < legs.length; legIndex++) {
      const planned = findSafeRoute(origin, legs[legIndex]);
      if (!planned) return null;
      waypoints.push(...planned.slice(1));
      origin = planned[planned.length - 1];
      const objectiveIndex = legIndex - customWaypoints.length;
      if (objectiveIndex >= 0 && objectiveIndex < targets.length) {
        objectiveIndices.set(waypoints.length - 1, objectiveIndex);
      }
    }
    return { waypoints, objectiveIndices };
  }

  /** A small local A* search over the teaching map; it avoids configured no-fly circles. */
  function findSafeRoute(start: { x: number; y: number }, goal: { x: number; y: number }): { x: number; y: number }[] | null {
    const step = 24;
    const cols = Math.floor(WORLD_W / step) + 1;
    const rows = Math.floor(WORLD_H / step) + 1;
    const total = cols * rows;
    const idAt = (col: number, row: number) => row * cols + col;
    const pointAt = (id: number) => ({ x: (id % cols) * step, y: Math.floor(id / cols) * step });
    const endpointBlocked = (p: { x: number; y: number }) =>
      p.x < 30 || p.x > WORLD_W - 30 || p.y < 95 || p.y > WORLD_H - 28 ||
      (config().restrictedZones?.some((zone) => dist(p.x, p.y, zone.x * WORLD_W, zone.y * WORLD_H) < zone.r * WORLD_W + 8) ?? false);
    if (endpointBlocked(start) || endpointBlocked(goal)) return null;
    const blocked = new Uint8Array(total);
    for (let id = 0; id < total; id++) {
      const p = pointAt(id);
      const outside = p.x < 30 || p.x > WORLD_W - 30 || p.y < 95 || p.y > WORLD_H - 28;
      const inZone = config().restrictedZones?.some((zone) =>
        dist(p.x, p.y, zone.x * WORLD_W, zone.y * WORLD_H) < zone.r * WORLD_W + 28
      ) ?? false;
      blocked[id] = outside || inZone ? 1 : 0;
    }
    const nearestFree = (origin: { x: number; y: number }): number => {
      let nearest = -1;
      let nearestDistance = Infinity;
      for (let id = 0; id < total; id++) {
        if (blocked[id]) continue;
        const p = pointAt(id);
        const d = dist(p.x, p.y, origin.x, origin.y);
        if (d < nearestDistance) { nearest = id; nearestDistance = d; }
      }
      return nearestDistance <= 40 ? nearest : -1;
    };
    const startId = nearestFree(start);
    const goalId = nearestFree(goal);
    if (startId < 0 || goalId < 0) return null;

    const gScore = new Float64Array(total).fill(Infinity);
    const cameFrom = new Int32Array(total).fill(-1);
    const closed = new Uint8Array(total);
    const open = [startId];
    gScore[startId] = 0;
    const heuristic = (id: number) => {
      const p = pointAt(id);
      const end = pointAt(goalId);
      return dist(p.x, p.y, end.x, end.y);
    };
    const directions = [-1, 0, 1];

    while (open.length) {
      let bestAt = 0;
      for (let i = 1; i < open.length; i++) {
        if (gScore[open[i]] + heuristic(open[i]) < gScore[open[bestAt]] + heuristic(open[bestAt])) bestAt = i;
      }
      const current = open.splice(bestAt, 1)[0];
      if (current === goalId) {
        const path: number[] = [current];
        while (path[path.length - 1] !== startId) {
          const parent = cameFrom[path[path.length - 1]];
          if (parent < 0) return null;
          path.push(parent);
        }
        path.reverse();
        if (path.length <= 2) return path.map(pointAt);
        const turns: { x: number; y: number }[] = [pointAt(path[0])];
        let previousDx = 0;
        let previousDy = 0;
        for (let i = 1; i < path.length; i++) {
          const previous = pointAt(path[i - 1]);
          const next = pointAt(path[i]);
          const dx = Math.sign(next.x - previous.x);
          const dy = Math.sign(next.y - previous.y);
          if (i > 1 && (dx !== previousDx || dy !== previousDy)) turns.push(previous);
          previousDx = dx;
          previousDy = dy;
        }
        turns.push(pointAt(path[path.length - 1]));
        return turns;
      }
      if (closed[current]) continue;
      closed[current] = 1;
      const col = current % cols;
      const row = Math.floor(current / cols);
      for (const dy of directions) for (const dx of directions) {
        if (dx === 0 && dy === 0) continue;
        const nextCol = col + dx;
        const nextRow = row + dy;
        if (nextCol < 0 || nextCol >= cols || nextRow < 0 || nextRow >= rows) continue;
        const next = idAt(nextCol, nextRow);
        if (blocked[next] || closed[next]) continue;
        if (dx !== 0 && dy !== 0 && (blocked[idAt(col + dx, row)] || blocked[idAt(col, row + dy)])) continue;
        const candidate = gScore[current] + (dx && dy ? step * Math.SQRT2 : step);
        if (candidate < gScore[next]) {
          cameFrom[next] = current;
          gScore[next] = candidate;
          open.push(next);
        }
      }
    }
    return null;
  }

  function assignSwarmTargets(): void {
    const available = config().points.map((_, index) => index)
      .filter((index) => !delivered.has(index) && !drones.some((drone) => drone.assignedTarget === index));
    if (!available.length) {
      showAIHint('所有巡测区域都已完成或已有无人机执行。');
      return;
    }
    for (let i = 0; i < drones.length; i++) {
      const drone = drones[i];
      if (drone.assignedTarget >= 0) continue;
      const targetId = available.shift();
      if (targetId === undefined) break;
      const p = pointToWorld(config().points[targetId]);
      const planned = findSafeRoute(drone, p);
      if (!planned) { available.unshift(targetId); continue; }
      drone.route = planned.slice(1);
      drone.routeIndex = 0;
      drone.assignedTarget = targetId;
    }
    showAIHint('AI 已为闲置无人机分配不同巡测区；抵达后可再次分配剩余区域。');
  }

  function dispatchNext(): void {
    const availableTarget = config().points
      .map((_, index) => index)
      .filter((index) => !delivered.has(index) && !drones.some((d) => d.assignedTarget === index));
    const drone = drones.find((d) => d.assignedTarget < 0);
    if (!availableTarget.length || !drone) {
      showAIHint('当前没有空闲无人机或待处理告警。');
      return;
    }
    const priority = (idx: number) => {
      const label = config().points[idx].label;
      if (label.includes('救援') || label.includes('应急')) return 3;
      if (label.includes('医疗')) return 2;
      return 1;
    };
    const best = availableTarget.reduce((bestIdx, idx) => {
      if (priority(idx) !== priority(bestIdx)) return priority(idx) > priority(bestIdx) ? idx : bestIdx;
      const p = pointToWorld(config().points[idx]);
      const current = Math.hypot(drone.x - p.x, drone.y - p.y);
      const bestP = pointToWorld(config().points[bestIdx]);
      const bestD = Math.hypot(drone.x - bestP.x, drone.y - bestP.y);
      return current < bestD ? idx : bestIdx;
    }, availableTarget[0]);
    const p = pointToWorld(config().points[best]);
    const planned = findSafeRoute(drone, p);
    if (!planned) {
      showAIHint(`无法为“${config().points[best].label}”生成避开限飞区的安全路线。`);
      return;
    }
    drone.assignedTarget = best;
    drone.route = planned.slice(1);
    drone.routeIndex = 0;
    currentDispatch = best;
    showAIHint(`已派遣最近的空闲机前往“${config().points[best].label}”。`);
  }

  function worldPointer(e: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return {
      x: clamp(((e.clientX - rect.left) / rect.width) * WORLD_W, 30, WORLD_W - 30),
      y: clamp(((e.clientY - rect.top) / rect.height) * WORLD_H, 95, WORLD_H - 28),
    };
  }

  function onPointerDown(e: PointerEvent): void {
    if (paused || finished || destroyed) return;
    const p = worldPointer(e);
    const mode = definition.mode;
    if (mode === 'routing') {
      if (!routeActive) {
        if (routeRecommended) route = [];
        routeRecommended = false;
        routeObjectiveIndices = new Map();
        if (route.length < 5) route.push(p);
        host.audio.playClick();
      }
      return;
    }
    if (mode === 'swarm') {
      const idx = config().points.findIndex((point) => dist(p.x, p.y, point.x * WORLD_W, point.y * WORLD_H) < 50);
      if (idx >= 0) {
        if (delivered.has(idx) || drones.some((drone) => drone.assignedTarget === idx)) {
          host.hud.pushToast('该巡测区已完成，或已有无人机执行。', 'info', '任务分配');
          return;
        }
        const d = activeDrone();
        if (d) {
          const planned = findSafeRoute(d, pointToWorld(config().points[idx]));
          if (!planned) {
            host.hud.pushToast('所选巡测区没有可用的安全航线。', 'caution', '任务分配');
            return;
          }
          d.assignedTarget = idx;
          d.route = planned.slice(1);
          d.routeIndex = 0;
          host.audio.playLock();
        }
      }
      return;
    }
    if (mode === 'dispatch') {
      selectedPoint = config().points.findIndex((point) => dist(p.x, p.y, point.x * WORLD_W, point.y * WORLD_H) < 54);
      if (selectedPoint >= 0) {
        host.audio.playClick();
        host.hud.pushToast(`已选中“${config().points[selectedPoint].label}”；按 Space 派遣，或使用 AI 自动派遣。`, 'info', '待处理任务');
      }
      return;
    }
    if (mode === 'logistics') {
      const idx = config().points.findIndex((point) => dist(p.x, p.y, point.x * WORLD_W, point.y * WORLD_H) < 58);
      if (idx >= 0) {
        selectedPoint = idx;
        host.audio.playClick();
      }
    }
  }

  function performAction(): void {
    if (paused || finished || destroyed || actionCooldown > 0) return;
    actionCooldown = 0.3;
    host.audio.playClick();
    const drone = activeDrone();
    if (!drone) return;
    if (definition.mode === 'survey') {
      captureSurveyTarget(drone);
    } else if (definition.mode === 'rescue') {
      deliverRescue(drone);
    } else if (definition.mode === 'swarm') {
      assignSwarmTargets();
    } else if (definition.mode === 'logistics') {
      handleLogistics(drone);
    } else if (definition.mode === 'dispatch') {
      if (selectedPoint >= 0) dispatchSpecific(selectedPoint);
      else dispatchNext();
    }
  }

  function captureSurveyTarget(drone: Drone, notify = true): void {
    const next = config().points.findIndex((_, index) => !captured.has(index) && dist(drone.x, drone.y, points()[index].x, points()[index].y) < 66);
    if (next < 0) {
      if (notify) showAIHint('飞到未测区域上方再拍摄；保持适度重叠能提高拼接质量。');
      return;
    }
    captured.add(next);
    const overlapBonus = captured.size > 1 ? 65 : 35;
    score += overlapBonus;
    host.audio.playLock();
    host.hud.pushToast(`已采集 ${config().points[next].label} 影像；重叠率进入可拼接范围。`, 'nominal', '航测快门');
    if (captured.size >= config().points.length) returningHome = true;
  }

  function deliverRescue(drone: Drone): void {
    const next = config().points.findIndex((_, index) => !delivered.has(index) && dist(drone.x, drone.y, points()[index].x, points()[index].y) < 62);
    if (next < 0) {
      host.hud.pushToast('先靠近橙色救援标记，再投放救生包。', 'caution', '投送距离过远');
      return;
    }
    delivered.add(next);
    score += 150;
    host.audio.playSuccess();
    host.hud.pushToast(`救援包已送达：${config().points[next].label}。`, 'nominal', '救援物资投送');
    if (delivered.size >= config().points.length) returningHome = true;
  }

  function handleLogistics(drone: Drone): void {
    if (selectedPoint < 0 || delivered.has(selectedPoint)) selectedPoint = config().points.findIndex((_, i) => !delivered.has(i));
    if (selectedPoint < 0) return;
    if (!payloadLoaded && dist(drone.x, drone.y, HOME.x, HOME.y) < 78) {
      payloadLoaded = true;
      host.hud.pushToast(`订单已装载：${config().points[selectedPoint].label}。`, 'info', '货舱状态');
      return;
    }
    const p = points()[selectedPoint];
    if (payloadLoaded && dist(drone.x, drone.y, p.x, p.y) < 66) {
      delivered.add(selectedPoint);
      payloadLoaded = false;
      score += 170;
      host.audio.playSuccess();
      host.hud.pushToast('签收成功。选择下一单或返航补能。', 'nominal', '物流签收');
      selectedPoint = config().points.findIndex((_, i) => !delivered.has(i));
      if (delivered.size === config().points.length) returningHome = true;
      return;
    }
    if (returningHome && dist(drone.x, drone.y, HOME.x, HOME.y) < 70 && delivered.size >= config().points.length) completeMission(true);
    else host.hud.pushToast('到达物流起降点装载；送达订单后可返回起降点。', 'info', '任务流程');
  }

  function dispatchSpecific(targetId: number): void {
    const drone = drones.find((d) => d.assignedTarget < 0);
    if (!drone || delivered.has(targetId) || drones.some((d) => d.assignedTarget === targetId)) {
      host.hud.pushToast('该告警已处理，或当前没有空闲无人机。', 'caution', '调度检查');
      return;
    }
    const planned = findSafeRoute(drone, pointToWorld(config().points[targetId]));
    if (!planned) {
      host.hud.pushToast('该任务点暂时没有可用的安全路线。', 'caution', '调度受阻');
      return;
    }
    drone.assignedTarget = targetId;
    drone.route = planned.slice(1);
    drone.routeIndex = 0;
    currentDispatch = targetId;
    host.hud.pushToast(`已派遣无人机前往：${config().points[targetId].label}。`, 'info', '人工调度');
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (paused || finished || destroyed) return;
    const target = e.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const isSpace = key === ' ' || key.toLowerCase() === 'spacebar';
    if (target?.tagName === 'BUTTON' && isSpace) return;
    if (KEY_VECTOR[key] || isSpace) {
      e.preventDefault();
      keys.add(isSpace ? ' ' : key);
      if (isSpace && !actionHeld) {
        actionHeld = true;
        if (definition.mode === 'routing') executeRoute();
        else if (definition.mode === 'survey' || definition.mode === 'rescue' || definition.mode === 'logistics' || definition.mode === 'dispatch' || definition.mode === 'swarm') performAction();
      }
    } else if (key === 'e' && definition.mode === 'inspection') {
      actionHeld = true;
    } else if (key === 'q' && (definition.mode === 'swarm' || definition.mode === 'dispatch')) {
      selectedDrone = (selectedDrone + 1) % drones.length;
    } else if (key === 'Backspace' && definition.mode === 'routing' && !routeActive) {
      e.preventDefault();
      if (routeRecommended) {
        route = [];
        routeRecommended = false;
        routeObjectiveIndices = new Map();
        host.hud.pushToast('AI 推荐航线已清除。', 'info', '航线编辑');
      } else {
        route.pop();
      }
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const isSpace = key === ' ' || key.toLowerCase() === 'spacebar';
    keys.delete(isSpace ? ' ' : key);
    if (isSpace || key === 'e') releaseAction();
  }

  function onBlur(): void {
    keys.clear();
    actionHeld = false;
  }


  function moveDrone(drone: Drone, dt: number, target?: { x: number; y: number }, manual = false): void {
    let ax = 0;
    let ay = 0;
    if (target) {
      const dx = target.x - drone.x;
      const dy = target.y - drone.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const desiredSpeed = Math.min(175, d * 1.8);
      const desiredVx = (dx / d) * desiredSpeed;
      const desiredVy = (dy / d) * desiredSpeed;
      drone.vx += (desiredVx - drone.vx) * Math.min(1, dt * 2.8);
      drone.vy += (desiredVy - drone.vy) * Math.min(1, dt * 2.8);
    } else if (manual) {
      let ix = 0;
      let iy = 0;
      for (const key of keys) {
        const vector = KEY_VECTOR[key];
        if (vector) { ix += vector.x; iy += vector.y; }
      }
      const len = Math.max(1, Math.hypot(ix, iy));
      const windPhase = elapsed * 0.7;
      ax = (ix / len) * 260 + Math.sin(windPhase) * config().wind * 85;
      ay = (iy / len) * 260 + Math.cos(windPhase * 0.83) * config().wind * 70;
      drone.vx += ax * dt;
      drone.vy += ay * dt;
      const damping = actionHeld && (definition.mode === 'flight' || definition.mode === 'inspection') ? 5 : 1.15;
      drone.vx *= Math.exp(-damping * dt);
      drone.vy *= Math.exp(-damping * dt);
      const max = actionHeld && definition.mode === 'flight' ? 100 : 190;
      const speed = Math.hypot(drone.vx, drone.vy);
      if (speed > max) { drone.vx = (drone.vx / speed) * max; drone.vy = (drone.vy / speed) * max; }
    }
    drone.x = clamp(drone.x + drone.vx * dt, 30, WORLD_W - 30);
    drone.y = clamp(drone.y + drone.vy * dt, 95, WORLD_H - 28);
    if (Math.hypot(drone.vx, drone.vy) > 2) drone.heading = Math.atan2(drone.vy, drone.vx);
  }

  function returnDroneHome(drone: Drone, dt: number): void {
    if (dist(drone.x, drone.y, HOME.x, HOME.y) < 52) {
      completeMission(true);
      return;
    }
    if (!drone.route.length) {
      const planned = findSafeRoute(drone, HOME);
      if (!planned) {
        moveDrone(drone, dt, undefined, true);
        if (toastCooldown <= 0) {
          host.hud.pushToast('请先操控无人机离开模拟限飞区，系统将接续安全返航。', 'caution', '返航路线受阻');
          toastCooldown = 2;
        }
        return;
      }
      drone.route = planned.slice(1);
      drone.routeIndex = 0;
    }
    const target = drone.route[drone.routeIndex];
    if (target && dist(drone.x, drone.y, target.x, target.y) < 20) drone.routeIndex++;
    if (drone.routeIndex >= drone.route.length) {
      drone.route = [];
      return;
    }
    moveDrone(drone, dt, drone.route[drone.routeIndex]);
  }

  function update(dt: number): void {
    if (finished || paused) return;
    elapsed += dt;
    battery = Math.max(0, battery - dt * (0.18 + drones.reduce((sum, d) => sum + Math.hypot(d.vx, d.vy) / 190, 0) * 0.2));
    actionCooldown = Math.max(0, actionCooldown - dt);
    toastCooldown = Math.max(0, toastCooldown - dt);
    const current = activeDrone();

    for (let i = 0; i < drones.length; i++) {
      const drone = drones[i];
      if (returningHome && ['flight', 'survey', 'inspection', 'logistics', 'rescue'].includes(definition.mode) && i === selectedDrone) {
        returnDroneHome(drone, dt);
      } else if (definition.mode === 'routing' && routeActive && i === selectedDrone) {
        const target = route[routeIndex];
        if (target && dist(drone.x, drone.y, target.x, target.y) < 20) {
          const targetIndex = routeObjectiveIndices.get(routeIndex);
          if (targetIndex !== undefined && !delivered.has(targetIndex)) {
            delivered.add(targetIndex);
            score += 250;
            host.audio.playLock();
          }
          routeIndex++;
          if (routeIndex >= route.length) {
            routeActive = false;
            completeMission(delivered.size >= targetCount());
          }
        }
        if (routeActive) moveDrone(drone, dt, route[routeIndex]);
      } else if ((definition.mode === 'swarm' || definition.mode === 'dispatch') && drone.route.length) {
        const target = drone.route[drone.routeIndex];
        if (target && dist(drone.x, drone.y, target.x, target.y) < 22) {
          if (drone.routeIndex < drone.route.length - 1) {
            drone.routeIndex++;
          } else {
            const task = drone.assignedTarget;
            if (task >= 0) {
              if (!delivered.has(task)) {
                delivered.add(task);
                score += definition.mode === 'swarm' ? 130 : 160;
              }
              drone.route = [];
              drone.assignedTarget = -1;
              if (delivered.size >= config().points.length) completeMission(true);
            }
          }
        }
        if (drone.route.length) moveDrone(drone, dt, drone.route[drone.routeIndex]);
      } else if (definition.mode === 'logistics' && payloadLoaded && selectedPoint >= 0) {
        // Manual flight remains primary; the AI draws a safe target corridor only.
        moveDrone(drone, dt, undefined, true);
      } else {
        const multiDroneMode = definition.mode === 'swarm' || definition.mode === 'dispatch';
        if (multiDroneMode && i !== selectedDrone) {
          moveDrone(drone, dt);
          drone.vx *= Math.exp(-3 * dt);
          drone.vy *= Math.exp(-3 * dt);
        } else {
          moveDrone(drone, dt, undefined, true);
        }
      }
    }

    if (current) {
      const inZone = config().restrictedZones?.some((zone) => dist(current.x, current.y, zone.x * WORLD_W, zone.y * WORLD_H) < zone.r * WORLD_W) ?? false;
      if (inZone && toastCooldown <= 0) {
        collisionCount++;
        battery = Math.max(0, battery - 2.5);
        toastCooldown = 1.5;
        host.audio.playWarning();
        host.hud.pushToast('进入模拟限飞区：已扣除安全分并限制飞行。', 'critical', '低空安全告警');
      }
      if (inZone) { current.vx *= 0.94; current.vy *= 0.94; }

      if (definition.mode === 'flight') {
        const p = points()[targetIndex];
        if (p && dist(current.x, current.y, p.x, p.y) < 38) {
          targetIndex++;
          score += 140;
          host.audio.playLock();
          if (targetIndex >= config().points.length) returningHome = true;
        }
      } else if (definition.mode === 'survey' && actionHeld && captured.size < config().points.length) {
        captureSurveyTarget(current, false);
      } else if (definition.mode === 'inspection') {
        const idx = config().points.findIndex((_, i) => !captured.has(i) && dist(current.x, current.y, points()[i].x, points()[i].y) < 58);
        const stable = Math.hypot(current.vx, current.vy) < 58;
        if (actionHeld && idx >= 0 && stable) {
          scanProgress += dt;
          if (scanProgress >= 1.2) {
            captured.add(idx);
            score += 180;
            scanProgress = 0;
            host.audio.playLock();
            host.hud.pushToast(`AI 复核完成：${config().points[idx].label}，请结合现场纹理确认告警。`, 'nominal', '视觉巡检');
            if (captured.size >= config().points.length) returningHome = true;
          }
        } else {
          scanProgress = Math.max(0, scanProgress - dt * 0.7);
        }
      } else if (definition.mode === 'logistics' && returningHome && delivered.size >= config().points.length) {
        if (dist(current.x, current.y, HOME.x, HOME.y) < 65) completeMission(true);
      }
    }

    if (!finished && elapsed >= config().duration) completeMission(false);
    if (!finished && battery <= 0) completeMission(false);
  }

  function completeMission(won: boolean): void {
    if (finished) return;
    finished = true;
    const scoreFinal = Math.max(0, Math.round(score + battery * 3 + Math.max(0, config().duration - elapsed) * 1.2 - collisionCount * 85));
    const rewardPerTarget: Record<DroneMissionMode, number> = {
      flight: 140, routing: 250, survey: 65, inspection: 180,
      rescue: 150, swarm: 130, logistics: 170, dispatch: 160,
    };
    const scoreCeiling = Math.max(1, rewardPerTarget[definition.mode] * targetCount() + config().battery * 3 + config().duration * 1.2);
    const scoreRatio = scoreFinal / scoreCeiling;
    const stars: 0 | 1 | 2 | 3 = !won ? 0 : scoreRatio >= 0.88 ? 3 : scoreRatio >= 0.68 ? 2 : 1;
    const codexId = config().codexId;
    const entry = CODEX_ENTRIES.find((item) => item.id === codexId);
    const scienceCard = {
      title: entry?.title ?? `${modeName[definition.mode]} · 低空科普`,
      gameAction: won ? `你完成了“${config().name}”，在城市环境中规划航迹、管理电量并完成目标。` : `本次任务未完成；注意任务进度、剩余电量与低空风险之间的关系。`,
      realStationFact: entry?.summary ?? '本项目中的 AI 与飞行数据均为前端教学模拟，用于说明决策权衡。',
      realData: entry?.realParam ?? '教学仿真数据，不用于实际飞行。',
      codexId,
    };
    const result: GameResult = {
      levelIndex,
      won,
      stars,
      score: Math.max(0, scoreFinal),
      summary: won ? `${modeName[definition.mode]}任务完成；安全告警 ${collisionCount} 次，剩余电量 ${Math.round(battery)}%。` : `任务中止；已完成 ${progressCount()} 项，剩余电量 ${Math.round(battery)}%。`,
      metrics: [
        { label: '任务进度', value: `${progressCount()} / ${targetCount()}` },
        { label: '剩余电量', value: `${Math.round(battery)}%`, status: battery < 12 ? 'critical' : battery < 25 ? 'caution' : 'nominal' },
        { label: '安全告警', value: `${collisionCount} 次`, status: collisionCount > 0 ? 'caution' : 'nominal' },
      ],
      scienceCard,
    };
    host.audio[won ? 'playSuccess' : 'playCritical']();
    host.completeLevel(result);
  }

  function progressCount(): number {
    switch (definition.mode) {
      case 'flight': return targetIndex;
      case 'survey': case 'inspection': return captured.size;
      case 'rescue': case 'swarm': case 'logistics': case 'dispatch': return delivered.size;
      case 'routing': return delivered.size;
    }
  }

  function updateHud(now: number): void {
    if (now - lastHudAt < 180) return;
    lastHudAt = now;
    const progress = progressCount();
    const count = targetCount();
    const drone = activeDrone();
    const speed = drone ? Math.hypot(drone.vx, drone.vy) : 0;
    const inZone = drone && (config().restrictedZones?.some((zone) => dist(drone.x, drone.y, zone.x * WORLD_W, zone.y * WORLD_H) < zone.r * WORLD_W) ?? false);
    host.hud.updateMetric('battery', { value: `${Math.round(battery)}%`, ratio: battery / 100, status: battery < 12 ? 'critical' : battery < 25 ? 'caution' : 'nominal' });
    host.hud.updateMetric('mission', { value: `${progress} / ${count}`, ratio: count ? progress / count : 0, status: progress >= count ? 'nominal' : 'info' });
    host.hud.updateMetric('wind', { value: config().wind.toFixed(1), status: config().wind > 0.45 ? 'caution' : 'nominal' });
    host.hud.updateMetric('safety', { value: inZone ? '限飞区' : speed > 150 ? '高速' : '安全', status: inZone || speed > 150 ? 'caution' : 'nominal' });
  }

  function drawCity(): void {
    ctx.fillStyle = '#071322';
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.strokeStyle = 'rgba(61, 119, 161, 0.10)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= WORLD_W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_H); ctx.stroke(); }
    for (let y = 0; y <= WORLD_H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_W, y); ctx.stroke(); }

    // Qiantang River and West Lake make the operational map recognizably Hangzhou.
    ctx.save();
    ctx.fillStyle = 'rgba(13, 89, 130, 0.52)';
    ctx.beginPath();
    ctx.moveTo(420, 440); ctx.bezierCurveTo(560, 415, 650, 468, 790, 430);
    ctx.bezierCurveTo(870, 408, 942, 420, 1000, 395); ctx.lineTo(1000, 485);
    ctx.bezierCurveTo(880, 512, 812, 478, 710, 504); ctx.bezierCurveTo(595, 533, 520, 482, 420, 503); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(56, 189, 248, .44)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = 'rgba(56, 189, 248, .72)'; ctx.font = '600 15px sans-serif'; ctx.fillText('钱塘江低空走廊', 650, 466);
    ctx.fillStyle = 'rgba(23, 108, 82, 0.44)'; ctx.beginPath(); ctx.ellipse(278, 307, 100, 71, -0.2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(45, 212, 191, .55)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = 'rgba(110, 231, 183, .78)'; ctx.fillText('西湖生态缓冲区', 217, 314);
    ctx.restore();

    // Calm, deterministic district blocks: no external tile or map service.
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 10; col++) {
        const x = 48 + col * 94;
        const y = 76 + row * 76;
        const nearLake = Math.pow((x + 35 - 278) / 112, 2) + Math.pow((y + 28 - 307) / 82, 2) < 1;
        const nearRiver = y > 390 && y < 522 && x > 390;
        if (nearLake || nearRiver || ((row * 7 + col * 11) % 6 === 0)) continue;
        const h = 22 + ((row * 13 + col * 17) % 35);
        const fill = (row + col) % 3 === 0 ? 'rgba(22, 47, 72, .90)' : 'rgba(16, 37, 61, .90)';
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, 58, h);
        ctx.strokeStyle = 'rgba(90, 146, 185, .34)'; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, 57, h - 1);
        ctx.fillStyle = 'rgba(70, 158, 195, .13)';
        for (let wx = 7; wx < 54; wx += 14) ctx.fillRect(x + wx, y + 7, 4, Math.max(2, h - 14));
      }
    }
    ctx.strokeStyle = 'rgba(147, 197, 253, .16)';
    ctx.lineWidth = 10;
    for (const y of [138, 224, 400, 552]) { ctx.beginPath(); ctx.moveTo(30, y); ctx.lineTo(970, y); ctx.stroke(); }
    for (const x of [96, 390, 618, 882]) { ctx.beginPath(); ctx.moveTo(x, 82); ctx.lineTo(x, 615); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(56,189,248,.52)'; ctx.lineWidth = 2; ctx.setLineDash([9, 8]);
    ctx.beginPath(); ctx.moveTo(110, 555); ctx.bezierCurveTo(320, 520, 365, 282, 545, 280); ctx.bezierCurveTo(714, 278, 740, 355, 926, 290); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(148, 163, 184, .85)'; ctx.font = '600 12px sans-serif';
    ctx.fillText('滨江科创片区', 676, 250); ctx.fillText('钱江新城片区', 812, 368); ctx.fillText('城市低空仿真地图 · 非实飞航线', 24, 30);
  }

  function drawRestrictedZones(): void {
    for (const zone of config().restrictedZones ?? []) {
      ctx.save();
      ctx.fillStyle = 'rgba(239, 68, 68, .11)';
      ctx.strokeStyle = 'rgba(248, 113, 113, .72)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath(); ctx.arc(zone.x * WORLD_W, zone.y * WORLD_H, zone.r * WORLD_W, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(254, 202, 202, .84)'; ctx.font = '600 11px sans-serif';
      ctx.fillText(zone.label, zone.x * WORLD_W - 34, zone.y * WORLD_H - zone.r * WORLD_W - 8);
      ctx.restore();
    }
  }

  function drawTargets(): void {
    const targetPoints = points();
    for (let i = 0; i < targetPoints.length; i++) {
      const p = targetPoints[i];
      const done = definition.mode === 'flight' ? i < targetIndex : definition.mode === 'survey' || definition.mode === 'inspection' ? captured.has(i) : delivered.has(i);
      const selected = i === selectedPoint || i === currentDispatch;
      const color = done ? '#22c55e' : definition.mode === 'rescue' ? '#fb923c' : definition.mode === 'inspection' ? '#fbbf24' : '#38bdf8';
      ctx.save();
      ctx.strokeStyle = selected ? '#f8fafc' : color; ctx.fillStyle = `${color}20`; ctx.lineWidth = selected ? 3 : 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, selected ? 28 : 22, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p.x - 9, p.y); ctx.lineTo(p.x + 9, p.y); ctx.moveTo(p.x, p.y - 9); ctx.lineTo(p.x, p.y + 9); ctx.stroke();
      ctx.fillStyle = done ? '#bbf7d0' : '#e2f3ff'; ctx.font = '600 12px sans-serif';
      ctx.fillText(`${i + 1}. ${config().points[i].label}`, p.x + 28, p.y + 4);
      ctx.restore();
    }
  }

  function drawDrone(drone: Drone, index: number, now: number): void {
    ctx.save();
    ctx.translate(drone.x, drone.y);
    ctx.rotate(drone.heading);
    const active = index === selectedDrone;
    const accent = active ? '#38bdf8' : '#94a3b8';
    const hubs: [number, number][] = [[-34, -25], [34, -25], [-34, 25], [34, 25]];

    // A compact industrial quadcopter: carbon arms, isolated motors, and visible spinning props.
    // Its soft underside shadow and layered parts preserve readability over the map at mobile scale.
    ctx.fillStyle = 'rgba(0, 4, 12, .58)';
    ctx.beginPath(); ctx.ellipse(3, 6, 25, 18, 0, 0, Math.PI * 2); ctx.fill();

    ctx.lineCap = 'round';
    for (const [x, y] of hubs) {
      ctx.strokeStyle = 'rgba(1, 6, 14, .95)'; ctx.lineWidth = 11;
      ctx.beginPath(); ctx.moveTo(Math.sign(x) * 8, Math.sign(y) * 5); ctx.lineTo(x, y); ctx.stroke();
      ctx.strokeStyle = active ? '#315d76' : '#455365'; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(Math.sign(x) * 8, Math.sign(y) * 5); ctx.lineTo(x, y); ctx.stroke();
      ctx.strokeStyle = active ? 'rgba(147, 226, 255, .8)' : 'rgba(203, 213, 225, .68)'; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(Math.sign(x) * 12, Math.sign(y) * 8); ctx.lineTo(x - Math.sign(x) * 5, y - Math.sign(y) * 4); ctx.stroke();

      // Split landing strut and foot sit just under the motor arm.
      ctx.strokeStyle = 'rgba(3, 10, 20, .92)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x * .55, y * .55); ctx.lineTo(x * .78, y * .78); ctx.lineTo(x * .98, y * .78); ctx.stroke();
    }

    hubs.forEach(([x, y], motorIndex) => {
      ctx.save();
      ctx.translate(x, y);
      const rotorPhase = now * 0.035 + motorIndex * 1.12 + index * 0.6;
      ctx.strokeStyle = active ? 'rgba(125, 211, 252, .24)' : 'rgba(203, 213, 225, .18)';
      ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.ellipse(0, 0, 16, 8, -0.16, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.save(); ctx.rotate(rotorPhase);
      ctx.fillStyle = active ? 'rgba(103, 232, 249, .30)' : 'rgba(203, 213, 225, .23)';
      ctx.beginPath(); ctx.ellipse(0, -7.2, 2.2, 7.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, 7.2, 2.2, 7.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = active ? 'rgba(186, 230, 253, .42)' : 'rgba(226, 232, 240, .32)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-1, -12); ctx.lineTo(1, -11); ctx.moveTo(-1, 12); ctx.lineTo(1, 11); ctx.stroke();
      ctx.restore();

      ctx.fillStyle = 'rgba(1, 8, 17, .96)'; ctx.strokeStyle = active ? '#78c9ef' : '#8292a4'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 8.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#263b50'; ctx.beginPath(); ctx.arc(0, 0, 5.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#dbeafe'; ctx.beginPath(); ctx.arc(-1.2, -1.5, 2.3, 0, Math.PI * 2); ctx.fill();
      const navColor = motorIndex === 0 ? '#fb7185' : motorIndex === 1 ? '#34d399' : active ? '#67e8f9' : '#94a3b8';
      ctx.fillStyle = navColor; ctx.shadowColor = navColor; ctx.shadowBlur = active ? 8 : 4;
      ctx.beginPath(); ctx.arc(0, 0, 1.7, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });

    // Skid frame and battery bay make the central fuselage read as a connected machine.
    ctx.strokeStyle = 'rgba(3, 9, 18, .94)'; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-15, -13); ctx.lineTo(-19, -17); ctx.lineTo(9, -17); ctx.lineTo(13, -12);
    ctx.moveTo(-15, 13); ctx.lineTo(-19, 17); ctx.lineTo(9, 17); ctx.lineTo(13, 12); ctx.stroke();

    ctx.fillStyle = 'rgba(0, 5, 13, .92)'; ctx.strokeStyle = '#182c40'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(-22, -14, 44, 29, 8); ctx.fill(); ctx.stroke();
    const shell = ctx.createLinearGradient(-15, -14, 13, 15);
    shell.addColorStop(0, active ? '#e0f2fe' : '#cbd5e1');
    shell.addColorStop(.42, active ? '#6f93aa' : '#8491a0');
    shell.addColorStop(1, '#293c50');
    ctx.fillStyle = shell; ctx.strokeStyle = active ? '#9ee6ff' : '#bdc7d2'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.roundRect(-18, -11, 37, 23, 7); ctx.fill(); ctx.stroke();

    // Upper battery lid, cooling ribs, fasteners, and a forward-facing nose fairing.
    ctx.fillStyle = '#253c52'; ctx.strokeStyle = 'rgba(220, 241, 255, .5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(-11, -7, 17, 14, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(196, 222, 240, .78)';
    for (let vent = 0; vent < 3; vent++) ctx.fillRect(-8 + vent * 4, -4, 1.5, 8);
    ctx.fillStyle = 'rgba(239, 246, 255, .9)';
    for (const [sx, sy] of [[-14, -8], [-14, 8], [12, -8], [12, 8]] as [number, number][]) {
      ctx.beginPath(); ctx.arc(sx, sy, 1.1, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = active ? '#e0f7ff' : '#e2e8f0'; ctx.strokeStyle = active ? '#67e8f9' : '#94a3b8'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(14, -7); ctx.lineTo(23, -4); ctx.lineTo(27, 0); ctx.lineTo(23, 4); ctx.lineTo(14, 7); ctx.closePath(); ctx.fill(); ctx.stroke();

    // Suspended gimbal pod with a glass lens and two navigation/status lamps.
    ctx.strokeStyle = '#d7e5ee'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(24, 0); ctx.stroke();
    ctx.fillStyle = '#122538'; ctx.strokeStyle = '#8aa5bb'; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.roundRect(22, -5, 9, 10, 3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#eab54d'; ctx.beginPath(); ctx.arc(29, 0, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = active ? '#67e8f9' : '#a5b4c4'; ctx.beginPath(); ctx.arc(29, 0, 1.7, 0, Math.PI * 2); ctx.fill();
    for (const [lx, ly, color] of [[19, -10, '#fb7185'], [19, 10, '#34d399']] as [number, number, string][]) {
      ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = active ? 6 : 2;
      ctx.beginPath(); ctx.arc(lx, ly, 1.8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    if (active) {
      ctx.strokeStyle = 'rgba(56,189,248,.3)'; ctx.lineWidth = 1; ctx.setLineDash([3, 7]);
      ctx.beginPath(); ctx.arc(drone.x, drone.y, 57, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(125, 211, 252, .56)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(drone.x + Math.cos(drone.heading) * 47, drone.y + Math.sin(drone.heading) * 47);
      ctx.lineTo(drone.x + Math.cos(drone.heading) * 57, drone.y + Math.sin(drone.heading) * 57); ctx.stroke();
    }
    ctx.fillStyle = active ? '#bae6fd' : '#cbd5e1'; ctx.font = '600 10px monospace';
    ctx.fillText(`UAV-${index + 1}`, drone.x - 19, drone.y + 68);
  }

  function render(now: number): void {
    ctx.save();
    ctx.setTransform(canvas.width / WORLD_W, 0, 0, canvas.height / WORLD_H, 0, 0);
    drawCity();
    drawRestrictedZones();
    // Home pad
    ctx.strokeStyle = 'rgba(34,197,94,.82)'; ctx.fillStyle = 'rgba(34,197,94,.10)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(HOME.x, HOME.y, 32, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#bbf7d0'; ctx.font = '600 11px sans-serif'; ctx.fillText('起降点', HOME.x - 17, HOME.y + 49);

    // Route overlays
    const active = activeDrone();
    if (definition.mode === 'routing' && route.length) {
      ctx.strokeStyle = routeActive ? '#fbbf24' : 'rgba(251,191,36,.78)'; ctx.lineWidth = 3; ctx.setLineDash([8,6]);
      ctx.beginPath(); ctx.moveTo(active?.x ?? HOME.x, active?.y ?? HOME.y);
      route.forEach((p) => ctx.lineTo(p.x, p.y)); ctx.stroke(); ctx.setLineDash([]);
      route.forEach((p, i) => { ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.fillText(`W${i+1}`, p.x+7, p.y-6); });
    }
    if (definition.mode === 'swarm' || definition.mode === 'dispatch') {
      for (const drone of drones) if (drone.route.length) {
        const target = drone.route[drone.routeIndex];
        if (target) { ctx.strokeStyle = 'rgba(56,189,248,.46)'; ctx.lineWidth = 2; ctx.setLineDash([5,5]); ctx.beginPath(); ctx.moveTo(drone.x, drone.y); ctx.lineTo(target.x, target.y); ctx.stroke(); ctx.setLineDash([]); }
      }
    }
    if (definition.mode === 'survey') {
      for (let i = 0; i < config().points.length; i++) {
        if (captured.has(i)) { const p = points()[i]; ctx.strokeStyle='rgba(34,197,94,.34)'; ctx.lineWidth=18; ctx.beginPath(); ctx.arc(p.x,p.y,29,0,Math.PI*2); ctx.stroke(); }
      }
    }
    drawTargets();
    drones.forEach((drone, index) => drawDrone(drone, index, now));
    if (physicsOverlay && active) {
      ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(active.x, active.y); ctx.lineTo(active.x + active.vx * .45, active.y + active.vy * .45); ctx.stroke();
    }
    const pulse = 0.5 + Math.sin(now * 0.004) * 0.5;
    if (definition.mode === 'inspection' && scanProgress > 0 && active) {
      ctx.strokeStyle = `rgba(34,197,94,${.35 + pulse * .5})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(active.x, active.y, 48 + scanProgress * 18, 0, Math.PI * 2); ctx.stroke();
    }
    if (finished) {
      ctx.fillStyle = 'rgba(2, 6, 16, .45)'; ctx.fillRect(0, 0, WORLD_W, WORLD_H);
      ctx.textAlign = 'center'; ctx.fillStyle = '#eaf6ff'; ctx.font = '700 30px sans-serif';
      ctx.fillText(progressCount() >= targetCount() ? '任务目标已达成' : '任务已结束', WORLD_W / 2, WORLD_H / 2);
      ctx.textAlign = 'left';
    }
    ctx.restore();
  }

  function frame(now: number): void {
    if (destroyed) return;
    const dt = Math.min(0.04, Math.max(0, (now - lastTs) / 1000));
    lastTs = now;
    update(dt);
    render(now);
    updateHud(now);
    rafId = requestAnimationFrame(frame);
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  reset();
  rafId = requestAnimationFrame(frame);

  return {
    destroy(): void {
      destroyed = true;
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointerdown', onPointerDown);
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
    setPhysicsOverlay(value: boolean): void { physicsOverlay = value; },
  };
}

