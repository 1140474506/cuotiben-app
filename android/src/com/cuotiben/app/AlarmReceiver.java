package com.cuotiben.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 闹钟到点：弹通知 + 排明天的（AlarmManager 没有「每天重复且守时」的可靠 API，
    setRepeating 在打盹模式下会漂移，手动滚动续命是标准做法）。 */
public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i){
        RemindUtil.post(c, "错了没 ⏰", "今天的错题该复盘了，别让它们过夜 📚");
        RemindUtil.scheduleNext(c);
    }
}
