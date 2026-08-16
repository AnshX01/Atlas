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
files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  // First match className="..."
  content = content.replace(/className=(['"])(.*?)\1/g, (match, quote, classes) => {
    const newClasses = classes.split(/\s+/).filter(c => !c.startsWith('border') || c.startsWith('border-radius') || c.startsWith('border-box')).join(' ');
    return `className=${quote}${newClasses}${quote}`;
  });
  // Then match className={...}
  content = content.replace(/className=\{([^}]+)\}/g, (match, inner) => {
    let newInner = inner.replace(/(['"`])(.*?)\1/g, (m, q, str) => {
      const replaced = str.split(/\s+/).filter(c => !c.startsWith('border') || c.startsWith('border-radius') || c.startsWith('border-box')).join(' ');
      return `${q}${replaced}${q}`;
    });
    return `className={${newInner}}`;
  });
  fs.writeFileSync(file, content);
});
console.log('Removed border classes from all TSX files safely.');
