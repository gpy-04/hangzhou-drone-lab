import { createCanvasMiniGame, drawConsoleBackdrop, drawLabel } from '../../core/canvas-minigame';

interface InspectionCase {
  title: string;
  stage: string;
  sequence: string;
  aiLabel: '裂缝候选' | '表面异常';
  confidence: number;
  trueDefect: boolean;
  visual: 'crack' | 'reflection' | 'stain' | 'corrosion' | 'spalling';
  hotspot: { x: number; y: number };
  thermalPattern: 'none' | 'edge' | 'diffuse' | 'localized' | 'weak';
  thermalClue: string;
  photo?: {
    src: string;
    focus: { x: number; y: number };
    subject: string;
    credit: string;
  };
  clue: string;
}

interface InspectionLevel {
  name: string;
  subtitle: string;
  objective: string;
  codexId: string;
  duration: number;
  lesson: string;
  scienceAction: string;
  cases: InspectionCase[];
  retakeLimit: number;
}

interface InspectionState {
  current: number;
  mode: 'visible' | 'thermal';
  aiStatus: 'idle' | 'scanning' | 'ready';
  aiProgress: number;
  evidence: { x: number; y: number } | null;
  viewedModes: { visible: boolean; thermal: boolean };
  decisions: Array<{ correct: boolean; evidenceHit: boolean; modeUseful: boolean }>;
  retakes: number;
  retakeLimit: number;
  decision: boolean | null;
  cardMessage: string;
}

const IMAGE = { x: 250, y: 156, width: 520, height: 356 };
const inspectionPhotos = new Map<string, HTMLImageElement>();

function getInspectionPhoto(src: string): HTMLImageElement | null {
  let image = inspectionPhotos.get(src);
  if (!image) {
    image = new Image();
    image.decoding = 'async';
    image.src = src;
    inspectionPhotos.set(src, image);
  }
  return image.complete && image.naturalWidth > 0 ? image : null;
}

function photoCrop(image: HTMLImageElement, focus: { x: number; y: number }) {
  const frameRatio = IMAGE.width / IMAGE.height;
  const imageRatio = image.naturalWidth / image.naturalHeight;
  const cropWidth = imageRatio > frameRatio ? image.naturalHeight * frameRatio : image.naturalWidth;
  const cropHeight = imageRatio > frameRatio ? image.naturalHeight : image.naturalWidth / frameRatio;
  const sx = Math.max(0, Math.min(image.naturalWidth - cropWidth, image.naturalWidth * focus.x - cropWidth / 2));
  const sy = Math.max(0, Math.min(image.naturalHeight - cropHeight, image.naturalHeight * focus.y - cropHeight / 2));
  return {
    sx, sy, sw: cropWidth, sh: cropHeight,
    hotspot: {
      x: (image.naturalWidth * focus.x - sx) / cropWidth,
      y: (image.naturalHeight * focus.y - sy) / cropHeight,
    },
  };
}

function caseHotspot(item: InspectionCase): { x: number; y: number } {
  if (!item.photo) return item.hotspot;
  const image = getInspectionPhoto(item.photo.src);
  return image ? photoCrop(image, item.photo.focus).hotspot : item.hotspot;
}

function drawInspectionPhoto(ctx: CanvasRenderingContext2D, item: InspectionCase, mode: InspectionState['mode']): { x: number; y: number } | null {
  if (!item.photo) return null;
  const image = getInspectionPhoto(item.photo.src);
  if (!image) return null;

  const crop = photoCrop(image, item.photo.focus);
  ctx.save();
  ctx.beginPath();
  ctx.rect(IMAGE.x, IMAGE.y, IMAGE.width, IMAGE.height);
  ctx.clip();
  ctx.filter = mode === 'thermal' ? 'grayscale(.72) contrast(1.08) saturate(.45)' : 'none';
  ctx.drawImage(image, crop.sx, crop.sy, crop.sw, crop.sh, IMAGE.x, IMAGE.y, IMAGE.width, IMAGE.height);
  ctx.filter = 'none';
  if (mode === 'thermal') {
    // Teaching visualization only: these patterns are authored clues, not simulated temperatures.
    ctx.fillStyle = 'rgba(10, 24, 77, .58)';
    ctx.fillRect(IMAGE.x, IMAGE.y, IMAGE.width, IMAGE.height);
    const hx = IMAGE.x + crop.hotspot.x * IMAGE.width;
    const hy = IMAGE.y + crop.hotspot.y * IMAGE.height;
    ctx.globalCompositeOperation = 'screen';
    if (item.thermalPattern === 'edge') {
      const heat = ctx.createRadialGradient(hx, hy, 2, hx, hy, 84);
      heat.addColorStop(0, 'rgba(255, 175, 57, .7)');
      heat.addColorStop(.45, 'rgba(57, 215, 235, .5)');
      heat.addColorStop(1, 'rgba(25, 41, 127, 0)');
      ctx.save(); ctx.translate(hx, hy); ctx.rotate(-.35); ctx.scale(2.4, .24);
      ctx.fillStyle = heat; ctx.beginPath(); ctx.arc(0, 0, 42, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    } else if (item.thermalPattern === 'diffuse') {
      const heat = ctx.createRadialGradient(hx, hy, 8, hx, hy, 128);
      heat.addColorStop(0, 'rgba(255, 173, 58, .52)');
      heat.addColorStop(.48, 'rgba(71, 222, 232, .43)');
      heat.addColorStop(1, 'rgba(25, 41, 127, 0)');
      ctx.fillStyle = heat; ctx.fillRect(IMAGE.x, IMAGE.y, IMAGE.width, IMAGE.height);
    } else if (item.thermalPattern === 'localized' || item.thermalPattern === 'weak') {
      const radius = item.thermalPattern === 'weak' ? 48 : 88;
      const alpha = item.thermalPattern === 'weak' ? .28 : .78;
      const heat = ctx.createRadialGradient(hx, hy, 2, hx, hy, radius);
      heat.addColorStop(0, `rgba(255, 74, 55, ${alpha})`);
      heat.addColorStop(.36, `rgba(255, 172, 51, ${alpha * .72})`);
      heat.addColorStop(.72, `rgba(81, 211, 242, ${alpha * .4})`);
      heat.addColorStop(1, 'rgba(25, 41, 127, 0)');
      ctx.fillStyle = heat; ctx.fillRect(IMAGE.x, IMAGE.y, IMAGE.width, IMAGE.height);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
  return crop.hotspot;
}

function drawPhotoCandidate(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = 'rgba(255, 203, 112, .92)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x - 31, y - 23, 62, 46);
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(7, 18, 31, .82)';
  ctx.fillRect(x - 26, y - 38, 54, 13);
  ctx.font = '600 9px "Noto Sans SC", sans-serif';
  ctx.fillStyle = '#ffe0a1';
  ctx.fillText('AI 候选', x - 22, y - 28);
  ctx.restore();
}

function drawPhotoCredit(ctx: CanvasRenderingContext2D, photo: InspectionCase['photo']): void {
  if (!photo) return;
  const credit = `实拍参考：${photo.subject} · ${photo.credit} · 非杭州现场`;
  ctx.save();
  ctx.font = '11px "Noto Sans SC", sans-serif';
  ctx.fillStyle = '#9eb4c2';
  ctx.fillText(credit, IMAGE.x, 531, IMAGE.width);
  ctx.restore();
}

const levels: InspectionLevel[] = [
  {
    name: '桥面初检', subtitle: '可见光 · 明显结构异常',
    objective: '查看真实桥梁影像，请求 AI 分析后再复核异常建议。',
    codexId: 'robotic-arm-ai-vision', duration: 110,
    lesson: '机器视觉会从影像中找相似特征；视角、光照与遮挡都会改变识别结果。',
    scienceAction: '你先标出桥面结构影像中的证据，再复核 AI 候选；这模拟“模型提示、人来查证”的流程。',
    retakeLimit: 1,
    cases: [
      { title: '伸缩缝 A-03', stage: '单图练习 · 定位裂缝', sequence: '先找纹理中断，再比较 AI 提示。', aiLabel: '裂缝候选', confidence: .86, trueDefect: true, visual: 'crack', hotspot: { x: .48, y: .47 }, thermalPattern: 'weak', thermalClue: '本例只显示微弱教学色斑；表面细裂未必形成可辨温差。', photo: { src: './assets/inspection/sellwood-bridge-cracks.jpg', focus: { x: .32, y: .52 }, subject: 'Sellwood Bridge 混凝土栏板裂缝', credit: 'Steve Morgan · CC BY-SA 3.0' }, clue: '细线跨过接缝，边缘纹理发生中断。' },
    ],
  },
  {
    name: '裂缝复核', subtitle: '可见光 / 热成像 · 阴影误报',
    objective: '逐项复核三处 AI 告警；每项都要标记证据再接受或驳回。',
    codexId: 'robotic-arm-false-positive', duration: 145,
    lesson: '高置信度不代表必然正确；要将原图、位置和其他传感信息一起核对。',
    scienceAction: '你对比了真实可见光与教学伪彩线索，并依据局部证据复核 AI 告警；伪彩不是真实热成像，置信度也不是事实证明。',
    retakeLimit: 1,
    cases: [
      { title: '梁体 B-11', stage: '误报对照 1/3 · 伸缩缝', sequence: '先认出设计缝，再检查周边有无损伤。', aiLabel: '裂缝候选', confidence: .93, trueDefect: false, visual: 'reflection', hotspot: { x: .66, y: .42 }, thermalPattern: 'edge', thermalClue: '缝边出现线状色带；构造边缘或表面条件也会造成类似提示，不能据此判裂。', photo: { src: './assets/inspection/bridge-deck-joint.jpg', focus: { x: .54, y: .7 }, subject: '密歇根州 M-6 普通桥面与伸缩缝', credit: 'Retaildesigner · 公共领域' }, clue: '高置信亮斑只出现在可见光，热像没有对应温差。' },
      { title: '桥墩 B-14', stage: '异常对照 2/3 · 露筋', sequence: '这是真实材料异常；再与表面色斑区分。', aiLabel: '表面异常', confidence: .71, trueDefect: true, visual: 'corrosion', hotspot: { x: .34, y: .63 }, thermalPattern: 'localized', thermalClue: '局部色斑与可见异常大致重合；模拟只提示复查位置，不能确认锈蚀或损伤深度。', photo: { src: './assets/inspection/st-johns-bridge-rebar.jpg', focus: { x: .51, y: .5 }, subject: 'St. Johns Bridge 外露锈蚀钢筋', credit: 'OregonDOT · CC BY 2.0' }, clue: '异常纹理沿接缝延伸；热像显示同位置的温差区域。' },
      { title: '护栏 B-19', stage: '误报对照 3/3 · 表面水渍', sequence: '色差只能提示复查，不能单独证明裂缝。', aiLabel: '裂缝候选', confidence: .88, trueDefect: false, visual: 'stain', hotspot: { x: .53, y: .54 }, thermalPattern: 'diffuse', thermalClue: '宽而模糊的教学色带可能受水分、日照或表面材质影响，不等同于裂缝信号。', photo: { src: './assets/inspection/concrete-water-stain.jpg', focus: { x: .5, y: .58 }, subject: '圣迭戈混凝土表面水渍对照图', credit: 'Mds08011 · CC BY 4.0' }, clue: '污渍边缘不连续，没有贯穿结构的细线。' },
    ],
  },
  {
    name: '桥梁构造与缺陷复核', subtitle: '从正常构造到损伤证据 · 有限复核机会',
    objective: '依次对照伸缩缝、裂缝、混凝土剥落与露筋；照片是不同构件的样本，不是连续记录。',
    codexId: 'robotic-arm-inspection', duration: 180,
    lesson: '先区分设计伸缩缝与混凝土裂缝，再记录剥落和露筋；单张照片和 AI 分数都不能代替现场检测。',
    scienceAction: '你按“正常构造→裂缝线索→保护层剥落→露筋与维修痕迹”完成了跨案例复核。照片来自不同现场或构件，是比较样本而非同一构件的连续记录；伪彩热区并非实测温度。',
    retakeLimit: 1,
    cases: [
      {
        title: '桥面 C-08', stage: '01/04 · 正常设计伸缩缝', sequence: '先建立构造基准，再检查相邻混凝土有无损伤。', aiLabel: '表面异常', confidence: .94, trueDefect: false, visual: 'reflection', hotspot: { x: .54, y: .64 },
        thermalPattern: 'edge', thermalClue: '缝边有线状教学色带；金属与几何边缘可能造成类似表现，正常伸缩缝仍是正常构造。',
        photo: { src: './assets/inspection/bridge-expansion-joint-detail.jpg', focus: { x: .5, y: .5 }, subject: '纽约州 Congress Street Bridge 钢梁伸缩缝', credit: 'Matt H. Wade · CC BY-SA 3.0' },
        clue: '伸缩缝是桥梁设计构造，缝隙本身不等于混凝土裂缝；还要检查周边损伤。',
      },
      {
        title: '桥台 C-02', stage: '02/04 · 混凝土裂缝', sequence: '确认裂缝位于混凝土后，再看表层是否剥落。', aiLabel: '裂缝候选', confidence: .64, trueDefect: true, visual: 'crack', hotspot: { x: .48, y: .47 },
        thermalPattern: 'weak', thermalClue: '伪彩中没有明显局部色斑；缺少热异常不能排除可见裂缝。',
        photo: { src: './assets/inspection/bridge-support-wall-crack.jpg', focus: { x: .58, y: .5 }, subject: 'Rudgwick 桥台支承墙裂缝', credit: 'Dave Spicer · CC BY-SA 2.0' },
        clue: '支承墙影像中可见细裂；低置信不等于没有异常，仍需现场复测。',
      },
      {
        title: '桥墩 C-17', stage: '03/04 · 保护层剥落', sequence: '剥落可能露出钢筋；下一步检查钢筋与维修线索。', aiLabel: '表面异常', confidence: .76, trueDefect: true, visual: 'spalling', hotspot: { x: .5, y: .55 },
        thermalPattern: 'localized', thermalClue: '局部教学色斑提示重点复查该区域；单张伪彩不能判断剥落深度或结构安全。',
        photo: { src: './assets/inspection/st-johns-pier-spalling.jpg', focus: { x: .45, y: .42 }, subject: 'St. Johns Bridge 桥墩混凝土剥落', credit: 'OregonDOT · CC BY 2.0' },
        clue: '桥墩保护层剥落并露出内部材料；需进一步评估范围、深度和钢筋状态。',
      },
      {
        title: '桥拱 C-12', stage: '04/04 · 露筋与维修痕迹', sequence: '记录露筋和维修边缘；范围、深度需现场量测。', aiLabel: '表面异常', confidence: .82, trueDefect: true, visual: 'corrosion', hotspot: { x: .5, y: .5 },
        thermalPattern: 'diffuse', thermalClue: '维修边缘附近呈宽泛不均的教学色带；修补材料与日照条件都可能影响真实热像。',
        photo: { src: './assets/inspection/st-johns-bridge-repair.jpg', focus: { x: .5, y: .5 }, subject: 'St. Johns Bridge 受损混凝土与维修边缘', credit: 'OregonDOT · CC BY 2.0' },
        clue: '拱肋边缘可见混凝土剥落和维修痕迹；照片无法量化损伤深度或钢筋截面损失。',
      },
    ],
  },
];

function currentCase(state: InspectionState, level: InspectionLevel): InspectionCase {
  return level.cases[Math.min(state.current, level.cases.length - 1)];
}

function pushDecision(state: InspectionState, level: InspectionLevel): void {
  if (state.aiStatus !== 'ready' || state.decision === null || !state.evidence) return;
  const item = currentCase(state, level);
  const correct = state.decision === item.trueDefect;
  const target = caseHotspot(item);
  const dx = state.evidence.x - target.x;
  const dy = state.evidence.y - target.y;
  const evidenceHit = Math.hypot(dx, dy) <= .11;
  const modeUseful = state.viewedModes.visible && state.viewedModes.thermal;
  state.decisions.push({ correct, evidenceHit, modeUseful });
  state.current++;
  state.aiStatus = 'idle';
  state.aiProgress = 0;
  state.evidence = null;
  state.viewedModes = { visible: true, thermal: false };
  state.decision = null;
  state.cardMessage = state.current >= level.cases.length
    ? '复核完成 · 正在生成鉴证记录'
    : correct && evidenceHit ? '证据与判断一致 · 下一张影像' : '记录已保存 · 检查下一处候选';
}

function act(state: InspectionState, action: string, level: InspectionLevel): void {
  if (state.current >= level.cases.length) return;
  if (action === 'requestAI' && state.aiStatus === 'idle') {
    state.aiStatus = 'scanning';
    state.aiProgress = 0;
    state.cardMessage = '正在分析当前实拍影像…';
    return;
  }
  if (action === 'visible' || action === 'thermal') {
    state.mode = action;
    state.viewedModes[action] = true;
    return;
  }
  if (action === 'retake' && state.retakes < state.retakeLimit) {
    state.retakes++;
    state.mode = state.mode === 'visible' ? 'thermal' : 'visible';
    state.evidence = null;
    state.cardMessage = '复核机会已使用 · 切换教学成像通道';
    return;
  }
  if (action === 'accept') {
    if (state.aiStatus !== 'ready') { state.cardMessage = '先请求 AI 分析，获得建议后再作判断'; return; }
    if (!state.evidence) { state.cardMessage = '先在影像中标记支持判断的局部证据'; return; }
    if (level.cases.length > 1 && (!state.viewedModes.visible || !state.viewedModes.thermal)) { state.cardMessage = '先对照可见光与伪彩教学模拟；两种视图都看过后再判断'; return; }
    state.decision = true;
    pushDecision(state, level);
  }
  if (action === 'reject') {
    if (state.aiStatus !== 'ready') { state.cardMessage = '先请求 AI 分析，获得建议后再作判断'; return; }
    if (!state.evidence) { state.cardMessage = '先在影像中标记支持判断的局部证据'; return; }
    if (level.cases.length > 1 && (!state.viewedModes.visible || !state.viewedModes.thermal)) { state.cardMessage = '先对照可见光与伪彩教学模拟；两种视图都看过后再判断'; return; }
    state.decision = false;
    pushDecision(state, level);
  }
}

function drawCrack(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 17, y - 23);
  ctx.lineTo(x - 3, y - 7);
  ctx.lineTo(x - 10, y + 4);
  ctx.lineTo(x + 4, y + 14);
  ctx.lineTo(x + 17, y + 27);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(250, 253, 255, .65)';
  ctx.lineWidth = .8;
  ctx.beginPath();
  ctx.moveTo(x - 14, y - 22);
  ctx.lineTo(x - 1, y - 6);
  ctx.lineTo(x - 8, y + 5);
  ctx.stroke();
  ctx.restore();
}

function drawScene(ctx: CanvasRenderingContext2D, state: InspectionState, level: InspectionLevel, width: number, height: number, time: number): void {
  drawConsoleBackdrop(ctx, width, height);
  ctx.save();
  ctx.fillStyle = 'rgba(4, 10, 20, .76)';
  ctx.fillRect(34, 78, 932, 555);
  ctx.strokeStyle = 'rgba(87, 178, 220, .38)';
  ctx.strokeRect(34, 78, 932, 555);

  const active = currentCase(state, level);
  const done = state.current >= level.cases.length;
  drawLabel(ctx, `AI VISION REVIEW / ${active.photo ? '真实影像参考 · 非杭州现场 · AI 分析为本地教学模拟' : '教学模拟影像'}`, 54, 109, '#8bdcf5');
  drawLabel(ctx, `CASE ${String(Math.min(state.current + 1, level.cases.length)).padStart(2, '0')} / ${level.cases.length}`, 814, 109, '#f5c86c');

  const photoHotspot = !done ? drawInspectionPhoto(ctx, active, state.mode) : null;
  if (!photoHotspot && !done) {
    ctx.fillStyle = '#172a38'; ctx.fillRect(IMAGE.x, IMAGE.y, IMAGE.width, IMAGE.height);
    drawLabel(ctx, '正在载入实拍影像…', IMAGE.x + 184, IMAGE.y + 182, '#c5d8e5');
  }
  const targetHotspot = photoHotspot ?? (done ? active.hotspot : caseHotspot(active));

  if (!done) {
    const hx = IMAGE.x + targetHotspot.x * IMAGE.width;
    const hy = IMAGE.y + targetHotspot.y * IMAGE.height;
    if (photoHotspot) {
      if (state.aiStatus === 'ready') drawPhotoCandidate(ctx, hx, hy);
    } else if (!active.photo && state.mode === 'visible') {
      if (active.visual === 'crack') drawCrack(ctx, hx, hy, '#17242a');
      if (active.visual === 'corrosion') {
        ctx.fillStyle = '#b46c45'; ctx.beginPath(); ctx.ellipse(hx, hy, 23, 14, -.25, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(223, 151, 87, .72)'; ctx.fillRect(hx - 14, hy - 3, 28, 3);
      }
      if (active.visual === 'reflection') {
        ctx.save(); ctx.translate(hx, hy); ctx.rotate(-.42);
        ctx.fillStyle = 'rgba(255, 225, 139, .67)'; ctx.beginPath(); ctx.ellipse(0, 0, 36, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
      if (active.visual === 'stain') {
        ctx.fillStyle = 'rgba(74, 82, 72, .75)'; ctx.beginPath(); ctx.ellipse(hx, hy, 28, 13, .22, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(154, 158, 130, .45)'; ctx.beginPath(); ctx.ellipse(hx + 8, hy - 4, 12, 6, -.25, 0, Math.PI * 2); ctx.fill();
      }
    } else if (active.trueDefect) {
      const glow = ctx.createRadialGradient(hx, hy, 5, hx, hy, 52);
      glow.addColorStop(0, active.visual === 'corrosion' ? 'rgba(255, 95, 74, .88)' : 'rgba(251, 146, 60, .82)');
      glow.addColorStop(.45, 'rgba(251, 191, 36, .52)'); glow.addColorStop(1, 'rgba(59, 130, 246, 0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(hx, hy, 52, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(248, 113, 113, .8)'; ctx.beginPath(); ctx.arc(hx, hy, 7 + Math.sin(time * 4) * 2, 0, Math.PI * 2); ctx.fill();
    } else {
      // False-positive cases deliberately show a visible reflection/stain but no matching heat signature.
      ctx.strokeStyle = 'rgba(96, 165, 250, .34)'; ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(hx, hy, 8 + i * 10, 0, Math.PI * 2); ctx.stroke(); }
    }
    if (state.evidence) {
      const ex = IMAGE.x + state.evidence.x * IMAGE.width;
      const ey = IMAGE.y + state.evidence.y * IMAGE.height;
      ctx.strokeStyle = '#63f0d0'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ex, ey, 18, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex - 25, ey); ctx.lineTo(ex + 25, ey); ctx.moveTo(ex, ey - 25); ctx.lineTo(ex, ey + 25); ctx.stroke();
      drawLabel(ctx, '证据已标记', ex + 23, ey - 14, '#7ef7dd');
    }
  }

  ctx.strokeStyle = state.mode === 'visible' ? '#56cbe8' : '#f8a65b';
  ctx.lineWidth = 2; ctx.strokeRect(IMAGE.x, IMAGE.y, IMAGE.width, IMAGE.height);
  ctx.fillStyle = 'rgba(4, 11, 22, .87)'; ctx.fillRect(IMAGE.x, IMAGE.y - 27, IMAGE.width, 24);
  drawLabel(ctx, state.mode === 'visible' ? 'RGB / 真实可见光照片' : 'IR / 伪彩教学模拟 · 非实测温度', IMAGE.x + 10, IMAGE.y - 10, state.mode === 'visible' ? '#82e5fa' : '#ffc880');
  if (photoHotspot) drawPhotoCredit(ctx, active.photo);

  // Persistent evidence panel makes the learning clue available without interrupting play.
  const sideX = 796;
  ctx.fillStyle = 'rgba(7, 18, 32, .94)'; ctx.fillRect(sideX, 156, 151, 356);
  ctx.strokeStyle = 'rgba(111, 172, 202, .28)'; ctx.strokeRect(sideX, 156, 151, 356);
  drawLabel(ctx, done ? '复核摘要' : active.stage, sideX + 13, 183, '#8bdcf5');
  drawLabel(ctx, done ? `${state.decisions.filter((d) => d.correct).length} 项判断正确` : state.aiStatus === 'ready' ? active.aiLabel : state.aiStatus === 'scanning' ? '正在分析…' : '尚未请求分析', sideX + 13, 216, '#f4ca72');
  if (!done) {
    if (state.aiStatus === 'ready') drawLabel(ctx, `置信度 ${Math.round(active.confidence * 100)}%`, sideX + 13, 246, '#d8e9f4');
    else if (state.aiStatus === 'scanning') {
      ctx.fillStyle = 'rgba(21, 39, 59, .9)'; ctx.fillRect(sideX + 13, 260, 125, 6);
      ctx.fillStyle = '#54d6ef'; ctx.fillRect(sideX + 13, 260, 125 * state.aiProgress, 6);
    }
    drawLabel(ctx, '判读逻辑', sideX + 13, 298, '#76a2ba');
    const sequenceLines = active.sequence.match(/.{1,9}/gu) ?? [active.sequence];
    sequenceLines.slice(0, 3).forEach((line, index) => drawLabel(ctx, line, sideX + 13, 322 + index * 20, '#c4d9e7'));
      drawLabel(ctx, state.mode === 'visible' ? '可见光线索' : '伪彩模拟线索', sideX + 13, 394, '#76a2ba');
    if (state.aiStatus === 'ready') {
      const activeClue = state.mode === 'visible' ? active.clue : active.thermalClue;
      const clueLines = activeClue.match(/.{1,9}/gu) ?? [activeClue];
      clueLines.slice(0, 4).forEach((line, index) => drawLabel(ctx, line, sideX + 13, 418 + index * 18, '#c4d9e7'));
    } else {
      drawLabel(ctx, '请求分析后', sideX + 13, 418, '#c4d9e7');
      drawLabel(ctx, '解锁复核线索', sideX + 13, 438, '#c4d9e7');
    }
    drawLabel(ctx, `已查看 RGB ${state.viewedModes.visible ? '✓' : '—'} / 伪彩 ${state.viewedModes.thermal ? '✓' : '—'}`, sideX + 13, 500, '#91a5b6');
  }

  // Learning note is concise and continuously visible.
  ctx.fillStyle = 'rgba(5, 16, 28, .94)'; ctx.fillRect(55, 541, 890, 60);
  ctx.strokeStyle = 'rgba(51, 195, 222, .28)'; ctx.strokeRect(55, 541, 890, 60);
  drawLabel(ctx, '巡检知识', 72, 565, '#65d8ef');
  drawLabel(ctx, state.cardMessage || (state.aiStatus === 'ready' ? 'AI 已给出候选；请结合照片证据决定采纳或驳回。' : '先查看真实照片，再请求 AI 帮助解锁建议。'), 166, 565, '#dae8f1');
  drawLabel(ctx, '实拍照片用于教学参考  ·  伪彩与 AI 建议由本地规则模拟  ·  结果需由人复核', 166, 585, '#8fa9bb');
  if (done) {
    ctx.fillStyle = 'rgba(3, 10, 19, .72)'; ctx.fillRect(IMAGE.x, IMAGE.y, IMAGE.width, IMAGE.height);
    drawLabel(ctx, '本关影像复核完成', IMAGE.x + 155, IMAGE.y + 174, '#a3f4df');
  }
  ctx.restore();
}

export const roboticArmGame = createCanvasMiniGame<InspectionState, InspectionLevel>({
  meta: {
    id: 'robotic-arm', number: '04', shortTitle: 'AI 巡检', title: 'AI 视觉巡检鉴证',
    enTitle: 'AI VISION EVIDENCE REVIEW', moduleName: '钱塘江基础设施巡检线',
    genre: '双通道影像与证据复核', tagline: '标记疑点，比较成像，判断 AI 告警是否可信',
    accent: '#c084fc', hubAnchor: { x: .37, y: .57 },
    briefingSteps: [
      { title: '检查候选影像', desc: 'AI 只标记可能的异常；点选影像中能支持判断的局部证据。' },
      { title: '比较成像通道', desc: '对比可见光与热区教学模拟；真实温差必须由校准的红外传感器测得。' },
      { title: '复核并记录', desc: '选择接受或驳回；判断和证据都正确，才能获得完整评价。' },
    ],
    controlsHint: '先按 A 请求 AI 分析，再点影像标记证据 · 1 可见光 / 2 伪彩模拟 · Enter 采纳 / Backspace 驳回',
  },
  levels,
  controls: [
    { id: 'requestAI', label: '请求 AI 分析', key: 'A', tone: 'gold' },
    { id: 'visible', label: '可见光', key: '1' },
    { id: 'thermal', label: '热区模拟', key: '2' },
    { id: 'retake', label: '切换复核通道', key: 'R' },
    { id: 'accept', label: '采纳 AI 告警', key: 'Enter', tone: 'gold' },
    { id: 'reject', label: '驳回 AI 告警', key: 'Backspace', tone: 'danger' },
  ],
  createState(level) {
    return { current: 0, mode: 'visible', aiStatus: 'idle', aiProgress: 0, evidence: null, viewedModes: { visible: true, thermal: false }, decisions: [], retakes: 0, retakeLimit: level.retakeLimit, decision: null, cardMessage: '' };
  },
  update(state, dt) {
    if (state.aiStatus !== 'scanning') return;
    state.aiProgress = Math.min(1, state.aiProgress + dt / 1.25);
    if (state.aiProgress >= 1) {
      state.aiStatus = 'ready';
      state.cardMessage = 'AI 建议已解锁 · 查看候选位置并标记原图证据';
    }
  },
  draw: drawScene,
  pointer(state, event, level) {
    if (event.type !== 'down' || state.current >= level.cases.length) return;
    if (event.x < IMAGE.x || event.x > IMAGE.x + IMAGE.width || event.y < IMAGE.y || event.y > IMAGE.y + IMAGE.height) return;
    state.evidence = { x: (event.x - IMAGE.x) / IMAGE.width, y: (event.y - IMAGE.y) / IMAGE.height };
    state.cardMessage = state.aiStatus === 'ready' ? '证据位置已标记 · 可采纳或驳回 AI 建议' : '证据位置已标记 · 请求 AI 分析后即可作出判断';
  },
  control(state, id, phase, level) {
    if (phase === 'down') act(state, id, level);
  },
  metrics(state, level, time) {
    const judgments = state.decisions.filter((decision) => decision.correct).length;
    const evidence = state.decisions.filter((decision) => decision.evidenceHit).length;
    return [
      { id: 'review', label: '影像复核', value: `${state.current} / ${level.cases.length}`, ratio: state.current / level.cases.length, status: state.current === level.cases.length ? 'nominal' : 'info' },
      { id: 'evidence', label: '证据定位', value: `${evidence} 处`, status: evidence > 0 ? 'nominal' : 'info' },
      { id: 'judgment', label: '正确判断', value: `${judgments} 项`, status: judgments > 0 ? 'nominal' : 'info' },
      { id: 'time', label: '复核时间', value: `${Math.max(0, Math.ceil(level.duration - time))} 秒`, status: time > level.duration * .8 ? 'caution' : 'nominal' },
    ];
  },
  progress(state, level) {
    return { current: state.current, total: level.cases.length };
  },
  outcome(state, level) {
    if (state.current < level.cases.length) return null;
    const correct = state.decisions.filter((decision) => decision.correct).length;
    const evidence = state.decisions.filter((decision) => decision.evidenceHit).length;
    const modeUseful = state.decisions.filter((decision) => decision.modeUseful).length;
    const score = Math.round(correct / level.cases.length * 550 + evidence / level.cases.length * 300 + modeUseful / level.cases.length * 150);
    const won = correct >= Math.ceil(level.cases.length * .5);
    return {
      won, score,
      summary: `${won ? '影像鉴证完成' : '复核准确度不足'}：${correct}/${level.cases.length} 项判断正确，${evidence}/${level.cases.length} 处证据定位准确。`,
      metrics: [
        { label: '判断准确', value: `${correct} / ${level.cases.length}`, status: won ? 'nominal' : 'caution' },
        { label: '证据命中', value: `${evidence} / ${level.cases.length}`, status: evidence === level.cases.length ? 'nominal' : 'info' },
        { label: '双通道对照', value: `${modeUseful} / ${level.cases.length} 项`, status: modeUseful === level.cases.length ? 'nominal' : 'info' },
      ],
    };
  },
});
