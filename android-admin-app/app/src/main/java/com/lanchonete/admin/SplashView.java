package com.lanchonete.dois.admin;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.view.View;

/** Splash nativa da Lanchonete 2. */
public final class SplashView extends View {
    private static final int BG = Color.rgb(238, 244, 255);
    private static final int BLUE = Color.rgb(23, 70, 162);
    private static final int BLUE_DARK = Color.rgb(13, 40, 104);
    private static final int YELLOW = Color.rgb(255, 200, 87);
    private static final int TRACK = Color.rgb(198, 213, 243);

    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path logoPath = new Path();
    private final RectF spinnerRect = new RectF();
    private float spinnerAngle = -90f;
    private boolean running = true;

    public SplashView(Context context) {
        super(context);
        setBackgroundColor(BG);
        setClickable(true);
        setFocusable(true);
        textPaint.setColor(BLUE_DARK);
        textPaint.setTextAlign(Paint.Align.CENTER);
        textPaint.setTypeface(android.graphics.Typeface.create("sans", android.graphics.Typeface.BOLD));
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float w = getWidth();
        float h = getHeight();
        if (w <= 0 || h <= 0) return;

        drawAccents(canvas, w, h);
        float logoSize = Math.min(w * .46f, dp(210));
        drawLogo(canvas, w / 2f, h * .42f, logoSize);

        float spinnerSize = dp(46);
        float spinnerY = h * .65f;
        spinnerRect.set(w / 2f - spinnerSize / 2f, spinnerY - spinnerSize / 2f,
                w / 2f + spinnerSize / 2f, spinnerY + spinnerSize / 2f);

        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setStrokeWidth(dp(4));
        paint.setColor(TRACK);
        canvas.drawArc(spinnerRect, 0, 360, false, paint);
        paint.setColor(BLUE);
        canvas.drawArc(spinnerRect, spinnerAngle, 110, false, paint);

        textPaint.setTextSize(sp(16));
        canvas.drawText("Abrindo o painel", w / 2f, spinnerY + dp(65), textPaint);

        if (running) {
            spinnerAngle = (spinnerAngle + 5.5f) % 360f;
            postInvalidateOnAnimation();
        }
    }

    private void drawAccents(Canvas canvas, float w, float h) {
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(YELLOW);
        canvas.drawCircle(-w * .04f, h * .16f, w * .23f, paint);
        paint.setColor(Color.argb(26, 23, 70, 162));
        canvas.drawCircle(w * 1.04f, h * .86f, w * .30f, paint);
    }

    private void drawLogo(Canvas canvas, float cx, float cy, float size) {
        RectF shadow = new RectF(cx - size / 2f + dp(8), cy - size / 2f + dp(8),
                cx + size / 2f + dp(8), cy + size / 2f + dp(8));
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(YELLOW);
        canvas.drawRoundRect(shadow, size * .22f, size * .07f, paint);

        RectF panel = new RectF(cx - size / 2f, cy - size / 2f, cx + size / 2f, cy + size / 2f);
        paint.setColor(BLUE);
        canvas.drawRoundRect(panel, size * .07f, size * .22f, paint);

        float left = panel.left;
        float top = panel.top;
        logoPath.reset();
        logoPath.moveTo(left + size * .25f, top + size * .36f);
        logoPath.cubicTo(left + size * .31f, top + size * .17f,
                left + size * .72f, top + size * .16f,
                left + size * .77f, top + size * .36f);
        logoPath.cubicTo(left + size * .81f, top + size * .52f,
                left + size * .56f, top + size * .61f,
                left + size * .29f, top + size * .78f);
        logoPath.lineTo(left + size * .79f, top + size * .78f);

        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setStrokeJoin(Paint.Join.ROUND);
        paint.setStrokeWidth(size * .085f);
        paint.setColor(YELLOW);
        canvas.drawPath(logoPath, paint);
        paint.setStrokeWidth(size * .022f);
        paint.setColor(Color.WHITE);
        canvas.drawPath(logoPath, paint);
    }

    public void stopAnimation() { running = false; }
    private float dp(float value) { return value * getResources().getDisplayMetrics().density; }
    private float sp(float value) { return value * getResources().getDisplayMetrics().scaledDensity; }
}
