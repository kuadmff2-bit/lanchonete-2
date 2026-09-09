package com.lanchonete.dois.admin;

import android.content.Context;
import android.util.Log;
import android.webkit.CookieManager;

import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public final class PushClient {
    private static final String TAG = "LanchonetePush";
    private static final String BASE_URL = "https://lanchonete-2.kuadmff2.workers.dev";
    private static final String REGISTER_URL = BASE_URL + "/api/push/register";
    private static final String CONFIG_URL = BASE_URL + "/api/push/config";
    private static final String APP_USER_AGENT = "LanchoneteAdminApp/2.0-l2";

    private static volatile boolean configRequestInProgress = false;
    private static volatile long nextConfigAttemptAt = 0L;

    private PushClient() {}

    public static boolean initialize(Context context) {
        try {
            if (!FirebaseApp.getApps(context).isEmpty()) return true;

            String apiKey = context.getString(R.string.firebase_api_key).trim();
            String appId = context.getString(R.string.firebase_app_id).trim();
            String projectId = context.getString(R.string.firebase_project_id).trim();
            String senderId = context.getString(R.string.firebase_messaging_sender_id).trim();
            return initializeWithValues(context, apiKey, appId, projectId, senderId);
        } catch (Exception error) {
            Log.e(TAG, "Falha ao iniciar Firebase", error);
            return false;
        }
    }

    private static synchronized boolean initializeWithValues(
            Context context,
            String apiKey,
            String appId,
            String projectId,
            String senderId
    ) {
        try {
            if (!FirebaseApp.getApps(context).isEmpty()) return true;
            if (apiKey == null || apiKey.trim().isEmpty()
                    || appId == null || appId.trim().isEmpty()
                    || projectId == null || projectId.trim().isEmpty()
                    || senderId == null || senderId.trim().isEmpty()) {
                return false;
            }

            FirebaseOptions options = new FirebaseOptions.Builder()
                    .setApiKey(apiKey.trim())
                    .setApplicationId(appId.trim())
                    .setProjectId(projectId.trim())
                    .setGcmSenderId(senderId.trim())
                    .build();

            FirebaseApp.initializeApp(context.getApplicationContext(), options);
            Log.i(TAG, "Firebase inicializado.");
            return true;
        } catch (Exception error) {
            Log.e(TAG, "Falha ao inicializar Firebase", error);
            return false;
        }
    }

    public static void registerCurrentToken(Context context) {
        if (initialize(context)) {
            requestFirebaseToken(context);
            return;
        }
        loadRemoteConfig(context);
    }

    private static void requestFirebaseToken(Context context) {
        try {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                if (!task.isSuccessful() || task.getResult() == null) return;
                registerToken(context, task.getResult());
            });
        } catch (Exception error) {
            Log.w(TAG, "Firebase ainda não está pronto para gerar token.", error);
        }
    }

    private static void loadRemoteConfig(Context context) {
        long now = System.currentTimeMillis();
        if (configRequestInProgress || now < nextConfigAttemptAt) return;
        configRequestInProgress = true;
        nextConfigAttemptAt = now + 30000L;

        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(CONFIG_URL).openConnection();
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(10000);
                connection.setReadTimeout(10000);
                connection.setRequestProperty("User-Agent", APP_USER_AGENT);

                if (connection.getResponseCode() < 200 || connection.getResponseCode() >= 300) return;

                StringBuilder text = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(
                        new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) text.append(line);
                }

                JSONObject data = new JSONObject(text.toString());
                if (!data.optBoolean("configured", false)) {
                    nextConfigAttemptAt = System.currentTimeMillis() + 60000L;
                    return;
                }

                boolean ready = initializeWithValues(
                        context,
                        data.optString("apiKey", ""),
                        data.optString("appId", ""),
                        data.optString("projectId", ""),
                        data.optString("senderId", "")
                );
                if (ready) requestFirebaseToken(context);
            } catch (Exception error) {
                Log.w(TAG, "Configuração Firebase ainda não disponível.", error);
                nextConfigAttemptAt = System.currentTimeMillis() + 60000L;
            } finally {
                configRequestInProgress = false;
                if (connection != null) connection.disconnect();
            }
        }, "firebase-config").start();
    }

    public static void registerToken(Context context, String token) {
        if (token == null || token.trim().isEmpty()) return;

        String cookies = CookieManager.getInstance().getCookie(BASE_URL);
        if (cookies == null || !cookies.contains("lanchonete_admin_session=")) return;

        String cleanToken = token.trim();
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(REGISTER_URL).openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(10000);
                connection.setReadTimeout(10000);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setRequestProperty("Cookie", cookies);
                connection.setRequestProperty("User-Agent", APP_USER_AGENT);

                String escaped = cleanToken.replace("\\", "\\\\").replace("\"", "\\\"");
                byte[] body = ("{\"token\":\"" + escaped + "\"}").getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(body.length);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(body);
                }

                int code = connection.getResponseCode();
                if (code >= 200 && code < 300) {
                    context.getSharedPreferences("push", Context.MODE_PRIVATE)
                            .edit()
                            .putString("registered_token", cleanToken)
                            .apply();
                    Log.i(TAG, "Aparelho registrado para notificações.");
                } else {
                    Log.w(TAG, "Servidor recusou registro de push: " + code);
                }
            } catch (Exception error) {
                Log.w(TAG, "Não foi possível registrar o token agora.", error);
            } finally {
                if (connection != null) connection.disconnect();
            }
        }, "push-register").start();
    }
}
