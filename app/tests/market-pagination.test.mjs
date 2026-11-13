import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { create } from 'zustand';
const require = createRequire(import.meta.url);
function compile(file, mocks, extra = {}) {
 const exports = {};
 const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code, {exports,Error,...extra,require:id=>id in mocks?mocks[id]:require(id)});
 return exports;
}
function store(getStocks, searchStocks = async () => []) {
 return compile('../store/market-store.ts', {'zustand':{create},'@/services':{getStocks,getTrendingStocks:async()=>[],getMarketOpportunities:async()=>[],searchStocks}}).useMarketStore;
}
const page = (ids, hasMore) => ({items:ids.map(assetId=>({assetId})),pagination:{hasMore}});
function deferred() {
 let resolve, reject;
 const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
 return { promise, resolve, reject };
}
function searchStore() {
 const pending = new Map();
 const calls = [];
 const market = store(async () => page([], false), query => {
  calls.push(query);
  const result = deferred();
  pending.set(query, result);
  return result.promise;
 });
 return { market, pending, calls };
}
const searchIds = market => Array.from(market.getState().searchResults, stock => stock.assetId);

test('pagination preserves rows and retries the failed page without skipping or duplicating stocks', async()=>{
 const calls=[]; let fail=true;
 const market=store(async p=>{calls.push(p);if(p===1)return page(['a','mcd'],true);if(fail){fail=false;throw new Error('offline');}return page(['mcd','next'],false);});
 await market.getState().loadMarkets();
 await market.getState().loadNextStocks();
 assert.deepEqual(market.getState().stocks.map(s=>s.assetId),['a','mcd']);
 assert.equal(market.getState().nextPage,2);
 assert.equal(market.getState().isLoadingMore,false);
 assert.equal(market.getState().loadMoreError,'offline');
 await market.getState().loadNextStocks();
 assert.deepEqual(calls,[1,2,2]);
 assert.deepEqual(Array.from(market.getState().stocks,s=>s.assetId),['a','mcd','next']);
 assert.equal(market.getState().hasMore,false);
 assert.equal(market.getState().loadMoreError,undefined);
});

test('simultaneous scroll callbacks request the next page only once', async()=>{
 let release,calls=0;
 const market=store(async()=>{calls++;return new Promise(resolve=>{release=resolve;});});
 const pending=market.getState().loadNextStocks();
 await market.getState().loadNextStocks(); assert.equal(calls,1);
 release(page(['a'],true)); await pending;
});

test('scroll observer attaches after initial rows mount and rearms for subsequent pages', ()=>{
 const slots=[], effects=[], observers=[];
 let cursor=0,loads=0;
 const state={stocks:[],trending:[],opportunities:[],searchResults:[],isLoading:true,isLoadingMore:false,isSearching:false,hasMore:true,loadMarkets(){},search(){},loadNextStocks(){loads++;}};
 const react={
  useState:initial=>[initial,()=>{}], useMemo:fn=>fn(),
  useRef(initial){const i=cursor++;return slots[i]??=( {current:initial} );},
  useEffect(fn,deps){const i=cursor++;if(!slots[i]||deps.some((d,j)=>!Object.is(d,slots[i].deps[j])))effects.push(()=>{slots[i]?.cleanup?.();slots[i]={deps,cleanup:fn()};});},
 };
 class Observer {
  constructor(callback){this.callback=callback;this.disconnected=false;observers.push(this);}
  observe(target){this.target=target;}
  disconnect(){this.disconnected=true;}
 }
 const {MarketsOverview}=compile('../components/markets/markets-overview.tsx',{
  react,'@/store':{useMarketStore:select=>select(state)},'@/services':{},'@/components/ui':{cn:()=>'',formatCurrency:()=>'',formatPercent:()=>'',formatCompactCurrency:()=>''},
  'next/link':{default:'a'},'@hugeicons/react':{},'@hugeicons/core-free-icons':{},
 },{IntersectionObserver:Observer,window:{}});
 const render=()=>{cursor=0;MarketsOverview();while(effects.length)effects.shift()();};
 render(); assert.equal(observers.length,0);
 const sentinel={}; slots[0].current=sentinel;
 state.isLoading=false;state.stocks=[{assetId:'mcd'}];render();
 assert.equal(observers.length,1);assert.equal(observers[0].target,sentinel);
 observers[0].callback([{isIntersecting:true}]);assert.equal(loads,1);
 state.isLoadingMore=true;render();assert.equal(observers[0].disconnected,true);
 state.isLoadingMore=false;state.stocks.push({assetId:'next'});render();assert.equal(observers.length,2);
 state.loadMoreError='offline';render();assert.equal(observers[1].disconnected,true);
 state.loadMoreError=undefined;render();assert.equal(observers.length,3);
 state.hasMore=false;render();assert.equal(observers[2].disconnected,true);
});

test('a new market search drops the previous rows before its request returns', async () => {
 const { market, pending } = searchStore();
 const first = market.getState().search('nvda');
 pending.get('nvda').resolve([{ assetId: 'NVDA' }]);
 await first;
 const second = market.getState().search('aapl');
 assert.deepEqual(searchIds(market), []);
 assert.equal(market.getState().isSearching, true);
 assert.equal(market.getState().error, undefined);
 pending.get('aapl').resolve([{ assetId: 'AAPL' }]);
 await second;
 assert.deepEqual(searchIds(market), ['AAPL']);
 assert.equal(market.getState().isSearching, false);
});

test('an older market search success cannot replace a newer result', async () => {
 const { market, pending } = searchStore();
 const older = market.getState().search('nvda');
 const newer = market.getState().search('aapl');
 pending.get('aapl').resolve([{ assetId: 'AAPL' }]);
 await newer;
 assert.deepEqual(searchIds(market), ['AAPL']);
 assert.equal(market.getState().isSearching, false);
 pending.get('nvda').resolve([{ assetId: 'NVDA' }]);
 await older;
 assert.deepEqual(searchIds(market), ['AAPL']);
 assert.equal(market.getState().isSearching, false);
 assert.equal(market.getState().error, undefined);
});

test('a stale market search rejection does not clear loading for the newer request', async () => {
 const { market, pending } = searchStore();
 const older = market.getState().search('nvda');
 const newer = market.getState().search('aapl');
 pending.get('nvda').reject(new Error('offline'));
 await older;
 assert.equal(market.getState().isSearching, true);
 assert.deepEqual(searchIds(market), []);
 assert.equal(market.getState().error, undefined);
 pending.get('aapl').resolve([{ assetId: 'AAPL' }]);
 await newer;
 assert.deepEqual(searchIds(market), ['AAPL']);
 assert.equal(market.getState().isSearching, false);
 assert.equal(market.getState().error, undefined);
});

test('a stale market search rejection after a newer success leaves that success in place', async () => {
 const { market, pending } = searchStore();
 const older = market.getState().search('nvda');
 const newer = market.getState().search('aapl');
 pending.get('aapl').resolve([{ assetId: 'AAPL' }]);
 await newer;
 pending.get('nvda').reject(new Error('offline'));
 await older;
 assert.deepEqual(searchIds(market), ['AAPL']);
 assert.equal(market.getState().isSearching, false);
 assert.equal(market.getState().error, undefined);
});

test('clearing the market query invalidates a pending search success or rejection', async () => {
 const cleared = searchStore();
 const pendingSuccess = cleared.market.getState().search('nvda');
 assert.equal(cleared.market.getState().isSearching, true);
 await cleared.market.getState().search('   ');
 assert.deepEqual(cleared.calls, ['nvda']);
 assert.deepEqual(searchIds(cleared.market), []);
 assert.equal(cleared.market.getState().isSearching, false);
 cleared.pending.get('nvda').resolve([{ assetId: 'NVDA' }]);
 await pendingSuccess;
 assert.deepEqual(searchIds(cleared.market), []);
 assert.equal(cleared.market.getState().isSearching, false);
 assert.equal(cleared.market.getState().error, undefined);

 const rejected = searchStore();
 const pendingFailure = rejected.market.getState().search('nvda');
 await rejected.market.getState().search('');
 rejected.pending.get('nvda').reject(new Error('offline'));
 await pendingFailure;
 assert.deepEqual(searchIds(rejected.market), []);
 assert.equal(rejected.market.getState().isSearching, false);
 assert.equal(rejected.market.getState().error, undefined);
});

test('the current market search still reports its own rejection and clears loading', async () => {
 const { market, pending } = searchStore();
 const current = market.getState().search('nvda');
 pending.get('nvda').reject(new Error('offline'));
 await current;
 assert.deepEqual(searchIds(market), []);
 assert.equal(market.getState().isSearching, false);
 assert.equal(market.getState().error, 'offline');
});
