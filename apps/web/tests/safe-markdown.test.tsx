// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { SafeMarkdown } from '../src/SafeMarkdown.js';

afterEach(cleanup);
it('renders useful Markdown without executable HTML, remote images or arbitrary links', () => {
  const { container, getByText } = render(
    <SafeMarkdown
      text={
        '**Useful answer**\n\n<script>alert(1)</script>\n\n![tracker](https://example.invalid/pixel)\n\n[Click me](https://example.invalid/exfil)\n\n<a href="javascript:alert(1)">bad</a>'
      }
    />,
  );
  expect(getByText('Useful answer').tagName).toBe('STRONG');
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('a')).toBeNull();
  expect(container.querySelector('iframe')).toBeNull();
});
