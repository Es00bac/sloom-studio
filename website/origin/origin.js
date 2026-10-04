"use strict";
const root=document.documentElement;
root.classList.add("enhanced");
const preference=matchMedia("(prefers-reduced-motion: reduce)");
const motionButton=document.querySelector(".motion-toggle");
const ambient=document.querySelector(".ambient-video");
const films=[...document.querySelectorAll(".trailer-player video")];
let motionPaused=preference.matches,heroVisible=true,rigs=[];
const clamp=value=>Math.max(0,Math.min(1,value));
function measurePage(){
  window.OriginSeedweb?.measure();
  updateScroll();
}
function updateScroll(){
  document.querySelector(".reading-progress").style.transform=`scaleX(${clamp(scrollY/(document.documentElement.scrollHeight-innerHeight))})`;
  if(!motionPaused&&innerWidth>900)document.querySelector(".hero-art").style.translate=`0 ${Math.min(scrollY*.035,28)}px`;
}
let scrollScheduled=false;
addEventListener("scroll",()=>{if(!scrollScheduled){scrollScheduled=true;requestAnimationFrame(()=>{updateScroll();scrollScheduled=false;});}},{passive:true});
addEventListener("resize",measurePage);
if("ResizeObserver" in window)new ResizeObserver(entries=>{
  root.style.setProperty("--header-height",`${entries[0].target.getBoundingClientRect().height}px`);
}).observe(document.querySelector(".masthead"));
if("ResizeObserver" in window)new ResizeObserver(measurePage).observe(document.querySelector("main"));

const menu=document.querySelector(".nav-toggle"),nav=document.querySelector("#navigation");
function closeMenu(){menu.setAttribute("aria-expanded","false");nav.classList.remove("is-open");}
menu.addEventListener("click",()=>{const open=menu.getAttribute("aria-expanded")!=="true";menu.setAttribute("aria-expanded",String(open));nav.classList.toggle("is-open",open);});
nav.querySelectorAll("a").forEach(link=>link.addEventListener("click",closeMenu));
document.addEventListener("keydown",event=>{if(event.key==="Escape"&&menu.getAttribute("aria-expanded")==="true"){closeMenu();menu.focus();}});

function manageAmbient(){
  if(!ambient)return;
  const allowed=!motionPaused&&heroVisible&&innerWidth>700&&!document.hidden&&!navigator.connection?.saveData&&!films.some(film=>!film.paused);
  if(allowed){if(!ambient.src)ambient.src=ambient.dataset.src;ambient.play().catch(()=>{});}else if(!ambient.paused)ambient.pause();
}
ambient?.addEventListener("playing",()=>ambient.classList.add("has-played"));
films.forEach(film=>{
  film.addEventListener("play",()=>{films.forEach(other=>{if(other!==film)other.pause();});manageAmbient();});
  film.addEventListener("pause",manageAmbient);film.addEventListener("ended",manageAmbient);
});
function applyMotion(){
  root.classList.toggle("motion-enabled",!motionPaused);
  root.classList.toggle("motion-paused",motionPaused);
  motionButton.querySelector("span[aria-hidden]").textContent=motionPaused&&!preference.matches?"▶":"Ⅱ";
  motionButton.querySelector(".motion-label").textContent=preference.matches?"Animations paused":motionPaused?"Play animations":"Pause animations";
  motionButton.disabled=preference.matches;
  motionButton.setAttribute("aria-label",preference.matches?"Animations paused by your reduced-motion preference":motionPaused?"Play character and page animations":"Pause character and page animations");
  rigs.forEach(rig=>rig.setPaused(motionPaused));
  window.OriginSeedweb?.setPaused(motionPaused);
  if(motionPaused)document.querySelectorAll(".reveal").forEach(item=>item.classList.add("is-visible"));
  manageAmbient();updateScroll();
}
motionButton.addEventListener("click",()=>{motionPaused=!motionPaused;applyMotion();});
preference.addEventListener("change",()=>{motionPaused=preference.matches;applyMotion();});
document.addEventListener("visibilitychange",()=>{manageAmbient();rigs.forEach(rig=>rig.setDocumentVisible(!document.hidden));window.OriginSeedweb?.setDocumentVisible(!document.hidden);});

const revealObserver="IntersectionObserver" in window?new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add("is-visible");revealObserver.unobserve(entry.target);}}),{threshold:.05,rootMargin:"0px 0px -15px 0px"}):null;
document.querySelectorAll(".reveal").forEach(item=>{if(revealObserver)revealObserver.observe(item);else item.classList.add("is-visible");});
if("IntersectionObserver" in window)new IntersectionObserver(entries=>{heroVisible=entries[0].isIntersecting;manageAmbient();},{threshold:0}).observe(document.querySelector(".hero"));

const worldButtons=[...document.querySelectorAll("[data-world-select]")],worldImages=[...document.querySelectorAll("[data-world-image]")];
worldButtons.forEach(button=>button.addEventListener("click",()=>{
  worldButtons.forEach(item=>item.setAttribute("aria-pressed",String(item===button)));
  worldImages.forEach(image=>{image.hidden=image.dataset.worldImage!==button.dataset.worldSelect;image.classList.toggle("is-selected",!image.hidden);});
}));

const techButtons=[...document.querySelectorAll("[data-tech-select]")],techPanels=[...document.querySelectorAll("[data-tech-panel]")];
function selectTech(button){techButtons.forEach(item=>item.setAttribute("aria-pressed",String(item===button)));techPanels.forEach(panel=>panel.hidden=panel.dataset.techPanel!==button.dataset.techSelect);measurePage();}
techButtons.forEach(button=>button.addEventListener("click",()=>selectTech(button)));
selectTech(techButtons[0]);

const groups=[...document.querySelectorAll("[data-dossier]")];
groups.forEach(group=>{
  const panels=[...group.querySelectorAll("[data-panel]")];
  group.refreshRig=()=>panels.forEach(panel=>{
    panel.hidden=false;
    if(panel.originRig)panel.originRig.setActive(true);
  });
  group.refreshRig();
});

const rigRepairPreview=new URLSearchParams(location.search).get("rig-preview")==="1";
const castAnimationApproved=false;
if(castAnimationApproved||rigRepairPreview)fetch("rig-configs.json?v=20261004-menu-anatomy-01").then(response=>{if(!response.ok)throw Error("Rig configuration unavailable");return response.json();}).then(configs=>{
  const mount=canvas=>{
    if(canvas.originRig)return;
    const config=configs.characters[canvas.dataset.rig||canvas.dataset.heroRig],panel=canvas.closest("[data-panel]"),group=canvas.closest("[data-dossier]");
    if(!config)return;
    const rig=new window.OriginPortraitRig(canvas,config);canvas.originRig=rig;if(panel)panel.originRig=rig;rigs.push(rig);
    rig.setPaused(motionPaused);rig.setDocumentVisible(!document.hidden);
    if(!group)rig.setActive(true);
    rig.ready.then(()=>{canvas.closest(".illustration-stage")?.style.setProperty("--portrait-fit",String(config.action?.fit||.94));canvas.classList.add("is-ready");group?.refreshRig();measurePage();}).catch(()=>{group?.classList.add("art-unavailable");});
  };
  const nearby="IntersectionObserver" in window?new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){nearby.unobserve(entry.target);mount(entry.target);}}),{rootMargin:"450px",threshold:0}):null;
  document.querySelectorAll("[data-rig],[data-hero-rig]").forEach(canvas=>{
    if(!canvas.getBoundingClientRect().width)return;
    if(nearby)nearby.observe(canvas);else mount(canvas);
  });
  groups.forEach(group=>group.refreshRig());
}).catch(()=>{});

window.OriginSiteMotion={get infestation(){return window.OriginSeedweb?.debugSummary().coverage||0;},get rigs(){return rigs;},measure:measurePage};
applyMotion();document.fonts.ready.then(measurePage);addEventListener("load",measurePage);
