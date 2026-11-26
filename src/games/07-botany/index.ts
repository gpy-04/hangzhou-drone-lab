import { createCanvasMiniGame, drawConsoleBackdrop, drawLabel, type MiniGameLevel, type MiniGameOutcome, type MiniGamePointer } from '../../core/canvas-minigame';
import type { MetricSpec } from '../../core/game-interface';

interface PackageSpec { id: string; name: string; w: number; h: number; weight: number; color: string; required: boolean; fixed?: boolean; }
interface CargoLevel extends MiniGameLevel { maxWeight: number; items: PackageSpec[]; }
interface CargoItem extends PackageSpec { x: number; y: number; rotated: boolean; loaded: boolean; }
interface CargoState {
  items: CargoItem[]; selected: number; dragging: number; origin: { x: number; y: number; loaded: boolean } | null; dragOffset: { x: number; y: number } | null;
  attempts: number; rejected: number; testMessage: string; approved: boolean;
}

const BIN = { x: 310, y: 170, w: 580, h: 390 };
const levels: CargoLevel[] = [
  {
    name: '轻件中置', subtitle: '一件货物 · 找到安全重心',
    objective: '将急件放入货舱，并让重心指示点留在中央安全框内。', codexId: 'botany-payload-routing', duration: 180,
    lesson: '货物质量和摆放位置共同决定重心；居中能减少飞行姿态修正。',
    scienceAction: '移动并旋转包裹，观察质量中心如何随载荷布局变化。', maxWeight: 24,
    items: [{ id: 'parcel', name: '急件包裹', w: 158, h: 108, weight: 8, color: '#e8b45d', required: true }],
  },
  {
    name: '药品配载', subtitle: '不同质量 · 多种可行摆法',
    objective: '装入全部两件医疗物资，不超过载荷上限，并把重心控制在安全框。', codexId: 'botany-cold-chain', duration: 200,
    lesson: '同样尺寸的货物也可能因质量不同而产生不同的重心偏移。',
    scienceAction: '为轻重不同的模拟药品选择摆放位置，在不超载前提下维持配平。', maxWeight: 28,
    items: [
      { id: 'cold', name: '冷链箱', w: 156, h: 114, weight: 14, color: '#38bdf8', required: true },
      { id: 'med', name: '医疗包', w: 118, h: 104, weight: 6, color: '#fb923c', required: true },
      { id: 'sensor', name: '温度记录仪', w: 82, h: 82, weight: 2, color: '#a78bfa', required: false },
    ],
  },
  {
    name: '跨区货舱', subtitle: '冷链模块 · 必送件与额外件',
    objective: '固定冷链模块不可移动；装入两件必送包裹，控制重心，剩余空间可选装一件。', codexId: 'botany-urban-logistics', duration: 220,
    lesson: '有效载荷不仅受重量限制，还要检查固定装置、空间和重心余量。',
    scienceAction: '将冷链模块与不同货件组合装入货舱，检查重量、占用与重心约束。', maxWeight: 40,
    items: [
      { id: 'module', name: '固定冷链模块', w: 176, h: 122, weight: 16, color: '#2dd4bf', required: true, fixed: true },
      { id: 'urgent', name: '急救包裹', w: 144, h: 98, weight: 10, color: '#fb923c', required: true },
      { id: 'water', name: '净水滤芯', w: 120, h: 94, weight: 8, color: '#60a5fa', required: true },
      { id: 'spare', name: '备用传感器', w: 104, h: 88, weight: 4, color: '#a78bfa', required: false },
    ],
  },
];

function packageBox(item: CargoItem): { w: number; h: number } { return item.rotated ? { w: item.h, h: item.w } : { w: item.w, h: item.h }; }
function initialPosition(i: number): { x: number; y: number } { return { x: 93, y: 195 + i * 100 }; }
function createState(level: CargoLevel): CargoState {
  return { items: level.items.map((item, i) => ({ ...item, ...(item.fixed ? { x: BIN.x + 20, y: BIN.y + 20 } : initialPosition(i)), rotated: false, loaded: !!item.fixed })), selected: 0, dragging: -1, origin: null, dragOffset: null, attempts: 0, rejected: 0, testMessage: '所有货物都可在货舱内自由摆放；选择合适布局后检查。', approved: false };
}
function centerOfGravity(s: CargoState): { x: number; y: number; weight: number } {
  const loaded = s.items.filter((i) => i.loaded); const weight = loaded.reduce((sum, i) => sum + i.weight, 0);
  if (!weight) return { x: BIN.x + BIN.w / 2, y: BIN.y + BIN.h / 2, weight: 0 };
  return { x: loaded.reduce((sum, i) => sum + (i.x + packageBox(i).w / 2) * i.weight, 0) / weight, y: loaded.reduce((sum, i) => sum + (i.y + packageBox(i).h / 2) * i.weight, 0) / weight, weight };
}
function isLayoutValid(items: CargoItem[]): boolean {
  const placed = items.filter((i) => i.loaded);
  for (const a of placed) {
    const aBox = packageBox(a);
    if (a.x < BIN.x || a.y < BIN.y || a.x + aBox.w > BIN.x + BIN.w || a.y + aBox.h > BIN.y + BIN.h) return false;
    for (const b of placed) {
      if (a === b) continue;
      const bBox = packageBox(b);
      const overlapX = Math.min(a.x + aBox.w, b.x + bBox.w) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + aBox.h, b.y + bBox.h) - Math.max(a.y, b.y);
      if (overlapX > 3 && overlapY > 3) return false;
    }
  }
  return true;
}
function hasSafeCG(s: CargoState): boolean {
  const cg = centerOfGravity(s);
  return Math.abs(cg.x - (BIN.x + BIN.w / 2)) < BIN.w * .2 && Math.abs(cg.y - (BIN.y + BIN.h / 2)) < BIN.h * .22;
}
function drawPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, title: string): void {
  ctx.fillStyle = 'rgba(5,14,27,.94)'; ctx.strokeStyle = 'rgba(91,176,215,.37)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill(); ctx.stroke(); drawLabel(ctx, title, x + 15, y + 25, '#8edff7');
}
function drawItem(ctx: CanvasRenderingContext2D, item: CargoItem, selected: boolean, time: number): void {
  const b = packageBox(item); const x = item.x; const y = item.y;
  ctx.save();
  const glow = selected ? .75 + Math.sin(time * .006) * .15 : .42;
  ctx.fillStyle = `${item.color}${item.loaded ? '39' : '27'}`;
  ctx.strokeStyle = item.color; ctx.lineWidth = selected ? 3 : 2;
  ctx.shadowColor = item.color; ctx.shadowBlur = selected ? 12 : 4;
  ctx.beginPath(); ctx.roundRect(x, y, b.w, b.h, 8); ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
  ctx.globalAlpha = glow; ctx.strokeStyle = item.color; ctx.setLineDash([6, 5]); ctx.strokeRect(x + 8, y + 8, b.w - 16, b.h - 16); ctx.setLineDash([]); ctx.globalAlpha = 1;
  ctx.fillStyle = '#eaf8ff'; ctx.font = '700 13px "Noto Sans SC", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(item.name, x + b.w / 2, y + b.h / 2 - 2);
  ctx.fillStyle = '#a8c6da'; ctx.font = '11px "JetBrains Mono", monospace'; ctx.fillText(`${item.weight} kg · ${item.fixed ? '固定模块' : item.loaded ? '已装载' : '待装载'}`, x + b.w / 2, y + b.h / 2 + 17);
  ctx.textAlign = 'left'; ctx.restore();
}
function draw(ctx: CanvasRenderingContext2D, s: CargoState, l: CargoLevel, w: number, h: number, time: number): void {
  drawConsoleBackdrop(ctx, w, h);
  drawPanel(ctx, 42, 92, 220, 520, '待装载货件');
  drawPanel(ctx, 282, 92, 630, 520, 'CARGO BAY · 重量配平');
  ctx.fillStyle = 'rgba(4,12,23,.7)'; ctx.fillRect(300, 150, 595, 430);
  ctx.fillStyle = 'rgba(38,101,130,.2)'; ctx.fillRect(BIN.x, BIN.y, BIN.w, BIN.h);
  ctx.strokeStyle = 'rgba(112,210,238,.78)'; ctx.lineWidth = 3; ctx.strokeRect(BIN.x, BIN.y, BIN.w, BIN.h);
  ctx.strokeStyle = 'rgba(127,191,218,.2)'; ctx.lineWidth = 1;
  for (let x = BIN.x + 40; x < BIN.x + BIN.w; x += 40) { ctx.beginPath(); ctx.moveTo(x, BIN.y); ctx.lineTo(x, BIN.y + BIN.h); ctx.stroke(); }
  for (let y = BIN.y + 40; y < BIN.y + BIN.h; y += 40) { ctx.beginPath(); ctx.moveTo(BIN.x, y); ctx.lineTo(BIN.x + BIN.w, y); ctx.stroke(); }
  ctx.fillStyle = 'rgba(34,197,94,.09)'; ctx.strokeStyle = 'rgba(34,197,94,.62)'; ctx.setLineDash([6, 4]);
  ctx.fillRect(BIN.x + BIN.w * .3, BIN.y + BIN.h * .28, BIN.w * .4, BIN.h * .44); ctx.strokeRect(BIN.x + BIN.w * .3, BIN.y + BIN.h * .28, BIN.w * .4, BIN.h * .44); ctx.setLineDash([]);
  drawLabel(ctx, '安全重心范围', BIN.x + BIN.w * .3 + 8, BIN.y + BIN.h * .28 + 18, '#8df5b0');
  const cg = centerOfGravity(s);
  ctx.strokeStyle = 'rgba(255,222,142,.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(BIN.x + BIN.w / 2, BIN.y + BIN.h / 2); ctx.lineTo(cg.x, cg.y); ctx.stroke();
  ctx.fillStyle = hasSafeCG(s) ? '#a5ffc0' : '#ff737c'; ctx.strokeStyle = '#f5fdff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cg.x, cg.y, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#09121d'; ctx.font = '700 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('重', cg.x, cg.y + 4); ctx.textAlign = 'left';
  s.items.forEach((item, i) => {
    if (!item.loaded && s.dragging !== i) {
      const slot = initialPosition(i); const x = 75; const y = slot.y - 18;
      ctx.fillStyle = `${item.color}26`; ctx.strokeStyle = item.color; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(x, y, 154, 66, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e5f5ff'; ctx.font = '600 13px "Noto Sans SC", sans-serif'; ctx.fillText(item.name, x + 11, y + 25);
      ctx.fillStyle = '#a4bdd0'; ctx.font = '11px "JetBrains Mono", monospace'; ctx.fillText(`${item.w}×${item.h} · ${item.weight} kg${item.required ? ' · 必送' : ' · 可选'}`, x + 11, y + 47);
    }
    if (item.loaded || s.dragging === i) drawItem(ctx, item, s.selected === i, time);
  });
  ctx.fillStyle = 'rgba(4,13,25,.91)'; ctx.fillRect(312, 574, 575, 28);
  const color = s.approved ? '#9ff9b9' : s.rejected ? '#ffafad' : '#c4d9eb';
  ctx.fillStyle = color; ctx.font = '600 14px "Noto Sans SC", sans-serif'; ctx.fillText(s.testMessage, 326, 594);
  const weightColor = cg.weight > l.maxWeight ? '#ff8588' : '#e6f5ff';
  ctx.fillStyle = weightColor; ctx.font = '700 17px "JetBrains Mono", monospace'; ctx.fillText(`载荷 ${cg.weight}/${l.maxWeight} kg`, 315, 636);
  ctx.fillStyle = hasSafeCG(s) ? '#8df5b0' : '#ff9e9e'; ctx.fillText(`重心偏移 ${Math.round((cg.x - (BIN.x + BIN.w / 2)) / 10)} · ${Math.round((cg.y - (BIN.y + BIN.h / 2)) / 10)}`, 572, 636);
  ctx.fillStyle = '#92abc1'; ctx.font = '11px "Noto Sans SC", sans-serif'; ctx.fillText('可自由摆放，货物之间不能重叠；绿色框内为教学用安全重心区。', 315, 657);
}
function metrics(s: CargoState, l: CargoLevel): MetricSpec[] {
  const required = s.items.filter((i) => i.required); const loaded = required.filter((i) => i.loaded).length; const cg = centerOfGravity(s);
  const safe = hasSafeCG(s); const weightSafe = cg.weight <= l.maxWeight;
  return [
    { id: 'cargo', label: '必送件', value: `${loaded} / ${required.length}`, ratio: loaded / required.length, status: loaded === required.length ? 'nominal' : 'info' },
    { id: 'weight', label: '载荷重量', value: `${cg.weight} / ${l.maxWeight} kg`, ratio: cg.weight / l.maxWeight, status: weightSafe ? 'nominal' : 'critical' },
    { id: 'balance', label: '重心配平', value: safe ? '安全区内' : '偏移过大', status: safe ? 'nominal' : 'caution' },
    { id: 'layout', label: '装载布局', value: isLayoutValid(s.items) ? '无重叠' : '空间冲突', status: isLayoutValid(s.items) ? 'nominal' : 'critical' },
  ];
}
function fitTest(s: CargoState, l: CargoLevel): boolean {
  return s.items.filter((i) => i.required).every((i) => i.loaded) && centerOfGravity(s).weight <= l.maxWeight && isLayoutValid(s.items) && hasSafeCG(s);
}
function test(s: CargoState, l: CargoLevel): void {
  s.attempts++;
  if (fitTest(s, l)) { s.approved = true; s.testMessage = '配载通过：货物合规，重心位于安全区。'; }
  else {
    s.rejected++;
    const missing = s.items.filter((i) => i.required && !i.loaded).length;
    if (missing) s.testMessage = `还有 ${missing} 件必送物资未装载。`;
    else if (centerOfGravity(s).weight > l.maxWeight) s.testMessage = '载荷超重；卸下可选货件或重新安排装载。';
    else if (!isLayoutValid(s.items)) s.testMessage = '货舱边界或包裹重叠冲突，请调整位置。';
    else s.testMessage = '重心在安全范围外；可移动较重货物来修正。';
  }
}
function outcome(s: CargoState, l: CargoLevel): MiniGameOutcome | null {
  if (!s.approved) return null;
  const extra = s.items.filter((i) => !i.required && i.loaded).length;
  const accuracy = Math.max(0, 1000 - s.rejected * 45 - s.attempts * 20);
  return { won: true, score: Math.min(1000, accuracy + extra * 28), summary: `必送物资已配载，重量 ${centerOfGravity(s).weight} kg，重心落在安全区。`,
    metrics: [{ label: '必送物资', value: `${s.items.filter((i) => i.required).length} 件` }, { label: '载荷重量', value: `${centerOfGravity(s).weight} / ${l.maxWeight} kg` }, { label: '重心状态', value: '安全区内' }, { label: '额外货件', value: `${extra} 件` }] };
}
function rotate(s: CargoState): void {
  if (s.selected < 0 || s.dragging >= 0) return;
  const item = s.items[s.selected]; const old = item.rotated; const box = packageBox(item); const cx = item.x + box.w / 2; const cy = item.y + box.h / 2;
  if (item.fixed) { s.testMessage = '冷链模块固定在货舱内，调整其他包裹来配平。'; return; }
  item.rotated = !old; const next = packageBox(item); item.x = cx - next.w / 2; item.y = cy - next.h / 2;
  if (item.loaded && !isLayoutValid(s.items)) { item.rotated = old; item.x = cx - box.w / 2; item.y = cy - box.h / 2; s.testMessage = '旋转后与其他包裹或货舱边界冲突。'; }
  else s.testMessage = `${item.name}已旋转；请再次检查空间与重心。`;
}

export const botanyGame = createCanvasMiniGame<CargoState, CargoLevel>({
  meta: {
    id: 'botany', number: '07', shortTitle: '货舱配平', title: '杭州无人机货舱配平',
    enTitle: 'PAYLOAD & CENTER OF GRAVITY', moduleName: '滨江低空物流装载实验室',
    genre: '空间装载与重心控制', tagline: '摆放包裹，检查载荷总重和飞行配平', accent: '#f59e0b', hubAnchor: { x: .73, y: .31 },
    briefingSteps: [
      { title: '辨认货物', desc: '包裹大小与重量不同，必送件需要全部放入货舱。' },
      { title: '摆放与旋转', desc: '拖动货件改变位置，旋转帮助适应空间，货物不得越界或重叠。' },
      { title: '检查配平', desc: '质量较大的货物对重心影响更明显；总重和重心都要合规。' },
    ],
    controlsHint: '拖动包裹装载与摆位 · 点击选中后按 R 旋转 · Enter 检查载荷、空间与重心',
  },
  levels,
  controls: [
    { id: 'rotate', label: '旋转选中货件', key: 'R' },
    { id: 'check', label: '检查配载', key: 'Enter', tone: 'gold' },
  ],
  createState,
  update: () => {},
  draw,
  pointer(s: CargoState, event: MiniGamePointer) {
    if (event.type === 'down') {
      let hit = -1;
      for (let i = s.items.length - 1; i >= 0; i--) {
        const item = s.items[i];
        if (item.fixed) continue;
        if (item.loaded) {
          const b = packageBox(item);
          if (event.x >= item.x && event.x <= item.x + b.w && event.y >= item.y && event.y <= item.y + b.h) { hit = i; break; }
        } else {
          const slot = initialPosition(i);
          if (event.x >= 75 && event.x <= 229 && event.y >= slot.y - 18 && event.y <= slot.y + 48) { hit = i; break; }
        }
      }
      if (hit >= 0) {
        s.selected = hit; s.dragging = hit;
        const item = s.items[hit]; s.origin = { x: item.x, y: item.y, loaded: item.loaded };
        const b = packageBox(item); s.dragOffset = item.loaded ? { x: event.x - item.x, y: event.y - item.y } : { x: b.w / 2, y: b.h / 2 };
        item.x = event.x - s.dragOffset.x; item.y = event.y - s.dragOffset.y; s.testMessage = `正在摆放${item.name}。`;
      }
    } else if (event.type === 'move' && s.dragging >= 0) {
      const item = s.items[s.dragging]; const offset = s.dragOffset ?? { x: 0, y: 0 }; item.x = event.x - offset.x; item.y = event.y - offset.y;
    } else if ((event.type === 'up' || event.type === 'cancel') && s.dragging >= 0) {
      const item = s.items[s.dragging]; const origin = s.origin!; const b = packageBox(item);
      const centerX = item.x + b.w / 2; const centerY = item.y + b.h / 2;
      if (centerX > BIN.x && centerX < BIN.x + BIN.w && centerY > BIN.y && centerY < BIN.y + BIN.h) {
        item.loaded = true;
        if (!isLayoutValid(s.items)) { item.loaded = origin.loaded; item.x = origin.x; item.y = origin.y; s.rejected++; s.testMessage = '放置被拒：货物与舱壁或其他货件重叠。'; }
        else s.testMessage = `${item.name}已放入；观察重心指示点的移动。`;
      } else if (origin.loaded) {
        item.loaded = false; const tray = initialPosition(s.dragging); item.x = tray.x; item.y = tray.y;
        s.testMessage = `${item.name}已卸下。`;
      } else { item.loaded = false; item.x = origin.x; item.y = origin.y; }
      s.dragging = -1; s.origin = null; s.dragOffset = null;
    }
  },
  control(s, id, phase, l) {
    if (phase !== 'down') return;
    if (id === 'rotate') rotate(s);
    else if (id === 'check') test(s, l);
  },
  metrics,
  progress(s, l) { return { current: s.items.filter((i) => i.required && i.loaded).length, total: s.items.filter((i) => i.required).length }; },
  outcome,
});
