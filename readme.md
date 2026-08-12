# besnovatyj/yii2-cms-jodit

Редактор **Jodit** для Yii2: собранный dist + виджет со **встроенной интеграцией файлового
менеджера** [`@besnovatyj/filemanager-core`](../../npm/filemanager-core). Альтернатива
CKEditor 5 — с нативным редактированием HTML-исходника, очисткой вставки из Word/сайтов и
плагинной архитектурой (MIT, TypeScript).

## Состав пакета

```
assets/jodit-widget.ts          # entry: Jodit + CSS + регистрация кнопки ФМ, экспорт createEditor()
assets/plugins/fileManager.ts   # интеграция @besnovatyj/filemanager-core (кнопка, вставка файлов)
esbuild.js                      # сборка одной entry; jodit и ядро ФМ бандлятся внутрь
tsconfig.json                   # strict TS (только проверка типов; сборка — esbuild)
src/JoditWidget.php             # Yii2 InputWidget
src/JoditAsset.php              # AssetBundle (публикует dist/jodit-widget.js + .css)
dist/                           # jodit-widget.js + jodit-widget.css (коммитятся после сборки)
composer.json                   # besnovatyj/yii2-cms-jodit (yii2-extension)
package.json                    # @besnovatyj/yii2-cms-jodit-build (сборка)
```

## Сборка (Node / Docker)

Node/npm доступны только в контейнере. Из корня пакета:

```bash
npm install        # подтянет jodit ^4 и @besnovatyj/filemanager-core ^1.0.x
npm run build      # → dist/jodit-widget.js + dist/jodit-widget.css
npm run type-check # (опционально) строгая проверка типов через tsc --noEmit
```

`dist/` коммитится в git — composer потребляет его без пересборки (как у остальных
собранных пакетов CMS).

> **Локальная доработка ядра ФМ:** ядро тянется из npm registry по версии. Для проверки
> незапубликованной версии — `npm install ../../npm/filemanager-core --no-save`, затем
> `npm run build`.

## Использование

```php
use Besnovatyj\Jodit\JoditWidget;

<?= $form->field($model, 'content')->widget(JoditWidget::class, [
    'height' => 500,
    'fmDefaultPath' => '/static',
    // 'enableFileManager' => false, // выключить кнопку файлового менеджера
    // 'config' => [ ... ],          // любые прочие переопределения опций Jodit
]) ?>
```

### Тулбар

По умолчанию во всех размерах показывается **полный** набор кнопок Jodit (все группы) плюс
кнопка `fileManager`. Настройка — через первоклассные свойства виджета:

```php
<?= $form->field($model, 'content')->widget(JoditWidget::class, [
    // Свой основной тулбар (имена кнопок, сепараторы '|' '---' "\n" или группы
    // ['group' => 'font-style', 'buttons' => []]):
    'buttons' => ['bold', 'italic', '|', 'ul', 'ol', '|', 'link', 'image', 'fileManager', 'source'],

    // Адаптив: Jodit меняет набор по ширине. buttonsMD/SM/XS = null → наследуют $buttons
    // (полный набор на любой ширине). Задайте, если для узких мест нужен усечённый список:
    // 'buttonsMD' => [...], 'buttonsSM' => [...], 'buttonsXS' => ['bold', 'italic', 'dots'],
    // 'toolbarAdaptive' => false,           // отключить адаптив (всегда только $buttons)
    // 'sizeLG' => 900, 'sizeMD' => 700, 'sizeSM' => 400, // брейкпоинты (px)

    // Точечно убрать кнопки из полного набора, не переписывая список:
    'removeButtons' => ['ai-commands', 'ai-assistant'],
]) ?>
```

> **Важно про адаптив.** При `toolbarAdaptive = true` свойство `buttons` работает только на
> ширине ≥ `sizeLG`; на более узких Jodit берёт `buttonsMD/SM/XS`. Виджет по умолчанию
> наследует их из `buttons`, поэтому кастомный список виден на всех ширинах — задавайте их
> отдельно только если осознанно хотите разные тулбары.

Или без модели:

```php
<?= JoditWidget::widget([
    'name' => 'content',
    'value' => $html,
]) ?>
```

Виджет публикует ассеты, рендерит `<textarea>` и инициализирует Jodit ES-модулем через
`createEditor('#id', config)`. Jodit синхронизирует контент обратно в `<textarea>`, поэтому
`ActiveForm` получает значение без дополнительного кода.

## Файловый менеджер

Кнопка `fileManager` (при `enableFileManager = true`) открывает
`@besnovatyj/filemanager-core`. Выбранные файлы вставляются в контент: картинки — как `<img>`,
остальное — как ссылка. Конфиг коннектора/заголовков/пути задаёт PHP-виджет
(`getFmApiUrl()`, `getHeaders()`, `fmDefaultPath`). Логика — в `assets/plugins/fileManager.ts`,
полный аналог CKEditor-адаптера `@besnovatyj/ckeditor5-filemanager`.

## Очистка вставки

Работает штатный конвейер Jodit (`cleanHTML` + `paste`/`paste-from-word`):

- **из Word** — диалог «с форматированием / очистить / только текст» (`askBeforePasteFromWord`);
- **с сайтов** — по умолчанию `allowedStyles: false`, то есть чужие инлайновые стили режутся;
- запрещены `script,iframe,object,embed`, снимаются `on*`-обработчики, обезвреживается
  `javascript:`.

Тонкая настройка — через `config` (ключи `cleanHTML`, `allowTags`/`denyTags`,
`defaultActionOnPaste*`).

## Что осталось проверить/доработать (осознанно вынесено)

1. **Полный набор плагинов** подключается явно: `import 'jodit/esm/plugins/all.js'` +
   `jodit/es2021/jodit.fat.min.css`. Главный вход `jodit` регистрирует лишь урезанный core
   (без source/resizer/fullsize/align/paste-from-word) — их кнопки рендерятся, но молча не
   работают. Чтобы уменьшить бандл, `all.js` можно заменить на курированный список нужных
   `import 'jodit/esm/plugins/<name>/<name>.js'`.
2. **API Jodit** (`Jodit.make`, `editor.selection.insertImage/insertHTML`, форма контрола
   кнопки, имена встроенных иконок) выверен по докам; перед боевым использованием — один
   smoke-тест: собрать, открыть форму, проверить тулбар, вставку из ФМ и сохранение.
3. **Uploader** (drag&drop / вставка картинок) — по умолчанию выключен (`uploadUrl = ''`),
   вставка идёт через файловый менеджер. Для прямой загрузки нужен коннектор, отвечающий в
   **формате Jodit** (`{ success, data: { baseurl, files, ... } }`) — это НЕ формат SUA-коннектора
   CKEditor, отдельная серверная ручка.
4. **CodeMirror как sourceEditor** — Jodit поддерживает замену встроенного редактора исходника
   через `sourceEditor`; порт твоего CodeMirror-плагина — отдельная задача (точка расширения
   готова: передать реализацию в `config`).
