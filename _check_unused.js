const fs = require('fs');
const path = require('path');

function checkDir(d) {
    if (!fs.existsSync(d)) return;
    fs.readdirSync(d).forEach(f => {
        const full = path.join(d, f);
        if (fs.statSync(full).isDirectory() && f !== 'node_modules') { checkDir(full); return; }
        if (!f.endsWith('.js')) return;
        const code = fs.readFileSync(full, 'utf8');
        const imports = [...code.matchAll(/require\(['"]([^'"]+)['"](?:,\s*\{([^}]+)\})?\)/g)];
        imports.forEach(m => {
            if (!m[2]) return;
            const names = m[2].split(',').map(s => s.trim().split(' as ').pop().trim());
            names.forEach(name => {
                if (!name || name === '*') return;
                const count = code.split(name).length - 1;
                if (count <= 1) console.log(path.relative('.', full) + ': unused import "' + name + '"');
            });
        });
    });
}

checkDir('backend');
checkDir('app');
