import { createCanvasMiniGame, drawConsoleBackdrop, drawLabel, type MiniGameLevel, type MiniGameOutcome, type MiniGamePointer } from '../../core/canvas-minigame';
import type { MetricSpec } from '../../core/game-interface';

interface JobSpec { id: string; name: string; detail: string; duration: number; deadline: number; priority: '紧急' | '优先' | '常规'; lanes: number[]; color: string; }
interface Closure { lane: number; start: number; end: number; label: string; }
interface OpsLevel extends MiniGameLevel { horizon: number; lanes: string[]; jobs: JobSpec[]; closure?: Closure; }
interface FlightJob extends JobSpec { start: number; lane: number; }
interface OpsState {
  jobs: FlightJob[]; selected: string | null; dragging: string | null; draftStart: number; draftLane: number;
  submitted: boolean; passed: boolean; attempts: number; message: string; grabOffsetX: number;
}

const AXIS_X = 270; const SLOT_W = 52; const HORIZON = 12;
const LANE_TOP = 180; const LANE_H = 132;
const levels: OpsLevel[] = [
  {
    name: '晨间错峰', subtitle: '双任务 · 共享起降窗口',
    objective: '安排医疗配送与河道巡查的起飞时刻，避免争用起降窗口并按时完成。', codexId: 'zero-g-airspace-capacity', duration: 190,
    lesson: '同一时间的任务会争用起降与通信资源；错峰可减少容量冲突。',
    scienceAction: '把航班卡拖到时间轴和航道上，体验城市低空任务的时间容量约束。',
    horizon: 10, lanes: ['钱塘沿江航道', '滨江内侧航道'],
    jobs: [
      { id: 'clinic', name: '医疗配送', detail: '医药急件', duration: 2, deadline: 6, priority: '紧急', lanes: [0, 1], color: '#f5bd62' },
      { id: 'river', name: '河道巡查', detail: '堤岸巡查', duration: 3, deadline: 9, priority: '常规', lanes: [0, 1], color: '#55c9ed' },
    ],
  },
  {
    name: '汛情插单', subtitle: '三项任务 · 救援优先',
    objective: '将救援航班优先安排，再穿插医疗配送和巡查；留意截止时间与共享起降。', codexId: 'zero-g-dispatch-priority', duration: 210,
    lesson: '排程需同时看任务时限、优先级和可用航道，不能只按距离排序。',
    scienceAction: '安排救援、医疗和巡查任务，让高优先级航班获得合适的时间窗口。',
    horizon: 12, lanes: ['江岸应急走廊', '滨江医疗走廊', '城市巡查走廊'],
    jobs: [
      { id: 'rescue', name: '汛情搜寻', detail: '急救优先', duration: 3, deadline: 8, priority: '紧急', lanes: [0, 2], color: '#fb7185' },
      { id: 'medical', name: '冷链药品', detail: '温控配送', duration: 2, deadline: 7, priority: '优先', lanes: [1, 2], color: '#f6bd60' },
      { id: 'patrol', name: '河堤巡查', detail: '常规巡检', duration: 3, deadline: 11, priority: '常规', lanes: [0, 1, 2], color: '#55c9ed' },
    ],
  },
  {
    name: '风雨管制', subtitle: '四项任务 · 航道临时关闭',
    objective: '处理救援插单、医疗与巡检，并避开内侧航道的临时关闭时段。', codexId: 'zero-g-dispatch-safety', duration: 230,
    lesson: '天气和临时管制会改变可用容量，安全排程要给调整留出余地。',
    scienceAction: '在时间轴避开封闭窗口，并为急件协调共享起降资源和多条航道。',
    horizon: 12, lanes: ['江岸应急走廊', '钱江新城内侧', '滨江沿江走廊'],
    closure: { lane: 1, start: 4, end: 7, label: '雷雨临时管制' },
    jobs: [
      { id: 'rescue', name: '紧急救援', detail: '立即优先', duration: 2, deadline: 5, priority: '紧急', lanes: [0, 2], color: '#fb7185' },
      { id: 'medicine', name: '急救物资', detail: '医疗配送', duration: 2, deadline: 9, priority: '优先', lanes: [1, 2], color: '#f6bd60' },
      { id: 'patrol', name: '堤岸巡查', detail: '风险复核', duration: 3, deadline: 10, priority: '常规', lanes: [0, 1], color: '#55c9ed' },
      { id: 'grid', name: '通信补盲', detail: '中继布点', duration: 2, deadline: 11, priority: '优先', lanes: [0, 1, 2], color: '#a78bfa' },
    ],
  },
];

function createState(level: OpsLevel): OpsState {
  return { jobs: level.jobs.map((j) => ({ ...j, start: -1, lane: -1 })), selected: null, dragging: null, draftStart: -1, draftLane: -1, submitted: false, passed: false, attempts: 0, message: '拖动左侧航班卡进入时间轴；每格代表 10 分钟模拟时段。', grabOffsetX: 8 };
}
function laneY(lane: number): number { return LANE_TOP + lane * LANE_H; }
function jobWidth(job: JobSpec): number { return job.duration * SLOT_W - 6; }
function jobRect(job: FlightJob, index: number): { x: number; y: number; w: number; h: number } {
  return job.start < 0 ? { x: 58, y: 155 + index * 99, w: 178, h: 72 } : { x: AXIS_X + job.start * SLOT_W + 3, y: laneY(job.lane) + 33, w: jobWidth(job), h: 64 };
}
function isClosed(job: FlightJob, l: OpsLevel): boolean {
  return !!l.closure && job.lane === l.closure.lane && job.start < l.closure.end && job.start + job.duration > l.closure.start;
}
function conflictSet(s: OpsState, l: OpsLevel): Set<string> {
  const conflict = new Set<string>(); const assigned = s.jobs.filter((j) => j.start >= 0 && j.lane >= 0);
  assigned.forEach((job) => {
    if (job.start + job.duration > l.horizon || job.start + job.duration > job.deadline || !job.lanes.includes(job.lane) || isClosed(job, l)) conflict.add(job.id);
  });
  for (let i = 0; i < assigned.length; i++) for (let j = i + 1; j < assigned.length; j++) {
    const a = assigned[i]; const b = assigned[j];
    if (a.lane === b.lane && a.start < b.start + b.duration && b.start < a.start + a.duration) { conflict.add(a.id); conflict.add(b.id); }
    if (a.start === b.start) { conflict.add(a.id); conflict.add(b.id); }
  }
  return conflict;
}
function evaluate(s: OpsState, l: OpsLevel): boolean {
  return s.jobs.length > 0 && s.jobs.every((j) => j.start >= 0) && conflictSet(s, l).size === 0;
}
function drawPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, title: string): void {
  ctx.fillStyle = 'rgba(5,14,27,.94)'; ctx.strokeStyle = 'rgba(91,176,215,.37)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill(); ctx.stroke(); drawLabel(ctx, title, x + 15, y + 25, '#8edff7');
}
function draw(ctx: CanvasRenderingContext2D, s: OpsState, l: OpsLevel, w: number, h: number, time: number): void {
  drawConsoleBackdrop(ctx, w, h);
  drawPanel(ctx, 40, 90, 210, 545, '待排航班 QUEUE');
  drawPanel(ctx, 258, 90, 662, 545, 'AIRSPACE SLOT BOARD · 模拟时间轴');
  const conflicts = conflictSet(s, l);
  const laneCount = l.lanes.length;
  for (let lane = 0; lane < laneCount; lane++) {
    const y = laneY(lane);
    ctx.fillStyle = 'rgba(12,30,49,.75)'; ctx.fillRect(AXIS_X, y, l.horizon * SLOT_W, 104);
    ctx.strokeStyle = 'rgba(68,145,182,.3)'; ctx.strokeRect(AXIS_X, y, l.horizon * SLOT_W, 104);
    drawLabel(ctx, l.lanes[lane], AXIS_X + 8, y + 18, '#a9d9ec');
    for (let slot = 0; slot <= l.horizon; slot++) {
      const x = AXIS_X + slot * SLOT_W; ctx.strokeStyle = 'rgba(89,146,173,.2)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y + 24); ctx.lineTo(x, y + 104); ctx.stroke();
      if (lane === 0 && slot < l.horizon) { ctx.fillStyle = '#7696aa'; ctx.font = '10px "JetBrains Mono", monospace'; ctx.fillText(`${String(7 + Math.floor(slot / 6)).padStart(2, '0')}:${String((slot % 6) * 10).padStart(2, '0')}`, x + 3, 164); }
    }
    if (l.closure?.lane === lane) {
      const x = AXIS_X + l.closure.start * SLOT_W; const cw = (l.closure.end - l.closure.start) * SLOT_W;
      ctx.fillStyle = 'rgba(248,83,95,.16)'; ctx.fillRect(x, y + 22, cw, 82); ctx.strokeStyle = 'rgba(248,113,113,.8)'; ctx.setLineDash([5, 4]); ctx.strokeRect(x, y + 22, cw, 82); ctx.setLineDash([]);
      ctx.fillStyle = '#ffaaaa'; ctx.font = '11px "Noto Sans SC", sans-serif'; ctx.fillText(l.closure.label, x + 5, y + 43);
    }
  }
  s.jobs.forEach((job, i) => {
    if (job.start < 0) {
      const r = jobRect(job, i); ctx.fillStyle = `${job.color}28`; ctx.strokeStyle = job.color; ctx.lineWidth = s.selected === job.id ? 3 : 1.5;
      ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ecf7ff'; ctx.font = '700 14px "Noto Sans SC", sans-serif'; ctx.fillText(job.name, r.x + 11, r.y + 25);
      ctx.fillStyle = '#aac2d5'; ctx.font = '11px "Noto Sans SC", sans-serif'; ctx.fillText(`${job.detail} · ${job.duration * 10}分`, r.x + 11, r.y + 45);
      ctx.fillStyle = job.priority === '紧急' ? '#ff9ca3' : job.priority === '优先' ? '#ffd58c' : '#a9c2d4';
      ctx.font = '11px "Noto Sans SC", sans-serif'; ctx.fillText(`${job.priority} · 截止 ${job.deadline}格`, r.x + 11, r.y + 62);
    } else {
      const r = jobRect(job, i); const invalid = conflicts.has(job.id); const dragging = s.dragging === job.id;
      ctx.fillStyle = invalid ? 'rgba(248,78,88,.25)' : `${job.color}3b`; ctx.strokeStyle = invalid ? '#ff737b' : job.color; ctx.lineWidth = dragging || s.selected === job.id ? 3 : 1.5;
      ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#eff9ff'; ctx.font = '700 13px "Noto Sans SC", sans-serif'; ctx.fillText(job.name, r.x + 8, r.y + 24);
      ctx.fillStyle = invalid ? '#ffaaa8' : '#c1d9e8'; ctx.font = '11px "JetBrains Mono", monospace'; ctx.fillText(`${job.duration}格 · ≤${job.deadline}`, r.x + 8, r.y + 45);
      ctx.fillStyle = invalid ? '#ff9a9e' : '#9df4bd'; ctx.font = '11px sans-serif'; ctx.fillText(invalid ? '冲突' : '已排', r.x + r.w - 31, r.y + 44);
    }
  });
  ctx.fillStyle = 'rgba(4,13,25,.91)'; ctx.fillRect(282, 596, 612, 25);
  const msgColor = s.passed ? '#9ff9b9' : conflicts.size || s.submitted ? '#ffaaa8' : '#b9d5e6';
  ctx.fillStyle = msgColor; ctx.font = '600 13px "Noto Sans SC", sans-serif'; ctx.fillText(s.message, 295, 614);
  ctx.fillStyle = '#9eb8cc'; ctx.font = '11px "Noto Sans SC", sans-serif';
  ctx.fillText('每格=10分钟模拟 · 同航道不可重叠 · 同一时刻只能有一项任务起飞', 296, 652);
  if (s.passed) {
    ctx.fillStyle = 'rgba(3,12,24,.75)'; ctx.fillRect(AXIS_X + 20, 108, 360, 35);
    ctx.fillStyle = '#a4ffc0'; ctx.font = '700 16px "Noto Sans SC", sans-serif'; ctx.fillText(`全部航班已排妥 · ${Math.max(0, l.jobs.length)} 项按时起飞`, AXIS_X + 36, 132);
  }
  if (time > 0 && Math.floor(time) % 60 === 0) { /* keep drawing deterministic; timeline uses scenario time */ }
}
function metrics(s: OpsState, l: OpsLevel): MetricSpec[] {
  const assigned = s.jobs.filter((j) => j.start >= 0).length; const conflicts = conflictSet(s, l).size;
  const urgent = s.jobs.filter((j) => j.priority === '紧急'); const urgentOnTime = urgent.filter((j) => j.start >= 0 && j.start + j.duration <= j.deadline).length;
  return [
    { id: 'scheduled', label: '已排航班', value: `${assigned} / ${s.jobs.length}`, ratio: assigned / s.jobs.length, status: assigned === s.jobs.length ? 'nominal' : 'info' },
    { id: 'conflict', label: '空域冲突', value: `${conflicts} 项`, status: conflicts ? 'critical' : 'nominal' },
    { id: 'urgent', label: '紧急任务', value: `${urgentOnTime} / ${urgent.length} 按时`, status: urgentOnTime === urgent.length ? 'nominal' : 'caution' },
    { id: 'attempts', label: '排程校验', value: `${s.attempts} 次`, status: s.passed ? 'nominal' : 'info' },
  ];
}
function validate(s: OpsState, l: OpsLevel): void {
  s.attempts++; s.submitted = true; s.passed = evaluate(s, l);
  if (s.passed) s.message = '安全排程通过：航道、起降窗口与截止时间均满足。';
  else {
    const missing = s.jobs.filter((j) => j.start < 0).length;
    s.message = missing ? `还有 ${missing} 项航班未排入时间轴。` : conflictSet(s, l).size ? '存在时段、航道封闭、起飞窗口或截止时间冲突，请调整红色航班卡。' : '排程需要调整。';
  }
}
function outcome(s: OpsState, l: OpsLevel): MiniGameOutcome | null {
  if (!s.passed) return null;
  const slack = s.jobs.reduce((sum, j) => sum + Math.max(0, j.deadline - j.start - j.duration), 0);
  const urgent = s.jobs.filter((j) => j.priority === '紧急').length;
  const score = Math.max(620, 1000 - s.attempts * 35 - Math.max(0, slack - urgent * 2) * 3);
  return { won: true, score, summary: `完成 ${s.jobs.length} 项低空任务排程；航道互不冲突，任务均在时限内起飞与完成。`,
    metrics: [{ label: '完成航班', value: `${s.jobs.length} / ${s.jobs.length}` }, { label: '空域冲突', value: '0 项' }, { label: '校验次数', value: `${s.attempts} 次` }, { label: '时段余量', value: `${slack} 格` }] };
}
function updateDraft(s: OpsState, event: MiniGamePointer, l: OpsLevel): void {
  const lane = Math.floor((event.y - LANE_TOP) / LANE_H);
  const slot = Math.floor((event.x - s.grabOffsetX - AXIS_X) / SLOT_W);
  if (event.x >= AXIS_X && event.x < AXIS_X + l.horizon * SLOT_W && lane >= 0 && lane < l.lanes.length) {
    s.draftLane = lane; s.draftStart = Math.max(0, Math.min(l.horizon - 1, slot));
  } else { s.draftLane = -1; s.draftStart = -1; }
}

export const zeroGLabGame = createCanvasMiniGame<OpsState, OpsLevel>({
  meta: {
    id: 'zero-g-lab', number: '08', shortTitle: '空域塔台', title: '杭州低空空域塔台',
    enTitle: 'LOW-ALTITUDE SLOT CONTROL', moduleName: '杭州城市低空交通演练中心',
    genre: '时间窗口与航道容量', tagline: '排定起飞时段，协调航道并应对临时管制', accent: '#c084fc', hubAnchor: { x: .54, y: .69 },
    briefingSteps: [
      { title: '读取航班需求', desc: '每项任务都有持续时长、优先级和最晚完成时刻。' },
      { title: '拖动卡片排程', desc: '安排航道和时间段，同一航道不能重叠，也不能同刻争用起降窗口。' },
      { title: '处理临时管制', desc: '红色时段表示关闭空域；检查所有任务后再提交排程。' },
    ],
    controlsHint: '拖动航班卡至航道时间轴 · 拖回左侧可撤下 · Enter 校验排程',
  },
  levels,
  controls: [
    { id: 'remove', label: '撤下选中航班', key: 'Backspace' },
    { id: 'check', label: '校验排程', key: 'Enter', tone: 'gold' },
  ],
  createState,
  update: () => {},
  draw,
  pointer(s: OpsState, event: MiniGamePointer, l: OpsLevel) {
    if (event.type === 'down') {
      const idx = s.jobs.findIndex((job, i) => {
        const r = jobRect(job, i); return event.x >= r.x && event.x <= r.x + r.w && event.y >= r.y && event.y <= r.y + r.h;
      });
      if (idx >= 0) {
        const job = s.jobs[idx]; const rect = jobRect(job, idx); s.selected = job.id; s.dragging = job.id; s.grabOffsetX = event.x - rect.x; updateDraft(s, event, l);
      }
    } else if (event.type === 'move' && s.dragging) updateDraft(s, event, l);
    else if ((event.type === 'up' || event.type === 'cancel') && s.dragging) {
      const job = s.jobs.find((j) => j.id === s.dragging)!;
      if (s.draftLane >= 0) { job.lane = s.draftLane; job.start = Math.min(s.draftStart, l.horizon - job.duration); s.message = `${job.name} 已放入航道；红色航班表示约束冲突。`; }
      else if (event.x < AXIS_X) { job.lane = -1; job.start = -1; s.message = `${job.name}已撤回待排队列。`; }
      s.dragging = null; s.draftLane = -1; s.draftStart = -1;
    }
  },
  control(s, id, phase, l) {
    if (phase !== 'down') return;
    if (id === 'check') validate(s, l);
    else if (id === 'remove' && s.selected) { const job = s.jobs.find((j) => j.id === s.selected); if (job) { job.start = -1; job.lane = -1; s.message = `${job.name}已撤回待排队列。`; } }
  },
  metrics,
  progress(s, l) { return { current: s.jobs.filter((j) => j.start >= 0).length, total: l.jobs.length }; },
  outcome,
});
