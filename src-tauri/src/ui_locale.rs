use std::collections::{BTreeMap, HashMap};
use std::sync::OnceLock;

type LocaleDictionary = HashMap<String, HashMap<String, String>>;

fn generated_locale_dictionary() -> &'static LocaleDictionary {
    static DICTIONARY: OnceLock<LocaleDictionary> = OnceLock::new();
    DICTIONARY.get_or_init(|| {
        serde_json::from_str(include_str!("../../web/ui-locales.json"))
            .expect("generated interface locale dictionary must be valid JSON")
    })
}

pub fn generated_copies(entries: &[(&str, &str)]) -> BTreeMap<String, BTreeMap<String, String>> {
    generated_locale_dictionary()
        .iter()
        .map(|(locale, dictionary)| {
            let copies = entries
                .iter()
                .filter_map(|(key, korean)| {
                    dictionary
                        .get(*korean)
                        .map(|translated| ((*key).to_string(), translated.clone()))
                })
                .collect();
            (locale.clone(), copies)
        })
        .collect()
}
