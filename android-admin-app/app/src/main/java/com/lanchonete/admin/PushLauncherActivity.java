package com.lanchonete.dois.admin;

import android.Manifest;
import android.app.NotificationManager;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;

public class PushLauncherActivity extends MainActivity {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 6201;
    private static final long RETRY_INTERVAL_MS = 10000L;
    private static final long SPLASH_VISIBLE_MS = 1500L;

    private final Handler pushHandler = new Handler(Looper.getMainLooper());
    private boolean pushLoopRunning = false;
    private SplashView splashView;

    private final Runnable pushRegistrationLoop = new Runnable() {
        @Override
        public void run() {
            if (!pushLoopRunning) return;
            PushClient.registerCurrentToken(PushLauncherActivity.this);
            pushHandler.postDelayed(this, RETRY_INTERVAL_MS);
        }
    };

    private final Runnable hideSplashRunnable = this::hideSplash;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        showSplash();

        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        AdminFirebaseMessagingService.ensureChannel(manager);
        PushClient.initialize(this);

        pushHandler.postDelayed(() -> {
            requestNotificationPermissionIfNeeded();
        }, SPLASH_VISIBLE_MS + 300L);
    }

    private void showSplash() {
        splashView = new SplashView(this);
        addContentView(
                splashView,
                new ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                )
        );
        splashView.bringToFront();
        splashView.setAlpha(1f);
        pushHandler.removeCallbacks(hideSplashRunnable);
        pushHandler.postDelayed(hideSplashRunnable, SPLASH_VISIBLE_MS);
    }

    private void hideSplash() {
        final SplashView current = splashView;
        if (current == null) return;

        current.stopAnimation();
        current.animate()
                .alpha(0f)
                .setDuration(260L)
                .withEndAction(() -> {
                    if (current.getParent() instanceof ViewGroup) {
                        ((ViewGroup) current.getParent()).removeView(current);
                    }
                    if (splashView == current) splashView = null;
                })
                .start();
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
        pushHandler.removeCallbacks(hideSplashRunnable);
        if (splashView != null) splashView.stopAnimation();
        splashView = null;
        super.onDestroy();
    }
}
