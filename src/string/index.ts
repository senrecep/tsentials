/**
 * String casing utilities.
 *
 * All functions split the input into words like CSharpEssentials does:
 * - Any character that is not a letter, combining mark or digit separates words and is dropped
 * - An uppercase or titlecase letter starts a word unless it follows another one (Unicode aware)
 * - A run of digits is its own word ("Hello123World" → ["Hello", "123", "World"])
 * - Consecutive uppercase runs split before the last capital (e.g. "XMLParser" → ["XML", "Parser"])
 */

const WORD = /[\p{L}\p{Mn}\p{Mc}\p{N}]+/gu;
const BOUNDARY =
  /(?<![\p{Lu}\p{Lt}])(?=[\p{Lu}\p{Lt}])|(?<!\p{N})(?=\p{N})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})/u;

function splitWords(str: string): string[] {
  return (str.match(WORD) ?? []).flatMap((chunk) => chunk.split(BOUNDARY));
}

function capitalize(word: string): string {
  const [first = ''] = word;
  return first.toUpperCase() + word.slice(first.length).toLowerCase();
}

/** "hello world" / "helloWorld" / "hello-world" → "HelloWorld" */
export function toPascalCase(str: string): string {
  return splitWords(str)
    .map((w) => capitalize(w))
    .join('');
}

/** "hello world" / "HelloWorld" / "hello-world" → "helloWorld" */
export function toCamelCase(str: string): string {
  const words = splitWords(str);
  return words
    .map((w, i) =>
      i === 0 ? w.toLowerCase() : capitalize(w),
    )
    .join('');
}

/** "hello world" / "helloWorld" / "Hello World" → "hello-world" */
export function toKebabCase(str: string): string {
  return splitWords(str)
    .map((w) => w.toLowerCase())
    .join('-');
}

/** "hello world" / "helloWorld" / "hello-world" → "hello_world" */
export function toSnakeCase(str: string): string {
  return splitWords(str)
    .map((w) => w.toLowerCase())
    .join('_');
}

/** "hello world" / "helloWorld" / "hello-world" → "HELLO_WORLD" */
export function toMacroCase(str: string): string {
  return splitWords(str)
    .map((w) => w.toUpperCase())
    .join('_');
}

/** "hello world" / "helloWorld" / "hello_world" → "Hello-World" */
export function toTrainCase(str: string): string {
  return splitWords(str)
    .map((w) => capitalize(w))
    .join('-');
}

/** "hello world" / "helloWorld" / "hello-world" → "Hello World" */
export function toTitleCase(str: string): string {
  return splitWords(str)
    .map((w) => capitalize(w))
    .join(' ');
}

/** "hello world" / "helloWorld" / "hello-world" → "_helloWorld" */
export function toUnderscoreCamelCase(str: string): string {
  return `_${toCamelCase(str)}`;
}
