/// Locate the proxies sequence in a parsed Clash YAML document, supporting
/// both the modern `proxies` key and the legacy `Proxy` key.
pub fn extract_proxy_entries(yaml: &yaml_serde::Value) -> Option<&Vec<yaml_serde::Value>> {
    match yaml.get("proxies") {
        Some(yaml_serde::Value::Sequence(seq)) => Some(seq),
        _ => match yaml.get("Proxy") {
            Some(yaml_serde::Value::Sequence(seq)) => Some(seq),
            _ => None,
        },
    }
}
