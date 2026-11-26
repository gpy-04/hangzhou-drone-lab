import { createCanvasMiniGame, drawConsoleBackdrop, drawLabel } from '../../core/canvas-minigame';
import type { MiniGameLevel, MiniGamePointer } from '../../core/canvas-minigame';
import { clamp } from '../../core/canvas-utils';

interface SurveyLevel extends MiniGameLevel {
  cols: number;
  rows: number;
  fixedTiles: number[];
  rotatedTiles: number[];
}
interface SurveyTile {
  id: number;
  rotation: number;
  cell: number | null;
  order: number;
}
interface SurveyState {
  image: HTMLImageElement;
  tiles: SurveyTile[];
  board: (number | null)[];
  fixed: Set<number>;
  selected: number | null;
  pointer: { x: number; y: number } | null;
  dragFrom: number | null;
  dragOrigin: { x: number; y: number } | null;
  dragMoved: boolean;
  moves: number;
  errors: number;
  message: string;
}

const TILE = 200;
const BOARD_X_SMALL = 65;
const BOARD_X_WIDE = 38;
const BOARD_Y = 150;
const TRAY_X_SMALL = 625;
const TRAY_X_WIDE = 662;

const levels: SurveyLevel[] = [
  {
    name: '西溪图幅补全', subtitle: '杭州西溪航测图 · 4 幅正射影像',
    objective: '拼回杭州西溪真实无人机正射影像，让园区道路、屋顶和水岸接缝连续。',
    codexId: 'eva-survey-grid', duration: 140,
    lesson: '这是一幅杭州西溪真实无人机正射影像。拼接时沿着道路、屋顶与水岸寻找跨片连续的地物。',
    scienceAction: '你拼接了杭州西溪的真实无人机俯视正射影像，依据道路、屋顶与水岸的共同地物判断相片位置。原始测绘资料由 Alexander Pavluk 经 OpenAerialMap 提供，采用 CC BY 4.0。',
    cols: 2, rows: 2, fixedTiles: [0], rotatedTiles: [],
  },
  {
    name: '西溪园区正射拼接', subtitle: '4 幅真实正射影像 · 含旋转错片',
    objective: '对齐校园道路和建筑边缘；有一幅影像方向被旋转，需要先校正。',
    codexId: 'eva-survey-overlap', duration: 160,
    lesson: '真实航片的共享道路、屋顶边缘和树冠纹理是匹配特征；旋转会改变这些地物的方向。',
    scienceAction: '你通过道路、屋顶和水岸纹理对齐杭州西溪航测影像。正射影像将航拍画面校正到俯视地图视角，匹配时要核对多处共同地物。',
    cols: 2, rows: 2, fixedTiles: [0, 3], rotatedTiles: [2],
  },
  {
    name: '西溪航片覆盖检查', subtitle: '6 幅真实正射影像 · 多片旋转校正',
    objective: '将杭州西溪的真实航测图块接成完整俯视图，并校正多个旋转片。',
    codexId: 'eva-survey-coverage', duration: 185,
    lesson: '对照西溪真实正射影像中的道路、树冠、屋顶和水岸，核查旋转图块及空白覆盖。',
    scienceAction: '你拼接的是同一幅杭州西溪 UAV 正射测绘影像。拼接只能检查图面覆盖；真实作业还要用重叠航片检验匹配质量，并补测遮挡和数据缺口。',
    cols: 3, rows: 2, fixedTiles: [0, 5], rotatedTiles: [1, 3, 4],
  },
];

// Real orthorectified UAV imagery of Xixi, Hangzhou, from OpenAerialMap.
// Tiles are cropped from one frame so matching boundaries are pixel-continuous.
const SURVEY_IMAGE = new Image();
SURVEY_IMAGE.decoding = 'async';
SURVEY_IMAGE.src = new URL('assets/survey/xixi-westlake-uav-orthomosaic.jpg', document.baseURI).href;

function createState(level: SurveyLevel): SurveyState {
  const image = SURVEY_IMAGE;
  const fixed = new Set(level.fixedTiles);
  const board: (number | null)[] = Array(level.cols * level.rows).fill(null);
  const tiles: SurveyTile[] = Array.from({ length: board.length }, (_, id) => ({
    id,
    rotation: level.rotatedTiles.includes(id) ? 90 : 0,
    cell: null,
    order: id,
  }));
  for (const id of level.fixedTiles) { board[id] = id; tiles[id].cell = id; tiles[id].rotation = 0; }
  const movable = tiles.filter((tile) => !fixed.has(tile.id));
  // Deterministic shuffle: every level starts in a visibly mixed but fully solvable state.
  const order = level.cols === 3 ? [3, 1, 4, 2] : level.codexId === 'eva-survey-grid' ? [3, 1, 2] : [2, 1];
  const shuffled = order.map((id) => movable.find((tile) => tile.id === id)).filter((tile): tile is SurveyTile => tile !== undefined);
  shuffled.forEach((tile, index) => { tile.order = index; });
  return {
    image, tiles, board, fixed, selected: null, pointer: null, dragFrom: null,
    dragOrigin: null, dragMoved: false, moves: 0, errors: 0,
    message: '观察道路、岸线和屋顶的连续走向，选择影像并放到空白格。',
  };
}

function boardGeometry(level: SurveyLevel): { x: number; y: number; tile: number } {
  return { x: level.cols === 3 ? BOARD_X_WIDE : BOARD_X_SMALL, y: BOARD_Y, tile: TILE };
}

function trayPosition(order: number, level: SurveyLevel): { x: number; y: number; w: number; h: number } {
  const originX = level.cols === 3 ? TRAY_X_WIDE : TRAY_X_SMALL;
  const col = order % 2; const row = Math.floor(order / 2);
  return { x: originX + col * 145, y: 167 + row * 145, w: 130, h: 130 };
}

function tileAtBoard(x: number, y: number, level: SurveyLevel): number {
  const rect = boardGeometry(level); const width = level.cols * rect.tile; const height = level.rows * rect.tile;
  if (x < rect.x || x > rect.x + width || y < rect.y || y > rect.y + height) return -1;
  const col = Math.min(level.cols - 1, Math.floor((x - rect.x) / rect.tile));
  const row = Math.min(level.rows - 1, Math.floor((y - rect.y) / rect.tile));
  return row * level.cols + col;
}

function pieceAt(x: number, y: number, state: SurveyState, level: SurveyLevel): number | null {
  const boardCell = tileAtBoard(x, y, level);
  if (boardCell >= 0) return state.board[boardCell];
  for (const tile of state.tiles) {
    if (tile.cell !== null) continue;
    const rect = trayPosition(tile.order, level);
    if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) return tile.id;
  }
  return null;
}

function returnToTray(tile: SurveyTile, state: SurveyState): void {
  if (tile.cell !== null && !state.fixed.has(tile.cell)) state.board[tile.cell] = null;
  tile.cell = null;
  tile.order = state.tiles.filter((item) => item.cell === null).length - 1;
}

function placeTile(tileId: number, cellIndex: number, state: SurveyState, level: SurveyLevel): void {
  if (state.fixed.has(cellIndex)) { state.message = '这幅已锁定的影像用于提供地物参照。'; return; }
  const tile = state.tiles[tileId];
  const previousCell = tile.cell;
  if (previousCell !== null && !state.fixed.has(previousCell)) state.board[previousCell] = null;
  const displaced = state.board[cellIndex];
  if (displaced !== null) {
    const other = state.tiles[displaced]; other.cell = null;
    other.order = state.tiles.filter((item) => item.cell === null).length - 1;
    state.board[cellIndex] = null;
  }
  tile.cell = cellIndex;
  tile.order = -1;
  state.board[cellIndex] = tileId;
  state.selected = null;
  state.moves++;
  const correct = tileId === cellIndex && tile.rotation % 360 === 0;
  if (correct) state.message = '接缝吻合：地物线条已连续。继续核对相邻影像。';
  else {
    state.errors++;
    state.message = '这条接缝还没对齐；比对道路、岸线或屋顶边缘后可重新摆放。';
  }
  if (state.tiles.every((item) => item.cell !== null && item.cell === item.id && item.rotation % 360 === 0)) {
    state.message = '整幅城市底图已连续拼合。';
  }
  // Keep movable tiles in a compact tray after swaps and removals.
  const tray = state.tiles.filter((item) => item.cell === null).sort((a, b) => a.order - b.order);
  tray.forEach((item, index) => { item.order = index; });
}

function rotateSelected(state: SurveyState): void {
  if (state.selected === null) { state.message = '先选中一幅待拼接影像，再旋转校正方向。'; return; }
  const tile = state.tiles[state.selected];
  if (tile.cell !== null && state.fixed.has(tile.cell)) { state.message = '参照影像已锁定，不能旋转。'; return; }
  tile.rotation = (tile.rotation + 90) % 360;
  state.moves++;
  state.message = `已旋转 90°；查看屋顶边缘与道路方向是否匹配。`;
}

function pointer(state: SurveyState, event: MiniGamePointer, level: SurveyLevel): void {
  if (event.type === 'down') {
    state.pointer = { x: event.x, y: event.y };
    state.dragFrom = pieceAt(event.x, event.y, state, level);
    if (state.dragFrom !== null) {
      const selectedTile = state.tiles[state.dragFrom];
      if (selectedTile.cell !== null && state.fixed.has(selectedTile.cell)) state.dragFrom = null;
    }
    state.dragOrigin = { x: event.x, y: event.y };
    state.dragMoved = false;
    return;
  }
  if (event.type === 'move' && state.pointer) {
    state.pointer = { x: event.x, y: event.y };
    if (state.dragOrigin && Math.hypot(event.x - state.dragOrigin.x, event.y - state.dragOrigin.y) > 9) state.dragMoved = true;
    return;
  }
  if (event.type !== 'up' && event.type !== 'cancel') return;
  const id = state.dragFrom;
  if (id !== null && state.dragMoved) {
    const target = tileAtBoard(event.x, event.y, level);
    if (target >= 0) {
      state.selected = id;
      placeTile(id, target, state, level);
    } else if (state.tiles[id].cell !== null && !state.fixed.has(state.tiles[id].cell!)) {
      returnToTray(state.tiles[id], state); state.selected = id; state.message = '影像已移回来源盘。';
    }
  } else if (id !== null) {
    const clickedBoard = tileAtBoard(event.x, event.y, level);
    if (clickedBoard >= 0) {
      if (state.selected !== null && state.selected !== state.board[clickedBoard]) {
        placeTile(state.selected, clickedBoard, state, level);
      } else if (state.board[clickedBoard] !== null) {
        const tileId = state.board[clickedBoard]!;
        if (!state.fixed.has(clickedBoard)) { state.selected = tileId; state.message = '影像已选中；可以旋转、拖动或点击其他空格。'; }
      }
    } else {
      state.selected = id;
      state.message = '影像已选中；拖入空格，或选空格放置。';
    }
  } else if (state.selected !== null) {
    const target = tileAtBoard(event.x, event.y, level);
    if (target >= 0) placeTile(state.selected, target, state, level);
  }
  state.pointer = null; state.dragFrom = null; state.dragOrigin = null; state.dragMoved = false;
}

function drawTile(ctx: CanvasRenderingContext2D, state: SurveyState, level: SurveyLevel, tileId: number, x: number, y: number, size: number, rotation: number, selected: boolean, now: number): void {
  const frameWidth = state.image.naturalWidth;
  const frameHeight = state.image.naturalHeight;
  const sourceAspect = frameWidth / frameHeight;
  const boardAspect = level.cols / level.rows;
  const cropWidth = sourceAspect > boardAspect ? frameHeight * boardAspect : frameWidth;
  const cropHeight = sourceAspect > boardAspect ? frameHeight : frameWidth / boardAspect;
  const cropX = (frameWidth - cropWidth) / 2;
  const cropY = (frameHeight - cropHeight) / 2;
  const sx = cropX + (tileId % level.cols) * cropWidth / level.cols;
  const sy = cropY + Math.floor(tileId / level.cols) * cropHeight / level.rows;
  const sw = cropWidth / level.cols, sh = cropHeight / level.rows;
  ctx.save(); ctx.translate(x + size / 2, y + size / 2); ctx.rotate(rotation * Math.PI / 180);
  ctx.shadowColor = selected ? '#57e4ff' : 'rgba(0,0,0,.6)'; ctx.shadowBlur = selected ? 15 : 5;
  if (state.image.complete && frameWidth > 0) {
    ctx.drawImage(state.image, sx, sy, sw, sh, -size / 2, -size / 2, size, size);
  } else {
    ctx.fillStyle = '#101d26'; ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.fillStyle = '#9fb6c0'; ctx.font = '11px "Noto Sans SC", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('正在读取正射影像…', 0, 0);
  }
  ctx.restore();
  ctx.save(); ctx.strokeStyle = selected ? '#7cecff' : '#a7c1c2'; ctx.lineWidth = selected ? 3 : 1.5;
  ctx.strokeRect(x + .5, y + .5, size - 1, size - 1);
  if (rotation) {
    ctx.fillStyle = 'rgba(4,12,22,.82)'; ctx.beginPath(); ctx.arc(x + size - 15, y + 15, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffe08a'; ctx.font = '700 12px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.fillText('↻', x + size - 15, y + 19); ctx.textAlign = 'left';
  }
  if (selected) {
    ctx.strokeStyle = `rgba(91,224,255,${.55 + .35 * Math.sin(now * 6)})`; ctx.lineWidth = 2;
    ctx.strokeRect(x + 4, y + 4, size - 8, size - 8);
  }
  ctx.restore();
}

function draw(ctx: CanvasRenderingContext2D, state: SurveyState, level: SurveyLevel, _width: number, _height: number, time: number): void {
  drawConsoleBackdrop(ctx);
  const board = boardGeometry(level); const boardW = level.cols * TILE; const boardH = level.rows * TILE;
  const trayX = level.cols === 3 ? TRAY_X_WIDE : TRAY_X_SMALL;
  ctx.save();
  // Project labels turn the canvas into an orthophoto workstation rather than another flight map.
  ctx.fillStyle = 'rgba(4, 13, 23, .86)'; ctx.fillRect(board.x - 15, 104, boardW + 30, boardH + 82);
  ctx.strokeStyle = 'rgba(66, 182, 190, .40)'; ctx.strokeRect(board.x - 15.5, 104.5, boardW + 31, boardH + 82);
  ctx.fillStyle = '#86e0d4'; ctx.font = '700 14px "JetBrains Mono", monospace'; ctx.fillText('HANGZHOU XIXI · UAV ORTHOMOSAIC / 西溪实测正射影像', board.x, 128);
  ctx.fillStyle = '#92a9ad'; ctx.font = '9px "Noto Sans SC", sans-serif';
  ctx.fillText('采集 2017-11-22 · DJI Phantom 4 Pro · 约 3.6 cm/像素 · Alexander Pavluk / OpenAerialMap · CC BY 4.0', board.x, 143);
  ctx.fillStyle = 'rgba(4, 13, 23, .86)'; ctx.fillRect(trayX - 8, 104, 300, 522);
  ctx.strokeStyle = 'rgba(82, 165, 201, .32)'; ctx.strokeRect(trayX - 8.5, 104.5, 301, 523);
  ctx.fillStyle = '#a8c7d5'; ctx.font = '700 13px "JetBrains Mono", monospace'; ctx.fillText('SOURCE FRAMES / 航摄原片', trayX + 5, 128);

  const pulse = .5 + .5 * Math.sin(time * 3);
  for (let index = 0; index < state.board.length; index++) {
    const x = board.x + (index % level.cols) * TILE; const y = board.y + Math.floor(index / level.cols) * TILE;
    ctx.fillStyle = state.fixed.has(index) ? 'rgba(39, 75, 77, .64)' : state.board[index] === null ? 'rgba(7, 23, 35, .84)' : 'rgba(22, 52, 56, .56)';
    ctx.fillRect(x, y, TILE, TILE);
    if (state.board[index] !== null) {
      const tile = state.tiles[state.board[index]!];
      drawTile(ctx, state, level, tile.id, x, y, TILE, tile.rotation, state.selected === tile.id, time);
      if (state.fixed.has(index)) {
        ctx.fillStyle = 'rgba(8,24,31,.78)'; ctx.fillRect(x + 8, y + 8, 48, 20);
        ctx.fillStyle = '#8fe9ca'; ctx.font = '10px "JetBrains Mono", monospace'; ctx.fillText('LOCKED', x + 13, y + 22);
      }
    } else {
      ctx.save(); ctx.setLineDash([7, 5]); ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(86,218,236,${.30 + pulse * .30})`; ctx.strokeRect(x + 8, y + 8, TILE - 16, TILE - 16); ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(90,179,201,.40)'; ctx.lineWidth = 1;
      const cx = x + TILE / 2; const cy = y + TILE / 2;
      ctx.beginPath(); ctx.moveTo(cx - 16, cy); ctx.lineTo(cx + 16, cy); ctx.moveTo(cx, cy - 16); ctx.lineTo(cx, cy + 16); ctx.stroke();
      ctx.fillStyle = '#83dce7'; ctx.font = '11px "Noto Sans SC", sans-serif'; ctx.textAlign = 'center'; ctx.fillText('待补影像', cx, cy + 36); ctx.textAlign = 'left'; ctx.restore();
    }
  }
  // Slots stay neutral: players infer locations from actual geographic features rather than labels.
  const trayTiles = state.tiles.filter((tile) => tile.cell === null).sort((a, b) => a.order - b.order);
  for (const tile of trayTiles) {
    const rect = trayPosition(tile.order, level);
    ctx.fillStyle = state.selected === tile.id ? 'rgba(18, 61, 80, .92)' : 'rgba(10, 27, 42, .94)';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = state.selected === tile.id ? '#77eaff' : 'rgba(109, 164, 188, .56)';
    ctx.lineWidth = state.selected === tile.id ? 2 : 1; ctx.strokeRect(rect.x + .5, rect.y + .5, rect.w - 1, rect.h - 1);
    drawTile(ctx, state, level, tile.id, rect.x + 7, rect.y + 7, rect.w - 14, tile.rotation, state.selected === tile.id, time);
  }
  if (state.dragFrom !== null && state.dragMoved && state.pointer) {
    const tile = state.tiles[state.dragFrom]; const size = 110;
    drawTile(ctx, state, level, tile.id, state.pointer.x - size / 2, state.pointer.y - size / 2, size, tile.rotation, true, time);
  }
  // Current coverage and seam continuity are shown on-scene as well as in the HUD.
  const placed = state.tiles.filter((tile) => tile.cell !== null).length;
  const correct = state.tiles.filter((tile) => tile.cell === tile.id && tile.rotation % 360 === 0).length;
  ctx.fillStyle = 'rgba(5, 15, 25, .88)'; ctx.fillRect(board.x, 564, Math.min(boardW, 580), 70);
  ctx.fillStyle = '#a3bdc8'; ctx.font = '12px "Noto Sans SC", sans-serif'; ctx.fillText(state.message, board.x + 12, 584, Math.min(boardW - 22, 540));
  ctx.fillStyle = '#63e2d2'; ctx.fillRect(board.x + 12, 596, Math.min(boardW - 24, (boardW - 24) * correct / state.tiles.length), 4);
  ctx.fillStyle = '#567382'; ctx.fillRect(board.x + 12 + Math.min(boardW - 24, (boardW - 24) * correct / state.tiles.length), 596, Math.max(0, boardW - 24 - (boardW - 24) * correct / state.tiles.length), 4);
  ctx.fillStyle = '#a0b9c7'; ctx.font = '10px "JetBrains Mono", monospace'; ctx.fillText(`${correct}/${state.tiles.length} TILE MATCH`, board.x + 12, 613);
  ctx.fillStyle = '#829caa'; ctx.font = '11px "Noto Sans SC", sans-serif';
  ctx.fillText(`已放置 ${placed} 幅 · 点击选中，拖放到地图空格；R 或旋转按钮校正方向。`, trayX, 600, 285);
  ctx.restore();
}

function metrics(state: SurveyState, level: SurveyLevel, time: number) {
  const correct = state.tiles.filter((tile) => tile.cell === tile.id && tile.rotation % 360 === 0).length;
  const placed = state.tiles.filter((tile) => tile.cell !== null).length;
  const total = state.tiles.length;
  return [
    { id: 'coverage', label: '正确接缝', value: `${correct} / ${total}`, ratio: correct / total, status: correct === total ? 'nominal' as const : 'info' as const },
    { id: 'placed', label: '影像已拼', value: `${placed} / ${total}`, ratio: placed / total, status: placed === total ? 'nominal' as const : 'info' as const },
    { id: 'edits', label: '拼接操作', value: `${state.moves} 次`, status: state.errors > 2 ? 'caution' as const : 'nominal' as const },
    { id: 'remaining', label: '任务时限', value: `${Math.max(0, Math.ceil(level.duration - time))} 秒`, status: time > level.duration * .8 ? 'caution' as const : 'nominal' as const },
  ];
}

export const evaGame = createCanvasMiniGame<SurveyState, SurveyLevel>({
  meta: {
    id: 'eva', number: '03', shortTitle: '城市航测', title: '无人机城市航测拼图',
    enTitle: 'XIXI UAV ORTHOMOSAIC', moduleName: '杭州西溪真实航测影像台',
    genre: '实测影像拼接与地物识别', tagline: '用杭州西溪真实俯视航片找回连续地图',
    accent: '#22c55e', hubAnchor: { x: .15, y: .47 },
    briefingSteps: [
      { title: '观察地物线索', desc: '找出航片中的道路、河岸和屋顶，并注意影像的旋转方向。' },
      { title: '拖动拼接', desc: '把影像放入地图空位；也可先选影像，再点选目标格。' },
      { title: '核对接缝', desc: '地物连续表示匹配合理；错片可取回重排，旋转片需要校正。' },
    ],
    controlsHint: '拖动影像 / 点击影像选中后点击地图 · R 或“旋转 90°”校正 · 错片可移回原片盘',
  },
  levels,
  controls: [
    { id: 'rotate', label: '旋转 90°', title: '将选中的航摄影像顺时针旋转 90 度' },
  ],
  createState,
  update(state, dt, level) {
    const correct = state.tiles.filter((tile) => tile.cell === tile.id && tile.rotation % 360 === 0).length;
    if (correct === state.tiles.length) state.message = '整幅城市底图已连续拼合。';
    void dt; void level;
  },
  draw,
  pointer,
  control(state, controlId, phase) {
    if (phase === 'down' && controlId === 'rotate') rotateSelected(state);
  },
  key(state, key, phase) {
    if (phase !== 'down') return;
    if (key.toLowerCase() === 'r') rotateSelected(state);
    if (key === 'Escape' && state.selected !== null) {
      const tile = state.tiles[state.selected];
      if (tile.cell !== null && !state.fixed.has(tile.cell)) returnToTray(tile, state);
      state.selected = null; state.message = '影像已取消选择。';
    }
  },
  metrics,
  progress(state) { return { current: state.tiles.filter((tile) => tile.cell === tile.id && tile.rotation % 360 === 0).length, total: state.tiles.length }; },
  outcome(state, level, time) {
    const won = state.tiles.every((tile) => tile.cell === tile.id && tile.rotation % 360 === 0);
    if (!won) return null;
    const score = clamp(1000 - state.moves * 20 - state.errors * 40 - time * 1.3, 420, 1000);
    return {
      won: true, score,
      summary: `杭州西溪真实正射影像已拼合：${state.tiles.length} 幅航测图块接缝连续，使用 ${state.moves} 次摆放或校正。道路、水岸与屋顶纹理共同确认了位置。`,
      metrics: [
        { label: '正确拼接', value: `${state.tiles.length} / ${state.tiles.length} 幅` },
        { label: '拼接操作', value: `${state.moves} 次` },
        { label: '重排修正', value: `${state.errors} 次` },
      ],
    };
  },
});
