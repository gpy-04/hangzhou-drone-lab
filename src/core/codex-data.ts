import type { GameId } from './game-interface';

export interface CodexEntry {
  id: string;
  gameId: GameId;
  title: string;
  category: string;
  realParam: string;
  summary: string;
  inGameLink: string;
  diagramSvg: string;
}

type DiagramKind = 'flight' | 'route' | 'survey' | 'inspect' | 'rescue' | 'swarm' | 'logistics' | 'airspace';

const diagramShapes: Record<DiagramKind, string> = {
  flight: `<path d="M24 67H256" stroke="#284767" stroke-width="1"/><path d="M52 67V22M228 67V22" stroke="#355574" stroke-dasharray="3 4"/><path d="M90 54Q140 13 190 54" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="4 3"/><g transform="translate(140 39)"><path d="M-18 0H18M0-8V8" stroke="#f8fafc" stroke-width="2"/><circle r="5" fill="#0e2038" stroke="#fbbf24" stroke-width="2"/><circle cx="-20" cy="0" r="3" fill="#38bdf8"/><circle cx="20" cy="0" r="3" fill="#38bdf8"/></g>`,
  route: `<path d="M30 18H250M30 43H250M30 68H250M70 12V78M140 12V78M210 12V78" stroke="#1f3957" stroke-width="1"/><rect x="105" y="27" width="30" height="32" rx="3" fill="#ef4444" fill-opacity=".16" stroke="#f87171"/><path d="M42 66L82 66L82 30L158 30L158 56L235 56" fill="none" stroke="#38bdf8" stroke-width="2.5"/><circle cx="42" cy="66" r="4" fill="#fbbf24"/><circle cx="235" cy="56" r="5" fill="#22c55e"/>`,
  survey: `<path d="M56 18H224V70H56Z" fill="#38bdf8" fill-opacity=".07" stroke="#38bdf8" stroke-dasharray="4 3"/><path d="M72 25V63M94 25V63M116 25V63M138 25V63M160 25V63M182 25V63M204 25V63" stroke="#234260"/><path d="M58 31H222M58 48H222M58 65H222" stroke="#234260"/><path d="M68 43H210" stroke="#fbbf24" stroke-width="2"/><circle cx="68" cy="43" r="4" fill="#fbbf24"/><circle cx="210" cy="43" r="4" fill="#22c55e"/>`,
  inspect: `<path d="M38 70V34L68 20L98 34V70ZM48 42H58M76 42H86M145 70V28H192V70M156 40H181M156 52H181" fill="#10243d" stroke="#6e8caa" stroke-width="1.5"/><path d="M117 22L144 40L117 55Z" fill="#fbbf24" fill-opacity=".16" stroke="#fbbf24" stroke-dasharray="3 2"/><circle cx="116" cy="38" r="5" fill="#38bdf8"/><circle cx="170" cy="48" r="4" fill="#ef4444"/>`,
  rescue: `<path d="M22 57Q50 45 78 57T134 57T190 57T258 57V78H22Z" fill="#0284c7" fill-opacity=".2" stroke="#38bdf8"/><path d="M22 67Q50 55 78 67T134 67T190 67T258 67" fill="none" stroke="#38bdf8" stroke-opacity=".55"/><path d="M56 51L83 28L111 51M169 49L195 26L223 49" fill="none" stroke="#64748b" stroke-width="2"/><circle cx="195" cy="20" r="5" fill="#fbbf24"/><path d="M195 27V42" stroke="#fbbf24" stroke-width="1.5"/>`,
  swarm: `<path d="M42 21H238V70H42Z" fill="#38bdf8" fill-opacity=".04" stroke="#355574" stroke-dasharray="4 3"/><path d="M65 45H215M140 30V62" stroke="#284767"/><g fill="#0e2038" stroke="#38bdf8" stroke-width="1.5"><circle cx="80" cy="34" r="8"/><circle cx="140" cy="56" r="8"/><circle cx="200" cy="34" r="8"/></g><g fill="#fbbf24"><circle cx="80" cy="34" r="2"/><circle cx="140" cy="56" r="2"/><circle cx="200" cy="34" r="2"/></g><path d="M89 38L131 52M149 52L191 38" stroke="#22c55e" stroke-width="1.5" stroke-dasharray="3 3"/>`,
  logistics: `<circle cx="52" cy="45" r="14" fill="#0e2038" stroke="#fbbf24"/><circle cx="140" cy="45" r="14" fill="#0e2038" stroke="#38bdf8"/><circle cx="228" cy="45" r="14" fill="#0e2038" stroke="#22c55e"/><path d="M67 45H124M155 45H212" stroke="#38bdf8" stroke-width="2"/><path d="M119 41L125 45L119 49M207 41L213 45L207 49" fill="none" stroke="#38bdf8" stroke-width="2"/><rect x="46" y="40" width="12" height="10" fill="#fbbf24"/><path d="M134 50L140 38L146 50Z" fill="#38bdf8"/><path d="M222 47L228 39L234 47L228 53Z" fill="#22c55e"/>`,
  airspace: `<path d="M38 72H244M38 48H244M38 24H244" stroke="#284767" stroke-dasharray="4 3"/><path d="M62 68L108 44L160 44L214 20" fill="none" stroke="#38bdf8" stroke-width="2"/><path d="M62 20L108 44" fill="none" stroke="#fbbf24" stroke-width="1.6" stroke-dasharray="4 3"/><circle cx="108" cy="44" r="7" fill="#0e2038" stroke="#ef4444" stroke-width="2"/><circle cx="62" cy="68" r="4" fill="#22c55e"/><circle cx="214" cy="20" r="4" fill="#fbbf24"/>`,
};

function escapeSvgText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function makeDiagram(kind: DiagramKind, label: string, detail: string): string {
  return `<svg viewBox="0 0 280 90" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeSvgText(label)}"><rect x=".5" y=".5" width="279" height="89" rx="5" fill="#07111f" stroke="#1c3550"/>${diagramShapes[kind]}<text x="12" y="14" fill="#7dd3fc" font-size="9" font-family="sans-serif">${escapeSvgText(label)}</text><text x="268" y="82" text-anchor="end" fill="#7f9bb8" font-size="8" font-family="monospace">${escapeSvgText(detail)}</text></svg>`;
}

function entry(
  id: string,
  gameId: GameId,
  title: string,
  category: string,
  realParam: string,
  summary: string,
  inGameLink: string,
  diagram: DiagramKind,
  diagramLabel: string,
  diagramDetail: string
): CodexEntry {
  return {
    id,
    gameId,
    title,
    category,
    realParam,
    summary,
    inGameLink,
    diagramSvg: makeDiagram(diagram, diagramLabel, diagramDetail),
  };
}

/**
 * Educational notes for the simulated Hangzhou drone missions. Parameters and
 * AI behavior are simplified for play; they are not flight or dispatch advice.
 */
export const CODEX_ENTRIES: CodexEntry[] = [
  // ---- 01 Flight control ----
  entry('docking-flight-basics', 'docking', '惯性与低速投递窗口', '飞行控制', '松开推力后，机体仍会因速度和外力继续移动', '无人机改变航迹需要时间。提前松开推力并施加反向修正，可以减少冲过目标的距离；落点判断还要同时考虑位置和地速。', '教学关里先观察松键后的滑行，再比较提前刹车与到圈后急停的落点差异。', 'flight', '惯性减速', 'THRUST → DRIFT → BRAKE'),
  entry('docking-hover-control', 'docking', '楼群侧风与航迹修正', '飞行控制', '近地风会受建筑、街道和河岸影响而改变方向与强度', '城市街区的风场并非处处相同。侧风会让地面航迹偏离机头预期方向，及时的小幅修正通常比接近目标后猛打方向更稳定。', '侧风关中观察流动箭头如何影响航迹，并在漂移扩大前调整推力。此处风场仅为定性教学模拟。', 'flight', '侧风修正', 'WIND → DRIFT → CORRECT'),
  entry('docking-urban-wind', 'docking', '顺风速度与精准投递', '飞行动力学', '地速由无人机相对空气的速度与风速共同决定', '顺风会增加地速并缩短航程，也会增大目标前的制动距离。制动可降低风扰，但电量有限，路线和刹车时机需要一起考虑。', '挑战关比较顺风穿越与落点前刹车的取舍；游戏中的单位和风区参数均为示意，不代表真实飞行数据。', 'flight', '风场与地速', 'AIR SPEED + WIND = GROUND SPEED'),

  // ---- 02 Route planning ----
  entry('solar-route-safe-corridors', 'solar', '方向积木与路径搜索', '航线编程', '网格路径可表示为一串带方向的动作指令', '把路线拆成方向和步数后，无人机可以逐条执行；遇到建筑或危险格时，程序必须绕行。游戏把网格搜索简化为可读、可调试的指令序列。', '逐步运行程序，观察无人机在哪里偏离目标；最短指令不一定是无风险路线。', 'route', '指令序列', 'PLAN → RUN → DEBUG'),
  entry('solar-battery-planning', 'solar', '程序长度与路线成本', '算法效率', '冗余指令会增加执行时间与路径长度', '路径规划会在满足目标和约束的前提下比较候选路线。压缩步骤可省下资源，但若压得过短而穿越障碍，方案仍不可行。', '关卡比较步骤预算与安全绕行，保留可读的正确程序比盲目追求少一步更重要。', 'route', '路径代价', 'COST · SAFETY'),
  entry('solar-airspace-windows', 'solar', '禁行格与程序约束', '低空地图', '仿真网格和围栏为教学参数，不是真实空域许可', '数字地图可以标记不可进入的区域；规划算法应在执行前检查每一步是否越界或进入禁区。真实空域规则会随地点和时间变化，本项目只演示抽象约束。', '本关的红色网格与程序长度限制是固定教学规则，不对应真实杭州空域或实际飞行许可。', 'route', '安全约束', 'CHECK EVERY STEP'),

  // ---- 03 Aerial surveying ----
  entry('eva-survey-grid', 'eva', '影像镶嵌与地物边界', '摄影测量', '相邻影像依靠共同地物特征进行匹配', '城市影像中的道路、屋顶和岸线可以作为特征。拼接时要寻找跨越图块边缘仍连续的地物，而不是仅按颜色或编号匹配。', '尝试对齐道路和河岸边缘；两块影像看起来相似，也可能来自不同位置。', 'survey', '地物连续性', 'FEATURE → MATCH'),
  entry('eva-survey-overlap', 'eva', '影像重叠与特征匹配', '摄影测量', '共同纹理越清晰，跨影像匹配通常越可靠', '摄影测量通过多张有重叠的影像寻找共同特征。影像方向和视角变化会影响匹配；遮挡或重复纹理也可能造成歧义。', '旋转图块后比较桥梁、道路和屋顶接缝；共同特征应在边缘处自然接上。', 'survey', '影像匹配', 'COMMON FEATURES'),
  entry('eva-survey-coverage', 'eva', '遮挡、空缺与补测', '摄影测量', '遮挡会让影像缺失，即使附近区域已经覆盖', '建筑和树木会遮住地面，导致地图局部信息不足。拼图中的空缺表示尚未确认的区域；真实航测还需结合多张重叠航片、拍摄视角与现场条件安排补测。本关使用杭州西溪真实无人机正射影像。', '比对西溪俯视影像中的道路、屋顶与树冠，辨认拼接缺口。真实作业还需核对重叠影像与遮挡，再按需要补测。', 'survey', '覆盖检查', 'OBSERVE · VERIFY'),

  // ---- 04 AI inspection ----
  entry('robotic-arm-ai-vision', 'robotic-arm', 'AI 视觉巡检如何找异常', '机器视觉', '识别结果受图像清晰度、光照和样本覆盖影响', '视觉模型从影像中寻找与训练样本相似的特征，再给出类别或置信度。视角变化、阴影和遮挡都会影响结果。', '巡检任务里无人机负责采集视角，AI 给出候选点，玩家再决定是否复核。', 'inspect', '影像识别', 'IMAGE → CANDIDATE'),
  entry('robotic-arm-false-positive', 'robotic-arm', '误报、漏报与模型置信度', 'AI 解释', '置信度用于表示模型对当前分类的把握程度', '高置信度仍可能是误判，低置信度也不等于一定没有异常。模型输出应结合原始影像、位置和其他证据判断，误报和漏报都要记录。', '关卡中的遮挡与反光会造成模拟误报；不确定时应查看原图或安排二次拍摄。', 'inspect', '异常复核', 'REVIEW UNCERTAIN'),
  entry('robotic-arm-inspection', 'robotic-arm', '巡检视角与证据采集', '人机协同', '检查质量受视角、光照、距离和遮挡共同影响', '稳定、清晰且能覆盖目标关键面的影像更利于复核。AI 可以缩小检查范围，但不能取代对证据与上下文的判断。', '玩家要选择清晰视角完成复核，不能只按 AI 标签数量追求高分。', 'inspect', '巡检证据', 'AI SUGGESTS · HUMAN CHECKS'),

  // ---- 05 Emergency search and delivery ----
  entry('eclss-search-pattern', 'eclss', '绞车摆动与接救时机', '应急救援', '悬吊负载会像摆一样来回运动', '绞车放下的吊具受到惯性和风扰，收放过快可能增加摆幅。等待吊具接近目标、相对速度变小时再尝试接救，更容易稳定完成交接。', '观察吊具与漂移目标之间的相对运动；连续收绳并不能消除摆动。', 'rescue', '摆动控制', 'SWING · ALIGN · LIFT'),
  entry('eclss-thermal-risk', 'eclss', '风扰与悬吊负载', '任务安全', '风和绳长都会改变吊具摆动，游戏数值不是机型限制', '悬吊物的运动受风、绳长和无人机位移共同影响。真实作业要依据设备规格和现场安全程序，本项目只用简化模型说明摆动关系。', '绳长越大，摆动幅度和周期都会变化；先稳住吊具再接近漂移目标。', 'rescue', '风与绳长', 'WIND + TETHER'),
  entry('eclss-rescue', 'eclss', '安全接救与负载稳定', '应急响应', '接救不仅要对准位置，还需控制负载摆幅', '吊起目标后，摆动会继续存在。降低横向运动并保持稳定有助于安全转运；真实救援程序需由现场专业人员制定。', '关卡会把接救前后的摆幅显示出来；安全交接与负载稳定比单纯按时完成更重要。', 'rescue', '负载稳定', 'ALIGN · LIFT · STABILIZE'),

  // ---- 06 Swarm coordination ----
  entry('debris-swarm-separation', 'debris', '无线中继与视距链路', '无人机通信', '无线链路会受距离、遮挡和天线位置影响', '楼宇遮挡可能削弱无人机与地面站之间的通信。中继节点转发信号可以建立绕行路径；地图上的覆盖圆只表示简化的教学估计。', '移动中继机让信号链连回指挥站；孤立社区即使落在覆盖区，也必须连通整条网络。', 'swarm', '中继链路', 'NODE → RELAY → HUB'),
  entry('debris-task-allocation', 'debris', '网络连通与瓶颈节点', '图论基础', '通信网络可抽象为节点与链路构成的图', '一条链路断开时，网络可能分成互不连通的部分。观察中继节点是否成为唯一通路，可以发现容易失效的瓶颈。', '尝试移除或挪动节点后检查网络是否仍连通；本关节点数和信号范围为教学参数。', 'swarm', '网络拓扑', 'NODES ↔ LINKS'),
  entry('debris-swarm-coverage', 'debris', '冗余路径与网络韧性', '通信可靠性', '备用链路可降低单点故障影响', '如果关键区域只通过一个中继接入，单点故障就会令其失联。多条独立路径能提高网络韧性，但会占用更多节点与电量。', '为重点社区留下第二条通信路径，比较节点成本与单点故障后的连通范围。', 'swarm', '网络冗余', 'COVER · REDUNDANCY'),

  // ---- 07 Urban logistics ----
  entry('botany-payload-routing', 'botany', '货物质量与重心位置', '低空物流', '货舱装载要同时满足载荷和配平约束', '货物的重量和摆放位置共同决定货舱的合成重心。即使总重量没有超限，偏载也会增加控制负担；装载方案还需符合设备要求。', '移动重物时观察重心指示，而不只看空余面积；本关重量为教学参数。', 'logistics', '载荷配平', 'WEIGHT × POSITION'),
  entry('botany-cold-chain', 'botany', '不均匀载荷与重心偏移', '载荷配平', '重心由货物质量与相对机体参考点的位置共同决定', '重物偏离机体参考点会使合成重心移动；总载荷未超限，也可能因偏载增加飞行控制负担。', '移动不同质量的模拟包裹，观察重心指示点的方向和幅度变化。载荷及重心限制需遵循具体机型要求。', 'logistics', '重心偏移', 'MASS × POSITION'),
  entry('botany-urban-logistics', 'botany', '固定舱段与货物空间布局', '货舱装载', '固定设备会占用不可移动空间；包裹尺寸、质量分布和边界共同约束配载', '固定模块安装后会限制可用空间。合规装载还要检查货舱边界、包裹固定和重心；实际限制依机型设计与制造商要求而定。', '留出固定冷链模块的位置，再为必送件选择合法布局；多种摆法都可能满足约束。', 'logistics', '固定结构', 'PACK · BALANCE · SECURE'),

  // ---- 08 Low-altitude command and digital twin ----
  entry('zero-g-airspace-capacity', 'zero-g-lab', '起飞时隙与航道容量', '低空交通', '航班卡的占用间隔和空域容量属于教学参数', '每个任务会占用一段起飞、航道和到达资源。错开时隙可以避免相同航道的冲突；排程不能只检查起飞瞬间。', '移动航班卡后观察整段占用条，避免只移动卡片标题而忽略冲突区间。', 'airspace', '时隙排程', 'TIME · CAPACITY'),
  entry('zero-g-dispatch-priority', 'zero-g-lab', '多任务优先级与资源调度', '城市调度', '优先级由游戏设定的时限、风险和资源约束计算', '调度系统需要在多项任务之间分配有限的无人机与时间。AI 建议应显示影响排序的原因，避免把单一分数包装成绝对答案。', '综合关里查看任务时限、风险和可用机队，再确认模拟的优先顺序。', 'airspace', '任务优先级', 'RISK · TIME · FLEET'),
  entry('zero-g-dispatch-safety', 'zero-g-lab', '调度安全与模型边界', '城市计算', '仿真结果依赖地图、规则和输入数据质量', '数字模型可以近似描述城市和任务状态，用于比较方案与观察趋势，但它不是城市的完整复制。真实调度还需依据现场信息、设备规格和适用规则。', '最终关综合前面任务的模拟数据；结算卡会提示哪些结果来自游戏模型，不用于真实飞行指挥。', 'airspace', '安全约束', 'MODEL ≠ REALITY'),
];

export function getCodexById(id: string): CodexEntry | undefined {
  return CODEX_ENTRIES.find((c) => c.id === id);
}
