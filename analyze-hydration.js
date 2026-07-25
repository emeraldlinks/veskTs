#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function extractHydrationContext() {
    const clientPath = path.join('/tmp/vesk-client.js');
    if (!fs.existsSync(clientPath)) {
        const altPath = path.join('/workspaces/veskTs/test-app/.vesk/static/client.js');
        if (fs.existsSync(altPath)) {
            process.exit(0);
        }
    }
    
    const content = fs.readFileSync(clientPath, 'utf8');
    
    const nextElementPattern = /__hydrate\.nextElement\(([^)]+)\)/g;
    const nextElementMatches = [...content.matchAll(nextElementPattern)];
    
    console.log(`Found ${nextElementMatches.length} __hydrate.nextElement() calls`);
    
    const contexts = [];
    for (const match of nextElementMatches) {
        const fullMatch = match[0];
        const tagMatch = fullMatch.match(/nextElement\(\s*[\'"]([^\'\"]+)[\'\"]/);
        
        if (tagMatch) {
            console.log(`\nnextElement('${tagMatch[1]}'):`);
            const start = Math.max(0, match.index - 200);
            const end = Math.min(content.length, match.index + match[0].length + 100);
            const context = content.substring(start, end).replace(/\n/g, ' ');
            console.log(context);
            console.log("---");
            
            const prevContext = content.substring(Math.max(0, match.index - 500), match.index);
            if (prevContext.includes('p') || prevContext.includes('nav')) {
                console.log(`Previous context: ...${prevContext.substring(Math.max(0, prevContext.length - 200))}`);
            }
            contexts.push(fullMatch);
        }
    }
    
    console.log("\n=== TRY/CATCH ANCHOR PATTERNS ===");
    const patterns = ['document.createComment(\'try\')', 'document.createComment(\'try-end\')'];
    for (const pattern of patterns) {
        const matches = content.match(new RegExp(pattern, 'g')) || [];
        console.log(`\n'${pattern}' appears ${matches.length} times`);
        for (let i = 0; i < Math.min(matches.length, 5); i++) {
            const match = matches[i];
            const start = Math.max(0, content.indexOf(match) - 50);
            const end = Math.min(content.length, content.indexOf(match) + match.length + 50);
            console.log(`  ${i}: ...${content.substring(start, end)}...`);
        }
    }
    
    console.log("\n=== INSERT BEFORE PATTERNS ===");
    const insertPattern = /__p\.insertBefore\([^,]+,\s*\$n[0-9]+\)/g;
    for (const match of content.matchAll(insertPattern)) {
        console.log(`  ${match[0]}`);
    }
}

extractHydrationContext();
