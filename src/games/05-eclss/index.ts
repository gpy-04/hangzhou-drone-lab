import { clamp } from '../../core/canvas-utils';
import { createCanvasMiniGame, drawConsoleBackdrop, drawLabel } from '../../core/canvas-minigame';

interface RescueLevel {
  name: string;
  subtitle: string;
  objective: string;
  codexId: string;
  duration: number;
  lesson: string;
  scienceAction: string;
  targets: number;
  targetY: number;
  drift: number;
  driftRate: number;
  wind: number;
  catchWindow: number;
}

interface RescueState {
  simTime: number;
  cable: number;
  cableInput: -1 | 0 | 1;
  swing: number;
  swingRate: number;
  carrying: boolean;
  rescued: number;
  quality: number[];
  missed: number;
  message: string;
  lastCatchGrade: number;
}

const DRONE = { x: 500, y: 176 };

const levels: RescueLevel[] = [
  {
    name: '江岸静水救援', subtitle: '静止目标 · 练习绞车节奏',
    objective: '调节绳长让吊具接近目标；等摆动变小后接救，再收绳完成转运。',
    codexId: 'eclss-search-pattern', duration: 100,
    lesson: '悬吊物会像钟摆一样运动；缆绳越长，相同横向扰动造成的位置偏移通常越明显。',
    scienceAction: '你通过调节绞车、等待吊具摆动减小，在模拟安全窗口内完成接救；关卡用简化摆动演示悬吊载荷的惯性。',
    targets: 1, targetY: 524, drift: 0, driftRate: 0, wind: .035, catchWindow: 44,
  },
  {
    name: '钱塘潮汐转运', subtitle: '漂移目标 · 两次接救',
    objective: '找准两次漂移目标的接救窗口；收绳时留意吊具惯性和相对速度。',
    codexId: 'eclss-thermal-risk', duration: 145,
    lesson: '风和目标漂移会改变相对位置；只看距离、不看摆速，可能错过稳定接救窗口。',
    scienceAction: '你依据目标漂移、风扰和吊具相对速度选择接救时机；气象风险是任务条件之一，不能只根据单一数值判断安全。',
    targets: 2, targetY: 526, drift: 64, driftRate: .82, wind: .10, catchWindow: 40,
  },
  {
    name: '汛情夜间搜救', subtitle: '阵风扰动 · 窄窗口 · 两名待援者',
    objective: '在阵风中完成两次稳定吊离；摆幅过大时等待回摆，避免盲目接救。',
    codexId: 'eclss-rescue', duration: 175,
    lesson: '阵风会持续给吊载施加扰动；等待稳定窗口有助于降低吊具和目标发生碰撞的风险。',
    scienceAction: '你在自动悬停的模拟无人机上操作绞车，控制摆动并完成救援交接；实际救援流程需由专业人员依据现场情况组织。',
    targets: 2, targetY: 520, drift: 98, driftRate: 1.04, wind: .23, catchWindow: 30,
  },
];

function targetX(time: number, state: RescueState, level: RescueLevel): number {
  const phase = state.rescued * 1.31;
  return 500 + Math.sin(time * level.driftRate + phase) * level.drift;
}

function hookPosition(state: RescueState): { x: number; y: number } {
  return { x: DRONE.x + Math.sin(state.swing) * state.cable, y: DRONE.y + state.cable * Math.cos(state.swing) };
}

function attemptCatch(state: RescueState, level: RescueLevel): void {
  if (state.carrying || state.rescued >= level.targets) return;
  const hook = hookPosition(state);
  const tx = targetX(state.simTime, state, level);
  const dx = Math.abs(hook.x - tx);
  const dy = Math.abs(hook.y - level.targetY);
  const steady = Math.abs(state.swing) <= .27 && Math.abs(state.swingRate) <= .32;
  if (dx <= level.catchWindow && dy <= 38 && steady) {
    const quality = clamp(1 - Math.abs(state.swing) / .65 - Math.abs(state.swingRate) * .40, .35, 1);
    state.quality.push(quality);
    state.carrying = true;
    state.swing *= .52;
    state.swingRate *= .25;
    state.message = quality > .78 ? '稳定接救 · 目标已挂接' : '接救成功 · 吊具仍有轻微摆动';
    state.lastCatchGrade = quality;
  } else {
    state.missed++;
    state.message = !steady ? '窗口未稳定 · 等待吊具回摆后再接救' : dx > level.catchWindow ? '吊具未对准漂移目标 · 调整绳长并等待' : '吊具高度未对准 · 继续收放绞车';
  }
}

function drawDrone(ctx: CanvasRenderingContext2D, time: number): void {
  ctx.save();
  ctx.translate(DRONE.x, DRONE.y);
  const light = .5 + .5 * Math.sin(time * 4);
  ctx.strokeStyle = '#a6d8ed'; ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-58, -10); ctx.lineTo(-25, 0); ctx.moveTo(58, -10); ctx.lineTo(25, 0); ctx.stroke();
  for (const sign of [-1, 1]) {
    ctx.fillStyle = '#0b1a2c'; ctx.strokeStyle = '#75dff5'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(sign * 62, -14, 24, 6, -.12 * sign, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = `rgba(143, 239, 255, ${.35 + light * .45})`;
    ctx.beginPath(); ctx.ellipse(sign * 62, -14, 31, 9, -.12 * sign, 0, Math.PI * 2); ctx.stroke();
  }
  const body = ctx.createLinearGradient(-28, -10, 30, 18);
  body.addColorStop(0, '#456d87'); body.addColorStop(.42, '#d7e7ec'); body.addColorStop(1, '#51768a');
  ctx.fillStyle = body; ctx.strokeStyle = '#a5d8e8'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-30, -5); ctx.lineTo(-20, -19); ctx.lineTo(20, -19); ctx.lineTo(31, -5); ctx.lineTo(22, 12); ctx.lineTo(-24, 12); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#082338'; ctx.beginPath(); ctx.ellipse(0, -6, 13, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#54d7ee'; ctx.beginPath(); ctx.arc(-17, 4, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = `rgba(255, 73, 99, ${.58 + light * .35})`; ctx.beginPath(); ctx.arc(19, 3, 3, 0, Math.PI * 2); ctx.fill();
  // Gimbal-mounted winch spool below the autonomous hover craft.
  ctx.fillStyle = '#f3b953'; ctx.fillRect(-11, 12, 22, 8);
  ctx.fillStyle = '#0d2034'; ctx.fillRect(-7, 13, 14, 5);
  ctx.restore();
}

function drawScene(ctx: CanvasRenderingContext2D, state: RescueState, level: RescueLevel, width: number, height: number, time: number): void {
  drawConsoleBackdrop(ctx, width, height);
  ctx.save();
  // Twilight sky and distant Hangzhou riverfront.
  const sky = ctx.createLinearGradient(0, 80, 0, 580);
  sky.addColorStop(0, '#0a1730'); sky.addColorStop(.66, '#10273d'); sky.addColorStop(1, '#102b3a');
  ctx.fillStyle = sky; ctx.fillRect(25, 78, 950, 545);
  for (let i = 0; i < 13; i++) {
    const bw = 34 + (i % 3) * 12;
    const bh = 72 + ((i * 37) % 100);
    const bx = 32 + i * 76;
    ctx.fillStyle = i % 2 ? '#10263a' : '#132d42';
    ctx.fillRect(bx, 400 - bh, bw, bh);
    for (let wy = 413 - bh; wy < 397; wy += 17) {
      ctx.fillStyle = ((i * 3 + wy) % 4) ? 'rgba(246, 190, 100, .42)' : 'rgba(53, 200, 222, .28)';
      ctx.fillRect(bx + 7, wy, 4, 6); ctx.fillRect(bx + 19, wy, 4, 6); ctx.fillRect(bx + 30, wy, 3, 6);
    }
  }
  // Qiantang river with layered, moving current traces.
  ctx.fillStyle = '#082a42'; ctx.fillRect(25, 420, 950, 203);
  const water = ctx.createLinearGradient(0, 420, 0, 623);
  water.addColorStop(0, 'rgba(13, 89, 125, .76)'); water.addColorStop(1, '#061627');
  ctx.fillStyle = water; ctx.fillRect(25, 420, 950, 203);
  ctx.strokeStyle = 'rgba(83, 206, 225, .20)'; ctx.lineWidth = 1;
  for (let row = 0; row < 8; row++) {
    const y = 446 + row * 23;
    ctx.beginPath(); ctx.moveTo(38 + (time * (12 + row) % 68), y);
    for (let j = 0; j < 9; j++) ctx.lineTo(88 + j * 104, y + Math.sin(j * .7 + row) * 4);
    ctx.stroke();
  }

  // Mission overlay / simplified weather reading.
  ctx.fillStyle = 'rgba(3, 11, 23, .83)'; ctx.fillRect(45, 91, 232, 76);
  ctx.strokeStyle = 'rgba(80, 196, 225, .42)'; ctx.strokeRect(45, 91, 232, 76);
  drawLabel(ctx, 'WINCH RESCUE / 演练', 58, 116, '#82e4fa');
  drawLabel(ctx, `待援目标  ${state.rescued}/${level.targets}`, 58, 141, '#eaf5fa');
  const windLen = 28 + level.wind * 120;
  ctx.strokeStyle = level.wind > .18 ? '#ffb36e' : '#70d2e8'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(796, 125); ctx.lineTo(796 + windLen, 125); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(796 + windLen, 125); ctx.lineTo(796 + windLen - 9, 119); ctx.lineTo(796 + windLen - 9, 131); ctx.closePath(); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
  drawLabel(ctx, `阵风扰动 ${(level.wind * 10).toFixed(1)}`, 796, 152, '#b6d0df');

  drawDrone(ctx, time);
  const hook = hookPosition(state);
  const storm = .5 + .5 * Math.sin(time * 2.2);
  const cableEndX = hook.x;
  const cableEndY = hook.y;
  // Cable draws a slight catenary, emphasizing the visible connection to the hovering aircraft.
  ctx.strokeStyle = '#e4cb96'; ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.moveTo(DRONE.x, DRONE.y + 19);
  ctx.quadraticCurveTo((DRONE.x + cableEndX) / 2 + state.swing * 14, (DRONE.y + cableEndY) / 2, cableEndX, cableEndY); ctx.stroke();
  ctx.strokeStyle = 'rgba(239, 188, 86, .27)'; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(DRONE.x, DRONE.y + 19); ctx.lineTo(cableEndX, cableEndY); ctx.stroke();
  ctx.fillStyle = '#f3c969'; ctx.strokeStyle = '#fff0bd'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cableEndX, cableEndY, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#f6dfaa'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cableEndX - 8, cableEndY + 6); ctx.lineTo(cableEndX - 12, cableEndY + 17); ctx.lineTo(cableEndX + 12, cableEndY + 17); ctx.lineTo(cableEndX + 8, cableEndY + 6); ctx.stroke();

  if (state.carrying) {
    // Rescued person is visibly attached under the hook until the winch returns to a safe height.
    ctx.strokeStyle = '#f7d590'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cableEndX, cableEndY + 17); ctx.lineTo(cableEndX, cableEndY + 40); ctx.stroke();
    ctx.fillStyle = '#f08158'; ctx.beginPath(); ctx.ellipse(cableEndX, cableEndY + 50, 13, 20, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd7b4'; ctx.beginPath(); ctx.arc(cableEndX, cableEndY + 32, 8, 0, Math.PI * 2); ctx.fill();
  } else if (state.rescued < level.targets) {
    const tx = targetX(time, state, level);
    const ty = level.targetY;
    const confidence = clamp(1 - Math.abs(state.swing) / .75 - Math.abs(state.swingRate) * .25, .05, 1);
    ctx.strokeStyle = `rgba(74, 229, 204, ${.22 + confidence * .62})`;
    ctx.setLineDash([6, 5]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(tx, ty + 5, level.catchWindow + 8, 33, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    // Floating rescue marker and person silhouette.
    ctx.fillStyle = '#16263b'; ctx.beginPath(); ctx.ellipse(tx, ty + 5, 25, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffbd78'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(tx - 28, ty + 8); ctx.quadraticCurveTo(tx, ty - 9, tx + 28, ty + 8); ctx.stroke();
    ctx.fillStyle = '#f1a167'; ctx.beginPath(); ctx.arc(tx, ty - 24, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e57c5c'; ctx.beginPath(); ctx.ellipse(tx, ty - 7, 10, 17, -.12, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#f0ad70'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(tx - 5, ty + 3); ctx.lineTo(tx - 12, ty + 12); ctx.moveTo(tx + 5, ty + 3); ctx.lineTo(tx + 12, ty + 12); ctx.stroke();
    ctx.fillStyle = `rgba(247, 167, 85, ${.26 + storm * level.wind})`;
    ctx.beginPath(); ctx.arc(tx, ty - 5, 40 + storm * 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#11233a'; ctx.beginPath(); ctx.arc(tx, ty - 24, 8, 0, Math.PI * 2); ctx.fill();
  }

  // Swing gauge links visible motion to the safety window.
  const gaugeX = 802; const gaugeY = 282;
  ctx.fillStyle = 'rgba(4, 13, 26, .87)'; ctx.fillRect(752, 218, 193, 125);
  ctx.strokeStyle = 'rgba(100, 183, 210, .33)'; ctx.strokeRect(752, 218, 193, 125);
  drawLabel(ctx, '吊具摆角', 770, 243, '#7fcfe1');
  ctx.strokeStyle = 'rgba(165, 192, 205, .55)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(gaugeX - 57, gaugeY); ctx.lineTo(gaugeX + 57, gaugeY); ctx.stroke();
  ctx.strokeStyle = '#f4bc60'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(gaugeX, gaugeY); ctx.lineTo(gaugeX + Math.sin(state.swing) * 52, gaugeY + Math.cos(state.swing) * 46); ctx.stroke();
  ctx.fillStyle = '#f5d17f'; ctx.beginPath(); ctx.arc(gaugeX + Math.sin(state.swing) * 52, gaugeY + Math.cos(state.swing) * 46, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(66, 220, 185, .16)'; ctx.beginPath(); ctx.moveTo(gaugeX - 18, gaugeY); ctx.lineTo(gaugeX, gaugeY + 35); ctx.lineTo(gaugeX + 18, gaugeY); ctx.closePath(); ctx.fill();
  drawLabel(ctx, `${Math.round(state.swing * 57.3)}°`, 868, 313, Math.abs(state.swing) > .28 ? '#ffad7a' : '#89edc9');

  // Cable length slider and winch travel range.
  ctx.fillStyle = 'rgba(4, 13, 26, .89)'; ctx.fillRect(69, 230, 156, 226);
  ctx.strokeStyle = 'rgba(100, 183, 210, .33)'; ctx.strokeRect(69, 230, 156, 226);
  drawLabel(ctx, '绞车缆长', 87, 257, '#7fcfe1');
  const sliderTop = 288; const sliderBottom = 408;
  ctx.strokeStyle = 'rgba(122, 155, 173, .54)'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(111, sliderTop); ctx.lineTo(111, sliderBottom); ctx.stroke();
  ctx.strokeStyle = '#f4bc60'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(111, sliderTop + (state.cable - 110) / 255 * (sliderBottom - sliderTop)); ctx.lineTo(111, sliderBottom); ctx.stroke();
  ctx.fillStyle = '#ffe39a'; ctx.beginPath(); ctx.arc(111, sliderTop + (state.cable - 110) / 255 * (sliderBottom - sliderTop), 9, 0, Math.PI * 2); ctx.fill();
  drawLabel(ctx, `${Math.round(state.cable)} m`, 137, 324, '#ffe2a2');
  drawLabel(ctx, '绳短 / 回收', 88, 437, '#9fb6c5');

  const targetY = level.targetY;
  ctx.strokeStyle = 'rgba(63, 218, 190, .25)'; ctx.lineWidth = 1;
  ctx.setLineDash([4, 7]); ctx.beginPath(); ctx.moveTo(228, targetY); ctx.lineTo(760, targetY); ctx.stroke(); ctx.setLineDash([]);
  drawLabel(ctx, '接救高度参考', 238, targetY - 8, '#77d5c4');

  ctx.fillStyle = 'rgba(3, 10, 22, .9)'; ctx.fillRect(251, 572, 514, 38);
  ctx.strokeStyle = 'rgba(72, 174, 203, .32)'; ctx.strokeRect(251, 572, 514, 38);
  const tip = state.message || (state.carrying ? '人员已挂接 · 收绳至安全高度完成转运' : 'W / S 收放绞车 · Space 在目标附近且摆动稳定时接救');
  drawLabel(ctx, tip, 270, 597, state.message.includes('未') ? '#ffbd84' : '#a8e7f3');
  ctx.restore();
}

export const eclssGame = createCanvasMiniGame<RescueState, RescueLevel>({
  meta: {
    id: 'eclss', number: '05', shortTitle: '汛情救援', title: '汛情无人机绞车救援',
    enTitle: 'FLOOD RESPONSE WINCH', moduleName: '钱塘江汛情演练区',
    genre: '绞车控制与摆动时机', tagline: '控制悬吊载荷，等待安全窗口完成模拟救援',
    accent: '#ef4444', hubAnchor: { x: .62, y: .65 },
    briefingSteps: [
      { title: '无人机自动悬停', desc: '飞行器保持位置；你只负责观察缆长、吊具摆角和水面目标。' },
      { title: '调节救援绞车', desc: '按住 W 收绳、S 放绳；绳长变化会影响吊具的运动。' },
      { title: '等待稳定窗口', desc: '目标进入接救环且吊具摆速较小时按 Space，再收绳到安全高度。' },
    ],
    controlsHint: 'W / S 按住收放绞车 · Space 在稳定窗口接救 · 吊离后将缆绳收至安全高度',
  },
  levels,
  controls: [
    { id: 'reel-in', label: '收绳', key: 'W', title: '按住收绳' },
    { id: 'pay-out', label: '放绳', key: 'S', title: '按住放绳' },
    { id: 'catch', label: '接救目标', title: '尝试接救当前目标', tone: 'gold' },
  ],
  createState() {
    return { simTime: 0, cable: 214, cableInput: 0, swing: .11, swingRate: 0, carrying: false, rescued: 0, quality: [], missed: 0, message: '', lastCatchGrade: 0 };
  },
  update(state, dt, level, time) {
    state.simTime = time;
    state.cable = clamp(state.cable - state.cableInput * dt * 78, 110, 365);
    const windPhase = Math.sin(time * 1.35) + .42 * Math.sin(time * 2.2 + 1.1);
    const windTorque = level.wind * windPhase * (state.carrying ? .55 : 1);
    const gravity = -9.8 / Math.max(170, state.cable) * Math.sin(state.swing);
    state.swingRate += (gravity + windTorque) * dt;
    state.swingRate *= Math.exp(-dt * (state.carrying ? .82 : .58));
    state.swing += state.swingRate * dt;
    state.swing = clamp(state.swing, -.82, .82);
    if (state.carrying && state.cable <= 150) {
      state.carrying = false;
      state.rescued++;
      state.message = state.rescued >= level.targets ? '安全转运完成 · 本关救援交接成功' : '目标已安全交接 · 下一名待援者已定位';
      if (state.rescued < level.targets) {
        state.cable = 210;
        state.swing *= .35;
        state.swingRate *= .2;
      }
    }
  },
  draw: drawScene,
  key(state, key, phase, level) {
    if (phase === 'down' && (key === ' ' || key === 'Space')) attemptCatch(state, level);
  },
  control(state, id, phase, level) {
    if (id === 'reel-in') state.cableInput = phase === 'down' ? 1 : state.cableInput === 1 ? 0 : state.cableInput;
    else if (id === 'pay-out') state.cableInput = phase === 'down' ? -1 : state.cableInput === -1 ? 0 : state.cableInput;
    else if (id === 'catch' && phase === 'down') attemptCatch(state, level);
  },
  metrics(state, level, time) {
    const swing = Math.abs(state.swing);
    return [
      { id: 'rescue-progress', label: '安全交接', value: `${state.rescued} / ${level.targets}`, ratio: state.rescued / level.targets, status: state.rescued === level.targets ? 'nominal' : 'info' },
      { id: 'cable', label: '缆绳长度', value: `${Math.round(state.cable)} m`, ratio: (state.cable - 110) / 255, status: state.cable <= 150 ? 'nominal' : 'info' },
      { id: 'sway', label: '吊具摆动', value: `${Math.round(swing * 57.3)}°`, status: swing > .42 ? 'caution' : 'nominal' },
      { id: 'rescue-time', label: '任务余时', value: `${Math.max(0, Math.ceil(level.duration - time))} 秒`, status: time > level.duration * .82 ? 'caution' : 'nominal' },
    ];
  },
  progress(state, level) {
    return { current: state.rescued, total: level.targets };
  },
  outcome(state, level) {
    if (state.rescued < level.targets) return null;
    const steadiness = state.quality.reduce((sum, quality) => sum + quality, 0) / level.targets;
    const missPenalty = Math.min(220, state.missed * 25);
    const score = Math.round(clamp(steadiness * 780 + (level.targets - Math.max(0, state.missed)) / level.targets * 220 - missPenalty, 0, 1000));
    return {
      won: true,
      score,
      summary: `救援交接完成：${state.rescued} 名目标安全转运，稳定接救质量 ${Math.round(steadiness * 100)}%，错过窗口 ${state.missed} 次。`,
      metrics: [
        { label: '安全交接', value: `${state.rescued} / ${level.targets}`, status: 'nominal' },
        { label: '接救稳定度', value: `${Math.round(steadiness * 100)}%`, status: steadiness > .72 ? 'nominal' : 'caution' },
        { label: '错过窗口', value: `${state.missed} 次`, status: state.missed === 0 ? 'nominal' : 'info' },
      ],
    };
  },
});
