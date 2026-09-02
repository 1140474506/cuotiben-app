/* ---------------- 手写引擎 v3（低延迟 / 精准防误触 / 矢量墨迹） ----------------
   三条线索合起来才叫「像 GoodNotes」：

   ① 延迟。落笔到出墨之间只做最少的事。三层画布叠着：dry 放已落稿的笔迹，
      wet 只放正在写的这一笔，pred 放预测的笔尖延伸。pointerrawupdate 一到就把
      新的一小段画进 wet（desynchronized 上下文，不排合成器那一帧的队），
      dry 在整条笔画期间一个像素都不动。需要整卷重画的动作（缩放/平移/撤销/
      擦除/换页）全部合流到「一帧一次」。旧版每个擦除采样点、每次捏合回调都要
      重画整卷纸（白纸 + 点阵 + 所有笔迹）并重新分配画布，这就是「卡住」的来源。

   ② 防误触。判据按可靠度排序：笔正在接触 > 笔刚抬起（宽限期）> 笔在悬停 >
      这台设备见过笔 > 触点尺寸像手掌。任一成立，单指触摸就只做手势不出墨。
      双指永远是缩放/平移。而且笔画在抬笔那一刻才入账（之前只存在于 wet 层），
      所以「手掌先落、笔随后到」「写着写着第二根手指落下」这些情况一律直接丢弃
      未完成的那笔，不需要事后从数据里把它抠出来（旧版就是抠不干净才乱）。

   ③ 笔本身。存储仍是矢量：{w:基准宽, c:颜色号, p:[x,y,v, ...]}，v 是归一化宽度
      因子（压感曲线 × 速度衰减 × 倾角；旧数据存的是原始压感，值域一致照样渲染）。
      宽度只有一个公式 inkWidthAt，实时/重绘/缩略图/导出全走它——旧版三处各写一份，
      同一笔在三个地方粗细不同，这是「写起来很奇怪」的一大来源。平滑放在采集端
      （速度自适应低通 + 最小间距抽稀），所以 wet 和 dry 画出来一模一样，抬笔不跳。

   数据兼容：页既可以是数组（错题手写板的旧格式），也可以是对象
   {id,bgType,bgData,width,height,layers:[{id,name,visible,strokes}]}（笔记本）。
   两种都走同一套渲染与输入，差别只在「往哪个数组里写」。 */
const INK_W = 1000, INK_H = 500;      // 数组页（旧格式）的逻辑纸面尺寸
const INK_GAP = 24;                   // 长卷里页与页的间隙，纯显示，不进数据
const INK_MAX_PAGES = 200;
/* 颜色只能往后追加：笔迹存的是下标，改前六个会让历史笔迹集体变色 */
const INK_COLORS = ["#1c2430", "#cf3232", "#2563eb", "#178a5a", "#d97706", "#7c3aed"];
const INK_WIDTHS = [1.1, 1.8, 2.9];
/* 荧光笔宽度直接就是最终宽度（v 恒定 0.5，inkWidthAt 正好等于 base） */
const INK_HL_WIDTHS = [14, 22, 32];
const INK_ERASERS = [10, 22, 40];
const INK_HL_ALPHA = 0.34;
/* 防误触阈值 */
const INK_PEN_GRACE = 420;   // 笔抬起后这段时间内，手掌余触仍然无效
const INK_PEN_HOVER = 1200;  // 侦测到笔悬停后，这段时间内认为「笔还在手上」
const INK_PALM_SIZE = 38;    // 触点长边超过这么多 CSS px 判为手掌（报 1 的设备不受影响）
const INK_ARB_MS = 45;       // 手指模式下第一指的仲裁窗，窗内第二指到齐就整笔作废
const INK_HOLD_MS = 620;     // 笔尖按住不动 → 临时橡皮
const INK_HOLD_SLOP = 14;
const INK_MIN_STEP = 0.7;    // 相邻采样点的最小逻辑间距（抽稀）
const INK_MAX_CANVAS_PX = 36e6;   // 画布像素上限，长卷 + 高 dpr 会撞内存
const INK_LASSO_HANDLE = 13; // 套索缩放手柄的命中半径（屏幕 px）
const INK_RULER_SNAP = 7;    // 直尺吸附角度（度），画坐标轴时自动摆正

const inkClamp = (v, a, b) => v < a ? a : v > b ? b : v;
/* 唯一的宽度公式。v 是归一化宽度因子（也兼容旧数据里的原始压感 0..1） */
const inkWidthAt = (base, v) => Math.max(0.35, base * 2 * (v > 0 ? v : 0.5));
/* 压感曲线：无压感设备的定值 0.5 → 0.79，满压 → 1.10，轻触 → 0.46 */
const inkPressV = pr => 0.30 + 0.80 * Math.pow(inkClamp(pr || 0.5, 0.02, 1), 0.7);
/* 速度衰减：写得快笔画略细，收笔自然收尖。速度单位 = 逻辑单位/ms */
const inkSpeedF = sp => inkClamp(1.06 - 0.11 * Math.sqrt(sp), 0.68, 1.06);
/* 倾角加宽：笔越躺越宽（有 tilt 的设备才有值） */
function inkTiltF(e){
  const tx = e.tiltX, ty = e.tiltY;
  if(tx === undefined || (tx === 0 && ty === 0)) return 1;
  const t = Math.min(75, Math.hypot(tx, ty));
  return 1 + 0.42 * Math.pow(t / 75, 1.8);
}

const inkInputMode = () => localStorage.getItem("cyt_inkmode") || "auto";
function inkPenPref(){       // 颜色/粗细/橡皮档记在本机（设备习惯，不同步）
  try{ return JSON.parse(localStorage.getItem("cyt_inkpen")) || {}; }catch(e){ return {}; }
}
function inkSavePref(){
  const st = inkPad; if(!st) return;
  try{
    localStorage.setItem("cyt_inkpen", JSON.stringify({
      color: st.color, hlColor: st.hlColor,
      penW: st.penW, hlW: st.hlW, eraser: st.eraser,
      eraseWhole: st.eraseWhole, snap: st.snap, haptic: st.haptic}));
  }catch(e){}
}
/* 落笔震动（手写笔反馈）。安卓 WebView 需要 APP 声明 VIBRATE 权限，
   navigator.vibrate 才会真的震；不支持的环境就是安静地什么都不做。 */
function inkHaptic(ms){
  const st = inkPad;
  if(!st || st.haptic === false) return;
  if(navigator.vibrate) try{ navigator.vibrate(ms || 8); }catch(e){}
}
/* 旧版本存的是档位下标（width/hlWidth/eraser∈0..2），拉条时代存真实值。
   读档时顺手迁移，老用户无感升级。 */
function inkMigratePref(pref){
  if(pref.penW === undefined) pref.penW = INK_WIDTHS[pref.width ?? 1] ?? 1.8;
  if(pref.hlW === undefined) pref.hlW = INK_HL_WIDTHS[pref.hlWidth ?? 1] ?? 22;
  if(pref.eraser === undefined || pref.eraser <= 3)       // 旧 eraser 是 0..2 的下标
    pref.eraser = INK_ERASERS[pref.eraser ?? 1] ?? 22;
  return pref;
}
function inkPagesOf(ink){       // 旧格式（单页平铺）→ 页数组
  if(!ink || !ink.length) return [[]];
  return Array.isArray(ink[0]) ? ink : [ink];
}
/* 这台设备见过笔没有。见过一次就永久记住：之后即使笔没在悬停，
   单指触摸也默认按手掌处理（auto 模式）——这是「不用手动切开关」的关键。 */
let inkPenSeen = localStorage.getItem("cyt_penseen") === "1";
let inkPenDown = false;      // 笔/鼠标正在接触
let inkPenUpAt = 0;          // 笔最后一次抬起的时刻
let inkPenHoverAt = 0;       // 笔最后一次被侦测到（悬停或接触）的时刻
function inkNotePen(){
  inkPenHoverAt = performance.now();
  if(!inkPenSeen){ inkPenSeen = true; try{ localStorage.setItem("cyt_penseen","1"); }catch(e){} }
}
/* 单指触摸能不能出墨。返回 false = 只当手势/忽略 */
function inkTouchInk(e){
  const st = inkPad; if(!st) return false;
  if(st.input === "pen") return false;
  if(st.input === "finger") return !inkPenDown;
  /* auto：有任何笔的迹象就不让手指出墨 */
  if(inkPenDown) return false;
  const now = performance.now();
  if(now - inkPenUpAt < INK_PEN_GRACE) return false;
  if(now - inkPenHoverAt < INK_PEN_HOVER) return false;
  if(inkPenSeen) return false;
  /* 没见过笔的设备（纯触屏），大触点仍按手掌挡掉 */
  return !inkIsPalm(e);
}
const inkIsPalm = e => (e.width > INK_PALM_SIZE || e.height > INK_PALM_SIZE);

/* 组件状态。只有一块板是活的，所以做成模块级单例。 */
let inkPad = null;

function inkClose(){
  const st = inkPad;
  if(!st) return;
  if(st._ro){ try{ st._ro.disconnect(); }catch(e){} }
  if(st._cleanup) try{ st._cleanup(); }catch(e){}
  if(st.fs) st.fs.remove();
  if(st.host) st.host.innerHTML = "";
  inkCursor(null); inkHoldRing(false);
  inkPad = null;
}
/* 取走存档（只在 qid 匹配时）：只留有内容的页，全空返回 null。
   笔迹里挂着 Path2D 缓存和包围盒，落库前必须剥干净（结构化克隆存不了 Path2D）。 */
function inkTake(qid){
  if(!inkPad || inkPad.qid !== qid) return null;
  const pages = inkPad.pages.filter(p => inkStrokesOf(p, -1).length).map(inkPlainPage);
  return pages.length ? pages : null;
}
function inkPlainStroke(s){
  const o = {w:s.w, c:s.c, p:Array.from(s.p)};
  if(s.t) o.t = s.t;
  return o;
}
function inkPlainPage(pg){
  if(Array.isArray(pg)) return pg.map(inkPlainStroke);
  const o = {...pg};
  delete o._h; delete o._img;
  o.layers = (pg.layers||[]).map(l => ({...l, strokes: l.strokes.map(inkPlainStroke)}));
  return o;
}
/* 一页里的笔画。layer=-1 表示「所有可见图层合起来（只读）」，
   否则返回可写的那个数组本身。数组页永远只有一个隐含图层。 */
function inkStrokesOf(pg, layer){
  if(!pg) return [];
  if(Array.isArray(pg)) return pg;
  const ls = pg.layers || [];
  if(layer === -1){
    if(ls.length === 1) return ls[0].visible === false ? [] : ls[0].strokes;
    return ls.filter(l => l.visible !== false).flatMap(l => l.strokes);
  }
  const l = ls[layer] || ls[0];
  return l ? l.strokes : [];
}
/* 当前正在写的那个数组（会被 push） */
function inkTargetStrokes(pg){
  const st = inkPad;
  if(Array.isArray(pg)) return pg;
  const ls = pg.layers || (pg.layers = [{id:"l1", name:"图层 1", visible:true, strokes:[]}]);
  let i = st ? (st.activeLayer|0) : 0;
  if(i < 0 || i >= ls.length) i = ls.length - 1;
  if(ls[i].visible === false){ ls[i].visible = true; }   // 往看不见的图层里写 = 白写
  return ls[i].strokes;
}
