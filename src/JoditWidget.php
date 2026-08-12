<?php

/*
 * Copyright (c) 2026 Besnovatyj. Licensed under the MIT License.
 */

declare(strict_types=1);

namespace Besnovatyj\Jodit;

use Besnovatyj\Helpers\json\Json;
use yii\bootstrap5\InputWidget;
use yii\helpers\ArrayHelper;
use yii\helpers\Html;
use yii\helpers\Url;

/**
 * Виджет редактора Jodit для Yii2.
 *
 * @see https://xdsoft.net/jodit/
 *
 * Сборка самодостаточна: dist/jodit-widget.js (jodit + интеграция файлового менеджера)
 * и dist/jodit-widget.css. Виджет публикует их через {@see JoditAsset}, рендерит
 * <textarea> и инициализирует редактор ES-модулем, вызывая экспорт createEditor().
 *
 * Файловый менеджер (besnovatyj/filemanager-core) уже встроен в бандл: при
 * {@see $enableFileManager} === true в тулбаре появляется кнопка `fileManager`.
 */
class JoditWidget extends InputWidget
{
    /** Язык интерфейса редактора (локали Jodit). */
    public string $language = 'ru';

    /** Высота области редактирования (px или CSS-значение). 'auto' — по контенту. */
    public int|string $height = 400;

    /** Текст-приглашение в пустом редакторе. */
    public string $placeholder = 'Введите или вставьте текст сюда…';

    /** Включать ли кнопку файлового менеджера. */
    public bool $enableFileManager = true;

    /**
     * Директория, открываемая при первичной инициализации файлового менеджера.
     * Mount-префиксный виртуальный путь ('/' — виртуальный корень со списком всех mount).
     */
    public string $fmDefaultPath = '/static';

    /** Базовый URL опубликованных ресурсов файлового менеджера (иконки типов и т.п.). */
    public string $fmBaseUrl = '';

    /**
     * URL коннектора загрузки картинок (drag&drop / вставка).
     * По умолчанию пусто: uploader не подключается, и вставка изображений идёт
     * через файловый менеджер. Свой коннектор должен возвращать JSON в формате Jodit
     * (см. readme.md, раздел «Uploader»).
     */
    public string $uploadUrl = '';

    /**
     * Полный набор кнопок Jodit (все зарегистрированные плагинами группы) плюс наша
     * кастомная кнопка 'fileManager' после медиа-группы.
     *
     * Зеркалит дефолт Jodit ({@see Config::buttons}, config.js): группа
     * `{group: '<name>', buttons: []}` разворачивается в ВСЕ кнопки этой группы, поэтому
     * список самодостаточно «полный» и не устаревает при добавлении плагинов. Служит
     * дефолтом для всех четырёх адаптивных тулбаров (см. свойства $buttons* ниже).
     *
     * @see https://xdsoft.net/jodit/docs/options.html#buttons
     */
    private const array DEFAULT_BUTTONS = [

        ['group' => 'c_source_other_history', 'buttons' => [
            'source', // 'group' => 'source'
            'fullsize', // 'group' => 'other'
            // 'preview', // 'group' => 'other'
            // 'print', // 'group' => 'other'
            'undo', // 'group' => 'history'
            'redo', // 'group' => 'history'
        ]],

        ['group' => 'c_font-style', 'buttons' => [
            'bold', // 'group' => 'font-style'
            'italic', // 'group' => 'font-style'
            'underline', // 'group' => 'font-style'
            // 'strikethrough', // 'group' => 'font-style'
            'eraser', // 'group' => 'font-style'
        ]],

        ['group' => 'c_list', 'buttons' => [
            'ul', // 'group' => 'list'
            'ol', // 'group' => 'list'
        ]],

        ['group' => 'c_font', 'buttons' => [
            // 'font', // 'group' => 'font'
            // 'fontsize', // 'group' => 'font'
            'paragraph', // 'group' => 'font'
            // 'lineHeight', // 'group' => 'font'
        ]],

        ['group' => 'c_media', 'buttons' => [
            // 'image', // 'group' => 'media'
            // 'file', // 'group' => 'media'
            'fileManager', // 'group' => 'media'
            'video', // 'group' => 'media'
        ]],

        ['group' => 'c_insert', 'buttons' => [
            'table', // 'group' => 'insert'
            'hr', // 'group' => 'insert'
            'link', // 'group' => 'insert'
            // 'symbols', // 'group' => 'insert'
        ]],

        ['group' => 'indent', 'buttons' => []], // 'indent', 'outdent', 'left'

        // '|', // разделитель групп
        // "\n", - Перенос на следующую строку
        //'---', // Отодвигает следующую группу в конец строки

        ['group' => 'color', 'buttons' => []],  // 'brush'
        ['group' => 'state', 'buttons' => []],  // 'spellcheck'
        ['group' => 'search', 'buttons' => []], // 'find'
        ['group' => 'info', 'buttons' => []],   // 'about'

        // ['group' => 'script', 'buttons' => []], // 'superscript', 'subscript', 'classSpan'
        // ['group' => 'clipboard', 'buttons' => []], // 'cut', 'copy', 'paste', 'selectall', 'copyformat'

    ];

    /**
     * Основной тулбар — используется при ширине области ≥ {@see $sizeLG}.
     *
     * Элемент — имя кнопки/сепаратора ('|', '---', "\n") или группа
     * `['group' => '<name>', 'buttons' => [...]]` (пустой 'buttons' = все кнопки группы).
     * 'fileManager' — наша кастомная кнопка (регистрируется JS-бандлом; при
     * $enableFileManager === false рекурсивно вырезается из всех тулбаров).
     * @see https://xdsoft.net/jodit/docs/options.html#buttons
     */
    public array $buttons = self::DEFAULT_BUTTONS;

    /**
     * Тулбар для средних областей (ширина ≥ {@see $sizeMD}). null — наследует {@see $buttons}.
     * По умолчанию (null) во всех размерах показываются все кнопки; задайте свой список,
     * если для узких мест нужен усечённый набор (в духе дефолтных buttonsMD Jodit с 'dots').
     */
    public ?array $buttonsMD = [

        ['group' => 'c_source_other_history', 'buttons' => [
            'fullsize', // 'group' => 'other'
            'undo', // 'group' => 'history'
            'redo', // 'group' => 'history'
        ]],

        ['group' => 'c_font-style', 'buttons' => [
            'bold', // 'group' => 'font-style'
            'italic', // 'group' => 'font-style'
            'underline', // 'group' => 'font-style'
            'eraser', // 'group' => 'font-style'
        ]],

        ['group' => 'c_list', 'buttons' => [
            'ul', // 'group' => 'list'
            'ol', // 'group' => 'list'
        ]],

        ['group' => 'c_font', 'buttons' => [
            'paragraph', // 'group' => 'font'
        ]],

        ['group' => 'c_media', 'buttons' => [
            'fileManager', // 'group' => 'media'
            'video', // 'group' => 'media'
        ]],

        ['group' => 'c_insert', 'buttons' => [
            'table', // 'group' => 'insert'
            'hr', // 'group' => 'insert'
            'link', // 'group' => 'insert'
        ]],

        ['group' => 'indent', 'buttons' => []], // 'indent', 'outdent', 'left'

        '---', // Отодвигает следующую группу в конец строки
        'dots',
    ];

    /** Тулбар для малых областей (ширина ≥ {@see $sizeSM}). null — наследует {@see $buttons}. */
    public ?array $buttonsSM = [

        ['group' => 'c_source_other_history', 'buttons' => [
            'fullsize', // 'group' => 'other'
            'undo', // 'group' => 'history'
            'redo', // 'group' => 'history'
        ]],

        ['group' => 'c_font-style', 'buttons' => [
            'bold', // 'group' => 'font-style'
            'italic', // 'group' => 'font-style'
            'underline', // 'group' => 'font-style'
            'eraser', // 'group' => 'font-style'
        ]],

        ['group' => 'c_list', 'buttons' => [
            'ul', // 'group' => 'list'
            'ol', // 'group' => 'list'
        ]],

        ['group' => 'c_font', 'buttons' => [
            'paragraph', // 'group' => 'font'
        ]],

        ['group' => 'c_media', 'buttons' => [
            'fileManager', // 'group' => 'media'
            'video', // 'group' => 'media'
        ]],

        ['group' => 'c_insert', 'buttons' => [
            'table', // 'group' => 'insert'
            'hr', // 'group' => 'insert'
            'link', // 'group' => 'insert'
        ]],

        ['group' => 'indent', 'buttons' => []], // 'indent', 'outdent', 'left'

        '---', // Отодвигает следующую группу в конец строки

        'dots',
    ];

    /** Тулбар для очень узких областей (ширина < {@see $sizeSM}). null — наследует {@see $buttons}. */
    public ?array $buttonsXS = [

        ['group' => 'c_source_other_history', 'buttons' => [
            'fullsize', // 'group' => 'other'
            'undo', // 'group' => 'history'
            'redo', // 'group' => 'history'
        ]],

        ['group' => 'c_font-style', 'buttons' => [
            'bold', // 'group' => 'font-style'
            'italic', // 'group' => 'font-style'
            'underline', // 'group' => 'font-style'
            'paragraph', // 'group' => 'font'
            'eraser', // 'group' => 'font-style'
        ]],

        ['group' => 'c_list', 'buttons' => [
            'ul', // 'group' => 'list'
            'ol', // 'group' => 'list'
        ]],

        ['group' => 'c_media', 'buttons' => [
            'fileManager', // 'group' => 'media'
        ]],

        ['group' => 'c_insert', 'buttons' => [
            'hr', // 'group' => 'insert'
            'link', // 'group' => 'insert'
        ]],

        '---', // Отодвигает следующую группу в конец строки

        'dots',
    ];

    /**
     * Адаптивный тулбар: Jodit переключает наборы $buttons/$buttonsMD/$buttonsSM/$buttonsXS
     * по ширине области редактирования. false — всегда используется только {@see $buttons}.
     */
    public bool $toolbarAdaptive = true;

    /** Порог (px) для $buttons. null — дефолт Jodit (900). */
    public ?int $sizeLG = null;

    /** Порог (px) для $buttonsMD. null — дефолт Jodit (700). */
    public ?int $sizeMD = null;

    /** Порог (px) для $buttonsSM. null — дефолт Jodit (400). */
    public ?int $sizeSM = null;

    /**
     * Кнопки, безусловно убираемые из ЛЮБОГО тулбара (Jodit `removeButtons`).
     * Удобно точечно выключить лишнее из полного набора, не переписывая список целиком
     * (например ['ai-commands', 'ai-assistant', 'print'] — убрать AI-кнопки и печать).
     * @see https://xdsoft.net/jodit/docs/options.html#removeButtons
     */
    public array $removeButtons = [
        'ai-assistant',
        'ai-commands',
    ];

    /**
     * Пользовательские переопределения конфига Jodit.
     * Сливается поверх собранного {@see buildConfig()} (ArrayHelper::merge).
     */
    public array $config = [];

    /** URL коннектора файлового менеджера (backend API). */
    private string $fmConnectionUrl = '';

    /**
     * Публикует ассеты, рендерит <textarea> и инициализирует редактор.
     */
    public function run(): string
    {
        // Гарантируем id элемента (для режима name/value родитель его не задаёт).
        $this->options['id'] ??= $this->getId();

        $bundle = JoditAsset::register($this->view);
        $baseUrl = $bundle->baseUrl;

        $config = ArrayHelper::merge($this->buildConfig(), $this->config);
        $jsonConfig = Json::encode($config, false, ['enableJsonExprFinder' => true]);

        $id = $this->options['id'];

        // Инициализация как ES-модуль (createEditor — именованный экспорт бандла).
        $js = <<<JS
import('$baseUrl/jodit-widget.js')
    .then(m => m.createEditor('#$id', $jsonConfig))
    .catch(err => console.error('Jodit init error:', err));
JS;
        $initScript = Html::script($js, ['type' => 'module']);

        $textarea = $this->hasModel()
            ? Html::activeTextarea($this->model, $this->attribute, $this->options)
            : Html::textarea($this->name, (string)$this->value, $this->options);

        return $initScript . $textarea;
    }

    /**
     * Собирает базовый конфиг Jodit из свойств виджета.
     */
    protected function buildConfig(): array
    {
        $config = [
            'language' => $this->language,
            'height' => $this->height,
            'placeholder' => $this->placeholder,
            // Все четыре адаптивных тулбара. Незаданные (null) наследуют $buttons, поэтому
            // по умолчанию на любой ширине показывается полный набор кнопок.
            'buttons' => $this->resolveToolbar($this->buttons),
            'buttonsMD' => $this->resolveToolbar($this->buttonsMD),
            'buttonsSM' => $this->resolveToolbar($this->buttonsSM),
            'buttonsXS' => $this->resolveToolbar($this->buttonsXS),
            'toolbarAdaptive' => $this->toolbarAdaptive,
            // Очистка вставки: диалог для контента из Word, режем чужие стили (дефолты ядра).
            'askBeforePasteHTML' => true,
            'askBeforePasteFromWord' => true,
            'defaultActionOnPaste' => 'insert_as_html',
            'defaultActionOnPasteFromWord' => 'insert_as_html',
        ];

        // Брейкпоинты тулбара — только если заданы явно (иначе действуют дефолты Jodit).
        foreach (['sizeLG' => $this->sizeLG, 'sizeMD' => $this->sizeMD, 'sizeSM' => $this->sizeSM] as $key => $value) {
            if ($value !== null) {
                $config[$key] = $value;
            }
        }

        if ($this->removeButtons !== []) {
            $config['removeButtons'] = $this->removeButtons;
        }

        if ($this->uploadUrl !== '') {
            $config['uploader'] = [
                'url' => Url::to($this->uploadUrl),
                'headers' => $this->getHeaders(),
                'insertImageAsBase64URI' => false,
            ];
        }

        if ($this->enableFileManager) {
            $config['fileManager'] = [
                'fmConnector' => $this->getFmApiUrl(),
                'fmBaseUrl' => $this->fmBaseUrl,
                'fmDefaultPath' => $this->fmDefaultPath,
                'fmHeaders' => $this->getHeaders(),
            ];
        }

        return $config;
    }

    /**
     * Готовит один тулбар: подставляет {@see $buttons} вместо null (наследование) и,
     * если файловый менеджер выключен, вырезает кнопку 'fileManager' на всех уровнях.
     *
     * @param array<int, mixed>|null $buttons тулбар из свойства виджета
     * @return array<int, mixed>
     */
    protected function resolveToolbar(?array $buttons): array
    {
        $buttons ??= $this->buttons;

        return $this->enableFileManager
            ? $buttons
            : $this->stripControl($buttons, 'fileManager');
    }

    /**
     * Рекурсивно убирает кнопку $name из тулбара, включая вложенные группы
     * (`['group' => ..., 'buttons' => [...]]`).
     *
     * @param array<int, mixed> $buttons
     * @return array<int, mixed>
     */
    private function stripControl(array $buttons, string $name): array
    {
        $result = [];

        foreach ($buttons as $item) {
            if (is_string($item)) {
                if ($item !== $name) {
                    $result[] = $item;
                }
                continue;
            }

            if (is_array($item) && isset($item['buttons']) && is_array($item['buttons'])) {
                $item['buttons'] = $this->stripControl($item['buttons'], $name);
            }

            $result[] = $item;
        }

        return array_values($result);
    }

    /**
     * Доп. HTTP-заголовки для запросов файлового менеджера и загрузчика.
     */
    public function getHeaders(): array
    {
        return [
            'X-CSRF-Token' => \Yii::$app->request->getCsrfToken(),
            'X-Requested-With' => 'XMLHttpRequest',
        ];
    }

    /**
     * URL коннектора файлового менеджера (backend API).
     */
    public function getFmApiUrl(): string
    {
        return $this->fmConnectionUrl ?: Url::to('/File/backend/file-manager');
    }
}
