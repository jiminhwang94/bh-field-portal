package com.beyondhoneycomb.fieldportal;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;

import java.io.File;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 앱 화면을 담는 껍데기(WebView).
 *
 * 화면·데이터는 모두 기기 안에 있다.
 * - 화면 파일: APK 안 assets/www → https://appassets.androidplatform.net 로 제공
 *   (진짜 https 주소로 취급되어야 서비스워커·IndexedDB 가 동작한다)
 * - 데이터: WebView 의 IndexedDB (가이드·재고·리포트·사진)
 *
 * 서버(사무실 PC)는 [업데이트] 동기화에만 쓰이며, 앱 설정에서 주소를 등록한다.
 */
public class MainActivity extends AppCompatActivity {

    private static final String APP_URL =
            "https://appassets.androidplatform.net/index.html";
    private static final int REQUEST_CAMERA_PERMISSION = 100;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private Uri cameraOutputUri;

    /** 사진 촬영/선택 결과를 받아 WebView 의 <input type="file"> 로 넘긴다. */
    private final androidx.activity.result.ActivityResultLauncher<Intent> filePicker =
            registerForActivityResult(
                    new androidx.activity.result.contract.ActivityResultContracts
                            .StartActivityForResult(),
                    result -> {
                        if (filePathCallback == null) {
                            return;
                        }
                        Uri[] uris = null;
                        if (result.getResultCode() == Activity.RESULT_OK) {
                            Intent data = result.getData();
                            if (data != null && data.getData() != null) {
                                uris = new Uri[]{data.getData()};       // 앨범에서 선택
                            } else if (cameraOutputUri != null) {
                                uris = new Uri[]{cameraOutputUri};      // 카메라로 촬영
                            }
                        }
                        filePathCallback.onReceiveValue(uris);
                        filePathCallback = null;
                        cameraOutputUri = null;
                    });

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        webView = findViewById(R.id.webview);

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);          // localStorage / IndexedDB
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        // 앱 화면은 https 로 제공되지만 사무실 서버는 http(사내망)라서
        // 그대로 두면 [업데이트] 요청이 차단된다. 사내망 주소로만 쓰인다.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(
                    WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(
                    WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                String host = url.getHost();
                if (host != null && host.equals("appassets.androidplatform.net")) {
                    return false;                     // 앱 내부 화면
                }
                // 구글 시트 열기 등 외부 링크는 기본 브라우저로 넘긴다.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (Exception ignored) {
                    Toast.makeText(MainActivity.this, "링크를 열 수 없습니다.",
                            Toast.LENGTH_SHORT).show();
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view,
                                             ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                return openPicker(params);
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.deny();      // 앱은 카메라 API 를 직접 쓰지 않는다
            }
        });

        if (savedInstanceState == null) {
            webView.loadUrl(APP_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }

        // 뒤로가기: 앱 안에서 먼저 뒤로 이동하고, 더 없으면 앱을 닫는다.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });
    }

    /** 촬영 / 앨범 선택을 함께 띄운다. */
    /** 웹의 첨부 한도와 같은 값. 카메라 앱이 이 크기에서 녹화를 멈춘다(지원 기기). */
    private static final long VIDEO_SIZE_LIMIT = 20L * 1024 * 1024;

    private boolean openPicker(WebChromeClient.FileChooserParams params) {
        String[] accept = params.getAcceptTypes();
        String type = "*/*";
        if (accept != null && accept.length > 0 && accept[0] != null
                && !accept[0].isEmpty()) {
            type = accept[0];
        }
        // 웹이 video/* 를 요청했으면 동영상 카메라를 연다.
        // 예전에는 요청 종류를 보지 않고 늘 사진 카메라만 붙여서,
        // [동영상 찍기]를 눌러도 사진 촬영 화면이 떴다.
        boolean wantVideo = type.startsWith("video/");
        Intent cameraIntent = buildCameraIntent(wantVideo);

        try {
            // capture 속성이 있는 요청([사진 촬영]·[동영상 찍기])은 선택 창을 거치지
            // 않고 카메라를 바로 연다. 현장에서 한 번 덜 누른다.
            if (params.isCaptureEnabled() && cameraIntent != null) {
                filePicker.launch(cameraIntent);
                return true;
            }

            Intent contentIntent = new Intent(Intent.ACTION_GET_CONTENT);
            contentIntent.addCategory(Intent.CATEGORY_OPENABLE);
            contentIntent.setType(type);
            Intent chooser = Intent.createChooser(contentIntent, "첨부 선택");
            if (cameraIntent != null) {
                chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{cameraIntent});
            }
            filePicker.launch(chooser);
            return true;
        } catch (Exception exc) {
            filePathCallback = null;
            cameraOutputUri = null;
            Toast.makeText(this, "카메라나 파일을 열 수 없습니다.", Toast.LENGTH_SHORT).show();
            return false;
        }
    }

    /**
     * 카메라 인텐트. video 가 true 면 동영상, 아니면 사진.
     * 촬영 결과는 앱 캐시 폴더에 담고 그 주소를 웹뷰에 넘긴다.
     */
    private Intent buildCameraIntent(boolean video) {
        if (checkSelfPermission(android.Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{android.Manifest.permission.CAMERA},
                    REQUEST_CAMERA_PERMISSION);
            return null;        // 이번에는 앨범만, 다음 촬영부터 카메라 사용 가능
        }
        Intent intent = new Intent(video
                ? MediaStore.ACTION_VIDEO_CAPTURE
                : MediaStore.ACTION_IMAGE_CAPTURE);
        if (intent.resolveActivity(getPackageManager()) == null) {
            return null;
        }
        try {
            File dir = new File(getCacheDir(), "captures");
            if (!dir.exists() && !dir.mkdirs()) {
                return null;
            }
            String stamp = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.KOREA)
                    .format(new Date());
            File out = new File(dir, video ? "video-" + stamp + ".mp4"
                                           : "photo-" + stamp + ".jpg");
            cameraOutputUri = FileProvider.getUriForFile(
                    this, getPackageName() + ".fileprovider", out);
            intent.putExtra(MediaStore.EXTRA_OUTPUT, cameraOutputUri);
            intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            if (video) {
                // 웹 첨부 한도와 같은 크기에서 녹화가 멈추게 부탁한다.
                // 모든 카메라 앱이 지키지는 않으므로 웹 쪽 확인은 그대로 남아 있다.
                intent.putExtra(MediaStore.EXTRA_SIZE_LIMIT, VIDEO_SIZE_LIMIT);
                intent.putExtra(MediaStore.EXTRA_VIDEO_QUALITY, 1);   // 고화질 (저화질은 너무 작다)
            }
            return intent;
        } catch (Exception exc) {
            cameraOutputUri = null;
            return null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }
}
