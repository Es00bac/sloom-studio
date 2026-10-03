"use strict";
const root=document.documentElement;
root.classList.add("enhanced");
const preference=matchMedia("(prefers-reduced-motion: reduce)");
const motionButton=document.querySelector(".motion-toggle");
const ambient=document.querySelector(".ambient-video");
const films=[...document.querySelectorAll(".trailer-player video")];
let motionPaused=preference.matches,heroVisible=true,rigs=[];
let pageGeometry={crew:0,hive:0,guide:0};
const clamp=value=>Math.max(0,Math.min(1,value));
const offset=element=>element.getBoundingClientRect().top+scrollY;
function measurePage(){
  pageGeometry={crew:offset(document.querySelector(".crew-dossier")),hive:offset(document.querySelector(".hive-heading")),guide:offset(document.querySelector("#field-guide"))};
  updateScroll();
}
function updateScroll(){
  const y=scrollY+innerHeight*.6;
  const grow=clamp((y-(pageGeometry.crew+180))/(pageGeometry.hive-pageGeometry.crew-80));
  const retreat=1-clamp((y-(pageGeometry.guide-innerHeight*.4))/(innerHeight*.5));
  let infestation=Math.min(grow,retreat);
  if(motionPaused)infestation=y>pageGeometry.hive&&y<pageGeometry.guide ? .42 : 0;
  root.style.setProperty("--infestation",infestation.toFixed(4));
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
  motionButton.setAttribute("aria-pressed",String(motionPaused));
  motionButton.querySelector(".motion-label").textContent=preference.matches?"Reduced motion":motionPaused?"Resume motion":"Pause motion";
  motionButton.disabled=preference.matches;
  rigs.forEach(rig=>rig.setPaused(motionPaused));
  if(motionPaused)document.querySelectorAll(".reveal").forEach(item=>item.classList.add("is-visible"));
  manageAmbient();updateScroll();
}
motionButton.addEventListener("click",()=>{motionPaused=!motionPaused;applyMotion();});
preference.addEventListener("change",()=>{motionPaused=preference.matches;applyMotion();});
document.addEventListener("visibilitychange",()=>{manageAmbient();rigs.forEach(rig=>rig.setDocumentVisible(!document.hidden));});

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
  const buttons=[...group.querySelectorAll("[data-select]")],panels=[...group.querySelectorAll("[data-panel]")],viewButtons=[...group.querySelectorAll("[data-portrait-select]")];
  function refreshRig(){
    panels.forEach(panel=>{
      if(panel.originRig)panel.originRig.setActive(!panel.hidden&&group.dataset.portraitView==="illustrated");
      const caption=panel.querySelector("figcaption");
      if(!caption.dataset.engineCaption)caption.dataset.engineCaption=caption.textContent;
      const illustrated=group.dataset.portraitView==="illustrated"&&Boolean(panel.querySelector(".rig-canvas.is-ready"));
      panel.querySelector("figure>img").setAttribute("aria-hidden",String(illustrated));
      caption.textContent=illustrated?"Illustrated character · animated artwork":caption.dataset.engineCaption;
    });
  }
  function select(button){
    buttons.forEach(item=>item.setAttribute("aria-pressed",String(item===button)));
    panels.forEach(panel=>{panel.hidden=panel.dataset.panel!==button.dataset.select;panel.classList.toggle("is-selected",!panel.hidden);});
    refreshRig();measurePage();
  }
  buttons.forEach(button=>{
    const photo=panels.find(panel=>panel.dataset.panel===button.dataset.select).querySelector("figure>img");
    button.style.setProperty("--portrait",`url("${photo.getAttribute("src")}")`);
    button.addEventListener("click",()=>select(button));
    button.addEventListener("keydown",event=>{
      const index=buttons.indexOf(button);let next=null;
      if(event.key==="ArrowRight")next=buttons[(index+1)%buttons.length];
      if(event.key==="ArrowLeft")next=buttons[(index-1+buttons.length)%buttons.length];
      if(event.key==="Home")next=buttons[0];if(event.key==="End")next=buttons.at(-1);
      if(next){event.preventDefault();next.focus();select(next);}
    });
  });
  function selectView(view){group.dataset.portraitView=view;viewButtons.forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.portraitSelect===view)));refreshRig();measurePage();}
  viewButtons.forEach(button=>button.addEventListener("click",()=>{group.dataset.viewChosen="true";selectView(button.dataset.portraitSelect);}));
  group.selectPortraitView=selectView;
  select(buttons[0]);
  group.refreshRig=refreshRig;
});

fetch("rig-configs.json?v=20261003-cinema-02").then(response=>{if(!response.ok)throw Error("Rig configuration unavailable");return response.json();}).then(configs=>{
  document.querySelectorAll("[data-hero-rig]").forEach(canvas=>{
    const rig=new window.OriginPortraitRig(canvas,configs.characters[canvas.dataset.heroRig]);rigs.push(rig);rig.setPaused(motionPaused);rig.setActive(true);rig.ready.then(()=>canvas.classList.add("is-ready")).catch(()=>{});
  });
  document.querySelectorAll("[data-rig]").forEach(canvas=>{
    const config=configs.characters[canvas.dataset.rig],panel=canvas.closest("[data-panel]"),group=canvas.closest("[data-dossier]");
    if(!config)return;
    const rig=new window.OriginPortraitRig(canvas,config);panel.originRig=rig;rigs.push(rig);
    rig.setPaused(motionPaused);rig.setDocumentVisible(!document.hidden);
    rig.ready.then(()=>{canvas.classList.add("is-ready");if(!panel.hidden&&!group.dataset.viewChosen)group.selectPortraitView("illustrated");group.refreshRig();}).catch(()=>{group.classList.add("art-unavailable");});
  });
  groups.forEach(group=>group.refreshRig());
}).catch(()=>{});

window.OriginSiteMotion={get infestation(){return Number(getComputedStyle(root).getPropertyValue("--infestation"));},get rigs(){return rigs;},measure:measurePage};
applyMotion();document.fonts.ready.then(measurePage);addEventListener("load",measurePage);
