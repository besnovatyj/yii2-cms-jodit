/*
 * Copyright (c) 2026 Besnovatyj. Licensed under the MIT License.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = await mkdtemp(path.join(tmpdir(), 'shortcode-browser-'));
await build({entryPoints: [path.join(root, 'tests/browser-entry.ts')], bundle: true, format: 'esm', outfile: path.join(output, 'bundle.js'), loader: {'.svg': 'dataurl', '.png': 'dataurl', '.gif': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl', '.eot': 'dataurl'}, logLevel: 'silent'});
const dto = (shortcode, replacement, mode = 'none') => ({shortcode, replacement, type: 'text', description: '', example: shortcode, reverse: {mode}});
const items = [dto('%files%', 'https://files.example.test', 'url-prefix'), dto('%home%', '/'), dto('%manual%', 'https://manual.example.test')];
let failure = false;
let invalid = false;
let delay = 100;
let requests = 0;
const server = createServer(async (req, res) => {
    if (req.url.startsWith('/api')) {
        requests++;
        await new Promise(resolve => setTimeout(resolve, delay));
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = failure ? 503 : 200;
        res.end(JSON.stringify(invalid ? {items: [{...items[0], reverse: {mode: 'unsupported'}}]} : {items}));
    } else if (req.url === '/bundle.js' || req.url === '/bundle.css') {
        res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css');
        res.end(await readFile(path.join(output, req.url.slice(1))));
    } else {
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><html><head><link rel="stylesheet" href="/bundle.css"></head><body><form id="main"><textarea id="one" name="one"></textarea><textarea id="two" name="two"></textarea><button id="save">Save</button></form><form id="other"><button>Other</button></form></body></html>');
    }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const base = `http://127.0.0.1:${server.address().port}`;
async function boot(config = {}, count = 1) {
    await page.goto(base);
    if (process.env.YII_VENDOR) {
        await page.addScriptTag({path: path.join(process.env.YII_VENDOR, 'bower-asset/jquery/dist/jquery.js')});
        await page.addScriptTag({path: path.join(process.env.YII_VENDOR, 'yiisoft/yii2/assets/yii.activeForm.js')});
    }
    await page.evaluate(async ({config, count}) => {
        window.module = await import('/bundle.js');
        window.editors = ['one', 'two'].slice(0, count).map(id => window.module.createEditor(`#${id}`, {
            fileManager: null, explorer: null, snippets: null,
            shortcodes: {shortcodesUrl: '/api'}, buttons: ['source', 'fullsize', 'undo', 'redo'],
            sourceEditor: 'area', beautifyHTML: false, saveModeInStorage: false, history: {timeout: 10},
            ...config,
        }));
    }, {config, count});
}
async function ready() {
    await page.locator('.jodit-shortcodes-status').first().waitFor({state: 'detached'});
}
try {
    await boot({}, 2);
    await ready();
    assert.equal(requests, 1, 'Запросы редакторов должны объединяться.');
    await page.evaluate(() => window.editors[0].toggleFullSize(true));
    assert.equal(await page.evaluate(() => getComputedStyle(window.editors[0].container).position), 'absolute');
    await page.evaluate(() => window.editors[0].toggleFullSize(false));
    if (process.env.YII_VENDOR) {
        failure = true;
        await boot({defaultMode: 2});
        await page.waitForSelector('.jodit-shortcodes-status[role="alert"]');
        await page.evaluate(() => {
            const form = document.querySelector('#main');
            form.submit = () => { window.savedHtml = document.querySelector('#one').value; };
            window.jQuery(form).yiiActiveForm([], {});
            window.jQuery(form).trigger('submit');
        });
        await page.waitForFunction(() => window.jQuery('#main').data('yiiActiveForm').submitting === false);
        assert.equal(await page.evaluate(() => window.savedHtml), undefined);
        failure = false;
        await page.getByText('Повторить загрузку').click();
        await ready();
        await page.evaluate(() => {
            const mirror = document.querySelector('.jodit-source__mirror');
            mirror.value = '<img src="https://files.example.test/yii.jpg">';
            mirror.dispatchEvent(new Event('input', {bubbles: true}));
            window.jQuery('#main').trigger('submit');
        });
        await page.waitForFunction(() => window.savedHtml !== undefined);
        assert.match(await page.evaluate(() => window.savedHtml), /%files%\/yii.jpg/);
        await boot();
        await ready();
    }
    const codec = await page.evaluate(items => {
        const {ShortcodeCodec, parseShortcodes, mapSrcset, applyReplacements} = window.module;
        const c = new ShortcodeCodec(parseShortcodes({items}));
        const nested = new ShortcodeCodec(parseShortcodes({items: [...items, {shortcode: '%media%', replacement: 'https://files.example.test/media', type: 'text', description: '', example: '', reverse: {mode: 'url-prefix'}}]}));
        const same = '<p>https://files.example.test/text</p>';
        const html = '<img src="https://files.example.test/a%20b.jpg?x=1&amp;y=2#f"><a href="https://files.example.test/doc.pdf">file</a>';
        const restored = c.restore(document, html);
        const holder = document.createElement('div');
        holder.innerHTML = '<img src="%manual%/a.jpg">';
        c.decorate(holder);
        holder.querySelector('img').setAttribute('src', 'https://files.example.test/b.jpg');
        return {
            restored, idempotent: c.restore(document, restored), same: c.restore(document, same),
            foreign: c.reverse('https://files.example.test.evil/a'),
            encoded: c.reverse('https://files.example.test/%D0%B0%20b.jpg?q=%2F#x'),
            stale: c.restore(document, holder.innerHTML),
            srcset: mapSrcset('data:image/png;base64,AAAA 1x, https://files.example.test/b.jpg 2x', value => c.reverse(value)),
            longest: nested.reverse('https://files.example.test/media/a.jpg'),
            boundary: nested.reverse('https://files.example.test/media-old/a.jpg'),
            defaultPort: c.reverse('https://FILES.example.test:443/a.jpg'),
            manual: c.restore(document, '<img src="%manual%/a.jpg">'),
            noSlash: c.reverse('/a/b/c'),
            poster: c.restore(document, '<video poster="https://files.example.test/p.jpg"></video>'),
            onePass: applyReplacements('%a%', [['%a%', '%b%'], ['%b%', 'bad']]),
        };
    }, items);
    assert.match(codec.restored, /src="%files%\/a%20b.jpg\?x=1&amp;y=2#f"/);
    assert.match(codec.restored, /href="%files%\/doc.pdf"/);
    assert.equal(codec.idempotent, codec.restored);
    assert.equal(codec.same, '<p>https://files.example.test/text</p>');
    assert.equal(codec.foreign, 'https://files.example.test.evil/a');
    assert.equal(codec.encoded, '%files%/%D0%B0%20b.jpg?q=%2F#x');
    assert.match(codec.stale, /src="%files%\/b.jpg"/);
    assert.equal(codec.srcset, 'data:image/png;base64,AAAA 1x, %files%/b.jpg 2x');
    assert.equal(codec.onePass, '%b%');
    assert.equal(codec.longest, '%media%/a.jpg');
    assert.equal(codec.boundary, '%files%/media-old/a.jpg');
    assert.equal(codec.defaultPort, '%files%/a.jpg');
    assert.match(codec.manual, /%manual%\/a.jpg/);
    assert.equal(codec.noSlash, '/a/b/c');
    assert.match(codec.poster, /poster="%files%\/p.jpg"/);
    await page.evaluate(() => { window.editors[0].value = '<img src="https://files.example.test/a.jpg"><a href="https://files.example.test/doc.pdf">doc</a>'; });
    assert.match(await page.locator('#one').inputValue(), /%files%\/a.jpg/);
    await page.evaluate(() => window.editors[0].setMode(2));
    await page.waitForFunction(() => document.querySelector('.jodit-source__mirror').value.includes('%files%'));
    const source = page.locator('.jodit-source__mirror').first();
    await source.fill('<img src="https://files.example.test/b.jpg">');
    await source.dispatchEvent('input');
    await page.waitForFunction(() => document.querySelector('.jodit-source__mirror').value.includes('%files%/b.jpg'));
    assert.equal(await source.inputValue(), await page.locator('#one').inputValue(), 'Source и textarea должны совпадать.');
    await page.evaluate(() => window.editors[0].setMode(1));
    assert.equal(await page.evaluate(() => window.editors[0].editor.querySelector('img').getAttribute('src')), 'https://files.example.test/b.jpg');
    await page.evaluate(() => { const e = window.editors[0]; e.value = '<p>start</p>'; e.history.clear(); e.s.setCursorIn(e.editor, false); e.s.insertImage('https://files.example.test/new.jpg'); });
    await page.waitForTimeout(100);
    assert.match(await page.locator('#one').inputValue(), /%files%\/new.jpg/);
    await page.evaluate(() => window.editors[0].history.undo());
    assert.doesNotMatch(await page.locator('#one').inputValue(), /new.jpg/);
    await page.evaluate(() => window.editors[0].history.redo());
    assert.match(await page.locator('#one').inputValue(), /%files%\/new.jpg/);
    assert.equal(errors.length, 0, errors.join('\n'));
    failure = true;
    await boot({}, 2);
    await page.waitForFunction(() => document.querySelector('.jodit-shortcodes-status').getAttribute('role') === 'alert');
    assert.equal(await page.evaluate(() => window.editors[0].getReadOnly()), true);
    assert.equal(await page.evaluate(() => document.querySelector('#main').dispatchEvent(new Event('submit', {cancelable: true, bubbles: true}))), false);
    assert.equal(await page.evaluate(() => document.querySelector('#other').dispatchEvent(new Event('submit', {cancelable: true, bubbles: true}))), true);
    failure = false;
    await page.getByText('Повторить загрузку').first().click();
    await page.waitForFunction(() => document.querySelectorAll('.jodit-shortcodes-status').length === 1);
    assert.equal(await page.evaluate(() => document.querySelector('#main').dispatchEvent(new Event('submit', {cancelable: true, bubbles: true}))), false, 'Второй редактор пока не восстановлен.');
    await page.getByText('Повторить загрузку').last().click();
    await ready();
    assert.equal(await page.evaluate(() => document.querySelector('#main').dispatchEvent(new Event('submit', {cancelable: true, bubbles: true}))), true);
    assert.equal(await page.evaluate(() => window.editors[0].getReadOnly()), false);
    invalid = true;
    await boot();
    await page.waitForFunction(() => document.querySelector('.jodit-shortcodes-status').getAttribute('role') === 'alert');
    assert.match(await page.locator('.jodit-shortcodes-status').innerText(), /Неизвестный режим/);
    invalid = false;
    await page.getByText('Повторить загрузку').click();
    await ready();
    for (const mode of [2, 3]) {
        await boot({defaultMode: mode});
        await ready();
        await page.evaluate(() => { window.editors[0].value = '<a href="https://files.example.test/a.pdf">a</a>'; });
        await page.waitForFunction(() => document.querySelector('.jodit-source__mirror').value.includes('%files%/a.pdf'));
        assert.equal(await page.locator('.jodit-source__mirror').inputValue(), await page.locator('#one').inputValue());
        const immediate = await page.evaluate(() => {
            const mirror = document.querySelector('.jodit-source__mirror');
            mirror.focus();
            mirror.value = '<img src="https://files.example.test/immediate.jpg">';
            mirror.dispatchEvent(new Event('input', {bubbles: true}));
            document.querySelector('#main').dispatchEvent(new Event('submit', {cancelable: true, bubbles: true}));
            return {value: document.querySelector('#one').value, source: mirror.value};
        });
        assert.match(immediate.value, /%files%\/immediate.jpg/, 'Последний ввод source должен попасть в submit без ожидания debounce.');
        assert.equal(immediate.source, immediate.value);
    }
    delay = 300;
    await boot();
    assert.equal(await page.evaluate(() => window.editors[0].getReadOnly()), true);
    assert.equal(await page.evaluate(() => document.querySelector('#main').dispatchEvent(new Event('submit', {cancelable: true, bubbles: true}))), false);
    await page.evaluate(() => window.editors[0].destruct());
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.jodit-shortcodes-status').count(), 0);
    assert.equal(await page.evaluate(() => document.querySelector('#main').dispatchEvent(new Event('submit', {cancelable: true, bubbles: true}))), true);
    delay = 100;
    await boot({readonly: true});
    await ready();
    assert.equal(await page.evaluate(() => window.editors[0].getReadOnly()), true);
    await boot({shortcodes: null});
    assert.equal(await page.locator('.jodit-shortcodes-status').count(), 0);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('OK: URL/HTML codec, API dedup/retry, source/textarea, preview, undo/redo, form guards, readonly, disabled integration.');
} catch (error) {
    console.error('Browser state:', await page.evaluate(() => ({mode: window.editors?.[0]?.getMode(), value: document.querySelector('#one')?.value, source: document.querySelector('.jodit-source__mirror')?.value, status: document.querySelector('.jodit-shortcodes-status')?.textContent})).catch(() => ({})), errors);
    throw error;
} finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
