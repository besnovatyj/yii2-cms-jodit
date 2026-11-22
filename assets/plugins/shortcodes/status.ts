/*
 * Copyright (c) 2026 Besnovatyj. Licensed under the MIT License.
 */

import './status.css';

/** Сообщение о загрузке и повторе запроса рядом с редактором. */
export class ShortcodeStatus {
    private readonly panel: HTMLDivElement;
    private readonly message: HTMLSpanElement;
    private readonly retry: HTMLButtonElement;
    private events?: AbortController;

    constructor(private readonly container: HTMLElement, private readonly onRetry: () => void) {
        const doc = container.ownerDocument;
        this.panel = doc.createElement('div');
        this.panel.className = 'jodit-shortcodes-status';
        this.panel.tabIndex = -1;
        this.message = doc.createElement('span');
        this.retry = doc.createElement('button');
        this.retry.type = 'button';
        this.retry.textContent = 'Повторить загрузку';
        this.panel.append(this.message, this.retry);
    }

    loading(): void {
        this.events?.abort();
        this.events = undefined;
        this.retry.hidden = true;
        this.panel.setAttribute('role', 'status');
        this.message.textContent = 'Загрузка шорткодов… Редактирование пока недоступно.';
        this.container.before(this.panel);
    }

    error(error: unknown): void {
        this.panel.setAttribute('role', 'alert');
        const reason = error instanceof Error ? error.message : 'Ошибка API.';
        this.message.textContent = `Не удалось загрузить шорткоды. ${reason} Редактирование и сохранение недоступны.`;
        this.retry.hidden = false;
        this.events = new AbortController();
        this.retry.addEventListener('click', this.onRetry, {signal: this.events.signal});
    }

    focus(): void {
        this.panel.focus();
    }

    remove(): void {
        this.events?.abort();
        this.events = undefined;
        this.panel.remove();
    }
}
