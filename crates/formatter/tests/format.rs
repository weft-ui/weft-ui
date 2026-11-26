use std::fs;
use std::path::Path;

use weft_ui_ast::FileId;
use weft_ui_formatter::{FormatError, Indent, Options, format};

fn golden(source: &str, expected: &str, options: Options) {
    let formatted = format(source, &options).expect("format source");
    assert_eq!(formatted, expected, "source: {source}");
    assert_eq!(format(&formatted, &options), Ok(formatted));
}

#[test]
fn declarations_and_blank_lines() {
    golden(
        r#"  import "z.weft"


import "a.weft"  event First() event Second(a : Int,b:Bool,)



event Third model Empty  {   } model Example {a : Int? [ ] ?,


b:Bool,

}
event Last
component C(foo: Int=0007, bar: Float = 1.20E+02,) {

state x=foo


state y : Int = x + 1
  UI.Text( x,)


  Plain()
  EmptyBlock ( ) { }

}


"#,
        r#"import "z.weft"

import "a.weft"

event First
event Second(a: Int, b: Bool)

event Third

model Empty {}

model Example {
    a: Int?[]?,

    b: Bool,
}

event Last

component C(foo: Int = 0007, bar: Float = 1.20E+02) {
    state x = foo

    state y: Int = x + 1

    UI.Text(x)

    Plain
    EmptyBlock {}
}
"#,
        Options::default(),
    );
    golden(" \t\r\n    \n", "", Options::default());
    golden(
        "component Empty( ) { }",
        "component Empty() {}\n",
        Options::default(),
    );
    golden(
        "model M { f: T? ? }",
        "model M {\n    f: T? ?,\n}\n",
        Options::default(),
    );
}

#[test]
fn app_declaration_formats_and_round_trips() {
    golden(
        "app Notes{start=Home}",
        "app Notes {\n    start = Home\n}\n",
        Options::default(),
    );
}

#[test]
fn page_declarations_format_and_round_trip() {
    golden(
        r#"page Detail(id:String) /* route */ path /* literal */ "/notes/{id}" {Text(id)} page About(){}"#,
        "page Detail(id: String) /* route */ path /* literal */ \"/notes/{id}\" {\n    Text(id)\n}\n\npage About() {}\n",
        Options::default(),
    );
}

#[test]
fn type_aliases_and_literal_unions() {
    golden(
        r#"type Kind="text"/* medium */| "image" |"\u{2603}"
        type Kinds = Kind [ ]
        component App(type:"compact"|"full"="full") {Text(type)}"#,
        r#"type Kind = "text" /* medium */ | "image" | "\u{2603}"

type Kinds = Kind[]

component App(type: "compact" | "full" = "full") {
    Text(type)
}
"#,
        Options::default(),
    );
}

#[test]
fn local_let_bindings() {
    golden(
        r#"component Card(body: Children){body}
component C(let:String) {state n=0 let title : String=let // alias
    let count="${n}" Card{let label=title.uppercase() Text(label)}
    if(n>0){let positive="${count}!" Text(positive)} else{Text(count)}}"#,
        r#"component Card(body: Children) {
    body
}

component C(let: String) {
    state n = 0

    let title: String = let // alias
    let count = "${n}"

    Card {
        let label = title.uppercase()

        Text(label)
    }
    if (n > 0) {
        let positive = "${count}!"

        Text(positive)
    } else {
        Text(count)
    }
}
"#,
        Options::default(),
    );
}

#[test]
fn theme_entries_and_style_tokens() {
    golden(
        r##"theme{ accent="#0a84ff"/* night */dark"#409cff", gap=8 scale= -1.25 }
style Accent{color=theme . accent}
component App(){ Text("accent",style=Accent) }"##,
        r##"theme {
    accent = "#0a84ff" /* night */ dark "#409cff",
    gap = 8
    scale = -1.25
}

style Accent {
    color = theme.accent
}

component App() {
    Text("accent", style = Accent)
}
"##,
        Options::default(),
    );
}

#[test]
fn nodes_expressions_and_parentheses() {
    golden(
        r#"component C(){
 state x=( ( x )+y )*!( ( -z ) )
 state y= ((x))?.y + ((x.y)) - (x.y)()
 state z=x+((y*z))+(if(true) false else null)
 state w=( ( f( ) ) )?.b
 Box{if((c)){Text(1e-3, "π ${ x+ 2 }", name=go(8))}else if(d){Text( (x) .y)}else{}
 for(x in xs;key=x.id){Label}
 for(y in ys){Label}
 }
}"#,
        r#"component C() {
    state x = ((x) + y) * !(-z)
    state y = (x)?.y + (x.y) - (x.y)()
    state z = x + (y * z) + (if (true) false else null)
    state w = (f())?.b

    Box {
        if ((c)) {
            Text(1e-3, "π ${ x+ 2 }", name = go(8))
        } else if (d) {
            Text((x).y)
        } else {}
        for (x in xs; key = x.id) {
            Label
        }
        for (y in ys) {
            Label
        }
    }
}
"#,
        Options::default(),
    );
}

#[test]
fn breaks_groups_and_independently_fits_nested_groups() {
    golden(
        "event E(veryLongParameterName:Int, anotherParameter:Bool)\n\
         component C(parameterLongerThanUsual:Int, flag:Bool=false) {\n\
         state comparison = aVeryLongIdentifier == anotherVeryLongIdentifier\n\
         Panel(first=loooooooooooooooongName, short=fmt(1,2), nested=inner(aaaaaaaaaaaaaaaaaaaa,bbbbbbbbbbbbbbbbbbbb), action={x+=1}){}\n\
         }",
        "event E(\n\
         \x20   veryLongParameterName: Int,\n\
         \x20   anotherParameter: Bool,\n\
         )\n\n\
         component C(\n\
         \x20   parameterLongerThanUsual: Int,\n\
         \x20   flag: Bool = false,\n\
         ) {\n\
         \x20   state comparison = aVeryLongIdentifier == anotherVeryLongIdentifier\n\n\
         \x20   Panel(\n\
         \x20       first = loooooooooooooooongName,\n\
         \x20       short = fmt(1, 2),\n\
         \x20       nested = inner(\n\
         \x20           aaaaaaaaaaaaaaaaaaaa,\n\
         \x20           bbbbbbbbbbbbbbbbbbbb,\n\
         \x20       ),\n\
         \x20       action = { x += 1 },\n\
         \x20   ) {}\n\
         }\n",
        Options {
            max_width: 40,
            ..Options::default()
        },
    );
}

#[test]
fn includes_the_line_suffix_and_tab_columns_when_measuring_width() {
    golden(
        "component C(){ Text(1234567890) Text(123){} }",
        "component C() {\n\tText(\n\t\t1234567890,\n\t)\n\tText(123) {}\n}\n",
        Options {
            indent: Indent::Tab,
            max_width: 19,
        },
    );
    golden(
        "component C(){Text(a){}}",
        "component C() {\n  Text(\n    a,\n  ) {}\n}\n",
        Options {
            indent: Indent::Spaces(2),
            max_width: 11,
        },
    );
}

#[test]
fn formats_flat_and_broken_lambdas() {
    golden(
        "component C(){ A(a={a=1;}, b={v->a=v b+=1;}, c={}, d={v->}, e=(({a-=1})) ) }",
        "component C() {\n    A(a = { a = 1 }, b = { v -> a = v; b += 1 }, c = {}, d = { v -> }, e = ({ a -= 1 }))\n}\n",
        Options::default(),
    );
    golden(
        "component C(){ A(action={v->alpha=longParameterName;\n\n\nbeta+=2; gamma-=3;}) }",
        r#"component C() {
    A(
        action = { v ->
            alpha = longParameterName

            beta += 2
            gamma -= 3
        },
    )
}
"#,
        Options {
            max_width: 35,
            ..Options::default()
        },
    );
}

#[test]
fn comments_in_line_lists_and_groups() {
    let source = r#"
// before first import
import "a" // trailing import


/* before next import */ import "b"
// before model
model M {

    // before field
    name : String, // trailing field


    // before close

}
// before event
event E(/* before event parameter */ a: Int, b: Bool /* trailing block */)

// before component
component C(
 // before component parameter
 a:Int,


 b:Int
 // before param close
){
 // before state
 state x=0   // trailing state

 // before next state
 state y=1
 // before node
 Box  {
  // before child
  A /* trailing child */ B() // trailing node


  // before Box close

 }
 Button( // before first arg
     value=x,

     // before next arg
     action={v-> /* before assignment */ x=v;
         y+=1; // trailing assignment
         // before lambda close
     },
     // before args close
 )
 // before component close
}

// after file

"#;
    golden(
        source,
        r#"// before first import
import "a" // trailing import

/* before next import */
import "b"

// before model
model M {
    // before field
    name: String, // trailing field

    // before close
}

// before event
event E(
    /* before event parameter */
    a: Int,
    b: Bool, /* trailing block */
)

// before component
component C(
    // before component parameter
    a: Int,

    b: Int,
    // before param close
) {
    // before state
    state x = 0 // trailing state

    // before next state
    state y = 1

    // before node
    Box {
        // before child
        A /* trailing child */
        B // trailing node

        // before Box close
    }
    Button(
        // before first arg
        value = x,

        // before next arg
        action = { v ->
            /* before assignment */
            x = v
            y += 1 // trailing assignment
            // before lambda close
        },
        // before args close
    )
    // before component close
}

// after file
"#,
        Options::default(),
    );
}

#[test]
fn comments_in_empty_constructs() {
    golden(
        "event A(/* event */)\nmodel M {/* model */}\ncomponent C(/* params */){ A(/* args */) {/* block */} B(f(/* call */), action={/* lambda */}) }",
        r#"/* event */
event A

model M {
    /* model */
}

component C(
    /* params */
) {
    /* args */
    A {
        /* block */
    }
    B(
        f(
            /* call */
        ),
        action = {
            /* lambda */
        },
    )
}
"#,
        Options::default(),
    );
    golden(" // comment  \n\n", "// comment\n", Options::default());
}

#[test]
fn normalizes_crlf_and_removes_line_final_whitespace() {
    golden(
        "\r\nmodel M {\r\n  /* first  \r\n       second \r\n  */  \r\n  n:Int,  \r\n} // last\t  \r\n\r\n",
        "model M {\n    /* first\n       second\n  */\n    n: Int,\n} // last\n",
        Options::default(),
    );
}

#[test]
fn preserves_disambiguating_empty_element_parentheses() {
    let source =
        "component C(){ state() Text  model() Other  event() Next  component() Last  state() {} }";
    let expected = "component C() {\n    state()\n    Text\n    model()\n    Other\n    event()\n    Next\n    component()\n    Last\n    state {}\n}\n";
    golden(source, expected, Options::default());
}

#[test]
fn callback_parameters_and_lambda_calls() {
    golden(
        "component C(onSelect:Event < Int >,onReset: Event){Button(onClick={n=1;onSelect(n);onReset()})}",
        "component C(onSelect: Event<Int>, onReset: Event) {\n    Button(onClick = { n = 1; onSelect(n); onReset() })\n}\n",
        Options::default(),
    );
}

#[test]
fn block_comment_before_binary_operator() {
    golden(
        "component C() { Text(x /* between operands */ + y) }",
        "component C() {\n    Text(x /* between operands */ + y)\n}\n",
        Options::default(),
    );
}

#[test]
fn block_comment_after_binary_operator() {
    golden(
        "component C() { Text(x + /* before right operand */ y) }",
        "component C() {\n    Text(x + /* before right operand */ y)\n}\n",
        Options::default(),
    );
}

#[test]
fn line_comment_before_binary_operator() {
    golden(
        "component C() { Text(x // before operator\n + y) }",
        "component C() {\n    Text(\n        x // before operator\n        + y,\n    )\n}\n",
        Options::default(),
    );
}

#[test]
fn line_comment_after_binary_operator() {
    golden(
        "component C() { Text(x + // before right operand\n y) }",
        "component C() {\n    Text(\n        x + // before right operand\n        y,\n    )\n}\n",
        Options::default(),
    );
}

#[test]
fn comments_in_nested_binary_expressions() {
    golden(
        r#"component C() {
    Text(x /* before plus */ /* also before plus */ + // after plus
     (y /* multi
line */

        * /* after times */ z))
}"#,
        r#"component C() {
    Text(
        x /* before plus */ /* also before plus */ + // after plus
        (y /* multi
line */

        * /* after times */ z),
    )
}
"#,
        Options::default(),
    );
}

#[test]
fn formats_style_declarations() {
    golden(
        r##"style Muted{color="#6b7280" size /* before */= - 12,italic=false,}
        component Screen(){Text("note", style=Muted,size=14)}"##,
        r##"style Muted {
    color = "#6b7280"
    size /* before */ = -12,
    italic = false,
}

component Screen() {
    Text("note", style = Muted, size = 14)
}
"##,
        Options::default(),
    );
}

#[test]
fn formats_named_slot_fills() {
    golden(
        r#"component Screen() {Card {Text("body") footer :{} header : { // heading
          Text("title") } }}"#,
        r#"component Screen() {
    Card {
        Text("body")
        footer: {}
        header: {
            // heading
            Text("title")
        }
    }
}
"#,
        Options::default(),
    );
}

#[test]
fn reports_syntax_errors() {
    for source in [
        "event E(",
        "@",
        "/* unterminated",
        r#"component C(){Text("${}")}"#,
    ] {
        let Err(FormatError::Syntax(diagnostics)) = format(source, &Options::default()) else {
            panic!("expected syntax diagnostics for {source:?}");
        };
        assert!(!diagnostics.is_empty());
        assert!(diagnostics.iter().all(|d| d.span.file == FileId(0)));
    }
}

#[test]
fn repository_weft_files_format_and_are_idempotent() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    for dir in [
        "example/src",
        "tests/fixtures",
        "crates/transformer/tests/fixtures",
        "packages/vite/test/fixtures",
    ] {
        assert!(verify_fixtures(&root.join(dir)) > 0, "no fixtures in {dir}");
    }
}

fn verify_fixtures(dir: &Path) -> usize {
    let mut count = 0;
    for entry in fs::read_dir(dir).unwrap_or_else(|e| panic!("read {}: {e}", dir.display())) {
        let entry = entry.expect("read fixture directory entry");
        let path = entry.path();
        if entry.file_type().expect("fixture file type").is_dir() {
            count += verify_fixtures(&path);
        } else if path.extension().is_some_and(|ext| ext == "weft") {
            count += 1;
            let source = fs::read_to_string(&path).expect("read Weft fixture");
            let options = Options::default();
            let formatted = format(&source, &options)
                .unwrap_or_else(|e| panic!("format {}: {e}", path.display()));
            let (_, diagnostics) = weft_ui_parser::parse(FileId(0), &formatted);
            assert!(
                !diagnostics.iter().any(|d| d.is_error()),
                "{}: {diagnostics:?}",
                path.display()
            );
            assert_eq!(
                format(&formatted, &options),
                Ok(formatted),
                "{}",
                path.display()
            );
        }
    }
    count
}

#[test]
fn preserves_empty_parens_before_ident_for_let_node() {
    golden(
        "component C() { let() Text(\"hi\") }",
        "component C() {\n    let()\n    Text(\"hi\")\n}\n",
        Options::default(),
    );
}
