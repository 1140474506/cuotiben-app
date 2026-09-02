/* ---- 工具栏 / 面板 / 缩略图 / 全屏 / 入口 ----
   工具栏一排放常用的（笔 荧光笔 直线 套索 橡皮 手 撤销 重做 页码 缩放），
   笔的颜色粗细收进抽屉：点一下已选中的工具就展开，再点收起。
   旧版笔记本全屏用的是另一套 class（.ink-bar/.ink-c/.ink-w），
   而事件是按 data-tool/data-act 匹配的，所以笔记本里整条工具栏根本点不动。
   现在只有这一份 HTML 和这一份接线。 */
function inkToolBtn(tool, label, title){
  const on = inkPad.tool === tool ? " on" : "";
  return `<button class="btn ghost small ink-tool${on}" data-tool="${tool}" title="${title}">${label}</button>`;
}
function inkToolbarHTML(){
  const st = inkPad;
  const sep = `<span class="ink-seg"></span>`;
  const nb = !!st.note;
  const pg = st.pages[st.page];
  const layers = (pg && !Array.isArray(pg) && pg.layers) || null;
  return `
    ${inkToolBtn("pen","✒️","笔（再点一下展开颜色 / 粗细；笔尖按住不动约 0.6 秒 = 临时橡皮，抬笔恢复）")}
    ${inkToolBtn("highlighter","🖍️","荧光笔：半透明，重叠不加深")}
    ${inkToolBtn("line","📏","直线：分数线 / 坐标轴 / 矩阵括号。按住 Shift 吸附 15° 整角")}
    ${inkToolBtn("lasso","🔲","套索：圈住笔迹后可拖动、缩放、换色、复制、删除")}
    ${inkToolBtn("erase","🧽","橡皮：扫到哪擦到哪，压得越重擦得越宽。抽屉里可切「整条擦除」")}
    ${inkToolBtn("pan","✋","手型：拖动纸面（双指捏合随时可用）")}
    ${sep}
    <button class="btn ghost small" data-act="undo" title="撤销（Ctrl+Z，双指轻点纸面也可以）" ${st.undo.length?"":"disabled"}>↩️</button>
    <button class="btn ghost small" data-act="redo" title="重做（Ctrl+Shift+Z，三指轻点纸面）" ${st.redo.length?"":"disabled"}>↪️</button>
    ${sep}
    ${nb && !(pg && pg.infinite) ? `<span class="muted ink-page" title="当前页 / 总页数">${st.page+1}/${st.pages.length}页</span>
    <button class="btn ghost small" data-act="addpage" title="在下方加一页（写到纸尾也会自动加页）">＋页</button>
    ${st.pages.length>1?`<button class="btn ghost small" data-act="delpage" title="删除当前页">✕页</button>`:""}`:""}
    ${nb && !(pg && pg.infinite) ? `<button class="btn ghost small${st.thumbsOpen?" on":""}" data-act="thumbs" title="页面缩略图，点一下跳页">🗂️</button>`:""}
    ${layers?`<button class="btn ghost small${st.layersOpen?" on":""}" data-act="layers" title="图层：把批注和正文分开">📚 ${st.activeLayer+1}/${layers.length}</button>`:""}
    ${sep}
    <button class="btn ghost small" data-act="zoomout" title="缩小">－</button>
    <button class="btn ghost small ink-zoom" data-act="fitview" title="点一下回到适配大小（G）">${Math.round(st.view.z*100)}%</button>
    <button class="btn ghost small" data-act="zoomin" title="放大">＋</button>
    ${st.fs?"":`<button class="btn ghost small" data-act="fs" title="全屏书写">⛶ 全屏</button>`}
    ${st.lasso?`
    <div class="inkset">
      <span class="lbl">选中 ${st.lasso.items.length} 笔</span>
      ${INK_COLORS.map((c,i)=>`<button class="ink-dot" data-lcolor="${i}" style="background:${c}" title="换成这个颜色"></button>`).join("")}
      <button class="btn ghost small" data-act="ldup" title="原地复制一份">⧉ 复制</button>
      <button class="btn ghost small" data-act="ldel" title="删除（Delete）">🗑 删除</button>
      ${layers && layers.length>1?layers.map((l,i)=> i===st.lasso.layer?"":
        `<button class="btn ghost small" data-llayer="${i}" title="搬到「${l.name}」">→ ${l.name}</button>`).join(""):""}
      <button class="btn ghost small" data-act="lnone" title="取消选择（Esc）">✕</button>
    </div>`:st.settingsOpen?`
    <div class="inkset">${inkSettingsHTML()}</div>`:""}`;
}
function inkSettingsHTML(){
  const st = inkPad;
  if(st.tool === "erase"){
    return `<span class="lbl">橡皮大小</span>
      ${["小","中","大"].map((t,i)=>`<button class="btn ghost small ${st.eraser===i?"on":""}" data-esize="${i}">${t}</button>`).join("")}
      <span class="ink-seg"></span>
      <button class="btn ghost small ${st.eraseWhole?"on":""}" data-act="whole" title="开：碰到就整条擦掉；关：只擦掉碰到的那一段">整条擦除</button>
      <span class="lbl">压得越重擦得越宽</span>`;
  }
  const hl = st.tool === "highlighter";
  const widths = hl ? INK_HL_WIDTHS : INK_WIDTHS;
  const cur = hl ? st.hlWidth : st.width;
  const curC = hl ? st.hlColor : st.color;
  return `<span class="lbl">颜色</span>
    ${INK_COLORS.map((c,i)=>`<button class="ink-dot ${curC===i?"on":""}" data-color="${i}" style="background:${c}"></button>`).join("")}
    <span class="ink-seg"></span>
    <span class="lbl">粗细</span>
    ${widths.map((w,i)=>`<button class="ink-wbtn ${cur===i?"on":""}" data-width="${i}" title="${["细","中","粗"][i]}"><i style="height:${Math.min(14, hl?w/2.2:w*2.4)}px"></i></button>`).join("")}
    <span class="ink-seg"></span>
    <button class="btn ghost small ${st.snap?"on":""}" data-act="snap" title="一笔画完的圆 / 方 / 直线自动摆正，写字不受影响">📐 整形</button>
    <span class="ink-seg"></span>
    <span class="lbl">输入</span>
    <button class="btn ghost small ink-in ${st.input==="auto"?"on":""}" data-in="auto" title="自动：认出手写笔后自动忽略手掌，双指仍可缩放">🤖 自动</button>
    <button class="btn ghost small ink-in ${st.input==="pen"?"on":""}" data-in="pen" title="只认手写笔">✒️ 笔</button>
    <button class="btn ghost small ink-in ${st.input==="finger"?"on":""}" data-in="finger" title="允许手指书写">👆 手指</button>`;
}
function inkSyncBar(){
  const st = inkPad; if(!st) return;
  const html = inkToolbarHTML();
  document.querySelectorAll(".inkbar").forEach(bar=>{ bar.innerHTML = html; });
  inkLayerPanel(); inkThumbsPanel();
  inkCursor(null);
}
function inkWireBar(bar){
  bar.addEventListener("click", e=>{
    const t = e.target.closest("[data-thumb]");
    if(t){ inkGotoPage(+t.dataset.thumb); inkThumbSelect(); return; }
    const b = e.target.closest("button");
    if(b) inkBarAction(b);
  });
}
/* 工具栏和各个面板共用这一个处理函数（都按 data-* 匹配） */
function inkBarAction(b){
    const st = inkPad;
    if(!b || !st) return;
    const d = b.dataset;
    if(d.in){ st.input = d.in; try{ localStorage.setItem("cyt_inkmode", st.input); }catch(err){} }
    else if(d.color !== undefined){
      if(st.tool === "highlighter") st.hlColor = +d.color; else st.color = +d.color;
      inkSavePref();
    }
    else if(d.width !== undefined){
      if(st.tool === "highlighter") st.hlWidth = +d.width; else st.width = +d.width;
      inkSavePref();
    }
    else if(d.esize !== undefined){ st.eraser = +d.esize; inkSavePref(); }
    else if(d.lcolor !== undefined) inkLassoColor(+d.lcolor);
    else if(d.llayer !== undefined) inkLassoToLayer(+d.llayer);
    else if(d.layer !== undefined){
      st.activeLayer = +d.layer;
      st.lasso = null;
      inkInvalidate();
    }
    else if(d.tool){
      /* 点已选中的工具 = 开关设置抽屉；点没选中的 = 切过去 */
      if(st.tool === d.tool) st.settingsOpen = !st.settingsOpen;
      else{ st.tool = d.tool; if(d.tool !== "lasso") st.lasso = null; }
      inkInvalidate();
    }
    else switch(d.act){
      case "undo": return inkUndo();
      case "redo": return inkRedo();
      case "whole": st.eraseWhole = !st.eraseWhole; inkSavePref(); break;
      case "snap": st.snap = !st.snap; inkSavePref(); break;
      case "ldel": return inkLassoDelete();
      case "ldup": return inkLassoDup();
      case "lnone": st.lasso = null; inkInvalidate(); break;
      case "thumbs": st.thumbsOpen = !st.thumbsOpen; break;
      case "layers": st.layersOpen = !st.layersOpen; break;
      case "addpage": return inkAddPage();
      case "delpage": return inkDelPage();
      case "addlayer": return inkAddLayer();
      case "dellayer": return inkDelLayer(+b.dataset.li);
      case "hidelayer": return inkToggleLayer(+b.dataset.li);
      case "grid": return inkCycleGrid();
      case "zoomin": case "zoomout": {
        if(!st._rect) return;
        const r = st._rect;
        inkZoomAt(r.left + r.width/2, r.top + r.height/2, d.act === "zoomin" ? 1.25 : 1/1.25);
        return;
      }
      case "fitview": inkFitView(); inkInvalidate(); inkZoomLabel(); return;
      case "fs": return inkFullscreen();
      case "unfs": return inkUnfullscreen();
      case "export": return inkExportPDF();
      case "clearpage": return inkClearPage();
    }
    inkSyncBar();
}
/* ---- 页面增删 ---- */
function inkNewPage(){
  const st = inkPad;
  const proto = st && st.pages[st.pages.length-1];
  if(!st || Array.isArray(proto) || !proto) return [];
  const pg = {id:"p"+Date.now().toString(36)+Math.random().toString(36).slice(2,6),
          bgType:"blank", bgData:null, w:proto.w||INK_NB_W, h:proto.h||INK_NB_H,
          grid:proto.grid||"dot",
          layers:[{id:"l1", name:"图层 1", visible:true, strokes:[]}]};
  if(proto.infinite){ pg.infinite = true; pg.w = proto.w || INK_INF_W; pg.h = proto.h || INK_INF_H; }
  return pg;
}
function inkAddPage(){
  const st = inkPad; if(!st) return;
  if(st.pages.length >= INK_MAX_PAGES){ toast("页数到上限了"); return; }
  const at = st.page + 1;
  const pg = inkNewPage();
  st.pages.splice(at, 0, pg);
  inkPush({k:"page", add:true, at, pg2:pg, pg:at});
  inkGotoPage(at); inkSyncBar(); inkThumbsRefresh();
}
function inkDelPage(){
  const st = inkPad; if(!st) return;
  if(st.pages.length <= 1){ toast("只剩一页了，不能删"); return; }
  const at = st.page, pg = st.pages[at];
  const has = inkStrokesOf(pg, -1).length;
  if(has && !confirm(`第 ${at+1} 页上有 ${has} 笔，确定删掉？（可以撤销）`)) return;
  st.pages.splice(at, 1);
  inkPush({k:"page", add:false, at, pg2:pg, pg:Math.min(at, st.pages.length-1)});
  inkGotoPage(Math.min(at, st.pages.length-1));
  inkSyncBar(); inkThumbsRefresh();
}
function inkClearPage(){
  const st = inkPad; if(!st) return;
  const pi = st.page, pg = st.pages[pi];
  const layer = Array.isArray(pg) ? 0 : inkClamp(st.activeLayer|0, 0, pg.layers.length-1);
  const arr = inkArrOf({pg:pi, layer});
  if(!arr || !arr.length) return;
  if(!confirm(`清空这一页的 ${arr.length} 笔？（可以撤销）`)) return;
  const items = arr.map((s,i)=>({s, at:i}));
  arr.length = 0;
  inkPush({k:"del", pg:pi, layer, items});
  inkInvalidate(); inkSyncBar(); inkThumbsRefresh();
}
function inkCycleGrid(){
  const st = inkPad; if(!st) return;
  const pg = st.pages[st.page];
  if(Array.isArray(pg)) return;
  const order = ["dot","line","grid","none"];
  pg.grid = order[(order.indexOf(pg.grid||"dot")+1) % order.length];
  st.dirty = true;
  inkInvalidate(); inkAutoSave(); inkThumbsRefresh();
  toast("底纹：" + ({dot:"点阵", line:"横线", grid:"方格", none:"空白"})[pg.grid]);
}
/* ---- 图层面板 ---- */
function inkAddLayer(){
  const st = inkPad; if(!st) return;
  const pg = st.pages[st.page];
  if(Array.isArray(pg)) return;
  if(pg.layers.length >= 8){ toast("一页最多 8 个图层"); return; }
  const at = pg.layers.length;
  const l = {id:"l"+Date.now().toString(36), name:"图层 "+(at+1), visible:true, strokes:[]};
  pg.layers.push(l);
  st.activeLayer = at;
  inkPush({k:"layer", add:true, at, l, pg:st.page});
  inkSyncBar();
}
function inkDelLayer(li){
  const st = inkPad; if(!st) return;
  const pg = st.pages[st.page];
  if(Array.isArray(pg) || pg.layers.length <= 1) return;
  const l = pg.layers[li]; if(!l) return;
  if(l.strokes.length && !confirm(`「${l.name}」上有 ${l.strokes.length} 笔，确定删掉？（可以撤销）`)) return;
  pg.layers.splice(li, 1);
  st.activeLayer = inkClamp(st.activeLayer, 0, pg.layers.length-1);
  inkPush({k:"layer", add:false, at:li, l, pg:st.page});
  inkInvalidate(); inkSyncBar(); inkThumbsRefresh();
}
function inkToggleLayer(li){
  const st = inkPad; if(!st) return;
  const pg = st.pages[st.page];
  if(Array.isArray(pg) || !pg.layers[li]) return;
  pg.layers[li].visible = pg.layers[li].visible === false;
  st.dirty = true;
  inkInvalidate(); inkSyncBar(); inkAutoSave(); inkThumbsRefresh();
}
function inkLayerPanel(){
  const st = inkPad; if(!st) return;
  document.querySelectorAll(".ink-layers").forEach(el=>{
    const pg = st.pages[st.page];
    if(!st.layersOpen || Array.isArray(pg) || !pg.layers){ el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    el.innerHTML = `<div class="ink-row"><b>图层</b>
        <button class="btn ghost small" data-act="addlayer">＋ 新图层</button>
        <button class="btn ghost small" data-act="grid" title="切换这一页的底纹">底纹</button>
      </div>` +
      pg.layers.map((l,i)=>`
      <div class="ink-row${i===st.activeLayer?" on":""}">
        <button class="btn ghost small" data-layer="${i}" style="flex:1;text-align:left">${i===st.activeLayer?"● ":"○ "}${l.name}<span class="lbl"> ${l.strokes.length} 笔</span></button>
        <button class="btn ghost small" data-act="hidelayer" data-li="${i}" title="显示 / 隐藏">${l.visible===false?"🙈":"👁️"}</button>
        ${pg.layers.length>1?`<button class="btn ghost small" data-act="dellayer" data-li="${i}" title="删除图层">🗑</button>`:""}
      </div>`).join("");
  });
}
/* ---- 页面缩略图：只在内容变了的时候重画，避免每帧 N 张小图 ---- */
let inkThumbTimer = 0;
function inkThumbsRefresh(){
  const st = inkPad; if(!st || !st.thumbsOpen) return;
  clearTimeout(inkThumbTimer);
  inkThumbTimer = setTimeout(inkThumbsPaint, 220);
}
function inkThumbsPanel(){
  const st = inkPad; if(!st) return;
  document.querySelectorAll(".ink-thumbs").forEach(el=>{
    if(!st.thumbsOpen){ el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    if(el.childElementCount !== st.pages.length){
      el.innerHTML = st.pages.map((p,i)=>
        `<div class="ink-thumb" data-thumb="${i}"><canvas width="84" height="118"></canvas><span>${i+1}</span></div>`).join("");
    }
    inkThumbsPaint(); inkThumbSelect();
  });
}
function inkThumbsPaint(){
  const st = inkPad; if(!st || !st.thumbsOpen) return;
  document.querySelectorAll(".ink-thumbs").forEach(el=>{
    el.querySelectorAll("canvas").forEach((cv, i)=>{
      const pg = st.pages[i]; if(!pg) return;
      const ctx = cv.getContext("2d");
      ctx.setTransform(1,0,0,1,0,0);
      ctx.clearRect(0,0,cv.width,cv.height);
      inkPaintPageTo(ctx, pg, cv.width, cv.height, true);
    });
  });
}
function inkThumbSelect(){
  const st = inkPad; if(!st) return;
  document.querySelectorAll(".ink-thumbs .ink-thumb").forEach(el=>
    el.classList.toggle("on", +el.dataset.thumb === st.page));
}
function inkWirePanels(root){
  root.addEventListener("click", e=>{
    const t = e.target.closest("[data-thumb]");
    if(t){ inkGotoPage(+t.dataset.thumb); inkThumbSelect(); return; }
    const b = e.target.closest("button");
    if(b) inkBarAction(b);
  });
}
/* ---- 开板 / 挂载 / 全屏 ---- */
function inkPadHTML(nb){
  return `
    <div class="inkbar"></div>
    <div class="inkwrap">
      <canvas class="ink-dry"></canvas>
      <canvas class="ink-wet"></canvas>
      <canvas class="ink-pred"></canvas>
    </div>
    <div class="ink-panel ink-layers" hidden></div>
    <div class="ink-panel ink-thumbs" hidden></div>`;
}
/* 把三层画布接到宿主节点上。开板和「宿主 DOM 被外部重渲染冲掉后的重挂」共用
   这一个：同步心跳会重建复盘列表，板子的 DOM 跟着没了，但 inkPad 状态还在，
   这时要把板子接回去，而不是当成关闭把没存档的笔迹丢掉。 */
function inkMount(container, opts){
  const st = inkPad; if(!st) return;
  container.innerHTML = inkPadHTML(!!st.note);
  const wrap = container.querySelector(".inkwrap");
  st.wrap = wrap;
  st.dryC = wrap.querySelector(".ink-dry");
  st.wetC = wrap.querySelector(".ink-wet");
  st.predC = wrap.querySelector(".ink-pred");
  st.dryX = inkCtx(st.dryC); st.wetX = inkCtx(st.wetC); st.predX = inkCtx(st.predC);
  st._rect = null; st._map = null;
  if(st.transparent) wrap.classList.add("transparent");
  if(opts && opts.height) wrap.style.height = opts.height;
  if(opts && opts.flat) wrap.classList.add("flat");
  inkWireWrap(wrap);
  inkWireBar(container.querySelector(".inkbar"));
  const panels = container.querySelectorAll(".ink-panel");
  panels.forEach(p=> inkWirePanels(p));
  /* 容器尺寸变了（转屏 / 面板展开 / 键盘弹出）就重排一次 */
  if(st._ro) try{ st._ro.disconnect(); }catch(e){}
  st._ro = new ResizeObserver(()=>{ st._rect = null; inkInvalidate(); });
  st._ro.observe(wrap);
  inkSyncBar();
  if(opts && opts.fit) inkFitView();
  inkInvalidate();
}
/* 全屏：顶栏 + （可选）题目区 + 纸面 + 底部工具栏 */
function inkFullscreen(){
  const st = inkPad; if(!st || st.fs) return;
  const fs = document.createElement("div");
  fs.className = "inkfs";
  fs.innerHTML = `
    <div class="inkfs-top">
      <button class="btn small" data-act="unfs">${st.note ? "🔙 返回" : "✅ 写完了"}</button>
      <span class="ink-name">${st.note ? (st.note.title||"未命名笔记") : "手写演算"}</span>
      <div style="flex:1"></div>
      ${st.note?`<button class="btn ghost small" data-act="export" title="导出成 PDF">⬇️ PDF</button>`:""}
      <button class="btn ghost small" data-act="clearpage" title="清空当前页">🧹</button>
    </div>
    ${st.qHTML?`<div class="inkfs-q">${st.qHTML}</div>`:""}
    <div class="inkfs-body"></div>
    <div class="inkbar"></div>`;
  document.body.appendChild(fs);
  st.fs = fs;
  /* 状态搬到全屏的容器里（原宿主的 DOM 留着不动，退出时接回去） */
  const body = fs.querySelector(".inkfs-body");
  body.innerHTML = `
    <div class="inkwrap">
      <canvas class="ink-dry"></canvas><canvas class="ink-wet"></canvas><canvas class="ink-pred"></canvas>
    </div>
    <div class="ink-panel ink-layers" hidden></div>
    <div class="ink-panel ink-thumbs" hidden></div>`;
  const wrap = body.querySelector(".inkwrap");
  st.wrap = wrap;
  st.dryC = wrap.querySelector(".ink-dry");
  st.wetC = wrap.querySelector(".ink-wet");
  st.predC = wrap.querySelector(".ink-pred");
  st.dryX = inkCtx(st.dryC); st.wetX = inkCtx(st.wetC); st.predX = inkCtx(st.predC);
  st._rect = null; st._map = null;
  if(st.transparent) wrap.classList.add("transparent");
  if(st.frame){ wrap.insertBefore(st.frame, st.dryC); }
  inkWireWrap(wrap);
  inkWireBar(fs.querySelector(".inkbar"));
  fs.querySelector(".inkfs-top").addEventListener("click", e=>{
    const b = e.target.closest("button"); if(b) inkBarAction(b);
  });
  body.querySelectorAll(".ink-panel").forEach(p=> inkWirePanels(p));
  if(st._ro) try{ st._ro.disconnect(); }catch(e){}
  st._ro = new ResizeObserver(()=>{ st._rect = null; inkInvalidate(); });
  st._ro.observe(wrap);
  inkSyncBar(); inkFitView(); inkInvalidate();
}
function inkUnfullscreen(){
  const st = inkPad; if(!st || !st.fs) return;
  st.fs.remove(); st.fs = null;
  if(st.note){ noteClose(); return; }
  if(st.host && st.host.isConnected) inkMount(st.host, {height:st.hostH, fit:true});
  else if(st.host) inkClose();
  else inkSaveFree();          // 题库「写写看」没有内联宿主，退出全屏即存档
}
/* ---- 开板 ---- */
function inkOpen(cfg2){
  inkClose();
  const pref = inkPenPref();
  inkPad = {
    qid: cfg2.qid || null,
    qHTML: cfg2.qHTML || "",
    host: cfg2.host || null,
    hostH: cfg2.height || null,
    note: cfg2.note || null,          // 笔记本对象（笔记模式下才有）
    pages: cfg2.pages && cfg2.pages.length ? cfg2.pages : [[]],
    page: 0, activeLayer: 0,
    tool: "pen", input: inkInputMode(),
    color: pref.color ?? 0, width: pref.width ?? 1,
    hlColor: pref.hlColor ?? 4, hlWidth: pref.hlWidth ?? 1,
    eraser: pref.eraser ?? 1,
    eraseWhole: pref.eraseWhole ?? false,
    snap: pref.snap ?? false,
    snapAngle: false,
    predict: true,
    fingerPan: true,
    autoGrow: cfg2.autoGrow !== false,
    transparent: !!cfg2.transparent,
    fitMode: cfg2.fitMode || "page",
    undo: [], redo: [], dirty: false,
    view: {z:1, px:0, py:0},
    settingsOpen: false, layersOpen: false, thumbsOpen: false,
    lasso: null, lassoPath: null, lassoPg: 0,
    cur: null, fs: null, frame: null,
    strokeCount: 0, saveFn: cfg2.saveFn || null
  };
  /* html 背景页（打印练习纸）：起一个 iframe 垫在画布下面 */
  const p0 = inkPad.pages[0];
  if(p0 && !Array.isArray(p0) && p0.bgType === "html" && p0.bgData){
    const fr = document.createElement("iframe");
    fr.className = "ink-bgframe";
    fr.setAttribute("scrolling","no");
    fr.srcdoc = p0.bgData;
    fr.addEventListener("load", ()=>{
      try{
        const h = fr.contentDocument.documentElement.scrollHeight;
        if(h > 40){ p0._h = h; fr.style.height = h+"px"; }
      }catch(e){}
      inkFitView(); inkInvalidate();
    });
    inkPad.frame = fr;
    inkPad.autoGrow = false;
  }
  if(cfg2.host){
    inkMount(cfg2.host, {height:cfg2.height, fit:true, flat:cfg2.flat});
    if(inkPad.frame) inkPad.wrap.insertBefore(inkPad.frame, inkPad.dryC);
  }
  if(cfg2.fullscreen) inkFullscreen();
  inkFitView(); inkInvalidate();
  return inkPad;
}
/* 自动存档：写完一笔起 1.2 秒没有新动作就落库一次。
   笔记模式落 notebooks 表，错题模式什么都不做（笔迹随评分一起存）。 */
let inkSaveTimer = 0;
function inkAutoSave(now){
  const st = inkPad; if(!st || !st.saveFn) return;
  clearTimeout(inkSaveTimer);
  if(now){ st.saveFn(); return; }
  inkSaveTimer = setTimeout(()=>{ if(inkPad === st && st.dirty) st.saveFn(); }, 1200);
}
/* 自由手写存档：不评分，作为一条 {g:"ink"} 记录进 history */
async function inkSaveFree(){
  const st = inkPad; if(!st) return;
  const qid = st.qid, ink = inkTake(qid);
  inkClose();
  if(!ink || !qid) return;
  const q = (await dbAllRaw()).find(x=>x.id===qid); if(!q) return;
  if(!Array.isArray(q.history)) q.history = [];
  q.history.push({t:Date.now(), g:"ink", ink});
  q.updatedAt = Date.now();
  await dbPutRaw(q);
  invalidateAll(); syncSoon();
  toast("手写已存进这道题的记录");
}
/* ---- 三个错题入口 ---- */
/* 题目区内容（文字 + 选项 + 原图）：几何/函数图像题在全屏写字时图必须钉在眼前 */
function inkQHTML(q){
  return qBodyHTML(q) + (q.images||[]).map((src,i)=>
    `<img src="${src}" onclick="showQImg('${q.id}',${i})" loading="lazy"
      style="max-width:100%;max-height:200px;border-radius:8px;margin-top:8px;cursor:zoom-in">`).join("");
}
window.inkToggle = async function(id){
  const host = $("ink-"+id);
  if(inkPad && inkPad.qid === id && !inkPad.note){ inkClose(); return; }
  const q = (await dbAll()).find(x=>x.id===id); if(!q) return;
  inkOpen({qid:id, qHTML:inkQHTML(q), host, height:matchMedia("(max-width:600px)").matches?"260px":"300px"});
};
window.inkPToggle = function(){
  const s = pSession; if(!s) return;
  const q = s.list[s.idx]; if(!q) return;
  const host = $("ink-p");
  if(inkPad && inkPad.qid === q.id && !inkPad.note){ inkClose(); return; }
  inkOpen({qid:q.id, qHTML:inkQHTML(q), host, height:matchMedia("(max-width:600px)").matches?"260px":"300px"});
};
window.inkTry = async function(id){
  const q = (await dbAll()).find(x=>x.id===id); if(!q) return;
  inkOpen({qid:id, qHTML:inkQHTML(q), host:null, fullscreen:true});
};
/* 看上次手写：一页一画布，只读 */
window.inkView = async function(id){
  const q = (await dbAll()).find(x=>x.id===id); if(!q) return;
  const runs = (q.history||[]).filter(h=>h.ink && h.ink.length);
  if(!runs.length){ toast("这道题还没有手写记录"); return; }
  const last = runs[runs.length-1];
  const pages = inkPagesOf(last.ink);
  const wrap = document.createElement("div");
  wrap.className = "inkfs";
  wrap.innerHTML = `
    <div class="inkfs-top">
      <button class="btn small" data-close="1">🔙 返回</button>
      <span class="ink-name">${fmtDate(last.t)} 的手写（${pages.length} 页）</span>
    </div>
    <div class="inkfs-scroll">${pages.map(()=>`<div class="inkview"><canvas></canvas></div>`).join("")}</div>`;
  document.body.appendChild(wrap);
  wrap.querySelector("[data-close]").addEventListener("click", ()=> wrap.remove());
  wrap.querySelectorAll("canvas").forEach((cv, i)=>{
    const pg = pages[i];
    const w = Array.isArray(pg) ? INK_W : inkPageW(pg), h = Array.isArray(pg) ? INK_H : inkPageH(pg);
    cv.parentElement.style.aspectRatio = `${w} / ${h}`;
    requestAnimationFrame(()=> inkPaint(cv, pg));
  });
};
/* 离开页面前的兜底：有没存的笔迹就拦一下。
   旧版用 inkPad.pages.some(p=>p.length)，对象页没有 length，永远是 false。 */
addEventListener("beforeunload", e=>{
  const st = inkPad;
  if(!st) return;
  const has = st.dirty || st.pages.some(p => inkStrokesOf(p, -1).length);
  if(!has) return;
  if(st.note){ try{ st.saveFn && st.saveFn(); }catch(err){} return; }
  e.preventDefault(); e.returnValue = "";
});




