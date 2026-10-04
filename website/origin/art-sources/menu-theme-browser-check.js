(() => {
  const query = new URLSearchParams(location.search);
  const name = query.get('case') || 'hero';
  const errors = [];
  addEventListener('error', event => errors.push(event.message));
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  (async () => {
    while (!document.documentElement.classList.contains('enhanced')) await sleep(60);
    await document.fonts.ready;
    const images = [...document.images].filter(image => !image.src.includes('/__gate'));
    images.forEach(image => image.loading = 'eager');
    await Promise.all(images.map(image => image.complete ? Promise.resolve() : new Promise(resolve => { image.addEventListener('load', resolve, {once:true}); image.addEventListener('error', resolve, {once:true}); })));
    document.querySelectorAll('.reveal').forEach(element => element.classList.add('is-visible'));
    let target = null;
    if (name.includes('threshold')) target = document.querySelector('.seedweb-threshold');
    else if (name.includes('crew')) target = document.querySelector('.roster-heading');
    else if (name.includes('seedweb')) target = document.querySelector('.hive-heading');
    else if (name.includes('factions')) target = document.querySelector('#factions');
    else if (name.includes('guide')) target = document.querySelector('#field-guide');
    if (target) {
      document.querySelector('main').style.position = 'relative';
      document.querySelector('main').style.top = `${-(target.getBoundingClientRect().top - 108)}px`;
    }
    window.OriginSeedweb?.measure();
    window.OriginSeedweb?.setPaused(true);
    await sleep(900);
    const missingImages = images.filter(image => !image.naturalWidth).map(image => image.getAttribute('src'));
    const overflow = [...document.querySelectorAll('main *')].filter(element => { const rect = element.getBoundingClientRect(); return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1); }).map(element => `${element.tagName}.${element.className}`).slice(0,25);
    const report = {name, passed: !errors.length && !missingImages.length && document.documentElement.scrollWidth <= innerWidth, viewport:[innerWidth,innerHeight], scrollWidth:document.documentElement.scrollWidth, errors, missingImages, overflow, title:document.title, headingFont:getComputedStyle(document.querySelector('h2')).fontFamily, bodyFont:getComputedStyle(document.body).fontFamily, cast:document.querySelectorAll('[data-panel]').length, photos:document.querySelectorAll('.actual-scene').length, trailers:document.querySelectorAll('.trailer-player video').length, wordmarks:document.querySelectorAll('.faction-title img').length, supports:[...document.querySelectorAll('[data-seedweb-support]')].map(element=>({id:element.id,kind:element.dataset.supportKind,width:element.dataset.supportWidth,rect:{x:element.getBoundingClientRect().x,y:element.getBoundingClientRect().y,w:element.getBoundingClientRect().width,h:element.getBoundingClientRect().height},network:element.closest('[data-seedweb-network]')?.dataset.seedwebNetwork})), sources:[...document.querySelectorAll('[data-seedweb-source]')].map(element=>({id:element.id,rect:{x:element.getBoundingClientRect().x,y:element.getBoundingClientRect().y,w:element.getBoundingClientRect().width,h:element.getBoundingClientRect().height},network:element.closest('[data-seedweb-network]')?.dataset.seedwebNetwork})), seedweb:window.OriginSeedweb?.debugSummary(), networks:[...document.querySelectorAll('[data-seedweb-network]')].map(element=>{const r=element.getBoundingClientRect(),nodes=(window.OriginSeedweb?.nodes||[]).filter(n=>n.x>=r.left-1&&n.x<=r.right+1&&n.y>=r.top+scrollY-1&&n.y<=r.bottom+scrollY+1),edges=(window.OriginSeedweb?.edges||[]).filter(edge=>nodes.includes(edge.from)&&nodes.includes(edge.to));return{network:element.dataset.seedwebNetwork,reachableNodes:nodes.filter(n=>Number.isFinite(n.arrival)).length,edges:edges.length}}), contacts:[...document.querySelectorAll('.hive-dossier [data-panel]')].map(panel=>{const image=panel.querySelector('.illustration-fallback'),ledge=panel.querySelector('.seedweb-stage-ledge'),r=image.getBoundingClientRect(),l=ledge.getBoundingClientRect(),id=panel.dataset.panel,contact=Number(panel.querySelector('.illustration-stage').dataset.contactFront)||null,size=Math.min(r.width,r.height),sole=contact?r.bottom-(1-contact)*size:null;return{id,contact,size,imageRect:{x:r.x,y:r.y,w:r.width,h:r.height},ledgeRect:{x:l.x,y:l.y,w:l.width,h:l.height},soleY:sole,supportY:l.y+l.height*.25,frontContactY:l.bottom-9,deckDepth:l.height,error:sole===null?null:sole-(l.bottom-9)}}), scripts:[...document.scripts].filter(script => script.src).map(script=>script.getAttribute('src'))};
    if (report.seedweb?.unmountedSockets !== 0) report.passed = false;
    await fetch('/__report', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(report)});
  })().catch(async error => {await fetch('/__report', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name,passed:false,error:String(error)})});});
})();
