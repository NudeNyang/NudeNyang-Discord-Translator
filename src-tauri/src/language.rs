use std::collections::{HashMap, VecDeque};
use std::sync::LazyLock;

use lingua::{
    Language as LinguaLanguage, LanguageDetector as LinguaDetector, LanguageDetectorBuilder,
};
use serde::{Deserialize, Serialize};

const SIMPLIFIED_HINTS: &str = "这们为时发后说对过从还实见长门问间书车马风云龙习体国会开东叶万与专业乐乡买乱争于亚产亩亲亿仅仓仪价众优伙伞伟传伤伦伪余侠侣侧侨侦俩俭债倾偿儿兑党兰关兴养兽冈册军农冲决况冻净凉减凤凭凯击划刘则刚创删别刹剂剑剧劝务动劳势华协单卖卢卫却厅历厉压厌县参双变叙叠号叹吓吕吗吨听启吴呐呕员呛呜咏咙咸响哑哗团园围图圆圣场坏块坚坛坝坞坟坠垄垒垦垫尘墙壮声壳处备复够头夸夹夺奋奖妇妈妆姗娱娄婴孙学宁宝审宪宫宽宾寝寻导寿将尔尧尽层届属岁岂岗岛岭岳峡币帅师帐帘帜带帮庄庆床庐库应庙庞废广归当录径忆怀态怜总恋恳恶恼悦悬惊惧惨惩惯愤愿戏户扑执扩扫扬扰抚抛抢护报担拟拢拣拥拦拧拨择挂挡挤挥损捡换据掳掸掺揽搁搂搅摄摆摇摊撑撵敌敛数斋斗断无旧昼显晋晒晓晕暂术朴机杀杂权条来杨杰极构枪柜树样桥梦检楼欢欧欲歼残殴毁毕毙气汇汉汤沟没沣沦沧沪泪泼泽洁洒浅浆浇测济浑浓涛涝涡润涨涩渊渐渔渗温湾湿溃溅滚满滞滤滥滦滨滩潍潜澜濒灭灯灵灾灿炉炖点炼烁烂烧烫热爱爷牵牺犹狈狞独狭狮狱猎猪猫献环现玺电画畅畴疗疟疡疮疯痒痪瘫瘾皱盖盘眯着睁睐睑瞒矿码砖砚砺砾础硕确碍礼祷祸禀离种积称秽稳穷窍窑窜窝窥竞笃笋笔笺笼签简箩箫篮篱类粮紧纠红纤约级纪纬纯纱纲纳纵纷纸纹纺纽线练组细织终绊绍经绑绒结绕绘给络绝绞统绣继绩绪续绳维绵绸综绿缀缅缆缉缎缓缔缕编缘缚缝缠缩缴网罗罚罢羡翘耸联聪肃肠肤肿胀胆胜胶脉脏脑脓脚脱脸腊腻腾舆舰舱艺节芜芦苇苍苏苹范茧荐荆荡荣荤荧药莱莲获莹萝营萧萨葱蒋蓝蓟蔷蔼蕴薮虑虚虫虽虾蚀蚁蚂蚊蚕蛊蛎蛮蜕蜗蝇蝉补衬衫袄袜袭装裤见观规觅视览觉触誉计订认讥讨让训议讯记讲讳讶许论讼设访证评诅识诈诉诊词译试诗诚话诞诡询该详诫语误诱诲说请诸诺读课谁调谈谊谋谍谎谏谜谢谨谱谴谷贝贞负贡财责贤败账货质贩贪贫贬购贮贯贰贱贴贵贷贸费贺贼贾赁赂赃资赊赋赌赎赏赐赔赖赚赛赞赠赢赵赶趋跃践踪踊车轨轩转轮软轰轴轻载较辅辆辈辉辐辑输辖辙辞辩边辽达迁过迈运还进远违连迟迩迭迹适选递逻遗邮邻郑郸酝酱酿释里鉴针钉钓钙钝钟钢钥钦钧钩钱钳钻铁铃铅铎铜铝铲银铸铺链销锁锅锈锋锐错锚锡锣锦锨锭键锯锻镀镇镊镐镜镣镰长闪闭闯闰闲闷闸闹闻闽阀阁阔队阳阴阵阶际陆陈陕陨险随隐隶难雏雾霁霉静韦韩页顶项顺须顾顿颁颂预领颇颈频颓颖颗题颜额颠风飞饥饭饮饰饱饲饴饼饿馅馆馈馋马驭驯驰驱驳驴驶驹驻驾骂骄骆验骏骑骗骚骡骤鱼鲁鲜鲤鲸鸟鸡鸣鸭鸿鹅鹤鹰麦黄齐齿龄龟";
const TRADITIONAL_HINTS: &str = "這們為時發後說對過從還實見長門問間書車馬風雲龍習體國會開東葉萬與專業樂鄉買亂爭於亞產畝親億僅倉儀價眾優夥傘偉傳傷倫偽餘俠侶側僑偵倆儉債傾償兒兌黨蘭關興養獸岡冊軍農衝決況凍淨涼減鳳憑凱擊劃劉則剛創刪別剎劑劍劇勸務動勞勢華協單賣盧衛卻廳歷厲壓厭縣參雙變敘疊號嘆嚇呂嗎噸聽啟吳吶嘔員嗆嗚詠嚨鹹響啞嘩團園圍圖圓聖場壞塊堅壇壩塢墳墜壟壘墾墊塵牆壯聲殼處備復夠頭誇夾奪奮獎婦媽妝姍娛婁嬰孫學寧寶審憲宮寬賓寢尋導壽將爾堯盡層屆屬歲豈崗島嶺嶽峽幣帥師帳簾幟帶幫莊慶床廬庫應廟龐廢廣歸當錄徑憶懷態憐總戀懇惡惱悅懸驚懼慘懲慣憤願戲戶撲執擴掃揚擾撫拋搶護報擔擬攏揀擁攔擰撥擇掛擋擠揮損撿換據擄撣摻攬擱摟攪攝擺搖攤撐攆敵斂數齋鬥斷無舊晝顯晉曬曉暈暫術樸機殺雜權條來楊傑極構槍櫃樹樣橋夢檢樓歡歐慾殲殘毆毀畢斃氣匯漢湯溝沒灃淪滄滬淚潑澤潔灑淺漿澆測濟渾濃濤澇渦潤漲澀淵漸漁滲溫灣濕潰濺滾滿滯濾濫灤濱灘濰潛瀾瀕滅燈靈災燦爐燉點煉爍爛燒燙熱愛爺牽犧猶狽獰獨狹獅獄獵豬貓獻環現璽電畫暢疇療瘧瘍瘡瘋癢瘓癱癮皺蓋盤瞇著睜睞瞼瞞礦碼磚硯礪礫礎碩確礙禮禱禍稟離種積稱穢穩窮竅窯竄窩窺競篤筍筆箋籠簽簡籮簫籃籬類糧緊糾紅纖約級紀緯純紗綱納縱紛紙紋紡紐線練組細織終絆紹經綁絨結繞繪給絡絕絞統繡繼績緒續繩維綿綢綜綠綴緬纜緝緞緩締縷編緣縛縫纏縮繳網羅罰罷羨翹聳聯聰肅腸膚腫脹膽勝膠脈臟腦膿腳脫臉臘膩騰輿艦艙藝節蕪蘆葦蒼蘇蘋範繭薦荊蕩榮葷熒藥萊蓮獲瑩蘿營蕭薩蔥蔣藍薊薔藹蘊藪慮虛蟲雖蝦蝕蟻螞蚊蠶蠱蠣蠻蛻蝸蠅蟬補襯衫襖襪襲裝褲見觀規覓視覽覺觸譽計訂認譏討讓訓議訊記講諱訝許論訟設訪證評詛識詐訴診詞譯試詩誠話誕詭詢該詳誡語誤誘誨說請諸諾讀課誰調談誼謀諜謊諫謎謝謹譜譴穀貝貞負貢財責賢敗賬貨質販貪貧貶購貯貫貳賤貼貴貸貿費賀賊賈賃賂贓資賒賦賭贖賞賜賠賴賺賽贊贈贏趙趕趨躍踐蹤踴車軌軒轉輪軟轟軸輕載較輔輛輩輝輻輯輸轄轍辭辯邊遼達遷過邁運還進遠違連遲邇迭跡適選遞邏輯遺郵鄰鄭鄲醞醬釀釋裡鑒針釘釣鈣鈍鐘鋼鑰欽鈞鉤錢鉗鑽鐵鈴鉛鐸銅鋁鏟銀鑄鋪鏈銷鎖鍋鏽鋒銳錯錨錫鑼錦鍁錠鍵鋸鍛鍍鎮鑷鎬鏡鐐鐮長閃閉闖閏閒悶閘鬧聞閩閥閣闊隊陽陰陣階際陸陳陝隕險隨隱隸難雛霧霽黴靜韋韓頁頂項順須顧頓頒頌預領頗頸頻頹穎顆題顏額顛風飛飢飯飲飾飽飼飴餅餓餡館饋饞馬馭馴馳驅駁驢駛駒駐駕罵驕駱驗駿騎騙騷騾驟魚魯鮮鯉鯨鳥雞鳴鴨鴻鵝鶴鷹麥黃齊齒齡龜麼嗎裡";

const MIN_STATISTICAL_LETTERS: usize = 8;
// With nineteen deliberately constrained candidates, Lingua distributes probability mass
// across more languages than its four-language documentation example. The margin is therefore
// the primary guard; the absolute floor only rejects flat, low-information classifications.
const MIN_CONFIDENCE: f64 = 0.35;
const MIN_MARGIN: f64 = 0.17;
const CLOSE_FAMILY_MIN_CONFIDENCE: f64 = 0.50;
const CLOSE_FAMILY_MIN_MARGIN: f64 = 0.03;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
pub enum Language {
    #[serde(rename = "ko")]
    Korean,
    #[serde(rename = "en")]
    English,
    #[serde(rename = "ja")]
    Japanese,
    #[serde(rename = "zh")]
    ChineseSimplified,
    #[serde(rename = "zh-Hant")]
    ChineseTraditional,
    #[serde(rename = "pt-BR")]
    BrazilianPortuguese,
    #[serde(rename = "es-419")]
    LatinAmericanSpanish,
    #[serde(rename = "de")]
    German,
    #[serde(rename = "fr")]
    French,
    #[serde(rename = "id")]
    Indonesian,
    #[serde(rename = "hi")]
    Hindi,
    #[serde(rename = "vi")]
    Vietnamese,
    #[serde(rename = "pl")]
    Polish,
    #[serde(rename = "ru")]
    Russian,
    #[serde(rename = "uk")]
    Ukrainian,
    #[serde(rename = "tr")]
    Turkish,
    #[serde(rename = "ar")]
    Arabic,
    #[serde(rename = "it")]
    Italian,
    #[serde(rename = "nl")]
    Dutch,
    #[serde(rename = "ms")]
    Malay,
    #[serde(rename = "th")]
    Thai,
    #[serde(rename = "fil")]
    Filipino,
    #[serde(rename = "bn")]
    Bengali,
    #[serde(rename = "ur")]
    Urdu,
    #[serde(rename = "ta")]
    Tamil,
    #[serde(rename = "fa")]
    Persian,
    #[serde(rename = "he")]
    Hebrew,
    #[serde(rename = "cs")]
    Czech,
    #[serde(rename = "und")]
    Unknown,
}

pub const SUPPORTED_LANGUAGES: [Language; 28] = [
    Language::Korean,
    Language::English,
    Language::Japanese,
    Language::ChineseSimplified,
    Language::ChineseTraditional,
    Language::BrazilianPortuguese,
    Language::LatinAmericanSpanish,
    Language::German,
    Language::French,
    Language::Indonesian,
    Language::Hindi,
    Language::Vietnamese,
    Language::Polish,
    Language::Russian,
    Language::Ukrainian,
    Language::Turkish,
    Language::Arabic,
    Language::Italian,
    Language::Dutch,
    Language::Malay,
    Language::Thai,
    Language::Filipino,
    Language::Bengali,
    Language::Urdu,
    Language::Tamil,
    Language::Persian,
    Language::Hebrew,
    Language::Czech,
];

// Keep detection candidates stable while presenting the product languages in a
// user-facing priority order based on Discord reach and language-market size.
pub const LANGUAGE_MENU_ORDER: [Language; 28] = [
    Language::Korean,
    Language::English,
    Language::Japanese,
    Language::ChineseSimplified,
    Language::ChineseTraditional,
    Language::BrazilianPortuguese,
    Language::Hindi,
    Language::LatinAmericanSpanish,
    Language::German,
    Language::Russian,
    Language::Indonesian,
    Language::French,
    Language::Turkish,
    Language::Arabic,
    Language::Vietnamese,
    Language::Italian,
    Language::Polish,
    Language::Ukrainian,
    Language::Malay,
    Language::Dutch,
    Language::Thai,
    Language::Filipino,
    Language::Bengali,
    Language::Urdu,
    Language::Tamil,
    Language::Persian,
    Language::Hebrew,
    Language::Czech,
];

pub fn is_supported_language_code(value: &str) -> bool {
    Language::try_from(value).is_ok_and(|language| language != Language::Unknown)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TranslationProvider {
    HyMt,
    TranslateGemma,
    SubscriptionCli,
    DeepL,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ProviderLanguageCodes {
    pub source: &'static str,
    pub target: &'static str,
}

pub fn provider_language_codes(
    provider: TranslationProvider,
    language: Language,
) -> Option<ProviderLanguageCodes> {
    if language == Language::Unknown {
        return None;
    }
    let canonical = language.code();
    Some(match provider {
        TranslationProvider::HyMt => ProviderLanguageCodes {
            source: if language == Language::Filipino {
                "tl"
            } else {
                canonical
            },
            target: if language == Language::Filipino {
                "tl"
            } else {
                canonical
            },
        },
        TranslationProvider::SubscriptionCli => ProviderLanguageCodes {
            source: canonical,
            target: canonical,
        },
        TranslationProvider::TranslateGemma => ProviderLanguageCodes {
            source: match language {
                Language::ChineseSimplified => "zh-CN",
                Language::ChineseTraditional => "zh-TW",
                _ => canonical,
            },
            target: match language {
                Language::ChineseSimplified => "zh-CN",
                Language::ChineseTraditional => "zh-TW",
                _ => canonical,
            },
        },
        TranslationProvider::DeepL => ProviderLanguageCodes {
            source: match language {
                Language::ChineseSimplified | Language::ChineseTraditional => "ZH",
                Language::BrazilianPortuguese => "PT",
                Language::LatinAmericanSpanish => "ES",
                _ => deepl_base_code(language),
            },
            target: match language {
                Language::ChineseSimplified => "ZH-HANS",
                Language::ChineseTraditional => "ZH-HANT",
                Language::BrazilianPortuguese => "PT-BR",
                Language::LatinAmericanSpanish => "ES-419",
                _ => deepl_base_code(language),
            },
        },
    })
}

fn deepl_base_code(language: Language) -> &'static str {
    match language {
        Language::Korean => "KO",
        Language::English => "EN",
        Language::Japanese => "JA",
        Language::German => "DE",
        Language::French => "FR",
        Language::Indonesian => "ID",
        Language::Hindi => "HI",
        Language::Vietnamese => "VI",
        Language::Polish => "PL",
        Language::Russian => "RU",
        Language::Ukrainian => "UK",
        Language::Turkish => "TR",
        Language::Arabic => "AR",
        Language::Italian => "IT",
        Language::Dutch => "NL",
        Language::Malay => "MS",
        Language::Thai => "TH",
        Language::Filipino => "TL",
        Language::Bengali => "BN",
        Language::Urdu => "UR",
        Language::Tamil => "TA",
        Language::Persian => "FA",
        Language::Hebrew => "HE",
        Language::Czech => "CS",
        Language::ChineseSimplified
        | Language::ChineseTraditional
        | Language::BrazilianPortuguese
        | Language::LatinAmericanSpanish
        | Language::Unknown => unreachable!("regional or unknown language must be handled first"),
    }
}

impl Language {
    pub fn code(self) -> &'static str {
        match self {
            Self::Korean => "ko",
            Self::English => "en",
            Self::Japanese => "ja",
            Self::ChineseSimplified => "zh",
            Self::ChineseTraditional => "zh-Hant",
            Self::BrazilianPortuguese => "pt-BR",
            Self::LatinAmericanSpanish => "es-419",
            Self::German => "de",
            Self::French => "fr",
            Self::Indonesian => "id",
            Self::Hindi => "hi",
            Self::Vietnamese => "vi",
            Self::Polish => "pl",
            Self::Russian => "ru",
            Self::Ukrainian => "uk",
            Self::Turkish => "tr",
            Self::Arabic => "ar",
            Self::Italian => "it",
            Self::Dutch => "nl",
            Self::Malay => "ms",
            Self::Thai => "th",
            Self::Filipino => "fil",
            Self::Bengali => "bn",
            Self::Urdu => "ur",
            Self::Tamil => "ta",
            Self::Persian => "fa",
            Self::Hebrew => "he",
            Self::Czech => "cs",
            Self::Unknown => "und",
        }
    }

    pub fn english_name(self) -> &'static str {
        match self {
            Self::Korean => "Korean",
            Self::English => "English",
            Self::Japanese => "Japanese",
            Self::ChineseSimplified => "Simplified Chinese",
            Self::ChineseTraditional => "Traditional Chinese",
            Self::BrazilianPortuguese => "Brazilian Portuguese",
            Self::LatinAmericanSpanish => "Latin American Spanish",
            Self::German => "German",
            Self::French => "French",
            Self::Indonesian => "Indonesian",
            Self::Hindi => "Hindi",
            Self::Vietnamese => "Vietnamese",
            Self::Polish => "Polish",
            Self::Russian => "Russian",
            Self::Ukrainian => "Ukrainian",
            Self::Turkish => "Turkish",
            Self::Arabic => "Arabic",
            Self::Italian => "Italian",
            Self::Dutch => "Dutch",
            Self::Malay => "Malay",
            Self::Thai => "Thai",
            Self::Filipino => "Filipino",
            Self::Bengali => "Bengali",
            Self::Urdu => "Urdu",
            Self::Tamil => "Tamil",
            Self::Persian => "Persian",
            Self::Hebrew => "Hebrew",
            Self::Czech => "Czech",
            Self::Unknown => "the source language",
        }
    }

    pub fn native_name(self) -> &'static str {
        match self {
            Self::Korean => "한국어",
            Self::English => "English",
            Self::Japanese => "日本語",
            Self::ChineseSimplified => "简体中文",
            Self::ChineseTraditional => "繁體中文",
            Self::BrazilianPortuguese => "Português (Brasil)",
            Self::LatinAmericanSpanish => "Español (Latinoamérica)",
            Self::German => "Deutsch",
            Self::French => "Français",
            Self::Indonesian => "Bahasa Indonesia",
            Self::Hindi => "हिन्दी",
            Self::Vietnamese => "Tiếng Việt",
            Self::Polish => "Polski",
            Self::Russian => "Русский",
            Self::Ukrainian => "Українська",
            Self::Turkish => "Türkçe",
            Self::Arabic => "العربية",
            Self::Italian => "Italiano",
            Self::Dutch => "Nederlands",
            Self::Malay => "Bahasa Melayu",
            Self::Thai => "ไทย",
            Self::Filipino => "Filipino",
            Self::Bengali => "বাংলা",
            Self::Urdu => "اردو",
            Self::Tamil => "தமிழ்",
            Self::Persian => "فارسی",
            Self::Hebrew => "עברית",
            Self::Czech => "Čeština",
            Self::Unknown => "자동 감지",
        }
    }
}

impl TryFrom<&str> for Language {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "ko" => Ok(Self::Korean),
            "en" => Ok(Self::English),
            "ja" => Ok(Self::Japanese),
            "zh" | "zh-Hans" => Ok(Self::ChineseSimplified),
            "zh-Hant" => Ok(Self::ChineseTraditional),
            "pt" | "pt-BR" => Ok(Self::BrazilianPortuguese),
            "es" | "es-419" => Ok(Self::LatinAmericanSpanish),
            "de" => Ok(Self::German),
            "fr" => Ok(Self::French),
            "id" => Ok(Self::Indonesian),
            "hi" => Ok(Self::Hindi),
            "vi" => Ok(Self::Vietnamese),
            "pl" => Ok(Self::Polish),
            "ru" => Ok(Self::Russian),
            "uk" => Ok(Self::Ukrainian),
            "tr" => Ok(Self::Turkish),
            "ar" => Ok(Self::Arabic),
            "it" => Ok(Self::Italian),
            "nl" => Ok(Self::Dutch),
            "ms" => Ok(Self::Malay),
            "th" => Ok(Self::Thai),
            "fil" | "tl" => Ok(Self::Filipino),
            "bn" => Ok(Self::Bengali),
            "ur" => Ok(Self::Urdu),
            "ta" => Ok(Self::Tamil),
            "fa" => Ok(Self::Persian),
            "he" | "iw" => Ok(Self::Hebrew),
            "cs" => Ok(Self::Czech),
            "und" => Ok(Self::Unknown),
            _ => Err(format!("지원하지 않는 언어 코드입니다: {value}")),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Detection {
    pub language: Language,
    pub candidate: Language,
    pub confidence: f64,
    pub margin: f64,
}

impl Detection {
    fn unknown() -> Self {
        Self {
            language: Language::Unknown,
            candidate: Language::Unknown,
            confidence: 0.0,
            margin: 0.0,
        }
    }

    fn certain(language: Language) -> Self {
        Self {
            language,
            candidate: language,
            confidence: 1.0,
            margin: 1.0,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RecognitionCandidate {
    pub engine: String,
    pub text: String,
    pub confidence: f64,
}

#[derive(Default)]
struct ScriptCounts {
    hangul: usize,
    kana: usize,
    han: usize,
    devanagari: usize,
    arabic: usize,
    latin: usize,
    cyrillic: usize,
    thai: usize,
    bengali: usize,
    tamil: usize,
    hebrew: usize,
    letters: usize,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) enum ScriptFamily {
    Hangul,
    EastAsian,
    Devanagari,
    Arabic,
    Latin,
    Cyrillic,
    Thai,
    Bengali,
    Tamil,
    Hebrew,
}

static STATISTICAL_DETECTOR: LazyLock<LinguaDetector> = LazyLock::new(|| {
    use LinguaLanguage::*;
    LanguageDetectorBuilder::from_languages(&[
        Arabic, Bengali, Chinese, Czech, Dutch, English, French, German, Hebrew, Hindi, Indonesian,
        Italian, Japanese, Korean, Malay, Persian, Polish, Portuguese, Russian, Spanish, Tagalog,
        Tamil, Thai, Turkish, Ukrainian, Urdu, Vietnamese,
    ])
    .build()
});

pub fn detect_language(text: &str) -> Detection {
    let prepared = prepare_for_detection(text);
    let prepared = prepared.trim();
    if prepared.is_empty() {
        return Detection::unknown();
    }
    let counts = script_counts(prepared);
    if counts.hangul >= 2 || (counts.hangul > 0 && counts.letters == counts.hangul) {
        return Detection::certain(Language::Korean);
    }
    if counts.kana >= 2 || (counts.kana > 0 && counts.han > 0) {
        return Detection::certain(Language::Japanese);
    }
    if counts.devanagari >= 2 {
        return Detection::certain(Language::Hindi);
    }
    if counts.thai >= 2 {
        return Detection::certain(Language::Thai);
    }
    if counts.bengali >= 2 {
        return Detection::certain(Language::Bengali);
    }
    if counts.tamil >= 2 {
        return Detection::certain(Language::Tamil);
    }
    if counts.hebrew >= 2 {
        return Detection::certain(Language::Hebrew);
    }

    let simplified = prepared
        .chars()
        .filter(|character| SIMPLIFIED_HINTS.contains(*character))
        .count();
    let traditional = prepared
        .chars()
        .filter(|character| TRADITIONAL_HINTS.contains(*character))
        .count();
    if counts.han >= 4 && simplified > 0 && simplified > traditional * 2 {
        return Detection::certain(Language::ChineseSimplified);
    }
    if counts.han >= 4 && traditional > 0 && traditional > simplified * 2 {
        return Detection::certain(Language::ChineseTraditional);
    }
    if counts.han > 0 && counts.latin + counts.cyrillic == 0 {
        return Detection::unknown();
    }

    if counts.latin == counts.letters && has_clear_english_signal(prepared) {
        return Detection::certain(Language::English);
    }

    if counts.letters < MIN_STATISTICAL_LETTERS {
        return Detection::unknown();
    }
    let confidence_values = STATISTICAL_DETECTOR.compute_language_confidence_values(prepared);
    let Some((best, confidence)) = confidence_values.first().copied() else {
        return Detection::unknown();
    };
    let second_language = confidence_values.get(1).map(|(language, _)| *language);
    let second = confidence_values.get(1).map_or(0.0, |(_, value)| *value);
    let margin = confidence - second;
    let Some(language) = from_lingua(best, simplified, traditional) else {
        return Detection::unknown();
    };
    let close_family_evidence = second_language.is_some_and(|second_language| {
        is_close_confusion_pair(best, second_language)
            && confidence >= CLOSE_FAMILY_MIN_CONFIDENCE
            && margin >= CLOSE_FAMILY_MIN_MARGIN
    });
    if confidence < MIN_CONFIDENCE || (margin < MIN_MARGIN && !close_family_evidence) {
        return Detection {
            language: Language::Unknown,
            candidate: language,
            confidence,
            margin,
        };
    }
    Detection {
        language,
        candidate: language,
        confidence,
        margin,
    }
}

fn is_close_confusion_pair(first: LinguaLanguage, second: LinguaLanguage) -> bool {
    use LinguaLanguage::{Indonesian, Malay, Russian, Ukrainian};
    matches!(
        (first, second),
        (Indonesian, Malay) | (Malay, Indonesian) | (Russian, Ukrainian) | (Ukrainian, Russian)
    )
}

pub fn detect_explicit_language(text: &str) -> Language {
    detect_language(text).language
}

fn from_lingua(
    language: LinguaLanguage,
    simplified: usize,
    traditional: usize,
) -> Option<Language> {
    use LinguaLanguage::*;
    Some(match language {
        Korean => Language::Korean,
        English => Language::English,
        Japanese => Language::Japanese,
        Chinese if simplified > traditional => Language::ChineseSimplified,
        Chinese if traditional > simplified => Language::ChineseTraditional,
        Chinese => return None,
        Portuguese => Language::BrazilianPortuguese,
        Spanish => Language::LatinAmericanSpanish,
        German => Language::German,
        French => Language::French,
        Indonesian => Language::Indonesian,
        Hindi => Language::Hindi,
        Vietnamese => Language::Vietnamese,
        Polish => Language::Polish,
        Russian => Language::Russian,
        Ukrainian => Language::Ukrainian,
        Turkish => Language::Turkish,
        Arabic => Language::Arabic,
        Bengali => Language::Bengali,
        Czech => Language::Czech,
        Hebrew => Language::Hebrew,
        Persian => Language::Persian,
        Tagalog => Language::Filipino,
        Tamil => Language::Tamil,
        Thai => Language::Thai,
        Urdu => Language::Urdu,
        Italian => Language::Italian,
        Dutch => Language::Dutch,
        Malay => Language::Malay,
    })
}

fn prepare_for_detection(text: &str) -> String {
    text.split_whitespace()
        .filter(|token| {
            let lower = token.to_ascii_lowercase();
            !lower.starts_with("http://")
                && !lower.starts_with("https://")
                && !lower.starts_with("www.")
                && !token.starts_with("<@")
                && !token.starts_with("<#")
                && !(token.starts_with("<:") || token.starts_with("<a:"))
                && !token.starts_with("```")
        })
        .map(|token| {
            token.trim_matches(|character: char| {
                character.is_ascii_punctuation() && !matches!(character, '\'' | '-')
            })
        })
        .filter(|token| !token.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn has_clear_english_signal(text: &str) -> bool {
    const STRONG: [&str; 19] = [
        "hello",
        "please",
        "welcome",
        "thanks",
        "thank",
        "sorry",
        "hey",
        "violation",
        "violations",
        "blocked",
        "permanent",
        "blocking",
        "forced",
        "termination",
        "power",
        "adjust",
        "volume",
        "listening",
        "tips",
    ];
    const COMMON: [&str; 36] = [
        "the", "this", "that", "these", "those", "from", "with", "without", "into", "for", "and",
        "but", "are", "is", "was", "were", "have", "has", "your", "you", "our", "other", "server",
        "servers", "it", "it's", "i'm", "we're", "they're", "did", "does", "why", "what", "how",
        "fine", "yeah",
    ];
    let words = text
        .split(|character: char| !character.is_ascii_alphabetic() && character != '\'')
        .filter(|word| !word.is_empty())
        .map(str::to_ascii_lowercase)
        .collect::<Vec<_>>();
    if words.iter().any(|word| STRONG.contains(&word.as_str())) {
        return true;
    }
    words
        .iter()
        .filter(|word| COMMON.contains(&word.as_str()))
        .take(2)
        .count()
        >= 2
}

pub struct LanguageDetector {
    context: VecDeque<Language>,
    context_size: usize,
}

impl Default for LanguageDetector {
    fn default() -> Self {
        Self::new(8)
    }
}

impl LanguageDetector {
    pub fn new(context_size: usize) -> Self {
        Self {
            context: VecDeque::with_capacity(context_size),
            context_size,
        }
    }

    pub fn detect(&mut self, text: &str, remember: bool) -> Language {
        let counts = script_counts(&prepare_for_detection(text));
        let mut result = detect_explicit_language(text);
        if result == Language::Unknown && counts.han > 0 && counts.kana == 0 {
            result = self.context_language().unwrap_or(Language::Unknown);
        }
        if remember {
            self.remember(result);
        }
        result
    }

    pub(crate) fn remember(&mut self, language: Language) {
        if language == Language::Unknown {
            return;
        }
        if self.context.len() == self.context_size {
            self.context.pop_front();
        }
        self.context.push_back(language);
    }

    pub(crate) fn recent_language_for(&self, text: &str) -> Option<Language> {
        let family = detection_script_family(text)?;
        let mut counts = HashMap::<Language, usize>::new();
        let mut relevant = 0_usize;
        for language in self.context.iter().copied() {
            if language_script_family(language) != Some(family) {
                continue;
            }
            relevant += 1;
            *counts.entry(language).or_default() += 1;
        }
        let (language, count) = counts.into_iter().max_by_key(|(_, count)| *count)?;
        (count >= 2 && count * 3 >= relevant * 2).then_some(language)
    }

    fn context_language(&self) -> Option<Language> {
        self.context.iter().rev().copied().find(|language| {
            matches!(
                language,
                Language::Japanese | Language::ChineseSimplified | Language::ChineseTraditional
            )
        })
    }
}

pub(crate) fn detection_script_family(text: &str) -> Option<ScriptFamily> {
    let counts = script_counts(&prepare_for_detection(text));
    if counts.letters == 0 {
        return None;
    }
    let families = [
        (ScriptFamily::Hangul, counts.hangul),
        (ScriptFamily::EastAsian, counts.kana + counts.han),
        (ScriptFamily::Devanagari, counts.devanagari),
        (ScriptFamily::Arabic, counts.arabic),
        (ScriptFamily::Latin, counts.latin),
        (ScriptFamily::Cyrillic, counts.cyrillic),
        (ScriptFamily::Thai, counts.thai),
        (ScriptFamily::Bengali, counts.bengali),
        (ScriptFamily::Tamil, counts.tamil),
        (ScriptFamily::Hebrew, counts.hebrew),
    ];
    let (family, count) = families.into_iter().max_by_key(|(_, count)| *count)?;
    (count > 0 && count * 2 >= counts.letters).then_some(family)
}

pub(crate) fn language_script_family(language: Language) -> Option<ScriptFamily> {
    Some(match language {
        Language::Korean => ScriptFamily::Hangul,
        Language::Japanese | Language::ChineseSimplified | Language::ChineseTraditional => {
            ScriptFamily::EastAsian
        }
        Language::Hindi => ScriptFamily::Devanagari,
        Language::Arabic | Language::Persian | Language::Urdu => ScriptFamily::Arabic,
        Language::Russian | Language::Ukrainian => ScriptFamily::Cyrillic,
        Language::Thai => ScriptFamily::Thai,
        Language::Bengali => ScriptFamily::Bengali,
        Language::Tamil => ScriptFamily::Tamil,
        Language::Hebrew => ScriptFamily::Hebrew,
        Language::English
        | Language::BrazilianPortuguese
        | Language::LatinAmericanSpanish
        | Language::German
        | Language::French
        | Language::Indonesian
        | Language::Vietnamese
        | Language::Polish
        | Language::Turkish
        | Language::Italian
        | Language::Dutch
        | Language::Malay
        | Language::Filipino
        | Language::Czech => ScriptFamily::Latin,
        Language::Unknown => return None,
    })
}

#[derive(Default)]
pub struct CandidateSelector {
    detector: LanguageDetector,
}

impl CandidateSelector {
    pub fn choose(
        &mut self,
        candidates: &[RecognitionCandidate],
    ) -> (RecognitionCandidate, Language) {
        let useful: Vec<_> = candidates
            .iter()
            .filter(|candidate| !candidate.text.trim().is_empty())
            .collect();
        if useful.is_empty() {
            return (
                RecognitionCandidate {
                    engine: "none".to_string(),
                    text: String::new(),
                    confidence: 0.0,
                },
                Language::Unknown,
            );
        }
        let mut best: Option<(f64, RecognitionCandidate)> = None;
        for candidate in &useful {
            let language = self.detector.detect(&candidate.text, false);
            let counts = script_counts(&candidate.text);
            let engine = candidate.engine.to_lowercase();
            let mut bonus = 0.0;
            if counts.hangul > 0 && engine.contains("korean") {
                bonus += 0.22;
            }
            if counts.kana > 0 && engine.contains("v6") {
                bonus += 0.16;
            }
            if language == Language::English {
                bonus += 0.04;
            }
            if is_complete_v6_candidate(candidate, &useful) {
                bonus += 0.14;
            }
            if candidate.text.contains('�')
                || candidate.text.matches('?').count() > candidate.text.chars().count() / 3
            {
                bonus -= 0.25;
            }
            let score = candidate.confidence + bonus;
            if best.as_ref().is_none_or(|(current, _)| score > *current) {
                best = Some((score, (*candidate).clone()));
            }
        }
        let selected = best.expect("useful candidates are not empty").1;
        let language = self.detector.detect(&selected.text, true);
        (selected, language)
    }
}

fn script_counts(text: &str) -> ScriptCounts {
    let mut counts = ScriptCounts::default();
    for character in text.chars() {
        let value = character as u32;
        if matches!(value, 0x1100..=0x11ff | 0x3130..=0x318f | 0xac00..=0xd7af) {
            counts.hangul += 1;
        }
        if matches!(value, 0x3040..=0x30ff | 0x31f0..=0x31ff) {
            counts.kana += 1;
        }
        if matches!(value, 0x3400..=0x4dbf | 0x4e00..=0x9fff | 0xf900..=0xfaff) {
            counts.han += 1;
        }
        if matches!(value, 0x0900..=0x097f) {
            counts.devanagari += 1;
        }
        if matches!(value, 0x0600..=0x06ff | 0x0750..=0x077f | 0x08a0..=0x08ff) {
            counts.arabic += 1;
        }
        if matches!(value, 0x0041..=0x024f | 0x1e00..=0x1eff) {
            counts.latin += 1;
        }
        if matches!(value, 0x0400..=0x052f) {
            counts.cyrillic += 1;
        }
        if matches!(value, 0x0e00..=0x0e7f) {
            counts.thai += 1;
        }
        if matches!(value, 0x0980..=0x09ff) {
            counts.bengali += 1;
        }
        if matches!(value, 0x0b80..=0x0bff) {
            counts.tamil += 1;
        }
        if matches!(value, 0x0590..=0x05ff) {
            counts.hebrew += 1;
        }
        if character.is_alphabetic() {
            counts.letters += 1;
        }
    }
    counts
}

fn is_complete_v6_candidate(
    candidate: &RecognitionCandidate,
    candidates: &[&RecognitionCandidate],
) -> bool {
    if !candidate.engine.to_lowercase().contains("v6") {
        return false;
    }
    let counts = script_counts(&candidate.text);
    if counts.han == 0 && counts.kana == 0 {
        return false;
    }
    let normalized: String = candidate
        .text
        .chars()
        .filter(|character| character.is_alphanumeric())
        .collect();
    if normalized.chars().count() < 4 {
        return false;
    }
    candidates.iter().any(|other| {
        if !other.engine.to_lowercase().contains("korean")
            || candidate.confidence < other.confidence - 0.06
        {
            return false;
        }
        let other_normalized: String = other
            .text
            .chars()
            .filter(|character| character.is_alphanumeric())
            .collect();
        !other_normalized.is_empty()
            && other_normalized.chars().count() * 10 <= normalized.chars().count() * 6
            && normalized
                .to_lowercase()
                .starts_with(&other_normalized.to_lowercase())
    })
}

#[cfg(test)]
mod tests {
    use super::{
        detect_explicit_language, detect_language, provider_language_codes, CandidateSelector,
        Language, LanguageDetector, ProviderLanguageCodes, RecognitionCandidate,
        TranslationProvider, LANGUAGE_MENU_ORDER, SUPPORTED_LANGUAGES,
    };
    use std::collections::BTreeMap;
    use std::fmt::Write as _;

    #[test]
    fn catalog_contains_all_twenty_eight_product_languages() {
        assert_eq!(SUPPORTED_LANGUAGES.len(), 28);
        for language in SUPPORTED_LANGUAGES {
            assert_eq!(Language::try_from(language.code()).unwrap(), language);
            assert!(!language.native_name().is_empty());
            assert!(!language.english_name().is_empty());
        }
        assert_eq!(
            Language::try_from("zh-Hans").unwrap(),
            Language::ChineseSimplified
        );
    }

    #[test]
    fn language_menu_keeps_core_languages_first_and_prioritizes_large_markets() {
        assert_eq!(
            LANGUAGE_MENU_ORDER.map(Language::code),
            [
                "ko", "en", "ja", "zh", "zh-Hant", "pt-BR", "hi", "es-419", "de", "ru", "id", "fr",
                "tr", "ar", "vi", "it", "pl", "uk", "ms", "nl", "th", "fil", "bn", "ur", "ta",
                "fa", "he", "cs",
            ]
        );
        let mut supported = SUPPORTED_LANGUAGES.map(Language::code);
        let mut menu = LANGUAGE_MENU_ORDER.map(Language::code);
        supported.sort_unstable();
        menu.sort_unstable();
        assert_eq!(menu, supported);
    }

    #[test]
    fn every_translation_provider_has_explicit_codes_for_all_product_languages() {
        for provider in [
            TranslationProvider::HyMt,
            TranslationProvider::TranslateGemma,
            TranslationProvider::SubscriptionCli,
            TranslationProvider::DeepL,
        ] {
            for language in SUPPORTED_LANGUAGES {
                let codes = provider_language_codes(provider, language)
                    .unwrap_or_else(|| panic!("{provider:?} missing {}", language.code()));
                assert!(!codes.source.is_empty());
                assert!(!codes.target.is_empty());
            }
        }
        assert_eq!(
            provider_language_codes(TranslationProvider::DeepL, Language::ChineseTraditional,),
            Some(ProviderLanguageCodes {
                source: "ZH",
                target: "ZH-HANT",
            })
        );
        assert_eq!(
            provider_language_codes(TranslationProvider::HyMt, Language::Filipino),
            Some(ProviderLanguageCodes {
                source: "tl",
                target: "tl",
            })
        );
        assert_eq!(
            provider_language_codes(TranslationProvider::SubscriptionCli, Language::Filipino),
            Some(ProviderLanguageCodes {
                source: "fil",
                target: "fil",
            })
        );
        assert_eq!(
            provider_language_codes(TranslationProvider::DeepL, Language::Filipino),
            Some(ProviderLanguageCodes {
                source: "TL",
                target: "TL",
            })
        );
    }

    #[test]
    fn detects_all_supported_language_families_conservatively() {
        let samples = [
            ("Hello from the Discord server", Language::English),
            ("こんにちは、元気ですか", Language::Japanese),
            ("안녕하세요, 반가워요", Language::Korean),
            ("这是一个中文消息", Language::ChineseSimplified),
            ("這是一個繁體中文訊息", Language::ChineseTraditional),
            (
                "Quer jogar comigo hoje à noite?",
                Language::BrazilianPortuguese,
            ),
            (
                "¿Quieres jugar conmigo esta noche?",
                Language::LatinAmericanSpanish,
            ),
            ("Willst du heute Abend mitspielen?", Language::German),
            ("Tu veux jouer avec nous ce soir ?", Language::French),
            ("Mau main bareng malam ini?", Language::Indonesian),
            ("आज रात साथ में खेलोगे?", Language::Hindi),
            ("Tối nay chơi cùng nhau không?", Language::Vietnamese),
            ("Chcesz dziś wieczorem zagrać razem?", Language::Polish),
            ("Хочешь сегодня вечером поиграть вместе?", Language::Russian),
            ("Хочеш сьогодні ввечері пограти разом?", Language::Ukrainian),
            ("Bu akşam birlikte oynamak ister misin?", Language::Turkish),
            ("هل تريد أن نلعب معًا الليلة؟", Language::Arabic),
            ("Vuoi giocare insieme stasera?", Language::Italian),
            ("Wil je vanavond samen spelen?", Language::Dutch),
            (
                "Awak mahu bermain bersama kami di pelayan malam ini?",
                Language::Malay,
            ),
            ("คืนนี้คุณอยากเล่นเกมกับพวกเราไหม", Language::Thai),
            (
                "Gusto mo bang maglaro kasama namin mamayang gabi?",
                Language::Filipino,
            ),
            ("তুমি কি আজ রাতে আমাদের সঙ্গে খেলতে চাও?", Language::Bengali),
            ("کیا آپ آج رات ہمارے ساتھ کھیلنا چاہتے ہیں؟", Language::Urdu),
            ("இன்றிரவு எங்களுடன் விளையாட விரும்புகிறீர்களா?", Language::Tamil),
            ("آیا می‌خواهید امشب با ما بازی کنید؟", Language::Persian),
            ("רוצה לשחק איתנו הערב בשרת?", Language::Hebrew),
            ("Chceš si s námi dnes večer zahrát?", Language::Czech),
        ];
        let mut failures = Vec::new();
        for (text, expected) in samples {
            let actual = detect_explicit_language(text);
            if actual != expected {
                failures.push((text, expected, actual));
            }
        }
        assert!(failures.is_empty(), "failures={failures:?}");
    }

    #[test]
    fn multilingual_detection_benchmark() {
        let fixture = include_str!("../../tests/fixtures/multilingual-detection.tsv");
        let mut by_language = BTreeMap::<String, (usize, usize, usize)>::new();
        let mut failures = Vec::new();
        for (line_number, line) in fixture.lines().enumerate() {
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let mut columns = line.splitn(3, '\t');
            let expected_code = columns.next().unwrap();
            let scenario = columns.next().expect("fixture scenario");
            let text = columns.next().expect("fixture text");
            let expected = Language::try_from(expected_code).expect("fixture language code");
            let detection = detect_language(text);
            let entry = by_language.entry(expected_code.to_string()).or_default();
            entry.0 += 1;
            if detection.language == expected {
                entry.1 += 1;
            } else {
                entry.2 += 1;
                failures.push(format!(
                    "line {} [{scenario}] expected={expected_code} actual={} candidate={} confidence={:.3} margin={:.3} text={text}",
                    line_number + 1,
                    detection.language.code(),
                    detection.candidate.code(),
                    detection.confidence,
                    detection.margin,
                ));
            }
        }

        let total: usize = by_language.values().map(|value| value.0).sum();
        let passed: usize = by_language.values().map(|value| value.1).sum();
        let mut report = format!(
            "# Multilingual language detection benchmark\n\n- Result: {passed}/{total} ({:.1}%)\n- Policy: uncertain short/noisy text must return `und`; a wrong confident language is not accepted.\n\n| Language | Passed | Total |\n|---|---:|---:|\n",
            passed as f64 * 100.0 / total as f64,
        );
        for (language, (count, correct, _)) in &by_language {
            let _ = writeln!(report, "| `{language}` | {correct} | {count} |");
        }
        if !failures.is_empty() {
            report.push_str("\n## Failures\n\n");
            for failure in &failures {
                let _ = writeln!(report, "- {failure}");
            }
        }
        if let Ok(path) = std::env::var("NUDE_TRANSLATOR_BENCHMARK_REPORT") {
            let path = std::path::PathBuf::from(path);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).expect("create benchmark report directory");
            }
            std::fs::write(&path, &report).expect("write benchmark report");
            println!("{}", path.display());
        }
        assert!(failures.is_empty(), "\n{report}");
    }

    #[test]
    fn ambiguous_short_chat_is_not_forced_into_a_language() {
        for text in [
            "Hello poster",
            "Hello Welcome to BugCat 3.0",
            "Please check other servers",
        ] {
            assert_eq!(detect_explicit_language(text), Language::English, "{text}");
        }
        for text in [
            "gg",
            "no",
            "si",
            "lol",
            "nice",
            "1234",
            "https://example.com",
        ] {
            assert_eq!(detect_explicit_language(text), Language::Unknown, "{text}");
        }
        assert_eq!(detect_language("nice").confidence, 0.0);
    }

    #[test]
    fn detects_short_english_instruction_labels_without_guessing_names() {
        for text in [
            "Power On",
            "Adjust Volume",
            "Listening Tips",
            "In this residence,",
            "we invite you to enjoy a special experience",
        ] {
            assert_eq!(detect_explicit_language(text), Language::English, "{text}");
        }
        assert_eq!(detect_explicit_language("Silver Moon"), Language::Unknown);
    }

    #[test]
    fn moderation_rule_fragments_keep_a_usable_source_language() {
        for text in [
            "Violation:",
            "day blocked",
            "Third violation",
            "Permanent blocking and forced termination",
        ] {
            assert_eq!(detect_explicit_language(text), Language::English, "{text}");
        }
        assert_eq!(
            detect_explicit_language("违反1次:1日切断"),
            Language::ChineseSimplified
        );
        assert_eq!(
            detect_explicit_language("การฝ่าฝืน 1 ครั้ง: บล็อก 1 วัน"),
            Language::Thai
        );

        let mut detector = LanguageDetector::default();
        detector.detect("ディスコード規則違反について", true);
        assert_eq!(
            detector.detect("1回 違反:1日 遮断", true),
            Language::Japanese
        );
    }

    #[test]
    fn han_only_text_uses_recent_context_but_not_a_forced_default() {
        let mut detector = LanguageDetector::default();
        assert_eq!(detector.detect("東京駅", true), Language::Unknown);
        detector.detect("这是中文消息", true);
        assert_eq!(detector.detect("北京站", true), Language::ChineseSimplified);
        detector.detect("これは日本語です", true);
        assert_eq!(detector.detect("東京駅", true), Language::Japanese);
    }

    #[test]
    fn selector_prefers_complete_script_specific_candidates() {
        let mut selector = CandidateSelector::default();
        let (best, language) = selector.choose(&[
            RecognitionCandidate {
                engine: "PP-OCRv6-small".to_string(),
                text: "OfL하세요".to_string(),
                confidence: 0.91,
            },
            RecognitionCandidate {
                engine: "korean_PP-OCRv5-mobile".to_string(),
                text: "안녕하세요".to_string(),
                confidence: 0.83,
            },
        ]);
        assert_eq!(best.text, "안녕하세요");
        assert_eq!(language, Language::Korean);

        let (best, _) = selector.choose(&[
            RecognitionCandidate {
                engine: "PP-OCRv6-small".to_string(),
                text: "4k動画設定".to_string(),
                confidence: 0.999,
            },
            RecognitionCandidate {
                engine: "korean_PP-OCRv5-mobile".to_string(),
                text: "4k".to_string(),
                confidence: 0.994,
            },
        ]);
        assert_eq!(best.text, "4k動画設定");
    }
}
