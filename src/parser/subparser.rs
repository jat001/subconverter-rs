use crate::models::Proxy;
use crate::parser::explodes::*;
use crate::parser::infoparser::{get_sub_info_from_nodes, get_sub_info_from_ssd};
use crate::parser::parse_settings::ParseSettings;
use crate::utils::http::get_sub_info_from_header;
use crate::utils::matcher::{apply_matcher, reg_find};
use crate::utils::network::is_link;
use crate::utils::url::url_decode;
use crate::utils::{file_exists, file_get_async, web_get_async};
use log::warn;

/// Equivalent to ConfType enum in C++
#[derive(Debug, PartialEq, Eq)]
pub enum ConfType {
    SOCKS,
    HTTP,
    SUB,
    Netch,
    Local,
    Unknown,
}

/// Transform of C++ addNodes function
/// Adds nodes from a link to the provided vector
///
/// # Arguments
/// * `link` - Link to parse for proxies
/// * `all_nodes` - Vector to add nodes to
/// * `group_id` - Group ID to assign to nodes
/// * `parse_settings` - Settings for parsing
///
/// # Returns
/// * `Ok(())` on success
/// * `Err(String)` with error message on failure
pub async fn add_nodes(
    mut link: String,
    all_nodes: &mut Vec<Proxy>,
    group_id: i32,
    parse_settings: &mut ParseSettings,
) -> Result<(), String> {
    // Extract references to settings for easier access
    let proxy = &parse_settings.proxy;
    let exclude_remarks = parse_settings.exclude_remarks.as_ref();
    let include_remarks = parse_settings.include_remarks.as_ref();
    let stream_rules = parse_settings.stream_rules.as_ref();
    let time_rules = parse_settings.time_rules.as_ref();
    let request_header = parse_settings.request_header.as_ref();
    let authorized = parse_settings.authorized;

    // Variables to store data during processing
    let mut nodes: Vec<Proxy> = Vec::new();
    let mut node = Proxy::default();
    let mut custom_group = String::new();

    // Clean up the link string - remove quotes
    link = link.replace("\"", "");

    // Handle JavaScript scripts (Not implementing JS support here)
    #[cfg(feature = "js-runtime")]
    if authorized && link.starts_with("script:") {
        // Script processing would go here
        return Err("Script processing not implemented".to_string());
    }

    // Handle tag: prefix for custom group
    if link.starts_with("tag:") {
        if let Some(pos) = link.find(',') {
            custom_group = link[4..pos].to_string();
            link = link[pos + 1..].to_string();
        }
    }

    // Handle null node
    if link == "nullnode" {
        let mut null_node = Proxy::default();
        null_node.group_id = 0;
        all_nodes.push(null_node);
        return Ok(());
    }

    // Determine link type
    let link_type = if link.starts_with("https://t.me/socks") || link.starts_with("tg://socks") {
        ConfType::SOCKS
    } else if link.starts_with("https://t.me/http") || link.starts_with("tg://http") {
        ConfType::HTTP
    } else if is_link(&link) || link.starts_with("surge:///install-config") {
        ConfType::SUB
    } else if link.starts_with("Netch://") {
        ConfType::Netch
    } else if file_exists(&link).await {
        ConfType::Local
    } else {
        // Default to Unknown for direct proxy links or invalid links
        ConfType::Unknown
    };

    match link_type {
        ConfType::SUB => {
            // Handle subscription links
            if link.starts_with("surge:///install-config") {
                // Extract URL from Surge config link
                if let Some(url_arg) = get_url_arg(&link, "url") {
                    link = url_decode(&url_arg);
                }
            }

            // Download subscription content
            let response = match web_get_async(&link, proxy, request_header).await {
                Ok(response) => response,
                Err(e) => {
                    warn!("Failed to get subscription content from {}: {}", link, e);
                    return Err(format!("HTTP request failed: {}", e));
                }
            };

            // An error page is not a subscription; report the status instead of failing to parse it
            if !(200..300).contains(&response.status) {
                warn!(
                    "Subscription {} answered with HTTP {}",
                    link, response.status
                );
                return Err(format!(
                    "the subscription server answered with HTTP {}{}",
                    response.status,
                    describe_body(&response.body)
                        .map(|body| format!(": {}", body))
                        .unwrap_or_default()
                ));
            }

            // Neither is a login or error page served with 200, and parsing one can turn stray URLs
            // in the page into bogus nodes
            if is_html_document(&response.body) {
                warn!("Subscription {} returned an HTML page", link);
                return Err(format!(
                    "the subscription server returned {} instead of a subscription",
                    describe_body(&response.body).unwrap_or_default()
                ));
            }

            let sub_content = response.body;
            let headers = response.headers;

            if !sub_content.is_empty() {
                // Parse the subscription content
                let result = explode_conf_content(&sub_content, &mut nodes);
                if result > 0 {
                    // Get subscription info
                    if sub_content.starts_with("ssd://") {
                        // Extract info from SSD subscription
                        if let Some(info) = get_sub_info_from_ssd(&sub_content) {
                            parse_settings.sub_info = Some(info);
                        }
                    } else {
                        // Try to get info from header first
                        let header_info = get_sub_info_from_header(&headers);
                        if !header_info.is_empty() {
                            parse_settings.sub_info = Some(header_info);
                        } else {
                            // If no header info, try from nodes
                            if let (Some(stream_rules_unwrapped), Some(time_rules_unwrapped)) =
                                (stream_rules, time_rules)
                            {
                                if let Some(info) = get_sub_info_from_nodes(
                                    &nodes,
                                    stream_rules_unwrapped,
                                    time_rules_unwrapped,
                                ) {
                                    parse_settings.sub_info = Some(info);
                                }
                            }
                        }
                    }

                    // Filter nodes and set group info
                    filter_nodes(&mut nodes, exclude_remarks, include_remarks, group_id);

                    // Set group_id and custom_group for all nodes
                    for node in &mut nodes {
                        node.group_id = group_id;
                        if !custom_group.is_empty() {
                            node.group = custom_group.clone();
                        }
                    }

                    // Add nodes to result vector
                    all_nodes.append(&mut nodes);
                    Ok(())
                } else {
                    Err(format!(
                        "no supported nodes found in the subscription{}",
                        describe_body(&sub_content)
                            .map(|body| format!(", which starts with: {}", body))
                            .unwrap_or_default()
                    ))
                }
            } else {
                Err(format!(
                    "the subscription is empty (HTTP {})",
                    response.status
                ))
            }
        }
        ConfType::Local => {
            if !authorized {
                return Err("Not authorized to access local files".to_string());
            }

            // Read and parse local file
            let result = explode_conf(&link, &mut nodes).await;
            if result > 0 {
                // The rest is similar to SUB case
                // Get subscription info
                if link.starts_with("ssd://") {
                    // Extract info from SSD subscription
                    if let Some(info) = get_sub_info_from_ssd(&link) {
                        parse_settings.sub_info = Some(info);
                    }
                } else {
                    // Try to get info from nodes
                    if let (Some(stream_rules_unwrapped), Some(time_rules_unwrapped)) =
                        (stream_rules, time_rules)
                    {
                        if let Some(info) = get_sub_info_from_nodes(
                            &nodes,
                            stream_rules_unwrapped,
                            time_rules_unwrapped,
                        ) {
                            parse_settings.sub_info = Some(info);
                        }
                    }
                }

                filter_nodes(&mut nodes, exclude_remarks, include_remarks, group_id);

                // Set group_id and custom_group for all nodes
                for node in &mut nodes {
                    node.group_id = group_id;
                    if !custom_group.is_empty() {
                        node.group = custom_group.clone();
                    }
                }

                all_nodes.append(&mut nodes);
                Ok(())
            } else {
                Err("Invalid configuration file".to_string())
            }
        }
        _ => {
            // Handle direct link to a single proxy
            if explode(&link, &mut node) {
                if node.proxy_type == crate::models::ProxyType::Unknown {
                    return Err("No valid link found".to_string());
                }
                node.group_id = group_id;
                if !custom_group.is_empty() {
                    node.group = custom_group;
                }
                all_nodes.push(node);
                Ok(())
            } else {
                Err("No valid link found".to_string())
            }
        }
    }
}

/// Whether a response body is an HTML document (a login or error page) rather than a subscription
fn is_html_document(body: &str) -> bool {
    let start = body
        .trim_start()
        .chars()
        .take(14)
        .collect::<String>()
        .to_ascii_lowercase();
    start.starts_with("<!doctype html") || start.starts_with("<html")
}

/// `text` on one line, cut to at most 100 characters
fn excerpt(text: &str) -> String {
    const MAX_CHARS: usize = 100;
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut excerpt: String = collapsed.chars().take(MAX_CHARS).collect();
    if collapsed.chars().count() > MAX_CHARS {
        excerpt.push('…');
    }
    excerpt
}

/// Describes a response body for error messages without dumping all of it: an HTML page by its
/// title, anything else by how it starts. None for a blank body.
fn describe_body(body: &str) -> Option<String> {
    if is_html_document(body) {
        // ASCII lowercasing keeps byte offsets, so positions found in `lower` index `body` too
        let lower = body.to_ascii_lowercase();
        let title = lower
            .find("<title")
            .and_then(|open| {
                let start = open + lower[open..].find('>')? + 1;
                let end = start + lower[start..].find("</title")?;
                Some(excerpt(&body[start..end]))
            })
            .filter(|title| !title.is_empty());
        return Some(match title {
            Some(title) => format!("a web page titled \"{}\"", title),
            None => "a web page".to_string(),
        });
    }
    let start = excerpt(body);
    (!start.is_empty()).then_some(start)
}

/// Extracts a specific argument from a URL
fn get_url_arg(url: &str, arg_name: &str) -> Option<String> {
    if let Some(query_start) = url.find('?') {
        let query = &url[query_start + 1..];
        for pair in query.split('&') {
            let parts: Vec<&str> = pair.split('=').collect();
            if parts.len() == 2 && parts[0] == arg_name {
                return Some(parts[1].to_string());
            }
        }
    }
    None
}

/// Parses a configuration file into a vector of Proxy objects
/// Returns the number of proxies parsed
async fn explode_conf(path: &str, nodes: &mut Vec<Proxy>) -> i32 {
    // TODO: 安全问题，但是旧版subconverter也有……
    match file_get_async(path, None).await {
        Ok(content) => explode_conf_content(&content, nodes),
        Err(_) => 0,
    }
}

/// Filters nodes based on include/exclude rules
fn filter_nodes(
    nodes: &mut Vec<Proxy>,
    exclude_remarks: Option<&Vec<String>>,
    include_remarks: Option<&Vec<String>>,
    group_id: i32,
) {
    let mut node_index = 0;
    let mut i = 0;

    while i < nodes.len() {
        if should_ignore(&nodes[i], exclude_remarks, include_remarks) {
            // Log that node is ignored
            println!(
                "Node {} - {} has been ignored and will not be added.",
                nodes[i].group, nodes[i].remark
            );
            nodes.remove(i);
        } else {
            // Log that node is added
            println!(
                "Node {} - {} has been added.",
                nodes[i].group, nodes[i].remark
            );
            nodes[i].id = node_index;
            nodes[i].group_id = group_id;
            node_index += 1;
            i += 1;
        }
    }
}

/// Determines if a node should be ignored based on its remarks and the filtering rules
fn should_ignore(
    node: &Proxy,
    exclude_remarks: Option<&Vec<String>>,
    include_remarks: Option<&Vec<String>>,
) -> bool {
    let mut excluded = false;
    let mut included = true; // Default to true if no include rules

    // Check exclude rules
    if let Some(excludes) = exclude_remarks {
        excluded = excludes.iter().any(|pattern| {
            let mut real_rule = String::new();
            if apply_matcher(pattern, &mut real_rule, node) {
                if !real_rule.is_empty() {
                    reg_find(&node.remark, &real_rule)
                } else {
                    pattern == &node.remark
                }
            } else {
                false
            }
        });
    }

    // Check include rules if they exist
    if let Some(includes) = include_remarks {
        if !includes.is_empty() {
            included = includes.iter().any(|pattern| {
                let mut real_rule = String::new();
                if apply_matcher(pattern, &mut real_rule, node) {
                    if !real_rule.is_empty() {
                        reg_find(&node.remark, &real_rule)
                    } else {
                        pattern == &node.remark
                    }
                } else {
                    false
                }
            });
        }
    }

    // A node is ignored if it's excluded OR not included
    excluded || !included
}

#[cfg(test)]
mod tests {
    use super::{describe_body, is_html_document};

    #[test]
    fn describe_body_shows_the_start_of_text() {
        assert_eq!(describe_body("  \n\t "), None);
        assert_eq!(
            describe_body("{\"message\":\n   \"token expired\"}").as_deref(),
            Some("{\"message\": \"token expired\"}")
        );

        let long = describe_body(&"x".repeat(150)).unwrap();
        assert_eq!(long.chars().count(), 101);
        assert!(long.ends_with('…'));

        // Cuts on character boundaries
        let cjk = describe_body(&"订阅".repeat(80)).unwrap();
        assert_eq!(cjk.chars().count(), 101);
    }

    #[test]
    fn describe_body_names_html_pages_by_title() {
        let page = "\n<!DOCTYPE html>\n<!--[if lt IE 7]> <html class=\"ie6\"> <![endif]-->\n\
                    <html><head><TITLE>\n  example.invalid | 530: 源站 DNS 错误\n</TITLE></head></html>";
        assert!(is_html_document(page));
        assert_eq!(
            describe_body(page).as_deref(),
            Some("a web page titled \"example.invalid | 530: 源站 DNS 错误\"")
        );
        assert_eq!(
            describe_body("<html><body>Login required</body></html>").as_deref(),
            Some("a web page")
        );
    }

    #[test]
    fn subscriptions_are_not_html_documents() {
        for body in [
            "c3M6Ly9ZV1Z6TFRJMU5pMW5ZMjA2Y0dGemMzZHZjbVFAMS4yLjMuNDo4Mzg4I25vZGU=",
            "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@1.2.3.4:8388#node",
            "proxies:\n  - name: node\n    type: ss",
            "[General]\nloglevel = notify",
            "{\"outbounds\": []}",
            "<h1>404 Not Found</h1>",
        ] {
            assert!(!is_html_document(body), "{body}");
        }
    }
}
