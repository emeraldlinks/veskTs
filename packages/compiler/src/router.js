import { readdirSync, statSync, existsSync, readFileSync } from 'fs';
import { join, relative, basename } from 'path';
export function extractMiddleware(sourcePath) {
    try {
        if (!existsSync(sourcePath))
            return null;
        const src = readFileSync(sourcePath, 'utf-8');
        const prefixMatch = src.match(/export\s+(?:async\s+)?function\s+middleware\s*\(([\s\S]*?)\)\s*\{/);
        if (!prefixMatch)
            return null;
        const start = prefixMatch.index + prefixMatch[0].length;
        const params = prefixMatch[1];
        let depth = 1;
        let i = start;
        while (i < src.length && depth > 0) {
            if (src[i] === '{')
                depth++;
            else if (src[i] === '}')
                depth--;
            i++;
        }
        const body = src.slice(start, i - 1);
        return `async function middleware(${params}) {\n${body.trim()}\n}`;
    }
    catch {
        return null;
    }
}
export function scanRoutes(appDir, options = {}) {
    if (!existsSync(appDir)) {
        return [];
    }
    return scanDirectory(appDir, appDir, '/', options);
}
function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
export function scanComponents(componentsDir) {
    const map = new Map();
    if (!existsSync(componentsDir))
        return map;
    function walk(dir, prefix) {
        let entries;
        try {
            entries = readdirSync(dir);
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const full = join(dir, entry);
            let stat;
            try {
                stat = statSync(full);
            }
            catch {
                continue;
            }
            if (stat.isDirectory()) {
                if (!entry.startsWith('_')) {
                    walk(full, prefix ? prefix + capitalize(entry) : capitalize(entry));
                }
            }
            else if (entry.endsWith('.vsk')) {
                const name = prefix
                    ? prefix + capitalize(entry.slice(0, -4))
                    : entry.slice(0, -4);
                if (!map.has(name)) {
                    map.set(name, full);
                }
            }
        }
    }
    walk(componentsDir, '');
    return map;
}
function scanDirectory(rootDir, dir, parentPath, options) {
    const nodes = [];
    let entries;
    try {
        entries = readdirSync(dir);
    }
    catch {
        return nodes;
    }
    entries.sort((a, b) => {
        const aIsSpecial = a === 'page.vsk' || a === 'layout.vsk' || a === 'not-found.vsk';
        const bIsSpecial = b === 'page.vsk' || b === 'layout.vsk' || b === 'not-found.vsk';
        if (aIsSpecial && !bIsSpecial)
            return -1;
        if (!aIsSpecial && bIsSpecial)
            return 1;
        return a.localeCompare(b);
    });
    let hasLayout = false;
    let hasPage = false;
    let hasLoading = false;
    let hasError = false;
    let hasNotFound = false;
    let hasMiddleware = false;
    for (const entry of entries) {
        if (entry === 'layout.vsk') {
            hasLayout = true;
            continue;
        }
        if (entry === 'page.vsk') {
            hasPage = true;
            continue;
        }
        if (entry === 'loading.vsk') {
            hasLoading = true;
            continue;
        }
        if (entry === 'error.vsk') {
            hasError = true;
            continue;
        }
        if (entry === 'not-found.vsk') {
            hasNotFound = true;
            continue;
        }
        if (entry === 'middleware.ts') {
            hasMiddleware = true;
            continue;
        }
    }
    let segName = basename(dir);
    let isGroup = segName.startsWith('(') && segName.endsWith(')');
    let isDynamic = segName.startsWith('[') && segName.endsWith(']') && !segName.startsWith('[...');
    let isCatchAll = segName.startsWith('[...') && segName.endsWith(']');
    let isPrivate = segName.startsWith('_');
    if (isPrivate && dir !== rootDir)
        return nodes;
    let seg = '';
    if (dir === rootDir) {
        seg = '';
    }
    else if (isGroup) {
        seg = '';
    }
    else if (isDynamic) {
        seg = ':' + segName.slice(1, -1);
    }
    else if (isCatchAll) {
        seg = ':' + segName.slice(4, -1);
    }
    else {
        seg = segName;
    }
    const fullPath = seg
        ? (parentPath === '/' ? '/' : parentPath + '/') + seg
        : (parentPath || '/');
    const node = {
        path: seg,
        fullPath: fullPath.replace(/\/+/g, '/') || '/',
        isGroup,
        isDynamic,
        isCatchAll,
        page: hasPage ? extractComponentName(dir, 'page', rootDir) : null,
        layout: hasLayout ? extractComponentName(dir, 'layout', rootDir) : null,
        loading: hasLoading ? extractComponentName(dir, 'loading', rootDir) : null,
        error: hasError ? extractComponentName(dir, 'error', rootDir) : null,
        notFound: hasNotFound ? extractComponentName(dir, 'not-found', rootDir) : null,
        hasMiddleware,
        children: [],
        sourceDir: dir,
        segmentCount: isGroup || dir === rootDir ? 0 : 1,
    };
    for (const entry of entries) {
        const entryPath = join(dir, entry);
        let entryStat;
        try {
            entryStat = statSync(entryPath);
        }
        catch {
            continue;
        }
        if (entryStat.isDirectory()) {
            const childNodes = scanDirectory(rootDir, entryPath, fullPath, options);
            node.children.push(...childNodes);
        }
    }
    if (node.page || node.layout || node.children.length > 0) {
        nodes.push(node);
    }
    return nodes;
}
function extractComponentName(dir, type, rootDir) {
    const rel = relative(rootDir, dir);
    const parts = rel.split('/').filter(Boolean);
    const clean = parts.map(p => {
        return p.replace(/[\[\]()\.]/g, '').replace(/^\.+/, '');
    });
    const suffix = clean.length > 0 ? clean.join('_') : 'index';
    const capitalized = suffix.charAt(0).toUpperCase() + suffix.slice(1);
    if (type === 'page')
        return 'Page_' + capitalized;
    if (type === 'layout')
        return 'Layout_' + capitalized;
    if (type === 'loading')
        return 'Loading_' + capitalized;
    if (type === 'error')
        return 'Error_' + capitalized;
    if (type === 'not-found')
        return 'NotFound_' + capitalized;
    return type + '_' + capitalized;
}
export function collectSources(tree) {
    const map = new Map();
    function walk(nodes) {
        for (const node of nodes) {
            if (node.page)
                map.set(node.page, join(node.sourceDir, 'page.vsk'));
            if (node.layout)
                map.set(node.layout, join(node.sourceDir, 'layout.vsk'));
            if (node.loading)
                map.set(node.loading, join(node.sourceDir, 'loading.vsk'));
            if (node.error)
                map.set(node.error, join(node.sourceDir, 'error.vsk'));
            if (node.notFound)
                map.set(node.notFound, join(node.sourceDir, 'not-found.vsk'));
            walk(node.children);
        }
    }
    walk(tree);
    return map;
}
export function generateRouteManifest(tree, options = {}) {
    const prefix = options.importPrefix || './';
    function genNode(node, _isRoot = false) {
        const parts = [];
        if (node.page)
            parts.push(`page: ${node.page}`);
        if (node.layout)
            parts.push(`layout: ${node.layout}`);
        if (node.loading)
            parts.push(`loading: ${node.loading}`);
        if (node.error)
            parts.push(`error: ${node.error}`);
        if (node.notFound)
            parts.push(`notFound: ${node.notFound}`);
        if (node.children.length > 0) {
            const childCodes = node.children.map(c => genNode(c));
            parts.push(`children: [\n${childCodes.map(c => '\t\t' + c).join(',\n')}\n\t]`);
        }
        const pathStr = JSON.stringify(node.fullPath);
        const groupStr = node.isGroup ? `, isGroup: true` : '';
        return `{ path: ${pathStr}${groupStr}, ${parts.join(', ')} }`;
    }
    const nodeCodes = tree.map(n => genNode(n));
    const components = flattenSources(tree);
    let code = `// Auto-generated route manifest — do not edit\n\n`;
    for (const [name, sourcePath] of components) {
        code += `import { ${name} } from '${prefix}${sourcePath}';\n`;
    }
    code += `\n`;
    code += `const __routeTree = [\n`;
    code += nodeCodes.map(c => '\t' + c).join(',\n');
    code += `\n];\n\n`;
    code += `export default __routeTree;\n`;
    return code;
}
function flattenSources(tree) {
    const map = new Map();
    function walk(nodes) {
        for (const node of nodes) {
            if (node.page)
                map.set(node.page, node.sourceDir + '/page.vsk');
            if (node.layout)
                map.set(node.layout, node.sourceDir + '/layout.vsk');
            if (node.loading)
                map.set(node.loading, node.sourceDir + '/loading.vsk');
            if (node.error)
                map.set(node.error, node.sourceDir + '/error.vsk');
            if (node.notFound)
                map.set(node.notFound, node.sourceDir + '/not-found.vsk');
            walk(node.children);
        }
    }
    walk(tree);
    return map;
}
export function matchUrl(tree, pathname) {
    const parts = pathname.split('/').filter(Boolean);
    const chain = [];
    const params = {};
    const rootNode = tree.find(n => n.fullPath === '/');
    if (rootNode) {
        chain.push(rootNode);
    }
    function matchNodes(nodes, partIndex) {
        for (const node of nodes) {
            if (node.isGroup) {
                if (matchNodes(node.children, partIndex)) {
                    if (node.layout)
                        chain.push(node);
                    return true;
                }
                continue;
            }
            if (node.fullPath === '/') {
                return matchNodes(node.children, partIndex);
            }
            if (partIndex >= parts.length) {
                if (node.page) {
                    chain.push(node);
                    return true;
                }
                continue;
            }
            const part = parts[partIndex];
            if (node.isCatchAll) {
                const paramName = node.path.startsWith(':') ? node.path.slice(1) : node.path;
                params[paramName] = parts.slice(partIndex).map(decodeURIComponent).join('/');
                chain.push(node);
                return true;
            }
            if (node.isDynamic) {
                const paramName = node.path.startsWith(':') ? node.path.slice(1) : node.path;
                params[paramName] = decodeURIComponent(part);
                chain.push(node);
                if (node.children.length > 0) {
                    if (matchNodes(node.children, partIndex + 1))
                        return true;
                }
                else if (node.page) {
                    return true;
                }
                chain.pop();
                delete params[paramName];
                continue;
            }
            if (node.path === part) {
                chain.push(node);
                if (node.children.length > 0) {
                    if (matchNodes(node.children, partIndex + 1))
                        return true;
                }
                else if (node.page) {
                    return true;
                }
                chain.pop();
                continue;
            }
        }
        return false;
    }
    if (rootNode) {
        const matched = matchNodes(rootNode.children, 0);
        if (!matched && parts.length === 0) {
            return { nodes: chain, params };
        }
        if (!matched)
            return null;
    }
    else {
        const matched = matchNodes(tree, 0);
        if (!matched)
            return null;
    }
    return { nodes: chain, params };
}
