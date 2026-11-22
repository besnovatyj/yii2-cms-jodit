/*
 * Copyright (c) 2026 Besnovatyj. Licensed under the MIT License.
 */

interface FormEditor {
    ready(): boolean;
    focus(): void;
    sync(): void;
}

interface JQueryForm {
    on(event: string, handler: () => false | undefined): void;
    off(event: string, handler: () => false | undefined): void;
}

const forms = new WeakMap<HTMLFormElement, FormSubmission>();

/** Регистрирует редактор в проверке его формы и возвращает отписку. */
export function guardForm(form: HTMLFormElement | null, editor: FormEditor): () => void {
    if (!form) return () => undefined;
    let submission = forms.get(form);
    if (!submission) {
        submission = new FormSubmission(form);
        forms.set(form, submission);
    }
    return submission.add(editor);
}

class FormSubmission {
    private readonly editors = new Set<FormEditor>();
    private readonly activeForm?: JQueryForm;

    constructor(private readonly form: HTMLFormElement) {
        const view = form.ownerDocument.defaultView as (Window & {
            jQuery?: (form: HTMLFormElement) => JQueryForm;
        }) | null;
        this.activeForm = view?.jQuery?.(form);
        form.addEventListener('submit', this.onSubmit, true);
        this.activeForm?.on('beforeSubmit.joditShortcodes', this.beforeSubmit);
    }

    add(editor: FormEditor): () => void {
        this.editors.add(editor);
        return () => {
            this.editors.delete(editor);
            if (this.editors.size === 0) this.destroy();
        };
    }

    private prepare(): boolean {
        for (const editor of this.editors) {
            if (editor.ready()) continue;
            editor.focus();
            return false;
        }
        for (const editor of this.editors) editor.sync();
        return true;
    }

    private readonly onSubmit = (event: Event): void => {
        if (this.prepare()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    };

    // Yii ActiveForm отправляет форму через jQuery после валидации.
    private readonly beforeSubmit = (): false | undefined => this.prepare() ? undefined : false;

    private destroy(): void {
        this.form.removeEventListener('submit', this.onSubmit, true);
        this.activeForm?.off('beforeSubmit.joditShortcodes', this.beforeSubmit);
        forms.delete(this.form);
    }
}
