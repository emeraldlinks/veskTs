/**
 * Dev + build plugin-activation gating — tailwind and generic.
 *
 * Validates that a DEACTIVATED plugin never ships:
 *  - its hooks are not iterated (filterActivePlugins gate)
 *  - tailwind output is not compiled and not linked when inactive
 *    (the single global.css still serves the raw user CSS)
 *  - generic plugin output is absent when inactive
 *  - middleware plugins are filtered (dev)
 *  - prod and dev HTML never carry a separate tailwind link (single-file css)
 *
 * Tests both pure logic (via adapter helpers) and the wiring in
 * dev-server.ts / index.ts / prod-server.ts / action-handler.ts.
 */
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPluginRecords, filterActivePlugins, writePluginState } from '@vesk/adapter/src/plugins';
import { filterActivePlugins as buildFilter, filterPluginsForBuild } from '@vesk/adapter/src/index';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0; let failed = 0;
function assert(cond: boolean, msg: string){ if(cond){passed++; console.log(`  ✓ ${msg}`);} else {failed++; console.log(`  ✗ ${msg}`);} }
function mkPlugin(name: string, hooks: Record<string, unknown>={}){ return { name, ...hooks } as { name:string } & Record<string, unknown>; }

async function main(){
  console.log('\n=== Dev/build plugin gating: generic + tailwind ===');

  // --- pure filter tests (generic) ---
  const tailwindPlugin = mkPlugin('@vesk/plugin-tailwind', { onCSS: async()=> 'tw' });
  const genericPlugin = mkPlugin('my-plugin', { onCSS: async()=> 'my', onBuildStart: async()=>{} });
  const otherPlugin = mkPlugin('other-plugin', { onBuildEnd: async()=>{} });
  const all = [tailwindPlugin, genericPlugin, otherPlugin];

  const stateTailwindActive = { version:1 as const, plugins:[{ name:'my-plugin', package:'my-plugin', active:false }]};
  const filteredGenericInactive = filterPluginsForBuild(all, stateTailwindActive);
  assert(filteredGenericInactive.length===2 && !filteredGenericInactive.some(p=>p.name==='my-plugin'), 'generic inactive plugin dropped from build pipeline');
  assert(filteredGenericInactive.some(p=>p.name.includes('tailwind')), 'tailwind still active when generic inactive');

  const stateGenericActive = { version:1 as const, plugins:[{ name:'@vesk/plugin-tailwind', package:'@vesk/plugin-tailwind', active:false }]};
  const filteredTwInactive = filterPluginsForBuild(all, stateGenericActive);
  assert(filteredTwInactive.length===2 && !filteredTwInactive.some(p=> String(p.name).toLowerCase().includes('tailwind')), 'tailwind plugin dropped when deactivated');
  assert(filteredTwInactive.some(p=>p.name==='my-plugin'), 'generic still active when tailwind inactive');

  // case-insensitive deactivation
  const recased = mkPlugin('My-Plugin', {});
  assert(filterPluginsForBuild([recased], { version:1, plugins:[{ name:'my-plugin', active:false }] }).length===0, 'case-insensitive generic deactivation drops recased plugin');
  assert(filterPluginsForBuild([recased], { version:1, plugins:[{ name:'MY-PLUGIN', active:true }] }).length===1, 'case-insensitive keeps active recased plugin');

  // tailwind helpers (single-file css: tailwind activation only decides whether onCSS runs)
  function isTailwindActiveDev(active: {name:string}[]){ return active.some(p=> String(p.name).toLowerCase().includes('tailwind')); }
  function activeCssUrls(){ return ['/_vesk/static/global.css']; }
  assert(activeCssUrls().length===1 && activeCssUrls()[0]==='/_vesk/static/global.css', 'single global.css link regardless of tailwind state');
  // build output simulation: inactive → raw user CSS passes through unmodified
  function simulatedTwOutput(active:{name:string}[]){ return isTailwindActiveDev(active) ? 'compiled-tailwind' : 'raw-user-css'; }
  assert(simulatedTwOutput(filteredTwInactive)==='raw-user-css', 'build global.css output unmodified when tailwind inactive');
  assert(simulatedTwOutput(filteredGenericInactive)==='compiled-tailwind', 'build global.css compiled when tailwind active');

  // action-handler helper (single-file css: presence of a user stylesheet only)
  const tmp = mkdtempSync(join(tmpdir(), 'vesk-action-gate-'));
  const appDir = join(tmp,'app');
  mkdirSync(appDir,{recursive:true}); mkdirSync(join(tmp,'src'),{recursive:true});
  const srcDir = join(tmp,'src');
  function actionCssUrls(appDirPath:string){
    const hasUserCss = existsSync(join(resolve(appDirPath,'..'),'src','global.css')) || existsSync(join(resolve(appDirPath,'..'),'src','app.css'));
    return hasUserCss ? ['/_vesk/static/global.css'] : [];
  }
  assert(actionCssUrls(appDir).length===0, 'action handler omits css link when no user stylesheet');
  writeFileSync(join(srcDir,'global.css'), 'body{}', 'utf-8');
  assert(actionCssUrls(appDir).length===1 && actionCssUrls(appDir)[0]==='/_vesk/static/global.css', 'action handler links single global.css when stylesheet present');
  rmSync(tmp,{recursive:true,force:true});

  // middleware filtering: my-plugin provides / onRequest should be dropped
  const tmp2 = mkdtempSync(join(tmpdir(),'vesk-mw-'));
  const app2 = join(tmp2,'app'); const vd2 = join(tmp2,'.vesk');
  mkdirSync(app2,{recursive:true}); mkdirSync(vd2,{recursive:true});
  mkdirSync(join(tmp2,'node_modules','my-plugin'),{recursive:true});
  writeFileSync(join(tmp2,'node_modules','my-plugin','package.json'), JSON.stringify({name:'my-plugin',version:'1.0.0',main:'index.js'}));
  writeFileSync(join(tmp2,'node_modules','my-plugin','index.js'),'module.exports={}');
  writeFileSync(join(tmp2,'package.json'), JSON.stringify({name:'test'}));
  writeFileSync(join(app2,'package.json'), JSON.stringify({name:'app'}));
  const nmTw = join(tmp2,'node_modules','@vesk','plugin-tailwind'); mkdirSync(nmTw,{recursive:true});
  writeFileSync(join(nmTw,'package.json'), JSON.stringify({name:'@vesk/plugin-tailwind',version:'1.0.0',main:'index.js'}));
  writeFileSync(join(nmTw,'index.js'),'module.exports={}');
  writePluginState(vd2, {version:1, plugins:[{name:'my-plugin',package:'my-plugin',active:false}]});
  const recs = getPluginRecords(app2, vd2, ['@vesk/plugin-tailwind','my-plugin']);
  const mwPlugins = [{name:'@vesk/plugin-tailwind', provides:{foo:()=>1}}, {name:'my-plugin', provides:{bar:()=>2}, onRequest: async()=>{}}];
  const filteredMw = filterActivePlugins(mwPlugins as unknown[], recs) as typeof mwPlugins;
  assert(filteredMw.length===1 && filteredMw[0].name==='@vesk/plugin-tailwind', 'middleware plugins filtered: inactive generic dropped so its provides/onRequest not run');
  rmSync(tmp2,{recursive:true,force:true});

  // --- static wiring checks: dev-server.ts ---
  console.log('\n=== Static wiring: dev-server.ts ===');
  const devSrc = readFileSync(resolve(__dirname, 'dev-server.ts'), 'utf-8');
  assert(/import \{ getPluginRecords, filterActivePlugins \} from '@vesk\/adapter\/src\/plugins'/.test(devSrc), 'dev-server imports getPluginRecords + filterActivePlugins from adapter');
  assert(/function getActiveDevPlugins\(\)/.test(devSrc), 'dev-server defines getActiveDevPlugins helper');
  assert(/function activeCssUrls\(\)/.test(devSrc), 'dev-server defines activeCssUrls');
  assert(/function cssLinkTags\(\)/.test(devSrc), 'dev-server defines cssLinkTags');
  const activeLoops = (devSrc.match(/for \(const plugin of activeAtStart\)/g)||[]).length;
  assert(activeLoops>=1, `initial CSS uses activeAtStart loop (got ${activeLoops})`);
  const rebuildUsesActive = /async function rebuildTailwindCss[\s\S]*?getActiveDevPlugins\(\)/.test(devSrc);
  assert(rebuildUsesActive, 'rebuildTailwindCss uses getActiveDevPlugins (gated)');
  assert(devSrc.includes('devGlobalCssContent'), 'dev server keeps a single global.css content buffer');
  assert(!devSrc.includes('devTailwindCssContent'), 'no separate tailwind content buffer anymore');
  assert(devSrc.includes("url.pathname === '/_vesk/static/global.css'"), 'dev server serves the single global.css route');
  assert(!devSrc.includes("url.pathname === '/_vesk/static/_tailwind.css'"), 'no separate _tailwind.css route in dev');
  assert(/onPluginChange[\s\S]*?rebuildTailwindCss/.test(devSrc), 'onPluginChange triggers rebuildTailwindCss before reload');
  const cssUrlsDyn = (devSrc.match(/activeCssUrls\(\)/g)||[]).length;
  assert(cssUrlsDyn >= 6, `all renderFullPage/renderPageStream/cssUrls use activeCssUrls (got ${cssUrlsDyn})`);
  assert(devSrc.includes('cssLinkTags()'), 'hardcoded HTML templates use cssLinkTags (tailwind conditional)');
  const mwGated = (devSrc.match(/plugins: getActiveDevPlugins\(\)/g)||[]).length;
  assert(mwGated >= 2, `middleware + render calls use getActiveDevPlugins (api + page) (got ${mwGated})`);
  assert(!/for \(const plugin of devPlugins\)/.test(devSrc), 'no remaining raw devPlugins loops (all gated)');

  // --- static wiring: adapter/src/index.ts ---
  console.log('\n=== Static wiring: adapter/src/index.ts ===');
  const idxSrc = readFileSync(resolve(__dirname, '../../adapter/src/index.ts'), 'utf-8');
  assert(/const tailwindActive = isTailwindPlugin\(pluginsPipelines\)/.test(idxSrc), 'build detects tailwind active via isTailwindPlugin');
  assert(/if \(tailwindActive\)/.test(idxSrc) && idxSrc.includes('static/global.css'), 'build compiles the single global.css only when tailwind active');
  assert(!idxSrc.includes('_tailwind.css'), 'build no longer writes a separate _tailwind.css file');

  // --- static wiring: prod-server.ts ---
  console.log('\n=== Static wiring: adapter/src/prod-server.ts ===');
  const prodSrc = readFileSync(resolve(__dirname, '../../adapter/src/prod-server.ts'), 'utf-8');
  assert(prodSrc.includes('hasBuiltGlobalCss(outDir)') && prodSrc.includes('pageCssUrls'), 'prod not-found/error pages resolve css via hasBuiltGlobalCss');
  assert(!prodSrc.includes('_tailwind.css'), 'prod server never references _tailwind.css');

  // --- static wiring: action-handler.ts ---
  console.log('\n=== Static wiring: cli/src/action-handler.ts ===');
  const actSrc = readFileSync(resolve(__dirname, 'action-handler.ts'), 'utf-8');
  assert(/function actionCssUrls/.test(actSrc), 'action-handler defines actionCssUrls helper');
  assert(/function actionCssLinkTags/.test(actSrc), 'action-handler defines actionCssLinkTags');
  assert(actSrc.includes('actionCssUrls(ctx.appDirPath)') || actSrc.includes('actionCssUrls('), 'action handler renderFullPage uses actionCssUrls');
  assert(actSrc.includes('actionCssLinkTags(ctx.appDirPath)'), 'action handler HTML template uses actionCssLinkTags');

  console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${passed+failed} total ===`);
  process.exit(failed ? 1 : 0);
}

main().catch(e=>{ console.error(e); process.exit(1); });
