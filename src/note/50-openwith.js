/* ---- 系统打开方式 / 分享目标 ----
   安卓壳把「用错了没打开」的文件和分享内容递到这里（appReceiveImport）。
   收到后先问你要放哪（笔记本 / 错题录入 / 练习册），再落到对应流程：
   · PDF  →  📓 新笔记本（解析成可写页，默认）/ 📚 上传练习册（解析勾选入库）
   · 图片 →  ✍️ 录入错题（进表单 + AI 识别，默认）/ 📓 新笔记本（图片当一页，可写）
   · 文字 →  直接填进题干（不需要选）
   · Word/Excel → 解析不了，指两条路
   文件本体经壳的 __android_import__ 通道取回（同源 fetch；SW 对这条路径放行）。 */
window.appReceiveImport = async function(meta){
  try{
    if(meta && meta.text){
      switchTab("add");
      $("fQuestion").value = meta.text.slice(0, 4000);
      try{ updatePreview(); }catch(e){}
      toast("分享的文字已填入题干");
      return;
    }
    if(!meta || !meta.url) return;
    const name = meta.name || "导入文件";
    const isWordExcel = /word|excel|spreadsheet|officedocument|msword|ms-excel/i.test(meta.mime || "")
      || /\.(docx?|xlsx?|csv)$/i.test(name);
    if(isWordExcel){
      /* 指路弹窗不需要下载文件，先拦下来 */
      alert(`收到《${name}》，这类文件还解析不了。\n\n两个办法：\n① 在 WPS/Office 里「另存为 PDF」，再用错了没打开 PDF\n② 截图后分享给错了没——图片可以直接 AI 识别进错题库`);
      return;
    }
    const isPdf = meta.mime === "application/pdf" || /\.pdf$/i.test(name);
    const isImg = !isPdf && ((meta.mime || "").startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(name));
    /* 先选目的地，选中了再去取文件/跑流程 */
    const dest = await chooseImportDest(isPdf, name);
    if(!dest) return;
    if(dest === "book"){
      switchTab("book");
      const blob = await (await fetch(meta.url, {cache: "no-store"})).blob();
      let last = 0;
      await bookImportFromFile(new File([blob], name, {type: "application/pdf"}),
        t=>{ const now = Date.now(); if(now - last > 1500 || t.startsWith("✅")){ last = now; toast(t); } });
      renderBooks(); refreshBookSel();
      return;
    }
    if(dest === "note"){
      if(isPdf){
        switchTab("note");
        const blob = await (await fetch(meta.url, {cache: "no-store"})).blob();
        await noteImportPDFFromFile(new File([blob], name, {type: "application/pdf"}));
      }else{
        const blob = await (await fetch(meta.url, {cache: "no-store"})).blob();
        await noteImportImageFile(blob, name);
      }
      return;
    }
    if(dest === "add" && isImg){
      switchTab("add");
      const blob = await (await fetch(meta.url, {cache: "no-store"})).blob();
      const img = await compressImage(new File([blob], name, {type: meta.mime || "image/png"}));
      pendingImgs.push(img);
      renderImgs();
      toast("图片已放进录入表单，点「✨ AI 智能识别」就能入库");
      return;
    }
  }catch(e){
    console.error(e);
    toast("导入失败：" + (e.message || e));
  }
};

/* 目的地选择弹窗：PDF 和图片各给两个合理去处，点选后走对应流程 */
function chooseImportDest(isPdf, name){
  return new Promise(res=>{
    const mask = document.createElement("div");
    mask.className = "nb-new-mask";
    const opts = isPdf
      ? [{k:"note", ic:"note", t:"放进笔记本",  d:"每页变可写纸，直接手写批注"},
         {k:"book", ic:"book", t:"上传到练习册", d:"解析全书，勾选题目批量入库"}]
      : [{k:"add",  ic:"pen",  t:"录入错题",    d:"进录入表单，AI 识别入库"},
         {k:"note", ic:"note", t:"放进笔记本",  d:"图片当一页纸，直接在上面写"}];
    mask.innerHTML = `
      <div class="card nb-new" style="width:min(420px,92vw)">
        <h3 style="margin:0 0 6px">《${esc(name)}》放哪？</h3>
        <div class="muted" style="font-size:12.5px;margin-bottom:12px">按文件类型给你挑好了去处：</div>
        <div class="nb-dest-grid">
          ${opts.map((o,i)=>`
          <button class="nb-dest${i===0?" on":""}" data-k="${o.k}">
            <span class="ic">${icon(o.ic, "lg")}</span><b>${o.t}</b>${i===0?'<span class="rec">推荐</span>':""}<span class="d">${o.d}</span>
          </button>`).join("")}
        </div>
        <div class="row" style="margin-top:12px;justify-content:flex-end">
          <button class="btn ghost small" data-k="__cancel">取消</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
    /* 两个去处，点卡片即选定——不需要先选中再确认的两步 */
    mask.addEventListener("click", e=>{
      const d = e.target.closest(".nb-dest");
      if(d){ mask.remove(); res(d.dataset.k); return; }
      if(e.target.closest('[data-k="__cancel"]')){ mask.remove(); res(null); }
    });
  });
}

/* 图片 → 笔记本：图片存进 nb_files 当一页的背景，直接可写 */
async function noteImportImageFile(blob, name){
  toast("正在生成笔记…");
  const dataUrl = await new Promise(r=>{
    const fr = new FileReader();
    fr.onload = ()=> r(fr.result);
    fr.readAsDataURL(blob);
  });
  const dim = await new Promise(r=>{
    const img = new Image();
    img.onload = ()=> r([img.naturalWidth, img.naturalHeight]);
    img.onerror = ()=> r([1000, 1414]);
    img.src = dataUrl;
  });
  const fileId = "file_" + Date.now();
  await dbNbFilePut(fileId, dataUrl);
  const n = {
    id: "nb_" + Date.now(),
    title: name.replace(/\.(png|jpe?g|webp|gif|bmp)$/i, "") || "图片笔记",
    cover: ["#5c88ff","#4ade80","#ff7070","#fbbf24","#a855f7"][Math.floor(Math.random()*5)],
    createdAt: Date.now(), updatedAt: Date.now(),
    pages: [{
      id: "pg_1", bgType: "image", bgData: fileId,
      w: dim[0], h: dim[1],
      layers: [{id: "l1", name: "笔记图层", visible: true, strokes: []}]
    }]
  };
  await dbNotePut(n);
  switchTab("note");
  renderNotes();
  toast("已放进笔记本，点开就能写");
}
