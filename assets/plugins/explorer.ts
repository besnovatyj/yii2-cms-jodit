/*
 * Copyright (c) 2026 Besnovatyj. Licensed under the MIT License.
 */

/**
 * Интеграция файлового менеджера v2 («проводник», @besnovatyj/filemanager-core2) в Jodit.
 *
 * Тонкая обёртка: кнопка тулбара `explorer` открывает проводник в режиме picker; выбранные файлы
 * вставляются в контент (изображения — `<img>`, остальное — `<a>`). Живёт рядом с плагином v1
 * (`fileManager.ts`) под отдельной кнопкой, пока v1 не выведен из эксплуатации.
 */

import {createExplorer, isImage} from '@besnovatyj/filemanager-core2';
import type {Explorer, Node} from '@besnovatyj/filemanager-core2';
import {Jodit} from 'jodit';
import type {JoditControl, JoditEditor} from '../jodit-types';

/**
 * Своя SVG-иконка под именем `explorer` — встроенные имена Jodit могут отсутствовать в
 * загруженном наборе, и кнопка тогда рендерится пустой (см. snippets.ts).
 */
const EXPLORER_ICON =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" ' +
    'stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
    '<path d="M3 10h18" stroke="currentColor" stroke-width="2"/>' +
    '</svg>';

Jodit.modules.Icon.set('explorer', EXPLORER_ICON);

/**
 * Конфиг проводника из PHP-виджета (editor.options.explorer). «Верхний» уровень — мир Jodit.
 */
export interface ExplorerPluginConfig {
    /** Базовый URL API bescms-fs (/File/backend/api). Обязателен. */
    connector: string;
    /** Виртуальный путь при открытии. */
    startPath?: string;
    /** Доп. HTTP-заголовки (CSRF, X-Requested-With). */
    headers?: Record<string, string>;
    /** Заголовок окна. */
    title?: string;
    /** Ключ localStorage для настроек вида. */
    storageKey?: string | null;
    /** Тема: 'light' | 'dark'; отсутствует — по системной. */
    theme?: 'light' | 'dark';
    /** Разрешить выбор нескольких файлов за раз. */
    pickMultiple?: boolean;
    /** Область видимости: корень + подписанный сервером токен (см. JoditWidget::$explorerScoped). */
    scope?: {root: string; token?: string};
}

/**
 * Строит контрол Jodit-кнопки `explorer`.
 * Рантайм проводника создаётся на каждое открытие и уничтожается при закрытии (ядро само
 * освобождает ресурсы через onClose), поэтому у нескольких редакторов на странице нет общего состояния.
 */
export function createExplorerControl(cfg: ExplorerPluginConfig): JoditControl {
    let explorer: Explorer | null = null;

    const open = async (editor: JoditEditor): Promise<void> => {
        if (explorer) {
            return; // уже открыт
        }
        // Курсор редактора должен быть сохранён до открытия модального окна — иначе вставка
        // после возврата фокуса уйдёт не туда.
        editor.selection.save();

        explorer = createExplorer({
            connector: cfg.connector,
            headers: cfg.headers ?? {},
            startPath: cfg.startPath ?? '/',
            mode: 'picker',
            pickMultiple: cfg.pickMultiple ?? true,
            ...(cfg.title ? {title: cfg.title} : {}),
            ...(cfg.storageKey !== undefined ? {storageKey: cfg.storageKey} : {}),
            ...(cfg.scope ? {scope: cfg.scope} : {}),
            onPick: (nodes: Node[]): void => {
                editor.selection.restore();
                insertNodes(editor, nodes);
            },
            onClose: (): void => {
                explorer = null;
                editor.selection.restore();
            },
        });
        if (cfg.theme) {
            explorer.element.dataset.theme = cfg.theme;
        }
        await explorer.open();
    };

    return {
        name: 'explorer',
        icon: 'explorer',
        tooltip: 'Проводник',
        exec: (editor: JoditEditor): void => {
            open(editor).catch((err: unknown) => {
                console.error('[Jodit Explorer] не удалось открыть:', err);
                explorer?.destroy();
                explorer = null;
            });
        },
    };
}

/**
 * Вставка выбранных узлов: изображения — `<img>`, остальные файлы — ссылка с именем файла.
 * Узлы без публичного URL (хранилище без отдачи наружу, например ZIP) пропускаются с
 * предупреждением: в контент сайта такую ссылку вставить нельзя.
 */
function insertNodes(editor: JoditEditor, nodes: Node[]): void {
    for (const node of nodes) {
        if (!node.url) {
            console.warn('[Jodit Explorer] у файла нет публичного URL, пропущен:', node.path);
            continue;
        }
        if (isImage(node)) {
            editor.selection.insertImage(node.url);
        } else {
            editor.selection.insertHTML(
                `<a href="${escapeAttr(node.url)}">${escapeHtml(node.name)}</a>`,
            );
        }
    }
}

function escapeAttr(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
