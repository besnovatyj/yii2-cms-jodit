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
     * Список кнопок тулбара Jodit. Имя 'fileManager' — наша кастомная кнопка
     * (регистрируется JS-бандлом; при $enableFileManager === false вырезается).
     * @see https://xdsoft.net/jodit/docs/options.html#buttons
     */
    public array $buttons = [
        'source', '|',
        'bold', 'italic', 'underline', 'strikethrough', '|',
        'ul', 'ol', '|',
        'paragraph', 'fontsize', 'brush', '|',
        'link', 'image', 'fileManager', 'table', 'hr', '|',
        'align', 'indent', 'outdent', '|',
        'undo', 'redo', '|',
        'eraser', 'fullsize',
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
            'buttons' => $this->getButtons(),
            'toolbarAdaptive' => true,
            // Очистка вставки: диалог для контента из Word, режем чужие стили (дефолты ядра).
            'askBeforePasteHTML' => true,
            'askBeforePasteFromWord' => true,
            'defaultActionOnPaste' => 'insert_as_html',
            'defaultActionOnPasteFromWord' => 'insert_as_html',
        ];

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
     * Список кнопок с учётом флага файлового менеджера.
     */
    protected function getButtons(): array
    {
        if ($this->enableFileManager) {
            return $this->buttons;
        }

        return array_values(array_filter(
            $this->buttons,
            static fn(string $button): bool => $button !== 'fileManager',
        ));
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
