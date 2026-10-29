import { describe, expect, it } from 'vitest';
import { versionReport, webViewVersion } from './aboutInfo';

describe('webViewVersion', () => {
  it('reads the version of Edge from the user agent', () => {
    const agent =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.3367.12';
    expect(webViewVersion(agent)).toBe('148.0.3367.12');
  });

  it('is null for a browser that is not Edge, or for no text', () => {
    expect(webViewVersion('Mozilla/5.0 Chrome/148.0.0.0 Safari/537.36')).toBeNull();
    expect(webViewVersion('')).toBeNull();
  });

  it('does not take the version of a name that merely ends in Edg', () => {
    expect(webViewVersion('Mozilla/5.0 Wedg/1.2')).toBeNull();
  });
});

describe('versionReport', () => {
  it('lists the app and the engine', () => {
    expect(versionReport('1.1.0', '148.0.3367.12')).toBe('Spelunker 1.1.0\nWebView2 148.0.3367.12');
  });

  it('says unknown when the engine version cannot be read', () => {
    expect(versionReport('1.1.0', null)).toBe('Spelunker 1.1.0\nWebView2 unknown');
  });
});
