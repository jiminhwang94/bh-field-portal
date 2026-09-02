// 리포트 공유: 카카오톡 · 메일 · 메모 등 기기 공유 시트로 보내기
// (기본 전달 경로는 구글 시트 업로드이고, 이건 즉시 전달이 필요할 때의 보조 수단)
import { $, h, closeModal, copyText, openSheet, toast } from './ui.js';

/** 리포트를 사람이 읽는 텍스트로 만든다. */
export function reportToText(report, { withHeader = true } = {}) {
  const lines = [];
  if (withHeader) {
    lines.push(`■ 현장 리포트 · ${report.title}`);
    lines.push(`작성 ${report.createdAt}`);
    lines.push('');
  }
  for (const item of report.payload || []) {
    if (item.type === 'MEDIA') {
      const names = (item.media || []).map((m) => m.originalName || m.filename);
      lines.push(`[${item.label}] ${names.length ? `사진 ${names.length}장` : '없음'}`);
    } else {
      const value = String(item.value || '').trim() || '-';
      lines.push(value.includes('\n')
        ? `[${item.label}]\n${value}`
        : `[${item.label}] ${value}`);
    }
  }
  return lines.join('\n');
}

function mediaList(report) {
  const files = [];
  for (const item of report.payload || []) {
    if (item.type === 'MEDIA') {
      (item.media || []).forEach((m) => files.push(m));
    }
  }
  return files;
}

async function toFiles(mediaItems) {
  const files = [];
  for (const media of mediaItems) {
    try {
      const res = await fetch(media.url);
      if (!res.ok) continue;
      const blob = await res.blob();
      files.push(new File([blob], media.originalName || media.filename,
        { type: blob.type || media.mime || 'image/jpeg' }));
    } catch { /* 건너뜀 */ }
  }
  return files;
}

export function shareSupported() {
  return typeof navigator.share === 'function' && window.isSecureContext;
}

/**
 * 기기 공유 시트를 띄운다. 사용할 수 없으면 복사 + 안내 시트로 대체한다.
 * 반드시 사용자 탭(클릭) 안에서 호출해야 한다.
 */
export async function shareReport(report) {
  const text = reportToText(report);
  const media = mediaList(report);

  if (shareSupported()) {
    try {
      const files = await toFiles(media);
      const payload = { title: `현장 리포트 · ${report.title}`, text };
      if (files.length && navigator.canShare && navigator.canShare({ files })) {
        payload.files = files;
      }
      await navigator.share(payload);
      if (media.length && !payload.files) {
        toast('사진은 이 기기에서 함께 보낼 수 없어 글만 전달했습니다.', 'err');
      } else {
        toast('공유했습니다.', 'ok');
      }
      return true;
    } catch (err) {
      if (err && err.name === 'AbortError') return false;   // 사용자가 취소
      // 공유 실패 시 아래 대체 경로로 진행
    }
  }
  await shareFallback(report, text, media);
  return false;
}

/** 공유 API 를 쓸 수 없을 때: 텍스트 복사 + 사진 목록 안내 */
async function shareFallback(report, text, media) {
  const copied = await copyText(text);
  const body = openSheet('리포트 공유', `
    <p class="muted" style="margin:0 0 12px;line-height:1.65">
      ${copied
        ? '리포트 내용을 <strong>클립보드에 복사</strong>했습니다. 카카오톡·메일 등에 붙여넣기(길게 누르기 → 붙여넣기) 하세요.'
        : '아래 내용을 길게 눌러 복사한 뒤 카카오톡·메일에 붙여넣으세요.'}
    </p>
    <textarea class="textarea mono" id="shareText" rows="12"
              style="font-size:.86rem">${h(text)}</textarea>
    ${media.length ? `
      <div class="sub-card" style="margin-top:12px">
        <strong>사진 ${media.length}장</strong>
        <p class="muted" style="margin:6px 0 10px;font-size:.88rem">
          사진은 아래에서 하나씩 열어 저장(길게 누르기 → 이미지 저장)한 뒤 함께 보내세요.
        </p>
        <div class="media-grid">
          ${media.map((m) => `
            <a class="media-tile" href="${h(m.url)}" target="_blank" rel="noopener">
              ${(m.mime || '').startsWith('video/')
                ? `<video src="${h(m.url)}" muted playsinline></video>`
                : `<img src="${h(m.url)}" alt="${h(m.originalName || '')}" loading="lazy" />`}
              <div class="media-tile__name">${h(m.originalName || m.filename)}</div>
            </a>`).join('')}
        </div>
      </div>` : ''}
    <div class="sub-card" style="margin-top:12px">
      <p class="muted" style="margin:0;font-size:.86rem;line-height:1.6">
        ※ 이 브라우저에서는 <strong>공유 시트</strong>를 쓸 수 없습니다.
        태블릿에서 서비스 주소(https)로 접속하면 [공유] 한 번으로 카카오톡에 사진까지 전달됩니다.
      </p>
    </div>
    <div class="form-actions">
      <button class="btn btn--ghost" type="button" data-act="close">닫기</button>
      <button class="btn btn--primary" type="button" data-share="copy">다시 복사</button>
    </div>`);

  body.addEventListener('click', async (ev) => {
    if (!ev.target.closest('[data-share="copy"]')) return;
    const ok = await copyText($('#shareText', body).value);
    toast(ok ? '복사했습니다.' : '복사에 실패했습니다. 직접 선택해 복사하세요.', ok ? 'ok' : 'err');
  });
}

export { closeModal };
