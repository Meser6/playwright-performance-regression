import { describe, expect, test } from 'vitest';
import { changelogSection, checkRelease } from '../../scripts/check-release.mjs';

const CHANGELOG = `# Changelog

## [Unreleased]

## [0.2.0] - 2027-01-10

### Added

- Something new.

## [0.1.0-next.0] - 2026-12-01

### Added

- First pre-release.

[0.2.0]: https://example.invalid/compare
`;

const pkg = (version: string, extra: Record<string, unknown> = {}) => ({
  name: 'playwright-performance-regression',
  version,
  ...extra,
});
const create = (version: string, extra: Record<string, unknown> = {}) => ({
  name: 'create-playwright-performance-regression',
  version,
  ...extra,
});

describe('check-release', () => {
  test('13-REQ-06 a stable tag matching both versions with a CHANGELOG section goes to latest', () => {
    expect(checkRelease('v0.2.0', pkg('0.2.0'), create('0.2.0'), CHANGELOG)).toEqual({
      ok: true,
      version: '0.2.0',
      distTag: 'latest',
      prerelease: false,
      notes: '### Added\n\n- Something new.',
    });
  });

  test('13-REQ-07 a -next.N pre-release goes to next, never to latest', () => {
    const result = checkRelease(
      'v0.1.0-next.0',
      pkg('0.1.0-next.0'),
      create('0.1.0-next.0'),
      CHANGELOG,
    );
    expect(result).toMatchObject({ ok: true, distTag: 'next', prerelease: true });
    for (const tag of ['v0.1.0-beta.1', 'v0.1.0-next', 'v1.0', '0.2.0', 'v01.2.0']) {
      const version = tag.replace(/^v/u, '');
      expect(checkRelease(tag, pkg(version), create(version), CHANGELOG).ok, tag).toBe(false);
    }
  });

  test('13-REQ-06 a tag that differs from either version fails before publishing', () => {
    expect(checkRelease('v0.2.0', pkg('0.2.0'), create('0.1.9'), CHANGELOG)).toEqual({
      ok: false,
      problems: ['create/package.json: version 0.1.9 does not match the tag v0.2.0.'],
    });
    expect(checkRelease('v0.2.1', pkg('0.2.0'), create('0.2.0'), CHANGELOG)).toEqual({
      ok: false,
      problems: [
        'package.json: version 0.2.0 does not match the tag v0.2.1.',
        'create/package.json: version 0.2.0 does not match the tag v0.2.1.',
        'CHANGELOG.md has no "## [0.2.1]" section.',
      ],
    });
  });

  test('a package still marked private is not released', () => {
    expect(
      checkRelease(
        'v0.2.0',
        pkg('0.2.0', { private: true }),
        create('0.2.0', { private: true }),
        CHANGELOG,
      ),
    ).toEqual({
      ok: false,
      problems: [
        'package.json: "private": true; the owner removes it before the first release.',
        'create/package.json: "private": true; the owner removes it before the first release.',
      ],
    });
  });

  test('the notes are the CHANGELOG section without heading and link references', () => {
    expect(changelogSection(CHANGELOG, '0.1.0-next.0')).toBe('### Added\n\n- First pre-release.');
    expect(changelogSection(CHANGELOG, '9.9.9')).toBeNull();
    expect(changelogSection('## [1.0.0]\n\n## [0.9.0]\n- x\n', '1.0.0')).toBe('');
    expect(checkRelease('v1.0.0', pkg('1.0.0'), create('1.0.0'), '## [1.0.0]\n\n').ok).toBe(false);
  });
});
