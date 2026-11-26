/**
 * A small JSON Schema 2020-12 checker for Frige's own contract tests (no dependency).
 *
 * Supports the keywords Frige's published schemas use: $ref (local #/$defs only),
 * allOf, oneOf, const, enum, type (string or list), pattern, maxLength, minimum,
 * maxItems, minItems, items, required, properties, additionalProperties: false.
 * An unsupported keyword fails loudly so a schema cannot silently go unchecked.
 */
const KEYWORDS = new Set(['$schema', '$id', 'title', 'description', '$defs', '$ref', 'allOf', 'oneOf', 'const', 'enum', 'type', 'pattern', 'maxLength', 'minimum', 'maxItems', 'minItems', 'items', 'required', 'properties', 'additionalProperties']);

/**
 * Lists every violation of `schema` by `value`.
 *
 * @param {object} schema  The (sub)schema.
 * @param {unknown} value  The value to check.
 * @param {object} [root]  The document holding `$defs` (defaults to `schema`).
 * @param {string} [at]  Path label for messages.
 * @returns {string[]}  Empty when the value conforms.
 */
export function violations(schema, value, root = schema, at = '$') {
  for (const keyword of Object.keys(schema)) if (!KEYWORDS.has(keyword)) throw new Error(`unchecked schema keyword: ${keyword}`);
  const found = [];
  if (schema.$ref) {
    const name = /^#\/\$defs\/(.+)$/.exec(schema.$ref)?.[1];
    if (!name || !root.$defs?.[name]) throw new Error(`unresolvable $ref ${schema.$ref}`);
    found.push(...violations(root.$defs[name], value, root, at));
  }
  for (const part of schema.allOf || []) found.push(...violations(part, value, root, at));
  if (schema.oneOf) {
    const holding = schema.oneOf.filter((alternative) => !violations(alternative, value, root, at).length).length;
    if (holding !== 1) found.push(`${at}: matches ${holding} of oneOf`);
  }
  const typeOf = (entry) => (entry === null ? 'null' : Array.isArray(entry) ? 'array' : Number.isInteger(entry) ? 'integer' : typeof entry);
  if ('const' in schema && value !== schema.const) found.push(`${at}: expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) found.push(`${at}: not one of ${JSON.stringify(schema.enum)}`);
  if (schema.type) {
    const types = [schema.type].flat(); const actual = typeOf(value);
    if (!types.includes(actual) && !(actual === 'integer' && types.includes('number'))) return [...found, `${at}: expected ${types.join('|')}, got ${actual}`];
  }
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) found.push(`${at}: does not match ${schema.pattern}`);
    if (schema.maxLength !== undefined && [...value].length > schema.maxLength) found.push(`${at}: longer than ${schema.maxLength}`);
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) found.push(`${at}: below ${schema.minimum}`);
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) found.push(`${at}: more than ${schema.maxItems} items`);
    if (schema.minItems !== undefined && value.length < schema.minItems) found.push(`${at}: fewer than ${schema.minItems} items`);
    if (schema.items) value.forEach((entry, index) => found.push(...violations(schema.items, entry, root, `${at}[${index}]`)));
  }
  if (typeOf(value) === 'object') {
    for (const key of schema.required || []) if (!(key in value)) found.push(`${at}: missing ${key}`);
    for (const [key, entry] of Object.entries(value)) {
      if (schema.properties?.[key]) found.push(...violations(schema.properties[key], entry, root, `${at}.${key}`));
      else if (schema.additionalProperties === false) found.push(`${at}: unexpected ${key}`);
    }
  }
  return found;
}

/** Checks `value` against `#/$defs/<name>` of a published schema document. */
export const conformsTo = (document, name, value) => violations({ $ref: `#/$defs/${name}` }, value, document);
