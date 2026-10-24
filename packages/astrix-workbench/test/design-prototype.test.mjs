import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyDocument,createNode,getActivePage,createPage} from '../../../网页端/workbench/canvas/model.mjs';
import {renderPrototype,PROTOTYPE_CSP} from '../../../网页端/workbench/server/design-prototype.mjs';

test('prototype exports cross-page frame links without interpolating executable design text',()=>{
  const document=emptyDocument('离线原型 </title><script>BAD()</script>'),first=createNode('frame');first.id='screen-one';first.name='首页';
  const button=createNode('text',20,100);button.id='link';button.text='下一页 </text><script>BAD()</script>';button.prototype={trigger:'click',targetId:'screen-two'};first.children=[button];getActivePage(document).nodes=[first];
  const next=createPage('第二页'),last=createNode('frame');last.id='screen-two';last.name='详情';next.nodes=[last];document.pages.push(next);
  const html=renderPrototype(document,{startId:last.id});
  assert.match(html,/data-target="1"/);assert.match(html,/id="screen-1"[^>]*aria-label="详情">/);assert.match(html,/&lt;script&gt;BAD\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>BAD\(\)<\/script>/);assert.doesNotMatch(html,/(?:fetch|XMLHttpRequest|WebSocket)\s*\(/);assert.doesNotMatch(html,/(?:src|href)="https?:/);
  assert.match(PROTOTYPE_CSP,/connect-src 'none'/);assert.doesNotMatch(PROTOTYPE_CSP,/allow-same-origin/);
});
test('prototype can display old unframed documents and empty designs',()=>{
  const shape=createNode('rectangle',50,90);shape.width=200;shape.height=100;
  const html=renderPrototype({format:'m0-local-canvas-v1',version:1,name:'旧版',nodes:[shape]});assert.match(html,/class="screen"/);assert.match(html,/width="200" height="100"/);
  const blank=renderPrototype(emptyDocument());assert.match(blank,/还没有可演示的画板/);assert.doesNotMatch(blank,/id="screen-0"/);
});
