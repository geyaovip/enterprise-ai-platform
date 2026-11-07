const fs = require('node:fs');
fs.copyFileSync('src/modules/knowledge/office-parser.py', 'dist/modules/knowledge/office-parser.py');
fs.copyFileSync('src/modules/knowledge/parser-runner.py', 'dist/modules/knowledge/parser-runner.py');
fs.copyFileSync('src/modules/knowledge/legacy_excel.py', 'dist/modules/knowledge/legacy_excel.py');
fs.copyFileSync('src/modules/knowledge/pcb_native.py', 'dist/modules/knowledge/pcb_native.py');
fs.copyFileSync('src/modules/mes/bom-document-parser.py', 'dist/modules/mes/bom-document-parser.py');

fs.copyFileSync('src/modules/mes/bom-page-preview.py', 'dist/modules/mes/bom-page-preview.py');

fs.copyFileSync('src/modules/mes/bom-vision-input.py', 'dist/modules/mes/bom-vision-input.py');
fs.copyFileSync('src/modules/content/content-media.py','dist/modules/content/content-media.py');

// Remove obsolete compiled artifacts left by incremental builds.
for(const name of ['bom-ocr-crosscheck.py','bom-ocr-crosscheck.js','bom-ocr-crosscheck.js.map','bom-ocr-crosscheck.d.ts'])fs.rmSync('dist/modules/mes/'+name,{force:true});

fs.cpSync('src/modules/content/fonts','dist/modules/content/fonts',{recursive:true});



fs.copyFileSync('src/modules/geo/geo-report-pdf.py','dist/modules/geo/geo-report-pdf.py');
fs.cpSync('src/modules/geo/fonts','dist/modules/geo/fonts',{recursive:true});
