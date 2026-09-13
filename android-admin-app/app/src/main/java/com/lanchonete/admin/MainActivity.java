package com.lanchonete.dois.admin;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

public class MainActivity extends Activity {
    private static final String ADMIN_URL = "https://lanchonete-2.kuadmff2.workers.dev/admin?v=20260913-nativefix5";
    private static final String ALLOWED_HOST = "lanchonete-2.kuadmff2.workers.dev";
    private static final String APP_USER_AGENT = "LanchoneteAdminApp/1.3-l2-nativefix5";
    private static final int FILE_CHOOSER_REQUEST = 4102;
    private static final long SPLASH_MAX_MS = 2500L;

    private final Handler uiHandler = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private WebView webView;
    private SplashView splashView;
    private ValueCallback<Uri[]> filePathCallback;
    private boolean splashRemoved = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(238, 244, 255));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(238, 244, 255));
        webView.setVisibility(View.VISIBLE);
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));

        splashView = new SplashView(this);
        root.addView(splashView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));

        setContentView(root);
        configureWebView();

        webView.clearCache(true);
        webView.loadUrl(ADMIN_URL);
        uiHandler.postDelayed(this::removeSplash, SPLASH_MAX_MS);
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        webView.addJavascriptInterface(new AdminBridge(), "AdminBridge");

        String currentUserAgent = settings.getUserAgentString();
        if (currentUserAgent == null) currentUserAgent = "";
        if (!currentUserAgent.contains("LanchoneteAdminApp/")) {
            settings.setUserAgentString((currentUserAgent + " " + APP_USER_AGENT).trim());
        }

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                if (host != null && host.equalsIgnoreCase(ALLOWED_HOST)) return false;
                openExternal(uri);
                return true;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri uri = Uri.parse(url);
                String host = uri.getHost();
                if (host != null && host.equalsIgnoreCase(ALLOWED_HOST)) return false;
                openExternal(uri);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (url != null && url.contains("/admin")) {
                    forceShowPanel();
                    removeSplash();
                    refreshAdminData();
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request != null && request.isForMainFrame()) {
                    removeSplash();
                    Toast.makeText(MainActivity.this, "Não foi possível carregar o painel. Verifique a internet e tente novamente.", Toast.LENGTH_LONG).show();
                }
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                super.onReceivedHttpError(view, request, errorResponse);
                if (request != null && request.isForMainFrame()) removeSplash();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallbackNew, FileChooserParams fileChooserParams) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = filePathCallbackNew;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("image/*");
                try {
                    startActivityForResult(Intent.createChooser(intent, "Escolher imagem"), FILE_CHOOSER_REQUEST);
                    return true;
                } catch (ActivityNotFoundException e) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "Não foi possível abrir a galeria.", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });

        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            webView.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_YES);
        }
    }

    private void forceShowPanel() {
        if (webView == null) return;
        String script = "(()=>{" +
                "document.documentElement.dataset.adminApp='true';" +
                "document.documentElement.dataset.apkReady='1';" +
                "const login=document.querySelector('#loginPanel');" +
                "const app=document.querySelector('#adminApp');" +
                "const logout=document.querySelector('#logoutButton');" +
                "if(login)login.hidden=true;if(app)app.hidden=false;if(logout)logout.hidden=true;" +
                "try{const token=window.AdminBridge&&window.AdminBridge.getToken?window.AdminBridge.getToken():'';if(token&&typeof adminAppToken!=='undefined')adminAppToken=token;}catch(e){}" +
                "})();";
        webView.evaluateJavascript(script, null);
    }

    private void refreshAdminData() {
        if (webView == null) return;
        String script = "(async()=>{" +
                "try{" +
                "const token=window.AdminBridge&&window.AdminBridge.getToken?window.AdminBridge.getToken():'';" +
                "if(!token)throw new Error('token');" +
                "if(typeof adminAppToken!=='undefined')adminAppToken=token;" +
                "const r=await fetch('/api/orders',{cache:'no-store',credentials:'include',headers:{'x-admin-app-token':token}});" +
                "if(!r.ok)throw new Error('orders');" +
                "const d=await r.json();" +
                "if(typeof renderDashboard==='function')renderDashboard(d);" +
                "const tasks=[];" +
                "if(typeof loadProducts==='function')tasks.push(Promise.resolve(loadProducts()));" +
                "if(typeof loadPromotion==='function')tasks.push(Promise.resolve(loadPromotion()));" +
                "if(tasks.length)await Promise.allSettled(tasks);" +
                "}catch(e){const status=document.querySelector('#dashboardStatus');if(status){status.textContent='Não foi possível atualizar os dados agora.';status.className='status error';}}" +
                "})();";
        webView.evaluateJavascript(script, null);
    }

    private void removeSplash() {
        if (splashRemoved) return;
        splashRemoved = true;
        if (webView != null) { webView.setVisibility(View.VISIBLE); webView.setAlpha(1f); }
        if (splashView != null) {
            splashView.stopAnimation();
            if (root != null) root.removeView(splashView);
            splashView = null;
        }
    }

    private void openExternal(Uri uri) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
        catch (ActivityNotFoundException e) { Toast.makeText(this, "Nenhum aplicativo disponível para abrir este link.", Toast.LENGTH_SHORT).show(); }
    }

    private final class AdminBridge {
        @JavascriptInterface public String getToken() { return BuildConfig.ADMIN_APP_TOKEN; }
        @JavascriptInterface public void notifyNewOrder(String orderId, String customerName, String total) {
            runOnUiThread(() -> AdminFirebaseMessagingService.showOrderNotification(MainActivity.this, "Novo pedido!", "Confirme o pedido de " + customerName + " · " + total, orderId));
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST || filePathCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null && data.getData() != null) result = new Uri[]{data.getData()};
        filePathCallback.onReceiveValue(result);
        filePathCallback = null;
    }

    @Override protected void onPause() { CookieManager.getInstance().flush(); super.onPause(); }
    @Override protected void onStop() { CookieManager.getInstance().flush(); super.onStop(); }
    @Override public void onBackPressed() { if (webView != null && webView.canGoBack()) webView.goBack(); else super.onBackPressed(); }

    @Override
    protected void onDestroy() {
        uiHandler.removeCallbacksAndMessages(null);
        CookieManager.getInstance().flush();
        if (splashView != null) { splashView.stopAnimation(); splashView = null; }
        if (webView != null) {
            webView.removeJavascriptInterface("AdminBridge");
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }
        root = null;
        super.onDestroy();
    }
}
