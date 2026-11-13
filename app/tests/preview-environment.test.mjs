import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadApi(origin) {
  const exports={};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../services/api-client.ts',import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText,{exports,URL,process:{env:{NEXT_PUBLIC_OREN_API_URL:origin}},window:{location:{origin:'https://pr-42.preview.example.com'}}});
  return exports;
}
test('preview API URLs stay on the preview origin and preserve API prefix and query',()=>{
  const api=loadApi('/api');
  assert.equal(api.buildApiUrl('/stocks/search',{query:'A & B',page:2}).href,'https://pr-42.preview.example.com/api/stocks/search?query=A+%26+B&page=2');
});
test('production absolute API origins remain unchanged',()=>{
  assert.equal(loadApi('https://api.oren.finance/api').buildApiUrl('/stocks').href,'https://api.oren.finance/api/stocks');
});
test('independent app and API Docker contexts agree on the public capability contract',()=>{
  assert.equal(readFileSync(new URL('../types/environment.ts',import.meta.url),'utf8'),readFileSync(new URL('../../api/types/environment.ts',import.meta.url),'utf8'));
});
