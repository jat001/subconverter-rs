use std::collections::HashSet;

// Rule types sing-box rulesets accept (the Clash and Surge converters keep their own lists)
lazy_static::lazy_static! {
    pub static ref BASIC_TYPES: HashSet<&'static str> = {
        let mut set = HashSet::new();
        set.insert("DOMAIN");
        set.insert("DOMAIN-SUFFIX");
        set.insert("DOMAIN-KEYWORD");
        set.insert("IP-CIDR");
        set.insert("SRC-IP-CIDR");
        set.insert("GEOIP");
        set.insert("MATCH");
        set.insert("FINAL");
        set
    };

    pub static ref SINGBOX_RULE_TYPES: HashSet<&'static str> = {
        let mut set = BASIC_TYPES.clone();
        set.insert("IP-VERSION");
        set.insert("INBOUND");
        set.insert("PROTOCOL");
        set.insert("NETWORK");
        set.insert("GEOSITE");
        set.insert("SRC-GEOIP");
        set.insert("DOMAIN-REGEX");
        set.insert("PROCESS-NAME");
        set.insert("PROCESS-PATH");
        set.insert("PACKAGE-NAME");
        set.insert("PORT");
        set.insert("PORT-RANGE");
        set.insert("SRC-PORT");
        set.insert("SRC-PORT-RANGE");
        set.insert("USER");
        set.insert("USER-ID");
        set
    };
}
