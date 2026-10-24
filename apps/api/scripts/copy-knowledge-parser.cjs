const fs = require('node:fs');
fs.copyFileSync('src/modules/knowledge/office-parser.py', 'dist/modules/knowledge/office-parser.py');
fs.copyFileSync('src/modules/knowledge/parser-runner.py', 'dist/modules/knowledge/parser-runner.py');
