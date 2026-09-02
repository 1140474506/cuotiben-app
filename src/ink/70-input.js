/* ---- 指针采集：一条笔画从落笔到入账 ----
   延迟路径上只做三件事：算坐标 → 抽稀/平滑 → 往 wet 层补画新的一小段。
   dry 层在整条笔画期间一个像素都不动，抬笔那一刻才同步重绘一次（先画 dry
   再清 wet，中间不留空帧，所以看不到闪）。

   事件用 pointerrawupdate（Chromium 上比 pointermove 早一个合成周期到达），
   拿不到就退回 pointermove；两者都用 getCoalescedEvents 把系统攒下的采样点
   全取出来——旧版每次 move 只画一段，快写必断线。
   getPredictedEvents 画在 pred 层：笔尖前方补一小截预测墨迹，抬笔即擦掉，
   视觉延迟再降一档（Chrome 在触屏设备上给的预测一般是 1~2 帧）。

   笔画在 pointerup 才写进 st.pages。所以「手掌先落笔后到」「写着写着第二根
   手指落下」这些情况直接把未完成的笔丢掉即可，不用事后从数据里抠——旧版
   抠不干净（还会连带 pop 掉别人的撤销条目），这是乱的根源之一。 */
const INK_HAS_RAW = typeof window !== "undefined" && "onpointerrawupdate" in window;
const INK_TAP_MS = 260;      // 双指轻点（撤销）的时间窗
const INK_TAP_SLOP = 12;

/* 屏幕坐标 → 内容坐标 → 页内坐标。返回 [页号, 页内x, 页内y] */
function inkHitPage(st, clientX, clientY, allowGrow){
  const [cx, cy] = inkToContent(st, clientX, clientY);
  const lay = st._lay || inkLayout();
  const inf = st.pages.length === 1 && !Array.isArray(st.pages[0]) && !!st.pages[0].infinite;
  if(cy < -INK_GAP && !inf) return null;        // 纸上方，不写（无限画布没有「上方」）
  let pi = inkPageAtY(cy, lay);
  const last = st.pages.length - 1;
  const lastBottom = lay.tops[last] + inkPageH(st.pages[last]);
  /* 写到纸尾之外：连续书写自动长出新页（只有数组页/空白页能长） */
  if(allowGrow && cy > lastBottom + INK_GAP/2 && st.autoGrow){
    if(st.pages.length >= INK_MAX_PAGES) return null;
    st.pages.push(inkNewPage());
    st._lay = inkLayout();
    inkSyncBar(); inkThumbsRefresh();
    return inkHitPage(st, clientX, clientY, false);
  }
  const [ox, oy] = inkPageOrigin(pi, st._lay || lay);
  /* 纸外不落笔：有边界的纸（A4/PDF/图片页）水平方向超出纸面就不写，
    否则笔迹悬在纸旁边的空白里、橡皮还不好找。垂直方向：页顶以上不写（原有
    规则），页底以下由上面的自动加页接手。无限画布页没有"纸外"。 */
  const pgT = st.pages[pi];
  if(!Array.isArray(pgT) && !pgT.infinite){
    const w2 = inkPageW(pgT), h2 = inkPageH(pgT);
    const px = cx - ox, py = cy - oy;
    if(px < -16 || px > w2 + 16 || py < -16 || py > h2 + INK_GAP/2) return null;
  }
  return [pi, cx - ox, cy - oy];
}
/* 采样点的宽度因子：压感 × 速度 × 倾角 */
function inkSampleV(st, e, x, y, t){
  const pv = inkPressV(e.pressure);
  const L = st._vLast;
  let sp = 0;
  if(L){
    const dt = Math.max(1, t - L.t);
    sp = Math.hypot(x - L.x, y - L.y) / dt;
  }
  st._vLast = {x, y, t};
  return inkClamp(pv * inkSpeedF(sp) * inkTiltF(e), 0.12, 1.9);
}
/* 往当前笔画追加一个采样点。抽稀（间距 < INK_MIN_STEP 只更新宽度）+
   速度自适应低通：慢写多平滑（去手抖），快写少平滑（不拖尾、不切角）。
   平滑放在采集端，所以 wet 层画的和抬笔后 dry 层画的是同一串点，抬笔不跳形。 */
function inkPushPoint(st, x, y, v){
  const cur = st.cur, p = cur.p;
  const n = (p.length/3)|0;
  if(!n){ p.push(x, y, v); return true; }
  const lx = p[(n-1)*3], ly = p[(n-1)*3+1];
  const d = Math.hypot(x - lx, y - ly);
  const step = INK_MIN_STEP / Math.max(st._map ? st._map.k : 1, 0.25);
  if(d < step){
    p[(n-1)*3+2] = (p[(n-1)*3+2] + v)/2;    // 原地抖动只更新宽度，不堆点
    return false;
  }
  /* d 越大（写得越快）α 越接近 1，几乎不平滑 */
  const a = inkClamp(d/14, 0.30, 1);
  p.push(lx + (x-lx)*a, ly + (y-ly)*a, v);
  return true;
}
/* 直尺/角度吸附：按住 shift 或开了 snapAngle 时，把当前点吸到相对起点的整角上 */
function inkSnapAngle(st, x0, y0, x, y){
  const dx = x - x0, dy = y - y0;
  const len = Math.hypot(dx, dy);
  if(len < 1) return [x, y];
  const step = Math.PI/12;                     // 15°
  let a = Math.atan2(dy, dx);
  const sn = Math.round(a/step)*step;
  if(Math.abs(a - sn)*180/Math.PI > INK_RULER_SNAP) return [x, y];
  return [x0 + Math.cos(sn)*len, y0 + Math.sin(sn)*len];
}
function inkNewStroke(st, v){
  const hl = st.tool === "highlighter";
  const base = hl ? inkClamp(st.hlW, 4, 48) : inkClamp(st.penW, 0.6, 6);
  const s = {w:base, c: hl ? (st.hlColor|0) : (st.color|0), p:[]};
  if(hl) s.t = "hl";
  return s;
}
/* 抬笔：整形 → 写进数据 → dry 重绘 → 清 wet。顺序不能反，反了会闪白。 */
function inkCommitStroke(){
  const st = inkPad;
  const cur = st.cur;
  st.cur = null;
  st._vLast = null;
  inkPredClear();
  if(!cur || cur.p.length < 3){ inkWetClear(); return; }
  const pi = inkClamp(st._curPgIdx|0, 0, st.pages.length-1);
  const pg = st.pages[pi];
  let s = cur;
  if(st.snap && st.tool !== "highlighter"){
    const shaped = inkRecognize(cur);
    if(shaped) s = shaped;
  }
  const arr = inkTargetStrokes(pg);
  const layer = Array.isArray(pg) ? 0 : inkClamp(st.activeLayer|0, 0, pg.layers.length-1);
  arr.push(s);
  inkPush({k:"add", pg:pi, layer, s, at:arr.length-1});
  st.strokeCount = (st.strokeCount|0) + 1;
  /* 落稿：以前这里同步跑一次整卷重画（inkRender），一页 PDF 背景图就是
     几百万像素的缩放，抬笔那一下明显顿一下。改成排一帧：wet 层先留着显示
     （所以不会闪空），dry 画完后在 inkRender 末尾统一清掉 wet。 */
  st._wetPending = true;
  inkInvalidate();
  inkThumbsRefresh();
  if(st.undo.length === 1) inkSyncBar();     // 第一笔之后撤销键该亮起来
}
/* 丢弃正在写的笔（手掌误触仲裁失败 / 第二指落下 / pointercancel） */
function inkAbortStroke(){
  const st = inkPad; if(!st) return;
  st.cur = null; st._vLast = null;
  inkWetClear(); inkPredClear();
}
/* 橡皮：沿着上一个点到当前点的连线补点擦，快速划过不留洞。
   一次涂抹（按下到抬起）攒一个 batch，抬手时统一进撤销栈（撤一次全回来）。 */
function inkEraseContent(cx, cy, rad, batch){
  const st = inkPad;
  const lay = st._lay || inkLayout();
  let hit = false;
  for(let i=0; i<st.pages.length; i++){
    const pg = st.pages[i];
    const [ox, oy] = inkPageOrigin(i, lay);
    /* 不能按页矩形预裁：写到纸外的笔迹（历史数据、页缝里的）包围盒在矩形
       之外，整页被跳过就成了"橡皮擦不掉"。页内的粗筛交给 inkEraseAt 里
       每条笔画的包围盒判定，它本来就是 O(笔画) 的。 */
    if(inkEraseAt(i, cx-ox, cy-oy, rad, batch)) hit = true;
  }
  return hit;
}
function inkEraseTo(st, cx, cy, rad, batch){
  const L = st._eraseLast;
  let hit = false;
  if(L){
    const d = Math.hypot(cx-L[0], cy-L[1]);
    const steps = Math.min(24, Math.floor(d/(rad*0.7)));
    for(let i=1; i<=steps; i++){
      const t = i/(steps+1);
      if(inkEraseContent(L[0]+(cx-L[0])*t, L[1]+(cy-L[1])*t, rad, batch)) hit = true;
    }
  }
  if(inkEraseContent(cx, cy, rad, batch)) hit = true;
  st._eraseLast = [cx, cy];
  return hit;
}
/* ---- 橡皮光标圈 / 长按进度圈：两个 fixed 的 div，不碰画布，零重绘开销 ---- */
let inkCursorEl = null;
function inkCursor(e, rad){
  if(!inkCursorEl){
    inkCursorEl = document.createElement("div");
    inkCursorEl.className = "ink-cursor";
    document.body.appendChild(inkCursorEl);
  }
  const st = inkPad;
  if(!e || !st || !st._map){ inkCursorEl.style.display = "none"; return; }
  const d = 2*rad*st._map.k;
  inkCursorEl.style.display = "block";
  inkCursorEl.style.width = inkCursorEl.style.height = d+"px";
  inkCursorEl.style.left = e.clientX+"px";
  inkCursorEl.style.top = e.clientY+"px";
}
let inkHoldEl = null;
function inkHoldRing(show, x, y){
  if(!inkHoldEl){
    inkHoldEl = document.createElement("div");
    inkHoldEl.className = "ink-holdring";
    document.body.appendChild(inkHoldEl);
  }
  if(!show){ inkHoldEl.style.display = "none"; inkHoldEl.classList.remove("grow"); return; }
  inkHoldEl.classList.remove("grow");
  inkHoldEl.style.left = x+"px"; inkHoldEl.style.top = y+"px";
  inkHoldEl.style.display = "block";
  requestAnimationFrame(()=> inkHoldEl.classList.add("grow"));
}
/* ---- 事件接线（挂在 .inkwrap 上，三层画布都是 pointer-events:none） ---- */
function inkWireWrap(wrap){
  const touch = new Map();          // 活跃的 touch 指针：id → [x,y]
  let pinch = null;                 // {d, mx, my}
  let gest = null;                  // 双指/三指轻点识别：{max, moved, t0}
  let drawId = -1;                  // 正在出墨的指针
  let eraseId = -1, batch = null;
  let panId = -1, panLast = null;
  let lassoId = -1, lassoMode = 0;  // 1=画圈 2=拖动 3=缩放
  let holdT = 0, holdRingT = 0, holdAt = null, holdErasing = false;
  const st_ = () => inkPad;

  const cancelHold = ()=>{
    clearTimeout(holdT); clearTimeout(holdRingT);
    holdT = holdRingT = 0; holdAt = null;
    inkHoldRing(false);
  };
  /* 笔尖按住不动 ≈0.6s → 原地变橡皮，抬笔恢复。
     联想/MPP 一类的笔在浏览器里笔尾和笔尖报得一模一样，物理橡皮头检测不到，
     长按是这类设备上唯一可靠的临时橡皮路径。 */
  const startHold = ev=>{
    if(!INK_HOLD_MS) return;
    holdAt = {x:ev.clientX, y:ev.clientY};
    holdRingT = setTimeout(()=>{ if(holdT && holdAt){ inkHoldRing(true, holdAt.x, holdAt.y); inkHaptic(18); } }, 170);
    holdT = setTimeout(()=>{
      holdT = 0; inkHoldRing(false);
      const st = st_(); if(!st || drawId < 0) return;
      inkAbortStroke();                     // 按住期间蹭出的墨点一起丢掉
      drawId = -1;
      eraseId = ev.pointerId; holdErasing = true;
      batch = inkEraseBatchNew();
      st._eraseLast = null;
      const rad = inkEraseRad(0.5);
      const [cx, cy] = inkToContent(st, holdAt.x, holdAt.y);
      if(inkEraseTo(st, cx, cy, rad, batch)) inkInvalidate();
      inkCursor({clientX:holdAt.x, clientY:holdAt.y}, rad);
    }, INK_HOLD_MS);
  };
  const isPenEraser = e => e.pointerType === "pen" &&
    (e.button === 5 || e.button === 2 || e.buttons === 32 || e.buttons === 2);
  const wantErase = (st, e) => st.tool === "erase" || isPenEraser(e);

  wrap.addEventListener("pointerdown", e=>{
    const st = st_(); if(!st) return;
    st._rect = wrap.getBoundingClientRect();
    if(!st._map) inkRender();
    if(e.pointerType === "pen" || e.pointerType === "mouse"){
      inkNotePen(); inkPenDown = true;
      touch.clear(); pinch = null; gest = null;   // 手掌可能先到，把它的手势状态清掉
      if(panId >= 0){ panId = -1; panLast = null; }
    }else{
      touch.set(e.pointerId, [e.clientX, e.clientY]);
      gest = gest || {max:0, moved:false, t0:performance.now()};
      gest.max = Math.max(gest.max, touch.size);
      if(inkPenDown) return;                       // 笔在写：手一律不存在
      if(touch.size >= 2){
        /* 第二指落下 → 手势。正在写的手指笔画：内容够多就当写完，
           刚起笔就整条丢掉（那是捏合的第一指）。绝不会丢已经写出来的字。 */
        if(drawId >= 0){
          const young = performance.now() - (st._curT0||0) < INK_ARB_MS*4;
          if(young || !st.cur || st.cur.p.length < 12) inkAbortStroke();
          else inkCommitStroke();
          drawId = -1;
        }
        if(panId >= 0){ panId = -1; panLast = null; }
        cancelHold();
        pinch = null;
        return;
      }
    }
    if(touch.size >= 2) return;
    const isTouch = e.pointerType === "touch";
    /* 手指到底出墨还是平移 */
    if(isTouch && !inkTouchInk(e)){
      if(st.fingerPan && !inkPenDown && !inkIsPalm(e)){
        panId = e.pointerId; panLast = [e.clientX, e.clientY];
        try{ wrap.setPointerCapture(e.pointerId); }catch(err){}
      }
      return;
    }
    try{ wrap.setPointerCapture(e.pointerId); }catch(err){}
    if(st.tool === "pan"){
      panId = e.pointerId; panLast = [e.clientX, e.clientY];
      return;
    }
    /* 橡皮（工具栏选中 or 笔尾/侧键） */
    if(wantErase(st, e)){
      eraseId = e.pointerId;
      st.eraserEnd = isPenEraser(e);
      batch = inkEraseBatchNew();
      st._eraseLast = null;
      const rad = inkEraseRad(e.pressure);
      const [cx, cy] = inkToContent(st, e.clientX, e.clientY);
      if(inkEraseTo(st, cx, cy, rad, batch)) inkInvalidate();
      inkCursor(e, rad);
      return;
    }
    if(st.tool === "lasso"){
      const [cx, cy] = inkToContent(st, e.clientX, e.clientY);
      const hit = inkLassoHit(cx, cy, st._map ? st._map.k : 1);
      lassoId = e.pointerId;
      if(hit){
        lassoMode = hit === 2 ? 3 : 2;
        inkLassoGrab();
        st._lassoFrom = [cx, cy];
      }else{
        lassoMode = 1;
        const h = inkHitPage(st, e.clientX, e.clientY, false);
        if(!h){ lassoId = -1; lassoMode = 0; return; }
        st.lasso = null;
        st.lassoPg = h[0];
        st.lassoPath = [h[1], h[2]];
        inkInvalidate();
      }
      return;
    }
    /* 落笔 */
    const h = inkHitPage(st, e.clientX, e.clientY, true);
    if(!h) return;
    if(e.pointerType === "pen") inkHaptic(8);   // 落笔轻震一下，像笔尖碰到纸
    const v = inkSampleV(st, e, h[1], h[2], e.timeStamp || performance.now());
    st._curPgIdx = h[0];
    st._curT0 = performance.now();
    if(st._wetPending){ inkWetClear(); st._wetPending = false; }   // 极快连写：上一笔的 wet 还没被 rAF 清掉
    st.cur = inkNewStroke(st, v);
    st.cur.p.push(h[1], h[2], v);
    st._penStart = [h[1], h[2]];
    drawId = e.pointerId;
    if(st.page !== h[0]){ st.page = h[0]; inkPageLabel(); inkThumbSelect(); }
    inkWetSeg(st.cur, 0);
    if(e.pointerType !== "touch") startHold(e);
  });
  /* move 的主体。rawupdate 和 move 共用；rawupdate 可用时 move 只处理
     「不出墨的那些分支」（手势/橡皮光标），出墨完全交给 rawupdate。 */
  const onMove = (e, raw)=>{
    const st = st_(); if(!st) return;
    if(e.pointerType === "pen") inkNotePen();
    if(holdAt && Math.hypot(e.clientX-holdAt.x, e.clientY-holdAt.y) > INK_HOLD_SLOP) cancelHold();
    /* 双指手势 */
    if(e.pointerType === "touch" && touch.has(e.pointerId)){
      touch.set(e.pointerId, [e.clientX, e.clientY]);
      if(gest) gest.moved = true;
      if(touch.size >= 2){
        const pts = [...touch.values()];
        const d = Math.hypot(pts[1][0]-pts[0][0], pts[1][1]-pts[0][1]);
        const mx = (pts[0][0]+pts[1][0])/2, my = (pts[0][1]+pts[1][1])/2;
        if(pinch && pinch.d > 6){
          if(Math.abs(mx-pinch.mx) > 0.01 || Math.abs(my-pinch.my) > 0.01) inkPanBy(mx-pinch.mx, my-pinch.my);
          const f = d/pinch.d;
          if(Math.abs(f-1) > 0.002) inkZoomAt(mx, my, f);
        }
        pinch = {d, mx, my};
        return;
      }
    }
    if(e.pointerId === panId){
      if(panLast) inkPanBy(e.clientX-panLast[0], e.clientY-panLast[1]);
      panLast = [e.clientX, e.clientY];
      return;
    }
    if(e.pointerId === eraseId){
      const rad = inkEraseRad(e.pressure);
      inkCursor(e, rad);
      const [cx, cy] = inkToContent(st, e.clientX, e.clientY);
      if(inkEraseTo(st, cx, cy, rad, batch)) inkInvalidate();
      return;
    }
    /* 悬停也显示橡皮圈：看得见橡皮在不在、多大 */
    if(eraseId < 0 && drawId < 0 && (st.tool === "erase" || isPenEraser(e))) inkCursor(e, inkEraseRad(e.pressure));
    if(e.pointerId === lassoId){
      const [cx, cy] = inkToContent(st, e.clientX, e.clientY);
      if(lassoMode === 1 && st.lassoPath){
        const lay = st._lay || inkLayout();
        const [ox, oy] = inkPageOrigin(st.lassoPg, lay);
        const x = cx-ox, y = cy-oy, n = st.lassoPath.length;
        if(Math.hypot(x-st.lassoPath[n-2], y-st.lassoPath[n-1]) > 2.5){ st.lassoPath.push(x, y); inkInvalidate(); }
      }else if(lassoMode === 2 && st._lassoFrom){
        inkLassoMoveBy(cx-st._lassoFrom[0], cy-st._lassoFrom[1]);
        st._lassoFrom = [cx, cy];
        inkInvalidate();
      }else if(lassoMode === 3){
        const lay = st._lay || inkLayout();
        const [ox, oy] = inkPageOrigin(st.lasso.pg, lay);
        inkLassoScaleTo(cx-ox, cy-oy, e.shiftKey);
        inkInvalidate();
      }
      return;
    }
    if(e.pointerId !== drawId || !st.cur) return;
    /* ---- 出墨热路径 ---- */
    const lay = st._lay || inkLayout();
    const [ox, oy] = inkPageOrigin(st._curPgIdx, lay);
    const m = st._map, r = st._rect;
    if(!m || !r) return;
    const n0 = (st.cur.p.length/3)|0;
    let evs = (raw || e.type === "pointermove") && e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    if(!evs || !evs.length) evs = [e];
    const line = st.tool === "line";
    for(const ev of evs){
      let x = (ev.clientX - r.left - m.ox)/m.k - ox;
      let y = (ev.clientY - r.top - m.oy)/m.k - oy;
      const v = inkSampleV(st, ev, x, y, ev.timeStamp || performance.now());
      if(line){
        const s0 = st._penStart;
        if(ev.shiftKey || st.snapAngle) [x, y] = inkSnapAngle(st, s0[0], s0[1], x, y);
        st.cur.p.length = 3;
        st.cur.p.push(x, y, v);
      }else{
        if(ev.shiftKey && st._penStart) [x, y] = inkSnapAngle(st, st._penStart[0], st._penStart[1], x, y);
        inkPushPoint(st, x, y, v);
      }
    }
    if(line){ inkWetRedraw(st.cur); }
    else{
      const n1 = (st.cur.p.length/3)|0;
      if(n1 > n0) inkWetSeg(st.cur, Math.max(0, n0-1));
    }
    /* 预测点：只画一小截，抬笔/下一帧覆盖。给的是原始屏幕坐标，不进数据。 */
    if(!line && st.predict && e.getPredictedEvents){
      const pe = e.getPredictedEvents();
      /* 只在「有预测点」或「上次画过」时清：全画布 clearRect 在 120Hz 笔 +
         retina 画布上是每秒几亿像素的无用功，这是手写延迟的主要来源之一。 */
      if((pe && pe.length) || st._predBB) inkPredClear();
      if(pe && pe.length){
        const p = st.cur.p, n = (p.length/3)|0;
        const tail = [p[(n-1)*3], p[(n-1)*3+1], p[(n-1)*3+2]];
        for(const pv of pe){
          tail.push((pv.clientX - r.left - m.ox)/m.k - ox, (pv.clientY - r.top - m.oy)/m.k - oy, p[(n-1)*3+2]);
        }
        const ctx = st.predX;
        inkSetXform(ctx, m, st.dpr);
        ctx.translate(ox, oy);
        ctx.globalAlpha = st.cur.t === "hl" ? INK_HL_ALPHA : 1;
        ctx.fillStyle = INK_COLORS[st.cur.c|0] || INK_COLORS[0];
        const pa = new Path2D();
        inkRibbon(pa, tail, st.cur.w, 0, (tail.length/3)|0);
        ctx.fill(pa);
        ctx.globalAlpha = 1;
        /* 记下这一小截的设备像素包围盒，下次只清这块 */
        let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
        for(let i = 0; i < tail.length; i += 3){
          if(tail[i] < bx0) bx0 = tail[i];
          if(tail[i] > bx1) bx1 = tail[i];
          if(tail[i+1] < by0) by0 = tail[i+1];
          if(tail[i+1] > by1) by1 = tail[i+1];
        }
        const dp = st.dpr, pad = (st.cur.w * 2 + 8) * m.k * dp;
        const dx = px2 => ((px2 + ox) * m.k + m.ox) * dp;
        const dy = py2 => ((py2 + oy) * m.k + m.oy) * dp;
        st._predBB = [Math.max(0, dx(bx0) - pad), Math.max(0, dy(by0) - pad),
                      Math.min(st.predC.width, dx(bx1) + pad),
                      Math.min(st.predC.height, dy(by1) + pad)];
      }
    }
  };
  if(INK_HAS_RAW) wrap.addEventListener("pointerrawupdate", e=> onMove(e, true));
  wrap.addEventListener("pointermove", e=>{
    if(INK_HAS_RAW && e.pointerId === drawId) return;    // 出墨已由 rawupdate 处理
    onMove(e, false);
  });
  const onUp = (e, cancelled)=>{
    const st = st_(); if(!st) return;
    cancelHold();
    if(e.pointerType === "touch"){
      const had = touch.delete(e.pointerId);
      if(touch.size < 2) pinch = null;
      /* 双指轻点 = 撤销，三指轻点 = 重做（GoodNotes/Notability 的约定）。
         要求：两指都没怎么动、时间短、期间没有出墨。 */
      if(had && !touch.size && gest){
        const quick = performance.now() - gest.t0 < INK_TAP_MS;
        if(quick && !gest.moved && drawId < 0 && eraseId < 0){
          if(gest.max === 2) inkUndo();
          else if(gest.max >= 3) inkRedo();
        }
        gest = null;
      }
      if(e.pointerId === panId){ panId = -1; panLast = null; }
      if(inkPenDown) return;
    }else{
      inkPenDown = false;
      inkPenUpAt = performance.now();
    }
    if(e.pointerId === panId){ panId = -1; panLast = null; }
    if(e.pointerId === eraseId){
      eraseId = -1;
      st._eraseLast = null;
      if(batch) inkEraseCommit(batch);
      batch = null;
      /* 笔尾橡皮 / 长按橡皮是临时态，抬手回到原工具；工具栏选的擦是手动档 */
      if(st.eraserEnd || holdErasing){ st.eraserEnd = false; holdErasing = false; inkSyncBar(); }
      inkCursor(null);
      return;
    }
    if(e.pointerId === lassoId){
      const mode = lassoMode;
      lassoId = -1; lassoMode = 0;
      st._lassoFrom = null;
      if(mode === 1) inkLassoEnd(st.lassoPath);
      else inkLassoDrop();
      inkInvalidate(); inkSyncBar();
      return;
    }
    if(e.pointerId === drawId){
      drawId = -1;
      if(cancelled) inkAbortStroke();
      else inkCommitStroke();
    }
    inkCursor(null);
  };
  wrap.addEventListener("pointerup", e=> onUp(e, false));
  /* pointercancel：系统抢走了指针（国产浏览器的手势系统、系统边缘手势）。
     已经写了一段的笔画按「写完」算——直接丢等于用户白写，这是旧版最恼人的断触。 */
  wrap.addEventListener("pointercancel", e=>{
    const st = st_();
    onUp(e, !(st && st.cur && st.cur.p.length >= 9));
  });
  wrap.addEventListener("pointerleave", e=>{ if(drawId < 0 && eraseId < 0) inkCursor(null); });
  /* 悬停侦测：笔进入感应范围就记一笔「这台设备有笔」，手掌从此不再出墨 */
  wrap.addEventListener("pointerenter", e=>{ if(e.pointerType === "pen") inkNotePen(); });
  wrap.addEventListener("wheel", e=>{
    const st = st_(); if(!st || !st._map) return;
    e.preventDefault();
    if(e.ctrlKey) inkZoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1/1.12);
    else inkPanBy(-e.deltaX, -e.deltaY);
  }, {passive:false});
  /* 笔尾/侧键按下时浏览器会弹右键菜单，挡掉 */
  wrap.addEventListener("contextmenu", e=> e.preventDefault());
  /* 国产浏览器（夸克等）自带手势系统，不理会 touch-action:none：手掌一搭上来
     就抢触摸、给笔发 pointercancel。touchstart 阶段 preventDefault 是标准打法，
     明确声明「这块区域我自己处理」。只挂在画布容器上，工具栏点击不受影响。 */
  wrap.addEventListener("touchstart", e=>{
    if(e.cancelable) e.preventDefault();
  }, {passive:false});
  wrap.addEventListener("touchmove", e=>{ if(e.cancelable) e.preventDefault(); }, {passive:false});
}
/* 手写笔模式下，触摸不许碰工具栏和全屏壳：手掌搭到底部工具栏 =
   写字途中工具被随机切换，比断触更糟。画布不能拦（捏合靠它），
   「手写笔/手指」开关也放行——万一笔没电了还得能切回手指。 */
document.addEventListener("pointerdown", e=>{
  const st = inkPad;
  if(!st || st.input === "finger" || e.pointerType !== "touch") return;
  if(st.input === "auto" && !inkPenSeen) return;
  const t = e.target;
  if(!t || !t.closest) return;
  if(t.closest(".ink-in") || t.closest("canvas") || t.closest(".inkwrap")) return;
  if(t.closest(".inkbar") || t.closest(".inkfs-top") || t.closest(".ink-panel")){
    if(inkPenDown || performance.now() - inkPenUpAt < INK_PEN_GRACE){
      e.preventDefault(); e.stopImmediatePropagation();
    }
  }
}, true);
/* 键盘快捷键：Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y、Delete 删选区、Esc 退全屏或取消选区、
   1-6 选颜色、[ ] 调粗细、E 橡皮、P 笔、L 套索、H 荧光笔、G 适配视图 */
document.addEventListener("keydown", e=>{
  const st = inkPad; if(!st) return;
  const tag = (e.target && e.target.tagName) || "";
  if(tag === "INPUT" || tag === "TEXTAREA" || (e.target && e.target.isContentEditable)) return;
  const k = e.key.toLowerCase();
  if((e.ctrlKey || e.metaKey) && k === "z"){ e.preventDefault(); return e.shiftKey ? inkRedo() : inkUndo(); }
  if((e.ctrlKey || e.metaKey) && k === "y"){ e.preventDefault(); return inkRedo(); }
  if((e.ctrlKey || e.metaKey) && k === "s"){ e.preventDefault(); return inkAutoSave(true); }
  if(e.ctrlKey || e.metaKey || e.altKey) return;
  if(k === "escape"){
    if(st.lasso){ st.lasso = null; inkInvalidate(); inkSyncBar(); }
    else if(st.fs) inkUnfullscreen();
    return;
  }
  if((k === "delete" || k === "backspace") && st.lasso){ e.preventDefault(); return inkLassoDelete(); }
  if(k >= "1" && k <= "6"){ st.color = +k - 1; st.tool = "pen"; inkSavePref(); return inkSyncBar(); }
  if(k === "[" || k === "]"){
    st.penW = +inkClamp((st.penW||1.8) + (k === "]" ? 0.3 : -0.3), 0.6, 6).toFixed(1);
    inkSavePref(); return inkSyncBar();
  }
  const map = {e:"erase", p:"pen", l:"lasso", h:"highlighter", n:"line", v:"pan"};
  if(map[k]){ st.tool = map[k]; inkSyncBar(); return; }
  if(k === "g"){ inkFitView(); inkInvalidate(); inkZoomLabel(); return; }
});

