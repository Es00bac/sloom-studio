'use strict';
const toggle=document.querySelector('.nav-toggle');
const navigation=document.querySelector('#navigation');
function closeNavigation(){navigation?.classList.remove('open');toggle?.setAttribute('aria-expanded','false')}
toggle?.addEventListener('click',()=>{const open=!navigation.classList.contains('open');navigation.classList.toggle('open',open);toggle.setAttribute('aria-expanded',String(open))});
navigation?.querySelectorAll('a').forEach(link=>link.addEventListener('click',closeNavigation));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&navigation?.classList.contains('open')){closeNavigation();toggle.focus()}});
// Native controls own playback. Starting one film pauses the other; nothing
// downloads or starts playing automatically, and no analytics are injected.
const videos=[...document.querySelectorAll('video')];
videos.forEach(video=>video.addEventListener('play',()=>videos.filter(other=>other!==video).forEach(other=>other.pause())));
