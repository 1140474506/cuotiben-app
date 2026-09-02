/* ---- 笔画几何：一条笔画 → 一条填充轮廓 ----
   为什么不是 lineTo + stroke：变宽的笔画必须一段一段 stroke，而每段两端的圆头
   在半透明荧光笔下会叠出深斑，在快速书写的自交处也会积墨。改成「中心线两侧偏移
   + 每个采样点一个圆」的并集，一次 fill 画完：宽度连续变化，重叠处不加深。
   路径缓存在笔画对象上（_pa），点数不变就直接复用——重绘整页时这是主要的省。
   所有子路径统一走正向绕数，nonzero 填充才是并集而不是互相打洞。 */
const INK_TAU = Math.PI * 2;
/* 把采样点区间 [i0,i1) 铺成「圆 + 四边形」的并集，追加到 pa 上。
   实时的 wet 层、落稿的 dry 层、预测层共用它，三处画出来必然一模一样。 */
function inkRibbon(pa, p, base, i0, i1){
  for(let i=i0; i<i1; i++){
    const ax = p[i*3], ay = p[i*3+1], ra = inkWidthAt(base, p[i*3+2]) / 2;
    /* 每个采样点一个圆 = 圆头 + 平滑的宽度过渡 + 转折处不缺角 */
    pa.moveTo(ax + ra, ay);
    pa.arc(ax, ay, ra, 0, INK_TAU);
    if(i === i1-1) break;
    const bx = p[i*3+3], by = p[i*3+4], rb = inkWidthAt(base, p[i*3+5]) / 2;
    let dx = bx-ax, dy = by-ay;
    const len = Math.hypot(dx, dy);
    if(len < 1e-6) continue;
    dx /= len; dy /= len;
    const nx = -dy, ny = dx;
    pa.moveTo(ax - nx*ra, ay - ny*ra);
    pa.lineTo(bx - nx*rb, by - ny*rb);
    pa.lineTo(bx + nx*rb, by + ny*rb);
    pa.lineTo(ax + nx*ra, ay + ny*ra);
    pa.closePath();
  }
}
function inkStrokeGeom(s){
  const p = s.p, n = (p.length/3)|0;
  if(s._pa && s._pn === p.length) return s;
  const pa = new Path2D();
  const base = s.w || 1.4;
  inkRibbon(pa, p, base, 0, n);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, rmax = 0;
  for(let i=0; i<n; i++){
    const x = p[i*3], y = p[i*3+1], r = inkWidthAt(base, p[i*3+2]) / 2;
    if(x < x0) x0 = x;
    if(y < y0) y0 = y;
    if(x > x1) x1 = x;
    if(y > y1) y1 = y;
    if(r > rmax) rmax = r;
  }
  s._pa = pa; s._pn = p.length;
  s._bb = [x0-rmax, y0-rmax, x1+rmax, y1+rmax];
  return s;
}
const inkDirty = s => { s._pa = null; s._pn = -1; };

/* ---- 三层画布 ----
   dry：已落稿。wet：正在写的这一笔。pred：预测的笔尖延伸。
   注意：这里刻意不用 desynchronized:true。它桌面 Chrome 上能省一次合成排队，
   但在部分设备的 GPU 呈现路径上（夸克 / 某些 Windows·Android 组合）透明画布
   第一次提交就整块呈现成纯黑——「笔一搭上去画布全黑」就是这个。
   低延迟不靠它：出墨走 pointerrawupdate 增量小段，重绘合流到一帧一次，
   普通上下文一样是毫秒级。 */
function inkCtx(cv){
  return cv.getContext("2d");
}
/* 画布尺寸跟着容器走。dpr 封顶 2，再按总像素上限收一收（长卷 + 3x 屏会吃掉几百 MB）*/
function inkResizeCanvases(){
  const st = inkPad; if(!st || !st.wrap) return false;
  const cw = st.wrap.clientWidth, ch = st.wrap.clientHeight;
  if(!cw || !ch) return false;
  let dpr = Math.min(devicePixelRatio || 1, 2);
  while(dpr > 0.75 && cw*ch*dpr*dpr > INK_MAX_CANVAS_PX) dpr -= 0.25;
  const w = Math.round(cw*dpr), h = Math.round(ch*dpr);
  st.cvW = cw; st.cvH = ch; st.dpr = dpr;
  st._rect = st.wrap.getBoundingClientRect();
  if(st.dryC.width === w && st.dryC.height === h) return false;
  for(const cv of [st.dryC, st.wetC, st.predC]){ cv.width = w; cv.height = h; }
  return true;
}
/* 把上下文摆到「内容坐标」上：之后所有绘制都用逻辑单位 */
function inkSetXform(ctx, m, dpr){
  ctx.setTransform(dpr*m.k, 0, 0, dpr*m.k, dpr*m.ox, dpr*m.oy);
}
function inkPaintStrokes(ctx, strokes, clip){
  let alpha = 1, mode = "source-over", fill = "";
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  for(let i=0; i<strokes.length; i++){
    const s = strokes[i];
    if(!s.p || s.p.length < 3) continue;
    inkStrokeGeom(s);
    if(clip){
      const b = s._bb;
      if(b[2] < clip[0] || b[0] > clip[2] || b[3] < clip[1] || b[1] > clip[3]) continue;
    }
    const hl = s.t === "hl";
    const a = hl ? INK_HL_ALPHA : 1;
    const md = hl ? "multiply" : "source-over";
    const c = INK_COLORS[s.c|0] || INK_COLORS[0];
    if(a !== alpha){ ctx.globalAlpha = a; alpha = a; }
    if(md !== mode){ ctx.globalCompositeOperation = md; mode = md; }
    if(c !== fill){ ctx.fillStyle = c; fill = c; }
    ctx.fill(s._pa);
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
}
/* 一页的背景。html 页的背景由 iframe 提供，这里什么都不画（保持透明）。
   clip = 可见区域（页内坐标），无限画布页的底纹必须按它裁着画——
   20000×20000 的点阵是 25 万个点，全画一帧就是几十毫秒的卡顿。 */
function inkPaintBg(ctx, pg, w, h, clip){
  if(!Array.isArray(pg) && pg.bgType === "html") return;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  if(!Array.isArray(pg) && pg.bgType === "image"){
    const img = inkBgImage(pg);
    if(img && img.complete && img.naturalWidth) ctx.drawImage(img, 0, 0, w, h);
    return;
  }
  const grid = Array.isArray(pg) ? "dot" : (pg.grid || "dot");
  if(grid === "none") return;
  const step = 40;
  const gx0 = clip ? Math.max(step, Math.floor(clip[0]/step)*step) : step;
  const gx1 = clip ? Math.min(w, Math.ceil(clip[2]/step)*step) : w;
  const gy0 = clip ? Math.max(step, Math.floor(clip[1]/step)*step) : step;
  const gy1 = clip ? Math.min(h, Math.ceil(clip[3]/step)*step) : h;
  if(grid === "line" || grid === "grid"){
    ctx.strokeStyle = "#e3e8ee"; ctx.lineWidth = 1;
    ctx.beginPath();
    for(let y=gy0; y<gy1; y+=step){ ctx.moveTo(0, y+.5); ctx.lineTo(w, y+.5); }
    if(grid === "grid") for(let x=gx0; x<gx1; x+=step){ ctx.moveTo(x+.5, 0); ctx.lineTo(x+.5, h); }
    ctx.stroke();
    return;
  }
  ctx.fillStyle = "#dde1e7";
  for(let x=gx0; x<gx1; x+=step) for(let y=gy0; y<gy1; y+=step) ctx.fillRect(x-1, y-1, 2, 2);
}
/* 一页里所有笔迹的总包围盒（缩略图/导出无限画布页时取景用） */
function inkInkBB(pg){
  let x0=Infinity, y0=Infinity, x1=-Infinity, y1=-Infinity;
  for(const s of inkStrokesOf(pg, -1)){
    inkStrokeGeom(s);
    const b = s._bb;
    if(!b) continue;
    if(b[0] < x0) x0 = b[0];
    if(b[1] < y0) y0 = b[1];
    if(b[2] > x1) x1 = b[2];
    if(b[3] > y1) y1 = b[3];
  }
  return x1 > -Infinity ? [x0, y0, x1, y1] : null;
}
/* 背景图按需从 nb_files 里取，取到后重画一次。失败也要记下来，
   否则每帧都会重新发起一次 IndexedDB 请求。 */
function inkBgImage(pg){
  if(pg._img !== undefined){
    /* 取不到可能是图片还没从云端同步下来：30 秒后允许重试，而不是永远白纸 */
    if(pg._img !== null || !pg._imgMiss || performance.now() - pg._imgMiss < 30000)
      return pg._img;
    pg._img = undefined; pg._imgMiss = 0;
  }
  pg._img = null;
  const id = pg.bgData;
  if(!id || typeof db === "undefined" || !db) return null;
  try{
    const rq = db.transaction("nb_files","readonly").objectStore("nb_files").get(id);
    rq.onsuccess = e=>{
      const rec = e.target.result;
      if(!rec || !rec.data){ pg._imgMiss = performance.now(); return; }
      const img = new Image();
      img.onload = ()=>{ pg._img = img; inkInvalidate(); inkThumbsRefresh(); };
      img.src = rec.data;
    };
  }catch(e){}
  return null;
}
