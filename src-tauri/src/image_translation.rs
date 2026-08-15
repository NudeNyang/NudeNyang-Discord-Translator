use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::Cursor;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use ab_glyph::{FontArc, PxScale};
use image::codecs::png::PngEncoder;
use image::{DynamicImage, ImageEncoder, ImageFormat, Rgba, RgbaImage};
use imageproc::drawing::{draw_polygon_mut, draw_text_mut, text_size};
use imageproc::point::Point as ImagePoint;
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::language::{is_supported_language_code, Language};
use crate::ocr::{OcrQualityMode, PaddleDualOcr, Point, Rect, TextLine};
use crate::translation::TranslationService;
use crate::ui_locale::generated_copies;

const IMAGE_RENDER_VERSION: &str = "rust-poster-plates-v2-vertical-original-resolution";

pub const IMAGE_UI_SCRIPT: &str = r##"
(() => {
  const requestedUiLanguage = __UI_LANGUAGE__;
  const systemUiLanguage = (navigator.language || 'en').toLowerCase();
  const supportedUiLanguages = ['ko','en','ja','zh','zh-Hant','pt-BR','hi','es-419','de','ru','id','fr','tr','ar','vi','it','pl','uk','ms','nl','th','fil','bn','ur','ta','fa','he','cs'];
  function resolveUiLanguage(value) {
    const normalized = String(value || '').replaceAll('_','-').toLowerCase();
    if (normalized.startsWith('zh')) return /(?:^|-)hant(?:-|$)/.test(normalized) || /^zh-(tw|hk|mo)(?:-|$)/.test(normalized) ? 'zh-Hant' : 'zh';
    if (normalized.startsWith('pt')) return 'pt-BR';
    if (normalized.startsWith('es')) return 'es-419';
    if (normalized === 'in' || normalized.startsWith('in-')) return 'id';
    return supportedUiLanguages.find(code => normalized === code.toLowerCase() || normalized.startsWith(`${code.toLowerCase()}-`)) || 'en';
  }
  const uiLanguage = resolveUiLanguage(requestedUiLanguage === 'auto' ? systemUiLanguage : requestedUiLanguage);
  const copies = Object.assign({
    ko:{translate:'이미지 번역',showOriginal:'원문 보기',showTranslation:'번역 보기',translating:'번역 중…',retry:'다시 시도',failed:'이미지를 번역하지 못했습니다.'},
    en:{translate:'Image translation',showOriginal:'Show original',showTranslation:'Show translation',translating:'Translating…',retry:'Try again',failed:'The image could not be translated.'},
    ja:{translate:'画像を翻訳',showOriginal:'原文を表示',showTranslation:'翻訳を表示',translating:'翻訳中…',retry:'再試行',failed:'画像を翻訳できませんでした。'},
    zh:{translate:'翻译图片',showOriginal:'查看原图',showTranslation:'查看译图',translating:'正在翻译…',retry:'重试',failed:'无法翻译图片。'}
  }, __GENERATED_IMAGE_COPIES__);
  const copy = key => copies[uiLanguage]?.[key] || copies.en[key] || key;
  const version = 'rust-image-ui-v6-original-resolution';
  if (window.__ntImageUiVersion !== version || window.__ntImageUiLanguage !== uiLanguage) {
    window.__ntImageUiAbort?.abort();
    document.getElementById('nt-image-translate-button')?.remove();
    document.getElementById('nt-image-translate-style')?.remove();
    window.__ntImageUiAbort = new AbortController();
    window.__ntImageUiVersion = version;
    window.__ntImageUiLanguage = uiLanguage;
    window.__ntImageRequests ||= [];
    window.__ntImageSequence ||= 0;
    window.__ntTranslatedImages ||= {};
    window.__ntImageVisibility ||= {};
    window.__ntImageUiInstalled = false;
  }
  if (!window.__ntImageUiAbort || window.__ntImageUiAbort.signal.aborted) {
    window.__ntImageUiAbort = new AbortController();
    window.__ntImageUiInstalled = false;
  }
  window.__ntImageRequests ||= [];
  window.__ntTranslatedImages ||= {};
  window.__ntImageVisibility ||= {};
  window.__ntImageEnabled = true;

  const sourceKey = source => {
    if (!source) return '';
    try {
      const url = new URL(source, location.href);
      const attachment = url.pathname.match(/\/attachments\/[^?#]+/i);
      return attachment ? `discord-attachment:${attachment[0]}` : `${url.origin}${url.pathname}`;
    } catch (_) { return source.split(/[?#]/, 1)[0]; }
  };
  window.__ntImageSourceKey = sourceKey;

  const canonicalImageSource = source => {
    if (!source || source.startsWith('data:') || source.startsWith('blob:')) return source || '';
    try {
      const url = new URL(source, location.href);
      if (/\/attachments\//i.test(url.pathname) && /^(?:media|cdn)\.discordapp\.(?:net|com)$/i.test(url.hostname)) {
        if (url.hostname.toLowerCase() === 'media.discordapp.net') url.hostname = 'cdn.discordapp.com';
        for (const name of ['width','height','format','quality']) url.searchParams.delete(name);
      }
      return url.href;
    } catch (_) { return source; }
  };
  const largestSrcsetSource = img => {
    const values = String(img.getAttribute('srcset') || '').split(',').map(value => value.trim()).filter(Boolean);
    return values.sort((left, right) => {
      const size = value => Number(value.match(/\s(\d+(?:\.\d+)?)(?:w|x)$/)?.[1] || 0);
      return size(right) - size(left);
    })[0]?.replace(/\s+\d+(?:\.\d+)?(?:w|x)$/, '') || '';
  };
  const sourceCandidates = img => {
    const raw = [img?.currentSrc || '', largestSrcsetSource(img), img?.dataset?.ntOriginalSrc || '', img?.getAttribute?.('src') || '', img?.src || ''];
    return [...new Set(raw.flatMap(source => [canonicalImageSource(source), source]).filter(source => source && !source.startsWith('data:') && !source.startsWith('blob:')))];
  };
  window.__ntImageSourceCandidates = sourceCandidates;

  const inViewer = img => {
    const dialog = img.closest('[role="dialog"]');
    if (!dialog) return false;
    return /media|미디어|メディア|媒体/i.test(dialog.getAttribute('aria-label') || '') ||
      Boolean(dialog.querySelector('[class*="carousel"], [class*="modal"]'));
  };
  const eligible = img => {
    if (!(img instanceof HTMLImageElement)) return false;
    if (!img.closest('[id^="chat-messages-"]') && !inViewer(img)) return false;
    const rect = img.getBoundingClientRect();
    if (rect.width < 160 || rect.height < 90 || rect.right <= 0 || rect.bottom <= 0 ||
        rect.left >= innerWidth || rect.top >= innerHeight) return false;
    const source = img.dataset.ntOriginalSrc || img.currentSrc || img.src || '';
    if (!source || source.startsWith('data:') || source.startsWith('blob:') || /\.gif(?:\?|$)/i.test(source)) return false;
    if (/\/(?:avatars|icons|emojis|stickers|clan-badges|badge-icons)\//i.test(source)) return false;
    return !String(img.className).match(/avatar|emoji|sticker|icon|placeholder/i);
  };
  const activeViewerImage = () => [...document.querySelectorAll('[role="dialog"] img')]
    .filter(img => inViewer(img) && eligible(img))
    .sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return rightRect.width * rightRect.height - leftRect.width * leftRect.height;
    })[0] || null;
  const ensure = img => {
    if (!img.dataset.ntImageId) img.dataset.ntImageId = `nt-image-${++window.__ntImageSequence}`;
    if (!img.dataset.ntOriginalSrc) {
      img.dataset.ntOriginalSrc = img.currentSrc || largestSrcsetSource(img) || img.getAttribute('src') || img.src;
      img.dataset.ntOriginalSrcset = img.getAttribute('srcset') || '';
    }
    img.dataset.ntSourceKey ||= sourceKey(img.dataset.ntOriginalSrc);
    img.dataset.ntImageStatus ||= 'original';
    return img.dataset.ntImageId;
  };
  const imageById = id => document.querySelector(`[data-nt-image-id="${CSS.escape(id)}"]`);

  let style = document.getElementById('nt-image-translate-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'nt-image-translate-style';
    style.textContent = `
      #nt-image-translate-button { position:fixed; z-index:2147483646; display:none;
        padding:7px 11px; border:1px solid rgba(96,165,250,.62); border-radius:9px;
        color:#eff6ff; background:rgba(13,31,48,.95); box-shadow:0 6px 20px rgba(0,0,0,.34);
        font:600 12px/1.2 "Segoe UI",sans-serif; cursor:pointer; backdrop-filter:blur(10px); }
      #nt-image-translate-button:hover { background:rgba(30,64,100,.98); }
      #nt-image-translate-button:disabled { cursor:wait; opacity:.84; }
    `;
    document.head.appendChild(style);
  }
  let button = document.getElementById('nt-image-translate-button');
  if (!button) {
    button = document.createElement('button');
    button.id = 'nt-image-translate-button';
    button.type = 'button';
    button.setAttribute('aria-label', copy('translate'));
    document.body.appendChild(button);
  }
  const update = img => {
    const state = img.dataset.ntImageStatus || 'original';
    button.disabled = state === 'processing';
    button.title = state === 'error' ? copy('failed') : '';
    button.textContent = state === 'translated' ? copy('showOriginal') :
      state === 'translated-hidden' ? copy('showTranslation') : state === 'processing' ? copy('translating') :
      state === 'error' ? copy('retry') : copy('translate');
  };
  window.__ntUpdateImageButton = update;
  const show = img => {
    const target = activeViewerImage() || img;
    if (!window.__ntImageEnabled || !eligible(target)) {
      button.style.display = 'none';
      return;
    }
    button.dataset.ntTarget = ensure(target);
    button.dataset.ntViewerTarget = inViewer(target) ? 'true' : 'false';
    update(target);
    button.style.display = 'block';
    const rect = target.getBoundingClientRect();
    const inset = 8;
    const left = Math.max(inset, Math.min(
      innerWidth - button.offsetWidth - inset,
      rect.right - button.offsetWidth - inset
    ));
    const top = Math.max(inset, Math.min(
      innerHeight - button.offsetHeight - inset,
      rect.bottom - button.offsetHeight - inset
    ));
    button.style.left = `${left}px`;
    button.style.top = `${top}px`;
  };
  const imageFromPointerPath = (path, x, y) => {
    for (const element of path) {
      if (eligible(element)) return element;
      if (!(element instanceof Element) || element === document.body || element === document.documentElement) break;
      for (const img of element.querySelectorAll('img')) {
        if (!eligible(img)) continue;
        const rect = img.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return img;
      }
    }
    return null;
  };
  const hideSoon = () => {
    clearTimeout(window.__ntImageButtonTimer);
    window.__ntImageButtonTimer = setTimeout(() => {
      if (!button.matches(':hover')) button.style.display = 'none';
    }, 140);
  };

  if (!window.__ntImageUiInstalled) {
    window.__ntImageUiInstalled = true;
    const signal = window.__ntImageUiAbort.signal;
    document.addEventListener('pointermove', event => {
      if (!window.__ntImageEnabled) {
        button.style.display = 'none';
        return;
      }
      if (window.__ntImageFrame) return;
      const x = event.clientX, y = event.clientY;
      const path = event.composedPath();
      window.__ntImageFrame = requestAnimationFrame(() => {
        window.__ntImageFrame = 0;
        const img = imageFromPointerPath(path, x, y);
        if (img) show(img); else hideSoon();
      });
    }, {capture:true, signal});
    document.addEventListener('scroll', () => button.style.display = 'none', {capture:true, signal});
    window.addEventListener('resize', () => {
      if (button.style.display === 'none') return;
      const viewer = activeViewerImage();
      const target = viewer || imageById(button.dataset.ntTarget || '');
      if (target && eligible(target)) show(target);
      else button.style.display = 'none';
    }, {signal});
    const viewerObserver = new MutationObserver(mutations => {
      const viewerChanged = mutations.some(mutation => [...mutation.addedNodes, ...mutation.removedNodes]
        .some(node => node instanceof Element &&
          (node.matches('[role="dialog"]') || node.closest('[role="dialog"]') || node.querySelector('[role="dialog"]'))));
      if (!viewerChanged) return;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const viewer = activeViewerImage();
        if (viewer) show(viewer);
        else if (button.dataset.ntViewerTarget === 'true') {
          button.style.display = 'none';
          delete button.dataset.ntViewerTarget;
        }
      }));
    });
    viewerObserver.observe(document.body, {childList:true, subtree:true});
    signal.addEventListener('abort', () => viewerObserver.disconnect(), {once:true});
    button.addEventListener('pointerenter', () => clearTimeout(window.__ntImageButtonTimer), {signal});
    button.addEventListener('pointerleave', hideSoon, {signal});
    button.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      const img = imageById(button.dataset.ntTarget || '');
      if (!img || !window.__ntImageEnabled) return;
      const state = img.dataset.ntImageStatus || 'original';
      if (state === 'translated') {
        img.src = img.dataset.ntOriginalSrc;
        if (img.dataset.ntOriginalSrcset) img.srcset = img.dataset.ntOriginalSrcset;
        else img.removeAttribute('srcset');
        img.dataset.ntImageStatus = 'translated-hidden';
        window.__ntImageVisibility[img.dataset.ntSourceKey] = 'hidden';
      } else if (state === 'translated-hidden' && img.dataset.ntTranslatedSrc) {
        img.removeAttribute('srcset'); img.src = img.dataset.ntTranslatedSrc;
        img.dataset.ntImageStatus = 'translated';
        window.__ntImageVisibility[img.dataset.ntSourceKey] = 'visible';
      } else if (state !== 'processing') {
        img.dataset.ntImageStatus = 'processing'; delete img.dataset.ntImageError;
        window.__ntImageRequests.push({id:img.dataset.ntImageId, sourceKey:img.dataset.ntSourceKey || ''});
      }
      update(img);
    }, {signal});
  }

  for (const img of document.querySelectorAll('img')) {
    if (!eligible(img)) continue;
    const original = img.dataset.ntOriginalSrc || img.currentSrc || img.src || '';
    const key = img.dataset.ntSourceKey || sourceKey(original);
    const translated = window.__ntTranslatedImages[key];
    if (!translated) continue;
    ensure(img); img.dataset.ntTranslatedSrc = translated;
    if (window.__ntImageVisibility[key] !== 'hidden') {
      img.removeAttribute('srcset'); img.src = translated; img.dataset.ntImageStatus = 'translated';
    } else img.dataset.ntImageStatus = 'translated-hidden';
  }
  return window.__ntImageRequests.splice(0);
})()
"##;

pub fn image_ui_script(ui_language: &str) -> String {
    let ui_language = if ui_language == "auto" || is_supported_language_code(ui_language) {
        ui_language
    } else {
        "en"
    };
    let localized_copies = generated_copies(&[
        ("translate", "이미지 번역"),
        ("showOriginal", "원문 보기"),
        ("showTranslation", "번역 보기"),
        ("translating", "번역 중…"),
        ("retry", "다시 시도"),
        ("failed", "이미지를 번역하지 못했습니다."),
    ]);
    IMAGE_UI_SCRIPT
        .replace(
            "__UI_LANGUAGE__",
            &serde_json::to_string(ui_language).expect("static interface language code"),
        )
        .replace(
            "__GENERATED_IMAGE_COPIES__",
            &serde_json::to_string(&localized_copies).expect("generated image interface copies"),
        )
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageRequest {
    pub id: String,
    #[serde(default)]
    pub source_key: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ImageData {
    pub base64: String,
    #[serde(default)]
    pub mime: String,
    #[serde(default)]
    pub source: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageCaptureInfo {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
    pub fully_visible: bool,
}

#[derive(Clone, Debug)]
pub struct ImageTranslationOutcome {
    pub png_bytes: Vec<u8>,
    pub translated_count: usize,
    pub used_cache: bool,
}

pub trait OcrRecognizer: Send {
    fn recognize(
        &mut self,
        image: &DynamicImage,
        quality: OcrQualityMode,
    ) -> Result<Vec<TextLine>, String>;
}

impl OcrRecognizer for PaddleDualOcr {
    fn recognize(
        &mut self,
        image: &DynamicImage,
        quality: OcrQualityMode,
    ) -> Result<Vec<TextLine>, String> {
        PaddleDualOcr::recognize_with_quality(self, image, quality)
    }
}

pub struct ImageTranslationProcessor {
    ocr: Option<Box<dyn OcrRecognizer>>,
    last_ocr_use: Option<Instant>,
    cache_dir: PathBuf,
}

impl Default for ImageTranslationProcessor {
    fn default() -> Self {
        Self::new()
    }
}

impl ImageTranslationProcessor {
    pub fn new() -> Self {
        Self {
            ocr: None,
            last_ocr_use: None,
            cache_dir: default_cache_dir(),
        }
    }

    #[cfg(test)]
    fn with_ocr(ocr: Box<dyn OcrRecognizer>, cache_dir: PathBuf) -> Self {
        Self {
            ocr: Some(ocr),
            last_ocr_use: Some(Instant::now()),
            cache_dir,
        }
    }

    pub fn ocr_ready(&self) -> bool {
        self.ocr.is_some()
    }

    pub fn note_ocr_use(&mut self, now: Instant) {
        self.last_ocr_use = Some(now);
    }

    pub fn release_ocr(&mut self) -> bool {
        let released = self.ocr.take().is_some();
        self.last_ocr_use = None;
        released
    }

    pub fn release_ocr_if_idle(&mut self, now: Instant) -> bool {
        const OCR_IDLE_TTL: Duration = Duration::from_secs(5 * 60);
        if self
            .last_ocr_use
            .is_some_and(|last| now.saturating_duration_since(last) >= OCR_IDLE_TTL)
        {
            return self.release_ocr();
        }
        false
    }

    pub fn process(
        &mut self,
        image_bytes: &[u8],
        target: Language,
        quality: OcrQualityMode,
        service: &mut TranslationService,
    ) -> Result<ImageTranslationOutcome, String> {
        let cache_key = image_cache_key(
            image_bytes,
            target,
            service.namespace(),
            quality.cache_key(),
        );
        let cache_path = self.cache_dir.join(format!("{cache_key}.png"));
        if let Ok(cached) = fs::read(&cache_path) {
            if image::load_from_memory_with_format(&cached, ImageFormat::Png).is_ok() {
                return Ok(ImageTranslationOutcome {
                    png_bytes: cached,
                    translated_count: 1,
                    used_cache: true,
                });
            }
        }
        let image = image::load_from_memory(image_bytes)
            .map_err(|error| format!("이미지 데이터를 읽을 수 없습니다: {error}"))?;
        if self.ocr.is_none() {
            self.ocr = Some(Box::new(PaddleDualOcr::new(true)?));
        }
        self.note_ocr_use(Instant::now());
        let mut lines = self
            .ocr
            .as_mut()
            .expect("OCR was initialized")
            .recognize(&image, quality)?;
        lines = group_dense_text_lines(lines, image.width(), image.height());
        let selected: Vec<_> = lines
            .into_iter()
            .filter(|line| {
                line.confidence >= 0.35
                    && !line.text.trim().is_empty()
                    && line.bbox.width().saturating_mul(line.bbox.height()) >= 16
            })
            .collect();
        let source_texts: Vec<_> = selected
            .iter()
            .map(|line| line.text.trim().to_string())
            .collect();
        let translated = service.translate_many(&source_texts, target)?;
        let translated_lines: Vec<_> = selected
            .into_iter()
            .zip(translated)
            .filter(|(line, translated)| {
                !translated.trim().is_empty() && translated.trim() != line.text.trim()
            })
            .collect();
        if translated_lines.is_empty() {
            return Ok(ImageTranslationOutcome {
                png_bytes: image_bytes.to_vec(),
                translated_count: 0,
                used_cache: false,
            });
        }
        let rendered = render_image(image, &translated_lines, target)?;
        let mut png_bytes = Vec::new();
        PngEncoder::new(Cursor::new(&mut png_bytes))
            .write_image(
                rendered.as_raw(),
                rendered.width(),
                rendered.height(),
                image::ExtendedColorType::Rgba8,
            )
            .map_err(|error| format!("번역 이미지를 PNG로 만들지 못했습니다: {error}"))?;
        fs::create_dir_all(&self.cache_dir)
            .map_err(|error| format!("이미지 번역 캐시 폴더를 만들지 못했습니다: {error}"))?;
        let temporary = cache_path.with_extension("tmp");
        fs::write(&temporary, &png_bytes)
            .map_err(|error| format!("이미지 번역 캐시를 쓰지 못했습니다: {error}"))?;
        if cache_path.exists() {
            fs::remove_file(&cache_path)
                .map_err(|error| format!("손상된 이미지 번역 캐시를 지우지 못했습니다: {error}"))?;
        }
        fs::rename(&temporary, &cache_path)
            .map_err(|error| format!("이미지 번역 캐시를 적용하지 못했습니다: {error}"))?;
        Ok(ImageTranslationOutcome {
            png_bytes,
            translated_count: translated_lines.len(),
            used_cache: false,
        })
    }
}

pub fn parse_image_requests(value: serde_json::Value) -> Result<Vec<ImageRequest>, String> {
    serde_json::from_value(value)
        .map_err(|error| format!("Discord 이미지 번역 요청 형식이 올바르지 않습니다: {error}"))
}

pub fn parse_image_data(value: serde_json::Value) -> Result<ImageData, String> {
    serde_json::from_value(value)
        .map_err(|error| format!("Discord 이미지 데이터를 읽지 못했습니다: {error}"))
}

pub fn image_capture_info_script(image_id: &str) -> Result<String, String> {
    let id = serde_json::to_string(image_id).map_err(|error| error.to_string())?;
    Ok(format!(
        r##"(() => {{
          const id={id};
          const img=document.querySelector(`[data-nt-image-id="${{CSS.escape(id)}}"]`);
          if (!img) return null;
          const rect=img.getBoundingClientRect();
          const naturalScale=Math.min(
            Number(img.naturalWidth || 0) / Math.max(rect.width, 1),
            Number(img.naturalHeight || 0) / Math.max(rect.height, 1)
          );
          const scale=Math.max(1, Math.min(2.5, Number.isFinite(naturalScale) ? naturalScale : 1));
          return {{x:rect.left+scrollX,y:rect.top+scrollY,width:rect.width,height:rect.height,
            scale,
            fullyVisible:rect.width>=160&&rect.height>=90&&rect.left>=0&&rect.top>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight}};
        }})()"##
    ))
}

pub fn parse_image_capture_info(value: serde_json::Value) -> Result<ImageCaptureInfo, String> {
    serde_json::from_value(value)
        .map_err(|error| format!("Discord 이미지 위치 정보를 읽지 못했습니다: {error}"))
}

pub fn fetch_image_data_script(image_id: &str, max_bytes: usize) -> Result<String, String> {
    let id = serde_json::to_string(image_id).map_err(|error| error.to_string())?;
    Ok(format!(
        r##"(async () => {{
          const id = {id};
          const img = document.querySelector(`[data-nt-image-id="${{CSS.escape(id)}}"]`);
          if (!img) return null;
          const maxBytes = {max_bytes};
          const fallbackCandidates = [img.currentSrc || '', img.dataset.ntOriginalSrc || '', img.src || '']
            .filter(source => source && !source.startsWith('data:') && !source.startsWith('blob:'));
          const candidates = window.__ntImageSourceCandidates?.(img) || [...new Set(fallbackCandidates)];
          let lastError = null;
          for (const source of candidates) {{
            try {{
              const response = await fetch(source, {{cache:'force-cache', credentials:'omit'}});
              if (!response.ok) throw new Error(`이미지 읽기 실패: HTTP ${{response.status}}`);
              const contentLength = Number(response.headers.get('content-length') || 0);
              if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error('이미지가 허용 크기를 초과했습니다.');
              if (!response.body) throw new Error('이미지 응답 스트림을 읽을 수 없습니다.');
              const reader = response.body.getReader(), chunks = [];
              let received = 0;
              while (true) {{
                const {{done, value}} = await reader.read();
                if (done) break;
                received += value.byteLength;
                if (received > maxBytes) {{ await reader.cancel(); throw new Error('이미지가 허용 크기를 초과했습니다.'); }}
                chunks.push(value);
              }}
              const blob = new Blob(chunks, {{type: response.headers.get('content-type') || ''}});
              const dataUrl = await new Promise((resolve, reject) => {{
                const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = () => reject(reader.error || new Error('이미지 읽기 실패'));
                reader.readAsDataURL(blob);
              }});
              const comma = dataUrl.indexOf(',');
              return {{base64: comma >= 0 ? dataUrl.slice(comma + 1) : '', mime: blob.type || '', source}};
            }} catch (error) {{ lastError = error; }}
          }}
          if (lastError) throw lastError;
          return null;
        }})()"##
    ))
}

pub fn apply_image_result_script(
    image_id: &str,
    translated_src: &str,
    source_key: &str,
) -> Result<String, String> {
    let id = serde_json::to_string(image_id).map_err(|error| error.to_string())?;
    let src = serde_json::to_string(translated_src).map_err(|error| error.to_string())?;
    let key = serde_json::to_string(source_key).map_err(|error| error.to_string())?;
    Ok(format!(
        r##"(async () => {{
          const id={id}, src={src}, requestedKey={key};
          const preload = new Image(); preload.decoding='async'; preload.src=src;
          try {{ await preload.decode(); }} catch (_) {{}}
          const img = document.querySelector(`[data-nt-image-id="${{CSS.escape(id)}}"]`);
          const key = requestedKey || img?.dataset.ntSourceKey || window.__ntImageSourceKey?.(img?.dataset.ntOriginalSrc || '') || '';
          window.__ntTranslatedImages ||= {{}}; window.__ntImageVisibility ||= {{}};
          if (key) {{ window.__ntTranslatedImages[key]=src; window.__ntImageVisibility[key]='visible'; }}
          if (!img) return {{applied:false, remembered:Boolean(key)}};
          img.dataset.ntTranslatedSrc=src; if (key) img.dataset.ntSourceKey=key;
          img.removeAttribute('srcset'); img.src=src; img.dataset.ntImageStatus='translated';
          delete img.dataset.ntImageError;
          const button=document.getElementById('nt-image-translate-button');
          if (button?.dataset.ntTarget===id) {{ window.__ntUpdateImageButton?.(img); button.title=''; }}
          return {{applied:true, remembered:Boolean(key)}};
        }})()"##
    ))
}

pub fn apply_image_error_script(image_id: &str, message: &str) -> Result<String, String> {
    let id = serde_json::to_string(image_id).map_err(|error| error.to_string())?;
    let message = serde_json::to_string(message).map_err(|error| error.to_string())?;
    Ok(format!(
        r##"(() => {{
          const id={id}, message={message};
          const img=document.querySelector(`[data-nt-image-id="${{CSS.escape(id)}}"]`);
          if (!img) return {{applied:false}};
          img.dataset.ntImageStatus='error'; img.dataset.ntImageError=message;
          const button=document.getElementById('nt-image-translate-button');
          if (message) console.warn('[NudeNyang Translator] image translation failed:', message);
          if (button?.dataset.ntTarget===id) window.__ntUpdateImageButton?.(img);
          return {{applied:true}};
        }})()"##
    ))
}

pub fn restore_images_script(discard: bool) -> String {
    format!(
        r##"(() => {{
          const discard={discard}; window.__ntImageEnabled=false;
          clearTimeout(window.__ntImageButtonTimer);
          if (window.__ntImageFrame) cancelAnimationFrame(window.__ntImageFrame);
          window.__ntImageFrame=0;
          window.__ntImageUiAbort?.abort();
          document.getElementById('nt-image-translate-button')?.remove();
          document.getElementById('nt-image-translate-style')?.remove();
          delete window.__ntUpdateImageButton;
          window.__ntImageUiInstalled=false;
          let restored=0;
          for (const img of document.querySelectorAll('img[data-nt-image-id]')) {{
            if (img.dataset.ntOriginalSrc) {{ img.src=img.dataset.ntOriginalSrc;
              if (img.dataset.ntOriginalSrcset) img.srcset=img.dataset.ntOriginalSrcset; else img.removeAttribute('srcset'); restored++; }}
            if (discard) {{ delete img.dataset.ntTranslatedSrc; delete img.dataset.ntImageError; img.dataset.ntImageStatus='original'; }}
            else img.dataset.ntImageStatus=img.dataset.ntTranslatedSrc ? 'paused' : 'original';
          }}
          if (discard) {{ window.__ntTranslatedImages={{}}; window.__ntImageVisibility={{}}; window.__ntImageRequests=[]; }}
          return {{restored}};
        }})()"##
    )
}

fn render_image(
    image: DynamicImage,
    lines: &[(TextLine, String)],
    target: Language,
) -> Result<RgbaImage, String> {
    let original = image.to_rgba8();
    let mut output = original.clone();
    let font = load_font(target)?;
    for (line, translated) in lines {
        let style = estimate_style(&original, line);
        let polygon: Vec<_> = line
            .polygon
            .iter()
            .map(|point| ImagePoint::new(point.x.round() as i32, point.y.round() as i32))
            .collect();
        draw_polygon_mut(
            &mut output,
            &polygon,
            Rgba([
                style.background.0,
                style.background.1,
                style.background.2,
                255,
            ]),
        );
        draw_fitted_text(&mut output, translated, line.bbox, &font, style.foreground);
    }
    Ok(output)
}

#[derive(Clone, Copy)]
struct TextStyle {
    foreground: (u8, u8, u8),
    background: (u8, u8, u8),
}

fn estimate_style(image: &RgbaImage, line: &TextLine) -> TextStyle {
    let rect = clipped_rect(line.bbox, image.width(), image.height());
    let mut colors: HashMap<(u8, u8, u8), usize> = HashMap::new();
    let mut samples = Vec::new();
    for y in rect.top.max(0) as u32..rect.bottom.max(0) as u32 {
        for x in rect.left.max(0) as u32..rect.right.max(0) as u32 {
            let pixel = image.get_pixel(x, y).0;
            let color = (pixel[0], pixel[1], pixel[2]);
            samples.push(color);
            let quantized = (pixel[0] & 0xf0, pixel[1] & 0xf0, pixel[2] & 0xf0);
            *colors.entry(quantized).or_default() += 1;
        }
    }
    let background = colors
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(color, _)| {
            (
                color.0.saturating_add(8),
                color.1.saturating_add(8),
                color.2.saturating_add(8),
            )
        })
        .unwrap_or((255, 255, 255));
    let foreground = samples
        .into_iter()
        .max_by_key(|color| color_distance(*color, background))
        .filter(|color| color_distance(*color, background) >= 2_000)
        .unwrap_or_else(|| {
            if luminance(background) > 140 {
                (24, 28, 34)
            } else {
                (242, 246, 250)
            }
        });
    TextStyle {
        foreground,
        background,
    }
}

fn draw_fitted_text(
    image: &mut RgbaImage,
    text: &str,
    bbox: Rect,
    font: &FontArc,
    foreground: (u8, u8, u8),
) {
    let rect = clipped_rect(bbox, image.width(), image.height());
    let padding = (rect.height() / 10).clamp(2, 8);
    let available_width = rect.width().saturating_sub(padding * 2).max(1);
    let available_height = rect.height().saturating_sub(padding * 2).max(1);
    let mut chosen = (8.0_f32, vec![text.to_string()]);
    for size in (8..=(available_height.min(96))).rev() {
        let scale = PxScale::from(size as f32);
        let wrapped = wrap_text(text, available_width, scale, font);
        let line_height = text_size(scale, font, "한Ag").1.max(size);
        let total_height = line_height.saturating_mul(wrapped.len() as u32);
        let max_width = wrapped
            .iter()
            .map(|line| text_size(scale, font, line).0)
            .max()
            .unwrap_or_default();
        if total_height <= available_height && max_width <= available_width {
            chosen = (size as f32, wrapped);
            break;
        }
    }
    let scale = PxScale::from(chosen.0);
    let line_height = text_size(scale, font, "한Ag").1.max(chosen.0 as u32);
    let total_height = line_height.saturating_mul(chosen.1.len() as u32);
    let mut y =
        rect.top + padding as i32 + available_height.saturating_sub(total_height) as i32 / 2;
    for line in chosen.1 {
        let width = text_size(scale, font, &line).0;
        let x = rect.left + padding as i32 + available_width.saturating_sub(width) as i32 / 2;
        draw_text_mut(
            image,
            Rgba([foreground.0, foreground.1, foreground.2, 255]),
            x,
            y,
            scale,
            font,
            &line,
        );
        y += line_height as i32;
    }
}

fn wrap_text(text: &str, maximum_width: u32, scale: PxScale, font: &FontArc) -> Vec<String> {
    let mut lines = Vec::new();
    for paragraph in text.lines() {
        let units: Vec<String> = if paragraph.contains(' ') {
            paragraph.split(' ').map(str::to_string).collect()
        } else {
            paragraph.chars().map(|value| value.to_string()).collect()
        };
        let separator = if paragraph.contains(' ') { " " } else { "" };
        let mut current = String::new();
        for unit in units {
            let candidate = if current.is_empty() {
                unit.clone()
            } else {
                format!("{current}{separator}{unit}")
            };
            if !current.is_empty() && text_size(scale, font, &candidate).0 > maximum_width {
                lines.push(std::mem::take(&mut current));
                current = unit;
            } else {
                current = candidate;
            }
        }
        if !current.is_empty() {
            lines.push(current);
        }
    }
    if lines.is_empty() {
        vec![text.to_string()]
    } else {
        lines
    }
}

fn load_font(target: Language) -> Result<FontArc, String> {
    for path in font_candidates(target) {
        if let Ok(bytes) = fs::read(&path) {
            if let Ok(font) = FontArc::try_from_vec(bytes) {
                return Ok(font);
            }
        }
    }
    Err("이미지 번역에 사용할 시스템 글꼴을 찾지 못했습니다.".to_string())
}

fn font_candidates(target: Language) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    #[cfg(windows)]
    {
        let root = PathBuf::from(env::var_os("WINDIR").unwrap_or_else(|| "C:\\Windows".into()))
            .join("Fonts");
        let names: &[&str] = match target {
            Language::Japanese => &["NotoSansJP-VF.ttf", "malgun.ttf", "segoeui.ttf"],
            Language::ChineseSimplified | Language::ChineseTraditional => {
                &["simsunb.ttf", "NotoSansJP-VF.ttf", "malgun.ttf"]
            }
            Language::Korean => &["NotoSansKR-VF.ttf", "notosanskr-medium.ttf", "malgun.ttf"],
            Language::Thai => &["leelawui.ttf", "Nirmala.ttf", "segoeui.ttf"],
            Language::Bengali | Language::Tamil => &["Nirmala.ttf", "NirmalaB.ttf", "segoeui.ttf"],
            Language::Urdu | Language::Persian | Language::Arabic => {
                &["Nirmala.ttf", "segoeui.ttf", "arial.ttf"]
            }
            Language::Hebrew => &["segoeui.ttf", "arial.ttf"],
            _ => &["segoeui.ttf", "arial.ttf", "malgun.ttf"],
        };
        candidates.extend(names.iter().map(|name| root.join(name)));
    }
    #[cfg(target_os = "macos")]
    {
        let names: &[&str] = match target {
            Language::Japanese => &[
                "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
                "/System/Library/Fonts/AppleSDGothicNeo.ttc",
            ],
            Language::Korean => &[
                "/System/Library/Fonts/AppleSDGothicNeo.ttc",
                "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
            ],
            Language::Thai => &[
                "/System/Library/Fonts/Thonburi.ttc",
                "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
            ],
            Language::Bengali | Language::Tamil | Language::Urdu => &[
                "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
                "/System/Library/Fonts/Supplemental/Arial.ttf",
            ],
            Language::Persian | Language::Arabic | Language::Hebrew => &[
                "/System/Library/Fonts/Supplemental/Arial.ttf",
                "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
            ],
            _ => &[
                "/System/Library/Fonts/Supplemental/Arial.ttf",
                "/System/Library/Fonts/AppleSDGothicNeo.ttc",
            ],
        };
        candidates.extend(names.iter().map(PathBuf::from));
    }
    candidates
}

fn group_dense_text_lines(
    lines: Vec<TextLine>,
    image_width: u32,
    image_height: u32,
) -> Vec<TextLine> {
    let maximum_height = 18_u32.max((f64::from(image_height) * 0.018).round() as u32);
    let minimum_width = 42_u32.max((f64::from(image_width) * 0.045).round() as u32);
    let candidate_indices: Vec<_> = lines
        .iter()
        .enumerate()
        .filter(|(_, line)| {
            let height = line.bbox.height();
            (7..=maximum_height).contains(&height)
                && line.bbox.width() >= minimum_width
                && line
                    .text
                    .chars()
                    .filter(|value| value.is_alphanumeric())
                    .count()
                    >= 3
        })
        .map(|(index, _)| index)
        .collect();
    if candidate_indices.len() < 2 {
        return lines;
    }
    let mut parent: Vec<usize> = (0..candidate_indices.len()).collect();
    for first in 0..candidate_indices.len() {
        for second in first + 1..candidate_indices.len() {
            if same_paragraph(
                &lines[candidate_indices[first]],
                &lines[candidate_indices[second]],
            ) {
                union(&mut parent, first, second);
            }
        }
    }
    let mut components: HashMap<usize, Vec<usize>> = HashMap::new();
    for (position, line_index) in candidate_indices.into_iter().enumerate() {
        let root = find(&mut parent, position);
        components.entry(root).or_default().push(line_index);
    }
    let merged_groups: Vec<_> = components
        .into_values()
        .filter(|group| group.len() >= 2)
        .collect();
    if merged_groups.is_empty() {
        return lines;
    }
    let consumed: std::collections::HashSet<_> = merged_groups.iter().flatten().copied().collect();
    let mut result: Vec<_> = lines
        .iter()
        .enumerate()
        .filter(|(index, _)| !consumed.contains(index))
        .map(|(_, line)| line.clone())
        .collect();
    for mut group in merged_groups {
        group.sort_by_key(|index| (lines[*index].bbox.top, lines[*index].bbox.left));
        let left = group
            .iter()
            .map(|index| lines[*index].bbox.left)
            .min()
            .unwrap_or_default();
        let top = group
            .iter()
            .map(|index| lines[*index].bbox.top)
            .min()
            .unwrap_or_default();
        let right = group
            .iter()
            .map(|index| lines[*index].bbox.right)
            .max()
            .unwrap_or_default();
        let bottom = group
            .iter()
            .map(|index| lines[*index].bbox.bottom)
            .max()
            .unwrap_or_default();
        let language = group
            .iter()
            .map(|index| lines[*index].language)
            .find(|language| *language != Language::Unknown)
            .unwrap_or(Language::Unknown);
        result.push(TextLine {
            polygon: [
                Point {
                    x: left as f32,
                    y: top as f32,
                },
                Point {
                    x: right as f32,
                    y: top as f32,
                },
                Point {
                    x: right as f32,
                    y: bottom as f32,
                },
                Point {
                    x: left as f32,
                    y: bottom as f32,
                },
            ],
            bbox: Rect {
                left,
                top,
                right,
                bottom,
            },
            text: group
                .iter()
                .map(|index| lines[*index].text.trim())
                .collect::<Vec<_>>()
                .join("\n"),
            confidence: group
                .iter()
                .map(|index| lines[*index].confidence)
                .sum::<f64>()
                / group.len() as f64,
            language,
            candidates: Vec::new(),
        });
    }
    result.sort_by_key(|line| (line.bbox.top, line.bbox.left));
    result
}

fn same_paragraph(first: &TextLine, second: &TextLine) -> bool {
    if first.language != second.language
        && first.language != Language::Unknown
        && second.language != Language::Unknown
    {
        return false;
    }
    let (upper, lower) = if first.bbox.top <= second.bbox.top {
        (first, second)
    } else {
        (second, first)
    };
    let min_height = upper.bbox.height().min(lower.bbox.height()).max(1);
    let max_height = upper.bbox.height().max(lower.bbox.height());
    if max_height as f64 / min_height as f64 > 1.45 {
        return false;
    }
    let gap = lower.bbox.top - upper.bbox.bottom;
    if gap < -(min_height as f64 * 0.4) as i32 || gap > 14_i32.max((max_height as f64 * 1.1) as i32)
    {
        return false;
    }
    let overlap =
        0.max(first.bbox.right.min(second.bbox.right) - first.bbox.left.max(second.bbox.left));
    let overlap_ratio = overlap as f64 / first.bbox.width().min(second.bbox.width()).max(1) as f64;
    let first_center = (first.bbox.left + first.bbox.right) as f64 / 2.0;
    let second_center = (second.bbox.left + second.bbox.right) as f64 / 2.0;
    overlap_ratio >= 0.52
        && (first_center - second_center).abs()
            <= first.bbox.width().max(second.bbox.width()) as f64 * 0.34
}

fn find(parent: &mut [usize], mut index: usize) -> usize {
    while parent[index] != index {
        parent[index] = parent[parent[index]];
        index = parent[index];
    }
    index
}

fn union(parent: &mut [usize], first: usize, second: usize) {
    let first_root = find(parent, first);
    let second_root = find(parent, second);
    if first_root != second_root {
        parent[second_root] = first_root;
    }
}

fn clipped_rect(rect: Rect, width: u32, height: u32) -> Rect {
    Rect {
        left: rect.left.clamp(0, width as i32),
        top: rect.top.clamp(0, height as i32),
        right: rect.right.clamp(0, width as i32),
        bottom: rect.bottom.clamp(0, height as i32),
    }
}

fn color_distance(first: (u8, u8, u8), second: (u8, u8, u8)) -> u32 {
    let red = i32::from(first.0) - i32::from(second.0);
    let green = i32::from(first.1) - i32::from(second.1);
    let blue = i32::from(first.2) - i32::from(second.2);
    (red * red + green * green + blue * blue) as u32
}

fn luminance(color: (u8, u8, u8)) -> u16 {
    (u16::from(color.0) * 54 + u16::from(color.1) * 183 + u16::from(color.2) * 19) / 256
}

fn image_cache_key(image: &[u8], target: Language, namespace: &str, quality: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(image);
    digest.update([0]);
    digest.update(target.code().as_bytes());
    digest.update([0]);
    digest.update(namespace.as_bytes());
    digest.update([0]);
    digest.update(quality.as_bytes());
    digest.update([0]);
    digest.update(IMAGE_RENDER_VERSION.as_bytes());
    format!("{:x}", digest.finalize())
}

fn default_cache_dir() -> PathBuf {
    #[cfg(windows)]
    if let Some(local) = env::var_os("LOCALAPPDATA") {
        return PathBuf::from(local)
            .join("LocalTools")
            .join("DiscordTranslateOverlay")
            .join("Cache")
            .join("image-translations");
    }
    #[cfg(target_os = "macos")]
    if let Some(home) = env::var_os("HOME") {
        return PathBuf::from(home)
            .join("Library/Caches/DiscordTranslateOverlay/image-translations");
    }
    env::temp_dir().join("DiscordTranslateOverlay/image-translations")
}

#[cfg(test)]
mod tests {
    use super::{
        apply_image_error_script, fetch_image_data_script, group_dense_text_lines, image_cache_key,
        image_capture_info_script, image_ui_script, parse_image_capture_info, parse_image_requests,
        restore_images_script, ImageTranslationProcessor, OcrRecognizer, IMAGE_UI_SCRIPT,
    };
    use crate::cache::TranslationCache;
    use crate::language::Language;
    use crate::ocr::{OcrQualityMode, Point, Rect, TextLine};
    use crate::translation::{MockTranslator, TranslationService};
    use image::{DynamicImage, GenericImageView, ImageFormat, Rgba, RgbaImage};
    use std::io::Cursor;
    use std::path::PathBuf;
    use std::time::{Duration, Instant};

    struct FakeOcr;

    impl OcrRecognizer for FakeOcr {
        fn recognize(
            &mut self,
            _image: &DynamicImage,
            _quality: OcrQualityMode,
        ) -> Result<Vec<TextLine>, String> {
            Ok(vec![line(35, "Hello poster")])
        }
    }

    fn line(top: i32, text: &str) -> TextLine {
        TextLine {
            polygon: [
                Point {
                    x: 10.0,
                    y: top as f32,
                },
                Point {
                    x: 160.0,
                    y: top as f32,
                },
                Point {
                    x: 160.0,
                    y: (top + 15) as f32,
                },
                Point {
                    x: 10.0,
                    y: (top + 15) as f32,
                },
            ],
            bbox: Rect {
                left: 10,
                top,
                right: 160,
                bottom: top + 15,
            },
            text: text.to_string(),
            confidence: 0.9,
            language: Language::Japanese,
            candidates: Vec::new(),
        }
    }

    #[test]
    fn image_request_contract_matches_the_dom_queue() {
        let requests = parse_image_requests(serde_json::json!([
            {"id":"nt-image-1","sourceKey":"discord-attachment:/attachments/1/a.png"}
        ]))
        .unwrap();
        assert_eq!(requests[0].id, "nt-image-1");
        assert!(requests[0].source_key.starts_with("discord-attachment:"));
    }

    #[test]
    fn image_controls_receive_the_selected_interface_language() {
        let japanese = image_ui_script("ja");
        assert!(japanese.contains("const requestedUiLanguage = \"ja\""));
        assert!(japanese.contains("画像を翻訳"));
        assert!(!japanese.contains("__UI_LANGUAGE__"));

        let fallback = image_ui_script("unsupported");
        assert!(fallback.contains("const requestedUiLanguage = \"en\""));

        let arabic = image_ui_script("ar");
        assert!(arabic.contains("const requestedUiLanguage = \"ar\""));
        assert!(arabic.contains("\"ar\":{"));
        assert!(!arabic.contains("__GENERATED_IMAGE_COPIES__"));
    }

    #[test]
    fn image_hover_never_selects_an_obscured_background_image() {
        assert!(IMAGE_UI_SCRIPT.contains("event.composedPath()"));
        assert!(!IMAGE_UI_SCRIPT.contains("document.elementsFromPoint(x, y)"));
    }

    #[test]
    fn image_fetch_prefers_the_selected_full_resolution_source() {
        let current = IMAGE_UI_SCRIPT
            .find("img.currentSrc || largestSrcsetSource(img)")
            .expect("currentSrc must be preferred");
        let raw_attribute = IMAGE_UI_SCRIPT
            .find("img.getAttribute('src') || img.src")
            .expect("raw src remains a fallback");
        assert!(current < raw_attribute);
        assert!(IMAGE_UI_SCRIPT.contains("url.hostname = 'cdn.discordapp.com'"));
        assert!(IMAGE_UI_SCRIPT.contains("['width','height','format','quality']"));

        let fetch = fetch_image_data_script("nt-image-1", 1024).unwrap();
        assert!(fetch.contains("window.__ntImageSourceCandidates?.(img)"));
        assert!(fetch.contains("for (const source of candidates)"));
    }

    #[test]
    fn screenshot_fallback_uses_the_decoded_image_resolution() {
        let script = image_capture_info_script("nt-image-1").unwrap();
        assert!(script.contains("img.naturalWidth"));
        assert!(script.contains("img.naturalHeight"));
        let info = parse_image_capture_info(serde_json::json!({
            "x": 0.0,
            "y": 0.0,
            "width": 800.0,
            "height": 600.0,
            "scale": 2.0,
            "fullyVisible": true
        }))
        .unwrap();
        assert_eq!(info.scale, 2.0);
    }

    #[test]
    fn image_cache_is_separated_by_ocr_quality_mode() {
        let fast = image_cache_key(b"same-image", Language::Korean, "same-model", "fast");
        let quality = image_cache_key(b"same-image", Language::Korean, "same-model", "quality");
        assert_ne!(fast, quality);
    }

    #[test]
    fn expanded_image_view_retargets_and_repositions_the_translation_button() {
        assert!(IMAGE_UI_SCRIPT.contains("const activeViewerImage = () =>"));
        assert!(IMAGE_UI_SCRIPT.contains("const target = activeViewerImage() || img"));
        assert!(IMAGE_UI_SCRIPT.contains("new MutationObserver"));
        assert!(IMAGE_UI_SCRIPT.contains("if (viewer) show(viewer)"));
        assert!(IMAGE_UI_SCRIPT.contains("window.addEventListener('resize'"));
    }

    #[test]
    fn generated_scripts_json_escape_untrusted_values() {
        let fetch = fetch_image_data_script("x\";throw new Error('bad')//", 1024).unwrap();
        assert!(fetch.contains("\\\""));
        assert!(fetch.contains("const maxBytes = 1024"));
        assert!(fetch.contains("received > maxBytes"));
        let error = apply_image_error_script("one", "줄1\n'줄2").unwrap();
        assert!(error.contains("\\n"));
    }

    #[test]
    fn disabling_translation_unmounts_the_image_ui_and_allows_reinstall() {
        let cleanup = restore_images_script(false);

        assert!(cleanup.contains("window.__ntImageUiAbort?.abort()"));
        assert!(cleanup.contains("nt-image-translate-button')?.remove()"));
        assert!(cleanup.contains("nt-image-translate-style')?.remove()"));
        assert!(cleanup.contains("window.__ntImageUiInstalled=false"));
        assert!(IMAGE_UI_SCRIPT.contains("window.__ntImageUiAbort.signal.aborted"));
    }

    #[test]
    fn adjacent_small_rows_become_one_paragraph() {
        let grouped = group_dense_text_lines(
            vec![line(10, "一番目の行"), line(27, "二番目の行")],
            800,
            1000,
        );
        assert_eq!(grouped.len(), 1);
        assert!(grouped[0].text.contains('\n'));
    }

    #[test]
    fn processor_translates_and_renders_a_png_without_python() {
        let root = std::env::temp_dir().join(format!(
            "nude-translator-rust-image-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let cache = TranslationCache::open(root.join("translations.db"), 32).unwrap();
        let mut service = TranslationService::new(Box::new(MockTranslator), cache);
        let mut processor = ImageTranslationProcessor::with_ocr(
            Box::new(FakeOcr),
            PathBuf::from(&root).join("images"),
        );
        let source =
            DynamicImage::ImageRgba8(RgbaImage::from_pixel(220, 120, Rgba([245, 245, 245, 255])));
        let mut encoded = Cursor::new(Vec::new());
        source.write_to(&mut encoded, ImageFormat::Png).unwrap();
        let outcome = processor
            .process(
                encoded.get_ref(),
                Language::Korean,
                OcrQualityMode::Adaptive,
                &mut service,
            )
            .unwrap();
        assert_eq!(outcome.translated_count, 1);
        let rendered =
            image::load_from_memory_with_format(&outcome.png_bytes, ImageFormat::Png).unwrap();
        assert_eq!(rendered.dimensions(), source.dimensions());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn idle_ocr_models_are_released_after_five_minutes() {
        let root = std::env::temp_dir().join(format!(
            "nude-translator-ocr-idle-test-{}",
            std::process::id()
        ));
        let mut processor = ImageTranslationProcessor::with_ocr(Box::new(FakeOcr), root);
        let started = Instant::now();
        processor.note_ocr_use(started);

        assert!(!processor.release_ocr_if_idle(started + Duration::from_secs(299)));
        assert!(processor.release_ocr_if_idle(started + Duration::from_secs(301)));
        assert!(!processor.ocr_ready());
    }
}
