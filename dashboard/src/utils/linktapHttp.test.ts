import { describe, it, expect } from 'vitest';
import { extractJsonFromMaybeHtml, coerceWateringBool } from './linktapHttp';

describe('extractJsonFromMaybeHtml', () => {
  it('returns plain JSON text unchanged', () => {
    const json = '{"ret":0,"is_watering":1}';
    expect(extractJsonFromMaybeHtml(json)).toBe(json);
  });

  it('pulls the JSON object out of an HTML-wrapped response', () => {
    const wrapped = '<html><body>{"ret":0,"speed":2.5}</body></html>';
    expect(JSON.parse(extractJsonFromMaybeHtml(wrapped))).toEqual({ ret: 0, speed: 2.5 });
  });

  it('handles an html tag with attributes and surrounding whitespace', () => {
    const wrapped = '<html lang="en">\n  {"a":1}\n</html>';
    expect(JSON.parse(extractJsonFromMaybeHtml(wrapped))).toEqual({ a: 1 });
  });

  it('returns the input unchanged if it claims HTML but has no JSON object', () => {
    const html = '<html><body>Not Found</body></html>';
    expect(extractJsonFromMaybeHtml(html)).toBe(html);
  });
});

describe('coerceWateringBool', () => {
  it('treats true / "true" / 1 / "1" as watering', () => {
    for (const v of [true, 'true', 1, '1']) expect(coerceWateringBool(v)).toBe(true);
  });

  it('treats everything else as not watering', () => {
    for (const v of [false, 'false', 0, '0', null, undefined, '', 'yes', 2]) {
      expect(coerceWateringBool(v)).toBe(false);
    }
  });
});
