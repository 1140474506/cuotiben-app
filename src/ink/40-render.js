/* ---- 重绘调度：所有「整卷重画」的请求合流到一帧一次 ----
   旧版每个擦除采样点、每次捏合回调都同步重画整卷（还顺手重新分配画布），
   一秒能来几十次，主线程当场堵死——这就是用户说的「卡住」。
   现在统一走 inkInvalidate()：置脏 + 排一个 rAF，一帧内不管来多少次都只画一遍。
   写字过程中 dry 层完全不动，所以 inkInvalidate 在书写路径上根本不会被调用。 */
function inkInvalidate(){
  const st = inkPad; if(!st) return;
  st._dirty = true;
  if(st._raf) return;
  st._raf = requestAnimationFrame(()=>{ st._raf = 0; if(inkPad === st && st._dirty) inkRender(); });
}
/* 立即重绘（只在必须同步看到结果的地方用，比如导出前） */
function inkRender(){
  const st = inkPad; if(!st || !st.dryC) return;
  st._dirty = false;
  inkResizeCanvases();
  if(!st.cvW) return;
  const m = st._map = inkMap(st.cvW, st.cvH);
  const dpr = st.dpr;
  const ctx = st.dryX;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0, 0, st.dryC.width, st.dryC.height);
  inkSetXform(ctx, m, dpr);
  /* 可见的内容坐标窗口，用来裁掉屏外的页和笔画 */
  const vx0 = -m.ox/m.k, vy0 = -m.oy/m.k;
  const vis = [vx0, vy0, vx0 + st.cvW/m.k, vy0 + st.cvH/m.k];
  const lay = m.lay;
  const shadow = st.pages.length > 1 || !st.transparent;
  for(let i=0; i<st.pages.length; i++){
    const pg = st.pages[i];
    const w = inkPageW(pg), h = inkPageH(pg);
    const [px, py] = inkPageOrigin(i, lay);
    if(py > vis[3] || py + h < vis[1]) continue;      // 这一页整个在屏外
    /* 无限画布页：没有纸的概念，不画阴影/边框/页码，底纹按可见区裁着画。
       练习纸页（html 背景）同样不画阴影——阴影是 13% 的半透明深色，
       空白页会被随后刷的白底盖住，而 html 页不刷白底，整张练习纸
       就被罩成灰的（rgba(43,58,74,.13) 叠白 ≈ #e4e6e8）。 */
    const inf = !Array.isArray(pg) && !!pg.infinite;
    const htmlPage = !Array.isArray(pg) && pg.bgType === "html";
    ctx.save();
    ctx.translate(px, py);
    if(!st.transparent){
      if(!inf && !htmlPage && shadow){
        ctx.fillStyle = "rgba(43,58,74,.13)";
        ctx.fillRect(3/m.k, 3/m.k, w, h);
      }
      if(!htmlPage) inkPaintBg(ctx, pg, w, h, [vis[0]-px, vis[1]-py, vis[2]-px, vis[3]-py]);
    }
    const clip = [vis[0]-px, vis[1]-py, vis[2]-px, vis[3]-py];
    inkPaintStrokes(ctx, inkStrokesOf(pg, -1), clip);
    if(!st.transparent && !inf){
      ctx.strokeStyle = "#c9d0da"; ctx.lineWidth = Math.max(0.6, 1/m.k);
      ctx.strokeRect(0, 0, w, h);
      if(st.pages.length > 1){
        ctx.fillStyle = "#aab4c2";
        ctx.font = `${Math.round(14/m.k*1.6)}px sans-serif`;
        ctx.textAlign = "right";
        ctx.fillText(`${i+1}`, w - 16, h - 14);
        ctx.textAlign = "left";
      }
    }
    ctx.restore();
  }
  /* 套索：正在圈的虚线 + 已选中的框和手柄 */
  if(st.lasso || st.lassoPath) inkPaintLasso(ctx, m);
  /* 当前页 = 视野中心所在的页 */
  const cy = (st.cvH/2 - m.oy)/m.k;
  const pg = inkPageAtY(cy, lay);
  if(pg !== st.page){ st.page = pg; inkPageLabel(); inkThumbSelect(); }
  /* html 背景页：iframe 跟着同一套变换走，笔迹才对得上印刷内容 */
  if(st.frame) inkSyncFrame(m, lay);
}
/* 正在写的那一笔画在 wet 层。只画新增的那一小段：把 Path2D 缓存丢掉重建整条
   在长笔画上是 O(n²)，改成「从上次画到的点接着往下画」，每次都是常数工作量。
   笔迹坐标是页内坐标，所以要先平移到当前页的原点（st._curPgIdx）。 */
function inkWetOrigin(){
  const st = inkPad;
  const lay = (st._map && st._map.lay) || inkLayout();
  return inkPageOrigin(inkClamp(st._curPgIdx|0, 0, st.pages.length-1), lay);
}
function inkWetSeg(s, from){
  const st = inkPad; if(!st || !st._map) return;
  const ctx = st.wetX;
  inkSetXform(ctx, st._map, st.dpr);
  const [ox, oy] = inkWetOrigin();
  ctx.translate(ox, oy);
  const p = s.p, n = (p.length/3)|0;
  const hl = s.t === "hl";
  ctx.globalAlpha = hl ? INK_HL_ALPHA : 1;
  ctx.globalCompositeOperation = "source-over";   // wet 层本身是空的，multiply 在这层没意义
  ctx.fillStyle = INK_COLORS[s.c|0] || INK_COLORS[0];
  const pa = new Path2D();
  inkRibbon(pa, p, s.w || 1.4, Math.max(0, from), n);
  ctx.fill(pa);
  ctx.globalAlpha = 1;
}
function inkWetClear(){
  const st = inkPad; if(!st || !st.wetC) return;
  const x = st.wetX;
  x.setTransform(1,0,0,1,0,0);
  x.clearRect(0, 0, st.wetC.width, st.wetC.height);
}
function inkWetRedraw(s){          // 整条重画（直线/形状预览、平滑回溯）
  inkWetClear();
  if(s && s.p.length >= 3) inkWetSeg(s, 0);
}
function inkPredClear(){
  const st = inkPad; if(!st || !st.predC) return;
  const x = st.predX;
  x.setTransform(1,0,0,1,0,0);
  x.clearRect(0, 0, st.predC.width, st.predC.height);
}
/* html 背景页的 iframe：跟着 view 一起缩放平移。
   iframe 里是一张固定 INK_PAPER_W 宽的纸，用 transform 贴到内容坐标上。 */
function inkSyncFrame(m, lay){
  const st = inkPad;
  const pg = st.pages[0];
  const [px, py] = inkPageOrigin(0, lay);
  const sx = m.ox + px*m.k, sy = m.oy + py*m.k;
  st.frame.style.transformOrigin = "0 0";
  st.frame.style.transform = `translate(${sx}px, ${sy}px) scale(${m.k})`;
  st.frame.style.width = inkPageW(pg) + "px";
}

/* ---- 只读视图（复盘卡里「看上次手写」）----
   一页一画布，整页缩放居中。不建三层，也不进 inkPad 状态。 */
function inkPaint(cv, pgData){
  const cw = cv.clientWidth, ch = cv.clientHeight;
  if(!cw || !ch) return;
  const dpr = Math.min(devicePixelRatio||1, 2);
  cv.width = Math.round(cw*dpr); cv.height = Math.round(ch*dpr);
  const ctx = cv.getContext("2d");
  const w = Array.isArray(pgData) ? INK_W : inkPageW(pgData);
  const h = Array.isArray(pgData) ? INK_H : inkPageH(pgData);
  const k = Math.min(cw/w, ch/h);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,cw,ch);
  ctx.translate((cw-w*k)/2, (ch-h*k)/2); ctx.scale(k, k);
  inkPaintBg(ctx, pgData, w, h);
  inkPaintStrokes(ctx, inkStrokesOf(pgData, -1), null);
}
/* 导出/缩略图用：把一页画到指定像素尺寸的上下文里。
   无限画布页自动取笔迹包围盒为取景框（整张 20000 的纸缩成缩略图只会是一个点）；
   win 参数可显式指定取景框 [x0,y0,x1,y1]（页内坐标）。 */
function inkPaintPageTo(ctx, pgData, outW, outH, opaque, win){
  const w = Array.isArray(pgData) ? INK_W : inkPageW(pgData);
  const h = Array.isArray(pgData) ? INK_H : inkPageH(pgData);
  let bx = 0, by = 0, bw = w, bh = h;
  if(win){ bx = win[0]; by = win[1]; bw = win[2]-win[0]; bh = win[3]-win[1]; }
  else if(!Array.isArray(pgData) && pgData.infinite){
    const bb = inkInkBB(pgData);
    if(bb){
      bx = bb[0]-80; by = bb[1]-80;
      bw = bb[2]-bb[0]+160; bh = bb[3]-bb[1]+160;
    }else{ bx = 0; by = 0; bw = 1000; bh = 1000; }
  }
  if(bw < 1 || bh < 1){ bw = 1; bh = 1; }
  const k = Math.min(outW/bw, outH/bh);
  ctx.save();
  if(opaque){ ctx.fillStyle = "#fff"; ctx.fillRect(0,0,outW,outH); }
  ctx.translate((outW-bw*k)/2, (outH-bh*k)/2);
  ctx.scale(k, k);
  ctx.translate(-bx, -by);
  const frame = [bx, by, bx+bw, by+bh];
  inkPaintBg(ctx, pgData, w, h, frame);
  inkPaintStrokes(ctx, inkStrokesOf(pgData, -1), frame);
  ctx.restore();
}
addEventListener("resize", ()=>{ if(inkPad){ inkPad._rect = null; inkInvalidate(); } });
