import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isFresh, isLogin, isRepoName, isTopLang, parseCloneProgress, toPerson, TOP_TTL_MS, topSearchPath, toRepo } from '../src/main/integrations/githubRepoLogic.ts';

test('only plain owner/name reaches git', () => {
  assert.equal(isRepoName('joel1fps/orbi'), true);
  assert.equal(isRepoName('vercel/next.js'), true);
  assert.equal(isRepoName('a/..'), false);
  assert.equal(isRepoName('a/b/c'), false);
  assert.equal(isRepoName('-x/repo'), false);
  assert.equal(isRepoName('a/b.git'), false);
  assert.equal(isRepoName('a/b --upload-pack=x'), false);
  assert.equal(isRepoName(42), false);
  assert.equal(isLogin('torvalds'), true);
  assert.equal(isLogin('../etc'), false);
});

test('API repositories become cards; foreign avatar hosts are dropped', () => {
  const r = toRepo({
    full_name: 'joel1fps/orbi',
    owner: { login: 'joel1fps', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' },
    description: null,
    stargazers_count: 3,
    private: true,
    pushed_at: '2026-11-08T10:00:00Z',
  });
  assert.equal(r?.name, 'orbi');
  assert.equal(r?.private, true);
  assert.equal(r?.description, undefined);
  assert.equal(r?.url, 'https://github.com/joel1fps/orbi');
  assert.equal(toRepo({ full_name: 'x/y', owner: { avatar_url: 'https://evil.example/a.png' } })?.avatar, undefined);
  assert.equal(toRepo({ full_name: 'bad' }), null);
});

test('clone progress maps git phases onto one bar', () => {
  assert.deepEqual(parseCloneProgress('Receiving objects:  50% (5/10)\r'), { phase: 'Baixando', percent: 48 });
  assert.deepEqual(parseCloneProgress('Counting objects: 100% (3/3)\rReceiving objects: 100% (10/10), done.\n'), { phase: 'Baixando', percent: 85 });
  assert.deepEqual(parseCloneProgress('Updating files: 100% (9/9), done.'), { phase: 'Gravando arquivos', percent: 100 });
  assert.equal(parseCloneProgress("Cloning into 'orbi'..."), null);
});

test('the week top asks for repositories created in the last 7 days, by stars', () => {
  const now = Date.parse('2026-11-08T12:00:00Z');
  const all = decodeURIComponent(topSearchPath('', now));
  assert.match(all, /q=created:>2026-11-01$/);
  assert.match(all, /per_page=10&sort=stars&order=desc/);
  assert.match(decodeURIComponent(topSearchPath('Python', now)), /q=created:>2026-11-01 language:Python$/);
  assert.equal(isTopLang('Rust'), true);
  assert.equal(isTopLang('Rust language:Go'), false);
  assert.equal(isTopLang(undefined), false);
});

test('a kept top list is fresh for a few hours, never from the future', () => {
  const now = 1_000_000_000;
  assert.equal(isFresh(now - 60_000, now), true);
  assert.equal(isFresh(now - TOP_TTL_MS, now), false);
  assert.equal(isFresh(now + 60_000, now), false);
  assert.equal(isFresh(undefined, now), false);
});

test('people keep only a valid login and a GitHub avatar', () => {
  assert.deepEqual(toPerson({ login: 'torvalds', avatar_url: 'https://avatars.githubusercontent.com/u/1024025?v=4' }), {
    login: 'torvalds',
    avatar: 'https://avatars.githubusercontent.com/u/1024025?v=4',
  });
  assert.equal(toPerson({ login: 'x', avatar_url: 'https://evil.example/a.png' })?.avatar, undefined);
  assert.equal(toPerson({ login: '../etc' }), null);
});
