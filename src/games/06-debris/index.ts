import { createCanvasMiniGame, drawConsoleBackdrop, drawLabel, type MiniGameLevel, type MiniGameOutcome } from '../../core/canvas-minigame';
import type { MetricSpec } from '../../core/game-interface';

interface XY { x: number; y: number }
interface NetLevel extends MiniGameLevel {
  relays: number;
  range: number;
  communities: (XY & { name: string })[];
  blockers: (XY & { r: number; name: string })[];
  redundant: boolean;
}
interface Relay extends XY { high: boolean }
interface NetState {
  nodes: Relay[];
  selected: number;
  dragging: number;
  connected: number[];
  tested: boolean;
  attempts: number;
  ok: boolean;
}

const HOME: XY = { x: 150, y: 365 };
const levels: NetLevel[] = [
  {
    name: '河岸中继', subtitle: '两处社区 · 单层视距', objective: '移动 2 架中继无人机，让河岸两个失联社区都连回指挥站。',
    codexId: 'debris-swarm-separation', duration: 150, lesson: '中继节点必须首尾相连；无线电也会被高楼遮挡。',
    scienceAction: '把中继无人机放到合适位置，观察链路连通与建筑遮挡。', relays: 2, range: 225, redundant: false,
    communities: [{ x: 680, y: 285, name: '桥东社区' }, { x: 805, y: 455, name: '江湾驿站' }], blockers: [],
  },
  {
    name: '楼群绕射', subtitle: '三处社区 · 建筑遮挡', objective: '绕开钱江新城楼群遮挡，用 3 个中继节点恢复全部失联区域。',
    codexId: 'debris-task-allocation', duration: 160, lesson: '建筑会阻断视距链路；提高节点高度可以越过部分遮挡。',
    scienceAction: '拖动并升高中继机，寻找绕过高层遮挡的连通路径。', relays: 3, range: 230, redundant: false,
    communities: [{ x: 610, y: 240, name: '北岸诊所' }, { x: 765, y: 365, name: '潮鸣社区' }, { x: 830, y: 535, name: '南岸站点' }],
    blockers: [{ x: 495, y: 365, r: 78, name: '钱江新城楼群' }],
  },
  {
    name: '抗毁组网', subtitle: '三处社区 · 单节点失效', objective: '建立可绕行的备用网络：任意一架中继机失联后，所有社区仍应可达。',
    codexId: 'debris-swarm-coverage', duration: 180, lesson: '冗余路径能减少单个节点故障造成的通信中断。',
    scienceAction: '为社区搭建两条互不依赖单一中继的通信路径，并检查故障冗余。', relays: 4, range: 250, redundant: true,
    communities: [{ x: 615, y: 245, name: '江南急救点' }, { x: 815, y: 350, name: '观潮平台' }, { x: 690, y: 520, name: '临时指挥所' }],
    blockers: [{ x: 470, y: 315, r: 62, name: '高层楼群' }, { x: 540, y: 470, r: 55, name: '施工塔吊' }],
  },
];

function createState(level: NetLevel): NetState {
  const n = level.relays;
  return {
    nodes: Array.from({ length: n }, (_, i) => ({
      x: 300 + (i % 2) * 70,
      y: 255 + Math.floor(i / 2) * 95,
      high: false,
    })),
    selected: 0, dragging: -1, connected: [], tested: false, attempts: 0, ok: false,
  };
}

function segmentHitsCircle(a: XY, b: XY, c: XY, radius: number): boolean {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(a.x + t * dx - c.x, a.y + t * dy - c.y) < radius;
}

function graphFor(state: NetState, level: NetLevel, excluded = -1): number[][] {
  const points: XY[] = [HOME, ...state.nodes.map((n) => ({ x: n.x, y: n.y })), ...level.communities];
  const links = points.map(() => [] as number[]);
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    const relayI = i > 0 && i <= state.nodes.length ? i - 1 : -1;
    const relayJ = j > 0 && j <= state.nodes.length ? j - 1 : -1;
    if (relayI === excluded || relayJ === excluded) continue;
    if (Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) > level.range) continue;
    const blocked = level.blockers.some((b) => {
      const r = b.r * ((relayI >= 0 && state.nodes[relayI].high) || (relayJ >= 0 && state.nodes[relayJ].high) ? 0.58 : 1);
      return segmentHitsCircle(points[i], points[j], b, r);
    });
    if (!blocked) { links[i].push(j); links[j].push(i); }
  }
  return links;
}

function connectedCommunities(state: NetState, level: NetLevel, excluded = -1): number[] {
  const graph = graphFor(state, level, excluded);
  const seen = new Set([0]); const queue = [0];
  while (queue.length) for (const next of graph[queue.shift()!]!) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  return level.communities.map((_, i) => i).filter((i) => seen.has(1 + state.nodes.length + i));
}

function passed(state: NetState, level: NetLevel): boolean {
  const all = connectedCommunities(state, level);
  if (all.length !== level.communities.length) return false;
  if (!level.redundant) return true;
  return state.nodes.every((_, i) => connectedCommunities(state, level, i).length === level.communities.length);
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, title: string): void {
  ctx.fillStyle = 'rgba(5, 14, 27, .93)'; ctx.strokeStyle = 'rgba(92, 186, 227, .36)'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill(); ctx.stroke();
  drawLabel(ctx, title, x + 18, y + 26, '#8edff7');
}

function draw(ctx: CanvasRenderingContext2D, s: NetState, level: NetLevel, w: number, h: number, time: number): void {
  drawConsoleBackdrop(ctx, w, h);
  panel(ctx, 40, 82, 900, 560, level.redundant ? 'FAULT-TOLERANT MESH · N+1' : 'URBAN RELAY NETWORK · LINE OF SIGHT');
  ctx.fillStyle = 'rgba(18, 53, 74, .42)'; ctx.beginPath(); ctx.ellipse(680, 425, 260, 145, -.11, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(56, 189, 248, .33)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(680, 425, 260, 145, -.11, 0, Math.PI * 2); ctx.stroke();
  drawLabel(ctx, '钱塘江', 686, 424, 'rgba(151,222,246,.72)');
  for (const b of level.blockers) {
    ctx.fillStyle = 'rgba(246, 94, 96, .14)'; ctx.strokeStyle = 'rgba(255, 128, 130, .68)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    drawLabel(ctx, b.name, b.x - 42, b.y + 5, '#ffaaa9');
  }
  const graph = graphFor(s, level);
  const pts: XY[] = [HOME, ...s.nodes, ...level.communities];
  for (let i = 0; i < graph.length; i++) for (const j of graph[i]!) if (j > i) {
    ctx.strokeStyle = i === 0 || j === 0 ? 'rgba(81,225,255,.8)' : 'rgba(66,204,230,.55)';
    ctx.lineWidth = 2; ctx.setLineDash([8, 7]); ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke(); ctx.setLineDash([]);
    const t = (time * 0.18 + i * .22) % 1; ctx.fillStyle = '#cbf7ff'; ctx.beginPath(); ctx.arc(pts[i].x + (pts[j].x - pts[i].x) * t, pts[i].y + (pts[j].y - pts[i].y) * t, 4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#ffd178'; ctx.strokeStyle = '#fff0c5'; ctx.beginPath(); ctx.arc(HOME.x, HOME.y, 21, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  drawLabel(ctx, '指挥站', HOME.x - 26, HOME.y + 43, '#ffdf9c');
  level.communities.forEach((p, i) => {
    const ok = s.connected.includes(i); ctx.fillStyle = ok ? 'rgba(34,197,94,.9)' : 'rgba(248,113,113,.84)';
    ctx.strokeStyle = ok ? '#a5ffc7' : '#ffb5b5'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 16, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    drawLabel(ctx, p.name, p.x - 46, p.y + 35, ok ? '#c1ffd6' : '#ffe0e0');
  });
  s.nodes.forEach((n, i) => {
    ctx.save(); ctx.translate(n.x, n.y);
    ctx.strokeStyle = i === s.selected ? '#fff0a8' : '#8de9ff'; ctx.fillStyle = 'rgba(30, 113, 153, .9)'; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.roundRect(-23, -16, 46, 32, 8); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#c6f8ff'; ctx.beginPath(); ctx.moveTo(-30, 0); ctx.lineTo(-18, 0); ctx.moveTo(18, 0); ctx.lineTo(30, 0); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(-31, 0, 8, 3, 0, 0, Math.PI * 2); ctx.ellipse(31, 0, 8, 3, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = n.high ? '#fbbf24' : '#a5f3fc'; ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    drawLabel(ctx, `中继 ${i + 1} · ${n.high ? '高层' : '低层'}`, n.x - 39, n.y + 34, n.high ? '#ffda85' : '#bdeeff');
  });
  ctx.fillStyle = 'rgba(6,18,32,.94)'; ctx.fillRect(65, 563, 845, 54);
  const tip = s.tested ? (s.ok ? '链路通过：所有社区已接入' : level.redundant ? '未通过：逐个模拟中继失联，仍须全部保持连通' : '链路中断：拖动节点或切换高度后再次检查') : '拖动中继机 · 点击选择后切换高度 · 建立网络后按 Enter 检查';
  ctx.fillStyle = s.ok ? '#8af2b0' : '#c4d9eb'; ctx.font = '600 15px "Noto Sans SC", sans-serif'; ctx.fillText(tip, 88, 596);
  ctx.fillStyle = '#9ab7ce'; ctx.font = '12px "Noto Sans SC", sans-serif'; ctx.fillText(`有效半径 ${level.range}m（教学模拟） · 高层可降低建筑遮挡影响`, 88, 625);
}

function metrics(s: NetState, l: NetLevel): MetricSpec[] {
  const connected = connectedCommunities(s, l).length;
  return [
    { id: 'cover', label: '接入社区', value: `${connected} / ${l.communities.length}`, ratio: connected / l.communities.length, status: connected === l.communities.length ? 'nominal' : 'info' },
    { id: 'nodes', label: '中继节点', value: `${l.relays} 架`, status: 'info' },
    { id: 'height', label: '已升高节点', value: `${s.nodes.filter((n) => n.high).length}`, status: 'nominal' },
    { id: 'test', label: '组网检查', value: s.ok ? '通过' : s.tested ? '需调整' : '待检查', status: s.ok ? 'nominal' : s.tested ? 'caution' : 'info' },
  ];
}

function outcome(s: NetState, l: NetLevel): MiniGameOutcome | null {
  if (!s.ok) return null;
  const redundancyBonus = l.redundant ? 100 : 0;
  return { won: true, score: Math.max(500, 1000 - s.attempts * 70 - s.nodes.filter((n) => n.high).length * 12 + redundancyBonus),
    summary: `全部 ${l.communities.length} 处区域已接入${l.redundant ? '，且逐一模拟中继故障后仍保持连通' : ''}。`,
    metrics: [{ label: '接入社区', value: `${l.communities.length} / ${l.communities.length}` }, { label: '组网尝试', value: `${s.attempts} 次` }, { label: '冗余要求', value: l.redundant ? '单节点失效仍连通' : '基础连通' }] };
}

export const debrisGame = createCanvasMiniGame<NetState, NetLevel>({
  meta: {
    id: 'debris', number: '06', shortTitle: '通信组网', title: '杭州无人机通信组网',
    enTitle: 'URBAN RELAY MESH', moduleName: '钱塘江应急通信演练区', genre: '中继布点与网络连通',
    tagline: '布设中继无人机，跨越遮挡恢复社区通信', accent: '#38bdf8', hubAnchor: { x: .86, y: .49 },
    briefingSteps: [
      { title: '选中中继节点', desc: '拖动地图上的中继无人机，改变它在城市中的位置。' },
      { title: '检查有效链路', desc: '虚线表示可达链路；高楼可能遮挡，升高节点可越过部分遮挡。' },
      { title: '模拟故障', desc: '最后一关需逐架模拟节点失联，确保网络有备用路径。' },
    ],
    controlsHint: '拖动中继无人机调整位置 · 点击选中节点 · Q 切换高低层 · Enter 检查网络',
  },
  levels,
  controls: [
    { id: 'height', label: '切换飞行层', key: 'Q' },
    { id: 'test', label: '检查网络', key: 'Enter', tone: 'gold' },
  ],
  createState,
  update: () => {},
  draw,
  pointer(s, e) {
    if (e.type === 'down') {
      const hit = s.nodes.findIndex((n) => Math.hypot(n.x - e.x, n.y - e.y) < 35);
      if (hit >= 0) { s.selected = hit; s.dragging = hit; }
    } else if (e.type === 'move' && s.dragging >= 0) {
      s.nodes[s.dragging].x = Math.max(115, Math.min(890, e.x));
      s.nodes[s.dragging].y = Math.max(120, Math.min(535, e.y));
      s.tested = false; s.connected = []; s.ok = false;
    } else if (e.type === 'up' || e.type === 'cancel') s.dragging = -1;
  },
  control(s, id, phase, l) {
    if (phase !== 'down') return;
    if (id === 'height') { s.nodes[s.selected].high = !s.nodes[s.selected].high; s.connected = []; s.tested = false; s.ok = false; }
    if (id === 'test') { s.connected = connectedCommunities(s, l); s.tested = true; s.attempts++; s.ok = passed(s, l); }
  },
  metrics,
  progress(s, l) { return { current: connectedCommunities(s, l).length, total: l.communities.length }; },
  outcome,
});
