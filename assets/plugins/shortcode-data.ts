/*
 * Copyright (c) 2026 Besnovatyj. Licensed under the MIT License.
 */

import type {ShortcodesConfig} from './shortcodes';
import {parsePrefix} from './shortcode-values';

/** Элемент ответа эндпоинта — зеркало ApiController::itemToArray(). */
export interface ShortcodeDto {
    shortcode: string;
    type: 'text' | 'widget';
    description: string;
    example: string;
    replacement: string;
    reverse: {mode: 'none' | 'url-prefix'};
}

/** Ответ после проверки структуры на границе HTTP. */
export interface ShortcodesResponse {items: ShortcodeDto[]}

/**
 * Кэш ответа на время жизни страницы, общий для всех редакторов: список меняется редко,
 * а на странице может быть несколько инстансов Jodit — незачем ходить на сервер за каждый.
 */
const pending = new Map<string, Promise<ShortcodeDto[]>>();

/** Проверяет недоверенный JSON, не принимая ошибки структуры за пустой список. */
export function parseShortcodes(payload: unknown): ShortcodeDto[] {
    if (!payload || typeof payload !== 'object' || !('items' in payload) || !Array.isArray(payload.items)) {
        throw new Error('Некорректный ответ API шорткодов.');
    }
    const names = new Set<string>();
    const prefixes = new Set<string>();
    return payload.items.map((entry: unknown): ShortcodeDto => {
        if (!entry || typeof entry !== 'object') throw new Error('Некорректное определение шорткода.');
        const item = entry as Record<string, unknown>;
        for (const field of ['shortcode', 'type', 'description', 'example', 'replacement']) {
            if (typeof item[field] !== 'string') throw new Error(`Некорректное поле ${field} шорткода.`);
        }
        const {shortcode, type, description, example, replacement} = item as Record<string, string>;
        if ((type !== 'text' && type !== 'widget') ||
            !(type === 'text' ? /^%[A-Za-z0-9_]+%$/ : /^[A-Za-z0-9_]+$/).test(shortcode) || names.has(shortcode)) {
            throw new Error('Некорректное или повторное имя шорткода.');
        }
        names.add(shortcode);
        let mode: 'none' | 'url-prefix' = 'none';
        if ('reverse' in item) {
            if (!item.reverse || typeof item.reverse !== 'object' || !('mode' in item.reverse) ||
                (item.reverse.mode !== 'none' && item.reverse.mode !== 'url-prefix')) {
                throw new Error('Неизвестный режим обратного преобразования.');
            }
            mode = item.reverse.mode;
        }
        if (type === 'text' && /%[A-Za-z0-9_]+%/.test(replacement)) {
            throw new Error('Вложенные текстовые шорткоды не поддерживаются.');
        }
        if (mode === 'url-prefix') {
            if (type !== 'text') throw new Error('Reverse разрешён только текстовым шорткодам.');
            const prefix = parsePrefix(replacement);
            if (prefixes.has(prefix.key)) throw new Error('Одинаковый URL-префикс у разных шорткодов.');
            prefixes.add(prefix.key);
        }
        return {shortcode, type, description, example, replacement, reverse: {mode}};
    });
}

/** Загрузка списка шорткодов с сервера (с кэшем на время жизни страницы). */
export function loadShortcodes(config: ShortcodesConfig): Promise<ShortcodeDto[]> {
    const headers = new Headers({Accept: 'application/json', ...config.shortcodesHeaders});
    const key = JSON.stringify([config.shortcodesUrl, [...headers.entries()].sort(([a], [b]) => a.localeCompare(b))]);
    const cached = pending.get(key);
    if (cached) return cached;
    const request = fetch(config.shortcodesUrl, {method: 'GET', credentials: 'same-origin', headers})
        .then(async response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return parseShortcodes(await response.json());
        }).catch((error: unknown) => {
            pending.delete(key);
            throw error;
        });
    pending.set(key, request);
    return request;
}
