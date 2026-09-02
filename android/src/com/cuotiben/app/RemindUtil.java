package com.cuotiben.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import java.util.Calendar;

/**
 * 复盘提醒的原生侧：AlarmManager 每天定点触发 + 系统通知。
 * 时间由网页设置页经 JS 桥（AndroidBridge.scheduleReminder）传进来，存
 * SharedPreferences —— 这样重启后 BootReceiver 能照着重设闹钟。
 */
public final class RemindUtil {
    static final String CH = "remind";
    static final int NID = 1001;

    private RemindUtil() {}

    static SharedPreferences prefs(Context c){
        return c.getSharedPreferences("remind", Context.MODE_PRIVATE);
    }

    /** 按设置的时间排下一次闹钟（已过点则排明天）。每天都由触发后的重排续命。 */
    static void scheduleNext(Context c){
        SharedPreferences sp = prefs(c);
        if(!sp.getBoolean("on", false)) return;
        int hh = 20, mm = 0;
        try{
            String[] p = sp.getString("time", "20:00").split(":");
            hh = Integer.parseInt(p[0]);
            if(p.length > 1) mm = Integer.parseInt(p[1]);
        }catch(Throwable ignored){ }
        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, hh);
        cal.set(Calendar.MINUTE, mm);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        if(cal.getTimeInMillis() <= System.currentTimeMillis()) cal.add(Calendar.DAY_OF_YEAR, 1);
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = pi(c);
        /* Android 12+ 默认不给精确闹钟权限：退到非精确（打盹时可能晚几分钟，
           对学习提醒完全够用），不能让它抛 SecurityException 把提醒整个弄丢 */
        try{ am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cal.getTimeInMillis(), pi); }
        catch(SecurityException e){ am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cal.getTimeInMillis(), pi); }
    }

    static void cancel(Context c){
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if(am != null) am.cancel(pi(c));
    }

    private static PendingIntent pi(Context c){
        return PendingIntent.getBroadcast(c, 1,
                new Intent(c, AlarmReceiver.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void post(Context c, String title, String body){
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if(nm == null) return;
        if(Build.VERSION.SDK_INT >= 33 &&
                c.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) return;   // 没权限：静默跳过，别崩
        Notification.Builder b;
        if(Build.VERSION.SDK_INT >= 26){
            NotificationChannel ch = new NotificationChannel(
                    CH, "复盘提醒", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("每天到点提醒该复盘错题了");
            nm.createNotificationChannel(ch);
            b = new Notification.Builder(c, CH);
        }else{
            b = new Notification.Builder(c);
        }
        PendingIntent open = PendingIntent.getActivity(c, 0,
                new Intent(c, MainActivity.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        nm.notify(NID, b
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setContentIntent(open)
                .setAutoCancel(true)
                .build());
    }
}
