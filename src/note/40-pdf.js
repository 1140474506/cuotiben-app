/* ---- 极简 PDF 生成器 ----
   笔记导出的需求只有一种形态：一页一张 JPEG 图。jsPDF 从 cdnjs 加载，
   在国内网络经常失败——APP 里点导出没反应就是它。而那几百 KB 的库我们只用到
   「图片摆进页面」这一个功能，自己拼 PDF 文件反而更短、更稳、零依赖。
   结构：1=Catalog 2=Pages，之后每页三个对象（Page / 图像 XObject / 内容流）。 */
function inkMakePDF(sheets){                  // sheets: [{jpeg:Uint8Array, w, h}]
  const enc = new TextEncoder();
  const parts = [];
  let pos = 0;
  const push = b => { parts.push(b); pos += b.length; };
  const pushStr = t => push(enc.encode(t));
  const offs = [];

  pushStr("%PDF-1.4\n");
  const obj = (i, body) => { offs[i] = pos; pushStr(`${i} 0 obj\n${body}\nendobj\n`); };
  /* entries 是除了 Length 以外的键值（不带尖括号）。必须拼成单个字典：
     两个 >><< 相邻在 PDF 里不是合法的流对象头。 */
  const streamObj = (i, entries, bytes) => {
    offs[i] = pos;
    pushStr(`${i} 0 obj\n<</Length ${bytes.length}${entries}>>\nstream\n`);
    push(bytes);
    pushStr("\nendstream\nendobj\n");
  };

  const n = sheets.length;
  const kids = sheets.map((_, i) => `${3 + i*3} 0 R`).join(" ");
  obj(1, "<</Type/Catalog/Pages 2 0 R>>");
  obj(2, `<</Type/Pages/Kids[${kids}]/Count ${n}>>`);
  sheets.forEach((sh, i) => {
    const pageRef = 3 + i*3, imgRef = pageRef + 1, cntRef = pageRef + 2;
    const W = Math.round(sh.w * 0.375), H = Math.round(sh.h * 0.375);   // px → pt
    obj(pageRef, `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${W} ${H}]`
      + `/Resources<</XObject<</Im${i} ${imgRef} 0 R>>>>/Contents ${cntRef} 0 R>>`);
    streamObj(imgRef,
      `/Type/XObject/Subtype/Image/Width ${sh.w}/Height ${sh.h}`
      + `/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode`,
      sh.jpeg);
    streamObj(cntRef, "",
      enc.encode(`q ${W} 0 0 ${H} 0 0 cm /Im${i} Do Q`));
  });

  const total = 2 + n*3;
  const xref = pos;
  pushStr(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);
  for(let i = 1; i <= total; i++)
    pushStr(String(offs[i]).padStart(10, "0") + " 00000 n \n");
  pushStr(`trailer\n<</Size ${total + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts, {type: "application/pdf"});
}
/* canvas 的 JPEG dataURL → 原始字节（DCTDecode 直接吃） */
function inkJPEGBytes(dataURL){
  const bin = atob(dataURL.split(",")[1]);
  const arr = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
