/*
 * Copyright (c) 2026 Besnovatyj. Licensed under the MIT License.
 */

//#####################################
// Сборка виджета Jodit одной entry: assets/jodit-widget.ts → dist/jodit-widget.js.
// jodit, @besnovatyj/filemanager-core и @besnovatyj/snippets-core БАНДЛЯТСЯ внутрь
// (self-contained виджет). CSS Jodit импортируется в entry и выезжает отдельным файлом
// dist/jodit-widget.css. Сниппет-ядро пока локальное — см. флаг SNIPPETS_CORE_LOCAL ниже.
//#####################################
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Для локальной разработки без NPM (@besnovatyj/snippets-core ещё не опубликован).
// SNIPPETS_CORE_LOCAL=1 → импорт @besnovatyj/snippets-core резолвится не из node_modules,
// а из локально собранного ядра (app/packages/npm/snippets-core/dist/standalone.js).
// Аналог FM_CORE_LOCAL в app/vendor/besnovatyj/yii2-cms-file-manager/esbuild.js.
// Пока ядро не в npm, боевая сборка тоже должна идти с этим флагом.
const snippetsCoreLocal = process.env.SNIPPETS_CORE_LOCAL;
const snippetsCoreLocalPath = path.resolve(
  __dirname,
  '../../../packages/npm/snippets-core/dist/standalone.js'
);

if (snippetsCoreLocal && !fs.existsSync(snippetsCoreLocalPath)) {
  console.error(
    `💥 SNIPPETS_CORE_LOCAL включён, но ядро не собрано: ${snippetsCoreLocalPath}\n` +
    `   Сначала собери ядро (node esbuild.js в snippets-core), затем повтори сборку виджета.`
  );
  process.exit(1);
}

const alias = snippetsCoreLocal
  ? {'@besnovatyj/snippets-core': snippetsCoreLocalPath}
  : undefined;
// END Для локальной разработки без NPM

const buildOptions = {
  entryPoints: [path.resolve(__dirname, 'assets/jodit-widget.ts')],
  bundle: true,
  outfile: path.resolve(__dirname, 'dist/jodit-widget.js'),
  format: 'esm',
  legalComments: 'none',
  target: 'ESNext',
  minify: true,
  platform: 'browser',
  sourcemap: true,
  // Ничего наружу не выносим: виджет самодостаточен (jodit + ядра ФМ/сниппетов внутри бандла).
  external: [],
  alias,
  loader: {
    // Иконки/шрифты, на которые ссылается CSS Jodit, инлайним data-URI,
    // чтобы dist оставался двумя файлами (js + css) без хвоста ассетов.
    '.svg': 'dataurl',
    '.png': 'dataurl',
    '.gif': 'dataurl',
    '.woff': 'dataurl',
    '.woff2': 'dataurl',
    '.ttf': 'dataurl',
    '.eot': 'dataurl',
  },
  tsconfig: path.resolve(__dirname, 'tsconfig.json'),
};

async function build() {
  try {
    const result = await esbuild.build(buildOptions);
    console.log('✅ Сборка jodit-widget завершена (dist/jodit-widget.js + .css)');
    if (result.warnings.length > 0) {
      console.warn('⚠️ Предупреждения сборки:', result.warnings);
    }
  } catch (error) {
    console.error('❌ Ошибка сборки jodit-widget:', error);
    process.exit(1);
  }
}

build();
