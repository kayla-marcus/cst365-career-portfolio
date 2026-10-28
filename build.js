// Inlines src/*.js into one self-contained index.html so it works when opened or previewed on its own.
const fs = require('fs'), r = f => fs.readFileSync(f, 'utf8').replace(/<\/script>/gi, '<\\/script>');
const js = ['src/data.js', 'src/logic.js', 'src/app.js'].map(f => '<script>\n' + r(f) + '\n</script>').join('\n');
fs.writeFileSync('index.html', fs.readFileSync('src/template.html', 'utf8').replace('<!--SCRIPTS-->', () => js));
console.log('index.html built');
