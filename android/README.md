# 平板 APK（WebView 壳）

「错了没-平板版.apk」是一个极薄的 Android WebView 壳：直接加载线上 PWA
（https://1140474506.github.io/cuotiben-app/），数据存在 WebView 自己的
IndexedDB 里，同步走应用内置的 GitHub 通道——所以平板、电脑、苹果打开的都是
同一份云端数据，互相同步。

壳里补齐了裸 WebView 缺的几件事（少了任何一个网页在平板上就是残废）：

- **alert / confirm / prompt**：WebView 默认不弹 JS 对话框。不实现的话，
  「确定删除？」会静默返回 false，所有删除按钮看起来全坏。
- **文件选择器**：题目图片上传、PDF 导入用的 `<input type=file>` 默认点了没反应。
- **blob: 下载**：jsPDF 导出 PDF / 下载练习纸在 WebView 里没有系统下载器接管，
  走 JS 桥（blob → base64 → 存进系统「下载」目录）。
- **双击返回退出**：第一下先把没落库的手写抢存一次再提示，防误退丢笔迹。
- **渲染进程崩溃自愈**：内存压力大时 WebView 渲染进程被杀，自动重建 Activity。
- **离线兜底页**：断网且无缓存时给一个重试页。

## 重新打包

改完网页（push 到仓库）后 APK **不需要重打**——壳加载的是线上地址，刷新即最新。
只有改壳本身（MainActivity.java / 图标 / manifest）才需要重新打包：

1. 按 `build_apk.sh` 头部注释准备 build-tools / android-33 / JDK 17（国内镜像可下），
   全部解压到**纯 ASCII 路径**（aapt2 不认中文路径）。
2. 在 keystore 同目录放 `keystore.pass`（签名密码，不要提交）。
3. `BT=... PF=... JAVA=... KS=... bash build_apk.sh`

签名密钥（cuotiben.keystore）在本地 `_android/` 目录，**务必备份**：丢了它，
以后的新版 APK 就只能卸载重装（数据在云端，不会丢）。
