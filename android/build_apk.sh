#!/bin/bash
# 打包「错了没」平板 APK（WebView 壳，加载线上 PWA）。
# 不依赖 Android Studio / Gradle，只要三样东西：
#   1) Android build-tools（含 aapt2 / zipalign，腾讯镜像可下）
#   2) platform android-33 的 android.jar（腾讯镜像 platform-33_r02.zip）
#   3) JDK 17（华为镜像 mirrors.huaweicloud.com/openjdk/）
# 注意：aapt2 处理不了含中文的路径，所有东西放在纯 ASCII 路径下构建。
#
# 用法：把 BT/PF/JDK 指到你的解压位置，然后  bash build_apk.sh
# 签名密码从 keystore.pass 文件读（该文件不要提交进仓库）。
set -e
BT="${BT:-E:/cbbuild/bt/android-14}"
PF="${PF:-E:/cbbuild/pf/android-13}"
JAVA="${JAVA:-E:/cbbuild/jdk/jdk-17.0.2/bin/java.exe}"
JAVAC="${JAVAC:-E:/cbbuild/jdk/jdk-17.0.2/bin/javac.exe}"
KEYTOOL="${KEYTOOL:-E:/cbbuild/jdk/jdk-17.0.2/bin/keytool.exe}"
KS="${KS:-E:/cbbuild/cuotiben.keystore}"
APP="$(cd "$(dirname "$0")" && pwd)"
OUT="$APP/../build"
PASS="$(cat "$(dirname "$KS")/keystore.pass" 2>/dev/null)"
[ -z "$PASS" ] && { echo "缺签名密码：在 $KS 同目录放 keystore.pass"; exit 1; }

rm -rf "$OUT"; mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex"

echo "== 1/6 编译资源 =="
"$BT/aapt2.exe" compile --dir "$APP/res" -o "$OUT/res.zip"

echo "== 2/6 链接资源 + R.java =="
"$BT/aapt2.exe" link -o "$OUT/base.apk" -I "$PF/android.jar" \
  --manifest "$APP/AndroidManifest.xml" -A "$APP/assets" \
  --java "$OUT/gen" --auto-add-overlay "$OUT/res.zip"

echo "== 3/6 javac（lambda 需要 core-lambda-stubs）=="
"$JAVAC" -encoding UTF-8 -source 1.8 -target 1.8 -nowarn \
  -bootclasspath "$PF/android.jar;$BT/core-lambda-stubs.jar" \
  -classpath "$PF/android.jar" \
  -d "$OUT/classes" \
  "$OUT/gen/com/cuotiben/app/R.java" \
  $(find "$APP/src" -name "*.java")

echo "== 4/6 d8 打 dex =="
"$JAVA" -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 --release \
  --lib "$PF/android.jar" --output "$OUT/dex" \
  $(find "$OUT/classes" -name "*.class")

echo "== 5/6 组包 + zipalign =="
JAR="${JAVA%java.exe}jar.exe"
(cd "$OUT/dex" && "$JAR" -uf "$OUT/base.apk" classes.dex)
"$BT/zipalign.exe" -f 4 "$OUT/base.apk" "$OUT/aligned.apk"

echo "== 6/6 签名 =="
if [ ! -f "$KS" ]; then
  "$KEYTOOL" -genkeypair -keystore "$KS" -alias cuotiben \
    -keyalg RSA -keysize 2048 -validity 10950 \
    -storepass "$PASS" -keypass "$PASS" \
    -dname "CN=cuotiben, OU=personal, O=cuotiben, C=CN"
fi
"$JAVA" -cp "$BT/lib/apksigner.jar" com.android.apksigner.ApkSignerTool \
  sign --ks "$KS" --ks-pass "pass:$PASS" --key-pass "pass:$PASS" \
  --out "$OUT/../错了没-平板版.apk" "$OUT/aligned.apk"
echo "完成：$OUT/../错了没-平板版.apk"
