/* ---- 笔记本列表 / 打开 / 关闭 ----
   旧版列表封面是一块纯色 div（看不出里面写了什么），打开笔记走的是
   inkFullscreenNotebook 那套自建 DOM——工具栏 class 和事件匹配的 class 对不上，
   整条工具栏点不动。现在列表封面画第一页缩略图，打开直接复用引擎的
   inkOpen({fullscreen})，工具栏/图层/缩略图/撤销全部天然可用。 */
async function renderNotes(){
  const list = $("noteList");
  if(!list) return;
  list.innerHTML = "<div class='muted'>加载中...</div>";
  try{
    const notes = await dbNotesAll();
    if(!notes.length){
      list.innerHTML = "<div class='muted'>还没有笔记本。点右上角「新建笔记」，或把现成的 PDF 导进来直接在上面写。</div>";
      return;
    }
    list.innerHTML = notes.map(n=>`
      <div class="nb-card" onclick="noteOpen('${n.id}')">
        <div class="nb-cover"><canvas width="292" height="264"></canvas></div>
        <div class="nm">${esc(n.title || "未命名")}</div>
        <div class="sub">${n.pages ? n.pages.length : 0} 页 · ${relTime(n.updatedAt)}</div>
        <button class="btn ghost small del" title="删除" onclick="event.stopPropagation(); noteDelConfirm('${n.id}')">🗑</button>
      </div>`).join("");
    const cvs = list.querySelectorAll(".nb-cover canvas");
    notes.forEach((n, i)=>{ if(cvs[i]) noteCoverPaint(cvs[i], n); });
  }catch(e){
    list.innerHTML = "<div class='muted'>加载失败，刷新试试</div>";
  }
}
/* 封面 = 第一页缩略图。图片背景页先把图取出来再画，不然封面永远是一张白纸 */
async function noteCoverPaint(cv, n){
  const pg = n.pages && n.pages[0];
  if(!pg) return;
  await noteEnsureBg(pg);
  if(inkPad) return;          // 用户已经点进某本笔记了，别再抢主线程
  const ctx = cv.getContext("2d");
  inkPaintPageTo(ctx, pg, cv.width, cv.height, true);
}
async function noteEnsureBg(pg){
  if(!pg || Array.isArray(pg) || pg.bgType !== "image" || pg._img) return;
  try{
    const rec = await dbNbFileGet(pg.bgData);
    if(!rec || !rec.data) return;
    await new Promise(res=>{
      const img = new Image();
      img.onload = img.onerror = res;
      img.src = rec.data;
      pg._img = img;
    });
  }catch(e){}
}
async function noteNewBlank(){
  const title = prompt("笔记本叫什么名字？", "新建笔记");
  if(!title) return;
  const n = {
    id: "nb_" + Date.now(),
    title,
    cover: ["#5c88ff","#4ade80","#ff7070","#fbbf24","#a855f7"][Math.floor(Math.random()*5)],
    createdAt: Date.now(), updatedAt: Date.now(),
    pages: [{
      id: "pg_" + Date.now().toString(36),
      bgType: "blank", bgData: null,
      w: INK_NB_W, h: INK_NB_H, grid: "dot",
      layers: [{id: "l1", name: "图层 1", visible: true, strokes: []}]
    }]
  };
  await dbNotePut(n);
  renderNotes();
  noteOpen(n.id);
}
async function noteDelConfirm(id){
  if(!confirm("确定删除这本笔记？删除后其他设备下次同步时也会一并删掉。")) return;
  if(inkPad && inkPad.note && inkPad.note.id === id) noteClose();
  await dbNoteDel(id);
  renderNotes();
}
/* ---- 打开 / 关闭 ---- */
let currentNote = null;
async function noteOpen(id){
  const n = (await dbNotesAll()).find(x => x.id === id);
  if(!n){ toast("这本笔记不存在了"); renderNotes(); return; }
  currentNote = n;
  /* 旧的 page 对象里 Gemini 存的是 width/height，这里顺手补上 w/h */
  for(const pg of n.pages||[]){
    if(!Array.isArray(pg)){
      if(!pg.w && pg.width) pg.w = pg.width;
      if(!pg.h && pg.height) pg.h = pg.height;
    }
  }
  inkOpen({
    note: n,
    pages: n.pages && n.pages.length ? n.pages : [inkNewPage()],
    saveFn: ()=> dbNotePut(n).catch(()=>{}),
    fullscreen: true
  });
}
/* 退出笔记：把内存里的版本落库一次（dbNotePutRaw 里会剥掉 Path2D 缓存），
   再回列表。全屏壳的移除由调用方（inkUnfullscreen）负责，这里只收尾。 */
async function noteClose(){
  const n = currentNote;
  currentNote = null;
  if(n) await dbNotePut(n).catch(()=>{});
  inkClose();
  if(!$("tab-note") || !$("tab-note").hidden) renderNotes();
}
