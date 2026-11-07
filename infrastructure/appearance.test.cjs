const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('../apps/web/node_modules/typescript');
const dir = path.resolve(__dirname, '../packages/frontend/src');
const compile = name => ts.transpileModule(fs.readFileSync(path.join(dir, name + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const bootstrap = { exports: {} };
vm.runInNewContext(compile('appearance-bootstrap'), { exports: bootstrap.exports });
const { APPEARANCE_KEY, appearanceBootstrap } = bootstrap.exports;
let checks = 0;
function equal(actual, expected, label) { assert.equal(actual, expected, label); checks++; }
function environment(stored, dark, blocked = false) {
  const mediaListeners = [], storageListeners = [];
  const media = { matches: dark, addEventListener: (_, fn) => mediaListeners.push(fn) };
  const document = { documentElement: { dataset: {}, style: {} }, querySelector: () => ({ setAttribute: (_, value) => { document.themeColor = value; } }) };
  const values = new Map(stored === null ? [] : [[APPEARANCE_KEY, stored]]);
  const localStorage = { getItem: key => { if (blocked) throw Error('Storage unavailable'); return values.get(key) ?? null; }, setItem: (key, value) => { if (blocked) throw Error('Storage unavailable'); values.set(key, value); } };
  const window = { matchMedia: () => media, addEventListener: (_, fn) => storageListeners.push(fn) };
  const context = { exports: {}, document, window, localStorage, matchMedia: window.matchMedia, require: () => bootstrap.exports };
  const load = () => vm.runInNewContext(compile('appearance'), context);
  const start = () => vm.runInNewContext(appearanceBootstrap, context);
  const os = next => { media.matches = next; mediaListeners.forEach(fn => fn({ matches: next })); };
  const storage = (key, value) => storageListeners.forEach(fn => fn({ key, newValue: value }));
  return { context, document, mediaListeners, storageListeners, values, load, start, os, storage };
}

for (const stored of [null, 'system', 'light', 'dark', 'corrupt', '"dark"']) for (const dark of [false, true]) for (const blocked of [false, true]) {
  const e = environment(stored, dark, blocked); e.start();
  const preference = !blocked && ['light', 'dark'].includes(stored) ? stored : 'system';
  const expected = preference === 'dark' || preference === 'system' && dark ? 'dark' : 'light';
  equal(e.document.documentElement.dataset.theme, expected, 'first paint resolves preference');
  e.load();
  equal(e.context.exports.getAppearance(), preference, 'runtime/bootstrap agree on preference');
  equal(e.document.documentElement.dataset.theme, expected, 'runtime/bootstrap agree on palette');
  equal(e.document.documentElement.style.colorScheme, expected, 'native controls follow palette');
}

const e = environment(null, false); e.load(); const api = e.context.exports;
let notifications = 0; const unsubscribe = api.subscribeAppearance(() => notifications++);
api.setAppearance('dark'); equal(e.document.documentElement.dataset.theme, 'dark', 'explicit selection applies');
equal(e.values.get(APPEARANCE_KEY), 'dark', 'selection persists on this browser');
equal(e.document.themeColor, '#15171d', 'mobile browser chrome follows dark');
e.os(false); equal(e.document.documentElement.dataset.theme, 'dark', 'OS cannot override explicit selection');
api.setAppearance('system'); equal(e.document.documentElement.dataset.theme, 'light', 'system resolves current OS');
e.os(true); equal(e.document.documentElement.dataset.theme, 'dark', 'live OS changes apply in system mode');
api.setAppearance('light'); e.os(true); equal(e.document.documentElement.dataset.theme, 'light', 'explicit light remains light');
equal(e.document.themeColor, '#f6f7fb', 'mobile browser chrome follows light');
e.storage(APPEARANCE_KEY, 'dark'); equal(api.getAppearance(), 'dark', 'same-origin tabs synchronize preference');
equal(e.document.documentElement.dataset.theme, 'dark', 'storage event applies palette');
e.storage('unrelated', 'light'); equal(api.getAppearance(), 'dark', 'unrelated settings are ignored');
e.storage(APPEARANCE_KEY, 'corrupt'); equal(api.getAppearance(), 'system', 'corrupt preference safely follows OS');
e.storage(null, null); equal(api.getAppearance(), 'system', 'cleared storage resets preference');
api.initializeAppearance(); api.initializeAppearance();
equal(e.mediaListeners.length, 1, 'initialization has one system listener');
equal(e.storageListeners.length, 1, 'initialization has one tab listener');
unsubscribe(); const prior = notifications; api.setAppearance('light'); equal(notifications, prior, 'unmount unsubscribes');
const refresh = environment(e.values.get(APPEARANCE_KEY), true); refresh.start(); refresh.load(); equal(refresh.context.exports.getAppearance(), 'light', 'refresh retains choice');
const blocked = environment(null, false, true); blocked.load(); blocked.context.exports.setAppearance('dark'); equal(blocked.document.documentElement.dataset.theme, 'dark', 'storage denial does not disable switching');
blocked.context.exports.setAppearance('system'); blocked.os(true); equal(blocked.document.documentElement.dataset.theme, 'dark', 'blocked storage still supports system updates');
const ssr = { exports: {}, require: () => bootstrap.exports }; vm.runInNewContext(compile('appearance'), ssr); equal(ssr.exports.getAppearance(), 'system', 'module can render on server without DOM');
console.log(checks + ' appearance/bootstrap contract checks passed; no browser or model calls');
