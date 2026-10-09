use libsubconverter::{api::SubconverterQuery, render_template, TemplateArgs};

#[test]
fn template_preserves_serialized_request_and_all_variable_scopes() {
    let args = TemplateArgs {
        request_params: SubconverterQuery {
            target: Some("clash".into()),
            url: Some("ss://example.com:443".into()),
            ver: 4,
            new_name: Some(true),
            ..Default::default()
        },
        global_vars: [("name".into(), "global-value".into())].into(),
        local_vars: [("name".into(), "local-value".into())].into(),
        node_list: [("name".into(), "node-value".into())].into(),
    };
    let rendered = render_template(
        "{{ request.target }}|{{ request.url }}|{{ request.ver }}|{{ request.new_name }}|{{ global.name }}|{{ local.name }}|{{ node_list.name }}",
        &args,
        "",
    )
    .unwrap();
    assert_eq!(
        rendered,
        "clash|ss://example.com:443|4|true|global-value|local-value|node-value"
    );
    assert_eq!(args.local_vars["name"], "local-value");
}

#[test]
fn template_keeps_custom_filters_and_undefined_fallbacks() {
    let rendered = render_template(
        "{{ '  example  '|trim }}|{{ 'node-123'|replace('[0-9]+', 'test') }}|{{ default(local.missing, 'fallback') }}|{{ request.target is none }}|{{ string(bool('false')) }}",
        &TemplateArgs::default(),
        "",
    )
    .unwrap();
    assert_eq!(rendered, "example|node-test|fallback|true|false");
}
