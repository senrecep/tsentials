/**
 * String casing utilities.
 *
 * All functions split the input into words by detecting:
 * - camelCase / PascalCase boundaries
 * - Consecutive uppercase runs (e.g. "XMLParser" → ["XML", "Parser"])
 * - Whitespace, hyphens, underscores
 */

function splitWords(str: string): string[] {
  return str
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s\-_]+/)
    .filter(w => w.length > 0);
}

/** "hello world" / "helloWorld" / "hello-world" → "HelloWorld" */
export function toPascalCase(str: string): string {
  return splitWords(str)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

/** "hello world" / "HelloWorld" / "hello-world" → "helloWorld" */
export function toCamelCase(str: string): string {
  const words = splitWords(str);
  return words
    .map((w, i) =>
      i === 0
        ? w.toLowerCase()
        : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join('');
}

/** "hello world" / "helloWorld" / "Hello World" → "hello-world" */
export function toKebabCase(str: string): string {
  return splitWords(str).map(w => w.toLowerCase()).join('-');
}

/** "hello world" / "helloWorld" / "hello-world" → "hello_world" */
export function toSnakeCase(str: string): string {
  return splitWords(str).map(w => w.toLowerCase()).join('_');
}

/** "hello world" / "helloWorld" / "hello-world" → "HELLO_WORLD" */
export function toMacroCase(str: string): string {
  return splitWords(str).map(w => w.toUpperCase()).join('_');
}

/** "hello world" / "helloWorld" / "hello_world" → "Hello-World" */
export function toTrainCase(str: string): string {
  return splitWords(str)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('-');
}

/** "hello world" / "helloWorld" / "hello-world" → "Hello World" */
export function toTitleCase(str: string): string {
  return splitWords(str)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** "hello world" / "helloWorld" / "hello-world" → "_helloWorld" */
export function toUnderscoreCamelCase(str: string): string {
  return `_${toCamelCase(str)}`;
}
