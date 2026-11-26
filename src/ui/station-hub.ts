import { setupHiDPICanvas } from '../core/canvas-utils';
import type { AudioAPI, GameId, GameMeta } from '../core/game-interface';
import type { SaveStore } from '../core/save-store';
import { attachArwesFrame } from './arwes-frames';
import { GAME_ICONS, UI_ICONS } from './icons';

/**
 * Interactive Hangzhou low-altitude operations hub.
 * The map is intentionally illustrative: it uses recognizable city cues, not GIS data.
 */
export class StationHub {
  readonly element: HTMLElement;
  private metas: GameMeta[];
  private save: SaveStore;
  private audio: AudioAPI;
  private onLaunchGame: (id: GameId) => void;

  private rafId = 0;
  private canvasHandle!: ReturnType<typeof setupHiDPICanvas>;
  private hoveredId: GameId | null = null;
  private pinEls = new Map<GameId, HTMLButtonElement>();
  private cardEls = new Map<GameId, HTMLButtonElement>();
  private pinPositions = new Map<GameId, { px: number; py: number }>();
  private readinessValEl!: HTMLElement;
  private starsValEl!: HTMLElement;
  private codexValEl!: HTMLElement;
  private unsubscribeSave: () => void;
  private frameCleanups: (() => void)[] = [];

  constructor(
    metas: GameMeta[],
    save: SaveStore,
    audio: AudioAPI,
    onLaunchGame: (id: GameId) => void
  ) {
    this.metas = metas;
    this.save = save;
    this.audio = audio;
    this.onLaunchGame = onLaunchGame;

    this.element = document.createElement('section');
    this.element.className = 'hub-root';
    this.element.setAttribute('aria-label', '杭州低空无人机任务大厅');
    this.render();
    this.unsubscribeSave = this.save.subscribe(() => this.refreshStatus());
    this.startLoop();
  }

  private render(): void {
    const canvasLayer = document.createElement('div');
    canvasLayer.className = 'hub-canvas-layer';
    this.element.appendChild(canvasLayer);

    this.canvasHandle = setupHiDPICanvas(canvasLayer, () => this.positionPins());

    const header = document.createElement('div');
    header.className = 'hub-overlay-header';
    header.innerHTML = [
      '<div class="hub-hero-badge" data-arwes-hero>',
      '<div class="hub-hero-eyebrow"><span class="hub-live-dot"></span>HANGZHOU LOW-ALTITUDE NETWORK · DIGITAL TWIN · TRAINING MAP</div>',
      '<h1 class="hub-hero-title">杭州·低空智航实验室 · 无人机任务中枢</h1>',
      '<p class="hub-hero-desc">选择城市热点或下方任务卡，进入飞控、航测、巡检与协同任务；地图用于教学演示。</p>',
      '</div>',
      '<div class="hub-telemetry-card" data-arwes-tele>',
      '<div class="hub-tele-item"><span class="hub-tele-label">低空网络就绪度</span>',
      '<span class="hub-tele-value" data-hub-readiness style="color:var(--status-nominal)">25%</span></div>',
      '<div class="hub-tele-item"><span class="hub-tele-label">无人机任务星级</span>',
      '<span class="hub-tele-value" data-hub-stars style="color:var(--accent-gold-bright)">0/72</span></div>',
      '<div class="hub-tele-item"><span class="hub-tele-label">AI 科普档案</span>',
      '<span class="hub-tele-value" data-hub-codex style="color:var(--accent-cyan-bright)">4/24</span></div>',
      '</div>',
    ].join('');

    const heroBox = header.querySelector<HTMLElement>('[data-arwes-hero]')!;
    const teleBox = header.querySelector<HTMLElement>('[data-arwes-tele]')!;
    this.frameCleanups.push(attachArwesFrame(heroBox, 'nefrex', { strokeWidth: 1.5, squareSize: 12 }));
    this.frameCleanups.push(attachArwesFrame(teleBox, 'corners', { strokeWidth: 1.6, cornerLength: 14 }));

    this.readinessValEl = header.querySelector('[data-hub-readiness]')!;
    this.starsValEl = header.querySelector('[data-hub-stars]')!;
    this.codexValEl = header.querySelector('[data-hub-codex]')!;
    this.element.appendChild(header);

    // Eight launch buttons sit on their matching illustrative city-map anchors.
    const pinsLayer = document.createElement('div');
    pinsLayer.className = 'hub-pins-layer';
    for (const meta of this.metas) {
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'hub-pin';
      pin.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
      pin.setAttribute('aria-label', meta.number + ' ' + meta.title + '：进入无人机任务');
      pin.style.setProperty('--pin-accent', meta.accent);
      pin.innerHTML = [
        '<span class="hub-pin-badge">' + GAME_ICONS[meta.id] + '</span>',
        '<span class="hub-pin-title"><span class="mono-num" style="opacity:.78;margin-right:4px">' +
          meta.number + '</span>' + meta.shortTitle + '</span>',
        '<span class="hub-pin-stars"></span>',
      ].join('');
      pin.addEventListener('mouseenter', () => this.setHover(meta.id));
      pin.addEventListener('mouseleave', () => this.setHover(null));
      pin.addEventListener('focus', () => this.setHover(meta.id));
      pin.addEventListener('blur', () => this.setHover(null));
      pin.addEventListener('click', () => {
        this.audio.playClick();
        this.onLaunchGame(meta.id);
      });
      pinsLayer.appendChild(pin);
      this.pinEls.set(meta.id, pin);
    }
    this.element.appendChild(pinsLayer);

    // Bottom 8-game mission deck remains the second launch path.
    const deck = document.createElement('div');
    deck.className = 'hub-mission-deck';
    for (const meta of this.metas) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'hub-card';
      card.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
      card.style.setProperty('--card-accent', meta.accent);
      card.innerHTML = [
        '<div class="hub-card-top">',
        '<span class="hub-card-code"><span class="ui-svg-icon">' + GAME_ICONS[meta.id] +
          '</span><span>' + meta.number + ' · ' + meta.moduleName + '</span></span>',
        '<span class="hub-card-genre">' + meta.genre + '</span></div>',
        '<div class="hub-card-name">' + meta.title + '</div>',
        '<div class="hub-card-tagline">' + meta.tagline + '</div>',
        '<div class="hub-card-foot"><span>3 关卡 · KEY ' + Number(meta.number) + '</span>',
        '<span class="hub-card-stars"></span></div>',
      ].join('');
      card.addEventListener('mouseenter', () => this.setHover(meta.id));
      card.addEventListener('mouseleave', () => this.setHover(null));
      card.addEventListener('focus', () => this.setHover(meta.id));
      card.addEventListener('blur', () => this.setHover(null));
      card.addEventListener('click', () => {
        this.audio.playClick();
        this.onLaunchGame(meta.id);
      });
      deck.appendChild(card);
      this.cardEls.set(meta.id, card);
    }
    this.element.appendChild(deck);

    this.positionPins();
    this.refreshStatus();
  }

  private setHover(id: GameId | null): void {
    if (this.hoveredId === id) return;
    this.hoveredId = id;
    if (id) this.audio.playHover();
    for (const meta of this.metas) {
      const isHighlighted = meta.id === id;
      this.pinEls.get(meta.id)?.classList.toggle('is-highlighted', isHighlighted);
      this.cardEls.get(meta.id)?.classList.toggle('is-highlighted', isHighlighted);
    }
  }

  private getMapLayout(w: number, h: number) {
    const ultraCompact = h <= 650;
    const compact = h <= 760 || w <= 1440;
    const deckReserve = w <= 1120 ? h * 0.34 : ultraCompact ? 148 : compact ? 188 : 216;
    const topReserve = ultraCompact ? 68 : compact ? 84 : 104;
    const availH = Math.max(180, h - topReserve - deckReserve);
    const scale = Math.max(0.36, Math.min((w - 28) / 1000, availH / 500, 1.25));
    const mapW = 1000 * scale;
    const mapH = 500 * scale;
    return {
      x: (w - mapW) * 0.5,
      y: topReserve + (availH - mapH) * 0.5,
      width: mapW,
      height: mapH,
      scale,
      topReserve,
      deckReserve,
    };
  }

  private positionPins(): void {
    if (!this.canvasHandle) return;
    const { width, height } = this.canvasHandle.getSize();
    const layout = this.getMapLayout(width, height);

    for (const meta of this.metas) {
      const pin = this.pinEls.get(meta.id);
      if (!pin) continue;
      const anchorX = Math.max(0.08, Math.min(0.92, meta.hubAnchor.x));
      const anchorY = Math.max(0.14, Math.min(0.78, meta.hubAnchor.y));
      const px = layout.x + anchorX * layout.width;
      const py = layout.y + anchorY * layout.height;
      pin.style.left = px + 'px';
      pin.style.top = py + 'px';
      this.pinPositions.set(meta.id, { px, py });
    }
  }

  refreshStatus(): void {
    this.readinessValEl.textContent = this.save.getStationReadiness() + '%';
    this.starsValEl.innerHTML =
      '<span class="ui-svg-icon" style="vertical-align:-1px;margin-right:4px">' +
      UI_ICONS.star + '</span>' + this.save.getTotalStars() + '/72';
    this.codexValEl.textContent = this.save.getUnlockedCodexCount() + '/24';

    for (const meta of this.metas) {
      const stars = this.save.getGameStars(meta.id);
      const pinStar = this.pinEls.get(meta.id)?.querySelector('.hub-pin-stars');
      const cardStar = this.cardEls.get(meta.id)?.querySelector('.hub-card-stars');
      if (pinStar) pinStar.innerHTML = stars > 0 ? UI_ICONS.star + '<span>' + stars + '</span>' : '';
      if (cardStar) {
        cardStar.innerHTML = stars > 0
          ? UI_ICONS.star + '<span>' + stars + '/9</span>'
          : '<span style="color:var(--text-muted)">待探索</span>';
      }
    }
  }

  private startLoop(): void {
    const renderFrame = (now: number) => {
      const t = now * 0.001;
      const { width, height } = this.canvasHandle.getSize();
      const ctx = this.canvasHandle.ctx;
      const layout = this.getMapLayout(width, height);

      ctx.fillStyle = '#050b16';
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.translate(layout.x, layout.y);
      ctx.scale(layout.scale, layout.scale);
      this.drawCityMap(ctx, t);
      this.drawMissionRoutes(ctx, t);
      this.drawDroneFlights(ctx, t);
      ctx.restore();

      this.rafId = requestAnimationFrame(renderFrame);
    };
    this.rafId = requestAnimationFrame(renderFrame);
  }

  private drawCityMap(ctx: CanvasRenderingContext2D, t: number): void {
    const width = 1000;
    const height = 500;

    const backdrop = ctx.createLinearGradient(0, 0, width, height);
    backdrop.addColorStop(0, '#0a1727');
    backdrop.addColorStop(0.55, '#091523');
    backdrop.addColorStop(1, '#07111e');
    ctx.fillStyle = backdrop;
    ctx.fillRect(0, 0, width, height);

    // Subtle planning grid.
    ctx.save();
    ctx.strokeStyle = 'rgba(104, 167, 210, 0.075)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= width; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.restore();

    // Schematic district panels; these are illustrative, not GIS boundaries.
    this.fillDistrict(ctx, [[20, 30], [390, 22], [480, 170], [345, 248], [60, 265]], 'rgba(19, 65, 92, 0.23)', 'rgba(74, 183, 230, 0.32)');
    this.fillDistrict(ctx, [[430, 18], [800, 24], [832, 172], [578, 218], [470, 170]], 'rgba(23, 79, 91, 0.17)', 'rgba(70, 205, 203, 0.25)');
    this.fillDistrict(ctx, [[20, 278], [330, 244], [470, 326], [440, 478], [22, 470]], 'rgba(17, 66, 78, 0.18)', 'rgba(58, 183, 202, 0.25)');
    this.fillDistrict(ctx, [[590, 218], [968, 206], [980, 474], [470, 478], [488, 336]], 'rgba(19, 62, 87, 0.19)', 'rgba(80, 172, 219, 0.25)');

    // Local streets and two major transport corridors.
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(78, 133, 165, 0.18)';
    ctx.lineWidth = 1;
    for (let x = 28; x < width; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + ((x % 3) - 1) * 10, height);
      ctx.stroke();
    }
    for (let y = 22; y < height; y += 42) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y - 8);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(74, 170, 210, 0.32)';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(34, 103);
    ctx.bezierCurveTo(258, 66, 544, 128, 952, 78);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(68, 438);
    ctx.bezierCurveTo(300, 382, 675, 452, 950, 405);
    ctx.stroke();
    ctx.restore();

    // Qiantang River crossing the map.
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-18, 337);
    ctx.bezierCurveTo(175, 321, 278, 352, 415, 300);
    ctx.bezierCurveTo(560, 246, 690, 203, 818, 218);
    ctx.bezierCurveTo(900, 229, 951, 246, 1020, 229);
    ctx.strokeStyle = 'rgba(9, 24, 42, 0.95)';
    ctx.lineWidth = 92;
    ctx.stroke();
    ctx.strokeStyle = '#123b59';
    ctx.lineWidth = 82;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(39, 132, 170, 0.34)';
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 9]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // West Lake as a protected ecological basin.
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(260, 235, 82, 57, -0.12, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(14, 65, 87, 0.94)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(67, 192, 215, 0.78)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(260, 235, 67, 43, -0.12, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(83, 183, 199, 0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.ellipse(260, 235, 112, 82, -0.12, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(245, 166, 35, 0.62)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Deterministic building blocks keep the map detailed but repeatable.
    for (let row = 0; row < 13; row++) {
      for (let col = 0; col < 25; col++) {
        const x = 22 + col * 39;
        const y = 24 + row * 36;
        if (x > width - 26 || y > height - 25) continue;
        if (Math.abs(y - this.riverCenterY(x)) < 53) continue;
        const lakeDx = (x - 260) / 95;
        const lakeDy = (y - 235) / 70;
        if (lakeDx * lakeDx + lakeDy * lakeDy < 1) continue;

        const hash = Math.abs(Math.sin(col * 12.9898 + row * 78.233) * 43758.5453) % 1;
        const blockW = 17 + hash * 16;
        const blockH = 12 + ((hash * 7.3) % 1) * 14;
        const cool = (col + row) % 4;
        ctx.fillStyle = cool === 0
          ? 'rgba(37, 81, 112, 0.76)'
          : cool === 1
            ? 'rgba(31, 69, 99, 0.78)'
            : 'rgba(24, 58, 85, 0.82)';
        ctx.fillRect(x, y, blockW, blockH);
        ctx.fillStyle = 'rgba(122, 189, 218, 0.18)';
        ctx.fillRect(x + 3, y + 3, Math.max(2, blockW - 7), 1);
      }
    }

    // Schematic river crossings.
    this.drawBridge(ctx, 525, this.riverCenterY(525));
    this.drawBridge(ctx, 760, this.riverCenterY(760));

    // Low-altitude corridors, shown as dashed cyan and amber routes.
    ctx.save();
    ctx.lineCap = 'round';
    ctx.setLineDash([10, 8]);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.44)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(120, 120);
    ctx.bezierCurveTo(330, 152, 490, 106, 675, 132);
    ctx.bezierCurveTo(790, 148, 838, 116, 930, 118);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(245, 166, 35, 0.33)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(105, 404);
    ctx.bezierCurveTo(302, 375, 428, 423, 590, 385);
    ctx.bezierCurveTo(744, 348, 833, 389, 934, 358);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Fine dotted district dividers.
    ctx.save();
    ctx.strokeStyle = 'rgba(120, 188, 219, 0.22)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 7]);
    const boundaries = [
      [[398, 32], [435, 184], [370, 276]],
      [[594, 22], [608, 190], [570, 282]],
      [[285, 275], [325, 386], [304, 467]],
      [[790, 254], [814, 353], [780, 457]],
    ];
    for (const points of boundaries) {
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      ctx.lineTo(points[1][0], points[1][1]);
      ctx.lineTo(points[2][0], points[2][1]);
      ctx.stroke();
    }
    ctx.restore();

    this.drawMapLabel(ctx, '城西科创片区', 110, 77, '#8edcff');
    this.drawMapLabel(ctx, '西湖生态区', 255, 318, '#77e0df');
    this.drawMapLabel(ctx, '钱江新城', 518, 87, '#f2d28e');
    this.drawMapLabel(ctx, '滨江智造区', 684, 351, '#8edcff');
    this.drawMapLabel(ctx, '钱塘物流区', 863, 173, '#f2d28e');
    this.drawMapLabel(ctx, '萧山综合枢纽', 855, 448, '#8edcff');
    this.drawMapLabel(ctx, '西湖', 260, 237, '#c7f3f2', true);
    this.drawMapLabel(ctx, '钱塘江', 584, 255, '#a9e7ff', true);

    // A restrained scanning tick makes the command map feel live.
    const scanX = 90 + ((t * 42) % 820);
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 216, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(scanX, 36);
    ctx.lineTo(scanX + 14, 36);
    ctx.moveTo(scanX, 36);
    ctx.lineTo(scanX, 44);
    ctx.stroke();
    ctx.restore();
  }

  private riverCenterY(x: number): number {
    const points: [number, number][] = [
      [0, 337], [175, 325], [278, 350], [415, 300], [560, 246],
      [690, 203], [818, 218], [900, 229], [1000, 229],
    ];
    for (let i = 0; i < points.length - 1; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[i + 1];
      if (x <= x1) return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
    }
    return points[points.length - 1][1];
  }

  private fillDistrict(
    ctx: CanvasRenderingContext2D,
    points: [number, number][],
    fill: string,
    stroke: string
  ): void {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }

  private drawBridge(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.19);
    ctx.fillStyle = 'rgba(4, 12, 24, 0.94)';
    ctx.fillRect(-34, -10, 68, 20);
    ctx.strokeStyle = 'rgba(147, 198, 218, 0.72)';
    ctx.lineWidth = 2;
    ctx.strokeRect(-34, -5, 68, 10);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-24, -9);
    ctx.lineTo(-24, 9);
    ctx.moveTo(24, -9);
    ctx.lineTo(24, 9);
    ctx.stroke();
    ctx.restore();
  }

  private drawMapLabel(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    color: string,
    waterLabel = false
  ): void {
    ctx.save();
    ctx.font = waterLabel ? '600 11px "Noto Sans SC", sans-serif' : '700 10px "Noto Sans SC", sans-serif';
    const textWidth = ctx.measureText(text).width;
    if (!waterLabel) {
      ctx.fillStyle = 'rgba(4, 11, 22, 0.82)';
      ctx.beginPath();
      ctx.roundRect(x - textWidth * 0.5 - 8, y - 10, textWidth + 16, 20, 4);
      ctx.fill();
      ctx.strokeStyle = 'rgba(95, 164, 196, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  private drawMissionRoutes(ctx: CanvasRenderingContext2D, t: number): void {
    const commandX = 500;
    const commandY = 252;
    ctx.save();
    ctx.lineCap = 'round';

    for (const [index, meta] of this.metas.entries()) {
      const anchorX = Math.max(0.08, Math.min(0.92, meta.hubAnchor.x)) * 1000;
      const anchorY = Math.max(0.14, Math.min(0.78, meta.hubAnchor.y)) * 500;
      const isHovered = this.hoveredId === meta.id;
      const bend = (index % 2 === 0 ? -1 : 1) * (18 + (index % 3) * 9);

      ctx.save();
      ctx.strokeStyle = isHovered ? meta.accent : 'rgba(56, 189, 248, 0.22)';
      ctx.lineWidth = isHovered ? 2 : 1;
      ctx.setLineDash(isHovered ? [7, 4] : [3, 7]);
      ctx.beginPath();
      ctx.moveTo(commandX, commandY);
      ctx.quadraticCurveTo((commandX + anchorX) * 0.5, (commandY + anchorY) * 0.5 + bend, anchorX, anchorY);
      ctx.stroke();
      ctx.setLineDash([]);

      const pinPos = this.pinPositions.get(meta.id);
      const isActive = isHovered || !pinPos;
      const pulse = 0.5 + Math.sin(t * 3.2 + index * 0.8) * 0.5;
      const radius = (isActive ? 13 : 7) + pulse * (isActive ? 3 : 1.5);
      ctx.strokeStyle = isHovered ? meta.accent : 'rgba(116, 221, 246, 0.72)';
      ctx.lineWidth = isHovered ? 2 : 1.2;
      ctx.beginPath();
      ctx.arc(anchorX, anchorY, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = meta.accent;
      ctx.beginPath();
      ctx.arc(anchorX, anchorY, isHovered ? 3.8 : 2.6, 0, Math.PI * 2);
      ctx.fill();

      if (isHovered) {
        ctx.globalAlpha = 0.24 + pulse * 0.2;
        ctx.fillStyle = meta.accent;
        ctx.beginPath();
        ctx.arc(anchorX, anchorY, 21 + pulse * 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.strokeStyle = 'rgba(245, 166, 35, 0.56)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(commandX, commandY, 18 + Math.sin(t * 2) * 1.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#f5a623';
    ctx.beginPath();
    ctx.arc(commandX, commandY, 3, 0, Math.PI * 2);
    ctx.fill();
    this.drawMapLabel(ctx, '低空指挥节点', commandX, commandY + 27, '#f5d48a');
    ctx.restore();
  }

  private drawDroneFlights(ctx: CanvasRenderingContext2D, t: number): void {
    const routes = [
      { a: [500, 252] as [number, number], b: [180, 126] as [number, number], phase: 0.1, color: '#38bdf8' },
      { a: [500, 252] as [number, number], b: [817, 382] as [number, number], phase: 0.43, color: '#f5a623' },
      { a: [500, 252] as [number, number], b: [885, 132] as [number, number], phase: 0.73, color: '#67e8d5' },
    ];
    for (const route of routes) {
      const u = (t * 0.055 + route.phase) % 1;
      const x = route.a[0] + (route.b[0] - route.a[0]) * u;
      const y = route.a[1] + (route.b[1] - route.a[1]) * u + Math.sin(u * Math.PI) * 24;
      this.drawDrone(ctx, x, y, route.color, t);
    }
  }

  private drawDrone(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, t: number): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(t * 0.55 + x * 0.01) * 0.08);
    ctx.strokeStyle = 'rgba(175, 219, 238, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-11, -7);
    ctx.lineTo(-4, -2);
    ctx.moveTo(11, -7);
    ctx.lineTo(4, -2);
    ctx.moveTo(-11, 7);
    ctx.lineTo(-4, 2);
    ctx.moveTo(11, 7);
    ctx.lineTo(4, 2);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-4, -3, 8, 6, 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    const rotorPulse = 1 + Math.sin(t * 16 + x) * 0.6;
    for (const [rx, ry] of [[-12, -8], [12, -8], [-12, 8], [12, 8]]) {
      ctx.beginPath();
      ctx.arc(rx, ry, rotorPulse + 1.3, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
    this.frameCleanups.forEach((fn) => fn());
    this.frameCleanups = [];
    this.unsubscribeSave();
    this.canvasHandle.destroy();
    this.element.remove();
  }
}
