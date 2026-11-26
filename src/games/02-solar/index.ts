import { createCanvasMiniGame, drawConsoleBackdrop, drawLabel } from '../../core/canvas-minigame';
import type { MiniGameLevel, MiniGamePointer } from '../../core/canvas-minigame';
import { clamp } from '../../core/canvas-utils';

type Direction = 'up' | 'right' | 'down' | 'left';
interface Instruction { direction: Direction; steps: number }
interface RouteLevel extends MiniGameLevel {
  start: { x: number; y: number };
  goal: { x: number; y: number };
  checkpoints: { x: number; y: number; name: string }[];
  buildings: { x: number; y: number; name: string }[];
  rows: number;
  cols: number;
  blockLimit: number;
  stepLimit: number;
}
interface RouteState {
  program: Instruction[];
  selected: number;
  dragging: number;
  dragY: number;
  dragStarted: boolean;
  drone: { x: number; y: number };
  trace: { x: number; y: number }[];
  checkpoints: Set<number>;
  command: number;
  stepInCommand: number;
  stepClock: number;
  executedSteps: number;
  mistakes: number;
  totalMistakes: number;
  running: boolean;
  message: string;
}

const directionGlyph: Record<Direction, string> = { up: '↑', right: '→', down: '↓', left: '←' };
const movement: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: -1 }, right: { x: 1, y: 0 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 },
};
const cell = 66;
const gridX = 446;
const gridY = 136;

function roundedPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawInstructionBlock(ctx: CanvasRenderingContext2D, direction: Direction, steps: number, x: number, y: number, active: boolean, selected: boolean): void {
  const tint: Record<Direction, { face: string; edge: string; highlight: string; icon: string }> = {
    up: { face: '#1a5167', edge: '#0b2b3c', highlight: '#56d7ed', icon: '#b8f5fb' },
    right: { face: '#5b512d', edge: '#322b1c', highlight: '#ebc15d', icon: '#fff0b5' },
    down: { face: '#594037', edge: '#342720', highlight: '#e89971', icon: '#ffddc9' },
    left: { face: '#354c60', edge: '#1d3043', highlight: '#85bce2', icon: '#d2edff' },
  };
  const palette = tint[direction];
  ctx.save();
  const depth = active ? 4 : 3;
  ctx.globalAlpha = active ? 1 : 0.72;
  ctx.fillStyle = 'rgba(1, 8, 14, .54)';
  roundedPanel(ctx, x + 2, y + depth + 3, 85, 35, 6); ctx.fill();
  ctx.fillStyle = palette.edge;
  roundedPanel(ctx, x, y + depth, 85, 35, 6); ctx.fill();
  ctx.fillStyle = active ? palette.face : '#183047';
  roundedPanel(ctx, x, y, 85, 35, 6); ctx.fill();
  ctx.strokeStyle = selected ? '#dbfbff' : palette.highlight;
  ctx.lineWidth = selected ? 1.5 : 1;
  ctx.stroke();
  ctx.strokeStyle = selected ? 'rgba(221, 251, 255, .85)' : 'rgba(221, 245, 249, .48)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + 8, y + 2); ctx.lineTo(x + 76, y + 2); ctx.stroke();
  ctx.fillStyle = palette.icon;
  ctx.font = '700 23px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(directionGlyph[direction], x + 23, y + 25);
  ctx.strokeStyle = 'rgba(216, 241, 243, .25)';
  ctx.beginPath(); ctx.moveTo(x + 43, y + 8); ctx.lineTo(x + 43, y + 28); ctx.stroke();
  ctx.fillStyle = '#edf9f8'; ctx.font = '600 14px "JetBrains Mono", monospace';
  ctx.fillText(`${steps} 格`, x + 64, y + 22);
  ctx.restore();
}

function drawCityCell(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, alternate: boolean): void {
  const inset = 2;
  const tone = alternate ? '#123148' : '#102b40';
  ctx.fillStyle = '#071521';
  ctx.fillRect(x + inset, y + inset + 2, size - inset * 2, size - inset * 2);
  ctx.fillStyle = tone;
  ctx.fillRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
  ctx.fillStyle = alternate ? 'rgba(139, 207, 218, .10)' : 'rgba(92, 165, 188, .09)';
  ctx.fillRect(x + inset + 2, y + inset + 2, size - inset * 2 - 4, size - inset * 2 - 4);
  ctx.strokeStyle = 'rgba(143, 206, 219, .23)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + inset + 0.5, y + inset + 0.5, size - inset * 2 - 1, size - inset * 2 - 1);
  ctx.strokeStyle = 'rgba(207, 239, 234, .12)';
  ctx.beginPath(); ctx.moveTo(x + 5, y + 4); ctx.lineTo(x + size - 5, y + 4); ctx.stroke();
}

function drawRouteDrone(ctx: CanvasRenderingContext2D, state: RouteState, cx: number, cy: number, time: number): void {
  const previous = state.trace.at(-2) ?? state.drone;
  const dx = state.drone.x - previous.x, dy = state.drone.y - previous.y;
  const heading = dx || dy ? Math.atan2(dy, dx) : 0;
  const c = Math.cos(heading), s = Math.sin(heading);
  const bob = state.running ? Math.sin(time * 9) * 0.8 : Math.sin(time * 2) * 0.35;
  const project = (x: number, y: number, z: number): [number, number] => [
    cx + x * c - y * s,
    cy + (x * s + y * c) * 0.8 - z * 0.62 + bob,
  ];
  const line = (a: [number, number, number], b: [number, number, number], color: string, width: number): void => {
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(...project(...a)); ctx.lineTo(...project(...b)); ctx.stroke();
  };
  const polygon = (points: [number, number, number][], fill: string, stroke?: string): void => {
    const p = points.map(([x, y, z]) => project(x, y, z));
    ctx.beginPath(); p.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 0.8; ctx.stroke(); }
  };
  ctx.save();
  ctx.fillStyle = 'rgba(1, 8, 15, .34)';
  ctx.beginPath(); ctx.ellipse(cx + 4, cy + 9, 16, 9, heading * 0.1, 0, Math.PI * 2); ctx.fill();
  const arms: [number, number, number][] = [[-10, -9, 0], [10, -9, 1], [-10, 9, 2], [10, 9, 3]];
  for (const [x, y] of arms) {
    line([x * 0.3, y * 0.3, 5], [x, y, 7], '#243946', 3.6);
    line([x * 0.3, y * 0.3, 5.5], [x, y, 7.4], '#a1bbc4', 1);
  }
  for (const [x, y, i] of arms) {
    const center = project(x, y, 8);
    ctx.strokeStyle = 'rgba(158, 236, 240, .67)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.ellipse(...center, 6.2, 2.2, heading, 0, Math.PI * 2); ctx.stroke();
    ctx.save(); ctx.translate(...center); ctx.rotate(time * 20 * (i % 2 ? -1 : 1));
    ctx.strokeStyle = 'rgba(225, 251, 249, .84)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(4, 0); ctx.stroke(); ctx.restore();
    ctx.fillStyle = i < 2 ? '#f0a17c' : '#62e0ba';
    ctx.beginPath(); ctx.arc(...project(x * 0.85, y * 0.85, 7.4), 1.15, 0, Math.PI * 2); ctx.fill();
  }
  polygon([[-7, -4, 5], [6, -4, 5], [8, 0, 5], [6, 4, 5], [-7, 4, 5]], '#253b47', '#b8d6d9');
  polygon([[-7, -4, 6], [6, -4, 6], [8, 0, 6], [6, 4, 6], [-7, 4, 6]], '#cfdfd9', '#f3ffff');
  polygon([[-3, -2.6, 6.3], [2, -2.6, 6.3], [2, 2.6, 6.3], [-3, 2.6, 6.3]], '#476a79');
  polygon([[4, -2.5, 6.15], [6, -1.5, 6.15], [6, 1.5, 6.15], [4, 2.5, 6.15]], '#e2ab54');
  const camera = project(8, 0, 5.7);
  ctx.fillStyle = '#284451'; ctx.strokeStyle = '#b9d2d0'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.arc(...camera, 2.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#67cee1'; ctx.beginPath(); ctx.arc(camera[0] + c, camera[1] + s * 0.7, 1, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function initialState(level: RouteLevel): RouteState {
  return {
    program: [], selected: -1, dragging: -1, dragY: 0, dragStarted: false,
    drone: { ...level.start }, trace: [{ ...level.start }], checkpoints: new Set(),
    command: 0, stepInCommand: 0, stepClock: 0, executedSteps: 0, mistakes: 0, totalMistakes: 0,
    running: false, message: '先把飞行意图写成指令，再运行航线。',
  };
}

function tryStep(state: RouteState, level: RouteLevel): void {
  if (state.executedSteps >= level.stepLimit) {
    state.running = false;
    state.mistakes++;
    state.totalMistakes++;
    state.message = '步数预算已用完；压缩程序或调整路线后重新运行。';
    return;
  }
  if (state.command >= state.program.length) {
    state.running = false;
    const allChecks = level.checkpoints.every((_point, index) => state.checkpoints.has(index));
    state.message = state.drone.x === level.goal.x && state.drone.y === level.goal.y && allChecks
      ? '航线已到达目标并通过检查点。'
      : '程序运行结束：检查目标点或漏掉的检查点后再试。';
    return;
  }
  const instruction = state.program[state.command];
  const delta = movement[instruction.direction];
  const next = { x: state.drone.x + delta.x, y: state.drone.y + delta.y };
  const blocked = next.x < 0 || next.y < 0 || next.x >= level.cols || next.y >= level.rows
    || level.buildings.some((building) => building.x === next.x && building.y === next.y);
  if (blocked) {
    state.running = false;
    state.mistakes++;
    state.totalMistakes++;
    state.message = '航线受阻！建筑和边界会直接阻断路径；改完指令后可重新运行。';
    return;
  }
  state.drone = next;
  state.trace.push(next);
  state.executedSteps++;
  for (let index = 0; index < level.checkpoints.length; index++) {
    const point = level.checkpoints[index];
    if (next.x === point.x && next.y === point.y) state.checkpoints.add(index);
  }
  state.stepInCommand++;
  if (state.stepInCommand >= instruction.steps) {
    state.command++;
    state.stepInCommand = 0;
  }
  const allChecks = level.checkpoints.every((_point, index) => state.checkpoints.has(index));
  if (state.drone.x === level.goal.x && state.drone.y === level.goal.y && allChecks) {
    state.running = false;
    state.message = '目标已抵达，所有检查点通过。';
  }
}

function run(state: RouteState, level: RouteLevel): void {
  if (!state.program.length) {
    state.message = '先加入至少一条方向指令。';
    return;
  }
  if (state.command >= state.program.length || state.mistakes > 0) {
    state.drone = { ...level.start };
    state.trace = [{ ...level.start }];
    state.checkpoints.clear();
    state.command = 0;
    state.stepInCommand = 0;
    state.stepClock = 0;
    state.executedSteps = 0;
    state.mistakes = 0;
    state.message = '从起点重新执行当前程序。';
  }
  state.running = true;
}

const levels: RouteLevel[] = [
  {
    name: '沿河绕行', subtitle: '一处楼宇阻断 · 3 条指令',
    objective: '用方向与步数积木绕过街区中央的建筑，到达钱塘江观测点。',
    codexId: 'solar-route-safe-corridors', duration: 100,
    lesson: '网格搜索把城市路网化成节点与边；最短路径遇到障碍时必须重新规划。',
    scienceAction: '你把城市路网拆成网格，并编排方向与步数，绕开楼宇后抵达目标。真实路径规划也会比较距离与风险；这里的地图仅为教学网格。',
    start: { x: 0, y: 3 }, goal: { x: 6, y: 3 }, checkpoints: [],
    buildings: [{ x: 3, y: 3, name: '楼宇' }], rows: 7, cols: 7, blockLimit: 4, stepLimit: 12,
  },
  {
    name: '双点安全走廊', subtitle: '建筑群与检查点 · 5 条指令',
    objective: '按顺序穿过沿江测绘点，再绕开建筑群抵达交付站。',
    codexId: 'solar-battery-planning', duration: 110,
    lesson: '规划时要把去程、返程和能耗一起纳入预算；任务格数只作简化的路程成本。',
    scienceAction: '你在建筑周围编排绕行，同时为有限的指令预算选择路线。真实任务还要考虑风、载荷与返航余量；游戏步数不等于真实电量。',
    start: { x: 0, y: 5 }, goal: { x: 6, y: 5 },
    checkpoints: [{ x: 4, y: 1, name: '江岸测点' }],
    buildings: [{ x: 2, y: 3, name: '高楼' }, { x: 2, y: 4, name: '高楼' }, { x: 2, y: 5, name: '高楼' }, { x: 4, y: 2, name: '楼宇' }, { x: 5, y: 2, name: '楼宇' }],
    rows: 7, cols: 7, blockLimit: 5, stepLimit: 18,
  },
  {
    name: '高峰时段编程', subtitle: '两处检查点 · 指令与步数受限',
    objective: '用不超过 4 条指令经过两处检查点，避开建筑后到达西湖东侧终点。',
    codexId: 'solar-airspace-windows', duration: 120,
    lesson: '临时禁行区与开放时段是地图约束；游戏中的围栏是抽象示意，不代表真实空域。',
    scienceAction: '你在执行前检查了全部网格和模拟禁行格。真实数字地图会标记约束并随地点与时间变化，本关围栏仅用于解释规划思路。',
    start: { x: 0, y: 5 }, goal: { x: 6, y: 5 },
    checkpoints: [{ x: 2, y: 1, name: '航路门 A' }, { x: 5, y: 1, name: '航路门 B' }],
    buildings: [{ x: 1, y: 3, name: '高楼' }, { x: 2, y: 2, name: '高楼' }, { x: 2, y: 3, name: '高楼' }, { x: 4, y: 2, name: '高楼' }, { x: 4, y: 3, name: '高楼' }, { x: 5, y: 3, name: '高楼' }],
    rows: 7, cols: 7, blockLimit: 4, stepLimit: 17,
  },
];

function drawBuilding(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, label: string): void {
  const inset = 5, dx = 8, dy = 11;
  const left = x + inset, top = y + inset, right = x + size - inset, bottom = y + size - inset;
  const roofRight = right - dx, roofBottom = bottom - dy;
  ctx.fillStyle = 'rgba(1, 8, 16, .52)';
  ctx.beginPath(); ctx.moveTo(left + 3, top + 8); ctx.lineTo(right + 6, top + dy + 8);
  ctx.lineTo(right + 7, bottom + 6); ctx.lineTo(left + 9, bottom + 6); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#183348';
  ctx.beginPath(); ctx.moveTo(left, roofBottom); ctx.lineTo(roofRight, roofBottom); ctx.lineTo(right, bottom); ctx.lineTo(left + dx, bottom); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(110, 185, 211, .42)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(left, roofBottom); ctx.lineTo(roofRight, roofBottom); ctx.lineTo(right, bottom); ctx.lineTo(left + dx, bottom); ctx.closePath(); ctx.stroke();
  ctx.fillStyle = '#0b2031';
  ctx.beginPath(); ctx.moveTo(roofRight, top); ctx.lineTo(right, top + dy); ctx.lineTo(right, bottom); ctx.lineTo(roofRight, roofBottom); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(94, 153, 190, .37)'; ctx.stroke();
  ctx.fillStyle = '#39708a';
  ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(roofRight, top); ctx.lineTo(roofRight, roofBottom); ctx.lineTo(left, roofBottom); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#294f68';
  ctx.beginPath(); ctx.moveTo(left + 3, top + 3); ctx.lineTo(roofRight - 3, top + 3); ctx.lineTo(roofRight - 3, roofBottom - 3); ctx.lineTo(left + 3, roofBottom - 3); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(152, 216, 229, .64)'; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(roofRight, top); ctx.lineTo(roofRight, roofBottom); ctx.stroke();
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
    const wx = left + 9 + c * 12, wy = roofBottom + 5 + r * 12;
    ctx.fillStyle = (r + c) % 3 ? '#95bac0' : '#e6bd6d';
    ctx.fillRect(wx, wy, 5, 4);
    ctx.fillStyle = 'rgba(3, 18, 29, .55)'; ctx.fillRect(wx + 2, wy, 1, 4);
  }
  ctx.fillStyle = '#263e4d'; ctx.fillRect(left + 5, roofBottom - 12, roofRight - left - 10, 10);
  ctx.fillStyle = '#c4dae0'; ctx.font = '10px "Noto Sans SC", sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(label, (left + roofRight) / 2, roofBottom - 4, roofRight - left - 12); ctx.textAlign = 'left';
}

function draw(ctx: CanvasRenderingContext2D, state: RouteState, level: RouteLevel, _width: number, _height: number, time: number): void {
  drawConsoleBackdrop(ctx);
  ctx.save();
  // Route program panel
  ctx.fillStyle = 'rgba(4, 12, 24, .86)';
  ctx.fillRect(34, 118, 372, 470);
  ctx.strokeStyle = 'rgba(67, 179, 221, .28)'; ctx.strokeRect(34.5, 118.5, 371, 469);
  ctx.fillStyle = '#f6bd57'; ctx.font = '700 15px "JetBrains Mono", monospace'; ctx.fillText('FLIGHT SCRIPT / 指令带', 52, 150);
  ctx.fillStyle = '#91b3c7'; ctx.font = '12px "Noto Sans SC", sans-serif';
  ctx.fillText(`积木 ${state.program.length} / ${level.blockLimit}  ·  已用步数 ${state.executedSteps} / ${level.stepLimit}`, 52, 174);

  const rowY = 191;
  for (let i = 0; i < level.blockLimit; i++) {
    const y = rowY + i * 59;
    const command = state.program[i];
    const selected = i === state.selected;
    ctx.fillStyle = selected ? 'rgba(25, 62, 78, .9)' : command ? 'rgba(13, 34, 51, .91)' : 'rgba(8, 19, 32, .74)';
    roundedPanel(ctx, 49, y + 3, 338, 47, 6); ctx.fill();
    ctx.strokeStyle = selected ? '#57d9f4' : command ? 'rgba(91, 176, 209, .55)' : 'rgba(98, 133, 157, .25)';
    ctx.lineWidth = selected ? 1.8 : 1;
    roundedPanel(ctx, 49, y, 338, 47, 6); ctx.stroke();
    ctx.strokeStyle = 'rgba(190, 224, 231, .16)';
    ctx.beginPath(); ctx.moveTo(58, y + 2); ctx.lineTo(377, y + 2); ctx.stroke();
    ctx.fillStyle = '#60849a'; ctx.font = '11px "JetBrains Mono", monospace'; ctx.fillText(String(i + 1).padStart(2, '0'), 60, y + 28);
    if (command) {
      drawInstructionBlock(ctx, command.direction, command.steps, 95, y + 5, true, selected);
      if (state.running && i === state.command) {
        ctx.fillStyle = '#f7c45e'; ctx.fillRect(192, y + 8, Math.max(3, (state.stepInCommand / command.steps) * 164), 2);
      }
    } else {
      ctx.fillStyle = 'rgba(6, 16, 27, .52)';
      roundedPanel(ctx, 95, y + 7, 85, 32, 5); ctx.fill();
      ctx.strokeStyle = 'rgba(109, 150, 170, .34)'; ctx.setLineDash([3, 3]);
      roundedPanel(ctx, 95, y + 7, 85, 32, 5); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#7691a1'; ctx.font = '12px "Noto Sans SC", sans-serif'; ctx.fillText('添加方向积木…', 195, y + 29);
    }
  }
  ctx.fillStyle = 'rgba(7, 20, 32, .82)'; ctx.fillRect(49, 501, 338, 67);
  ctx.fillStyle = state.mistakes ? '#ffac91' : '#b9d6e5'; ctx.font = '12px "Noto Sans SC", sans-serif';
  ctx.fillText(state.message, 61, 525, 310);
  ctx.fillStyle = '#6c8798'; ctx.font = '11px "JetBrains Mono", monospace'; ctx.fillText('点选积木更改步数 · 拖动积木调整顺序', 61, 550);

  // The city grid is an abstract Hangzhou map: river, streets, safe corridors and obstacles.
  const gw = level.cols * cell; const gh = level.rows * cell;
  ctx.fillStyle = 'rgba(3, 12, 23, .86)'; ctx.fillRect(gridX - 10, gridY - 10, gw + 20, gh + 20);
  ctx.strokeStyle = 'rgba(92, 169, 201, .44)'; ctx.lineWidth = 1.5; ctx.strokeRect(gridX - 10, gridY - 10, gw + 20, gh + 20);
  // Qiantang river edge as a physical geographic cue.
  ctx.fillStyle = 'rgba(9, 90, 126, .26)'; ctx.fillRect(gridX, gridY + gh - 24, gw, 18);
  ctx.strokeStyle = 'rgba(52, 193, 230, .5)'; ctx.beginPath(); ctx.moveTo(gridX, gridY + gh - 24); ctx.lineTo(gridX + gw, gridY + gh - 24); ctx.stroke();
  ctx.font = '10px "Noto Sans SC", sans-serif'; ctx.fillStyle = '#59c7e3'; ctx.fillText('钱塘江沿岸走廊', gridX + 7, gridY + gh - 10);
  for (let y = 0; y < level.rows; y++) for (let x = 0; x < level.cols; x++) {
    const px = gridX + x * cell; const py = gridY + y * cell;
    drawCityCell(ctx, px, py, cell, (x + y) % 2 !== 0);
  }
  for (const building of level.buildings) drawBuilding(ctx, gridX + building.x * cell, gridY + building.y * cell, cell, building.name);

  // Executed path leaves a non-interactive audit trace.
  if (state.trace.length > 1) {
    ctx.save(); ctx.strokeStyle = 'rgba(69, 218, 235, .66)'; ctx.lineWidth = 4; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(gridX + (state.trace[0].x + .5) * cell, gridY + (state.trace[0].y + .5) * cell);
    for (const point of state.trace.slice(1)) ctx.lineTo(gridX + (point.x + .5) * cell, gridY + (point.y + .5) * cell);
    ctx.stroke(); ctx.restore();
  }
  level.checkpoints.forEach((point, index) => {
    const cx = gridX + (point.x + .5) * cell; const cy = gridY + (point.y + .5) * cell;
    ctx.fillStyle = state.checkpoints.has(index) ? '#56e0a3' : '#f6bf5d';
    ctx.beginPath(); ctx.arc(cx, cy, 15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#122538'; ctx.font = '700 12px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.fillText(String.fromCharCode(65 + index), cx, cy + 4); ctx.textAlign = 'left';
    ctx.fillStyle = '#e9f4fa'; ctx.font = '10px "Noto Sans SC", sans-serif'; ctx.fillText(point.name, cx - 26, cy - 21);
  });
  for (const [point, label, color] of [[level.start, '起', '#6ccfff'], [level.goal, '终', '#75e4a4']] as const) {
    const cx = gridX + (point.x + .5) * cell; const cy = gridY + (point.y + .5) * cell;
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, 24 + Math.sin(time * 4) * 2, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = color; ctx.font = '700 13px "Noto Sans SC", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(label, cx, cy + 4); ctx.textAlign = 'left';
  }
  const droneX = gridX + (state.drone.x + .5) * cell; const droneY = gridY + (state.drone.y + .5) * cell;
  drawRouteDrone(ctx, state, droneX, droneY, time);
  drawLabel(ctx, state.running ? '执行中 · 单步可见' : '点击运行观察飞行路径', gridX, gridY - 22, state.running ? '#7be8f3' : '#92adbd');
  ctx.restore();
}

function pointer(state: RouteState, event: MiniGamePointer, level: RouteLevel): void {
  const rowY = 191;
  if (event.type === 'down' && event.x >= 49 && event.x <= 387 && event.y >= rowY && event.y < rowY + level.blockLimit * 59) {
    const index = Math.floor((event.y - rowY) / 59);
    if (index < state.program.length) {
      state.dragging = index; state.dragY = event.y; state.dragStarted = false; state.selected = index;
    }
  } else if (event.type === 'move' && state.dragging >= 0 && Math.abs(event.y - state.dragY) > 9) {
    state.dragStarted = true;
  } else if ((event.type === 'up' || event.type === 'cancel') && state.dragging >= 0) {
    if (state.dragStarted && event.x >= 49 && event.x <= 387 && event.y >= rowY && event.y < rowY + level.blockLimit * 59) {
      const target = clamp(Math.floor((event.y - rowY) / 59), 0, state.program.length - 1);
      const [item] = state.program.splice(state.dragging, 1); state.program.splice(target, 0, item); state.selected = target;
    }
    state.dragging = -1; state.dragStarted = false;
  }
}

function append(state: RouteState, direction: Direction, level: RouteLevel): void {
  if (state.running) return;
  if (state.program.length >= level.blockLimit) { state.message = '指令位已满；删掉或重排积木，保持程序简洁。'; return; }
  state.program.push({ direction, steps: 1 });
  state.selected = state.program.length - 1;
  state.message = `${directionGlyph[direction]} 方向积木已加入；点选它可调整步数。`;
}

function editControl(state: RouteState, controlId: string, phase: 'down' | 'up', level: RouteLevel): void {
  if (phase !== 'down') return;
  const direction = controlId as Direction;
  if (direction in movement) { append(state, direction, level); return; }
  if (controlId === 'addStep' || controlId === 'removeStep') {
    if (state.selected < 0) { state.message = '先点选一块积木，再改变步数。'; return; }
    const item = state.program[state.selected];
    item.steps = clamp(item.steps + (controlId === 'addStep' ? 1 : -1), 1, level.stepLimit);
    state.message = `${directionGlyph[item.direction]} 指令现在移动 ${item.steps} 格。`;
  } else if (controlId === 'remove') {
    if (state.selected >= 0) { state.program.splice(state.selected, 1); state.selected = Math.min(state.selected, state.program.length - 1); state.message = '积木已移出程序带。'; }
  } else if (controlId === 'step') {
    if (!state.running) tryStep(state, level);
  } else if (controlId === 'run') {
    if (state.running) { state.running = false; state.message = '已暂停；可以单步检查路径。'; }
    else run(state, level);
  } else if (controlId === 'reset') {
    state.program = []; state.selected = -1; state.running = false; state.drone = { ...level.start }; state.trace = [{ ...level.start }]; state.checkpoints.clear(); state.command = 0; state.stepInCommand = 0; state.executedSteps = 0; state.mistakes = 0; state.totalMistakes = 0; state.message = '程序已清空，请重新编排。';
  }
}

export const solarGame = createCanvasMiniGame<RouteState, RouteLevel>({
  meta: {
    id: 'solar', number: '02', shortTitle: '航线编程', title: '杭州低空航线编程',
    enTitle: 'CITY ROUTE PROGRAMMER', moduleName: '杭州安全走廊规划台',
    genre: '方向积木与逐步调试', tagline: '先编排航线指令，再观察无人机逐格执行',
    accent: '#f59e0b', hubAnchor: { x: .28, y: .35 },
    briefingSteps: [
      { title: '编排方向积木', desc: '加入上、下、左、右指令，调整每块积木的移动步数。' },
      { title: '运行并检查', desc: '点击运行逐格观察，建筑会真实阻断航线；出错后可以修改并重试。' },
      { title: '优化指令', desc: '经过地图检查点并抵达终点；较少的有效指令会得到更高评价。' },
    ],
    controlsHint: '方向积木 / 点击积木选中 · ± 调步数 · 单步检查 · Space/Enter 运行 · Backspace 删除',
  },
  levels,
  controls: [
    { id: 'up', label: '上 ↑' }, { id: 'right', label: '右 →' }, { id: 'down', label: '下 ↓' }, { id: 'left', label: '左 ←' },
    { id: 'removeStep', label: '− 步' }, { id: 'addStep', label: '+ 步' },
    { id: 'step', label: '单步' }, { id: 'run', label: '运行 / 暂停', tone: 'gold' },
    { id: 'remove', label: '删积木' }, { id: 'reset', label: '清空' },
  ],
  createState: initialState,
  update(state, dt, level) {
    if (!state.running) return;
    state.stepClock += dt;
    while (state.stepClock >= .27 && state.running) { state.stepClock -= .27; tryStep(state, level); }
  },
  draw,
  pointer,
  control: editControl,
  key(state, key, phase, level) {
    if (phase !== 'down') return;
    const keyDirections: Record<string, Direction> = { ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down', ArrowLeft: 'left' };
    if (keyDirections[key]) append(state, keyDirections[key], level);
    else if (key === '+' || key === '=') editControl(state, 'addStep', 'down', level);
    else if (key === '-') editControl(state, 'removeStep', 'down', level);
    else if (key === 'Backspace') editControl(state, 'remove', 'down', level);
    else if (key === 'Enter' || key === ' ') editControl(state, 'run', 'down', level);
    else if (key === '.') editControl(state, 'step', 'down', level);
  },
  metrics(state, level, time) {
    const checks = state.checkpoints.size;
    return [
      { id: 'program', label: '指令積木', value: `${state.program.length} / ${level.blockLimit}`, ratio: state.program.length / level.blockLimit, status: state.program.length > level.blockLimit - 1 ? 'caution' : 'info' },
      { id: 'flight', label: '已执行步数', value: `${state.executedSteps} / ${level.stepLimit}`, ratio: state.executedSteps / level.stepLimit, status: state.executedSteps > level.stepLimit ? 'critical' : 'nominal' },
      { id: 'checks', label: '检查点', value: `${checks} / ${level.checkpoints.length}`, ratio: level.checkpoints.length ? checks / level.checkpoints.length : (state.drone.x === level.goal.x && state.drone.y === level.goal.y ? 1 : 0), status: state.message.includes('受阻') ? 'caution' : 'info' },
      { id: 'clock', label: '规划时间', value: `${Math.max(0, Math.ceil(level.duration - time))} 秒`, status: time > level.duration * .8 ? 'caution' : 'nominal' },
    ];
  },
  progress(state, level) { return { current: state.checkpoints.size + (state.drone.x === level.goal.x && state.drone.y === level.goal.y ? 1 : 0), total: level.checkpoints.length + 1 }; },
  outcome(state, level, time) {
    const won = !state.running && state.drone.x === level.goal.x && state.drone.y === level.goal.y && level.checkpoints.every((_point, index) => state.checkpoints.has(index));
    if (!won) return null;
    const efficiency = Math.max(0, level.stepLimit - state.executedSteps) * 12 + Math.max(0, level.blockLimit - state.program.length) * 25;
    const score = clamp(1000 - Math.max(0, time) * 2.2 - state.program.length * 30 - state.totalMistakes * 140 + efficiency, 400, 1000);
    return { won: true, score, summary: `航线程序通过：${state.program.length} 条指令、${state.executedSteps} 步完成全程。${state.totalMistakes ? `执行中出现 ${state.totalMistakes} 次阻断，已通过修改程序修正。` : '规划一次运行安全抵达。'}`, metrics: [
      { label: '指令数量', value: `${state.program.length} 条` }, { label: '执行步数', value: `${state.executedSteps} 格` }, { label: '检查点', value: `${state.checkpoints.size} / ${level.checkpoints.length}` }, { label: '程序阻断', value: `${state.totalMistakes} 次` },
    ] };
  },
});
