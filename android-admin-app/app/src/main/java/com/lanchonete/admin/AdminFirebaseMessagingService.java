package com.lanchonete.dois.admin;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.Context;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public class AdminFirebaseMessagingService extends FirebaseMessagingService {
    public static final String CHANNEL_ID = "new_orders";

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        PushClient.registerToken(this, token);
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        super.onMessageReceived(message);

        String title = "Novo pedido!";
        String body = "Confirme o novo pedido.";

        if (message.getNotification() != null) {
            if (message.getNotification().getTitle() != null && !message.getNotification().getTitle().isEmpty()) {
                title = message.getNotification().getTitle();
            }
            if (message.getNotification().getBody() != null && !message.getNotification().getBody().isEmpty()) {
                body = message.getNotification().getBody();
            }
        }

        String orderId = message.getData().get("orderId");
        showOrderNotification(this, title, body, orderId);
    }

    public static void ensureChannel(NotificationManager manager) {
        if (manager == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Novos pedidos",
                NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Avisos imediatos quando entrar um novo pedido");
        channel.enableVibration(true);
        channel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), null);
        manager.createNotificationChannel(channel);
    }

    public static void showOrderNotification(Context context, String title, String body, String orderId) {
        if (orderId != null && !orderId.isEmpty()) {
            String preferenceKey = "notified_" + orderId;
            long lastNotification = context.getSharedPreferences("push", Context.MODE_PRIVATE)
                    .getLong(preferenceKey, 0L);
            if (System.currentTimeMillis() - lastNotification < 60000L) return;
            context.getSharedPreferences("push", Context.MODE_PRIVATE)
                    .edit()
                    .putLong(preferenceKey, System.currentTimeMillis())
                    .apply();
        }

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        ensureChannel(manager);

        Intent intent = new Intent(context, PushLauncherActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.putExtra("open_orders", true);
        if (orderId != null) intent.putExtra("order_id", orderId);

        int requestCode = orderId == null ? (int) System.currentTimeMillis() : orderId.hashCode();
        PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(context, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(context);
            builder.setPriority(Notification.PRIORITY_HIGH);
            builder.setSound(sound);
            builder.setVibrate(new long[]{0, 250, 120, 250});
        }

        builder
                .setSmallIcon(R.drawable.app_icon)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent);

        manager.notify(requestCode, builder.build());
    }
}
