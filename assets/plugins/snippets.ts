/*
 * Copyright (c) 2026 Besnovatyj. Licensed under the MIT License.
 */

/**
 * Интеграция пикера сниппетов в Jodit.
 *
 * Тонкая обёртка: весь пикер (загрузка дерева, UI, поиск/превью) живёт в
 * @besnovatyj/snippets-core, здесь — только связка с Jodit (кнопка тулбара `snippets`,
 * открытие рантайма ядра, вставка выбранного HTML в контент редактора). Полный аналог
 * интеграции файлового менеджера {@link ./fileManager}, но под пикер сниппетов.
 */

import {createSnippetPicker} from '@besnovatyj/snippets-core';
import type {SnippetPickerRuntime} from '@besnovatyj/snippets-core';
import type {IJodit, IControlType} from 'jodit';

/**
 * Конфиг сниппетов, приходящий из PHP-виджета (editor.options.snippets).
 * «Верхний» уровень — мир Jodit.
 */
export interface SnippetsConfig {
    /** URL эндпоинта дерева сниппетов (backend API). Обязателен. */
    snippetsUrl: string;
    /** Доп. HTTP-заголовки (CSRF, X-Requested-With). */
    snippetsHeaders?: Record<string, string>;
    /** Заголовок окна пикера. */
    snippetsTitle?: string;
}

/**
 * Строит контрол Jodit-кнопки `snippets`.
 * Рантайм пикера создаётся лениво при первом открытии и живёт до закрытия окна.
 *
 * @param sn нормализованный конфиг сниппетов
 * @returns описание кнопки для Jodit (options.controls.snippets)
 */
export function createSnippetsControl(sn: SnippetsConfig): IControlType<IJodit> {
    let runtime: SnippetPickerRuntime | null = null;

    const open = async (editor: IJodit): Promise<void> => {
        // Уже открыт — второй раз не создаём.
        if (runtime) {
            return;
        }

        runtime = createSnippetPicker({
            snippetsUrl: sn.snippetsUrl,
            headers: sn.snippetsHeaders ?? {},
            title: sn.snippetsTitle,

            // Пользователь выбрал сниппет — вставляем HTML в контент.
            // Закрытие окна выполняет сам рантайм ядра (затем сработает onClose).
            onSelect: (html: string): void => {
                editor.selection.insertHTML(html);
            },

            // Окно закрыто (выбор, крестик, Esc, backdrop) — сбрасываем ссылку.
            onClose: (): void => {
                runtime = null;
            },
        });

        await runtime.open();
    };

    return {
        name: 'snippets',
        // Встроенная иконка Jodit.
        icon: 'paste',
        tooltip: 'Сниппеты',
        exec: (editor: IJodit): void => {
            open(editor).catch((err: unknown) => {
                // Логируем и гасим рантайм, чтобы кнопка не «залипла».
                console.error('[Jodit Snippets] не удалось открыть:', err);
                runtime = null;
            });
        },
    };
}
