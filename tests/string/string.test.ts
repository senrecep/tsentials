import {
  toCamelCase,
  toKebabCase,
  toMacroCase,
  toPascalCase,
  toSnakeCase,
  toTitleCase,
  toTrainCase,
  toUnderscoreCamelCase,
} from '../../src/string/index.js';

describe('toPascalCase', () => {
  it('converts lowercase words', () => {
    expect(toPascalCase('hello world')).toBe('HelloWorld');
  });

  it('converts camelCase input', () => {
    expect(toPascalCase('helloWorld')).toBe('HelloWorld');
  });

  it('converts PascalCase input (idempotent)', () => {
    expect(toPascalCase('HelloWorld')).toBe('HelloWorld');
  });

  it('converts kebab-case input', () => {
    expect(toPascalCase('hello-world')).toBe('HelloWorld');
  });

  it('converts snake_case input', () => {
    expect(toPascalCase('hello_world')).toBe('HelloWorld');
  });

  it('handles consecutive uppercase (XMLParser)', () => {
    expect(toPascalCase('XML parser result')).toBe('XmlParserResult');
  });

  it('handles single word', () => {
    expect(toPascalCase('hello')).toBe('Hello');
  });

  it('handles already PascalCase single word', () => {
    expect(toPascalCase('Hello')).toBe('Hello');
  });
});

describe('toCamelCase', () => {
  it('converts lowercase words', () => {
    expect(toCamelCase('hello world')).toBe('helloWorld');
  });

  it('converts camelCase input (idempotent)', () => {
    expect(toCamelCase('helloWorld')).toBe('helloWorld');
  });

  it('converts PascalCase input', () => {
    expect(toCamelCase('HelloWorld')).toBe('helloWorld');
  });

  it('converts kebab-case input', () => {
    expect(toCamelCase('hello-world')).toBe('helloWorld');
  });

  it('converts snake_case input', () => {
    expect(toCamelCase('hello_world')).toBe('helloWorld');
  });

  it('handles consecutive uppercase (XML parser result)', () => {
    expect(toCamelCase('XML parser result')).toBe('xmlParserResult');
  });

  it('handles single word', () => {
    expect(toCamelCase('hello')).toBe('hello');
  });

  it('handles single uppercase word', () => {
    expect(toCamelCase('Hello')).toBe('hello');
  });
});

describe('toKebabCase', () => {
  it('converts lowercase words', () => {
    expect(toKebabCase('hello world')).toBe('hello-world');
  });

  it('converts camelCase input', () => {
    expect(toKebabCase('helloWorld')).toBe('hello-world');
  });

  it('converts PascalCase input', () => {
    expect(toKebabCase('HelloWorld')).toBe('hello-world');
  });

  it('converts kebab-case input (idempotent)', () => {
    expect(toKebabCase('hello-world')).toBe('hello-world');
  });

  it('converts snake_case input', () => {
    expect(toKebabCase('hello_world')).toBe('hello-world');
  });

  it('handles consecutive uppercase (XML parser result)', () => {
    expect(toKebabCase('XML parser result')).toBe('xml-parser-result');
  });

  it('handles single word', () => {
    expect(toKebabCase('hello')).toBe('hello');
  });
});

describe('toSnakeCase', () => {
  it('converts lowercase words', () => {
    expect(toSnakeCase('hello world')).toBe('hello_world');
  });

  it('converts camelCase input', () => {
    expect(toSnakeCase('helloWorld')).toBe('hello_world');
  });

  it('converts PascalCase input', () => {
    expect(toSnakeCase('HelloWorld')).toBe('hello_world');
  });

  it('converts kebab-case input', () => {
    expect(toSnakeCase('hello-world')).toBe('hello_world');
  });

  it('converts snake_case input (idempotent)', () => {
    expect(toSnakeCase('hello_world')).toBe('hello_world');
  });

  it('handles consecutive uppercase (XML parser result)', () => {
    expect(toSnakeCase('XML parser result')).toBe('xml_parser_result');
  });

  it('handles single word', () => {
    expect(toSnakeCase('hello')).toBe('hello');
  });
});

describe('toMacroCase', () => {
  it('converts lowercase words', () => {
    expect(toMacroCase('hello world')).toBe('HELLO_WORLD');
  });

  it('converts camelCase input', () => {
    expect(toMacroCase('helloWorld')).toBe('HELLO_WORLD');
  });

  it('converts PascalCase input', () => {
    expect(toMacroCase('HelloWorld')).toBe('HELLO_WORLD');
  });

  it('converts kebab-case input', () => {
    expect(toMacroCase('hello-world')).toBe('HELLO_WORLD');
  });

  it('converts snake_case input', () => {
    expect(toMacroCase('hello_world')).toBe('HELLO_WORLD');
  });

  it('handles consecutive uppercase (XML parser result)', () => {
    expect(toMacroCase('XML parser result')).toBe('XML_PARSER_RESULT');
  });

  it('handles single word', () => {
    expect(toMacroCase('hello')).toBe('HELLO');
  });
});

describe('toTrainCase', () => {
  it('converts lowercase words', () => {
    expect(toTrainCase('hello world')).toBe('Hello-World');
  });

  it('converts camelCase input', () => {
    expect(toTrainCase('helloWorld')).toBe('Hello-World');
  });

  it('converts PascalCase input', () => {
    expect(toTrainCase('HelloWorld')).toBe('Hello-World');
  });

  it('converts kebab-case input', () => {
    expect(toTrainCase('hello-world')).toBe('Hello-World');
  });

  it('converts snake_case input', () => {
    expect(toTrainCase('hello_world')).toBe('Hello-World');
  });

  it('handles consecutive uppercase (XML parser result)', () => {
    expect(toTrainCase('XML parser result')).toBe('Xml-Parser-Result');
  });

  it('handles single word', () => {
    expect(toTrainCase('hello')).toBe('Hello');
  });
});

describe('toTitleCase', () => {
  it('converts lowercase words', () => {
    expect(toTitleCase('hello world')).toBe('Hello World');
  });

  it('converts camelCase input', () => {
    expect(toTitleCase('helloWorld')).toBe('Hello World');
  });

  it('converts PascalCase input', () => {
    expect(toTitleCase('HelloWorld')).toBe('Hello World');
  });

  it('converts kebab-case input', () => {
    expect(toTitleCase('hello-world')).toBe('Hello World');
  });

  it('converts snake_case input', () => {
    expect(toTitleCase('hello_world')).toBe('Hello World');
  });

  it('handles consecutive uppercase (XML parser result)', () => {
    expect(toTitleCase('XML parser result')).toBe('Xml Parser Result');
  });

  it('handles single word', () => {
    expect(toTitleCase('hello')).toBe('Hello');
  });

  it('handles already title case (idempotent)', () => {
    expect(toTitleCase('Hello World')).toBe('Hello World');
  });
});

describe('toUnderscoreCamelCase', () => {
  it('converts lowercase words', () => {
    expect(toUnderscoreCamelCase('hello world')).toBe('_helloWorld');
  });

  it('converts camelCase input', () => {
    expect(toUnderscoreCamelCase('helloWorld')).toBe('_helloWorld');
  });

  it('converts PascalCase input', () => {
    expect(toUnderscoreCamelCase('HelloWorld')).toBe('_helloWorld');
  });

  it('converts kebab-case input', () => {
    expect(toUnderscoreCamelCase('hello-world')).toBe('_helloWorld');
  });

  it('converts snake_case input', () => {
    expect(toUnderscoreCamelCase('hello_world')).toBe('_helloWorld');
  });

  it('handles consecutive uppercase (XML parser result)', () => {
    expect(toUnderscoreCamelCase('XML parser result')).toBe('_xmlParserResult');
  });

  it('handles single word', () => {
    expect(toUnderscoreCamelCase('hello')).toBe('_hello');
  });
});

// Ported from CSharpEssentials.Tests/Core/StringExtensionsTests.cs. Expected values are the
// JS results where the platforms differ: tsentials keeps acronym splitting ("IDs" -> "I", "Ds";
// C# gives "ids"), and JS upper-cases "ß" to "SS" (C# keeps "ß"). C# culture rows are left out.
describe('Unicode, digit and punctuation word boundaries', () => {
  const converters = {
    pascal: toPascalCase,
    camel: toCamelCase,
    underscoreCamel: toUnderscoreCamelCase,
    kebab: toKebabCase,
    snake: toSnakeCase,
    macro: toMacroCase,
    train: toTrainCase,
    title: toTitleCase,
  };
  type Converter = keyof typeof converters;

  const cases: [string, Converter, string][] = [
    ['HelloWorld', 'pascal', 'HelloWorld'],
    ['helloworld', 'pascal', 'Helloworld'],
    ['HELLOWORLD', 'pascal', 'Helloworld'],
    ['HELLOWORLD', 'camel', 'helloworld'],
    ['Hello123World', 'snake', 'hello_123_world'],
    ['', 'pascal', ''],
    ['a', 'pascal', 'A'],
    ['A', 'pascal', 'A'],
    ['hello_world-test', 'pascal', 'HelloWorldTest'],
    ['_hello', 'pascal', 'Hello'],
    ['hello_', 'pascal', 'Hello'],
    ['---hello', 'pascal', 'Hello'],
    ['hello---world', 'pascal', 'HelloWorld'],
    ['', 'kebab', ''],
    ['a', 'kebab', 'a'],
    ['hello_world-test', 'kebab', 'hello-world-test'],
    ['---hello', 'kebab', 'hello'],
    ['hello---world', 'kebab', 'hello-world'],
    ['', 'snake', ''],
    ['hello_world-test', 'snake', 'hello_world_test'],
    ['---hello', 'snake', 'hello'],
    ['İstanbul Ankara', 'pascal', 'İstanbulAnkara'],
    ['çok güzel', 'pascal', 'ÇokGüzel'],
    ['çok güzel', 'camel', 'çokGüzel'],
    ['用户名', 'snake', '用户名'],
    ['user用户Name', 'snake', 'user用户_name'],
    ['café', 'snake', 'café'],
    ['fooǅemal', 'snake', 'foo_ǆemal'],
    ['עברית שלום', 'snake', 'עברית_שלום'],
    ['สวัสดีWorld', 'snake', 'สวัสดี_world'],
    ['مرحبا بالعالم', 'kebab', 'مرحبا-بالعالم'],
    ['user_用户_name', 'pascal', 'User用户Name'],
    ['A1A1A1', 'snake', 'a_1_a_1_a_1'],
    ['A1A1', 'title', 'A 1 A 1'],
    ['Über_straßeName用户ID9', 'snake', 'über_straße_name用户_id_9'],
    ['Über_straßeName用户ID9', 'macro', 'ÜBER_STRASSE_NAME用户_ID_9'],
    ['__userIDs2Name', 'pascal', 'UserIDs2Name'],
    ['__userIDs2Name', 'snake', 'user_i_ds_2_name'],
    ['Über-straßeID', 'pascal', 'ÜberStraßeId'],
    ['Über-straßeID', 'camel', 'überStraßeId'],
    ['Über-straßeID', 'underscoreCamel', '_überStraßeId'],
    ['Über-straßeID', 'kebab', 'über-straße-id'],
    ['Über-straßeID', 'snake', 'über_straße_id'],
    ['Über-straßeID', 'macro', 'ÜBER_STRASSE_ID'],
    ['Über-straßeID', 'train', 'Über-Straße-Id'],
    ['Über-straßeID', 'title', 'Über Straße Id'],
    // tsentials additions: punctuation separates words, acronyms split before a capitalized word
    ['foo.bar/baz', 'snake', 'foo_bar_baz'],
    ['x²y½', 'snake', 'x_y'],
    ['v٣Api', 'snake', 'v_٣_api'],
    ['XMLParser', 'kebab', 'xml-parser'],
    ['ÄÖÜStraße', 'kebab', 'äöü-straße'],
    ['überÄpfel', 'kebab', 'über-äpfel'],
    ['𐐀𐐨𐐨 word', 'pascal', '𐐀𐐨𐐨Word'],
    ['𐐨𐐨 word', 'pascal', '𐐀𐐨Word'],
  ];

  it.each(cases)('%j to %s is %j', (input, converter, expected) => {
    expect(converters[converter](input)).toBe(expected);
  });
});
