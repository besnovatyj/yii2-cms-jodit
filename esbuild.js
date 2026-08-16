/*
 * Copyright (c) 2026 Besnovatyj. Licensed under the MIT License.
 */

//#####################################
// Сборка виджета Jodit одной entry: assets/jodit-widget.ts → dist/jodit-widget.js.
// jodit, @besnovatyj/filemanager-core и @besnovatyj/snippets-core БАНДЛЯТСЯ внутрь
// (self-contained виджет). Оба ядра берутся из npm по версии из package.json. CSS Jodit
// импортируется в entry и выезжает отдельным файлом dist/jodit-widget.css.
//#####################################
import * as esbuild from 'esbuild';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
