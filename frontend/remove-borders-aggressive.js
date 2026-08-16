const fs = require('fs');
const path = require('path');
function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else {
      if (file.endsWith('.tsx') || file.endsWith('.ts')) results.push(file);
    }
  });
  return results;
}
const files = walk('./src');
let count = 0;
files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;
  content = content.replace(/className=(['"])(.*?)\1/g, (match, quote, classes) => {
    const newClasses = classes.split(/\s+/).filter(c => {
      let core = c.replace(/^(focus|hover|group-hover|active|disabled):/, '');
      if (core.startsWith('border') && !core.startsWith('border-radius') && !core.startsWith('border-box')) return false;
      return true;
    }).join(' ');
    return `className=${quote}${newClasses}${quote}`;
  });
  content = content.replace(/className=\{([^}]+)\}/g, (match, inner) => {
    let newInner = inner.replace(/([`'"])(.*?)\1/g, (m, q, str) => {
      const replaced = str.split(/\s+/).filter(c => {
        let core = c.replace(/^(focus|hover|group-hover|active|disabled):/, '');
        if (core.startsWith('border') && !core.startsWith('border-radius') && !core.startsWith('border-box')) return false;
        return true;
      }).join(' ');
      return `${q}${replaced}${q}`;
    });
    return `className={${newInner}}`;
  });
  if (original !== content) {
    fs.writeFileSync(file, content);
    count++;
  }
});
console.log('Modified', count, 'files for borders.');
