/* ---- 套索：圈选 → 拖动 / 缩放 / 删除 / 换色 / 复制 / 换层换页 ----
   选区 = {pg, layer, items:[笔画], poly:[x,y,...], bb:[x0,y0,x1,y1]}。
   拖动、缩放时直接改坐标，抬手时把「动之前 / 动之后的坐标」记成一条 move 补丁，
   撤销就是把 from 写回去。旧版把 origP 挂在选区上、在 pointermove 里引用了一个
   没声明的变量 r（ReferenceError），套索一动整条事件链当场断掉。 */
function inkPointInPoly(x, y, poly){
  let inside = false;
  const n = poly.length/2;
  for(let i=0, j=n-1; i<n; j=i++){
    const xi = poly[i*2], yi = poly[i*2+1], xj = poly[j*2], yj = poly[j*2+1];
    if(((yi > y) !== (yj > y)) && (x < (xj-xi)*(y-yi)/(yj-yi) + xi)) inside = !inside;
  }
  return inside;
}
/* 笔画算不算被圈中：采样点里过半（>=55%）落在多边形内。
   「有一个点在里面就选」太松——套索边缘蹭过一条长横线会把整条拖走。 */
function inkStrokeInPoly(s, poly, pbb){
  inkStrokeGeom(s);
  const b = s._bb;
  if(b[2] < pbb[0] || b[0] > pbb[2] || b[3] < pbb[1] || b[1] > pbb[3]) return false;
  const p = s.p, n = (p.length/3)|0;
  let inCnt = 0;
  for(let i=0; i<n; i++) if(inkPointInPoly(p[i*3], p[i*3+1], poly)) inCnt++;
  return inCnt >= Math.max(1, Math.ceil(n*0.55));
}
function inkItemsBB(items){
  let x0=Infinity, y0=Infinity, x1=-Infinity, y1=-Infinity;
  for(const s of items){
    inkStrokeGeom(s);
    const b = s._bb;
    if(b[0] < x0) x0 = b[0];
    if(b[1] < y0) y0 = b[1];
    if(b[2] > x1) x1 = b[2];
    if(b[3] > y1) y1 = b[3];
  }
  return [x0,y0,x1,y1];
}
function inkLassoEnd(poly){
  const st = inkPad; if(!st) return;
  st.lassoPath = null;
  if(!poly || poly.length < 8){ st.lasso = null; inkInvalidate(); return; }
  let x0=Infinity, y0=Infinity, x1=-Infinity, y1=-Infinity;
  for(let i=0; i<poly.length; i+=2){
    if(poly[i] < x0) x0 = poly[i];
    if(poly[i] > x1) x1 = poly[i];
    if(poly[i+1] < y0) y0 = poly[i+1];
    if(poly[i+1] > y1) y1 = poly[i+1];
  }
  const pi = st.lassoPg ?? st.page;
  const pg = st.pages[pi];
  if(!pg){ st.lasso = null; inkInvalidate(); return; }
  const layer = Array.isArray(pg) ? 0 : inkClamp(st.activeLayer|0, 0, (pg.layers||[]).length-1);
  const arr = Array.isArray(pg) ? pg : (pg.layers[layer] ? pg.layers[layer].strokes : []);
  const items = arr.filter(s => inkStrokeInPoly(s, poly, [x0,y0,x1,y1]));
  if(!items.length){
    st.lasso = null; inkInvalidate();
    toast("套索里没有圈到笔迹");
    return;
  }
  st.lasso = {pg:pi, layer, items, poly, bb:inkItemsBB(items)};
  inkInvalidate(); inkSyncBar();
}
/* 选区命中：0=没碰到，1=在选区里（拖动），2=右下缩放手柄 */
function inkLassoHit(cx, cy, k){
  const st = inkPad, L = st && st.lasso;
  if(!L) return 0;
  const lay = st._lay || inkLayout();
  const [ox, oy] = inkPageOrigin(L.pg, lay);
  const x = cx - ox, y = cy - oy;
  const b = L.bb, kk = Math.max(k || 1, 1e-4);
  const hs = INK_LASSO_HANDLE/kk;
  if(Math.abs(x - b[2]) <= hs && Math.abs(y - b[3]) <= hs) return 2;
  const pad = 8/kk;
  if(x >= b[0]-pad && x <= b[2]+pad && y >= b[1]-pad && y <= b[3]+pad) return 1;
  return 0;
}
/* 拖动/缩放之前先把原坐标存一份，抬手时才知道 from 是什么 */
function inkLassoGrab(){
  const L = inkPad && inkPad.lasso; if(!L) return;
  L._from = L.items.map(s => Array.from(s.p));
  L._w0 = L.items.map(s => s.w);
  L._bb0 = [...L.bb];
  L._poly0 = Array.from(L.poly);
}
function inkLassoMoveBy(dx, dy){
  const L = inkPad && inkPad.lasso; if(!L) return;
  for(const s of L.items){
    const p = s.p;
    for(let i=0; i<p.length; i+=3){ p[i] += dx; p[i+1] += dy; }
    inkDirty(s);
  }
  for(let i=0; i<L.poly.length; i+=2){ L.poly[i] += dx; L.poly[i+1] += dy; }
  L.bb[0]+=dx; L.bb[2]+=dx; L.bb[1]+=dy; L.bb[3]+=dy;
}
/* 缩放：以选区左上角为定点，拖到哪算多大。笔宽跟着缩，不然放大后笔迹变发丝 */
function inkLassoScaleTo(x, y, uniform){
  const L = inkPad && inkPad.lasso; if(!L || !L._from) return;
  const b0 = L._bb0;
  const w0 = Math.max(b0[2]-b0[0], 1), h0 = Math.max(b0[3]-b0[1], 1);
  let sx = (x - b0[0])/w0, sy = (y - b0[1])/h0;
  if(uniform){ const s = Math.max(sx, sy); sx = sy = s; }
  sx = inkClamp(sx, 0.15, 8); sy = inkClamp(sy, 0.15, 8);
  const wk = Math.sqrt(Math.abs(sx*sy)) || 1;
  L.items.forEach((s, n)=>{
    const src = L._from[n], p = s.p;
    for(let i=0; i<p.length; i+=3){
      p[i]   = b0[0] + (src[i]   - b0[0])*sx;
      p[i+1] = b0[1] + (src[i+1] - b0[1])*sy;
    }
    s.w = L._w0[n]*wk;
    inkDirty(s);
  });
  for(let i=0; i<L.poly.length; i+=2){
    L.poly[i]   = b0[0] + (L._poly0[i]   - b0[0])*sx;
    L.poly[i+1] = b0[1] + (L._poly0[i+1] - b0[1])*sy;
  }
  L.bb = [b0[0], b0[1], b0[0]+w0*sx, b0[1]+h0*sy];
}
function inkLassoDrop(){          // 抬手：把这一次位移/缩放记成一条补丁
  const L = inkPad && inkPad.lasso; if(!L || !L._from) return;
  const items = [];
  L.items.forEach((s, n)=>{
    const from = L._from[n], to = Array.from(s.p), w0 = L._w0[n];
    let same = Math.abs(w0 - s.w) < 1e-6;
    if(same) for(let i=0; i<to.length; i++) if(Math.abs(to[i]-from[i]) > 1e-6){ same = false; break; }
    if(!same) items.push({s, from, to, wFrom:w0, wTo:s.w});
  });
  L._from = L._w0 = L._bb0 = L._poly0 = null;
  if(items.length) inkPush({k:"move", pg:L.pg, layer:L.layer, items});
}
function inkPaintLasso(ctx, m){
  const st = inkPad;
  const px = 1/m.k;
  /* 正在圈的那条虚线 */
  if(st.lassoPath && st.lassoPath.length >= 4){
    const [ox, oy] = inkPageOrigin(st.lassoPg ?? st.page, m.lay);
    ctx.save(); ctx.translate(ox, oy);
    ctx.strokeStyle = "#2563eb"; ctx.lineWidth = 1.4*px;
    ctx.setLineDash([6*px, 4*px]);
    ctx.beginPath();
    ctx.moveTo(st.lassoPath[0], st.lassoPath[1]);
    for(let i=2; i<st.lassoPath.length; i+=2) ctx.lineTo(st.lassoPath[i], st.lassoPath[i+1]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
  const L = st.lasso; if(!L) return;
  const [ox, oy] = inkPageOrigin(L.pg, m.lay);
  ctx.save();
  ctx.translate(ox, oy);
  const pad = 6*px;
  const x = L.bb[0]-pad, y = L.bb[1]-pad, w = L.bb[2]-L.bb[0]+2*pad, h = L.bb[3]-L.bb[1]+2*pad;
  ctx.fillStyle = "rgba(37,99,235,.07)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#2563eb"; ctx.lineWidth = 1.6*px;
  ctx.setLineDash([7*px, 5*px]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
  const hs = INK_LASSO_HANDLE*px*0.72;      // 右下缩放手柄
  ctx.fillStyle = "#fff";
  ctx.lineWidth = 1.8*px;
  ctx.beginPath();
  ctx.arc(L.bb[2], L.bb[3], hs, 0, INK_TAU);
  ctx.fill(); ctx.stroke();
  ctx.restore();
}
/* ---- 选区操作 ---- */
/* 套索截图：把选区从干层（纸 + 墨）上裁下来。
   复制走 clipboard API（WebView/老浏览器不支持时自动落回保存），
   保存走 blob 下载（APP 里经下载桥存进系统「下载」）。裁的是选区框
   （strokes 包围盒 + 一圈留白），不是画的圈本身——和屏幕上看到的虚线框一致。 */
async function inkLassoShot(save){
  const st = inkPad;
  if(!st || !st.lasso || !st._map){ toast("先圈选一块笔迹"); return; }
  const bb = st.lasso.bb;
  if(!bb || bb[2]-bb[0] < 4 || bb[3]-bb[1] < 4){ toast("选区太小了"); return; }
  const m = st._map, dpr = st.dpr;
  const [ox, oy] = inkPageOrigin(st.lasso.pg, m.lay);
  const pad = 16;                                     // 页内坐标 → 屏幕坐标（canvas CSS px）
  const x0 = (ox + bb[0] - pad) * m.k + m.ox, y0 = (oy + bb[1] - pad) * m.k + m.oy;
  const w = (bb[2]-bb[0] + pad*2) * m.k, h = (bb[3]-bb[1] + pad*2) * m.k;
  if(w < 4 || h < 4){ toast("选区太小了"); return; }
  const z = Math.min(3, 1400 / Math.max(w, h));       // 长边补到 ~1400px，别超采
  const cv = document.createElement("canvas");
  cv.width = Math.round(w*z); cv.height = Math.round(h*z);
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(st.dryC, x0*dpr, y0*dpr, w*dpr, h*dpr, 0, 0, cv.width, cv.height);
  cv.toBlob(async blob=>{
    if(!blob){ toast("截图失败"); return; }
    if(!save && typeof ClipboardItem !== "undefined" && navigator.clipboard){
      try{
        await navigator.clipboard.write([new ClipboardItem({"image/png": blob})]);
        toast("已复制，去聊天或笔记里直接粘贴");
        return;
      }catch(e){ toast("这台设备不让复制图片，改为保存"); }
    }
    appDownload(blob, `错题截图_${new Date().toISOString().slice(0,10)}.png`, "image/png");
    toast("截图已保存");
  }, "image/png");
}
function inkLassoDelete(){
  const st = inkPad, L = st && st.lasso; if(!L) return;
  const arr = inkArrOf({pg:L.pg, layer:L.layer}); if(!arr) return;
  const items = [];
  for(const s of L.items){
    const i = arr.indexOf(s);
    if(i >= 0){ items.push({s, at:i}); arr.splice(i, 1); }
  }
  st.lasso = null;
  if(items.length) inkPush({k:"del", pg:L.pg, layer:L.layer, items});
  inkInvalidate(); inkSyncBar(); inkThumbsRefresh();
}
function inkLassoColor(ci){
  const st = inkPad, L = st && st.lasso; if(!L) return;
  const items = L.items.map(s=>({s, from:s.c|0, to:ci}));
  for(const s of L.items) s.c = ci;
  inkPush({k:"recolor", pg:L.pg, layer:L.layer, items});
  inkInvalidate(); inkThumbsRefresh();
}
function inkLassoDup(){
  const st = inkPad, L = st && st.lasso; if(!L) return;
  const arr = inkArrOf({pg:L.pg, layer:L.layer}); if(!arr) return;
  const D = 26;
  const copies = L.items.map(s=>{
    const q = inkPlainStroke(s);
    q.p = Array.from(s.p);
    for(let i=0; i<q.p.length; i+=3){ q.p[i] += D; q.p[i+1] += D; }
    return q;
  });
  const items = [];
  for(const q of copies){ items.push({s:q, at:arr.length}); arr.push(q); }
  inkPush({k:"addmany", pg:L.pg, layer:L.layer, items});
  st.lasso = {pg:L.pg, layer:L.layer, items:copies,
              poly:L.poly.map(v=> v + D),
              bb:[L.bb[0]+D, L.bb[1]+D, L.bb[2]+D, L.bb[3]+D]};
  inkInvalidate(); inkSyncBar(); inkThumbsRefresh();
}
/* 搬到另一个图层（笔记本里常用：把批注挪到批注层） */
function inkLassoToLayer(li){
  const st = inkPad, L = st && st.lasso; if(!L) return;
  const pg = st.pages[L.pg];
  if(Array.isArray(pg) || !pg.layers || !pg.layers[li] || li === L.layer) return;
  const from = pg.layers[L.layer].strokes, to = pg.layers[li].strokes;
  for(const s of L.items){
    const i = from.indexOf(s);
    if(i >= 0) from.splice(i, 1);
    if(to.indexOf(s) < 0) to.push(s);
  }
  inkPush({k:"xfer", pg:L.pg, layer:L.layer, pg2:L.pg, layer2:li, items:[...L.items]});
  st.lasso = {...L, layer:li};
  inkInvalidate(); inkSyncBar(); inkThumbsRefresh();
}
/* 搬到另一页（跨页整理笔记） */
function inkLassoToPage(pi){
  const st = inkPad, L = st && st.lasso; if(!L || pi === L.pg || !st.pages[pi]) return;
  const a = inkArrOf({pg:L.pg, layer:L.layer}), b = inkArrOf({pg:pi, layer:0});
  if(!a || !b) return;
  for(const s of L.items){
    const i = a.indexOf(s);
    if(i >= 0) a.splice(i, 1);
    if(b.indexOf(s) < 0) b.push(s);
  }
  inkPush({k:"xfer", pg:L.pg, layer:L.layer, pg2:pi, layer2:0, items:[...L.items]});
  st.lasso = null;
  inkGotoPage(pi);
  inkInvalidate(); inkSyncBar(); inkThumbsRefresh();
}

/* ---- 形状整形：一笔写完如果像直线 / 圆 / 矩形，就地换成规整图形 ----
   只在「整形」开关打开时生效，且要求一笔画完、足够大。汉字笔画短、方向多变、
   首尾离得远，不会被误判成图形。 */
function inkRecognize(s){
  const p = s.p, n = (p.length/3)|0;
  if(n < 6) return null;
  let len = 0, x0=Infinity, y0=Infinity, x1=-Infinity, y1=-Infinity, vSum = 0;
  for(let i=0; i<n; i++){
    const x = p[i*3], y = p[i*3+1];
    if(x<x0) x0=x; if(x>x1) x1=x; if(y<y0) y0=y; if(y>y1) y1=y;
    vSum += p[i*3+2];
    if(i) len += Math.hypot(x - p[i*3-3], y - p[i*3-2]);
  }
  const w = x1-x0, h = y1-y0, diag = Math.hypot(w, h);
  if(diag < 34 || len < 40) return null;
  const ex = p[0], ey = p[1], fx = p[(n-1)*3], fy = p[(n-1)*3+1];
  const gap = Math.hypot(fx-ex, fy-ey);
  const v = vSum/n;
  const mk = pts => { const q = {w:s.w, c:s.c, p:pts}; if(s.t) q.t = s.t; return q; };
  if(len < gap*1.10){                              // 直线：路径长≈首尾距离
    const out = [];
    for(let i=0;i<=12;i++) out.push(ex + (fx-ex)*i/12, ey + (fy-ey)*i/12, v);
    return mk(out);
  }
  if(gap > diag*0.30) return null;                 // 没闭合，既不是圈也不是框
  const rectPeri = 2*(w+h), circPeri = Math.PI*(w+h)/2;
  const aspect = Math.max(w,h)/Math.max(1, Math.min(w,h));
  if(Math.abs(len - circPeri) < Math.abs(len - rectPeri) && aspect < 2.4){
    const cx = (x0+x1)/2, cy = (y0+y1)/2, rx = w/2, ry = h/2, out = [];
    for(let i=0;i<=44;i++){ const a = i/44*INK_TAU; out.push(cx + rx*Math.cos(a), cy + ry*Math.sin(a), v); }
    return mk(out);
  }
  if(Math.abs(len - rectPeri) < rectPeri*0.24){
    const out = [], cor = [[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]];
    for(let i=0;i<4;i++){
      const [ax,ay] = cor[i], [bx,by] = cor[i+1];
      for(let t=0;t<=6;t++) out.push(ax+(bx-ax)*t/6, ay+(by-ay)*t/6, v);
    }
    return mk(out);
  }
  return null;
}


