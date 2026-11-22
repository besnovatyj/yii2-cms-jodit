/*
 * Copyright (c) 2026 Besnovatyj. Licensed under the MIT License.
 */

import {MODE_WYSIWYG} from 'jodit/esm/core/constants.js';
import type {JoditEditor} from '../../jodit-types';

/** Переносит последний ввод Source в Jodit до истечения debounce. */
export function flushSource(editor: JoditEditor): void {
    if (editor.getMode() === MODE_WYSIWYG) return;
    // У Source нет отдельной операции flush. Его обработчики сохраняют и восстанавливают
    // выделение без фактического переключения режима и обращения к private __plugins.
    editor.e.fire('beforeSetMode.source');
    editor.e.fire('afterSetMode.source');
}

/** Обновляет зеркало после выхода из блокировки source.toWYSIWYG. */
export function refreshSource(editor: JoditEditor): void {
    if (editor.getMode() === MODE_WYSIWYG) return;
    editor.e.fire('change.source', true);
}
