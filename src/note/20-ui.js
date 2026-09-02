/* ---- 笔记本列表 / 打开 / 关闭 ----
   旧版列表封面是一块纯色 div（看不出里面写了什么），打开笔记走的是
   inkFullscreenNotebook 那套自建 DOM——工具栏 class 和事件匹配的 class 对不上，
   整条工具栏点不动。现在列表封面画第一页缩略图，打开直接复用引擎的
   inkOpen({fullscreen})，工具栏/图层/缩略图/撤销全部天然可用。 */
let noteFolder = "";        // "" = 全部；文件夹视图只影响列表显示，不动数据
async function renderNotes(){
  const list = $("noteList");
  if(!list) return;
  list.innerHTML = "<div class='muted'>加载中...</div>";
  try{
    const notes = await dbNotesAll();
    /* 文件夹从笔记数据里派生（note.folder 字段），不单独存一份——
       文件夹跟着笔记本身走云端同步，永远不会出现「列表里有文件夹但笔记里没有」。
       没有分类过的笔记库，这里算出来是空数组，界面就是原来那个平铺列表。 */
    const folders = noteFolderUnion(notes);
    const bar = $("noteFolders");
    if(bar){
      if(folders.length){
        bar.style.display = "";
        bar.innerHTML = ["", ...folders].map(f=>{
          const n = f ? notes.filter(x=>x.folder===f).length : notes.length;
          return `<button class="chip folder-chip${noteFolder===f?" on":""}" data-folder="${esc(f)}">${f?"📁 "+esc(f):"全部"}<span class="fcnt">${n}</span></button>`;
        }).join("");
      }else{
        bar.style.display = "none";
        bar.innerHTML = "";
      }
    }
    if(noteFolder && !folders.includes(noteFolder)) noteFolder = "";   // 文件夹被搬空了就回全部
    const shown = noteFolder ? notes.filter(n=>n.folder===noteFolder) : notes;
    if(!shown.length){
      list.innerHTML = `<div class='muted'>${noteFolder
        ? `「${esc(noteFolder)}」里还没有笔记。卡片上的 🗂 可以把笔记移进来。`
        : "还没有笔记本。点右上角「新建笔记」，或把现成的 PDF 导进来直接在上面写。"}</div>`;
      return;
    }
    list.innerHTML = shown.map(n=>`
      <div class="nb-card" onclick="noteOpen('${n.id}')">
        <div class="nb-cover"><canvas width="292" height="264"></canvas></div>
        <div class="nm">${esc(n.title || "未命名")}</div>
        <div class="sub">${n.folder ? esc(n.folder) + " · " : ""}${n.pages ? n.pages.length : 0} 页 · ${relTime(n.updatedAt)}</div>
        <button class="btn ghost small del" title="移到文件夹（输入新名字会新建）" onclick="event.stopPropagation(); noteMove('${n.id}')">🗂</button>
        <button class="btn ghost small del" style="right:44px" title="删除" onclick="event.stopPropagation(); noteDelConfirm('${n.id}')">🗑</button>
      </div>`).join("");
    const cvs = list.querySelectorAll(".nb-cover canvas");
    shown.forEach((n, i)=>{ if(cvs[i]) noteCoverPaint(cvs[i], n); });
  }catch(e){
    list.innerHTML = "<div class='muted'>加载失败，刷新试试</div>";
  }
}
/* 文件夹条点击：切视图（不动数据） */
(function(){
  const bar = typeof $ !== "undefined" && $("noteFolders");
  if(bar) bar.addEventListener("click", e=>{
    const c = e.target.closest(".folder-chip");
    if(!c) return;
    noteFolder = c.dataset.folder || "";
    renderNotes();
  });
})();

/* 移动到文件夹：直接输入名字（新名字 = 新建），留空 = 不分类 */
async function noteMove(id){
  const all = await dbNotesAll();
  const n = all.find(x=>x.id===id);
  if(!n) return;
  const folders = await noteFolderList();
  const cur = n.folder || "";
  const mask = document.createElement("div");
  mask.className = "nb-new-mask";
  mask.innerHTML = `
    <div class="card nb-new" style="width:min(360px,92vw)">
      <h3 style="margin:0 0 12px">移到文件夹</h3>
      <div class="nb-flist">${noteFolderRowsHTML(cur, folders)}</div>
      <div class="row" style="margin-top:12px;justify-content:flex-end">
        <button class="btn ghost small" data-act="cancel">取消</button>
      </div>
    </div>`;
  document.body.appendChild(mask);
  mask.addEventListener("click", async e=>{
    const f = e.target.closest(".nb-frow");
    if(f){
      if(f.dataset.f === "__new"){
        const name = noteNewFolder();
        if(name){
          folders.length = 0; folders.push(...await noteFolderList());
          mask.querySelector(".nb-flist").innerHTML = noteFolderRowsHTML(cur, folders);
        }
        return;
      }
      const v = f.dataset.f;
      mask.remove();
      if(v === cur) return;
      if(v){ n.folder = v; } else { delete n.folder; }
      await dbNotePut(n);
      renderNotes();
      toast(v ? `已移入「${v}」` : "已移出文件夹");
      return;
    }
    if(e.target.closest("button[data-act='cancel']") || e.target === mask) mask.remove();
  });
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
/* 文件夹列表 = 本机建过的（cfg.folders，空文件夹也留着）∪ 笔记里实际用到的。
   手动建的进 cfg；自动归类（练习纸进科目文件夹）的随笔记走云端。
   两边取并集：空文件夹不会凭空消失，别的设备自动归的类这台也看得到。 */
async function noteFolderList(){
  return noteFolderUnion(await dbNotesAll());
}
function noteFolderUnion(notes){
  const used = (notes || []).map(n=>n.folder).filter(Boolean);
  return [...new Set([...(cfg.folders || []), ...used])]
    .sort((a,b)=> a.localeCompare(b, "zh"));
}
/* 文件夹选择行（单选，点选不用打字——GoodNotes 式）。新建笔记和移动共用。 */
function noteFolderRowsHTML(cur, folders){
  const row = (name, label, icon)=>
    `<button class="nb-frow${(cur||"") === name ? " on" : ""}" data-f="${esc(name)}">
       <span>${icon} ${esc(label)}</span><span class="tick">${(cur||"") === name ? "●" : "○"}</span>
     </button>`;
  let html = row("", "不分类（放在最外层）", "\u{1F5D2}");
  for(const f of folders) html += row(f, f, "\u{1F4C1}");
  return html + `<button class="nb-frow nb-fnew" data-f="__new">\u{2795} 新建文件夹…</button>`;
}
function noteNewFolder(){
  const name = (prompt("新文件夹叫什么名字？", "") || "").trim().slice(0, 12);
  if(!name) return null;
  cfg.folders = cfg.folders || [];
  if(!cfg.folders.includes(name)){ cfg.folders.push(name); saveCfg(); }
  return name;
}
/* 新建笔记：名称 + 从文件夹列表点选（或就地新建）+ 纸张样式 */
async function noteNewBlank(){
  if(document.querySelector(".nb-new-mask")) return;
  const folders = await noteFolderList();
  const mask = document.createElement("div");
  mask.className = "nb-new-mask";
  mask.innerHTML = `
    <div class="card nb-new">
      <h3 style="margin:0 0 12px">新建笔记</h3>
      <input id="nbNewTitle" class="nb-new-title" placeholder="笔记本名称" value="新建笔记" maxlength="40">
      <div class="lbl" style="margin:12px 0 6px;font-size:12.5px;color:var(--muted);font-weight:bold">放进哪个文件夹</div>
      <div class="nb-flist" id="nbFolderList">${noteFolderRowsHTML("", folders)}</div>
      <div class="lbl" style="margin:12px 0 6px;font-size:12.5px;color:var(--muted);font-weight:bold">纸张样式</div>
      <div class="nb-style-grid">
        <button class="nb-style on" data-style="a4">
          <span class="ic">📄</span><b>标准分页</b>
          <span class="d">A4 纸带边框，可加页<br>适合正式笔记</span>
        </button>
        <button class="nb-style" data-style="inf">
          <span class="ic">♾️</span><b>无限画布</b>
          <span class="d">无边框，随便到处写<br>适合草稿和演算</span>
        </button>
      </div>
      <div class="row" style="margin-top:14px;justify-content:flex-end">
        <button class="btn ghost small" data-act="cancel">取消</button>
        <button class="btn small" data-act="ok">创建</button>
      </div>
    </div>`;
  document.body.appendChild(mask);
  const st = {folder: "", style: "a4"};
  const titleInput = mask.querySelector("#nbNewTitle");
  const relist = ()=>{ mask.querySelector("#nbFolderList").innerHTML = noteFolderRowsHTML(st.folder, folders); };
  titleInput.focus(); titleInput.select();
  mask.addEventListener("click", async e=>{
    const f = e.target.closest(".nb-frow");
    if(f){
      if(f.dataset.f === "__new"){
        const name = noteNewFolder();
        if(name){ folders.length = 0; folders.push(...await noteFolderList()); st.folder = name; relist(); }
        return;
      }
      st.folder = f.dataset.f;
      relist();
      return;
    }
    const sy = e.target.closest(".nb-style");
    if(sy){
      st.style = sy.dataset.style;
      mask.querySelectorAll(".nb-style").forEach(x=> x.classList.toggle("on", x===sy));
      return;
    }
    const b = e.target.closest("button[data-act]");
    if(!b) return;
    if(b.dataset.act === "cancel"){ mask.remove(); return; }
    const title = titleInput.value.trim();
    if(!title){ titleInput.focus(); return; }
    mask.remove();
    noteCreate(title, st.style, st.folder);
  });
  titleInput.addEventListener("keydown", e=>{
    if(e.key === "Enter"){
      e.preventDefault();
      const title = titleInput.value.trim();
      if(title){ mask.remove(); noteCreate(title, st.style, st.folder); }
    }
  });
}
async function noteCreate(title, style, folder){
  const inf = style === "inf";
  const n = {
    id: "nb_" + Date.now(),
    title,
    ...(folder ? {folder} : {}),
    cover: ["#5c88ff","#4ade80","#ff7070","#fbbf24","#a855f7"][Math.floor(Math.random()*5)],
    createdAt: Date.now(), updatedAt: Date.now(),
    pages: [ inf
      ? { id: "pg_" + Date.now().toString(36),
          bgType: "blank", bgData: null, infinite: true,
          w: INK_INF_W, h: INK_INF_H, grid: "dot",
          layers: [{id: "l1", name: "图层 1", visible: true, strokes: []}] }
      : { id: "pg_" + Date.now().toString(36),
          bgType: "blank", bgData: null,
          w: INK_NB_W, h: INK_NB_H, grid: "dot",
          layers: [{id: "l1", name: "图层 1", visible: true, strokes: []}] }
    ]
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
