/* ---- 笔记本列表 / 打开 / 关闭 ----
   旧版列表封面是一块纯色 div（看不出里面写了什么），打开笔记走的是
   inkFullscreenNotebook 那套自建 DOM——工具栏 class 和事件匹配的 class 对不上，
   整条工具栏点不动。现在列表封面画第一页缩略图，打开直接复用引擎的
   inkOpen({fullscreen})，工具栏/图层/缩略图/撤销全部天然可用。 */
/* ---- 文件夹（两级：数学/高数）----
   模型：note.folder 存路径字符串（"一级" 或 "一级/二级"），旧的单名数据就是
   一级文件夹，零迁移。视图是文件管理器式的：面包屑导航 + 当前层子文件夹卡 +
   当前层笔记卡；「全部」层只显示不分类的笔记，进了文件夹才看分类的。 */
let noteFolder = "";        // 当前路径（"" = 全部）
const folderSegs = p => (p || "").split("/").filter(Boolean);

/* 树数据：child = 每层的子文件夹，count = 精确路径的笔记数。
   手动建的空文件夹（cfg.folders，存完整路径）也进树，不会凭空消失。 */
function noteFolderTree(notes){
  const child = new Map(), count = new Map();
  const addPath = f => {
    const segs = folderSegs(f);
    for(let i = 0; i < segs.length; i++){
      const parent = segs.slice(0, i).join("/");
      if(!child.has(parent)) child.set(parent, new Set());
      child.get(parent).add(segs[i]);
    }
  };
  for(const n of notes){
    const f = n.folder || "";
    if(!f){ count.set("", (count.get("")||0)+1); continue; }
    count.set(f, (count.get(f)||0)+1);
    addPath(f);
  }
  for(const f of (cfg.folders || [])) addPath(f);
  return {child, count};
}
const zhSort = (a, b) => a.localeCompare(b, "zh");

async function renderNotes(){
  const list = $("noteList");
  if(!list) return;
  list.innerHTML = "<div class='muted'>加载中...</div>";
  try{
    const notes = await dbNotesAll();
    const tree = noteFolderTree(notes);
    /* 面包屑：全部 › 数学 › 高数，点任意一段跳回去 */
    const bar = $("noteFolders");
    if(bar){
      const segs = folderSegs(noteFolder);
      let crumbs = `<button class="crumb${segs.length ? "" : " on"}" data-folder="">${icon("folder")} 全部</button>`;
      let acc = "";
      for(let i = 0; i < segs.length; i++){
        acc = acc ? acc + "/" + segs[i] : segs[i];
        crumbs += `<span class="crumb-sep">${icon("chevronRight")}</span>
          <button class="crumb${i === segs.length-1 ? " on" : ""}" data-folder="${esc(acc)}">${esc(segs[i])}</button>`;
      }
      bar.style.display = "";
      bar.innerHTML = `<div class="nb-crumbs">${crumbs}</div>`;
    }
    if(noteFolder && !tree.child.has("") && !tree.child.has(noteFolder)
       && !notes.some(n => (n.folder||"") === noteFolder)) noteFolder = "";
    /* 子文件夹卡（含子层的笔记计数） */
    const kids = [...(tree.child.get(noteFolder) || [])].sort(zhSort);
    let html = "";
    if(kids.length){
      html += `<div class="nb-subgrid">` + kids.map(k=>{
        const full = noteFolder ? noteFolder + "/" + k : k;
        let c = 0;
        for(const n of notes){
          const f = n.folder || "";
          if(f === full || f.startsWith(full + "/")) c++;
        }
        return `<button class="nb-subcard" data-folder="${esc(full)}">
          ${icon("folder", "lg")}<b>${esc(k)}</b><span>${c} 篇</span></button>`;
      }).join("") + `</div>`;
    }
    /* 当前层的笔记（精确匹配本层路径） */
    const shown = notes.filter(n => (n.folder || "") === noteFolder);
    if(!shown.length && !kids.length){
      list.innerHTML = `<div class='muted'>${noteFolder
        ? `「${esc(noteFolder.split("/").pop())}」还是空的。新笔记会建在这一层。`
        : "还没有笔记本。点右上角「新建」，或把 PDF / 图片分享进来。"}</div>`;
      return;
    }
    list.innerHTML = html + shown.map(n=>`
      <div class="nb-card" onclick="noteOpen('${n.id}')">
        <div class="nb-cover"><canvas width="292" height="264"></canvas></div>
        <div class="nm">${esc(n.title || "未命名")}</div>
        <div class="sub">${n.pages ? n.pages.length : 0} 页 · ${relTime(n.updatedAt)}</div>
        <button class="btn ghost small del" title="移到文件夹" onclick="event.stopPropagation(); noteMove('${n.id}')">${icon("folderPlus")}</button>
        <button class="btn ghost small del" style="right:44px" title="删除" onclick="event.stopPropagation(); noteDelConfirm('${n.id}')">${icon("trash")}</button>
      </div>`).join("");
    const cvs = list.querySelectorAll(".nb-cover canvas");
    shown.forEach((n, i)=>{ if(cvs[i]) noteCoverPaint(cvs[i], n); });
  }catch(e){
    list.innerHTML = "<div class='muted'>加载失败，刷新试试</div>";
  }
}
/* 顶部操作按钮（SVG 图标在 JS 里渲染——tab 片段是静态 HTML 用不了模板函数） */
(function(){
  const el = typeof $ !== "undefined" && $("noteActions");
  if(!el) return;
  el.innerHTML =
    `<button class="btn small" onclick="noteNewBlank()">${icon("plus")} 新建笔记</button>
     <button class="btn ghost small" onclick="if(noteNewFolder()) renderNotes()" title="在当前这层新建文件夹">${icon("folderPlus")} 新建文件夹</button>
     <button class="btn ghost small" onclick="noteImportPDF()" title="导入 PDF 练习册，在题目上直接写">${icon("upload")} 导入 PDF</button>`;
})();

/* 面包屑和子文件夹卡的导航（容器常驻，内部重渲染不影响委托） */
(function(){
  const bar = typeof $ !== "undefined" && $("noteFolders");
  if(bar) bar.addEventListener("click", e=>{
    const c = e.target.closest(".crumb");
    if(c && c.dataset.folder !== noteFolder){ noteFolder = c.dataset.folder || ""; renderNotes(); }
  });
  const list = typeof $ !== "undefined" && $("noteList");
  if(list) list.addEventListener("click", e=>{
    const c = e.target.closest(".nb-subcard");
    if(c){ noteFolder = c.dataset.folder || ""; renderNotes(); }
  });
})();

/* 文件夹全量路径列表（选择器用）：笔记里实际用到的 ∪ 手动建的 */
async function noteFolderList(){
  const notes = await dbNotesAll();
  return [...new Set([...(cfg.folders || []),
      ...notes.map(n=>n.folder).filter(Boolean)])].sort(zhSort);
}
/* 选择器行（两级树全部展开——层级浅，永远可见比折叠清晰） */
function noteFolderRowsHTML(cur, folders){
  const lv1 = [...new Set(folders.map(f=>folderSegs(f)[0]).filter(Boolean))].sort(zhSort);
  const row = (p, label, ic, lvl)=>
    `<button class="nb-frow${lvl ? " lvl2" : ""}${(cur||"") === p ? " on" : ""}" data-f="${esc(p)}">
       <span>${ic} ${esc(label)}</span><span class="tick">${(cur||"") === p ? icon("check") : ""}</span>
     </button>`;
  let html = row("", "不分类（放在最外层）", icon("note"));
  for(const a of lv1){
    html += row(a, a, icon("folder"));
    const kids = [...new Set(folders.filter(f=>folderSegs(f).length > 1 && folderSegs(f)[0] === a)
      .map(f=>folderSegs(f)[1]))].sort(zhSort);
    for(const b of kids) html += row(a + "/" + b, b, icon("folder"), 1);
  }
  return html + `<button class="nb-frow nb-fnew" data-f="__new">${icon("plus")} 新建文件夹…</button>`;
}
/* 新建文件夹：建在当前正在浏览的这一层 */
function noteNewFolder(){
  const label = noteFolder ? `在「${noteFolder.split("/").pop()}」里新建文件夹，叫什么？` : "新文件夹叫什么名字？";
  const name = (prompt(label, "") || "").trim().slice(0, 12);
  if(!name) return null;
  const full = noteFolder ? noteFolder + "/" + name : name;
  cfg.folders = cfg.folders || [];
  if(!cfg.folders.includes(full)){ cfg.folders.push(full); saveCfg(); }
  return full;
}
/* 新建笔记：名称 + 文件夹树点选 + 纸张样式。默认建在当前层。 */
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
      <div class="nb-flist" id="nbFolderList">${noteFolderRowsHTML(noteFolder, folders)}</div>
      <div class="lbl" style="margin:12px 0 6px;font-size:12.5px;color:var(--muted);font-weight:bold">纸张样式</div>
      <div class="nb-style-grid">
        <button class="nb-style on" data-style="a4">
          <span class="ic">${icon("doc", "lg")}</span><b>标准分页</b>
          <span class="d">A4 纸带边框，可加页<br>适合正式笔记</span>
        </button>
        <button class="nb-style" data-style="inf">
          <span class="ic">${icon("infinity", "lg")}</span><b>无限画布</b>
          <span class="d">无边框，随便到处写<br>适合草稿和演算</span>
        </button>
      </div>
      <div class="row" style="margin-top:14px;justify-content:flex-end">
        <button class="btn ghost small" data-act="cancel">取消</button>
        <button class="btn small" data-act="ok">创建</button>
      </div>
    </div>`;
  document.body.appendChild(mask);
  const st = {folder: noteFolder, style: "a4"};
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
/* 移到文件夹：两级树点选（在当前层基础上选，取消 = 移出） */
async function noteMove(id){
  const all = await dbNotesAll();
  const n = all.find(x=>x.id===id);
  if(!n) return;
  const folders = await noteFolderList();
  const cur = n.folder || "";
  const mask = document.createElement("div");
  mask.className = "nb-new-mask";
  mask.innerHTML = `
    <div class="card nb-new" style="width:min(380px,92vw)">
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
