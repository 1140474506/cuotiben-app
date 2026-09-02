/* ---- 纸面几何：页尺寸、长卷布局、屏幕↔逻辑坐标 ----
   逻辑坐标分两层：
     · 页内坐标（笔迹存的就是这个）：每页自己的 0..w / 0..h。
     · 内容坐标（画布上排版用的）：把所有页竖着摆开，第 i 页的顶在 top_i，
       水平方向按内容宽居中。两者只差一个平移。
   屏幕 = 内容 × k + (ox, oy)，k = 基准适配倍率 × view.z。
   这样「缩放平移只是看的方式」这条不变量得以保持：笔迹数据永远是页内坐标，
   放大写小字、缩回总览，一个字节都不用改。 */
const INK_PAPER_W = 900;   // bgType:"html" 的纸宽（固定 CSS px，iframe 靠 scale 适配容器）
const INK_NB_W = 1000, INK_NB_H = 1414;   // 笔记本空白页（近似 A4 竖版）

function inkPageW(pg){
  if(Array.isArray(pg)) return INK_W;
  if(pg.bgType === "html") return INK_PAPER_W;
  return pg.w || INK_NB_W;
}
function inkPageH(pg){
  if(Array.isArray(pg)) return INK_H;
  if(pg.bgType === "html") return pg._h || pg.h || 1200;   // _h = iframe 实测高度
  return pg.h || INK_NB_H;
}
/* 长卷布局：返回 {tops:[每页顶部], W:内容宽, H:内容总高} */
function inkLayout(){
  const st = inkPad;
  const pages = st ? st.pages : [];
  const tops = [];
  let y = 0, W = 0;
  for(let i=0; i<pages.length; i++){
    tops.push(y);
    y += inkPageH(pages[i]);
    if(i < pages.length-1) y += INK_GAP;
    W = Math.max(W, inkPageW(pages[i]));
  }
  return {tops, W, H: y};
}
/* 页内坐标 → 内容坐标的原点 */
function inkPageOrigin(i, lay){
  const st = inkPad;
  const pg = st.pages[i];
  return [(lay.W - inkPageW(pg))/2, lay.tops[i]];
}
/* 内容 y 落在哪一页。页间间隙归给上一页（在间隙里落笔 = 接着写上一页的底边） */
function inkPageAtY(cy, lay){
  const st = inkPad;
  for(let i=0; i<st.pages.length; i++){
    const top = lay.tops[i], h = inkPageH(st.pages[i]);
    if(cy < top + h + INK_GAP/2) return i;
  }
  return st.pages.length - 1;
}
/* 基准倍率：第一页整页看得见（一屏≈一页），和旧版的手感一致 */
function inkBaseK(cw, ch, lay){
  const st = inkPad;
  const pg0 = st.pages[0];
  const w0 = inkPageW(pg0) || INK_W, h0 = inkPageH(pg0) || INK_H;
  if(st.fitMode === "width") return cw / (lay.W || w0);
  return Math.min(cw / w0, ch / h0);
}
function inkMap(cw, ch){
  const st = inkPad;
  const lay = st._lay = inkLayout();
  const k = inkBaseK(cw, ch, lay) * st.view.z;
  const ox = (cw - lay.W * k)/2 + st.view.px * k;
  const oy = st.view.py * k;
  return {k, ox, oy, lay};
}
/* 屏幕（相对画布左上）→ 内容坐标 */
function inkToContent(st, clientX, clientY){
  const m = st._map, r = st._rect || (st._rect = st.wrap.getBoundingClientRect());
  if(!m) return [0, -1e9];
  return [(clientX - r.left - m.ox)/m.k, (clientY - r.top - m.oy)/m.k];
}
/* 视野允许的平移范围：纸不能整体划走，上下各留一屏的三分之一 */
function inkClampView(){
  const st = inkPad; if(!st || !st.cvW) return;
  const lay = inkLayout();
  const k = inkBaseK(st.cvW, st.cvH, lay) * st.view.z;
  const visH = st.cvH / k, visW = st.cvW / k;
  const slackY = visH * 0.34, slackX = Math.max(80, visW * 0.3);
  st.view.py = inkClamp(st.view.py, -(lay.H - visH) - slackY, slackY);
  if(lay.H <= visH) st.view.py = inkClamp(st.view.py, -slackY, (visH - lay.H) + slackY);
  st.view.px = inkClamp(st.view.px, -(lay.W + slackX), lay.W + slackX);
}
/* 复位视图：单页放得下就居中，长卷则顶对齐留一点边 */
function inkFitView(){
  const st = inkPad; if(!st) return;
  st.view.z = 1; st.view.px = 0;
  const lay = inkLayout();
  if(!st.cvW){ st.view.py = 0; return; }
  const k = inkBaseK(st.cvW, st.cvH, lay);
  const visH = st.cvH / k;
  st.view.py = lay.H <= visH ? (visH - lay.H)/2 : 8;
  inkClampView();
}
/* 缩放锚在指针处（捏哪里哪里不动） */
function inkZoomAt(clientX, clientY, factor){
  const st = inkPad; if(!st || !st._map) return;
  const nz = inkClamp(st.view.z * factor, 0.25, 8);
  if(Math.abs(nz - st.view.z) < 1e-4) return;
  const [cx, cy] = inkToContent(st, clientX, clientY);
  const r = st._rect;
  const lay = inkLayout();
  st.view.z = nz;
  const k2 = inkBaseK(st.cvW, st.cvH, lay) * nz;
  /* 解 (clientX-r.left) = cx*k2 + (cw - W*k2)/2 + px*k2 */
  st.view.px = ((clientX - r.left) - cx*k2 - (st.cvW - lay.W*k2)/2) / k2;
  st.view.py = ((clientY - r.top) - cy*k2) / k2;
  inkClampView();
  inkInvalidate(); inkZoomLabel();
}
function inkPanBy(dx, dy){
  const st = inkPad; if(!st || !st._map) return;
  st.view.px += dx / st._map.k;
  st.view.py += dy / st._map.k;
  inkClampView();
  inkInvalidate();
}
/* 跳到某页顶部 */
function inkGotoPage(pg){
  const st = inkPad; if(!st) return;
  const lay = inkLayout();
  pg = inkClamp(pg|0, 0, st.pages.length-1);
  st.view.py = -lay.tops[pg] + 8;
  inkClampView();
  st.page = pg;
  inkInvalidate(); inkPageLabel();
}
function inkZoomLabel(){
  if(inkPad) document.querySelectorAll(".ink-zoom").forEach(el=>
    el.textContent = Math.round(inkPad.view.z*100)+"%");
}
function inkPageLabel(){
  const st = inkPad; if(!st) return;
  document.querySelectorAll(".ink-page").forEach(el=>
    el.textContent = `${st.page+1}/${st.pages.length}页`);
}
