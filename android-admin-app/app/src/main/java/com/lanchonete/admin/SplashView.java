package com.lanchonete.dois.admin;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.drawable.Drawable;
import android.view.View;

/**
 * Splash nativa do aplicativo administrativo.
 * Desenha a mesma marca de hambúrguer do aplicativo e um indicador de carregamento.
 */
public final class SplashView extends View {
    private static final int BG = Color.rgb(238, 244, 255);
    private static final int ORANGE = Color.rgb(23, 70, 162);
    private static final int TRACK = Color.rgb(198, 213, 243);
    private static final int TEXT = Color.rgb(13, 40, 104);

    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF spinnerRect = new RectF();
    private final Drawable burgerLogo;

    private float spinnerAngle = -90f;
    private boolean running = true;

    public SplashView(Context context) {
        super(context);
        burgerLogo = context.getDrawable(R.drawable.app_icon);
        setBackgroundColor(BG);
        setClickable(true);
        setFocusable(true);

        textPaint.setColor(TEXT);
        textPaint.setTextAlign(Paint.Align.CENTER);
        textPaint.setTypeface(android.graphics.Typeface.create("sans", android.graphics.Typeface.NORMAL));
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);

        final float w = getWidth();
        final float h = getHeight();
        if (w <= 0 || h <= 0) return;

        drawSubtleAccents(canvas, w, h);

        float logoWidth = Math.min(w * 0.48f, dp(220));
        float logoCenterY = h * 0.43f;
        drawBurgerLogo(canvas, w / 2f, logoCenterY, logoWidth);

        float spinnerSize = dp(48);
        float spinnerCenterY = h * 0.64f;
        spinnerRect.set(
                w / 2f - spinnerSize / 2f,
                spinnerCenterY - spinnerSize / 2f,
                w / 2f + spinnerSize / 2f,
                spinnerCenterY + spinnerSize / 2f
        );

        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setStrokeWidth(dp(4));
        paint.setColor(TRACK);
        canvas.drawArc(spinnerRect, 0, 360, false, paint);

        paint.setColor(ORANGE);
        canvas.drawArc(spinnerRect, spinnerAngle, 105, false, paint);

        textPaint.setTextSize(sp(17));
        canvas.drawText("Abrindo o painel", w / 2f, spinnerCenterY + dp(66), textPaint);

        if (running) {
            spinnerAngle = (spinnerAngle + 5.5f) % 360f;
            postInvalidateOnAnimation();
        }
    }

    private void drawSubtleAccents(Canvas canvas, float w, float h) {
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(dp(1.2f));
        paint.setColor(Color.argb(120, 23, 70, 162));

        RectF topArc = new RectF(-w * 0.38f, -w * 0.38f, w * 0.28f, w * 0.28f);
        canvas.drawArc(topArc, 12, 82, false, paint);

        RectF bottomArc = new RectF(w * 0.72f, h - w * 0.28f, w * 1.38f, h + w * 0.38f);
        canvas.drawArc(bottomArc, 192, 82, false, paint);
    }

    private void drawBurgerLogo(Canvas canvas, float cx, float cy, float width) {
        if (burgerLogo == null) return;
        int size = Math.round(width);
        int left = Math.round(cx - width / 2f);
        int top = Math.round(cy - width / 2f);
        burgerLogo.setBounds(left, top, left + size, top + size);
        burgerLogo.draw(canvas);
    }

    public void stopAnimation() {
        running = false;
    }

    private float dp(float value) {
        return value * getResources().getDisplayMetrics().density;
    }

    private float sp(float value) {
        return value * getResources().getDisplayMetrics().scaledDensity;
    }
}
