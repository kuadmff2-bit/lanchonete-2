package com.lanchonete.dois.admin;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

public class MainActivity extends Activity {
    private static final String ADMIN_URL = "https://lanchonete-2.kuadmff2.workers.dev/admin?v=20260910-1";
    private static final String ALLOWED_HOST = "lanchonete-2.kuadmff2.workers.dev";
    private static final String APP_USER_AGENT = "LanchoneteAdminApp/1.3-l2";
    private static final int FILE_CHOOSER_REQUEST = 4102;
    private static final long MIN_SPLASH_MS = 700L;
    private static final int READY_MAX_ATTEMPTS = 180;

    private final Handler uiHandler = new Handler(Looper.getMainLooper());

    private FrameLayout root;
    private WebView webView;
    private SplashView splashView;
    private ValueCallback<Uri[]> filePathCallback;
    private long splashStartedAt;
    private boolean appRevealed = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        splashStartedAt = SystemClock.uptimeMillis();

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(238, 244, 255));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(238, 244, 255));
        webView.setVisibility(View.INVISIBLE);
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

        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.clearCache(true);
            webView.loadUrl(ADMIN_URL);
        }
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        webView.addJavascriptInterface(new AdminBridge(), "AdminBridge");
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

                if (host != null && host.equalsIgnoreCase(ALLOWED_HOST)) {
                    return false;
                }

                openExternal(uri);
                return true;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri uri = Uri.parse(url);
                String host = uri.getHost();

                if (host != null && host.equalsIgnoreCase(ALLOWED_HOST)) {
                    return false;
                }

                openExternal(uri);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (url != null && url.contains("/admin")) {
                    configurePasswordlessUi();
                    restoreAdminSession();
                    installOrderButtonsFallback();
                    waitForAdminReady(0);
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView webView,
                    ValueCallback<Uri[]> filePathCallbackNew,
                    FileChooserParams fileChooserParams
            ) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
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

    private void restoreAdminSession() {
        if (webView == null) return;

        String script = "(async()=>{" +
                "try{" +
                "document.documentElement.dataset.apkReady='0';" +
                "const token=window.AdminBridge&&window.AdminBridge.getToken?window.AdminBridge.getToken():'';" +
                "if(!token)throw new Error('token');" +
                "if(typeof adminAppToken!=='undefined')adminAppToken=token;" +
                "const r=await fetch('/api/orders',{cache:'no-store',credentials:'include',headers:{'x-admin-app-token':token}});" +
                "if(!r.ok)throw new Error('orders');" +
                "const d=await r.json();" +
                "const login=document.querySelector('#loginPanel');" +
                "const app=document.querySelector('#adminApp');" +
                "if(login)login.hidden=true;" +
                "if(app)app.hidden=false;" +
                "if(typeof renderDashboard==='function')renderDashboard(d);" +
                "const tasks=[];" +
                "if(typeof loadProducts==='function')tasks.push(Promise.resolve(loadProducts()));" +
                "if(typeof loadPromotion==='function')tasks.push(Promise.resolve(loadPromotion()));" +
                "if(tasks.length)await Promise.allSettled(tasks);" +
                "document.documentElement.dataset.apkReady='1';" +
                "}catch(e){document.documentElement.dataset.apkReady='error';}" +
                "})();";

        webView.evaluateJavascript(script, null);
    }

    private void waitForAdminReady(final int attempt) {
        if (webView == null || appRevealed) return;

        String check = "(()=>{" +
                "const app=document.querySelector('#adminApp');" +
                "return document.documentElement.dataset.apkReady==='1' && !!app && !app.hidden;" +
                "})()";

        webView.evaluateJavascript(check, value -> {
            if (appRevealed || webView == null) return;

            if ("true".equals(value)) {
                revealAdmin();
                return;
            }

            if (attempt >= READY_MAX_ATTEMPTS) {
                Toast.makeText(
                        MainActivity.this,
                        "Não foi possível atualizar o painel agora. Verifique sua conexão e toque em Atualizar.",
                        Toast.LENGTH_LONG
                ).show();
                String showError = "(()=>{" +
                        "const login=document.querySelector('#loginPanel');" +
                        "const app=document.querySelector('#adminApp');" +
                        "const status=document.querySelector('#dashboardStatus');" +
                        "if(login)login.hidden=true;if(app)app.hidden=false;" +
                        "if(status){status.textContent='Não foi possível atualizar o painel. Verifique a internet e toque em Atualizar.';status.className='status error';}" +
                        "document.documentElement.dataset.apkReady='1';" +
                        "})();";
                webView.evaluateJavascript(showError, ignored -> revealAdmin());
                return;
            }

            uiHandler.postDelayed(() -> waitForAdminReady(attempt + 1), 100L);
        });
    }

    private void revealAdmin() {
        if (appRevealed || webView == null) return;
        appRevealed = true;

        long elapsed = SystemClock.uptimeMillis() - splashStartedAt;
        long delay = Math.max(0L, MIN_SPLASH_MS - elapsed);

        uiHandler.postDelayed(() -> {
            if (webView == null) return;

            webView.setAlpha(0f);
            webView.setVisibility(View.VISIBLE);
            webView.animate().alpha(1f).setDuration(180L).start();

            if (splashView != null) {
                splashView.stopAnimation();
                splashView.animate()
                        .alpha(0f)
                        .setDuration(220L)
                        .withEndAction(() -> {
                            if (root != null && splashView != null) {
                                root.removeView(splashView);
                            }
                            splashView = null;
                        })
                        .start();
            }
        }, delay);
    }

    private void configurePasswordlessUi() {
        if (webView == null) return;

        String script = "(()=>{" +
                "document.documentElement.dataset.adminApp='true';" +
                "const login=document.querySelector('#loginPanel');" +
                "const b=document.querySelector('#logoutButton');" +
                "if(login)login.hidden=true;" +
                "if(b)b.hidden=true;" +
                "})();";

        webView.evaluateJavascript(script, null);
    }

    private void installOrderButtonsFallback() {
        if (webView == null) return;

        String script = "(()=>{" +
                "if(window.__apkOrderButtonsV2)return;window.__apkOrderButtonsV2=1;" +
                "const css=document.createElement('style');" +
                "css.textContent='.apk-order-actions{display:grid;grid-template-columns:1fr;gap:9px;margin-top:10px}.apk-order-btn{min-height:48px;border-radius:12px;border:1px solid #343434;background:#181818;color:#fff;font-weight:800;font-size:13px}.apk-order-btn[data-status=confirmado]{border-color:#4d91db;background:rgba(77,145,219,.12)}.apk-order-btn[data-status=saiu_entrega]{border-color:#9b78e8;background:rgba(155,120,232,.12)}.apk-order-btn[data-status=cancelado]{border-color:#d85d5d;background:rgba(216,93,93,.10);color:#ffb0b0}.apk-order-btn.active{box-shadow:0 0 0 1px currentColor inset}.apk-order-btn:disabled{opacity:.55}';" +
                "document.head.appendChild(css);" +
                "const labels={confirmado:'✓ Confirmado',saiu_entrega:'➜ Saiu pra entrega',cancelado:'✕ Cancelado'};" +
                "function upgrade(){" +
                "document.querySelectorAll('select[data-order-status]').forEach(s=>{" +
                "const id=s.dataset.orderStatus||'';const current=s.value||'novo';const label=s.closest('label');if(!label||label.dataset.apkUpgraded==='1')return;" +
                "label.dataset.apkUpgraded='1';const box=document.createElement('div');box.className='apk-order-actions';" +
                "Object.entries(labels).forEach(([st,txt])=>{const b=document.createElement('button');b.type='button';b.className='apk-order-btn'+(current===st?' active':'');b.dataset.apkOrderId=id;b.dataset.status=st;b.textContent=txt;box.appendChild(b);});" +
                "label.replaceWith(box);" +
                "});" +
                "}" +
                "document.addEventListener('click',async(e)=>{" +
                "const b=e.target.closest('[data-apk-order-id][data-status]');if(!b)return;const id=b.dataset.apkOrderId;const status=b.dataset.status;" +
                "const group=[...b.parentElement.querySelectorAll('button')];group.forEach(x=>x.disabled=true);" +
                "try{" +
                "let data;if(typeof api==='function'){data=await api('/api/orders/'+encodeURIComponent(id),{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({status})});}" +
                "else{const r=await fetch('/api/orders/'+encodeURIComponent(id),{method:'PATCH',headers:{'content-type':'application/json'},credentials:'include',body:JSON.stringify({status})});data=await r.json();if(!r.ok)throw new Error(data.error||'Erro');}" +
                "if(typeof renderDashboard==='function')renderDashboard(data);setTimeout(upgrade,50);" +
                "}catch(err){group.forEach(x=>x.disabled=false);if(typeof setStatus==='function')setStatus('#dashboardStatus',err.message||'Não foi possível mudar o status.','error');}" +
                "});" +
                "new MutationObserver(upgrade).observe(document.documentElement,{childList:true,subtree:true});upgrade();" +
                "})();";

        webView.evaluateJavascript(script, null);
    }

    private void openExternal(Uri uri) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Nenhum aplicativo disponível para abrir este link.", Toast.LENGTH_SHORT).show();
        }
    }

    private final class AdminBridge {
        @JavascriptInterface
        public String getToken() {
            return BuildConfig.ADMIN_APP_TOKEN;
        }

        @JavascriptInterface
        public void notifyNewOrder(String orderId, String customerName, String total) {
            runOnUiThread(() -> AdminFirebaseMessagingService.showOrderNotification(
                    MainActivity.this,
                    "Novo pedido!",
                    "Confirme o pedido de " + customerName + " · " + total,
                    orderId
            ));
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode != FILE_CHOOSER_REQUEST || filePathCallback == null) {
            return;
        }

        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null && data.getData() != null) {
            result = new Uri[]{data.getData()};
        }

        filePathCallback.onReceiveValue(result);
        filePathCallback = null;
    }

    @Override
    protected void onPause() {
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onStop() {
        CookieManager.getInstance().flush();
        super.onStop();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) {
            webView.saveState(outState);
        }
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onDestroy() {
        uiHandler.removeCallbacksAndMessages(null);
        CookieManager.getInstance().flush();

        if (splashView != null) {
            splashView.stopAnimation();
            splashView = null;
        }

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
