/*
 * Copyright (c) 2026 Besnovatyj. Licensed under the MIT License.
 */

/**
 * Entry-модуль виджета Jodit.
 *
 * Экспортирует единственную фабрику {@link createEditor}, которую вызывает PHP-виджет
 * {@link \Besnovatyj\Jodit\JoditWidget}. Внутрь бандла вшиты сам Jodit, его CSS и
 * интеграция файлового менеджера. На странице подключается динамическим import().
 */

import {Jodit} from 'jodit';
import type {IJodit} from 'jodit';

// ВАЖНО: главный вход 'jodit' (esm/index.js) регистрирует лишь УРЕЗАННЫЙ core-набор
// плагинов — без source (HTML-исходник), resizer (маркеры ресайза картинок), fullsize,
// align, paste-from-word и др. Их кнопки рендерятся, но молча не работают.
// Полный набор — plugins/all.js (аналог «fat»-сборки). Подключаем явно.
import 'jodit/esm/plugins/all.js';

// CSS «fat»-сборки — стили под весь набор плагинов (resizer, попапы, source, диалоги).
// esbuild вынесет его в dist/jodit-widget.css (публикуется AssetBundle-ом).
import 'jodit/es2021/jodit.fat.min.css';

import {createFileManagerControl} from './plugins/fileManager';
import type {FileManagerConfig} from './plugins/fileManager';

/** Опции Jodit (частичный Config) + наш блок fileManager. */
export type JoditWidgetConfig = Record<string, unknown> & {
    /** Конфиг файлового менеджера. Если нет fmConnector — кнопка не регистрируется. */
    fileManager?: FileManagerConfig | null;
};

/** Реестр созданных редакторов для отладки/доступа снаружи. */
declare global {
    interface Window {
        joditEditors?: Record<string, IJodit>;
    }
}

/**
 * Создаёт редактор Jodit на элементе по CSS-селектору.
 *
 * @param selector селектор целевого <textarea> (например, '#page-content')
 * @param config   опции Jodit + блок fileManager
 * @returns экземпляр редактора или null, если элемент не найден
 */
export function createEditor(
    selector: string,
    config: JoditWidgetConfig = {},
): IJodit | null {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) {
        console.error(`[Jodit] элемент не найден: ${selector}`);
        return null;
    }

    // Отделяем наш блок fileManager от «чистых» опций Jodit.
    const {fileManager, ...options} = config;
    const joditOptions: Record<string, unknown> = {...options};

    // Регистрируем кнопку файлового менеджера как control — размещение задаёт
    // список buttons из PHP (там имя 'fileManager' уже стоит на нужной позиции).
    if (fileManager?.fmConnector) {
        const existingControls =
            (joditOptions.controls as Record<string, unknown>) ?? {};
        joditOptions.controls = {
            ...existingControls,
            fileManager: createFileManagerControl(fileManager),
        };
    }

    // Jodit синхронизирует контент обратно в исходный <textarea>,
    // поэтому ActiveForm Yii получает значение без доп. кода.
    const editor = Jodit.make(element, joditOptions);

    window.joditEditors = window.joditEditors ?? {};
    window.joditEditors[element.id || selector] = editor;

    return editor;
}
