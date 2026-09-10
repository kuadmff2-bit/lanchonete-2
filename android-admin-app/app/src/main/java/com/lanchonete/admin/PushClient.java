package com.lanchonete.dois.admin;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import android.webkit.CookieManager;

import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
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
    private static final String APP_USER_AGENT = "LanchoneteAdminApp/1.3-l2";
    private static final long MIN_REGISTER_INTERVAL_MS = 30000L;

    private static volatile boolean configRequestInProgress = false;
    private static volatile boolean tokenRequestInProgress = false;
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
        Context appContext = context.getApplicationContext();
        if (initialize(appContext)) {
            requestFirebaseToken(appContext);
            return;
        }
        loadRemoteConfig(appContext);
    }

    private static synchronized void requestFirebaseToken(Context context) {
        if (tokenRequestInProgress) return;
        tokenRequestInProgress = true;

        try {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                tokenRequestInProgress = false;
                if (!task.isSuccessful() || task.getResult() == null || task.getResult().trim().isEmpty()) {
                    Exception error = task.getException();
                    if (error != null) Log.w(TAG, "Firebase não entregou o token do aparelho.", error);
                    else Log.w(TAG, "Firebase não entregou o token do aparelho.");
                    return;
                }
                registerToken(context, task.getResult());
            });
        } catch (Exception error) {
            tokenRequestInProgress = false;
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

                int code = connection.getResponseCode();
                if (code < 200 || code >= 300) return;

                JSONObject data = new JSONObject(readResponse(connection));
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

        Context appContext = context.getApplicationContext();
        String cookies = CookieManager.getInstance().getCookie(BASE_URL);
        String appToken = BuildConfig.ADMIN_APP_TOKEN == null ? "" : BuildConfig.ADMIN_APP_TOKEN.trim();
        if ((cookies == null || !cookies.contains("lanchonete_admin_session=")) && appToken.isEmpty()) {
            Log.w(TAG, "Registro de push aguardando autenticação do APK.");
            return;
        }

        String cleanToken = token.trim();
        SharedPreferences preferences = appContext.getSharedPreferences("push", Context.MODE_PRIVATE);
        String registeredToken = preferences.getString("registered_token", "");
        long registeredAt = preferences.getLong("registered_at", 0L);
        if (cleanToken.equals(registeredToken)
                && System.currentTimeMillis() - registeredAt < MIN_REGISTER_INTERVAL_MS) {
            return;
        }

        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(REGISTER_URL).openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(10000);
                connection.setReadTimeout(10000);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                if (cookies != null && !cookies.isEmpty()) connection.setRequestProperty("Cookie", cookies);
                if (!appToken.isEmpty()) connection.setRequestProperty("x-admin-app-token", appToken);
                connection.setRequestProperty("User-Agent", APP_USER_AGENT);

                JSONObject payload = new JSONObject();
                payload.put("token", cleanToken);
                byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(body.length);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(body);
                }

                int code = connection.getResponseCode();
                String responseText = readResponse(connection);
                if (code >= 200 && code < 300) {
                    boolean registered = true;
                    boolean serverConfigured = false;
                    try {
                        JSONObject response = new JSONObject(responseText);
                        registered = response.optBoolean("registered", true);
                        serverConfigured = response.optBoolean("configured", false);
                    } catch (Exception ignored) {}

                    preferences.edit()
                            .putString("registered_token", cleanToken)
                            .putLong("registered_at", System.currentTimeMillis())
                            .putBoolean("server_registered", registered)
                            .putBoolean("server_configured", serverConfigured)
                            .apply();

                    if (registered) {
                        Log.i(TAG, "Aparelho registrado no servidor de notificações.");
                    } else {
                        Log.w(TAG, "Servidor respondeu sem confirmar o registro do aparelho.");
                    }
                } else {
                    preferences.edit().putBoolean("server_registered", false).apply();
                    Log.w(TAG, "Servidor recusou registro de push: " + code + " " + responseText);
                }
            } catch (Exception error) {
                Log.w(TAG, "Não foi possível registrar o token agora.", error);
            } finally {
                if (connection != null) connection.disconnect();
            }
        }, "push-register").start();
    }

    public static boolean isServerRegistered(Context context) {
        return context.getSharedPreferences("push", Context.MODE_PRIVATE)
                .getBoolean("server_registered", false);
    }

    public static long getLastRegistrationAt(Context context) {
        return context.getSharedPreferences("push", Context.MODE_PRIVATE)
                .getLong("registered_at", 0L);
    }

    private static String readResponse(HttpURLConnection connection) throws Exception {
        InputStream stream;
        int code = connection.getResponseCode();
        if (code >= 200 && code < 400) stream = connection.getInputStream();
        else stream = connection.getErrorStream();
        if (stream == null) return "";

        StringBuilder text = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) text.append(line);
        }
        return text.toString();
    }
}
