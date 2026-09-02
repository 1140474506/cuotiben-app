/* ---- PDF 导入 / 导出 ---- */
/* pdf.js 双 CDN：jsdelivr 国内通常可达（应用的 KaTeX 就走它），
   cdnjs 在部分网络环境下会失败——之前「导入失败」的另一半原因 */
function loadPDFJS(){
  if(window.pdfjsLib){
    try{ pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; }catch(e){}
    return Promise.resolve();
  }
  const tryCdn = urls => new Promise((res, rej)=>{
    const s = document.createElement("script");
    s.src = urls[0];
    s.onload = ()=>{ try{ pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; }catch(e){} res(); };
    s.onerror = ()=>{ s.remove(); urls.length > 1 ? tryCdn(urls.slice(1)).then(res, rej)
                                                  : rej(new Error("PDF 组件加载失败，请检查网络")); };
    document.head.appendChild(s);
  });
  return tryCdn([
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
  ]);
}
const PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
/* 导入 PDF：每页栅格化成图片存 nb_files，页面记录 bgData=fileId。
   旧版的问题：页对象存 width/height（引擎读的是 w/h，导致整本笔记用错纸尺寸），
   且解析过程中列表 innerHTML 被来回改，出任何异常列表就永远停在「正在解析」。
   现在进度走 toast，列表只在成功后重画一次。 */
function noteImportPDF(){
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/pdf";
  input.onchange = async ()=>{ if(input.files[0]) noteImportPDFFromFile(input.files[0]); };
}
/* 真正的导入逻辑：接收任何 File（文件选择器 / 安卓「用错了没打开」共用） */
async function noteImportPDFFromFile(file){
  {
    toast("正在解析 PDF…");
    try{
      await loadPDFJS();
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({data: buf.slice(0)}).promise;
      const n = {
        id: "nb_" + Date.now(),
        title: file.name.replace(/\.pdf$/i, ""),
        cover: ["#5c88ff","#4ade80","#ff7070","#fbbf24","#a855f7"][Math.floor(Math.random()*5)],
        createdAt: Date.now(), updatedAt: Date.now(),
        pages: []
      };
      for(let i=1; i<=pdf.numPages; i++){
        toast(`正在导入 ${i}/${pdf.numPages} 页…`);
        const page = await pdf.getPage(i);
        const vp = page.getViewport({scale: 1.6});
        const cv = document.createElement("canvas");
        cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
        await page.render({canvasContext: cv.getContext("2d"), viewport: vp}).promise;
        const fileId = "file_" + Date.now() + "_" + i;
        await dbNbFilePut(fileId, cv.toDataURL("image/jpeg", 0.82));
        n.pages.push({
          id: "pg_" + i,
          bgType: "image", bgData: fileId,
          w: cv.width, h: cv.height,
          layers: [{id: "l1", name: "笔记图层", visible: true, strokes: []}]
        });
      }
      if(!n.pages.length) throw new Error("一页也没解析出来");
      await dbNotePut(n);
      renderNotes();
      toast(`已导入 ${n.pages.length} 页，点开就能写`);
    }catch(e){
      console.error(e);
      toast("导入失败：" + (e.message || e));
    }
  };
  input.click();
}
/* 导出 PDF：按每页真实的纸面尺寸出页（旧版把所有页硬塞进 1000×500，
   笔记本的 A4 竖版页导出来全被压扁）。缩放 2 倍抗糊，单页像素封顶。 */
async function inkExportPDF(){
  const st = inkPad;
  if(!st || !st.note){ toast("当前没有打开的笔记"); return; }
  toast("正在导出…");
  try{
    /* 图片背景页先把图从 nb_files 里取出来，否则导出的是白纸 */
    for(const pg of st.pages){
      if(!Array.isArray(pg) && pg.bgType === "image" && !pg._img) await noteEnsureBg(pg);
    }
    const hasHtml = st.pages.some(p => !Array.isArray(p) && p.bgType === "html");
    const sheets = [];
    for(const pg of st.pages){
      /* 无限画布页按笔迹包围盒取景导出（整张 20000 的纸导出来是一张空纸） */
      let win = null, fw = inkPageW(pg), fh = inkPageH(pg);
      if(!Array.isArray(pg) && pg.infinite){
        const bb = inkInkBB(pg);
        win = bb ? [bb[0]-80, bb[1]-80, bb[2]+80, bb[3]+80] : [0, 0, 1000, 1000];
        fw = win[2]-win[0]; fh = win[3]-win[1];
      }
      const k = Math.min(2, Math.sqrt(4e6 / (fw*fh)));
      const pw = Math.round(fw*k), ph = Math.round(fh*k);
      const cv = document.createElement("canvas");
      cv.width = pw; cv.height = ph;
      inkPaintPageTo(cv.getContext("2d"), pg, pw, ph, true, win);
      sheets.push({jpeg: inkJPEGBytes(cv.toDataURL("image/jpeg", 0.92)), w: pw, h: ph});
    }
    /* 下载走 blob（APP 里经下载桥存进系统「下载」，网页端是普通下载） */
    const blob = inkMakePDF(sheets);
    appDownload(blob, (st.note.title || "笔记") + ".pdf", "application/pdf");
    if(hasHtml) toast("已导出。练习纸页导出的是手写层，印刷内容请用打印功能生成");
    else toast("已导出 PDF");
  }catch(e){
    console.error(e);
    toast("导出失败：" + (e.message || e));
  }
}
