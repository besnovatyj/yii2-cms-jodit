/*
 * Copyright (c) 2026 Besnovatyj. Licensed under the MIT License.
 */

import type {JoditEditor} from '../../jodit-types';
import type {ShortcodesConfig} from '../shortcodes';
import {loadShortcodes} from './catalog';
import {guardForm} from './submission';
import {flushSource, refreshSource} from './source';
import {ShortcodeStatus} from './status';
import {ShortcodeCodec} from './values';

type State =
    | {kind: 'loading'}
    | {kind: 'error'}
    | {kind: 'ready'; codec: ShortcodeCodec}
    | {kind: 'destroyed'};

/** Подключает превью и преобразование исходника к одному экземпляру Jodit. */
export function attachShortcodeIntegration(editor: JoditEditor, config: ShortcodesConfig): void {
    const integration = new ShortcodeIntegration(editor, config);
    integration.start();
}

class ShortcodeIntegration {
    private state: State = {kind: 'loading'};
    private readonly status: ShortcodeStatus;
    private readonly initialReadonly: boolean;
    private detachForm?: () => void;
    private sourceRefreshQueued = false;

    constructor(private readonly editor: JoditEditor, private readonly config: ShortcodesConfig) {
        this.initialReadonly = editor.getReadOnly();
        this.status = new ShortcodeStatus(editor.container, () => void this.load());
    }

    start(): void {
        const {editor} = this;
        this.detachForm = guardForm((editor.element as HTMLTextAreaElement).form ?? editor.element.closest('form'), {
            ready: () => this.state.kind === 'ready',
            focus: () => this.status.focus(),
            sync: () => this.syncForSave(),
        });
        editor.e.on('beforeDestruct.shortcodes', this.destroy);
        void this.load();
    }

    private async load(): Promise<void> {
        this.state = {kind: 'loading'};
        this.status.loading();
        this.editor.setReadOnly(true);
        try {
            const items = await loadShortcodes(this.config);
            if (this.destroyed) return;
            this.connect(new ShortcodeCodec(items));
        } catch (error: unknown) {
            if (this.destroyed) return;
            this.disconnectValueEvents();
            this.state = {kind: 'error'};
            this.status.error(error);
        }
    }

    private get destroyed(): boolean {
        return this.state.kind === 'destroyed' || this.editor.isInDestruct;
    }

    private connect(codec: ShortcodeCodec): void {
        const {editor} = this;
        // Пока грузился каталог, пользователь мог изменить исходник.
        flushSource(editor);
        this.state = {kind: 'ready', codec};
        editor.e.on('postProcessSetEditorValue.shortcodeValues', this.decorate);
        editor.e.on('afterGetValueFromEditor.shortcodeValues', this.restore);
        editor.e.on('change.shortcodeValues afterSetMode.shortcodeValues', this.queueSourceRefresh);

        // Подстановка для превью не должна становиться отдельным шагом undo.
        editor.history.snapshot.transaction(() => {
            codec.decorate(editor.editor);
            editor.synchronizeValues();
        });
        if (editor.history.length === 0) editor.history.clear();
        this.queueSourceRefresh();
        this.status.remove();
        editor.setReadOnly(this.initialReadonly);
    }

    private readonly decorate = (): void => {
        if (this.state.kind === 'ready') this.state.codec.decorate(this.editor.editor);
    };

    private readonly restore = (data: {value: string}): void => {
        if (this.state.kind === 'ready') data.value = this.state.codec.restore(this.editor.od, data.value);
    };

    private syncForSave(): void {
        flushSource(this.editor);
        this.editor.synchronizeValues();
        refreshSource(this.editor);
    }

    private readonly queueSourceRefresh = (): void => {
        if (this.sourceRefreshQueued) return;
        this.sourceRefreshQueued = true;
        queueMicrotask(() => {
            this.sourceRefreshQueued = false;
            if (!this.destroyed && this.state.kind === 'ready') refreshSource(this.editor);
        });
    };

    private disconnectValueEvents(): void {
        this.editor.e.off('.shortcodeValues');
    }

    private readonly destroy = (): void => {
        this.state = {kind: 'destroyed'};
        this.detachForm?.();
        this.status.remove();
        this.disconnectValueEvents();
        this.editor.e.off('.shortcodes');
    };
}
