import test from 'node:test'
import assert from 'node:assert/strict'
import { posterPreparationIssues, posterPreparationPrompt, attachmentPeopleDocument } from './personPoster.ts'
import type { PosterPreparation } from './personPoster.ts'
const makeInput = (): PosterPreparation => ({
  template: { id:'t',name:'模板.png',kind:'image',path:'/tmp/template.png',mime:'image/png',size:1 },
  sheet:'人物',originalNickname:'凌云',originalEvent:'',originalTrack:'',
  records:[{row:3,nickname:'👑 A·B-【629】',event:'赛事A',track:'赛道B',images:['/tmp/person.png'],issues:[]}],
})
test('默认只替换昵称，即使表格有赛事和赛道也不擅自启用', () => {
  const input=makeInput(); const text=posterPreparationPrompt(input,'')
  assert.ok(text.includes('👑 A·B-【629】'))
  assert.ok(!text.includes('赛事A'));assert.ok(!text.includes('赛道B'))
  assert.equal(posterPreparationIssues(input).length,0)
})
test('缺图、多图、缺映射目标及重叠原文阻止提交', () => {
  const input=makeInput();input.records[0].images=[]
  assert.throws(()=>posterPreparationPrompt(input,''),/原始照片/)
  input.records[0].images=['a','b'];assert.ok(posterPreparationIssues(input).length)
  input.records[0].images=['a'];input.originalEvent='凌云'
  assert.ok(posterPreparationIssues(input).some(x=>x.includes('同一段')))
  input.originalEvent='原赛事';input.records[0].event=''
  assert.ok(posterPreparationIssues(input).some(x=>x.includes('赛事文案')))
})
test('每条使用同一模板与自己的人物素材，11人分两批且顺序不变', () => {
  const input=makeInput();input.records=Array.from({length:11},(_,i)=>({...input.records[0],row:i+2,nickname:`人物${i}`,images:[`person-${i}.png`]}))
  const text=posterPreparationPrompt(input,'');const data=JSON.parse(text.slice(text.indexOf('{')))
  assert.equal(data.records[9].batch,1);assert.equal(data.records[10].batch,2)
  assert.deepEqual(data.records[10].referenceImages,['/tmp/template.png','person-10.png'])
  assert.equal(data.records[10].frameName,'人物10')
})
test('普通文本不当成人物表',()=>{
  assert.equal(attachmentPeopleDocument({...makeInput().template,text:'{"sheets":[]}'}),undefined)
})
