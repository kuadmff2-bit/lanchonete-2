package com.lanchonete.dois.admin;

import android.Manifest;
import android.app.NotificationManager;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

public class PushLauncherActivity extends MainActivity {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 6201;
    private static final long RETRY_INTERVAL_MS = 10000L;

    private final Handler pushHandler = new Handler(Looper.getMainLooper());
    private boolean pushLoopRunning = false;

    private final Runnable pushRegistrationLoop = new Runnable() {
        @Override
        public void run() {
            if (!pushLoopRunning) return;
            PushClient.registerCurrentToken(PushLauncherActivity.this);
            pushHandler.postDelayed(this, RETRY_INTERVAL_MS);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        AdminFirebaseMessagingService.ensureChannel(manager);
        PushClient.initialize(this);

        pushHandler.postDelayed(() -> {
            requestNotificationPermissionIfNeeded();
        }, 1200L);
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(
                    new String[]{Manifest.permission.POST_NOTIFICATIONS},
                    NOTIFICATION_PERMISSION_REQUEST
            );
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        pushLoopRunning = true;
        pushHandler.removeCallbacks(pushRegistrationLoop);
        pushHandler.postDelayed(pushRegistrationLoop, 1200L);
    }

    @Override
    protected void onPause() {
        pushLoopRunning = false;
        pushHandler.removeCallbacks(pushRegistrationLoop);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        pushLoopRunning = false;
        pushHandler.removeCallbacks(pushRegistrationLoop);
        super.onDestroy();
    }
}
