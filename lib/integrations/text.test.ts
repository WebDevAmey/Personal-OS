// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { decodeHtmlEntities, htmlToText, truncateText } from './text';

describe('htmlToText', () => {
  it('keeps text, turns blocks into line breaks and decodes entities', () => {
    const html = '<html><head><title>T</title></head><body><p>Hi Amey,</p><p>Fish &amp; chips at 5&nbsp;pm?<br>Thanks</p></body></html>';
    expect(htmlToText(html)).toBe('Hi Amey,\n\nFish & chips at 5 pm?\nThanks');
  });

  it('drops script and style contents entirely', () => {
    const html = '<p>a</p><script>alert(1); document.cookie</script><style>p{color:red}</style><p>b</p>';
    const text = htmlToText(html);
    expect(text).not.toMatch(/alert|cookie|color/);
    expect(text).toBe('a\n\nb');
  });

  it('handles mixed-case and attribute-laden script tags', () => {
    expect(htmlToText('x<ScRiPt type="text/javascript">evil()</sCrIpT >y')).toBe('xy');
  });

  it('drops the rest of the document after an unterminated script', () => {
    expect(htmlToText('safe<script>evil() and more')).toBe('safe');
  });

  it('does not end a tag at a ">" inside a quoted attribute', () => {
    expect(htmlToText('<a title="x > y" href="javascript:alert(1)">link</a>')).toBe('link');
  });

  it('drops comments, including unterminated ones and conditional comments', () => {
    expect(htmlToText('a<!-- hidden <script>x</script> -->b<!--[if mso]>c<![endif]-->d<!-- open')).toBe('abd');
  });

  it('never emits tag fragments from malformed markup', () => {
    const out = htmlToText('<div<img src=x onerror=alert(1)>>text<img src="x" onerror="alert(1)"');
    expect(out).not.toMatch(/onerror|<img|src=/);
    expect(out).toContain('text');
  });

  it('keeps a literal "<" that does not start a tag', () => {
    expect(htmlToText('1 < 2 and 3 <= 4')).toBe('1 < 2 and 3 <= 4');
  });

  it('decodes escaped markup as text without re-parsing it', () => {
    // The output is text: an escaped tag becomes visible characters, which a
    // React text node or the model sees as text, not markup.
    expect(htmlToText('&lt;script&gt;x&lt;/script&gt;')).toBe('<script>x</script>');
  });

  it('drops hidden elements such as svg and noscript', () => {
    expect(htmlToText('a<svg><text>hidden</text></svg><noscript>n</noscript>b')).toBe('ab');
  });
});

describe('decodeHtmlEntities', () => {
  it('decodes named, decimal and hex references', () => {
    expect(decodeHtmlEntities('&quot;x&quot; &#39;y&#39; &#x1F600; &copy;')).toBe('"x" \'y\' \u{1F600} \u00A9');
  });

  it('replaces invalid code points and keeps unknown names', () => {
    expect(decodeHtmlEntities('&#0; &#xD800; &bogus;')).toBe('\uFFFD \uFFFD &bogus;');
  });
});

describe('truncateText', () => {
  it('returns the text unchanged when within the limit', () => {
    expect(truncateText('abc', 3)).toEqual({ text: 'abc', truncated: false });
  });

  it('truncates with an ellipsis and flags it', () => {
    const out = truncateText('abcdef', 4);
    expect(out.truncated).toBe(true);
    expect(out.text).toBe('abc\u2026');
    expect(out.text.length).toBe(4);
  });

  it('does not split a surrogate pair', () => {
    const out = truncateText('ab\u{1F600}cd', 4);
    expect(out.text).toBe('ab\u2026');
  });
});
