// Review R1 (B1): no page, component or route may send people to a retired page. Roadmap 13.3 deleted
// /dashboard, but first-run setup, the workspace switcher and the not-found page still linked to it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {RETIRED_PAGE_PATHS} from '../config/http-boundary.mjs';

function files(dir:string):string[]{return readdirSync(dir).flatMap(n=>{const p=join(dir,n);return statSync(p).isDirectory()?files(p):/\.(ts|tsx)$/.test(n)?[p]:[];});}

test('review R1: no link, redirect or location change targets a retired page', () => {
 const hits:string[]=[];
 for(const file of [...files('app'),...files('components'),...files('lib')]){
  const text=readFileSync(file,'utf8');
  for(const path of RETIRED_PAGE_PATHS){
   // A quoted path literal such as "/dashboard" or '/dashboard?x', not a longer path like /dashboards.
   const re=new RegExp(`["'\`]/${path.replace(/[/[\]]/g,'\\$&')}(?:[?#"'\`])`);
   if(re.test(text))hits.push(`${file}: /${path}`);
  }
 }
 assert.deepEqual(hits,[],'retired pages are linked');
});
