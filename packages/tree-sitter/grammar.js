/**
 * @file Tree-sitter grammar for Weft UI (`.weft`), following crates/parser/GRAMMAR.md.
 *
 * Used for syntax highlighting and structure in editors; the compiler has its
 * own parser. `import`, `model`, `event`, `component`, `page`, `path`, `type`, `style`, `theme`,
 * `dark`, `state`, `let` and `key` are contextual: the grammar only treats them as keywords where it
 * expects them, so `model` still works as a parameter name.
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

const PREC = {
  coalesce: 1,
  or: 2,
  and: 3,
  equality: 4,
  comparison: 5,
  additive: 6,
  multiplicative: 7,
  unary: 8,
  postfix: 9,
};

/**
 * One or more `rule`s separated by commas, with an optional trailing comma.
 * @param {RuleOrLiteral} rule
 */
function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)), optional(','));
}

/** @param {RuleOrLiteral} rule */
function commaSep(rule) {
  return optional(commaSep1(rule));
}

export default grammar({
  name: 'weft',

  word: $ => $.identifier,

  extras: $ => [/\s/, $.line_comment, $.block_comment],

  supertypes: $ => [$._expression, $._node, $._type],

  // `dark` after a color starts its dark variant or an adjacent token named `dark`.
  conflicts: $ => [[$.theme_color]],

  rules: {
    source_file: $ => repeat(choice(
      $.import,
      $.model_declaration,
      $.event_declaration,
      $.component_declaration,
      $.page_declaration,
      $.type_alias,
      $.style_declaration,
      $.theme_declaration,
    )),

    import: $ => seq('import', field('path', $.string)),

    // ---- declarations -----------------------------------------------------

    model_declaration: $ => seq(
      'model',
      field('name', $.identifier),
      field('body', $.field_list),
    ),

    field_list: $ => seq('{', commaSep($.field), '}'),

    event_declaration: $ => prec.right(seq(
      'event',
      field('name', $.identifier),
      optional(field('parameters', $.event_parameters)),
    )),

    event_parameters: $ => seq('(', commaSep($.field), ')'),

    field: $ => seq(field('name', $.identifier), ':', field('type', $._type)),

    component_declaration: $ => seq(
      'component',
      field('name', $.identifier),
      field('parameters', $.parameters),
      field('body', $.component_body),
    ),

    page_declaration: $ => seq(
      'page',
      field('name', $.identifier),
      field('parameters', $.parameters),
      optional(seq('path', field('path', alias($._constant_string, $.string)))),
      field('body', $.component_body),
    ),

    parameters: $ => seq('(', commaSep($.parameter), ')'),

    parameter: $ => seq(
      field('name', $.identifier),
      ':',
      field('type', $._type),
      optional(seq('=', field('default', $._expression))),
    ),

    component_body: $ => seq(
      '{',
      repeat($.state_declaration),
      repeat($.let_declaration),
      repeat($._node),
      '}',
    ),

    state_declaration: $ => seq(
      'state',
      field('name', $.identifier),
      optional(seq(':', field('type', $._type))),
      '=',
      field('value', $._expression),
    ),

    let_declaration: $ => seq(
      'let',
      field('name', $.identifier),
      optional(seq(':', field('type', $._type))),
      '=',
      field('value', $._expression),
    ),

    style_declaration: $ => seq(
      'style',
      field('name', $.identifier),
      '{',
      repeat(seq($.style_entry, optional(','))),
      '}',
    ),

    style_entry: $ => seq(
      field('name', $.identifier),
      '=',
      field('value', choice(
        alias($._constant_string, $.string),
        $.integer,
        $.float,
        $.signed_number,
        $.true,
        $.false,
        $.theme_reference,
      )),
    ),

    theme_declaration: $ => seq('theme', '{', repeat(seq($.theme_entry, optional(','))), '}'),

    theme_entry: $ => seq(
      field('name', choice($.identifier, alias('dark', $.identifier))),
      '=',
      field('value', choice($.theme_color, $.integer, $.float, $.signed_number)),
    ),

    theme_color: $ => seq(
      field('light', alias($._constant_string, $.string)),
      optional(seq('dark', field('dark', alias($._constant_string, $.string)))),
    ),

    theme_reference: $ => seq('theme', '.', field('name', $.identifier)),

    signed_number: $ => seq('-', choice($.integer, $.float)),

    // Unlike `string`, a constant string cannot contain an unescaped `${`.
    _constant_string: _ => token(/"(?:\$*(?:[^"\\\n${]|\\(?:[nrt0\\"$]|u\{[0-9a-fA-F]+\}))|\{)*\$*"/),

    // ---- types ------------------------------------------------------------

    type_alias: $ => seq('type', field('name', $.identifier), '=', field('type', $._type)),

    _type: $ => choice($._named_type, $.union_type),

    _named_type: $ => choice(
      alias($.identifier, $.type_identifier),
      $.generic_type,
      $.array_type,
      $.optional_type,
    ),

    generic_type: $ => seq(
      field('name', alias($.identifier, $.type_identifier)),
      '<',
      field('argument', $._type),
      '>',
    ),

    union_type: $ => seq($.string, repeat1(seq('|', $.string))),

    array_type: $ => seq(field('element', $._named_type), '[', ']'),

    optional_type: $ => seq(field('inner', $._named_type), '?'),

    // ---- nodes ------------------------------------------------------------

    block: $ => seq('{', repeat($.let_declaration), repeat($._node), '}'),

    _node: $ => choice($.element, $.if_node, $.for_node, $.slot_fill),

    slot_fill: $ => seq(field('name', $.identifier), ':', field('body', $.block)),

    element: $ => prec.right(seq(
      field('name', $.element_name),
      optional(field('arguments', $.arguments)),
      optional(field('children', $.block)),
    )),

    element_name: $ => seq($.identifier, repeat(seq('.', $.identifier))),

    if_node: $ => prec.right(seq(
      'if',
      '(',
      field('condition', $._expression),
      ')',
      field('consequence', $.block),
      optional(seq('else', field('alternative', choice($.if_node, $.block)))),
    )),

    for_node: $ => seq(
      'for',
      '(',
      field('variable', $.identifier),
      'in',
      field('iterable', $._expression),
      optional(seq(';', 'key', '=', field('key', $._expression))),
      ')',
      field('body', $.block),
    ),

    arguments: $ => seq('(', commaSep($.argument), ')'),

    argument: $ => seq(
      optional(seq(field('name', $.identifier), '=')),
      field('value', $._expression),
    ),

    // ---- expressions ------------------------------------------------------

    _expression: $ => choice(
      $.if_expression,
      $.binary_expression,
      $.unary_expression,
      $.field_expression,
      $.call_expression,
      $.parenthesized_expression,
      $.lambda,
      $.identifier,
      $.theme_reference,
      $.integer,
      $.float,
      $.string,
      $.true,
      $.false,
      $.null,
    ),

    if_expression: $ => prec.right(seq(
      'if',
      '(',
      field('condition', $._expression),
      ')',
      field('consequence', $._expression),
      'else',
      field('alternative', $._expression),
    )),

    binary_expression: $ => {
      /** @type {[string, number][]} */
      const table = [
        ['??', PREC.coalesce],
        ['||', PREC.or],
        ['&&', PREC.and],
        ['==', PREC.equality],
        ['!=', PREC.equality],
        ['<', PREC.comparison],
        ['<=', PREC.comparison],
        ['>', PREC.comparison],
        ['>=', PREC.comparison],
        ['+', PREC.additive],
        ['-', PREC.additive],
        ['*', PREC.multiplicative],
        ['/', PREC.multiplicative],
        ['%', PREC.multiplicative],
      ];
      return choice(...table.map(([operator, precedence]) => prec.left(precedence, seq(
        field('left', $._expression),
        field('operator', operator),
        field('right', $._expression),
      ))));
    },

    unary_expression: $ => prec(PREC.unary, seq(
      field('operator', choice('!', '-')),
      field('operand', $._expression),
    )),

    field_expression: $ => prec(PREC.postfix, seq(
      field('value', $._expression),
      choice('.', '?.'),
      field('field', $.identifier),
    )),

    call_expression: $ => prec(PREC.postfix, seq(
      field('function', choice($.identifier, $.field_expression)),
      field('arguments', $.arguments),
    )),

    parenthesized_expression: $ => seq('(', $._expression, ')'),

    lambda: $ => seq(
      '{',
      optional(seq(field('parameter', $.identifier), '->')),
      repeat(seq(choice($.assignment, $.call_statement), optional(';'))),
      '}',
    ),

    call_statement: $ => seq(
      field('function', $.identifier),
      field('arguments', $.arguments),
    ),

    assignment: $ => seq(
      field('target', $.identifier),
      field('operator', choice('=', '+=', '-=')),
      field('value', $._expression),
    ),

    // ---- literals ---------------------------------------------------------

    string: $ => seq(
      '"',
      repeat(choice(
        $.string_content,
        $.escape_sequence,
        $.interpolation,
      )),
      token.immediate('"'),
    ),

    // A `$` not starting `${` is plain text.
    string_content: _ => choice(
      token.immediate(prec(1, /[^"\\\n$]+/)),
      token.immediate('$'),
    ),

    escape_sequence: _ => token.immediate(seq(
      '\\',
      choice(/[nrt0\\"$]/, /u\{[0-9a-fA-F]+\}/),
    )),

    interpolation: $ => seq(
      token.immediate('${'),
      field('expression', $._expression),
      '}',
    ),

    integer: _ => /[0-9]+/,

    float: _ => token(choice(
      /[0-9]+\.[0-9]+([eE][+-]?[0-9]+)?/,
      /[0-9]+[eE][+-]?[0-9]+/,
    )),

    true: _ => 'true',
    false: _ => 'false',
    null: _ => 'null',

    identifier: _ => /[A-Za-z_][A-Za-z0-9_]*/,

    line_comment: _ => token(seq('//', /[^\n]*/)),

    block_comment: _ => token(seq('/*', /[^*]*\*+([^/*][^*]*\*+)*/, '/')),
  },
});
