import {
  createCanvasMiniGame,
  drawConsoleBackdrop,
  drawLabel,
  type MiniGameLevel,
} from '../../core/canvas-minigame';
import { clamp } from '../../core/canvas-utils';

interface Building {
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
  roof: string;
}

interface Pole {
  x: number;
  y: number;
  name: string;
}

interface WindZone {
  x: number;
  y: number;
  rx: number;
  ry: number;
  vx: number;
  vy: number;
  label: string;
  color: string;
}

interface DeliveryTarget {
  x: number;
  y: number;
  name: string;
  detail: string;
}

interface FlightLevel extends MiniGameLevel {
  spawn: { x: number; y: number };
  targets: DeliveryTarget[];
  windZones: WindZone[];
  baseWind: { x: number; y: number };
  targetRadius: number;
  speedLimit: number;
}

interface TrailPoint {
  x: number;
  y: number;
  age: number;
}

interface DeliveryEffect {
  x: number;
  y: number;
  age: number;
  grade: string;
  score: number;
}

interface FlightState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  keys: Set<string>;
  braking: boolean;
  cargoLoaded: boolean;
  targetIndex: number;
  score: number;
  battery: number;
  combo: number;
  bestCombo: number;
  precisionTotal: number;
  elapsed: number;
  windX: number;
  windY: number;
  windStrength: number;
  trail: TrailPoint[];
  dropEffects: DeliveryEffect[];
  feedback: string;
  feedbackTone: 'good' | 'warn' | 'bad';
  feedbackAge: number;
  crashReason: string | null;
}

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 700;
const DRONE_HIT_RADIUS = 22;
const DRONE_MAX_SPEED = 190;
const DRONE_ACCELERATION = 154;

const BUILDINGS: Building[] = [
  { x: 88, y: 273, w: 128, h: 62, name: '运河里社区', roof: '#536b70' },
  { x: 264, y: 266, w: 130, h: 68, name: '沿河商务楼', roof: '#53616b' },
  { x: 596, y: 266, w: 118, h: 68, name: '城市服务中心', roof: '#5a666c' },
  { x: 786, y: 273, w: 144, h: 62, name: '街道卫生站', roof: '#586c66' },
  { x: 86, y: 386, w: 142, h: 112, name: '运河文化驿站', roof: '#58646c' },
  { x: 287, y: 386, w: 116, h: 106, name: '临河住宅', roof: '#586d70' },
  { x: 598, y: 384, w: 126, h: 108, name: '水岸公寓', roof: '#566776' },
  { x: 790, y: 382, w: 132, h: 118, name: '社区服务站', roof: '#5e6c65' },
  { x: 182, y: 624, w: 120, h: 52, name: '南街商铺', roof: '#625f56' },
  { x: 623, y: 624, w: 134, h: 52, name: '沿街仓库', roof: '#5e625b' },
];

const POLES: Pole[] = [
  { x: 432, y: 557, name: '南街电线杆' },
  { x: 557, y: 414, name: '路口灯杆' },
  { x: 746, y: 557, name: '社区路灯' },
  { x: 454, y: 279, name: '沿河通信杆' },
];

const LEVELS: FlightLevel[] = [
  {
    name: '社区急救线',
    subtitle: '教学航线 · 微风与宽阔道路',
    objective: '依次把 3 份急救包送到社区落点；进圈并减速后按 Space 投放。',
    codexId: 'docking-flight-basics',
    duration: 120,
    lesson: '无人机有惯性：松开方向后仍会滑行，接近落点时要提前减速。',
    scienceAction: '你通过轻推、松开和反向修正控制无人机惯性，并在低地速下完成急救包投递。',
    spawn: { x: 72, y: 558 },
    targets: [
      { x: 322, y: 558, name: '大运河社区', detail: '临时急救点 · 01' },
      { x: 520, y: 304, name: '桥西街道', detail: '社区卫生站 · 02' },
      { x: 864, y: 558, name: '水岸安置点', detail: '救援物资接收点 · 03' },
    ],
    windZones: [
      { x: 395, y: 327, rx: 172, ry: 102, vx: 21, vy: -5, label: '河面微风', color: '#69d5e8' },
    ],
    baseWind: { x: 0, y: 0 },
    targetRadius: 57,
    speedLimit: 72,
  },
  {
    name: '侧风穿街',
    subtitle: '侧风航段 · 提前修正路线',
    objective: '在横向风中连续投递 3 份物资；观察风流，别等偏航后再猛打方向。',
    codexId: 'docking-hover-control',
    duration: 125,
    lesson: '沿街楼群会改变近地气流；小幅、提前的侧向修正比临近目标急转更稳。',
    scienceAction: '你辨认出穿街侧风造成的航迹偏移，并以提前修正代替临门急转。',
    spawn: { x: 72, y: 558 },
    targets: [
      { x: 322, y: 558, name: '大运河社区', detail: '临时急救点 · 01' },
      { x: 520, y: 304, name: '桥西街道', detail: '社区卫生站 · 02' },
      { x: 864, y: 558, name: '水岸安置点', detail: '救援物资接收点 · 03' },
    ],
    windZones: [
      { x: 350, y: 318, rx: 192, ry: 112, vx: 35, vy: 24, label: '运河横风', color: '#73d8ee' },
      { x: 723, y: 323, rx: 168, ry: 122, vx: -21, vy: 28, label: '楼间回流', color: '#a9dc87' },
    ],
    baseWind: { x: 0, y: 0 },
    targetRadius: 52,
    speedLimit: 66,
  },
  {
    name: '暴雨后急送',
    subtitle: '阵风挑战 · 顺风提速也要稳住落点',
    objective: '穿过钱塘风廊的阵风区，完成 3 次低速精准投递；撞楼或杆体会立即终止任务。',
    codexId: 'docking-urban-wind',
    duration: 130,
    lesson: '顺风能缩短航程，也会让无人机更难停下；刹车减弱风扰，但会消耗电量。',
    scienceAction: '你利用顺风穿越街区，同时通过提前刹车和反向推力控制落点地速。',
    spawn: { x: 72, y: 558 },
    targets: [
      { x: 322, y: 558, name: '大运河社区', detail: '临时急救点 · 01' },
      { x: 520, y: 304, name: '桥西街道', detail: '社区卫生站 · 02' },
      { x: 864, y: 558, name: '水岸安置点', detail: '救援物资接收点 · 03' },
    ],
    windZones: [
      { x: 330, y: 327, rx: 192, ry: 116, vx: 46, vy: -20, label: '沿河顺风', color: '#75d9ef' },
      { x: 717, y: 328, rx: 174, ry: 125, vx: -31, vy: 42, label: '楼群阵风', color: '#ffc477' },
    ],
    baseWind: { x: 0, y: 0 },
    targetRadius: 48,
    speedLimit: 60,
  },
];

function newFlightState(level: FlightLevel): FlightState {
  return {
    x: level.spawn.x,
    y: level.spawn.y,
    vx: 0,
    vy: 0,
    heading: -0.1,
    keys: new Set(),
    braking: false,
    cargoLoaded: true,
    targetIndex: 0,
    score: 0,
    battery: 100,
    combo: 0,
    bestCombo: 0,
    precisionTotal: 0,
    elapsed: 0,
    windX: 0,
    windY: 0,
    windStrength: 0,
    trail: [],
    dropEffects: [],
    feedback: '物资已装载 · 观察风向，稳住后再投放',
    feedbackTone: 'good',
    feedbackAge: 3,
    crashReason: null,
  };
}

function setFeedback(state: FlightState, text: string, tone: FlightState['feedbackTone']): void {
  state.feedback = text;
  state.feedbackTone = tone;
  state.feedbackAge = 2.2;
}

function getCurrentWind(level: FlightLevel, x: number, y: number, time: number): { x: number; y: number; strength: number } {
  let wx = level.baseWind.x;
  let wy = level.baseWind.y;
  let strength = 0;

  for (const zone of level.windZones) {
    const dx = (x - zone.x) / zone.rx;
    const dy = (y - zone.y) / zone.ry;
    const distance = Math.hypot(dx, dy);
    const weight = clamp(1 - distance, 0, 1);
    const falloff = weight * weight * (3 - 2 * weight);
    wx += (zone.vx + Math.sin(time * 0.55 + zone.x) * 1.4) * falloff;
    wy += (zone.vy + Math.cos(time * 0.47 + zone.y) * 1.1) * falloff;
    strength = Math.max(strength, falloff);
  }

  return { x: wx, y: wy, strength };
}

function attemptDelivery(state: FlightState, level: FlightLevel): void {
  if (state.crashReason || !state.cargoLoaded || state.targetIndex >= level.targets.length) return;
  const target = level.targets[state.targetIndex];
  const distance = Math.hypot(state.x - target.x, state.y - target.y);
  const speed = Math.hypot(state.vx, state.vy);

  if (distance > level.targetRadius) {
    setFeedback(state, `不在投递圈内 · 距落点 ${Math.round(distance)} u，物资未消耗`, 'warn');
    return;
  }
  if (speed > level.speedLimit) {
    setFeedback(state, `模拟地速 ${Math.round(speed)} u/s 过快 · 上限 ${level.speedLimit} u/s`, 'warn');
    return;
  }

  const accuracy = clamp(1 - distance / level.targetRadius, 0, 1);
  const precisionPoints = Math.round(accuracy * 100);
  const timeBonus = Math.round(clamp(1 - state.elapsed / level.duration, 0, 1) * 45);
  state.combo += 1;
  state.bestCombo = Math.max(state.bestCombo, state.combo);
  state.precisionTotal += accuracy;
  const chainBonus = Math.min(36, (state.combo - 1) * 12);
  const earned = 150 + precisionPoints + timeBonus + chainBonus;
  state.score = Math.min(1000, state.score + earned);
  const grade = accuracy >= 0.82 ? 'S' : accuracy >= 0.62 ? 'A' : accuracy >= 0.36 ? 'B' : 'C';
  state.dropEffects.push({ x: target.x, y: target.y, age: 0, grade, score: earned });
  setFeedback(state, `急救包已投放 · ${grade} 级精度 · +${earned} 分`, 'good');
  state.targetIndex += 1;
  state.cargoLoaded = state.targetIndex < level.targets.length;
}

function circleTouchesRect(x: number, y: number, radius: number, rect: Building): boolean {
  const closestX = clamp(x, rect.x, rect.x + rect.w);
  const closestY = clamp(y, rect.y, rect.y + rect.h);
  return Math.hypot(x - closestX, y - closestY) < radius;
}

function crash(state: FlightState, reason: string): void {
  if (state.crashReason) return;
  state.crashReason = reason;
  state.vx = 0;
  state.vy = 0;
  state.braking = false;
  setFeedback(state, `碰撞 · ${reason}`, 'bad');
}

function drawRoad(ctx: CanvasRenderingContext2D, drawCenter = true): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const roads: ((ctx: CanvasRenderingContext2D) => void)[] = [
    (c) => { c.moveTo(-30, 350); c.bezierCurveTo(235, 332, 720, 375, 1030, 345); },
    (c) => { c.moveTo(-35, 565); c.bezierCurveTo(265, 542, 690, 590, 1035, 548); },
    (c) => { c.moveTo(500, -30); c.bezierCurveTo(484, 190, 520, 460, 500, 735); },
    (c) => { c.moveTo(197, 540); c.bezierCurveTo(295, 468, 365, 420, 470, 350); },
    (c) => { c.moveTo(545, 350); c.bezierCurveTo(620, 417, 704, 487, 774, 548); },
  ];

  for (const path of roads) {
    ctx.beginPath();
    path(ctx);
    ctx.strokeStyle = '#32474c';
    ctx.lineWidth = 69;
    ctx.stroke();
    ctx.strokeStyle = '#202e35';
    ctx.lineWidth = 57;
    ctx.stroke();
    if (drawCenter) {
      ctx.strokeStyle = 'rgba(213, 201, 154, .30)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([13, 17]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  ctx.restore();
}

function drawWetRoads(ctx: CanvasRenderingContext2D, time: number): void {
  const pools = [
    [82, 353, 32, 7], [248, 558, 36, 8], [464, 348, 31, 7], [676, 568, 43, 9], [914, 346, 34, 7],
  ];
  ctx.save();
  for (let i = 0; i < pools.length; i++) {
    const [x, y, rx, ry] = pools[i];
    ctx.fillStyle = `rgba(94, 181, 198, ${0.12 + 0.025 * Math.sin(time * 1.4 + i)})`;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, i % 2 ? -0.08 : 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(174, 222, 226, .22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x - 3, y - 1, rx * 0.55, ry * 0.42, 0.05, Math.PI * 1.05, Math.PI * 1.85);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWindZones(ctx: CanvasRenderingContext2D, level: FlightLevel, time: number): void {
  for (const zone of level.windZones) {
    const length = Math.hypot(zone.vx, zone.vy);
    const ux = zone.vx / Math.max(1, length);
    const uy = zone.vy / Math.max(1, length);
    const angle = Math.atan2(uy, ux);
    const pulse = 0.5 + Math.sin(time * 1.6 + zone.x) * 0.045;

    ctx.save();
    ctx.translate(zone.x, zone.y);
    ctx.rotate(angle);
    ctx.fillStyle = `${zone.color}12`;
    ctx.strokeStyle = `${zone.color}3f`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 9]);
    ctx.beginPath();
    ctx.ellipse(0, 0, zone.rx * (0.94 + pulse * 0.06), zone.ry * (0.94 + pulse * 0.06), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalAlpha = 0.65;
    for (let row = -2; row <= 2; row++) {
      const y = row * zone.ry * 0.26;
      const phase = (time * 36 + row * 71 + zone.x) % (zone.rx * 1.55);
      const x = -zone.rx * 0.76 + phase;
      const size = 17 + (row % 2 === 0 ? 5 : 0);
      ctx.strokeStyle = zone.color;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(x - size * 0.55, y);
      ctx.lineTo(x + size * 0.55, y);
      ctx.lineTo(x + size * 0.2, y - 4);
      ctx.moveTo(x + size * 0.55, y);
      ctx.lineTo(x + size * 0.2, y + 4);
      ctx.stroke();
    }
    ctx.restore();

  }
}

// Render-only depth: roofs and walls stay inside the authoritative solid footprint.
// Scene lighting comes from the upper left; shadows never participate in collision.
function drawPolygon(ctx: CanvasRenderingContext2D, points: readonly (readonly [number, number])[], fill: string | CanvasGradient, stroke?: string): void {
  ctx.beginPath();
  points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}

function drawBuilding(ctx: CanvasRenderingContext2D, building: Building, index: number): void {
  const { x, y, w, h } = building;
  const dx = 10 + index % 3 * 2;
  const dy = Math.min(h * 0.4, 24 + index % 3 * 4);
  const right = x + w, bottom = y + h;
  const roofRight = right - dx, roofBottom = bottom - dy;
  const roofW = w - dx, roofH = h - dy;
  ctx.save();
  ctx.lineWidth = 1;
  drawPolygon(ctx, [[x + 3, y + 9], [right + 10, y + dy + 9], [right + 13, bottom + 12], [x + 13, bottom + 12]], 'rgba(2, 8, 12, .30)');
  ctx.fillStyle = '#394c50';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(188, 212, 205, .26)';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  const front = ctx.createLinearGradient(0, roofBottom, 0, bottom);
  front.addColorStop(0, '#536970');
  front.addColorStop(0.22, '#344b55');
  front.addColorStop(1, '#1e303a');
  drawPolygon(ctx, [[x, roofBottom], [roofRight, roofBottom], [right, bottom], [x + dx, bottom]], front);
  const side = ctx.createLinearGradient(roofRight, 0, right, 0);
  side.addColorStop(0, '#2b424c'); side.addColorStop(1, '#172933');
  drawPolygon(ctx, [[roofRight, y], [right, y + dy], [right, bottom], [roofRight, roofBottom]], side);

  const floors = Math.max(2, Math.floor(dy / 7));
  const bays = Math.floor((roofW - 12) / 14);
  for (let floor = 0; floor < floors; floor++) {
    const t = (floor + 0.5) / floors;
    const wallY = roofBottom + dy * t, wallX = x + dx * t;
    ctx.strokeStyle = 'rgba(155, 186, 191, .22)';
    ctx.beginPath();
    ctx.moveTo(wallX, wallY + 3); ctx.lineTo(wallX + roofW, wallY + 3); ctx.stroke();
    for (let bay = 0; bay < bays; bay++) {
      const wx = wallX + 8 + bay * 14;
      drawPolygon(ctx, [[wx, wallY - 2], [wx + 8, wallY - 2], [wx + 9, wallY + 2], [wx + 1, wallY + 2]], (bay * 3 + floor + index) % 5 === 0 ? '#cfb982' : '#71939e');
      ctx.fillStyle = 'rgba(6, 19, 27, .65)'; ctx.fillRect(wx + 4, wallY - 2, 1, 4);
    }
  }
  for (let row = 0; row < Math.max(2, Math.floor(roofH / 12)); row++) {
    const wy = y + 7 + row * 12;
    drawPolygon(ctx, [[roofRight + 3, wy + 6], [right - 3, wy + dy - 5], [right - 3, wy + dy], [roofRight + 3, wy + 11]], row % 4 === index % 4 ? '#b0a17d' : '#476675');
  }

  const roof = ctx.createLinearGradient(x, y, roofRight, roofBottom);
  roof.addColorStop(0, '#879a98'); roof.addColorStop(0.18, building.roof); roof.addColorStop(1, '#3e535b');
  ctx.fillStyle = roof; ctx.fillRect(x, y, roofW, roofH);
  ctx.strokeStyle = '#adc3bc'; ctx.strokeRect(x + 0.5, y + 0.5, roofW - 1, roofH - 1);
  ctx.strokeStyle = 'rgba(17, 34, 41, .8)'; ctx.lineWidth = 3;
  ctx.strokeRect(x + 4, y + 4, roofW - 8, roofH - 8);
  ctx.strokeStyle = 'rgba(180, 203, 197, .37)'; ctx.lineWidth = 1;
  ctx.strokeRect(x + 6, y + 6, roofW - 12, roofH - 12);
  ctx.strokeStyle = 'rgba(20, 38, 44, .22)';
  for (let sx = x + 24; sx < roofRight - 6; sx += 25) {
    ctx.beginPath(); ctx.moveTo(sx, y + 7); ctx.lineTo(sx, roofBottom - 7); ctx.stroke();
  }

  const ex = x + roofW * 0.58, ey = y + 11;
  ctx.fillStyle = 'rgba(7, 19, 25, .4)'; ctx.fillRect(ex + 4, ey + 4, 23, 12);
  drawPolygon(ctx, [[ex, ey + 6], [ex + 21, ey + 6], [ex + 24, ey + 11], [ex + 3, ey + 11]], '#354a53');
  drawPolygon(ctx, [[ex + 21, ey], [ex + 24, ey + 5], [ex + 24, ey + 11], [ex + 21, ey + 6]], '#2a3c44');
  ctx.fillStyle = '#a5b5af'; ctx.fillRect(ex, ey, 21, 6);
  ctx.strokeStyle = '#526b70';
  for (let vent = 3; vent < 20; vent += 4) {
    ctx.beginPath(); ctx.moveTo(ex + vent, ey + 1); ctx.lineTo(ex + vent, ey + 5); ctx.stroke();
  }
  if (roofH > 55) {
    ctx.fillStyle = '#2b414b'; ctx.fillRect(x + 15, y + 16, 22, 15);
    drawPolygon(ctx, [[x + 13, y + 13], [x + 33, y + 13], [x + 36, y + 26], [x + 16, y + 26]], '#638e9b', '#a7c6c9');
    ctx.beginPath(); ctx.moveTo(x + 23, y + 13); ctx.lineTo(x + 26, y + 26); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(13, 30, 37, .72)'; ctx.fillRect(x + 9, roofBottom - 17, roofW - 18, 13);
  ctx.fillStyle = '#d0ded5'; ctx.font = '10px "Noto Sans SC", sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(building.name, x + roofW / 2, roofBottom - 7, roofW - 24);
  ctx.strokeStyle = 'rgba(213, 227, 216, .72)';
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(roofRight, y); ctx.lineTo(roofRight, roofBottom);
  ctx.lineTo(right, bottom); ctx.stroke();
  ctx.restore();
}

function drawPole(ctx: CanvasRenderingContext2D, pole: Pole, time: number): void {
  ctx.save();
  ctx.fillStyle = 'rgba(2, 7, 11, .34)';
  ctx.beginPath();
  ctx.ellipse(pole.x + 3, pole.y + 5, 13, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#33434a';
  ctx.strokeStyle = '#b5c4c2';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(pole.x, pole.y, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = `rgba(255, 203, 112, ${0.44 + 0.15 * Math.sin(time * 4 + pole.x)})`;
  ctx.beginPath();
  ctx.arc(pole.x, pole.y, 13, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#f7c66e';
  ctx.beginPath();
  ctx.arc(pole.x, pole.y, 2.2, 0, Math.PI * 2);
  ctx.fill();
  drawLabel(ctx, pole.name, pole.x + 13, pole.y - 8, '#c0d0ce');
  ctx.restore();
}

function drawTarget(ctx: CanvasRenderingContext2D, target: DeliveryTarget, level: FlightLevel, index: number, active: boolean, passed: boolean, time: number): void {
  const pulse = 0.5 + Math.sin(time * 4.2) * 0.5;
  const color = active ? '#ffd16d' : passed ? '#5dd6a4' : '#78909a';
  const radius = level.targetRadius;

  ctx.save();
  ctx.globalAlpha = active ? 0.75 : 0.32;
  ctx.strokeStyle = active ? `rgba(255, 209, 109, ${0.45 + pulse * 0.28})` : color;
  ctx.lineWidth = active ? 2.5 : 1.5;
  ctx.setLineDash(active ? [7, 6] : []);
  ctx.beginPath();
  ctx.arc(target.x, target.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  if (active) {
    ctx.strokeStyle = '#ffe5a6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(target.x, target.y, 13 + pulse * 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(target.x - 8, target.y);
    ctx.lineTo(target.x + 8, target.y);
    ctx.moveTo(target.x, target.y - 8);
    ctx.lineTo(target.x, target.y + 8);
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(target.x, target.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  drawLabel(ctx, `${target.name}  ${active ? '当前落点' : passed ? '已送达' : `第 ${index + 1} 站`}`, target.x - radius, target.y - radius - 12, color);
  ctx.restore();
}

// Orthographic aircraft assembly: visual yaw/bank/height never alter the hit circle.
// Restrained pitch, four rotor discs and no additional mutable game-loop state.
function drawDrone(ctx: CanvasRenderingContext2D, state: FlightState, time: number): void {
  const speed = Math.hypot(state.vx, state.vy);
  const braking = state.braking && state.battery > 0;
  const destroyed = Boolean(state.crashReason);
  const yaw = state.heading;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const forward = (state.vx * cy + state.vy * sy) / DRONE_MAX_SPEED;
  const sideways = (-state.vx * sy + state.vy * cy) / DRONE_MAX_SPEED;
  const pitch = destroyed ? 0.24 : clamp(forward, -1, 1) * (braking ? -0.09 : 0.14);
  const roll = destroyed ? -0.2 : clamp(sideways, -1, 1) * 0.12;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const hover = destroyed ? 0 : Math.sin(time * 3) * 0.35;
  const project = (x: number, y: number, z: number): [number, number] => {
    const px = x * cp + z * sp, pz = z * cp - x * sp;
    const py = y * cr - pz * sr, height = y * sr + pz * cr;
    return [px * cy - py * sy, (px * sy + py * cy) * 0.86 - height * 0.65 + 4 - hover];
  };
  const segment = (a: [number, number, number], b: [number, number, number], color: string, width: number): void => {
    const p = project(...a), q = project(...b);
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(...p); ctx.lineTo(...q); ctx.stroke();
  };
  const box = (x: number, y: number, w: number, d: number, z: number, height: number, top: string, side: string): void => {
    const base = [project(x, y, z), project(x + w, y, z), project(x + w, y + d, z), project(x, y + d, z)];
    const roof = [project(x, y, z + height), project(x + w, y, z + height), project(x + w, y + d, z + height), project(x, y + d, z + height)];
    const faces = [0, 1, 2, 3].sort((a, b) => (base[a][1] + base[(a + 1) % 4][1]) - (base[b][1] + base[(b + 1) % 4][1]));
    for (const i of faces) {
      const j = (i + 1) % 4;
      drawPolygon(ctx, [base[i], base[j], roof[j], roof[i]], side, '#253841');
    }
    drawPolygon(ctx, roof, top, 'rgba(221, 234, 225, .5)');
  };

  ctx.save(); ctx.translate(state.x, state.y);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.save(); ctx.translate(6, 9); ctx.rotate(yaw);
  ctx.fillStyle = 'rgba(1, 7, 12, .28)';
  ctx.beginPath(); ctx.ellipse(0, 0, 22, 14, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(1, 7, 12, .25)'; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(-16, -14); ctx.lineTo(16, 14);
  ctx.moveTo(-16, 14); ctx.lineTo(16, -14); ctx.stroke(); ctx.restore();
  if (braking && !destroyed) {
    ctx.strokeStyle = 'rgba(255, 208, 115, .64)'; ctx.lineWidth = 1.4;
    for (let side = 0; side < 4; side++) {
      ctx.beginPath(); ctx.arc(0, 0, 31, side * Math.PI / 2 + 0.2, side * Math.PI / 2 + 0.9); ctx.stroke();
    }
  }

  // Skids and a medical case sit physically underneath the fuselage.
  for (const side of [-1, 1]) {
    segment([-10, side * 6, 0], [10, side * 6, 0], '#172831', 2.7);
    segment([-9, side * 6, 0.4], [9, side * 6, 0.4], '#7b8d91', 0.9);
    segment([-7, side * 4, 5], [-7, side * 6, 0], '#495d65', 1.8);
    segment([8, side * 4, 5], [8, side * 6, 0], '#495d65', 1.8);
  }
  if (state.cargoLoaded) {
    box(-7, -5, 12, 10, 0.3, 3.3, '#e9dfbd', '#aa9c7e');
    drawPolygon(ctx, [project(-3, -3.5, 3.7), project(-0.5, -3.5, 3.7), project(-0.5, 3.5, 3.7), project(-3, 3.5, 3.7)], '#b95247');
    drawPolygon(ctx, [project(-5.3, -1.2, 3.8), project(1.8, -1.2, 3.8), project(1.8, 1.2, 3.8), project(-5.3, 1.2, 3.8)], '#b95247');
  }
  const motors: [number, number, number][] = [[-15, -14, 0], [15, -14, 1], [-15, 14, 2], [15, 14, 3]];
  const motorOrder = [...motors].sort((a, b) => project(a[0], a[1], 6)[1] - project(b[0], b[1], 6)[1]);
  for (const [x, y] of motorOrder) {
    segment([x * 0.24, y * 0.25, 5], [x, y, 6], '#14232c', 4.8);
    segment([x * 0.25, y * 0.25, 6.5], [x, y, 7.5], '#879b9e', 2.2);
    segment([x * 0.52, y * 0.55, 7], [x * 0.9, y * 0.92, 7.6], '#c7d4cf', 0.7);
    const lower = project(x, y, 5.5), upper = project(x, y, 9);
    ctx.fillStyle = '#1b2a31';
    ctx.beginPath(); ctx.ellipse(...lower, 3.5, 2.8, 0, 0, Math.PI * 2); ctx.fill();
    segment([x, y, 5.5], [x, y, 9], '#657e85', 6);
    ctx.fillStyle = '#bdc9c3';
    ctx.beginPath(); ctx.ellipse(...upper, 3.3, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  }

  // Chamfered shell, raised battery and lens give an industrial rescue-aircraft silhouette.
  const shell: [number, number][] = [[-12, -5], [-8, -8], [8, -7], [15, -3.8], [15, 3.8], [8, 7], [-8, 8], [-12, 5]];
  const shellFaces = shell.map((_, i) => i).sort((a, b) => {
    const a2 = (a + 1) % shell.length, b2 = (b + 1) % shell.length;
    return project(...shell[a], 4.5)[1] + project(...shell[a2], 4.5)[1] - project(...shell[b], 4.5)[1] - project(...shell[b2], 4.5)[1];
  });
  for (const i of shellFaces) {
    const a = shell[i], b = shell[(i + 1) % shell.length];
    drawPolygon(ctx, [project(a[0], a[1], 4.5), project(b[0], b[1], 4.5), project(b[0], b[1], 9), project(a[0], a[1], 9)], destroyed ? '#554548' : '#435963', '#1b303b');
  }
  const finish = ctx.createLinearGradient(-14, -13, 14, 10);
  finish.addColorStop(0, destroyed ? '#a78c80' : '#edf0dd');
  finish.addColorStop(0.38, destroyed ? '#7e726c' : '#bbc9c2'); finish.addColorStop(1, '#718b8d');
  ctx.lineWidth = 0.8;
  drawPolygon(ctx, shell.map(([x, y]) => project(x, y, 9)), finish, '#e0e7d5');
  box(-9, -4.5, 13, 9, 9, 1.1, '#41545a', '#283d46');
  for (const y of [-2, 0, 2]) segment([-6, y, 10.2], [1, y, 10.2], '#829d9d', 0.65);
  drawPolygon(ctx, [project(6, -6, 9.2), project(9, -5, 9.2), project(9, 5, 9.2), project(6, 6, 9.2)], '#d6a347');
  const gps = project(-6, 0, 12);
  ctx.fillStyle = '#d9dfcf'; ctx.beginPath(); ctx.ellipse(...gps, 2.4, 1.8, 0, 0, Math.PI * 2); ctx.fill();
  segment([12, -3, 5], [17, -3, 4], '#354b54', 1.3);
  segment([12, 3, 5], [17, 3, 4], '#354b54', 1.3);
  const camera = project(17, 0, 4);
  ctx.fillStyle = '#1d303a'; ctx.strokeStyle = '#a1b3b3'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.arc(...camera, 3.8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  const lens = project(18.5, 0, 4.5);
  ctx.fillStyle = '#78c4d4'; ctx.beginPath(); ctx.arc(...lens, 1.9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e4f7ee'; ctx.beginPath(); ctx.arc(lens[0] - 0.5, lens[1] - 0.6, 0.6, 0, Math.PI * 2); ctx.fill();

  for (const [x, y, index] of motorOrder) {
    const z = 10.5, radius = 8.5;
    const phase = destroyed ? index : time * (36 + speed * 0.12) * (index % 2 ? -1 : 1) + index * 1.4;
    const disc: [number, number][] = [];
    for (let i = 0; i < 24; i++) {
      const angle = i * Math.PI / 12;
      disc.push(project(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, z));
    }
    if (!destroyed) {
      ctx.lineWidth = 0.65; drawPolygon(ctx, disc, 'rgba(201, 225, 220, .10)', 'rgba(208, 230, 224, .28)');
    }
    for (const blade of [0, Math.PI]) {
      const angle = phase + blade;
      const along = (r: number, offset: number): [number, number] => project(x + Math.cos(angle) * r - Math.sin(angle) * offset, y + Math.sin(angle) * r + Math.cos(angle) * offset, z);
      drawPolygon(ctx, [along(1.2, -0.7), along(6.5, -1.1), along(radius, 0), along(7.4, 1.25), along(1.2, 0.7)], destroyed ? '#4f5d61' : 'rgba(209, 223, 214, .76)');
    }
    const hub = project(x, y, z + 0.6);
    ctx.fillStyle = '#273e48'; ctx.beginPath(); ctx.arc(...hub, 1.6, 0, Math.PI * 2); ctx.fill();
    const light = project(x * 0.87, y * 0.9, 7.5);
    ctx.fillStyle = destroyed ? '#b26f50' : x > 0 ? '#79dbba' : '#eb8c75';
    ctx.beginPath(); ctx.arc(...light, 1.25, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawDeliveryEffect(ctx: CanvasRenderingContext2D, effect: DeliveryEffect): void {
  const t = clamp(effect.age / 1.05, 0, 1);
  const radius = 8 + t * 42;
  ctx.save();
  ctx.globalAlpha = 1 - t;
  ctx.strokeStyle = '#ffe193';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#ffe6a4';
  ctx.beginPath();
  ctx.roundRect(effect.x - 7, effect.y - 5 - t * 8, 14, 10, 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 240, 200, .8)';
  ctx.beginPath();
  ctx.moveTo(effect.x - 7, effect.y - 5 - t * 8); ctx.lineTo(effect.x, effect.y - 13 - t * 8);
  ctx.lineTo(effect.x + 7, effect.y - 5 - t * 8);
  ctx.stroke();
  ctx.font = '700 16px "Chakra Petch", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff0c8';
  ctx.fillText(`${effect.grade}  +${effect.score}`, effect.x, effect.y - 26 - t * 12);
  ctx.restore();
}

function drawTelemetryPanel(ctx: CanvasRenderingContext2D, state: FlightState, level: FlightLevel, time: number): void {
  const timeLeft = Math.max(0, level.duration - time);
  const timeText = `${Math.floor(timeLeft / 60).toString().padStart(2, '0')}:${Math.floor(timeLeft % 60).toString().padStart(2, '0')}`;

  // The shared HUD owns target, speed and battery; this small center strip adds only score and chain.
  ctx.fillStyle = 'rgba(5, 16, 23, .92)';
  ctx.strokeStyle = 'rgba(126, 181, 183, .48)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(350, 14, 300, 102, 7);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = 'rgba(126, 181, 183, .24)';
  ctx.beginPath();
  ctx.moveTo(450, 24); ctx.lineTo(450, 66);
  ctx.moveTo(550, 24); ctx.lineTo(550, 66);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.font = '9px "JetBrains Mono", monospace';
  ctx.fillStyle = '#9fb6b7';
  ctx.fillText('TIME', 400, 32);
  ctx.fillText('SCORE', 500, 32);
  ctx.fillText('CHAIN', 600, 32);
  ctx.font = '700 20px "Chakra Petch", sans-serif';
  ctx.fillStyle = timeLeft < 20 ? '#ff9985' : '#e0f1e9';
  ctx.fillText(timeText, 400, 56);
  ctx.fillStyle = '#f3d17e';
  ctx.fillText(String(state.score).padStart(4, '0'), 500, 56);
  ctx.fillStyle = state.combo > 1 ? '#ffd16d' : '#d1e3dc';
  ctx.fillText(`×${state.combo}`, 600, 56);

  const windAngle = Math.atan2(state.windY, state.windX);
  const windMagnitude = Math.round(Math.hypot(state.windX, state.windY));
  const arrowLength = 8;
  const arrowX = 370 + Math.cos(windAngle) * arrowLength;
  const arrowY = 80 + Math.sin(windAngle) * arrowLength;
  ctx.strokeStyle = state.windStrength > 0.2 ? '#8fe0ee' : '#b8c9c5';
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(370 - Math.cos(windAngle) * arrowLength, 80 - Math.sin(windAngle) * arrowLength);
  ctx.lineTo(arrowX, arrowY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(arrowX, arrowY);
  ctx.lineTo(arrowX - Math.cos(windAngle - 0.55) * 4, arrowY - Math.sin(windAngle - 0.55) * 4);
  ctx.lineTo(arrowX - Math.cos(windAngle + 0.55) * 4, arrowY - Math.sin(windAngle + 0.55) * 4);
  ctx.closePath();
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.fillStyle = '#b4d5d3';
  ctx.fillText(`风向 ${Math.round((windAngle * 180) / Math.PI + 360) % 360}° · ${windMagnitude} u/s`, 386, 83);

  if (state.feedbackAge > 0 && state.feedback) {
    const colors = { good: '#c8f0d7', warn: '#ffdc9f', bad: '#ff9a91' };
    ctx.fillStyle = colors[state.feedbackTone];
    ctx.font = '10px "Noto Sans SC", sans-serif';
    ctx.fillText(state.feedback, 365, 103, 270);
  }
}

export const dockingGame = createCanvasMiniGame<FlightState, FlightLevel>({
  meta: {
    id: 'docking',
    number: '01',
    shortTitle: '风廊急送',
    title: '风廊急送 · 城市应急投递',
    enTitle: 'WIND CORRIDOR COURIER',
    moduleName: '杭州运河街区 · 应急航线',
    genre: '惯性飞行与精准投递',
    tagline: '借风穿越街区，在落点前稳住无人机',
    accent: '#e6bc66',
    hubAnchor: { x: 0.5, y: 0.3 },
    briefingSteps: [
      { title: '借风穿街', desc: 'WASD 或方向键施加推力。松开后无人机仍会滑行，风区也会持续改变航迹。' },
      { title: '提前稳速', desc: '按住 Shift 刹车并减弱风扰，刹车会消耗电量；速度过快时急救包不会离舱。' },
      { title: '精准投递', desc: '进入金色投递圈，等地速降到本关上限以内，再按 Space 投放当前物资。' },
    ],
    controlsHint: 'WASD / 方向键飞行 · Shift 刹车稳姿（耗电） · Space 投放 · 松键后仍有惯性',
  },
  levels: LEVELS,
  controls: [
    { id: 'up', label: '前推', key: 'w', title: 'W / ↑：向前施加推力' },
    { id: 'left', label: '左移', key: 'a', title: 'A / ←：向左施加推力' },
    { id: 'down', label: '后推', key: 's', title: 'S / ↓：向后施加推力' },
    { id: 'right', label: '右移', key: 'd', title: 'D / →：向右施加推力' },
    { id: 'brake', label: '刹车稳姿', key: 'Shift', title: '按住 Shift 降低地速并减弱风扰，会消耗电量' },
    { id: 'drop', label: '投放急救包', title: '仅在金色投递圈内且地速合格时投放' },
  ],
  createState: (level) => newFlightState(level),
  control(state, id, phase, level) {
    const keys: Record<string, string> = {
      up: 'ArrowUp', left: 'ArrowLeft', down: 'ArrowDown', right: 'ArrowRight',
    };
    if (keys[id]) {
      if (phase === 'down') state.keys.add(keys[id]);
      else state.keys.delete(keys[id]);
      return;
    }
    if (id === 'brake') {
      state.braking = phase === 'down';
      return;
    }
    if (id === 'drop' && phase === 'down') attemptDelivery(state, level);
  },
  key(state, key, phase, level) {
    if (key === ' ' || key.toLowerCase() === 'space') {
      if (phase === 'down') attemptDelivery(state, level);
      return;
    }
    const arrows: Record<string, string> = {
      ArrowUp: 'ArrowUp', ArrowLeft: 'ArrowLeft', ArrowDown: 'ArrowDown', ArrowRight: 'ArrowRight',
    };
    const mapped = arrows[key];
    if (mapped) {
      if (phase === 'down') state.keys.add(mapped);
      else state.keys.delete(mapped);
    }
  },
  update(state, dt, level, time) {
    if (state.crashReason) return;
    state.elapsed = time;
    state.feedbackAge = Math.max(0, state.feedbackAge - dt);

    const wind = getCurrentWind(level, state.x, state.y, time);
    state.windX = wind.x;
    state.windY = wind.y;
    state.windStrength = wind.strength;

    const horizontal = Number(state.keys.has('ArrowRight')) - Number(state.keys.has('ArrowLeft'));
    const vertical = Number(state.keys.has('ArrowDown')) - Number(state.keys.has('ArrowUp'));
    const inputLength = Math.hypot(horizontal, vertical);
    const norm = inputLength > 1 ? 1 / inputLength : 1;
    const thrustX = horizontal * norm * DRONE_ACCELERATION;
    const thrustY = vertical * norm * DRONE_ACCELERATION;
    const canBrake = state.braking && state.battery > 0;
    const windScale = canBrake ? 0.2 : 1;
    const drag = Math.exp(-(canBrake ? 3.15 : 0.2) * dt);

    state.vx = (state.vx + (thrustX + wind.x * windScale) * dt) * drag;
    state.vy = (state.vy + (thrustY + wind.y * windScale) * dt) * drag;
    const speed = Math.hypot(state.vx, state.vy);
    if (speed > DRONE_MAX_SPEED) {
      state.vx *= DRONE_MAX_SPEED / speed;
      state.vy *= DRONE_MAX_SPEED / speed;
    }

    state.x += state.vx * dt;
    state.y += state.vy * dt;
    const moved = Math.hypot(state.x - (state.trail[0]?.x ?? state.x), state.y - (state.trail[0]?.y ?? state.y));
    if (speed > 42 && moved > 9) {
      state.trail.unshift({ x: state.x, y: state.y, age: 0 });
      if (state.trail.length > 9) state.trail.length = 9;
    }
    for (const point of state.trail) point.age += dt;
    state.trail = state.trail.filter((point) => point.age < 0.34);
    for (const effect of state.dropEffects) effect.age += dt;
    state.dropEffects = state.dropEffects.filter((effect) => effect.age < 1.05);

    if (speed > 6) state.heading = Math.atan2(state.vy, state.vx);

    if (state.x < 30 || state.x > WORLD_WIDTH - 30 || state.y < 92 || state.y > WORLD_HEIGHT - 22) {
      crash(state, '飞出低空安全边界');
      return;
    }
    for (const building of BUILDINGS) {
      if (circleTouchesRect(state.x, state.y, DRONE_HIT_RADIUS, building)) {
        crash(state, `撞上「${building.name}」楼体`);
        return;
      }
    }
    for (const pole of POLES) {
      if (Math.hypot(state.x - pole.x, state.y - pole.y) < DRONE_HIT_RADIUS + 7) {
        crash(state, `撞上${pole.name}`);
        return;
      }
    }

    const controlDrain = inputLength > 0 ? 0.12 : 0;
    const brakeDrain = canBrake ? 0.58 : 0;
    state.battery = Math.max(0, state.battery - (controlDrain + brakeDrain) * dt);
    if (state.braking && state.battery <= 0 && state.feedbackAge < 0.1) {
      setFeedback(state, '电量耗尽 · 刹车稳定功能暂停，松开后继续靠惯性滑行', 'warn');
    }
  },
  draw(ctx, state, level, width, height, time) {
    drawConsoleBackdrop(ctx, width, height);
    ctx.save();
    ctx.fillStyle = '#21343a';
    ctx.fillRect(20, 148, width - 40, height - 200);
    ctx.strokeStyle = 'rgba(157, 190, 181, .25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(20, 148, width - 40, height - 200);

    // District blocks sit between broad, connected streets; wet patches mark the recent storm.
    ctx.fillStyle = 'rgba(88, 135, 111, .18)';
    ctx.fillRect(32, 223, 366, 28);
    ctx.fillRect(604, 218, 362, 29);
    ctx.fillStyle = 'rgba(183, 180, 143, .10)';
    ctx.fillRect(32, 500, 936, 18);
    drawRoad(ctx);
    drawWetRoads(ctx, time);
    drawWindZones(ctx, level, time);

    for (let i = 0; i < BUILDINGS.length; i++) drawBuilding(ctx, BUILDINGS[i], i);
    for (const pole of POLES) drawPole(ctx, pole, time);

    // Emergency launch pad and a short route trace keep the current job readable.
    ctx.fillStyle = 'rgba(68, 197, 162, .18)';
    ctx.strokeStyle = '#70d5b4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(level.spawn.x - 27, level.spawn.y - 22, 54, 44, 8);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(158, 239, 209, .62)';
    ctx.beginPath();
    ctx.moveTo(level.spawn.x - 14, level.spawn.y); ctx.lineTo(level.spawn.x + 14, level.spawn.y);
    ctx.moveTo(level.spawn.x, level.spawn.y - 12); ctx.lineTo(level.spawn.x, level.spawn.y + 12);
    ctx.stroke();
    drawLabel(ctx, '急救物资库 · 起点', level.spawn.x - 61, level.spawn.y + 42, '#a1e8c7');

    for (let i = 0; i < level.targets.length; i++) {
      drawTarget(ctx, level.targets[i], level, i, i === state.targetIndex, i < state.targetIndex, time);
    }

    ctx.save();
    for (let i = state.trail.length - 1; i >= 0; i--) {
      const point = state.trail[i];
      ctx.globalAlpha = clamp(1 - point.age / 0.34, 0, 0.55);
      ctx.fillStyle = '#9de8dd';
      ctx.beginPath();
      ctx.arc(point.x, point.y, 1.5 + (1 - point.age / 0.34) * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Project the current drift so a player can brake before crossing the target.
    if (Math.hypot(state.vx, state.vy) > 8) {
      ctx.strokeStyle = 'rgba(255, 218, 133, .68)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(state.x, state.y);
      ctx.lineTo(state.x + state.vx * 0.42, state.y + state.vy * 0.42);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const effect of state.dropEffects) drawDeliveryEffect(ctx, effect);
    drawDrone(ctx, state, time);
    if (state.crashReason) {
      ctx.fillStyle = 'rgba(116, 23, 24, .20)';
      ctx.fillRect(20, 148, width - 40, height - 200);
      ctx.strokeStyle = 'rgba(255, 111, 102, .9)';
      ctx.lineWidth = 3;
      ctx.strokeRect(20, 148, width - 40, height - 200);
    }
    drawTelemetryPanel(ctx, state, level, time);

    ctx.fillStyle = 'rgba(5, 14, 19, .78)';
    ctx.beginPath();
    ctx.roundRect(24, height - 48, Math.min(573, width - 48), 27, 5);
    ctx.fill();
    ctx.fillStyle = '#bfd0cb';
    ctx.font = '11px "Noto Sans SC", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('WASD / 方向键 飞行    Shift 刹车    Space 投放    R 重开    ESC 返回任务中心', 37, height - 30, Math.min(548, width - 72));
    ctx.restore();
  },
  metrics(state, level, time) {
    const speed = Math.hypot(state.vx, state.vy);
    const deliveries = Math.min(state.targetIndex, level.targets.length);
    const avgAccuracy = deliveries ? Math.round((state.precisionTotal / deliveries) * 100) : 0;
    return [
      { id: 'delivery', label: '急救包已送达', value: `${deliveries} / ${level.targets.length}`, ratio: deliveries / level.targets.length, status: deliveries === level.targets.length ? 'nominal' : 'info' },
      { id: 'speed', label: '当前模拟地速', value: `${Math.round(speed)} u/s`, status: speed > level.speedLimit ? 'caution' : 'nominal' },
      { id: 'battery', label: '制动电量', value: `${Math.round(state.battery)}%`, ratio: state.battery / 100, status: state.battery < 20 ? 'caution' : 'nominal' },
      { id: 'quality', label: '平均落点精度', value: `${avgAccuracy}%`, status: avgAccuracy >= 70 ? 'nominal' : 'info' },
      { id: 'time', label: '剩余时间', value: `${Math.max(0, Math.ceil(level.duration - time))} s`, status: level.duration - time < 20 ? 'caution' : 'info' },
    ];
  },
  progress(state, level) {
    return { current: Math.min(state.targetIndex, level.targets.length), total: level.targets.length };
  },
  outcome(state, level, time) {
    if (state.crashReason) {
      return {
        won: false,
        score: state.score,
        summary: `无人机${state.crashReason}，任务立即终止。已完成 ${state.targetIndex} / ${level.targets.length} 次投递。`,
        metrics: [
          { label: '急救包已送达', value: `${state.targetIndex} / ${level.targets.length}` },
          { label: '碰撞原因', value: state.crashReason, status: 'critical' },
          { label: '本局得分', value: String(state.score) },
        ],
      };
    }

    if (state.targetIndex < level.targets.length && time >= level.duration) {
      const deliveries = Math.min(state.targetIndex, level.targets.length);
      const averageAccuracy = deliveries ? Math.round((state.precisionTotal / deliveries) * 100) : 0;
      return {
        won: false,
        resultKind: 'incomplete',
        score: state.score,
        summary: `未完成任务：时间已耗尽，已送达 ${deliveries} / ${level.targets.length} 份急救物资。`,
        metrics: [
          { label: '成功投递', value: `${deliveries} / ${level.targets.length}` },
          { label: '平均落点精度', value: `${averageAccuracy}%` },
          { label: '结束原因', value: '任务时间耗尽' },
          { label: '本局得分', value: String(state.score) },
        ],
      };
    }

    if (state.targetIndex < level.targets.length) return null;
    const averageAccuracy = state.precisionTotal / level.targets.length;
    const remainingBattery = Math.round(state.battery);
    const quality = Math.round(averageAccuracy * 100);
    const efficiency = Math.max(0, Math.round((1 - state.elapsed / level.duration) * 100));
    const score = Math.min(1000, state.score + Math.round(quality * 0.45) + Math.round(efficiency * 0.18));
    return {
      won: true,
      score,
      summary: `3 份急救物资已送达；平均落点精度 ${quality}%，最佳连击 ×${state.bestCombo}。${state.elapsed < level.duration * 0.65 ? '航线效率优秀。' : '提前刹车让落点更稳。'}`,
      metrics: [
        { label: '成功投递', value: `${level.targets.length} / ${level.targets.length}`, status: 'nominal' },
        { label: '平均落点精度', value: `${quality}%`, status: quality >= 70 ? 'nominal' : 'caution' },
        { label: '最佳连击', value: `×${state.bestCombo}`, status: state.bestCombo === 3 ? 'nominal' : 'info' },
        { label: '剩余制动电量', value: `${remainingBattery}%` },
        { label: '完成用时', value: `${Math.round(state.elapsed)} s` },
      ],
    };
  },
});
