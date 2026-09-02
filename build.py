# -*- coding: utf-8 -*-
"""把 src/ 装配成单文件 index.html。
   之前 Gemini 直接在 22,677 行的 index.html 上原地打补丁，补出了四份完整拷贝 +
   两段裸露在页面文本里的 JS。以后所有改动都改 src/ 下的部件，跑一次 build.py
   重新装配，单个文件交付的习惯保持不变（PWA 离线缓存只认一个 index.html）。"""
import io, os, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "src")

def read(p):
    with io.open(p, "r", encoding="utf-8") as f:
        return f.read()

def read_stripped(p):
    return read(p).strip("\n")

base = read(os.path.join(SRC, "base.html"))
ink_css = read_stripped(os.path.join(SRC, "ink.css"))
note_tab = read_stripped(os.path.join(SRC, "note", "tab.html"))

INK_PARTS = ["10-core.js", "20-geom.js", "30-paint.js", "40-render.js",
             "50-edit.js", "60-lasso.js", "70-input.js", "80-ui.js"]
NOTE_PARTS = ["10-db.js", "20-ui.js", "30-io.js", "40-pdf.js"]

ink_js = "\n".join(read_stripped(os.path.join(SRC, "ink", p)) for p in INK_PARTS)
note_js = "\n".join(read_stripped(os.path.join(SRC, "note", p)) for p in NOTE_PARTS)

MARK_CSS = "/*__INK_CSS__*/"
MARK_TAB = "<!--__NOTE_TAB__-->"
MARK_NOTE = "/*__NOTEBOOK_JS__*/"
MARK_INK = "/*__INK_JS__*/"

for m in (MARK_CSS, MARK_TAB, MARK_NOTE, MARK_INK):
    if base.count(m) != 1:
        sys.exit("FATAL: marker %s appears %d times in base.html (expect 1)" % (m, base.count(m)))

out = (base
    .replace(MARK_CSS, "\n" + ink_css + "\n")
    .replace(MARK_TAB, "\n" + note_tab + "\n")
    .replace(MARK_NOTE, "\n" + note_js + "\n")
    .replace(MARK_INK, "\n" + ink_js + "\n"))

# 装配完再核对一次：所有引擎/笔记函数都只定义一份
import re
defs = re.findall(r"^[ \t]*(?:async )?function (\w+)", out, re.M)
dupes = sorted(set(n for n in defs if defs.count(n) > 1 and n.startswith(("ink", "note", "dbNote", "dbNb", "dbNotes", "mergeNote"))))
if dupes:
    sys.exit("FATAL: duplicate definitions after assembly: %s" % dupes)

dst = os.path.join(ROOT, "index.html")
with io.open(dst, "w", encoding="utf-8", newline="\n") as f:
    f.write(out)
print("built index.html: %d lines, %.2f MB" % (out.count("\n") + 1, len(out.encode("utf-8")) / 1048576.0))
