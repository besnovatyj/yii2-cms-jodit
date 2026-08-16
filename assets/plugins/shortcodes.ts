/*
 * Copyright (c) 2026 Besnovatyj. Licensed under the MIT License.
 */

/**
 * Интеграция пикера шорткодов в Jodit.
 *
 * Устроено как {@link ./snippets} и {@link ./fileManager} — кнопка тулбара `shortcodes`,
 * своё окно, вставка в контент редактора. Отличие в том, что отдельного npm-ядра здесь нет:
 * данные плоские (имя, тип, описание, готовый пример), вставляется строка текста, а UI — один
 * список с поиском. Тащить ради этого пакет уровня @besnovatyj/snippets-core незачем, поэтому
 * пикер целиком живёт в этом файле.
 *
 * Источник данных — JSON-эндпоинт модуля шорткодов
 * ({@link \Besnovatyj\Shortcode\controllers\backend\ApiController::actionList()}).
 */

import {Jodit} from 'jodit';
import type {JoditControl, JoditEditor} from '../jodit-types';

/**
 * Иконка кнопки. Регистрируем собственную SVG под именем `shortcodes`, а НЕ ссылаемся на
 * встроенное имя: не всякое встроенное имя присутствует в загруженном наборе иконок — тогда
 * кнопка рендерится пустой (см. тот же комментарий в интеграции сниппетов).
 */
const SHORTCODES_ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M9.5 4C7.5 4 7 5 7 7v1.5C7 10 6 11 5 11.5c1 .5 2 1.5 2 3V16c0 2 .5 3 2.5 3" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M14.5 4c2 0 2.5 1 2.5 3v1.5c0 1.5 1 2.5 2 3-1 .5-2 1.5-2 3V16c0 2-.5 3-2.5 3" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

Jodit.modules.Icon.set('shortcodes', SHORTCODES_ICON);

/**
 * Конфиг шорткодов, приходящий из PHP-виджета (editor.options.shortcodes).
 * «Верхний» уровень — мир Jodit.
 */
export interface ShortcodesConfig {
    /** URL эндпоинта списка шорткодов (backend API). Обязателен. */
    shortcodesUrl: string;
    /** Доп. HTTP-заголовки (CSRF, X-Requested-With). */
    shortcodesHeaders?: Record<string, string>;
    /** Заголовок окна пикера. */
    shortcodesTitle?: string;
}

/** Элемент ответа эндпоинта — зеркало ApiController::itemToArray(). */
interface ShortcodeDto {
    shortcode: string;
    type: string;
    description: string;
    example: string;
    replacement: string;
}

/** Тип шорткода в терминах модуля ({@link \Besnovatyj\Shortcode\entities\Shortcode}). */
const TYPE_WIDGET = 'widget';

/** Значение фильтра по типу: пустая строка — «все». */
type TypeFilter = string;

/**
 * Кэш ответа на время жизни страницы, общий для всех редакторов: список меняется редко,
 * а на странице может быть несколько инстансов Jodit — незачем ходить на сервер за каждый.
 */
const cacheByUrl = new Map<string, ShortcodeDto[]>();

const STYLE_ID = 'jodit-shortcodes-styles';

/**
 * Стили пикера. Держим строкой и вставляем один раз: так плагин остаётся самодостаточным
 * (импорт .css из TS потребовал бы объявления модуля ради `tsc --noEmit`).
 */
const STYLES = `
.jodit-shortcodes { display: flex; flex-direction: column; height: 100%; font-size: 13px; }
.jodit-shortcodes__toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
    padding: 8px 10px; border-bottom: 1px solid rgba(128,128,128,.25); }
.jodit-shortcodes__search { flex: 1 1 200px; min-width: 160px; padding: 5px 8px;
    border: 1px solid rgba(128,128,128,.4); border-radius: 4px; background: transparent;
    color: inherit; font: inherit; }
.jodit-shortcodes__filter { display: flex; gap: 4px; }
.jodit-shortcodes__filter button { padding: 4px 10px; border: 1px solid rgba(128,128,128,.4);
    border-radius: 4px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.jodit-shortcodes__filter button[aria-pressed="true"] { background: rgba(128,128,128,.25); }
.jodit-shortcodes__list { flex: 1 1 auto; overflow-y: auto; padding: 8px 10px; }
.jodit-shortcodes__item { display: block; width: 100%; text-align: left; margin-bottom: 6px;
    padding: 8px 10px; border: 1px solid rgba(128,128,128,.3); border-radius: 4px;
    background: transparent; color: inherit; font: inherit; cursor: pointer; }
.jodit-shortcodes__item:hover, .jodit-shortcodes__item:focus-visible {
    border-color: currentColor; background: rgba(128,128,128,.12); }
.jodit-shortcodes__head { display: flex; align-items: center; gap: 8px; }
.jodit-shortcodes__name { font-family: monospace; font-weight: 700; }
.jodit-shortcodes__type { padding: 1px 6px; border-radius: 10px; font-size: 11px;
    border: 1px solid rgba(128,128,128,.5); opacity: .8; }
.jodit-shortcodes__desc { display: block; margin-top: 4px; }
.jodit-shortcodes__example { display: block; margin-top: 5px; padding: 5px 7px; border-radius: 3px;
    background: rgba(128,128,128,.14); font-family: monospace; font-size: 12px;
    white-space: pre-wrap; word-break: break-word; max-height: 5.5em; overflow: hidden; }
.jodit-shortcodes__replacement { display: block; margin-top: 4px; font-family: monospace;
    font-size: 10.5px; opacity: .6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jodit-shortcodes__empty { padding: 16px; text-align: center; opacity: .7; }
.jodit-shortcodes__hint { padding: 6px 10px; border-top: 1px solid rgba(128,128,128,.25);
    font-size: 11px; opacity: .7; }
`;

/**
 * Строит контрол Jodit-кнопки `shortcodes`.
 * Список загружается лениво при первом открытии и дальше берётся из кэша.
 *
 * @param sc нормализованный конфиг шорткодов
 * @returns описание кнопки для Jodit (options.controls.shortcodes)
 */
export function createShortcodesControl(sc: ShortcodesConfig): JoditControl {
    let dialog: ReturnType<JoditEditor['dlg']> | null = null;

    const open = async (editor: JoditEditor): Promise<void> => {
        // Уже открыт — второй раз не создаём.
        if (dialog) {
            return;
        }

        const items = await load(sc);

        ensureStyles(editor.od);

        const dlg = editor.dlg({
            resizable: true,
            draggable: true,
            closeOnEsc: true,
            closeOnClickOverlay: true,
        });
        dialog = dlg;

        // Окно закрыто (выбор, крестик, Esc, оверлей) — сбрасываем ссылку.
        // Событие приходит на самом диалоге, поэтому подписка объектная.
        dlg.e.on(dlg, 'afterClose', (): void => {
            dialog = null;
        });

        dlg.setHeader(sc.shortcodesTitle ?? 'Шорткоды');
        dlg.setContent(buildPicker(editor.od, items, (item: ShortcodeDto): void => {
            insert(editor, item.example);
            dlg.close();
        }));
        dlg.setSize(720, 520);
        dlg.open(true, true);
    };

    return {
        name: 'shortcodes',
        // Своя зарегистрированная иконка (см. Icon.set выше) — не встроенное имя Jodit.
        icon: 'shortcodes',
        tooltip: 'Шорткоды',
        exec: (editor: JoditEditor): void => {
            open(editor).catch((err: unknown) => {
                // Логируем, гасим окно, чтобы кнопка не «залипла», и говорим об этом пользователю.
                console.error('[Jodit Shortcodes] не удалось открыть:', err);
                dialog = null;
                editor.alert('Не удалось загрузить список шорткодов.', 'Шорткоды');
            });
        },
    };
}

/**
 * Загрузка списка шорткодов с сервера (с кэшем на время жизни страницы).
 */
async function load(sc: ShortcodesConfig): Promise<ShortcodeDto[]> {
    const cached = cacheByUrl.get(sc.shortcodesUrl);
    if (cached) {
        return cached;
    }

    const response = await fetch(sc.shortcodesUrl, {
        method: 'GET',
        credentials: 'same-origin',
        headers: {Accept: 'application/json', ...(sc.shortcodesHeaders ?? {})},
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as Partial<{items: ShortcodeDto[]}>;
    const items = Array.isArray(payload.items) ? payload.items : [];

    cacheByUrl.set(sc.shortcodesUrl, items);

    return items;
}

/**
 * Вставка шорткода в контент.
 *
 * Именно текстовым узлом, а не insertHTML: пример — это разметка шорткода, а не HTML,
 * и парсер редактора не должен её интерпретировать или «чинить».
 */
function insert(editor: JoditEditor, example: string): void {
    editor.s.focus();
    editor.s.insertNode(editor.createInside.text(example));
}

/**
 * Разметка пикера: поиск, фильтр по типу и список карточек.
 * Собирается через DOM API (без innerHTML) — данные приходят с сервера и попадают в текстовые узлы.
 *
 * @param doc   документ, которому принадлежит окно
 * @param items полный список шорткодов
 * @param onPick обработчик выбора шорткода
 */
function buildPicker(
    doc: Document,
    items: ShortcodeDto[],
    onPick: (item: ShortcodeDto) => void,
): HTMLElement {
    const root = doc.createElement('div');
    root.className = 'jodit-shortcodes';

    const toolbar = doc.createElement('div');
    toolbar.className = 'jodit-shortcodes__toolbar';

    const search = doc.createElement('input');
    search.type = 'search';
    search.className = 'jodit-shortcodes__search';
    search.placeholder = 'Поиск по имени, описанию, примеру…';

    const filter = doc.createElement('div');
    filter.className = 'jodit-shortcodes__filter';

    const list = doc.createElement('div');
    list.className = 'jodit-shortcodes__list';

    const empty = doc.createElement('div');
    empty.className = 'jodit-shortcodes__empty';
    empty.textContent = 'Ничего не найдено.';
    empty.hidden = true;

    const hint = doc.createElement('div');
    hint.className = 'jodit-shortcodes__hint';
    hint.textContent = 'Клик по шорткоду вставляет его пример в позицию курсора.';

    let typeFilter: TypeFilter = '';

    const rows = items.map((item) => ({
        item,
        haystack: [item.shortcode, item.description, item.example, item.replacement]
            .join(' ')
            .toLowerCase(),
        element: buildRow(doc, item, onPick),
    }));

    for (const row of rows) {
        list.appendChild(row.element);
    }

    const applyFilter = (): void => {
        const query = search.value.trim().toLowerCase();
        let visible = 0;

        for (const row of rows) {
            const matchesType = typeFilter === '' || row.item.type === typeFilter;
            const matchesQuery = query === '' || row.haystack.includes(query);
            const show = matchesType && matchesQuery;

            row.element.hidden = !show;
            if (show) {
                visible += 1;
            }
        }

        empty.hidden = visible > 0;
    };

    for (const [value, label] of [['', 'Все'], [TYPE_WIDGET, 'Виджеты'], ['text', 'Текстовые']]) {
        const button = doc.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.setAttribute('aria-pressed', value === '' ? 'true' : 'false');
        button.addEventListener('click', (): void => {
            typeFilter = value;
            for (const other of filter.querySelectorAll('button')) {
                other.setAttribute('aria-pressed', other === button ? 'true' : 'false');
            }
            applyFilter();
        });
        filter.appendChild(button);
    }

    search.addEventListener('input', applyFilter);

    toolbar.appendChild(search);
    toolbar.appendChild(filter);
    root.appendChild(toolbar);
    root.appendChild(list);
    root.appendChild(empty);
    root.appendChild(hint);

    // Фокус в поиске сразу после открытия — типичный сценарий «пришёл за конкретным шорткодом».
    setTimeout(() => search.focus(), 0);

    if (rows.length === 0) {
        empty.textContent = 'Шорткоды не заведены.';
        empty.hidden = false;
    }

    return root;
}

/**
 * Карточка одного шорткода: имя, тип, описание, пример вставки и — мелко — чем заменяется.
 */
function buildRow(
    doc: Document,
    item: ShortcodeDto,
    onPick: (item: ShortcodeDto) => void,
): HTMLElement {
    const row = doc.createElement('button');
    row.type = 'button';
    row.className = 'jodit-shortcodes__item';
    row.title = 'Вставить пример в позицию курсора';

    const head = doc.createElement('span');
    head.className = 'jodit-shortcodes__head';

    const name = doc.createElement('span');
    name.className = 'jodit-shortcodes__name';
    name.textContent = item.shortcode;

    const type = doc.createElement('span');
    type.className = 'jodit-shortcodes__type';
    type.textContent = item.type === TYPE_WIDGET ? 'виджет' : 'текст';

    head.appendChild(name);
    head.appendChild(type);
    row.appendChild(head);

    if (item.description !== '') {
        const description = doc.createElement('span');
        description.className = 'jodit-shortcodes__desc';
        description.textContent = item.description;
        row.appendChild(description);
    }

    const example = doc.createElement('code');
    example.className = 'jodit-shortcodes__example';
    example.textContent = item.example;
    row.appendChild(example);

    const replacement = doc.createElement('span');
    replacement.className = 'jodit-shortcodes__replacement';
    replacement.textContent = item.replacement;
    row.appendChild(replacement);

    row.addEventListener('click', (): void => onPick(item));

    return row;
}

/**
 * Однократная вставка стилей пикера в документ окна.
 */
function ensureStyles(doc: Document): void {
    if (doc.getElementById(STYLE_ID)) {
        return;
    }

    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLES;
    doc.head.appendChild(style);
}
