; Later patterns take precedence in Zed, so general captures come first.

(identifier) @variable

; ---- declarations ----------------------------------------------------------

(model_declaration name: (identifier) @type)
(event_declaration name: (identifier) @constructor)
(component_declaration name: (identifier) @tag)
(page_declaration name: (identifier) @tag)
(style_declaration name: (identifier) @constant)
(style_entry name: (identifier) @property)

(field name: (identifier) @property)
(parameter name: (identifier) @variable.parameter)
(state_declaration name: (identifier) @variable)

(type_identifier) @type
((type_identifier) @type.builtin
  (#any-of? @type.builtin "Int" "Float" "Bool" "String" "Color" "Children" "Event"))

; ---- nodes -----------------------------------------------------------------

(element name: (element_name (identifier) @tag))
(for_node variable: (identifier) @variable)
(argument name: (identifier) @property)

; ---- expressions -----------------------------------------------------------

(field_expression field: (identifier) @property)
(call_expression function: (identifier) @constructor)
; Events passed as handlers, by the PascalCase naming convention.
((argument value: (identifier) @constructor)
  (#match? @constructor "^[A-Z]"))
((argument name: (identifier) @_name value: (identifier) @constant)
  (#eq? @_name "style"))
(call_expression function: (field_expression field: (identifier) @function.method))
(lambda parameter: (identifier) @variable.parameter)
(assignment target: (identifier) @variable)
(call_statement function: (identifier) @function)

; ---- literals --------------------------------------------------------------

(string) @string
(escape_sequence) @string.escape
(integer) @number
(float) @number
[(true) (false)] @boolean
(null) @constant.builtin

[(line_comment) (block_comment)] @comment

; ---- keywords and punctuation ----------------------------------------------

[
  "import"
  "model"
  "event"
  "component"
  "page"
  "path"
  "app"
  "start"
  "tabs"
  "style"
  "state"
  "key"
] @keyword

[
  "if"
  "else"
  "for"
  "in"
] @keyword

[
  "??" "||" "&&" "==" "!=" "<" "<=" ">" ">="
  "+" "-" "*" "/" "%" "!"
  "=" "+=" "-=" "->"
] @operator

["(" ")" "{" "}" "[" "]"] @punctuation.bracket
["," ":" ";" "." "?."] @punctuation.delimiter
(optional_type "?" @punctuation.special)
(interpolation ["${" "}"] @punctuation.special)
