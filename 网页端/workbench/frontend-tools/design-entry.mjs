const original='j.value===Zn.Code||d.query.homeEntryMode==="code"&&d.query.autoOpenFigma!=="true"';
const previous='(window.__M0_LOCAL_RUNTIME__&&localStorage.getItem("M0Mode")==="code")||'+original;
export const designEntryCondition='(!(window.__M0_LOCAL_RUNTIME__&&d.query.autoOpenFigma==="true")&&('+previous+'))';

/** A deliberate real-file open takes precedence over the saved Code tab. */
export function patchDesignEntry(source) {
  const count=value=>source.split(value).length-1;
  if(count(designEntryCondition)===2)return source;
  const existing=count(previous)===2?previous:original;
  if(count(existing)!==2)throw new Error('Recovered channel selection changed; expected two Design entry conditions');
  return source.replaceAll(existing,designEntryCondition);
}
