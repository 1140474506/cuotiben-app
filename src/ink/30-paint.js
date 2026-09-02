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
   desynchronized 让浏览器可以跳过一次合成排队（Chrome/Edge 在触屏设备上
   实测能省一整帧），代价是 canvas 内容不保证与页面其它部分同帧——对墨迹来说
   正是想要的。alpha:false 不能用：wet/pred 必须透明才能叠在 dry 上。 */
function inkCtx(cv){
  return cv.getContext("2d", {desynchronized:true, alpha:true});
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
/* 一页的背景。html 页的背景由 iframe 提供，这里什么都不画（保持透明） */
function inkPaintBg(ctx, pg, w, h){
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
  if(grid === "line" || grid === "grid"){
    ctx.strokeStyle = "#e3e8ee"; ctx.lineWidth = 1;
    ctx.beginPath();
    for(let y=step; y<h; y+=step){ ctx.moveTo(0, y+.5); ctx.lineTo(w, y+.5); }
    if(grid === "grid") for(let x=step; x<w; x+=step){ ctx.moveTo(x+.5, 0); ctx.lineTo(x+.5, h); }
    ctx.stroke();
    return;
  }
  ctx.fillStyle = "#dde1e7";
  for(let x=step; x<w; x+=step) for(let y=step; y<h; y+=step) ctx.fillRect(x-1, y-1, 2, 2);
}
/* 背景图按需从 nb_files 里取，取到后重画一次。失败也要记下来，
   否则每帧都会重新发起一次 IndexedDB 请求。 */
function inkBgImage(pg){
  if(pg._img !== undefined) return pg._img;
  pg._img = null;
  const id = pg.bgData;
  if(!id || typeof db === "undefined" || !db) return null;
  try{
    const rq = db.transaction("nb_files","readonly").objectStore("nb_files").get(id);
    rq.onsuccess = e=>{
      const rec = e.target.result;
      if(!rec || !rec.data) return;
      const img = new Image();
      img.onload = ()=>{ pg._img = img; inkInvalidate(); inkThumbsRefresh(); };
      img.src = rec.data;
    };
  }catch(e){}
  return null;
}
