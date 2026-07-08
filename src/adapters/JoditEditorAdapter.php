<?php

/*
 * Copyright (c) 2026 Besnovatyj. Licensed under the MIT License.
 */

declare(strict_types=1);

namespace Besnovatyj\Jodit\adapters;

use Besnovatyj\Editor\EditorOptions;
use Besnovatyj\Editor\contracts\EditorAdapterInterface;
use Besnovatyj\Jodit\JoditWidget;

/**
 * Адаптер редактора Jodit для фасада yii2-cms-editor.
 *
 * Переводит нормализованные опция в свойства {@see JoditWidget}. Живёт в пакете самого
 * редактора, поэтому фасад не зависит от Jodit напрямую.
 */
final class JoditEditorAdapter implements EditorAdapterInterface
{
    public function widgetClass(): string
    {
        return JoditWidget::class;
    }

    public function buildConfig(EditorOptions $options): array
    {
        $config = [];

        if ($options->language !== null) {
            $config['language'] = $options->language;
        }
        if ($options->height !== null) {
            $config['height'] = $options->height;
        }
        if ($options->placeholder !== null) {
            $config['placeholder'] = $options->placeholder;
        }
        if ($options->fmDefaultPath !== null) {
            $config['fmDefaultPath'] = $options->fmDefaultPath;
        }
        if ($options->enableFileManager !== null) {
            $config['enableFileManager'] = $options->enableFileManager;
        }

        return $config;
    }
}
