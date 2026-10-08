const { mkdirSync, copyFileSync } = require('node:fs');
mkdirSync('dist', { recursive: true });
for (const name of ['index.html', 'styles.css', 'app.js']) {
  copyFileSync(name, `dist/${name}`);
}
