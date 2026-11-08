const recent='Ue.value==="home"&&unref(x)?(openBlock(),createElementBlock("section",_hoisted_35,';
const marker='"data-astrix-figma-catalog"';

export function patchHomeFigmaCatalog(source) {
  if(source.includes(marker))return source;
  if(source.split(recent).length!==2)throw Error('Recovered recent Figma section changed; review catalog mount before updating resources.');
  const mount='Ue.value==="home"&&window.__M0_LOCAL_RUNTIME__?(openBlock(),createElementBlock("section",{key:"astrix-catalog",class:"astrix-figma-catalog","data-astrix-figma-catalog":""})):HIDDEN';
  return source.replace(recent,mount.replace('HIDDEN',recent));
}
