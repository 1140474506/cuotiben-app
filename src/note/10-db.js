/* ---- 笔记本存储 ----
   表结构和同步流程沿用原来的设计（IndexedDB notebooks + 云端 notebooks.json.gz），
   但落库一律先过 notePlain：引擎会在笔画对象上缓存 Path2D（_pa）、在页对象上
   缓存背景图（_img）和实测高（_h），这些东西结构化克隆会直接抛 DataCloneError，
   JSON 化也只是白白膨胀。存取两端都收口在这里，别处拿到的永远是干净数据。 */
function notePlain(n){
  const o = {...n};
  o.pages = (n.pages || []).map(inkPlainPage);
  return o;
}
function dbNotesAllRaw(){
  return new Promise((res, rej)=>{
    const t = db.transaction("notebooks","readonly").objectStore("notebooks").getAll();
    t.onsuccess = ()=> res(t.result);
    t.onerror = ()=> rej(t.error);
  });
}
async function dbNotesAll(){
  return (await dbNotesAllRaw())
    .filter(n => !n.deletedAt)
    .sort((a,b) => (b.updatedAt||b.createdAt||0) - (a.updatedAt||a.createdAt||0));
}
function dbNotePutRaw(n){
  return new Promise((res, rej)=>{
    const t = db.transaction("notebooks","readwrite").objectStore("notebooks").put(notePlain(n));
    t.onsuccess = res; t.onerror = ()=> rej(t.error);
  });
}
async function dbNotePut(n, quiet){
  n.updatedAt = Date.now();
  await dbNotePutRaw(n);
  if(!quiet) syncSoon();
  return n;
}
/* 软删除：云端据此同步「删掉了这本」，30 天后才真正清掉记录 */
async function dbNoteDel(id){
  await dbNotePutRaw({id, deletedAt: Date.now(), updatedAt: Date.now()});
  syncSoon();
}
async function dbNoteHardDel(id){
  return new Promise((res, rej)=>{
    const t = db.transaction("notebooks","readwrite").objectStore("notebooks").delete(id);
    t.onsuccess = res; t.onerror = ()=> rej(t.error);
  });
}
/* 云端合并。笔记本的笔迹是只追加型数据，但页面删除/清空也走同一份 pages，
   没法无脑求并集（会把删掉的页复活），所以按 updatedAt 新者胜：
   简单、可预测、和题库的合并语义一致。正在开着写的那本在 doSync 里已经换成了
   内存里的版本，不会走到这里。 */
function mergeNote(cur, r){
  if(!cur) return r;
  if(!r) return cur;
  return (r.updatedAt||0) > (cur.updatedAt||0) ? r : cur;
}
/* PDF 导入的背景图存这里（数据 URL），和 notebooks 分开免得列表查询拖着几 MB */
function dbNbFilePut(id, data){
  return new Promise((res, rej)=>{
    const t = db.transaction("nb_files","readwrite").objectStore("nb_files").put({id, data});
    t.onsuccess = res; t.onerror = ()=> rej(t.error);
  });
}
function dbNbFileGet(id){
  return new Promise((res, rej)=>{
    const t = db.transaction("nb_files","readonly").objectStore("nb_files").get(id);
    t.onsuccess = ()=> res(t.result);
    t.onerror = ()=> rej(t.error);
  });
}
