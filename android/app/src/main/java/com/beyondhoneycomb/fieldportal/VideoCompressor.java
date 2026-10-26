package com.beyondhoneycomb.fieldportal;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.annotation.OptIn;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.effect.Presentation;
import androidx.media3.transformer.Composition;
import androidx.media3.transformer.DefaultEncoderFactory;
import androidx.media3.transformer.EditedMediaItem;
import androidx.media3.transformer.Effects;
import androidx.media3.transformer.ExportException;
import androidx.media3.transformer.ExportResult;
import androidx.media3.transformer.ProgressHolder;
import androidx.media3.transformer.Transformer;
import androidx.media3.transformer.VideoEncoderSettings;

import com.google.common.collect.ImmutableList;

import java.io.File;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 현장 영상을 올릴 수 있는 크기로 줄인다 (v3.36).
 *
 * 카메라 앱의 '저화질' 은 기기마다 해상도가 제멋대로라(문자 전송용 아주 작은 화면까지) 로봇을
 * 알아볼 수 없었다. 이제 카메라는 고화질로 최대 1분 찍게 두고, 찍은 뒤 여기서
 * **짧은 변 720px · 영상 2.2Mbps(H.264) · 소리 AAC** 로 다시 만든다. 1분이 약 17MB 라
 * 시트로 올리는 조각 업로드(파일당 25MB)에 그대로 들어간다. 용량은 비트레이트가 정하므로
 * 해상도가 기기마다 조금 달라도 크기는 늘 비슷하다.
 *
 * 앨범에서 고른 영상도 같은 길로 줄인다. 1분이 넘으면 앞 1분만 남긴다.
 * 이미 작고 짧은 영상(25MB · 1분 이하)은 손대지 않는다.
 */
@OptIn(markerClass = UnstableApi.class)
final class VideoCompressor {

    /** 웹 첨부 한도(web/js/sheets.js MEDIA_FILE_LIMIT)와 같은 값 */
    static final long FILE_LIMIT = 25L * 1024 * 1024;
    static final long MAX_DURATION_MS = 60_000L;
    private static final int SHORT_SIDE = 720;
    private static final int VIDEO_BITRATE = 2_200_000;

    interface Done {
        /** 결과 파일. 실패 · 취소면 null (원본을 쓸지는 부른 쪽이 정한다) */
        void onResult(File output, String message);
    }

    private VideoCompressor() { }

    /** 줄일 필요가 있는가 — 크기 · 길이 중 하나라도 한도를 넘으면 */
    static boolean needsWork(Context ctx, Uri input) {
        long size = sizeOf(ctx, input);
        long duration = metaLong(ctx, input, MediaMetadataRetriever.METADATA_KEY_DURATION);
        return size < 0 || size > FILE_LIMIT || duration > MAX_DURATION_MS + 1000;
    }

    static void compress(Activity activity, Uri input, File outFile, Done done) {
        Handler main = new Handler(Looper.getMainLooper());
        long duration = metaLong(activity, input, MediaMetadataRetriever.METADATA_KEY_DURATION);
        boolean clipped = duration > MAX_DURATION_MS + 1000;

        // ── 진행 창: 몇 % · [취소]
        LinearLayout box = new LinearLayout(activity);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (24 * activity.getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad, pad, pad / 2);
        TextView label = new TextView(activity);
        label.setTextSize(18);
        label.setText("영상을 올릴 크기로 줄이는 중… 0%");
        ProgressBar bar = new ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        TextView hint = new TextView(activity);
        hint.setTextSize(15);
        hint.setGravity(Gravity.START);
        hint.setText(clipped
                ? "1분이 넘는 영상이라 앞 1분만 남깁니다. 1분 영상은 15~30초쯤 걸립니다."
                : "1분 영상은 15~30초쯤 걸립니다. 화면을 끄지 마세요.");
        box.addView(label);
        box.addView(bar);
        box.addView(hint);

        final Transformer[] holder = new Transformer[1];
        final boolean[] finished = new boolean[1];
        AlertDialog dialog = new AlertDialog.Builder(activity)
                .setTitle("영상 준비")
                .setView(box)
                .setCancelable(false)
                .setNegativeButton("취소", (d, w) -> {
                    if (finished[0]) return;
                    finished[0] = true;
                    if (holder[0] != null) holder[0].cancel();
                    //noinspection ResultOfMethodCallIgnored
                    outFile.delete();
                    done.onResult(null, "영상 첨부를 취소했습니다.");
                })
                .create();
        dialog.show();

        Transformer transformer = new Transformer.Builder(activity)
                .setVideoMimeType(MimeTypes.VIDEO_H264)
                .setAudioMimeType(MimeTypes.AUDIO_AAC)
                .setEncoderFactory(new DefaultEncoderFactory.Builder(activity)
                        .setRequestedVideoEncoderSettings(new VideoEncoderSettings.Builder()
                                .setBitrate(VIDEO_BITRATE)
                                .build())
                        .build())
                .addListener(new Transformer.Listener() {
                    @Override
                    public void onCompleted(Composition composition, ExportResult result) {
                        if (finished[0]) return;
                        finished[0] = true;
                        dismiss(dialog);
                        done.onResult(outFile, clipped ? "1분이 넘어 앞 1분만 붙였습니다." : null);
                    }

                    @Override
                    public void onError(Composition composition, ExportResult result,
                                        ExportException error) {
                        if (finished[0]) return;
                        finished[0] = true;
                        dismiss(dialog);
                        //noinspection ResultOfMethodCallIgnored
                        outFile.delete();
                        done.onResult(null, "영상을 줄이지 못했습니다 (" + error.getErrorCodeName() + ").");
                    }
                })
                .build();
        holder[0] = transformer;

        MediaItem.Builder item = new MediaItem.Builder().setUri(input);
        if (clipped) {
            item.setClippingConfiguration(new MediaItem.ClippingConfiguration.Builder()
                    .setEndPositionMs(MAX_DURATION_MS).build());
        }
        EditedMediaItem edited = new EditedMediaItem.Builder(item.build())
                .setEffects(new Effects(ImmutableList.of(),
                        ImmutableList.of(Presentation.createForHeight(targetHeight(activity, input)))))
                .build();
        try {
            transformer.start(edited, outFile.getAbsolutePath());
        } catch (Exception exc) {
            finished[0] = true;
            dismiss(dialog);
            done.onResult(null, "영상을 줄이지 못했습니다.");
            return;
        }

        // 진행률은 물어봐야 알려 준다 — 0.5초마다
        ProgressHolder progress = new ProgressHolder();
        Runnable tick = new Runnable() {
            @Override
            public void run() {
                if (finished[0]) return;
                if (transformer.getProgress(progress) == Transformer.PROGRESS_STATE_AVAILABLE) {
                    bar.setProgress(progress.progress);
                    label.setText("영상을 올릴 크기로 줄이는 중… " + progress.progress + "%");
                }
                main.postDelayed(this, 500);
            }
        };
        main.postDelayed(tick, 500);
    }

    /** 결과 파일 — 앱 캐시의 captures/ (FileProvider 가 웹에 넘길 수 있는 곳) */
    static File outputFile(Context ctx) {
        File dir = new File(ctx.getCacheDir(), "captures");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        String stamp = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.KOREA).format(new Date());
        return new File(dir, "video-" + stamp + "-720p.mp4");
    }

    /**
     * 출력 높이 — 화면에 보이는 모습(회전 반영)의 짧은 변을 720 으로.
     * 가로 영상은 720, 세로 영상은 1280 근처. 이미 작으면 그대로.
     */
    private static int targetHeight(Context ctx, Uri uri) {
        long w = metaLong(ctx, uri, MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH);
        long h = metaLong(ctx, uri, MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT);
        long rot = metaLong(ctx, uri, MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION);
        if (w <= 0 || h <= 0) return SHORT_SIDE;
        if (rot == 90 || rot == 270) { long t = w; w = h; h = t; }
        long shortSide = Math.min(w, h);
        if (shortSide <= SHORT_SIDE) return (int) (h - (h % 2));
        long out = Math.round(h * (double) SHORT_SIDE / shortSide);
        return (int) (out - (out % 2));
    }

    private static long metaLong(Context ctx, Uri uri, int key) {
        MediaMetadataRetriever r = new MediaMetadataRetriever();
        try {
            r.setDataSource(ctx, uri);
            String v = r.extractMetadata(key);
            return v == null ? -1 : Long.parseLong(v.trim());
        } catch (Exception exc) {
            return -1;
        } finally {
            try { r.release(); } catch (Exception ignored) { }
        }
    }

    private static long sizeOf(Context ctx, Uri uri) {
        try (android.content.res.AssetFileDescriptor fd =
                     ctx.getContentResolver().openAssetFileDescriptor(uri, "r")) {
            return fd == null ? -1 : fd.getLength();
        } catch (Exception exc) {
            return -1;
        }
    }

    private static void dismiss(AlertDialog dialog) {
        try { dialog.dismiss(); } catch (Exception ignored) { }
    }
}
