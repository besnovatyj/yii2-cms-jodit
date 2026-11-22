/*
 * Copyright (c) 2026 Besnovatyj. Licensed under the MIT License.
 */

import type {ShortcodesConfig} from '../shortcodes';
import {parsePrefix} from './values';

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

    const items = payload.items.map(readShortcode);
    checkUniqueRules(items);
    return items;
}

function readShortcode(entry: unknown): ShortcodeDto {
    if (!entry || typeof entry !== 'object') {
        throw new Error('Некорректное определение шорткода.');
    }
    const {shortcode, type, description, example, replacement} = entry as Record<string, unknown>;
    if (typeof shortcode !== 'string' || typeof description !== 'string' ||
        typeof example !== 'string' || typeof replacement !== 'string') {
        throw new Error('Некорректные поля определения шорткода.');
    }
    if (type !== 'text' && type !== 'widget') {
        throw new Error('Неизвестный тип шорткода.');
    }

    const namePattern = type === 'text' ? /^%[A-Za-z0-9_]+%$/ : /^[A-Za-z0-9_]+$/;
    if (!namePattern.test(shortcode)) {
        throw new Error('Некорректное имя шорткода.');
    }
    if (type === 'text' && /%[A-Za-z0-9_]+%/.test(replacement)) {
        throw new Error('Вложенные текстовые шорткоды не поддерживаются.');
    }

    const mode = readReverseMode(entry);
    if (mode === 'url-prefix' && type !== 'text') {
        throw new Error('Обратное преобразование разрешено только текстовым шорткодам.');
    }
    return {shortcode, type, description, example, replacement, reverse: {mode}};
}

/** Старый API не передаёт режим обратного преобразования. */
function readReverseMode(entry: object): ShortcodeDto['reverse']['mode'] {
    if (!('reverse' in entry)) return 'none';
    const reverse = entry.reverse;
    if (!reverse || typeof reverse !== 'object' || !('mode' in reverse) ||
        (reverse.mode !== 'none' && reverse.mode !== 'url-prefix')) {
        throw new Error('Неизвестный режим обратного преобразования.');
    }
    return reverse.mode;
}

function checkUniqueRules(items: readonly ShortcodeDto[]): void {
    const names = new Set<string>();
    const prefixes = new Set<string>();
    for (const item of items) {
        if (names.has(item.shortcode)) {
            throw new Error('Повторное имя шорткода.');
        }
        names.add(item.shortcode);
        if (item.reverse.mode !== 'url-prefix') continue;

        const prefix = parsePrefix(item.replacement).key;
        if (prefixes.has(prefix)) {
            throw new Error('Одинаковый URL-префикс у разных шорткодов.');
        }
        prefixes.add(prefix);
    }
}

/** Загрузка списка шорткодов с сервера (с кэшем на время жизни страницы). */
export function loadShortcodes(config: ShortcodesConfig): Promise<ShortcodeDto[]> {
    const headers = new Headers({Accept: 'application/json', ...config.shortcodesHeaders});
    const key = JSON.stringify([config.shortcodesUrl, [...headers.entries()]]);
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
