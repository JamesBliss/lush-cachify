console.log("=========");
console.log('Injecting Tailwind CSS into ui.html');
const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '../dist/ui.html');
const cssPath = path.join(__dirname, '../dist/style.css'); // Match your build:css output

let html = fs.readFileSync(htmlPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');

// Remove any existing <link rel="stylesheet"> or <script src="https://cdn.tailwindcss.com"></script>
html = html.replace(/<link[^>]*tailwind[^>]*>/gi, '');
html = html.replace(/<script[^>]*tailwindcss[^>]*><\/script>/gi, '');

// Inject the CSS before </head>
html = html.replace(
  /<\/head>/i,
  `<style id="tailwind">\n${css}\n</style>\n</head>`
);

fs.writeFileSync(htmlPath, html, 'utf8');
fs.unlinkSync(cssPath); // Clean up the CSS file
console.log("=========");
console.log('Injected Tailwind CSS into ui.html');