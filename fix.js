const fs = require('fs');
let content = fs.readFileSync('app/renderer/app.js', 'utf8');
content = content.replace(/<td><button class="ghost" onclick="editRef/g, '<td style="white-space:nowrap; text-align:right"><button class="ghost" onclick="editRef');
fs.writeFileSync('app/renderer/app.js', content, 'utf8');
console.log('Replaced successfully');
