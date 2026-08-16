/*
 * Copyright (c) 2026 Besnovatyj. Licensed under the MIT License.
 */

/**
 * Собственные типы для работы с API Jodit.
 *
 * Зачем: в jodit (проверено на 4.12) интерфейсы `IJodit`, `IControlType` и соседние объявлены
 * в `.d.ts` БЕЗ ключевого слова `export`, а сами файлы модульные (в них есть `import`). Поэтому
 * снаружи они не видны, и `import type {IJodit, IControlType} from 'jodit'` падает с TS2724/TS2305.
 * Это дефект типизации самого пакета: его собственный `types/jodit.d.ts` импортирует `IJodit`
 * из `./types/index`, где тот не экспортирован. В рантайме ничего не ломается, потому что esbuild
 * типы просто срезает, а `skipLibCheck: true` глушит ошибки внутри чужих `.d.ts` — но не в нашем коде.
 *
 * Что берём взамен: экспортируемый класс {@link Jodit} типизирован полностью (`dlg`/`alert` через
 * трейт `Dlgs`, `selection`/`s`, `createInside`, `od` — через базовый `Component`), поэтому в роли
 * типа редактора он равноценен `IJodit`. Для описания кнопки хватает структурного типа: Jodit
 * принимает объект контрола как есть.
 *
 * Если в будущей версии jodit типы начнут экспортироваться — этот модуль удаляется, а импорты
 * возвращаются на `jodit`.
 */

import type {Jodit} from 'jodit';

/** Редактор Jodit в роли типа (замена невыгружаемого `IJodit`). */
export type JoditEditor = Jodit;

/**
 * Описание кнопки тулбара (замена невыгружаемого `IControlType`).
 *
 * @see https://xdsoft.net/jodit/docs/options.html#controls
 */
export interface JoditControl {
    /** Имя контрола: под ним кнопка ставится в списки `buttons*`. */
    name: string;
    /** Имя зарегистрированной иконки (`Jodit.modules.Icon.set`). */
    icon?: string;
    /** Всплывающая подсказка. */
    tooltip?: string;
    /** Действие по клику. Jodit передаёт больше аргументов — лишние нам не нужны. */
    exec: (editor: JoditEditor) => void;
}
