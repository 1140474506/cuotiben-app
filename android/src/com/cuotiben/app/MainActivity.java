package com.cuotiben.app;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.BroadcastReceiver;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.StrictMode;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.os.Looper;
import android.provider.MediaStore;
import android.view.View;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.RenderProcessGoneDetail;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.LinkedHashSet;

/**
 * 错了没 —— 平板 WebView 壳。
 * 直接加载线上 PWA（GitHub Pages），数据存在 WebView 自己的 IndexedDB 里，
 * 同步走应用内的 GitHub 通道 —— 所以和网页端天然是同一份数据。
 *
 * 壳要做对的三件事（少了任何一个，网页在平板上就是残废）：
 *  1. alert/confirm/prompt：WebView 默认不弹，必须自己实现，否则所有
 *     「确定删除？」静默返回 false，删除按钮看起来全坏了。
 *  2. onShowFileChooser：<input type=file>（题目图片 / PDF 导入）默认点了没反应。
 *  3. blob: 下载：jsPDF 导出 / 练习纸下载在 WebView 里没有系统下载器接管，
 *     用 JS 把 blob 转成 base64 走桥接存进「下载」。
 */
public class MainActivity extends Activity {

    private static final String HOME = "https://1140474506.github.io/cuotiben-app/";
    private static final String HOME_HOST = "1140474506.github.io";
    private static final int REQ_FILE = 41;
    private static final int REQ_PERM = 42;
    private static final int REQ_NOTIF = 43;

    private WebView web;
    private WebView printWeb;   // 打印用的离屏 WebView（渲染完交给系统打印服务）
    private long apkDlId = -1;      // 自更新 APK 的下载任务 id
    private BroadcastReceiver dlDone;
    private ValueCallback<Uri[]> fileCb;
    private String pendingName = "导出.pdf";
    private String pendingMime = "application/pdf";
    private long lastBack = 0;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        web = new WebView(this);
        setContentView(web);
        // 每次打开都把提醒闹钟排一遍（时间没变就是刷新，重启后被清空的也补上）
        RemindUtil.scheduleNext(this);
        // 自更新：下载完成的广播 → 弹安装界面。系统保护广播，动态注册即可
        dlDone = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent i) {
                long id = i.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if(id == apkDlId) installApk(id);
            }
        };
        IntentFilter dlF = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= 33) {
            try { registerReceiver(dlDone, dlF, Context.RECEIVER_NOT_EXPORTED); }
            catch (Throwable e) { registerReceiver(dlDone, dlF); }
        } else {
            registerReceiver(dlDone, dlF);
        }

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // IndexedDB + localStorage，全部数据都在这
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);            // 文件选择器回传 content:// 要能读
        s.setLoadsImagesAutomatically(true);
        s.setSupportZoom(false);               // 缩放由应用自己的手势系统管（touch-action:none）
        s.setMediaPlaybackRequiresUserGesture(false);
        if (Build.VERSION.SDK_INT >= 29) {
            try { s.setForceDark(WebSettings.FORCE_DARK_OFF); } catch (Throwable ignored) { }
        }
        web.setBackgroundColor(0xFFF0F4F8);
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                String host = u.getHost() == null ? "" : u.getHost();
                // 应用自己的页面留在壳里；别的（GitHub 仓库页等）丢给系统浏览器
                if (HOME_HOST.equals(host) && "https".equals(u.getScheme())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Throwable ignored) { }
                return true;
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                // 给应用一个逃生口：真出问题时可以远程打点，暂不启用
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                // 主文档加载失败（多半是没网且还没缓存）→ 离线重试页
                if (req.isForMainFrame()) {
                    web.loadUrl("file:///android_asset/offline.html");
                }
            }
            @Override
            public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
                // WebView 渲染进程崩了（内存压力）——重建而不是留一张死白屏
                recreate();
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            // ---- JS 三兄弟，缺一个应用的关键操作就静默失败 ----
            @Override
            public boolean onJsAlert(WebView v, String url, String msg, JsResult r) {
                new android.app.AlertDialog.Builder(MainActivity.this)
                        .setMessage(msg)
                        .setPositiveButton("好", (d, w) -> r.confirm())
                        .setOnCancelListener(d -> r.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView v, String url, String msg, JsResult r) {
                new android.app.AlertDialog.Builder(MainActivity.this)
                        .setMessage(msg)
                        .setPositiveButton("确定", (d, w) -> r.confirm())
                        .setNegativeButton("取消", (d, w) -> r.cancel())
                        .setOnCancelListener(d -> r.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsPrompt(WebView v, String url, String msg, String def, android.webkit.JsPromptResult r) {
                final android.widget.EditText et = new android.widget.EditText(MainActivity.this);
                et.setText(def);
                new android.app.AlertDialog.Builder(MainActivity.this)
                        .setMessage(msg)
                        .setView(et)
                        .setPositiveButton("确定", (d, w) -> r.confirm(et.getText().toString()))
                        .setNegativeButton("取消", (d, w) -> r.cancel())
                        .setOnCancelListener(d -> r.cancel())
                        .show();
                return true;
            }

            // ---- <input type=file>：题目图片（可多选）和 PDF 导入 ----
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                String[] accept = p == null ? null : p.getAcceptTypes();
                LinkedHashSet<String> mimes = new LinkedHashSet<>();
                if (accept != null) {
                    for (String a : accept) {
                        if (a != null && a.contains("/")) mimes.add(a);   // image/* / application/pdf
                    }
                }
                if (mimes.size() == 1) i.setType(mimes.iterator().next());
                else if (mimes.size() > 1) i.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toArray(new String[0]));
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(Intent.createChooser(i, "选择文件"), REQ_FILE);
                } catch (Throwable e) {
                    fileCb = null;
                    return false;
                }
                return true;
            }

        });

        // ---- 下载（jsPDF 导出 / 练习纸 HTML）。blob: 只能走 JS 桥接 ----
        web.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String ua, String cd, String mime, long len) {
                pendingMime = mime == null ? "application/octet-stream" : mime;
                pendingName = nameFrom(cd, mime);
                if (url.startsWith("blob:")) {
                    String js = "(function(){" +
                            "fetch('" + url + "').then(function(r){return r.blob()})" +
                            ".then(function(b){var fr=new FileReader();" +
                            "fr.onload=function(){AndroidBridge.saveBase64(" + jstr(pendingName) + ", " +
                            "fr.result.split(',')[1], " + jstr(pendingMime) + ")};" +
                            "fr.readAsDataURL(b)})" +
                            ".catch(function(e){AndroidBridge.saveFailed()})})()";
                    web.evaluateJavascript(js, null);
                } else if (url.startsWith("http")) {
                    DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    dm.enqueue(new DownloadManager.Request(Uri.parse(url))
                            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED));
                }
            }
        });

        if (b == null) web.loadUrl(HOME);
    }

    private static String jstr(String s) {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    /** contentDisposition 里的 filename，取不到就按 mime 起个名字 */
    private static String nameFrom(String cd, String mime) {
        if (cd != null) {
            int i = cd.indexOf("filename=");
            if (i >= 0) {
                String n = cd.substring(i + 9).replace("\"", "").replace(";", "").trim();
                if (!n.isEmpty()) return n;
            }
        }
        if (mime != null && mime.contains("pdf")) return "错题导出.pdf";
        if (mime != null && mime.contains("html")) return "错题练习纸.html";
        return "导出文件";
    }

    // ---------- 文件选择结果 ----------
    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == REQ_FILE) {
            if (fileCb == null) return;
            Uri[] out = null;
            if (res == RESULT_OK && data != null) {
                java.util.ArrayList<Uri> list = new java.util.ArrayList<>();
                if (data.getClipData() != null) {
                    for (int i = 0; i < data.getClipData().getItemCount(); i++)
                        list.add(data.getClipData().getItemAt(i).getUri());
                } else if (data.getData() != null) {
                    list.add(data.getData());
                }
                if (!list.isEmpty()) out = list.toArray(new Uri[0]);
            }
            fileCb.onReceiveValue(out);
            fileCb = null;
            return;
        }
        super.onActivityResult(req, res, data);
    }

    // ---------- 返回键：双击退出。第一下先把没落库的笔迹抢存一次 ----------
    @Override
    public void onBackPressed() {
        long now = System.currentTimeMillis();
        if (now - lastBack < 2000) {
            // 尽力冲一次存档再退（IndexedDB 是异步的，双击的 2 秒窗口足够）
            try {
                web.evaluateJavascript(
                    "(function(){try{if(window.inkPad&&inkPad.note&&inkPad.saveFn)inkPad.saveFn()}catch(e){}})()",
                    null);
            } catch (Throwable ignored) { }
            finish();
            return;
        }
        lastBack = now;
        try {
            web.evaluateJavascript(
                "(function(){try{if(window.inkPad&&inkPad.note&&inkPad.saveFn)inkPad.saveFn()}catch(e){}})()",
                null);
        } catch (Throwable ignored) { }
        Toast.makeText(this, "再按一次退出（正在保存手写…）", Toast.LENGTH_SHORT).show();
    }

    @Override
    protected void onPause() {
        super.onPause();
        try {
            web.evaluateJavascript(
                "(function(){try{if(window.inkPad&&inkPad.note&&inkPad.saveFn)inkPad.saveFn()}catch(e){}})()",
                null);
        } catch (Throwable ignored) { }
    }

    @Override
    protected void onDestroy() {
        if (dlDone != null) { try { unregisterReceiver(dlDone); } catch (Throwable ignored) { } }
        if (web != null) web.destroy();
        if (printWeb != null) { try { printWeb.destroy(); } catch (Throwable ignored) { } }
        super.onDestroy();
    }

    // ---------- JS 桥：blob 下载 ----------
    private class Bridge {
        @JavascriptInterface
        public void saveBase64(final String name, final String b64, final String mime) {
            try {
                // android.util.Base64：java.util.Base64 要 API 26，minSdk 24 上会崩
                byte[] bytes = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
                final String shown;
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    cv.put(MediaStore.Downloads.MIME_TYPE, mime);
                    Uri uri = getContentResolver().insert(
                            MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    if (uri == null) throw new IllegalStateException("无法创建下载项");
                    try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                        os.write(bytes);
                    }
                    shown = name;
                } else {
                    // Android 9 及以下：需要存储权限，写公共下载目录
                    if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                            != PackageManager.PERMISSION_GRANTED) {
                        requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_PERM);
                        // 没权限就落到应用私有目录，至少不丢
                        File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                        File f = new File(dir, name);
                        try (FileOutputStream fo = new FileOutputStream(f)) { fo.write(bytes); }
                        shown = "已保存到应用目录：" + f.getAbsolutePath();
                    } else {
                        File dir = Environment.getExternalStoragePublicDirectory(
                                Environment.DIRECTORY_DOWNLOADS);
                        if (!dir.exists()) dir.mkdirs();
                        File f = new File(dir, name);
                        try (FileOutputStream fo = new FileOutputStream(f)) { fo.write(bytes); }
                        shown = "已保存到 下载/" + name;
                    }
                }
                new Handler(Looper.getMainLooper()).post(() ->
                        Toast.makeText(MainActivity.this, "已保存：" + shown, Toast.LENGTH_LONG).show());
            } catch (Throwable e) {
                new Handler(Looper.getMainLooper()).post(() ->
                        Toast.makeText(MainActivity.this, "保存失败：" + e.getMessage(), Toast.LENGTH_LONG).show());
            }
        }

        @JavascriptInterface
        public void saveFailed() {
            new Handler(Looper.getMainLooper()).post(() ->
                    Toast.makeText(MainActivity.this, "导出失败，请重试", Toast.LENGTH_SHORT).show());
        }

        /** 当前壳版本（"versionCode|versionName"），网页拿它和 apk-version.json 对比 */
        @JavascriptInterface
        public String appVer() {
            try {
                android.content.pm.PackageInfo pi =
                        getPackageManager().getPackageInfo(getPackageName(), 0);
                return pi.versionCode + "|" + pi.versionName;
            } catch (Throwable e) { return "0|0"; }
        }

        /** 下载新版 APK 并在完成后弹安装（覆盖安装，数据不动）。
            顺手先把「安装未知应用」的开关引出来，用户批的时候下载正好在跑。 */
        @JavascriptInterface
        public void updateApk(final String url, final String name) {
            new Handler(Looper.getMainLooper()).post(() -> {
                try {
                    if (Build.VERSION.SDK_INT >= 26 &&
                            !getPackageManager().canRequestPackageInstalls()) {
                        requestPermissions(new String[]{
                                "android.permission.REQUEST_INSTALL_PACKAGES"}, REQ_NOTIF);
                    }
                    DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    apkDlId = dm.enqueue(new DownloadManager.Request(Uri.parse(url))
                            .setTitle(name)
                            .setMimeType("application/vnd.android.package-archive")
                            .setNotificationVisibility(
                                    DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED));
                    Toast.makeText(MainActivity.this, "正在下载更新…", Toast.LENGTH_SHORT).show();
                } catch (Throwable e) {
                    Toast.makeText(MainActivity.this,
                            "下载失败：" + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            });
        }

        /** 网页的「打印练习纸」：WebView 里 iframe.print() 是静默空操作，
            把整份 HTML 拿过来，用离屏 WebView 渲染后交给系统打印服务。 */
        @JavascriptInterface
        public void printHtml(final String name, final String html) {
            new Handler(Looper.getMainLooper()).post(() -> startPrint(name, html));
        }

        /** 立刻弹一条系统通知（「试一下」按钮 / 网页开着时到点提醒）。
            名字刻意不叫 notify：和 Object.notify() 撞名在部分设备上有诡异行为。 */
        @JavascriptInterface
        public void notif(final String id, final String title, final String body) {
            new Handler(Looper.getMainLooper()).post(() -> {
                if (!notifOkOrAsk()) return;
                RemindUtil.post(MainActivity.this, title, body);
            });
        }

        /** 网页设置页保存提醒时调用：存时间 + 排/撤闹钟（APP 关着也会到点响）。 */
        @JavascriptInterface
        public void scheduleReminder(final int on, final String hhmm) {
            new Handler(Looper.getMainLooper()).post(() -> {
                RemindUtil.prefs(MainActivity.this).edit()
                        .putBoolean("on", on == 1)
                        .putString("time", hhmm == null ? "20:00" : hhmm)
                        .apply();
                RemindUtil.cancel(MainActivity.this);
                if (on == 1) {
                    if (notifOkOrAsk()) {
                        RemindUtil.scheduleNext(MainActivity.this);
                        Toast.makeText(MainActivity.this,
                                "已设置每天 " + hhmm + " 提醒", Toast.LENGTH_SHORT).show();
                    } else {
                        // 没通知权限也先把闹钟排上（权限随时可以再开），但不能不吭声
                        RemindUtil.scheduleNext(MainActivity.this);
                    }
                }
            });
        }

        /** 通知权限：13+ 要运行时申请。没权限返回 false（并顺手续上申请）。 */
        private boolean notifOkOrAsk() {
            if (Build.VERSION.SDK_INT < 33) return true;
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                    == PackageManager.PERMISSION_GRANTED) return true;
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF);
            Toast.makeText(MainActivity.this, "请允许通知权限，提醒才能弹出来", Toast.LENGTH_LONG).show();
            return false;
        }
    }

    /** 练习纸打印：离屏 WebView 加载 HTML，进度 100 后再等半秒（KaTeX/图片
        渲染收尾），然后交给 PrintManager 弹系统打印界面。只触发一次（进度
        回调可能多次到 100）。 */
    private void startPrint(final String name, final String html) {
        if (printWeb != null) { try { printWeb.destroy(); } catch (Throwable ignored) { } }
        printWeb = new WebView(this);
        printWeb.getSettings().setJavaScriptEnabled(true);
        final boolean[] fired = {false};
        printWeb.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView v, int p) {
                if (p >= 100 && !fired[0]) {
                    fired[0] = true;
                    new Handler(Looper.getMainLooper()).postDelayed(() -> doPrint(v, name), 600);
                }
            }
        });
        printWeb.loadDataWithBaseURL(HOME, html, "text/html", "utf-8", null);
    }

    private void doPrint(WebView v, String name) {
        try {
            PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
            pm.print(name, v.createPrintDocumentAdapter(name),
                    new PrintAttributes.Builder()
                            .setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
        } catch (Throwable e) {
            Toast.makeText(this, "调起打印失败：" + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    /** 下载完了的 APK 弹系统安装界面。Android 7-9 的 DownloadManager 给的是
        file:// URI，targetSdk 24+ 直接 startActivity 会 FileUriExposedException，
        放宽一次 VmPolicy 是无 androidx 依赖下的标准替代（10+ 走 content:// 不受影响）。 */
    private void installApk(long id) {
        try {
            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            Uri uri = dm.getUriForDownloadedFile(id);
            if (uri == null) return;
            if (Build.VERSION.SDK_INT < 29) {
                StrictMode.setVmPolicy(new StrictMode.VmPolicy.Builder().penaltyLog().build());
            }
            Intent it = new Intent(Intent.ACTION_VIEW);
            it.setDataAndType(uri, "application/vnd.android.package-archive");
            it.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(it);
        } catch (Throwable e) {
            Toast.makeText(this, "请到「下载」里手动安装：" + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }
}
