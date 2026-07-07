<?php

/*
 * Copyright (c) 2026 Besnovatyj. Licensed under the MIT License.
 */

declare(strict_types=1);

namespace Besnovatyj\Jodit;

use yii\web\AssetBundle;
use yii\web\View;

/**
 * Публикует собранный dist виджета Jodit: CSS редактора (jodit-widget.css) и
 * ESM-бандл (jodit-widget.js).
 *
 * JS не объявляем в $js — он подключается виджетом динамическим import() как ES-модуль
 * (нужен именованный экспорт createEditor). Здесь регистрируется только CSS, а baseUrl
 * используется виджетом для построения URL модуля.
 */
class JoditAsset extends AssetBundle
{
    public $sourcePath = __DIR__ . '/../dist';

    public $css = ['jodit-widget.css'];

    public $cssOptions = ['position' => View::POS_HEAD];
}
