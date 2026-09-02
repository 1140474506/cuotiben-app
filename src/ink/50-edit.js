/* ---- 撤销 / 重做 ----
   条目是一个「补丁」：{k:类型, ...}。之所以不再用旧版的 {pg,s,add}，是因为
   套索移动、部分擦除、加页删页都不是「加一条/删一条」，旧结构表达不了，
   Gemini 那版就把它们各自硬塞在别处，撤销栈和真实状态很快就对不上。
   统一成补丁后，撤销 = 反向套一次，重做 = 正向套一次，只有一个入口。 */
const INK_UNDO_MAX = 300;
function inkPush(entry){
  const st = inkPad; if(!st) return;
  st.undo.push(entry);
  if(st.undo.length > INK_UNDO_MAX) st.undo.shift();
  st.redo.length = 0;
  st.dirty = true;
  inkAutoSave();
}
/* 找到补丁作用的那个笔画数组 */
function inkArrOf(en){
  const st = inkPad;
  const pg = st.pages[en.pg];
  if(!pg) return null;
  if(Array.isArray(pg)) return pg;
  const ls = pg.layers || [];
  const l = ls[en.layer|0] || ls[0];
  return l ? l.strokes : null;
}
function inkApply(en, forward){
  const st = inkPad; if(!st) return;
  switch(en.k){
    case "add": {
      const arr = inkArrOf(en); if(!arr) break;
      const i = arr.indexOf(en.s);
      if(forward){ if(i < 0) arr.splice(Math.min(en.at ?? arr.length, arr.length), 0, en.s); }
      else if(i >= 0) arr.splice(i, 1);
      break;
    }
    case "addmany": {      // 套索复制：一次加进来若干条
      const arr = inkArrOf(en); if(!arr) break;
      if(forward){
        const asc = [...en.items].sort((a,b)=>a.at-b.at);
        for(const it of asc) if(arr.indexOf(it.s) < 0) arr.splice(Math.min(it.at, arr.length), 0, it.s);
      }else{
        for(const it of en.items){ const i = arr.indexOf(it.s); if(i >= 0) arr.splice(i, 1); }
      }
      break;
    }
    case "del": {
      const arr = inkArrOf(en); if(!arr) break;
      /* 多条一起删（涂抹橡皮一次扫过），按原下标从小到大插回去才不串位 */
      if(forward){
        for(const it of en.items){ const i = arr.indexOf(it.s); if(i >= 0) arr.splice(i, 1); }
      }else{
        const asc = [...en.items].sort((a,b)=>a.at-b.at);
        for(const it of asc) arr.splice(Math.min(it.at, arr.length), 0, it.s);
      }
      break;
    }
    case "replace": {      // 部分擦除：一条变若干条
      const arr = inkArrOf(en); if(!arr) break;
      if(forward){
        const i = arr.indexOf(en.s);
        if(i >= 0) arr.splice(i, 1, ...en.parts);
      }else{
        let at = arr.indexOf(en.parts[0]);
        for(const q of en.parts){ const i = arr.indexOf(q); if(i >= 0) arr.splice(i, 1); }
        arr.splice(at < 0 ? arr.length : at, 0, en.s);
      }
      break;
    }
    case "move": {         // 套索平移/缩放：直接按记录的坐标写回
      for(const it of en.items){
        const src = forward ? it.to : it.from;
        const p = it.s.p;
        for(let i=0; i<p.length; i++) p[i] = src[i];
        if(it.wTo !== undefined) it.s.w = forward ? it.wTo : it.wFrom;
        inkDirty(it.s);
      }
      break;
    }
    case "recolor": {      // 套索换色
      for(const it of en.items) it.s.c = forward ? it.to : it.from;
      break;
    }
    case "xfer": {         // 套索跨图层/跨页搬运
      const a = inkArrOf({pg:en.pg, layer:en.layer});
      const b = inkArrOf({pg:en.pg2, layer:en.layer2});
      if(!a || !b) break;
      const from = forward ? a : b, to = forward ? b : a;
      for(const s of en.items){
        const i = from.indexOf(s);
        if(i >= 0) from.splice(i, 1);
        if(to.indexOf(s) < 0) to.push(s);
      }
      break;
    }
    case "page": {         // 加页 / 删页
      const add = forward ? en.add : !en.add;
      if(add) st.pages.splice(Math.min(en.at, st.pages.length), 0, en.pg2);
      else{
        const i = st.pages.indexOf(en.pg2);
        if(i >= 0) st.pages.splice(i, 1);
      }
      if(!st.pages.length) st.pages.push(inkNewPage());
      break;
    }
    case "layer": {        // 加图层 / 删图层
      const pg = st.pages[en.pg];
      if(!pg || Array.isArray(pg)) break;
      const add = forward ? en.add : !en.add;
      if(add) pg.layers.splice(Math.min(en.at, pg.layers.length), 0, en.l);
      else{
        const i = pg.layers.indexOf(en.l);
        if(i >= 0) pg.layers.splice(i, 1);
      }
      if(!pg.layers.length) pg.layers.push({id:"l"+Date.now(), name:"图层 1", visible:true, strokes:[]});
      st.activeLayer = inkClamp(st.activeLayer, 0, pg.layers.length-1);
      break;
    }
  }
  /* 改动发生在视野外的页 → 把视野带过去，否则「按了没反应」 */
  if(en.pg !== undefined && en.pg !== st.page && st.pages[en.pg]) inkGotoPage(en.pg);
  st.lasso = null;
  st.dirty = true;
}
function inkUndo(){
  const st = inkPad; if(!st) return;
  const en = st.undo.pop(); if(!en) return;
  inkApply(en, false);
  st.redo.push(en);
  inkInvalidate(); inkSyncBar(); inkAutoSave(); inkThumbsRefresh();
}
function inkRedo(){
  const st = inkPad; if(!st) return;
  const en = st.redo.pop(); if(!en) return;
  inkApply(en, true);
  st.undo.push(en);
  inkInvalidate(); inkSyncBar(); inkAutoSave(); inkThumbsRefresh();
}

/* ---- 命中测试与橡皮 ----
   旧版对每个擦除采样点遍历「所有页 × 所有笔画 × 所有采样点」，还在每次命中后
   同步重画整卷。一页写满几百笔之后，擦一下就是几十万次距离计算 + 几十次全量重绘。
   现在：包围盒先筛（笔画几何里已经算好 _bb），再逐段算距离；一次涂抹期间
   所有删除攒成一个 del 补丁（撤销一次全回来），重绘走 rAF 合流。
   eraseWhole=false 时做部分擦除：把笔画在命中区间处切断，只删中间那一段。 */
function segDist2(px,py, ax,ay, bx,by){
  const dx=bx-ax, dy=by-ay, l2=dx*dx+dy*dy;
  let t = l2 ? ((px-ax)*dx+(py-ay)*dy)/l2 : 0;
  t = t<0?0 : t>1?1 : t;
  return (ax+t*dx-px)**2 + (ay+t*dy-py)**2;
}
function inkEraseRad(pressure){
  const st = inkPad;
  const i = st ? (st.eraser ?? 1) : 1;
  return INK_ERASERS[inkClamp(i,0,INK_ERASERS.length-1)] * (0.75 + 0.5*(pressure||0.4));
}
/* 在页 pi 上以 (x,y) 为圆心、rad 为半径擦一次。命中的删除都记到 batch 里。 */
function inkEraseAt(pi, x, y, rad, batch){
  const st = inkPad;
  const pg = st.pages[pi]; if(!pg) return false;
  const layers = Array.isArray(pg) ? [{strokes:pg, idx:0}]
    : pg.layers.map((l,idx)=>({strokes:l.strokes, idx, visible:l.visible}))
               .filter(l=> l.visible !== false);
  const r2 = rad*rad;
  let hit = false;
  for(const L of layers){
    const arr = L.strokes;
    for(let i=arr.length-1; i>=0; i--){
      const s = arr[i];
      inkStrokeGeom(s);
      const b = s._bb;
      if(x+rad < b[0] || x-rad > b[2] || y+rad < b[1] || y-rad > b[3]) continue;
      const p = s.p, n = (p.length/3)|0;
      /* 逐段找命中的采样点区间 */
      let lo = -1, hi = -1;
      for(let j=0; j<n; j++){
        const jx = p[j*3], jy = p[j*3+1];
        let h = (jx-x)**2 + (jy-y)**2 < r2;
        if(!h && j < n-1) h = segDist2(x, y, jx, jy, p[j*3+3], p[j*3+4]) < r2;
        if(h){ if(lo < 0) lo = j; hi = j; }
      }
      if(lo < 0) continue;
      hit = true;
      if(st.eraseWhole || n <= 2){
        batch.del.push({pg:pi, layer:L.idx, at:i, s});
        arr.splice(i, 1);
        continue;
      }
      /* 部分擦除：保留 [0,lo) 和 (hi,n) 两头，各自至少 2 点才有意义 */
      const parts = [];
      const head = lo >= 2 ? p.slice(0, lo*3) : null;
      const tail = (n - hi - 1) >= 2 ? p.slice((hi+1)*3) : null;
      if(head) parts.push({w:s.w, c:s.c, ...(s.t?{t:s.t}:{}), p:head});
      if(tail) parts.push({w:s.w, c:s.c, ...(s.t?{t:s.t}:{}), p:tail});
      if(!parts.length){
        batch.del.push({pg:pi, layer:L.idx, at:i, s});
        arr.splice(i, 1);
      }else{
        batch.rep.push({pg:pi, layer:L.idx, s, parts});
        arr.splice(i, 1, ...parts);
      }
    }
  }
  return hit;
}
/* 一次擦除笔划（pointerdown→up）攒一个 batch，抬手时统一进撤销栈 */
function inkEraseBatchNew(){ return {del:[], rep:[]}; }
function inkEraseCommit(batch){
  const st = inkPad; if(!st || !batch) return;
  /* replace 补丁按笔画一条条记（它们各自替换的是不同的原笔画） */
  for(const r of batch.rep) st.undo.push({k:"replace", pg:r.pg, layer:r.layer, s:r.s, parts:r.parts});
  /* del 按 (页,图层) 分组，一组一条补丁 */
  const groups = new Map();
  for(const d of batch.del){
    const key = d.pg+"/"+d.layer;
    if(!groups.has(key)) groups.set(key, {k:"del", pg:d.pg, layer:d.layer, items:[]});
    groups.get(key).items.push({s:d.s, at:d.at});
  }
  for(const g of groups.values()) st.undo.push(g);
  if(batch.rep.length || batch.del.length){
    if(st.undo.length > INK_UNDO_MAX) st.undo.splice(0, st.undo.length - INK_UNDO_MAX);
    st.redo.length = 0;
    st.dirty = true;
    inkAutoSave(); inkSyncBar(); inkThumbsRefresh();
  }
}
