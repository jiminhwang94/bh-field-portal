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
    private boolean openPicker(WebChromeClient.FileChooserParams params) {
        Intent contentIntent = new Intent(Intent.ACTION_GET_CONTENT);
        contentIntent.addCategory(Intent.CATEGORY_OPENABLE);
        contentIntent.setType("*/*");
        String[] accept = params.getAcceptTypes();
        if (accept != null && accept.length > 0 && accept[0] != null
                && !accept[0].isEmpty()) {
            contentIntent.setType(accept[0]);
        }

        Intent chooser = Intent.createChooser(contentIntent, "사진 선택");
        Intent cameraIntent = buildCameraIntent();
        if (cameraIntent != null) {
            chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{cameraIntent});
        }
        try {
            filePicker.launch(chooser);
            return true;
        } catch (Exception exc) {
            filePathCallback = null;
            Toast.makeText(this, "사진을 열 수 없습니다.", Toast.LENGTH_SHORT).show();
            return false;
        }
    }

    private Intent buildCameraIntent() {
        if (checkSelfPermission(android.Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{android.Manifest.permission.CAMERA},
                    REQUEST_CAMERA_PERMISSION);
            return null;        // 이번에는 앨범만, 다음 촬영부터 카메라 사용 가능
        }
        Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
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
            File photo = new File(dir, "photo-" + stamp + ".jpg");
            cameraOutputUri = FileProvider.getUriForFile(
                    this, getPackageName() + ".fileprovider", photo);
            intent.putExtra(MediaStore.EXTRA_OUTPUT, cameraOutputUri);
            intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
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
