/*
 * Copyright (c) 2026 Besnovatyj. Licensed under the MIT License.
 */

/**
 * Интеграция файлового менеджера в Jodit.
 *
 * Тонкая обёртка: вся доменная логика ФМ живёт в @besnovatyj/filemanager-core,
 * здесь — только связка с Jodit (кнопка тулбара `fileManager`, открытие рантайма ФМ,
 * вставка выбранных файлов в контент редактора). Полный аналог CKEditor-адаптера
 * @besnovatyj/ckeditor5-filemanager, но под API Jodit.
 */

import {
    createApp,
    HttpClient,
    HttpFileManagerBackend,
} from '@besnovatyj/filemanager-core';
import type {
    AppConfig,
    AppRuntime,
    FileEntity,
    IFileManagerBackend,
} from '@besnovatyj/filemanager-core';
import type {JoditControl, JoditEditor} from '../jodit-types';

/**
 * Конфиг файлового менеджера, который приходит из PHP-виджета
 * (editor.options.fileManager). «Верхний» уровень — мир Jodit.
 */
export interface FileManagerConfig {
    /** URL коннектора ФМ (backend API). Обязателен. */
    fmConnector: string;
    /** Базовый URL опубликованных ресурсов ФМ (иконки типов и т.п.). */
    fmBaseUrl?: string;
    /** Виртуальный путь, открываемый при старте ФМ. */
    fmDefaultPath?: string;
    /** Доп. HTTP-заголовки (CSRF, X-Requested-With). */
    fmHeaders?: Record<string, string>;
}

/**
 * Строит контрол Jodit-кнопки `fileManager`.
 * Рантайм ФМ создаётся лениво при первом открытии и живёт до закрытия окна.
 *
 * @param fm нормализованный конфиг файлового менеджера
 * @returns описание кнопки для Jodit (options.controls.fileManager)
 */
export function createFileManagerControl(fm: FileManagerConfig): JoditControl {
    let runtime: AppRuntime | null = null;

    const open = async (editor: JoditEditor): Promise<void> => {
        // Уже открыт — второй раз не создаём.
        if (runtime) {
            return;
        }

        // Backend по коннектору. Единая точка выбора реализации.
        const backend: IFileManagerBackend = new HttpFileManagerBackend(
            new HttpClient({
                baseUrl: fm.fmConnector,
                headers: fm.fmHeaders ?? {},
            }),
        );

        const appConfig: AppConfig = {
            fmConnector: fm.fmConnector,
            fmBaseUrl: fm.fmBaseUrl ?? '/api/filemanager/',
            fmDefaultPath: fm.fmDefaultPath ?? '/',
            fmHeaders: fm.fmHeaders ?? {},

            // Пользователь выбрал файлы и нажал OK — вставляем и закрываем окно.
            onSelect: (files: FileEntity[]): void => {
                insertFiles(editor, files);
                runtime?.close('select');
            },

            // Окно закрыто изнутри (крестик, Esc, overlay) — сбрасываем ссылку.
            onClose: (): void => {
                runtime = null;
            },
        };

        // backend добавляется тут же — ровно как в CKEditor-адаптере.
        runtime = createApp({...appConfig, backend});
        await runtime.open();
    };

    return {
        name: 'fileManager',
        // Встроенная иконка Jodit.
        icon: 'image',
        tooltip: 'Файловый менеджер',
        exec: (editor: JoditEditor): void => {
            open(editor).catch((err: unknown) => {
                // Логируем и гасим рантайм, чтобы кнопка не «залипла».
                console.error('[Jodit FileManager] не удалось открыть:', err);
                runtime?.close('select');
                runtime = null;
            });
        },
    };
}

/**
 * Вставка выбранных файлов в контент Jodit.
 * Картинки — как <img>, остальное — как ссылка. Поддерживается мультивыбор.
 */
function insertFiles(editor: JoditEditor, files: FileEntity[]): void {
    if (!files?.length) {
        return;
    }

    for (const file of files) {
        // url: string | null по контракту FileDto (null — у mount нет публичной отдачи).
        const url = file?.url;
        if (!url) {
            continue;
        }

        const isImage =
            typeof file?.isImage === 'function' ? file.isImage() : false;

        if (isImage) {
            editor.selection.insertImage(url);
        } else {
            editor.selection.insertHTML(
                `<a href="${escapeAttr(url)}">${escapeHtml(url)}</a>`,
            );
        }
    }
}

/** Экранирование значения для HTML-атрибута. */
function escapeAttr(value: string): string {
    return value.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Экранирование текстового содержимого. */
function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
