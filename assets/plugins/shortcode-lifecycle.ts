/*
 * Copyright (c) 2026 Besnovatyj. Licensed under the MIT License.
 */

import {MODE_WYSIWYG} from 'jodit/esm/core/constants.js';
import type {JoditEditor} from '../jodit-types';
import type {ShortcodesConfig} from './shortcodes';
import {loadShortcodes} from './shortcode-data';
import {ShortcodeCodec} from './shortcode-values';

/** Состояние одного редактора, участвующее в общей блокировке формы. */
interface Participant {
    ready: () => boolean;
    focus: () => void;
    sync: () => void;
}

/** Один обработчик на форму; редакторы других форм не влияют на отправку. */
const forms = new WeakMap<HTMLFormElement, {members: Set<Participant>; submit: (event: Event) => void}>();

/** Присоединяет редактор к штатной отправке формы, не отключая textarea. */
function guardForm(form: HTMLFormElement | null, participant: Participant): () => void {
    if (!form) return () => undefined;
    let group = forms.get(form);
    if (!group) {
        const members = new Set<Participant>();
        const submit = (event: Event): void => {
            const blocked = [...members].find(member => !member.ready());
            if (blocked) {
                event.preventDefault();
                event.stopImmediatePropagation();
                blocked.focus();
                return;
            }
            for (const member of members) member.sync();
        };
        group = {members, submit};
        forms.set(form, group);
        form.addEventListener('submit', submit, true);
    }
    group.members.add(participant);
    return () => {
        group?.members.delete(participant);
        if (group?.members.size === 0) {
            form.removeEventListener('submit', group.submit, true);
            forms.delete(form);
        }
    };
}

/** Управляет обязательной загрузкой, превью и единым выходным HTML. */
export function attachShortcodeLifecycle(editor: JoditEditor, config: ShortcodesConfig): void {
    let state: 'loading' | 'ready' | 'error' | 'destroyed' = 'loading';
    let codec: ShortcodeCodec | null = null;
    let queued = false;
    let settingReadonly = false;
    let requestedReadonly = editor.getReadOnly();
    const originalPosition = editor.container.style.position;
    const positioned = editor.ow.getComputedStyle(editor.container).position === 'static';
    if (positioned) editor.container.style.position = 'relative';
    const panel = editor.od.createElement('div');
    panel.className = 'jodit-shortcodes-status';
    panel.tabIndex = -1;
    panel.setAttribute('role', 'status');
    Object.assign(panel.style, {
        position: 'absolute', inset: '0', zIndex: '20', padding: '24px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px',
        flexWrap: 'wrap', background: 'var(--jd-color-background-default, #fff)',
        color: 'var(--jd-color-text, #222)',
    });
    const message = editor.od.createElement('span');
    const retry = editor.od.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Повторить загрузку';
    panel.append(message, retry);
    editor.container.appendChild(panel);

    const setReadonly = (value: boolean): void => {
        settingReadonly = true;
        try { editor.setReadOnly(value); } finally { settingReadonly = false; }
    };
    const show = (error?: unknown): void => {
        panel.hidden = false;
        panel.style.display = 'flex';
        retry.hidden = state !== 'error';
        panel.setAttribute('role', state === 'error' ? 'alert' : 'status');
        message.textContent = state === 'error'
            ? `Не удалось загрузить шорткоды. ${error instanceof Error ? error.message : 'Ошибка API.'} Редактор заблокирован.`
            : 'Загрузка шорткодов…';
    };
    const syncSource = (): void => {
        if (queued || state !== 'ready') return;
        queued = true;
        queueMicrotask(() => {
            queued = false;
            if (state !== 'ready' || editor.isInDestruct) return;
            // Вне блокировки source.toWYSIWYG обновляем только зеркало source,
            // не создавая change и снимок истории ради служебной нормализации.
            editor.e.fire('change.source', true);
        });
    };
    const decorate = (): void => {
        if (state === 'ready') codec?.decorate(editor.editor);
    };
    const restore = (data: {value: string}): void => {
        if (state === 'ready' && codec) data.value = codec.restore(editor.od, data.value);
    };
    const onReadonly = (value: boolean): void => {
        if (settingReadonly) return;
        requestedReadonly = value;
        if (state !== 'ready' && state !== 'destroyed') setReadonly(true);
    };
    const stopInteraction = (event: Event): void => {
        if (state === 'ready' || state === 'destroyed' || panel.contains(event.target as Node)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    };
    const blockCommand = (): false | undefined => state === 'ready' ? undefined : false;
    const detachForm = guardForm(editor.element.closest('form'), {
        ready: () => state === 'ready',
        focus: () => panel.focus(),
        sync: () => {
            if (editor.getMode() !== MODE_WYSIWYG) {
                // Source откладывает ввод через debounce. Его штатная пара lifecycle-событий
                // синхронно переносит последний ввод и восстанавливает selection-маркеры
                // без фактического переключения режима и обращения к private __plugins.
                editor.e.fire('beforeSetMode.source');
                editor.e.fire('afterSetMode.source');
            }
            editor.synchronizeValues();
            editor.e.fire('change.source', true);
        },
    });
    const destroyed = (): boolean => state === 'destroyed' || editor.isInDestruct;
    const load = async (): Promise<void> => {
        if (state === 'destroyed' || editor.isInDestruct) return;
        state = 'loading';
        setReadonly(true);
        show();
        try {
            const items = await loadShortcodes(config);
            if (destroyed()) return;
            codec = new ShortcodeCodec(items);
            state = 'ready';
            // Контент уже в редакторе (список грузится асинхронно) — декорируем его без точки
            // истории, иначе Ctrl+Z «откатывал» бы картинки к битым адресам.
            editor.history.snapshot.transaction(() => {
                codec?.decorate(editor.editor);
                editor.synchronizeValues();
            });
            if (editor.history.length === 0) editor.history.clear();
            panel.hidden = true;
            panel.style.display = 'none';
            setReadonly(requestedReadonly);
            syncSource();
        } catch (error: unknown) {
            if (destroyed()) return;
            // Без списка редактор работает как раньше, просто без превью.
            // Историческое поведение выше заменено явной ошибкой и блокировкой.
            state = 'error';
            setReadonly(true);
            show(error);
        }
    };
    const onRetry = (): void => { void load(); };
    const destruct = (): void => {
        state = 'destroyed';
        detachForm();
        for (const name of ['click', 'pointerdown', 'keydown', 'beforeinput', 'paste', 'drop']) {
            editor.container.removeEventListener(name, stopInteraction, true);
        }
        editor.e.off('.shortcodePreview');
        retry.removeEventListener('click', onRetry);
        panel.remove();
        if (positioned && editor.container.style.position === 'relative') {
            editor.container.style.position = originalPosition;
        }
    };
    for (const name of ['click', 'pointerdown', 'keydown', 'beforeinput', 'paste', 'drop']) {
        editor.container.addEventListener(name, stopInteraction, true);
    }
    retry.addEventListener('click', onRetry);
    editor.e.on('postProcessSetEditorValue.shortcodePreview', decorate);
    editor.e.on('afterGetValueFromEditor.shortcodePreview', restore);
    editor.e.on('change.shortcodePreview afterSetMode.shortcodePreview', syncSource);
    editor.e.on('readonly.shortcodePreview', onReadonly);
    editor.e.on('beforeCommand.shortcodePreview', blockCommand);
    editor.e.on('beforeDestruct.shortcodePreview', destruct);
    void load();
}
