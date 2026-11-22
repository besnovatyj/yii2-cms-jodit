/*
 * Copyright (c) 2026 Besnovatyj. Licensed under the MIT License.
 */

import type {ShortcodeDto} from './catalog';

/** Пары «шорткод → замена» для превью. */
export type TextReplacements = ReadonlyArray<readonly [string, string]>;

/**
 * Атрибуты, в которых текстовые шорткоды подменяются на время показа в WYSIWYG.
 * Только те, от которых зависит отображение (картинка, видео-постер, srcset);
 * в тексте шорткод остаётся как есть — так его видно и можно править.
 */
// Дополнительно поддерживается href; имена конкретных шорткодов здесь неизвестны.
const ATTRIBUTES = ['src', 'href', 'poster', 'srcset'] as const;
/** Префикс атрибута-метки, хранящего исходное значение с шорткодом. */
const MARKER = 'data-jodit-shortcode-';

/** Разобранный префикс с исходным, не пересериализованным путём. */
export interface UrlPrefix {
    origin: string;
    path: string;
    key: string;
}

/** Проверяет HTTP(S)-префикс без преобразования исходного пути. */
export function parsePrefix(value: string): UrlPrefix {
    const match = /^(https?):\/\/([^/?#]+)([^?#]*)$/i.exec(value);
    if (!match || /[\x00-\x20\x7f\\]/.test(value) || /%[A-Za-z0-9_]+%/.test(value)) {
        throw new Error('Ожидается абсолютный HTTP(S)-префикс без query и fragment.');
    }
    const url = new URL(value);
    if (url.username || url.password || /[^\x21-\x7e]/.test(match[2]) || match[2].includes('%') ||
        /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i.test(match[3])) {
        throw new Error('Некорректный URL-префикс.');
    }
    // Не разрешаем неканонические числовые хосты, которые WHATWG URL переписывает.
    const authority = match[2].toLowerCase().replace(/:(80|443)$/, (port) =>
        (match[1].toLowerCase() === 'http' && port === ':80') ||
        (match[1].toLowerCase() === 'https' && port === ':443') ? '' : port);
    if (url.host !== authority) {
        throw new Error('Используйте каноническое имя хоста и порт.');
    }
    return {origin: url.origin, path: match[3], key: `${url.origin}${match[3]}`};
}

/** Готовит одношаговую подстановку без повторного раскрытия результата. */
function compileReplacements(replacements: TextReplacements): (value: string) => string {
    const map = new Map(replacements);
    if (map.size === 0) return value => value;
    const pattern = new RegExp([...map.keys()].join('|'), 'g');
    return value => value.replace(pattern, token => map.get(token) ?? token);
}

/** Замена всех вхождений каждого шорткода за один проход. */
export function applyReplacements(value: string, replacements: TextReplacements): string {
    return compileReplacements(replacements)(value);
}

/** Правила отсортированы по длине пути; неоднозначность проверяется при загрузке. */
export class ShortcodeCodec {
    private readonly expand: (value: string) => string;
    private readonly rules: Array<{shortcode: string; prefix: UrlPrefix}>;

    constructor(items: ReadonlyArray<ShortcodeDto>) {
        this.expand = compileReplacements(items.filter(item => item.type === 'text')
            .map(item => [item.shortcode, item.replacement]));
        this.rules = items.filter(item => item.reverse.mode === 'url-prefix')
            .map(item => ({shortcode: item.shortcode, prefix: parsePrefix(item.replacement)}))
            .sort((a, b) => b.prefix.path.length - a.prefix.path.length);
    }

    /** Создаёт только один токен и оставляет исходный остаток URL без перекодирования. */
    reverse(value: string): string {
        if (/[\x00-\x20\x7f\\]/.test(value)) {
            return value;
        }
        const match = /^(https?):\/\/([^/?#]+)([^?#]*)([?#].*)?$/i.exec(value);
        if (!match) {
            return value;
        }
        let url: URL;
        try {
            url = new URL(value);
        } catch {
            return value;
        }
        if (url.username || url.password) {
            return value;
        }
        for (const {shortcode, prefix} of this.rules) {
            const path = match[3];
            if (url.origin !== prefix.origin || !path.startsWith(prefix.path)) {
                continue;
            }
            const suffix = path.slice(prefix.path.length);
            if (prefix.path !== '' && !prefix.path.endsWith('/') && suffix !== '' && !suffix.startsWith('/')) {
                continue;
            }
            return shortcode + suffix + (match[4] ?? '');
        }
        return value;
    }

    /**
     * Подставляет замены в атрибуты превью и запоминает исходные значения в метках.
     * Уже декорированные атрибуты не трогает: их значение шорткодов не содержит.
     */
    decorate(root: HTMLElement | undefined): void {
        if (!root) {
            return;
        }
        for (const attr of ATTRIBUTES) {
            for (const element of root.querySelectorAll(`[${attr}*="%"]`)) {
                const original = element.getAttribute(attr) ?? '';
                const shown = this.expand(original);
                if (shown !== original) {
                    element.setAttribute(MARKER + attr, original);
                    element.setAttribute(attr, shown);
                }
            }
        }
    }

    /**
     * Возвращает шорткоды в HTML, отдаваемом наружу, и снимает метки.
     * Быстрый выход без парсинга, если меток нет, — метод зовётся на каждую синхронизацию.
     */
    // Теперь без меток также проверяются новые абсолютные URL для reverse.
    restore(doc: Document, html: string): string {
        if (!html.includes(MARKER) && (this.rules.length === 0 || !/https?:\/\//i.test(html))) {
            return html;
        }
        const template = doc.createElement('template');
        template.innerHTML = html;
        let changed = false;
        for (const attr of ATTRIBUTES) {
            const marker = MARKER + attr;
            for (const element of template.content.querySelectorAll(`[${attr}], [${marker}]`)) {
                const current = element.getAttribute(attr);
                let value = current;
                const original = element.getAttribute(marker);
                if (original !== null) {
                    element.removeAttribute(marker);
                    changed = true;
                    // Атрибут не меняли (в нём ровно наше превью) — возвращаем шорткод.
                    // Поменяли (другая картинка через диалог) — оставляем новое значение.
                    if (current === this.expand(original)) {
                        value = original;
                    }
                }
                if (value === null) {
                    continue;
                }
                const restored = attr === 'srcset' ? mapSrcset(value, url => this.reverse(url)) : this.reverse(value);
                if (restored !== current) {
                    element.setAttribute(attr, restored);
                    changed = true;
                }
            }
        }
        return changed ? template.innerHTML : html;
    }
}

/**
 * Разбирает URL-кандидаты srcset, сохраняя все разделители и дескрипторы.
 * URL читается до пробела (запятые внутри data: допустимы); завершающая запятая отделяет кандидата.
 */
export function mapSrcset(value: string, transform: (url: string) => string): string {
    let result = '';
    let cursor = 0;
    while (cursor < value.length) {
        const start = cursor;
        while (cursor < value.length && /[\t\n\f\r ,]/.test(value[cursor])) cursor++;
        result += value.slice(start, cursor);
        const urlStart = cursor;
        while (cursor < value.length && !/[\t\n\f\r ]/.test(value[cursor])) cursor++;
        let urlEnd = cursor;
        while (urlEnd > urlStart && value[urlEnd - 1] === ',') urlEnd--;
        result += transform(value.slice(urlStart, urlEnd)) + value.slice(urlEnd, cursor);
        if (urlEnd !== cursor) continue;
        const descriptorStart = cursor;
        let parentheses = 0;
        while (cursor < value.length) {
            const char = value[cursor++];
            if (char === '(') parentheses++;
            if (char === ')') parentheses = Math.max(0, parentheses - 1);
            if (char === ',' && parentheses === 0) break;
        }
        result += value.slice(descriptorStart, cursor);
    }
    return result;
}
