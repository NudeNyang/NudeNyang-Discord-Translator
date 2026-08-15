use std::cmp::Ordering;
use std::collections::HashMap;
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use image::{DynamicImage, ImageBuffer, Rgb};
use ocr_rs::{DetOnlyEngine, DetOptions, OcrEngine, OcrEngineConfig, RecOnlyEngine};
use reqwest::blocking::Client;
use reqwest::header::RANGE;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::language::{CandidateSelector, Language, RecognitionCandidate};

const MODEL_REVISION: &str = "2d0a7e582b955cc6627091765560a78776bcce5c";
const MODEL_BASE_URL: &str = "https://raw.githubusercontent.com/zibo-chen/rust-paddle-ocr";

#[derive(Clone, Copy, Debug)]
struct ModelAsset {
    filename: &'static str,
    expected_bytes: u64,
    expected_sha256: &'static str,
}

const DET_MODEL: ModelAsset = ModelAsset {
    filename: "PP-OCRv6_small_det.mnn",
    expected_bytes: 4_965_224,
    expected_sha256: "2c6277abbbddb4c77a790f4650cdd7f8ab33512db38fac372ed5471538070619",
};
const V6_REC_MODEL: ModelAsset = ModelAsset {
    filename: "PP-OCRv6_small_rec.mnn",
    expected_bytes: 10_646_760,
    expected_sha256: "ed59cc294fe2d564bd64f929b5356b70abd0977f99e7e60e3b08cfeef4ef72be",
};
const KO_REC_MODEL: ModelAsset = ModelAsset {
    filename: "korean_PP-OCRv5_mobile_rec_infer.mnn",
    expected_bytes: 6_776_036,
    expected_sha256: "806d9773f5f0b00c16eac2b13ba91d50de3485f28ca7669be2e7ea9a66a41e38",
};
const V6_CHARSET: ModelAsset = ModelAsset {
    filename: "ppocr_keys_v6_small.txt",
    expected_bytes: 74_947,
    expected_sha256: "b5f2bfe2bdd9448429e3e82b51c789775d9b42f2403d082b00662eb77e401c5d",
};
const MEDIUM_DET_MODEL: ModelAsset = ModelAsset {
    filename: "PP-OCRv6_medium_det.mnn",
    expected_bytes: 31_078_716,
    expected_sha256: "a174009ef81dd84f29034047cd56e50b73ef624a3a409226418be63ffc46ca60",
};
const MEDIUM_REC_MODEL: ModelAsset = ModelAsset {
    filename: "PP-OCRv6_medium_rec.mnn",
    expected_bytes: 38_382_108,
    expected_sha256: "11bbedb5af3a33cb7fee505de19223243d85b82c7b507af51e345ea1b4e68e72",
};
const MEDIUM_CHARSET: ModelAsset = ModelAsset {
    filename: "ppocr_keys_v6_medium.txt",
    expected_bytes: 74_947,
    expected_sha256: "b5f2bfe2bdd9448429e3e82b51c789775d9b42f2403d082b00662eb77e401c5d",
};
const KO_CHARSET: ModelAsset = ModelAsset {
    filename: "ppocr_keys_korean.txt",
    expected_bytes: 47_451,
    expected_sha256: "a88071c68c01707489baa79ebE0405b7beb5cca229f4fc94cc3ef992328802d7",
};
const MODEL_ASSETS: [ModelAsset; 5] = [
    DET_MODEL,
    V6_REC_MODEL,
    KO_REC_MODEL,
    V6_CHARSET,
    KO_CHARSET,
];
const MEDIUM_MODEL_ASSETS: [ModelAsset; 3] = [MEDIUM_DET_MODEL, MEDIUM_REC_MODEL, MEDIUM_CHARSET];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OcrQualityMode {
    Fast,
    Adaptive,
    Quality,
}

impl OcrQualityMode {
    pub fn from_config(value: &str) -> Self {
        match value {
            "fast" => Self::Fast,
            "quality" => Self::Quality,
            _ => Self::Adaptive,
        }
    }

    pub fn cache_key(self) -> &'static str {
        match self {
            Self::Fast => "fast",
            Self::Adaptive => "adaptive",
            Self::Quality => "quality",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum MediumRetryPlan {
    Skip,
    Regions(Vec<usize>),
    FullImage,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub struct Point {
    pub x: f32,
    pub y: f32,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl Rect {
    pub fn width(self) -> u32 {
        self.right.saturating_sub(self.left) as u32
    }

    pub fn height(self) -> u32 {
        self.bottom.saturating_sub(self.top) as u32
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TextLine {
    pub polygon: [Point; 4],
    pub bbox: Rect,
    pub text: String,
    pub confidence: f64,
    pub language: Language,
    pub candidates: Vec<RecognitionCandidate>,
}

pub struct PaddleDualOcr {
    detector: DetOnlyEngine,
    v6_recognizer: RecOnlyEngine,
    ko_recognizer: RecOnlyEngine,
    medium: Option<MediumOcr>,
    selector: CandidateSelector,
    enhance_colored_text: bool,
}

struct MediumOcr {
    detector: DetOnlyEngine,
    recognizer: RecOnlyEngine,
}

#[derive(Clone)]
struct DetectedRegion {
    crop: DynamicImage,
    polygon: [Point; 4],
    bbox: Rect,
    confidence: f64,
}

impl PaddleDualOcr {
    pub fn new(enhance_colored_text: bool) -> Result<Self, String> {
        let root = ensure_models()?;
        let detector = OcrEngine::det_only(
            root.join(DET_MODEL.filename),
            Some(
                OcrEngineConfig::new().with_det_options(DetOptions::new().with_max_side_len(1536)),
            ),
        )
        .map_err(|error| format!("PP-OCRv6 감지 모델을 열지 못했습니다: {error}"))?;
        let v6_recognizer = OcrEngine::rec_only(
            root.join(V6_REC_MODEL.filename),
            root.join(V6_CHARSET.filename),
            Some(OcrEngineConfig::new()),
        )
        .map_err(|error| format!("PP-OCRv6 인식 모델을 열지 못했습니다: {error}"))?;
        let ko_recognizer = OcrEngine::rec_only(
            root.join(KO_REC_MODEL.filename),
            root.join(KO_CHARSET.filename),
            Some(OcrEngineConfig::new()),
        )
        .map_err(|error| format!("한국어 PP-OCRv5 인식 모델을 열지 못했습니다: {error}"))?;
        Ok(Self {
            detector,
            v6_recognizer,
            ko_recognizer,
            medium: None,
            selector: CandidateSelector::default(),
            enhance_colored_text,
        })
    }

    pub fn recognize(&mut self, image: &DynamicImage) -> Result<Vec<TextLine>, String> {
        self.recognize_with_quality(image, OcrQualityMode::Adaptive)
    }

    pub fn recognize_with_quality(
        &mut self,
        image: &DynamicImage,
        quality: OcrQualityMode,
    ) -> Result<Vec<TextLine>, String> {
        let primary = self.recognize_once(image, quality)?;
        if !self.enhance_colored_text || colored_pixel_ratio(image) < 0.01 {
            return Ok(primary);
        }
        let enhanced = minimum_channel_image(image);
        let secondary = self.recognize_once(&enhanced, quality)?;
        Ok(merge_text_lines(primary, secondary))
    }

    fn recognize_once(
        &mut self,
        image: &DynamicImage,
        quality: OcrQualityMode,
    ) -> Result<Vec<TextLine>, String> {
        if quality == OcrQualityMode::Quality {
            self.ensure_medium()?;
            let regions = detect_regions(
                &mut self.medium.as_mut().expect("medium OCR is loaded").detector,
                image,
            )?;
            return recognize_regions(
                &mut self
                    .medium
                    .as_mut()
                    .expect("medium OCR is loaded")
                    .recognizer,
                &mut self.ko_recognizer,
                &mut self.selector,
                &regions,
                "PP-OCRv6-medium",
            );
        }

        let regions = detect_regions(&mut self.detector, image)?;
        let mut lines = recognize_regions(
            &mut self.v6_recognizer,
            &mut self.ko_recognizer,
            &mut self.selector,
            &regions,
            "PP-OCRv6-small",
        )?;
        match medium_retry_plan(quality, &lines) {
            MediumRetryPlan::Skip => Ok(lines),
            MediumRetryPlan::FullImage => {
                self.ensure_medium()?;
                let regions = detect_regions(
                    &mut self.medium.as_mut().expect("medium OCR is loaded").detector,
                    image,
                )?;
                recognize_regions(
                    &mut self
                        .medium
                        .as_mut()
                        .expect("medium OCR is loaded")
                        .recognizer,
                    &mut self.ko_recognizer,
                    &mut self.selector,
                    &regions,
                    "PP-OCRv6-medium",
                )
            }
            MediumRetryPlan::Regions(indices) => {
                self.ensure_medium()?;
                let crops = indices
                    .iter()
                    .map(|index| recognition_crop(&regions[*index]))
                    .collect::<Vec<_>>();
                let recognized = self
                    .medium
                    .as_mut()
                    .expect("medium OCR is loaded")
                    .recognizer
                    .recognize_batch(&crops)
                    .map_err(|error| {
                        format!("PP-OCRv6 Medium 글자 인식에 실패했습니다: {error}")
                    })?;
                if recognized.len() != indices.len() {
                    return Err(
                        "Medium OCR 인식 결과 수가 재처리 영역 수와 일치하지 않습니다.".to_string(),
                    );
                }
                for (index, result) in indices.into_iter().zip(recognized) {
                    lines[index].candidates.push(RecognitionCandidate {
                        engine: "PP-OCRv6-medium".to_string(),
                        text: result.text,
                        confidence: f64::from(result.confidence),
                    });
                    let (best, language) = self.selector.choose(&lines[index].candidates);
                    lines[index].text = best.text.trim().to_string();
                    lines[index].confidence = regions[index].confidence.min(best.confidence);
                    lines[index].language = language;
                }
                lines.sort_by(line_order);
                Ok(lines)
            }
        }
    }

    fn ensure_medium(&mut self) -> Result<(), String> {
        if self.medium.is_some() {
            return Ok(());
        }
        let root = ensure_medium_models()?;
        let detector = OcrEngine::det_only(
            root.join(MEDIUM_DET_MODEL.filename),
            Some(
                OcrEngineConfig::new().with_det_options(DetOptions::new().with_max_side_len(1536)),
            ),
        )
        .map_err(|error| format!("PP-OCRv6 Medium 감지 모델을 열지 못했습니다: {error}"))?;
        let recognizer = OcrEngine::rec_only(
            root.join(MEDIUM_REC_MODEL.filename),
            root.join(MEDIUM_CHARSET.filename),
            Some(OcrEngineConfig::new()),
        )
        .map_err(|error| format!("PP-OCRv6 Medium 인식 모델을 열지 못했습니다: {error}"))?;
        self.medium = Some(MediumOcr {
            detector,
            recognizer,
        });
        Ok(())
    }
}

fn medium_retry_plan(quality: OcrQualityMode, lines: &[TextLine]) -> MediumRetryPlan {
    match quality {
        OcrQualityMode::Fast => MediumRetryPlan::Skip,
        OcrQualityMode::Quality => MediumRetryPlan::FullImage,
        OcrQualityMode::Adaptive if lines.is_empty() => MediumRetryPlan::FullImage,
        OcrQualityMode::Adaptive => {
            let indices = lines
                .iter()
                .enumerate()
                .filter_map(|(index, line)| {
                    let useful_characters = line
                        .text
                        .chars()
                        .filter(|character| character.is_alphanumeric())
                        .count();
                    (line.confidence < 0.72
                        || line.language == Language::Unknown
                        || useful_characters <= 2)
                        .then_some(index)
                })
                .collect::<Vec<_>>();
            if indices.is_empty() {
                MediumRetryPlan::Skip
            } else {
                MediumRetryPlan::Regions(indices)
            }
        }
    }
}

fn detect_regions(
    detector: &mut DetOnlyEngine,
    image: &DynamicImage,
) -> Result<Vec<DetectedRegion>, String> {
    let mut detections = detector
        .detect_and_crop(image)
        .map_err(|error| format!("이미지에서 글자 영역을 찾지 못했습니다: {error}"))?;
    detections.sort_by(|(_, left), (_, right)| {
        left.rect
            .top()
            .cmp(&right.rect.top())
            .then_with(|| left.rect.left().cmp(&right.rect.left()))
    });
    Ok(detections
        .into_iter()
        .map(|(crop, detected)| {
            let rect = detected.rect;
            let polygon = detected.points.map_or_else(
                || {
                    [
                        Point {
                            x: rect.left() as f32,
                            y: rect.top() as f32,
                        },
                        Point {
                            x: rect.right() as f32,
                            y: rect.top() as f32,
                        },
                        Point {
                            x: rect.right() as f32,
                            y: rect.bottom() as f32,
                        },
                        Point {
                            x: rect.left() as f32,
                            y: rect.bottom() as f32,
                        },
                    ]
                },
                |points| {
                    points.map(|point| Point {
                        x: point.x,
                        y: point.y,
                    })
                },
            );
            DetectedRegion {
                crop,
                polygon,
                bbox: Rect {
                    left: rect.left(),
                    top: rect.top(),
                    right: rect.right(),
                    bottom: rect.bottom(),
                },
                confidence: f64::from(detected.score),
            }
        })
        .collect())
}

fn recognize_regions(
    recognizer: &mut RecOnlyEngine,
    ko_recognizer: &mut RecOnlyEngine,
    selector: &mut CandidateSelector,
    regions: &[DetectedRegion],
    engine_name: &str,
) -> Result<Vec<TextLine>, String> {
    if regions.is_empty() {
        return Ok(Vec::new());
    }
    let crops = regions
        .iter()
        .map(|region| region.crop.clone())
        .collect::<Vec<_>>();
    let v6 = recognizer
        .recognize_batch(&crops)
        .map_err(|error| format!("PP-OCRv6 글자 인식에 실패했습니다: {error}"))?;
    let korean = ko_recognizer
        .recognize_batch(&crops)
        .map_err(|error| format!("한국어 PP-OCRv5 글자 인식에 실패했습니다: {error}"))?;
    if v6.len() != regions.len() || korean.len() != regions.len() {
        return Err("OCR 인식 결과 수가 감지 영역 수와 일치하지 않습니다.".to_string());
    }

    let vertical_indices = regions
        .iter()
        .enumerate()
        .filter_map(|(index, region)| is_vertical_region(region).then_some(index))
        .collect::<Vec<_>>();
    let vertical_results = if vertical_indices.is_empty() {
        Vec::new()
    } else {
        let crops = vertical_indices
            .iter()
            .map(|index| recognition_crop(&regions[*index]))
            .collect::<Vec<_>>();
        recognizer
            .recognize_batch(&crops)
            .map_err(|error| format!("PP-OCRv6 세로 글자 인식에 실패했습니다: {error}"))?
    };
    let vertical_by_index = vertical_indices
        .into_iter()
        .zip(vertical_results)
        .collect::<HashMap<_, _>>();

    let mut lines = Vec::with_capacity(regions.len());
    for (index, ((region, v6), korean)) in regions.iter().zip(v6).zip(korean).enumerate() {
        let mut candidates = vec![
            RecognitionCandidate {
                engine: engine_name.to_string(),
                text: v6.text,
                confidence: f64::from(v6.confidence),
            },
            RecognitionCandidate {
                engine: "korean_PP-OCRv5-mobile".to_string(),
                text: korean.text,
                confidence: f64::from(korean.confidence),
            },
        ];
        if let Some(vertical) = vertical_by_index.get(&index) {
            candidates.push(RecognitionCandidate {
                engine: format!("{engine_name}-vertical"),
                text: vertical.text.clone(),
                confidence: f64::from(vertical.confidence),
            });
        }
        let (best, language) = selector.choose(&candidates);
        lines.push(TextLine {
            polygon: region.polygon,
            bbox: region.bbox,
            text: best.text.trim().to_string(),
            confidence: region.confidence.min(best.confidence),
            language,
            candidates,
        });
    }
    lines.sort_by(line_order);
    Ok(lines)
}

fn is_vertical_region(region: &DetectedRegion) -> bool {
    let width = region.bbox.width();
    let height = region.bbox.height();
    width >= 12 && height >= 48 && height >= width.saturating_mul(2)
}

fn recognition_crop(region: &DetectedRegion) -> DynamicImage {
    if is_vertical_region(region) {
        // Japanese tategaki is read top-to-bottom. Rotating the crop counter-clockwise
        // presents that order left-to-right to Paddle's horizontal recognizer.
        region.crop.rotate270()
    } else {
        region.crop.clone()
    }
}

fn line_order(left: &TextLine, right: &TextLine) -> Ordering {
    left.bbox
        .top
        .cmp(&right.bbox.top)
        .then_with(|| left.bbox.left.cmp(&right.bbox.left))
}

fn colored_pixel_ratio(image: &DynamicImage) -> f64 {
    let rgb = image.to_rgb8();
    if rgb.width() == 0 || rgb.height() == 0 {
        return 0.0;
    }
    let colored = rgb
        .pixels()
        .filter(|pixel| {
            let [red, green, blue] = pixel.0;
            red.max(green).max(blue) - red.min(green).min(blue) >= 45
        })
        .count();
    colored as f64 / f64::from(rgb.width() * rgb.height())
}

fn minimum_channel_image(image: &DynamicImage) -> DynamicImage {
    let rgb = image.to_rgb8();
    let mut output = ImageBuffer::new(rgb.width(), rgb.height());
    for (x, y, pixel) in rgb.enumerate_pixels() {
        let value = pixel.0.into_iter().min().unwrap_or_default();
        output.put_pixel(x, y, Rgb([value, value, value]));
    }
    DynamicImage::ImageRgb8(output)
}

fn merge_text_lines(primary: Vec<TextLine>, enhanced: Vec<TextLine>) -> Vec<TextLine> {
    let mut merged = primary;
    for candidate in enhanced {
        let candidate_area = polygon_area(&candidate.polygon);
        let duplicate = merged.iter().any(|existing| {
            let existing_area = polygon_area(&existing.polygon);
            let area_ratio =
                candidate_area.min(existing_area) / candidate_area.max(existing_area).max(1.0);
            let (smaller, larger) = if candidate_area <= existing_area {
                (&candidate, existing)
            } else {
                (existing, &candidate)
            };
            let overlap = polygon_overlap_ratio(smaller, larger);
            (overlap >= 0.72 && area_ratio >= 0.55)
                || (candidate_area <= existing_area && overlap >= 0.72)
        });
        if !duplicate {
            merged.push(candidate);
        }
    }

    let snapshot = merged.clone();
    merged = snapshot
        .iter()
        .enumerate()
        .filter(|(candidate_index, candidate)| {
            let candidate_area = polygon_area(&candidate.polygon);
            !snapshot.iter().enumerate().any(|(other_index, other)| {
                if *candidate_index == other_index {
                    return false;
                }
                let other_area = polygon_area(&other.polygon);
                let candidate_units = candidate
                    .text
                    .chars()
                    .filter(|value| value.is_alphanumeric())
                    .count();
                let other_units = other
                    .text
                    .chars()
                    .filter(|value| value.is_alphanumeric())
                    .count();
                (other_area >= candidate_area * 1.8
                    && polygon_overlap_ratio(candidate, other) >= 0.72
                    && (other.confidence >= candidate.confidence
                        || candidate_units
                            <= 2_usize.max((other_units as f64 * 0.42).round() as usize)))
                    || (candidate_area >= other_area * 1.8
                        && polygon_overlap_ratio(other, candidate) >= 0.72
                        && other.confidence >= candidate.confidence + 0.08
                        && other_units >= candidate_units)
            })
        })
        .map(|(_, line)| line.clone())
        .collect();
    merged.sort_by(|left, right| {
        polygon_center(&left.polygon)
            .1
            .partial_cmp(&polygon_center(&right.polygon).1)
            .unwrap_or(Ordering::Equal)
            .then_with(|| {
                polygon_center(&left.polygon)
                    .0
                    .partial_cmp(&polygon_center(&right.polygon).0)
                    .unwrap_or(Ordering::Equal)
            })
    });
    merged
}

fn polygon_center(points: &[Point; 4]) -> (f32, f32) {
    (
        points.iter().map(|point| point.x).sum::<f32>() / 4.0,
        points.iter().map(|point| point.y).sum::<f32>() / 4.0,
    )
}

fn polygon_area(points: &[Point; 4]) -> f64 {
    let mut twice_area = 0.0_f64;
    for index in 0..points.len() {
        let current = points[index];
        let next = points[(index + 1) % points.len()];
        twice_area += f64::from(current.x * next.y - next.x * current.y);
    }
    twice_area.abs() * 0.5
}

fn polygon_overlap_ratio(smaller: &TextLine, larger: &TextLine) -> f64 {
    let area = polygon_area(&smaller.polygon);
    if area <= f64::EPSILON {
        return 0.0;
    }
    polygon_area_vec(&clip_convex_polygon(&smaller.polygon, &larger.polygon)) / area
}

fn clip_convex_polygon(subject: &[Point; 4], clip: &[Point; 4]) -> Vec<Point> {
    let mut output = subject.to_vec();
    let orientation = signed_polygon_area(clip).signum();
    for edge_index in 0..clip.len() {
        let edge_start = clip[edge_index];
        let edge_end = clip[(edge_index + 1) % clip.len()];
        let input = std::mem::take(&mut output);
        if input.is_empty() {
            break;
        }
        let mut previous = *input.last().expect("input is not empty");
        for current in input {
            let current_inside = is_inside(current, edge_start, edge_end, orientation);
            let previous_inside = is_inside(previous, edge_start, edge_end, orientation);
            if current_inside {
                if !previous_inside {
                    output.push(line_intersection(previous, current, edge_start, edge_end));
                }
                output.push(current);
            } else if previous_inside {
                output.push(line_intersection(previous, current, edge_start, edge_end));
            }
            previous = current;
        }
    }
    output
}

fn signed_polygon_area(points: &[Point; 4]) -> f32 {
    (0..points.len())
        .map(|index| {
            let current = points[index];
            let next = points[(index + 1) % points.len()];
            current.x * next.y - next.x * current.y
        })
        .sum::<f32>()
        * 0.5
}

fn is_inside(point: Point, edge_start: Point, edge_end: Point, orientation: f32) -> bool {
    let cross = (edge_end.x - edge_start.x) * (point.y - edge_start.y)
        - (edge_end.y - edge_start.y) * (point.x - edge_start.x);
    if orientation >= 0.0 {
        cross >= -f32::EPSILON
    } else {
        cross <= f32::EPSILON
    }
}

fn line_intersection(start: Point, end: Point, clip_start: Point, clip_end: Point) -> Point {
    let subject_x = end.x - start.x;
    let subject_y = end.y - start.y;
    let clip_x = clip_end.x - clip_start.x;
    let clip_y = clip_end.y - clip_start.y;
    let denominator = subject_x * clip_y - subject_y * clip_x;
    if denominator.abs() <= f32::EPSILON {
        return end;
    }
    let t = ((clip_start.x - start.x) * clip_y - (clip_start.y - start.y) * clip_x) / denominator;
    Point {
        x: start.x + t * subject_x,
        y: start.y + t * subject_y,
    }
}

fn polygon_area_vec(points: &[Point]) -> f64 {
    if points.len() < 3 {
        return 0.0;
    }
    (0..points.len())
        .map(|index| {
            let current = points[index];
            let next = points[(index + 1) % points.len()];
            f64::from(current.x * next.y - next.x * current.y)
        })
        .sum::<f64>()
        .abs()
        * 0.5
}

fn ensure_models() -> Result<PathBuf, String> {
    let root = default_model_root();
    fs::create_dir_all(&root)
        .map_err(|error| format!("OCR 모델 폴더를 만들지 못했습니다: {error}"))?;
    for asset in MODEL_ASSETS {
        ensure_asset(&root, asset)?;
    }
    Ok(root)
}

fn ensure_medium_models() -> Result<PathBuf, String> {
    let root = default_model_root();
    fs::create_dir_all(&root)
        .map_err(|error| format!("OCR 모델 폴더를 만들지 못했습니다: {error}"))?;
    for asset in MEDIUM_MODEL_ASSETS {
        ensure_asset(&root, asset)?;
    }
    Ok(root)
}

fn ensure_asset(root: &Path, asset: ModelAsset) -> Result<(), String> {
    let destination = root.join(asset.filename);
    if asset_is_verified(&destination, asset)? {
        return Ok(());
    }
    if destination.exists() {
        fs::remove_file(&destination)
            .map_err(|error| format!("손상된 OCR 모델을 삭제하지 못했습니다: {error}"))?;
    }
    let partial = partial_path(&destination);
    let mut downloaded = partial
        .metadata()
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if downloaded > asset.expected_bytes {
        fs::remove_file(&partial)
            .map_err(|error| format!("잘못된 OCR 임시 파일을 삭제하지 못했습니다: {error}"))?;
        downloaded = 0;
    }
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(None)
        .build()
        .map_err(|error| format!("OCR 모델 다운로드 클라이언트를 만들지 못했습니다: {error}"))?;
    let url = format!(
        "{MODEL_BASE_URL}/{MODEL_REVISION}/models/{}",
        asset.filename
    );
    let mut request = client.get(url);
    if downloaded > 0 {
        request = request.header(RANGE, format!("bytes={downloaded}-"));
    }
    let mut response = request
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|error| format!("{} 다운로드에 실패했습니다: {error}", asset.filename))?;
    let append = downloaded > 0 && response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
    if !append {
        downloaded = 0;
    }
    let mut output = OpenOptions::new()
        .create(true)
        .write(true)
        .append(append)
        .truncate(!append)
        .open(&partial)
        .map_err(|error| format!("OCR 임시 파일을 열지 못했습니다: {error}"))?;
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let count = response
            .read(&mut buffer)
            .map_err(|error| format!("OCR 모델을 내려받지 못했습니다: {error}"))?;
        if count == 0 {
            break;
        }
        let next_size = downloaded.saturating_add(count as u64);
        if next_size > asset.expected_bytes {
            drop(output);
            let _ = fs::remove_file(&partial);
            return Err(format!(
                "{} 다운로드가 허용 크기({} bytes)를 초과해 중단했습니다.",
                asset.filename, asset.expected_bytes
            ));
        }
        output
            .write_all(&buffer[..count])
            .map_err(|error| format!("OCR 모델을 저장하지 못했습니다: {error}"))?;
        downloaded = next_size;
    }
    output
        .flush()
        .map_err(|error| format!("OCR 모델 파일을 마무리하지 못했습니다: {error}"))?;
    if downloaded != asset.expected_bytes {
        return Err(format!(
            "{} 다운로드 크기가 일치하지 않습니다({downloaded}/{} bytes).",
            asset.filename, asset.expected_bytes
        ));
    }
    let digest = file_sha256(&partial)?;
    if digest != asset.expected_sha256.to_ascii_lowercase() {
        let _ = fs::remove_file(&partial);
        return Err(format!(
            "{} 무결성 검증에 실패해 손상된 파일을 삭제했습니다.",
            asset.filename
        ));
    }
    fs::rename(&partial, &destination)
        .map_err(|error| format!("OCR 모델 파일을 적용하지 못했습니다: {error}"))?;
    fs::write(hash_marker(&destination), digest)
        .map_err(|error| format!("OCR 모델 검증 표식을 저장하지 못했습니다: {error}"))
}

fn asset_is_verified(path: &Path, asset: ModelAsset) -> Result<bool, String> {
    if path.metadata().map(|metadata| metadata.len()).ok() != Some(asset.expected_bytes) {
        return Ok(false);
    }
    if fs::read_to_string(hash_marker(path))
        .ok()
        .is_some_and(|value| value.trim().eq_ignore_ascii_case(asset.expected_sha256))
    {
        return Ok(true);
    }
    let digest = file_sha256(path)?;
    if !digest.eq_ignore_ascii_case(asset.expected_sha256) {
        return Ok(false);
    }
    fs::write(hash_marker(path), &digest)
        .map_err(|error| format!("OCR 모델 검증 표식을 저장하지 못했습니다: {error}"))?;
    Ok(true)
}

fn file_sha256(path: &Path) -> Result<String, String> {
    let mut file =
        File::open(path).map_err(|error| format!("OCR 모델을 검증하지 못했습니다: {error}"))?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("OCR 모델을 검증하지 못했습니다: {error}"))?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn partial_path(path: &Path) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(".part");
    PathBuf::from(value)
}

fn hash_marker(path: &Path) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(".sha256");
    PathBuf::from(value)
}

fn default_model_root() -> PathBuf {
    if let Some(override_path) = env::var_os("NUDE_TRANSLATOR_OCR_MODEL_DIR") {
        return PathBuf::from(override_path);
    }
    #[cfg(windows)]
    if let Some(local) = env::var_os("LOCALAPPDATA") {
        return PathBuf::from(local)
            .join("LocalTools")
            .join("DiscordTranslateOverlay")
            .join("Cache")
            .join("ocr-rust");
    }
    #[cfg(target_os = "macos")]
    if let Some(home) = env::var_os("HOME") {
        return PathBuf::from(home)
            .join("Library")
            .join("Caches")
            .join("DiscordTranslateOverlay")
            .join("ocr-rust");
    }
    env::temp_dir().join("DiscordTranslateOverlay/ocr-rust")
}

#[cfg(test)]
mod tests {
    use super::{
        is_vertical_region, medium_retry_plan, merge_text_lines, polygon_overlap_ratio,
        recognition_crop, DetectedRegion, Language, MediumRetryPlan, OcrQualityMode, Point, Rect,
        TextLine, MEDIUM_MODEL_ASSETS, MODEL_ASSETS, MODEL_REVISION,
    };
    use std::collections::BTreeMap;
    use std::fmt::Write as _;

    fn line(left: f32, top: f32, right: f32, bottom: f32, text: &str) -> TextLine {
        TextLine {
            polygon: [
                Point { x: left, y: top },
                Point { x: right, y: top },
                Point {
                    x: right,
                    y: bottom,
                },
                Point { x: left, y: bottom },
            ],
            bbox: Rect {
                left: left as i32,
                top: top as i32,
                right: right as i32,
                bottom: bottom as i32,
            },
            text: text.to_string(),
            confidence: 0.9,
            language: Language::Japanese,
            candidates: Vec::new(),
        }
    }

    #[test]
    fn model_manifest_is_pinned_and_complete() {
        assert_eq!(MODEL_REVISION.len(), 40);
        assert_eq!(MODEL_ASSETS.len(), 5);
        for asset in MODEL_ASSETS {
            assert!(asset.expected_bytes > 1_000);
            assert_eq!(asset.expected_sha256.len(), 64);
            assert!(asset
                .expected_sha256
                .chars()
                .all(|value| value.is_ascii_hexdigit()));
        }
        assert_eq!(MEDIUM_MODEL_ASSETS.len(), 3);
        assert_eq!(
            MEDIUM_MODEL_ASSETS
                .iter()
                .map(|asset| asset.expected_bytes)
                .sum::<u64>(),
            69_535_771
        );
    }

    #[test]
    fn ocr_quality_mode_uses_a_safe_adaptive_default() {
        assert_eq!(OcrQualityMode::from_config("fast"), OcrQualityMode::Fast);
        assert_eq!(
            OcrQualityMode::from_config("quality"),
            OcrQualityMode::Quality
        );
        assert_eq!(
            OcrQualityMode::from_config("unexpected"),
            OcrQualityMode::Adaptive
        );
    }

    #[test]
    fn adaptive_ocr_retries_only_uncertain_regions() {
        let mut certain = line(0.0, 0.0, 100.0, 30.0, "Readable title");
        certain.confidence = 0.93;
        let mut uncertain = line(0.0, 40.0, 100.0, 70.0, "I0Ol");
        uncertain.confidence = 0.61;

        assert_eq!(
            medium_retry_plan(OcrQualityMode::Adaptive, &[certain, uncertain]),
            MediumRetryPlan::Regions(vec![1])
        );
    }

    #[test]
    fn quality_mode_uses_medium_detection_and_fast_mode_never_does() {
        assert_eq!(
            medium_retry_plan(OcrQualityMode::Quality, &[]),
            MediumRetryPlan::FullImage
        );
        assert_eq!(
            medium_retry_plan(OcrQualityMode::Adaptive, &[]),
            MediumRetryPlan::FullImage
        );
        assert_eq!(
            medium_retry_plan(OcrQualityMode::Fast, &[]),
            MediumRetryPlan::Skip
        );
    }

    #[test]
    fn vertical_japanese_regions_are_rotated_counter_clockwise_for_recognition() {
        let mut pixels = image::RgbaImage::new(2, 5);
        pixels.put_pixel(0, 0, image::Rgba([255, 0, 0, 255]));
        let region = DetectedRegion {
            crop: image::DynamicImage::ImageRgba8(pixels),
            polygon: [Point { x: 0.0, y: 0.0 }; 4],
            bbox: Rect {
                left: 0,
                top: 0,
                right: 20,
                bottom: 120,
            },
            confidence: 0.9,
        };

        assert!(is_vertical_region(&region));
        let rotated = recognition_crop(&region).to_rgba8();
        assert_eq!(rotated.dimensions(), (5, 2));
        assert_eq!(rotated.get_pixel(0, 1), &image::Rgba([255, 0, 0, 255]));
    }

    #[test]
    fn convex_overlap_matches_contained_rectangles() {
        let smaller = line(10.0, 10.0, 30.0, 30.0, "작은 영역");
        let larger = line(0.0, 0.0, 40.0, 40.0, "큰 영역");
        assert!((polygon_overlap_ratio(&smaller, &larger) - 1.0).abs() < 0.001);
    }

    #[test]
    fn enhanced_duplicates_are_removed() {
        let primary = line(0.0, 0.0, 100.0, 30.0, "こんにちは");
        let duplicate = line(1.0, 1.0, 99.0, 29.0, "こんにちは");
        let extra = line(0.0, 50.0, 100.0, 80.0, "안녕하세요");
        let merged = merge_text_lines(vec![primary], vec![duplicate, extra]);
        assert_eq!(merged.len(), 2);
    }

    #[test]
    #[ignore = "downloads pinned OCR models and audits their recognition character sets"]
    fn ocr_language_coverage_report() {
        let root = super::ensure_models().expect("download or verify OCR models");
        let charset = std::fs::read_to_string(root.join(super::V6_CHARSET.filename)).unwrap()
            + &std::fs::read_to_string(root.join(super::KO_CHARSET.filename)).unwrap();
        let fixture = include_str!("../../tests/fixtures/multilingual-detection.tsv");
        let mut coverage = BTreeMap::new();
        for line in fixture
            .lines()
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
        {
            let mut columns = line.splitn(3, '\t');
            let code = columns.next().unwrap();
            let scenario = columns.next().unwrap();
            let text = columns.next().unwrap();
            if scenario != "normal" || coverage.contains_key(code) {
                continue;
            }
            let mut letters = text
                .chars()
                .filter(|character| character.is_alphabetic())
                .collect::<Vec<_>>();
            letters.sort_unstable();
            letters.dedup();
            let present = letters
                .iter()
                .filter(|character| {
                    charset.contains(**character)
                        || character
                            .to_lowercase()
                            .any(|variant| charset.contains(variant))
                        || character
                            .to_uppercase()
                            .any(|variant| charset.contains(variant))
                })
                .count();
            coverage.insert(code.to_string(), (present, letters.len()));
        }
        assert_eq!(coverage.len(), 28);

        let mut report = String::from(
            "# OCR language coverage audit\n\n\
             The shared PP-OCRv6 detector can find text regions independently of language. Recognition is limited by the bundled PP-OCRv6-small and Korean PP-OCRv5 character sets. Coverage below is character-set coverage of the pinned chat sample; it is not an end-to-end accuracy claim.\n\n\
             | Language | Sample charset | Recognition status |\n\
             |---|---:|---|\n",
        );
        for (code, (present, total)) in &coverage {
            let ratio = if *total == 0 {
                0.0
            } else {
                *present as f64 / *total as f64
            };
            let status = if ratio >= 0.95 {
                "candidate (charset covered; image accuracy still experimental)"
            } else if ratio < 0.20 {
                "not supported by current recognizers"
            } else {
                "partial; not advertised"
            };
            let _ = writeln!(
                report,
                "| `{code}` | {present}/{total} ({:.0}%) | {status} |",
                ratio * 100.0,
            );
        }
        for unsupported in ["ar", "hi", "ru", "uk"] {
            let (present, total) = coverage[unsupported];
            assert!(
                present * 5 < total,
                "{unsupported} unexpectedly looks covered"
            );
        }
        for covered in ["ko", "en", "ja", "zh", "zh-Hant"] {
            let (present, total) = coverage[covered];
            assert!(
                present * 100 >= total * 95,
                "{covered} charset coverage regressed"
            );
        }
        if let Ok(path) = std::env::var("NUDE_TRANSLATOR_OCR_REPORT") {
            let path = std::path::PathBuf::from(path);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(&path, &report).unwrap();
            println!("{}", path.display());
        }
    }

    #[test]
    #[ignore = "downloads and loads the pinned native OCR models"]
    fn live_native_ocr_models_load_and_run_without_python() {
        let mut engine = super::PaddleDualOcr::new(true).unwrap();
        let image = image::open("../assets/nude-translator.png").unwrap();
        engine.recognize(&image).unwrap();
    }

    #[test]
    #[ignore = "downloads and loads the pinned PP-OCRv6 Medium MNN models"]
    fn live_medium_ocr_models_load_and_run_without_python() {
        let mut engine = super::PaddleDualOcr::new(true).unwrap();
        let image = image::open("../assets/nude-translator.png").unwrap();
        engine
            .recognize_with_quality(&image, super::OcrQualityMode::Quality)
            .unwrap();
    }
}
