/* ConnectSukuu money-fit: keeps very large currency figures inside their cards.
   Only acts when a figure actually overflows, so normal values and the desktop layout are untouched. */
(function(){
  if(window.__csMoneyFit)return;window.__csMoneyFit=true;
  var RX=/^\s*(?:GH[S₵]|₵|USD|\$|€|£)\s*-?[\d,.\s]+[KMBkmb]?\s*$/i;
  var SEL='h1,h2,h3,h4,strong,b,span,div,p,td,.value,.amount,[class*=value],[class*=amount],[class*=money],[class*=kpi],[class*=stat]';
  var MIN=11;
  function isMoney(el){
    if(el.children.length>0)return false;
    var t=el.textContent;if(!t||t.length>40)return false;
    if(RX.test(t))return true;
    return t.trim().length<=24&&/^(STRONG|B|H1|H2|H3|H4|SPAN|DIV)$/.test(el.tagName)&&el.scrollWidth>el.clientWidth+1&&el.clientWidth>0;
  }
  function fit(el){
    if(!el.__csBase){el.__csBase=parseFloat(getComputedStyle(el).fontSize)||16;}
    ['font-size','white-space','word-break','overflow','text-overflow'].forEach(function(k){el.style.removeProperty(k)});
    var box=el.parentElement,cs=getComputedStyle(el);
    if(cs.display==='inline')el.style.display='inline-block';
    el.style.minWidth='0';el.style.maxWidth='100%';el.style.overflowWrap='anywhere';
    var limit=function(){
      var w=el.scrollWidth,cw=el.clientWidth,pw=box?box.clientWidth:0;
      var r=el.getBoundingClientRect(),br=box?box.getBoundingClientRect():null;
      return w>cw+1||(br&&r.right>br.right+1&&pw>0);
    };
    var size=el.__csBase,guard=0;
    while(limit()&&size>MIN&&guard++<30){size=Math.max(MIN,size-1);el.style.setProperty('font-size',size+'px','important');}
    if(limit()){el.style.setProperty('white-space','normal','important');el.style.setProperty('word-break','break-all','important');el.style.setProperty('overflow','visible','important');el.style.setProperty('text-overflow','clip','important');}
    if(size>=el.__csBase)el.style.removeProperty('font-size');
  }
  function run(){
    var list=document.querySelectorAll(SEL);
    for(var i=0;i<list.length;i++){var el=list[i];if(isMoney(el)){try{fit(el)}catch(e){}}}
  }
  var t=null;function sched(){clearTimeout(t);t=setTimeout(run,120);}
  function start(){run();
    try{new MutationObserver(sched).observe(document.body,{childList:true,subtree:true,characterData:true});}catch(e){}
    window.addEventListener('resize',sched);window.addEventListener('load',sched);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
