package com.cuotiben.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 重启后闹钟会全部清空，开机把提醒重新排上。 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i){
        if(Intent.ACTION_BOOT_COMPLETED.equals(i.getAction())) RemindUtil.scheduleNext(c);
    }
}
