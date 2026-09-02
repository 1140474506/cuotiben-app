/* ---- 系统打开方式 / 分享目标 ----
   安卓壳把「用错了没打开」的文件和分享内容递到这里（appReceiveImport）：
   · PDF → 直接进练习册导入流程（解析成可写的笔记页）
   · 图片 → 进录入表单，点一下「AI 智能识别」就能入库
   · 分享的文字 → 直接填进题干
   · Word/Excel → 解析不了，弹窗指两条路（另存 PDF / 截图分享）
   文件本体经壳的 __android_import__ 拦截通道取回（同源 fetch，无大小限制）。 */
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
      alert(`收到《${name}》，这类文件还解析不了。

两个办法：
① 在 WPS/Office 里「另存为 PDF」，再用错了没打开 PDF
② 截图后分享给错了没——图片可以直接 AI 识别进错题库`);
      return;
    }
    const blob = await (await fetch(meta.url, {cache: "no-store"})).blob();
    if((meta.mime === "application/pdf") || (/\.pdf$/i.test(name))){
      switchTab("note");
      await noteImportPDFFromFile(new File([blob], name, {type: "application/pdf"}));
      return;
    }
    if((meta.mime || "").startsWith("image/")){
      switchTab("add");
      const img = await compressImage(new File([blob], name, {type: meta.mime}));
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
