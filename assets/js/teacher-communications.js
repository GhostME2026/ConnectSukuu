/* Teacher communications and persistent profile-photo integration. */
(function(){'use strict';
var API=String((typeof API_BASE!=='undefined'&&API_BASE)||window.API_BASE||'http://localhost:4000').replace(/\/$/,'');
var routeName=(location.pathname.replace(/\/+$/,'').split('/').pop()||'/roles/teacher/teacher-dashboard.html').toLowerCase();
var currentFile='/roles/teacher/'+(routeName.indexOf('.html')>=0?routeName:routeName+'.html');
var state={notifications:[],announcements:[],loaded:false,profileLoaded:false,profileLoadInFlight:false};
var photoPickerBound=false;
var routeMap={OWNER:'/roles/owner/owner-dashboard.html',HEAD_TEACHER:'/roles/headteacher/headteacher-dashboard.html',HEAD_OF_ACADEMICS:'/roles/hoa/hoa-dashboard.html',ADMINISTRATOR:'/roles/administrator/administrator-dashboard.html',ACCOUNTANT:'/roles/accountant/accountant-dashboard.html',STUDENT:'/roles/student/student-dashboard.html',PARENT:'/roles/parent/parent-dashboard.html',NURSE:'/roles/nurse/nurse-dashboard.html',SECURITY:'/roles/security/security-dashboard.html'};
function getUser(){try{return (window.AUTH&&AUTH.getUser&&AUTH.getUser())||JSON.parse(localStorage.getItem('cs_user')||'null')||{}}catch(_){return {}}}
function getToken(){try{return (window.AUTH&&AUTH.getToken&&AUTH.getToken())||localStorage.getItem('cs_token')||''}catch(_){return localStorage.getItem('cs_token')||''}}
function saveUser(user){try{localStorage.setItem('cs_user',JSON.stringify(user))}catch(_){}}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function fmt(v){if(!v)return 'Date unavailable';var d=new Date(v);return Number.isNaN(d.getTime())?'Date unavailable':d.toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}
function apiUrl(path){return API+path}
async function request(path,opts){opts=opts||{};var controller=new AbortController();var timer=setTimeout(function(){controller.abort()},15000);try{var headers=Object.assign({'Authorization':'Bearer '+getToken()},opts.headers||{});if(opts.body&&!(opts.body instanceof FormData)&&!headers['Content-Type'])headers['Content-Type']='application/json';var response=await fetch(apiUrl(path),Object.assign({},opts,{headers:headers,signal:controller.signal}));var data=await response.json().catch(function(){return {}});if(!response.ok)throw new Error(data.error||data.message||('Request failed (HTTP '+response.status+').'));return data}catch(error){if(error.name==='AbortError')throw new Error('The request timed out. Please try again.');throw error}finally{clearTimeout(timer)}}
function navMarkup(){return '<div class="nav-label">COMMUNICATIONS</div><a href="/roles/teacher/teacher-announcements.html" data-tc-nav="announcements"><span class="nav-icon">▤</span><span>Announcements</span></a><a href="/roles/teacher/teacher-notifications.html" data-tc-nav="notifications"><span class="nav-icon">♧</span><span>Notifications</span><span class="tc-nav-unread" id="tc-nav-unread" hidden>0</span></a>'}
function avatarInitials(user){var a=(user.firstName||'').trim().charAt(0),b=(user.lastName||'').trim().charAt(0);return (a+b||String(user.email||'T').slice(0,2)).toUpperCase()}
function photoURL(path){if(!path)return '';if(/^https?:\/\//i.test(path)||/^data:image\//i.test(path))return path;return API+'/'+String(path).replace(/^\/+/, '')}
function applyPhoto(user){var avatar=document.querySelector('.csk-teacher-avatar-final');if(!avatar)return;var url=photoURL(user.photoUrl||user.profilePhotoUrl);if(url){avatar.innerHTML='<img src="'+esc(url)+'" alt="Profile photo" class="tc-profile-photo">';avatar.setAttribute('aria-label','Change profile photo');avatar.title='Change profile photo'}else{avatar.textContent=avatarInitials(user);avatar.setAttribute('aria-label','Change profile photo');avatar.title='Change profile photo'}avatar.setAttribute('role','button');avatar.setAttribute('tabindex','0');avatar.style.cursor='pointer'}
function ensurePhotoPicker(){var input=document.getElementById('tc-profile-photo-input');if(!input){input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg,image/webp,image/gif';input.id='tc-profile-photo-input';input.hidden=true;document.body.appendChild(input);input.addEventListener('change',uploadPhoto)}if(photoPickerBound)return;photoPickerBound=true;document.addEventListener('click',function(e){var avatar=e.target.closest&&e.target.closest('.csk-teacher-avatar-final');if(avatar){e.preventDefault();var picker=document.getElementById('tc-profile-photo-input');if(picker)picker.click()}});document.addEventListener('keydown',function(e){if((e.key==='Enter'||e.key===' ')&&e.target&&e.target.matches&&e.target.matches('.csk-teacher-avatar-final')){e.preventDefault();var picker=document.getElementById('tc-profile-photo-input');if(picker)picker.click()}})}
async function uploadPhoto(){var input=document.getElementById('tc-profile-photo-input'),file=input&&input.files&&input.files[0];if(!file)return;if(file.size>5*1024*1024){alert('Choose an image smaller than 5 MB.');input.value='';return}if(!/^image\/(png|jpeg|webp|gif)$/i.test(file.type)){alert('Use a PNG, JPG, WEBP or GIF image.');input.value='';return}var avatar=document.querySelector('.csk-teacher-avatar-final');if(avatar)avatar.style.opacity='.55';try{var form=new FormData();form.append('photo',file);var data=await request('/api/teacher-portal/profile/photo',{method:'POST',body:form});var user=Object.assign({},getUser(),data.user||{});if(data.user&&data.user.photoUrl)user.photoUrl=data.user.photoUrl;saveUser(user);applyPhoto(user);if(avatar)avatar.style.opacity='1';toast('Profile photo saved.')}catch(error){if(avatar)avatar.style.opacity='1';toast(error.message,true)}finally{if(input)input.value=''}}
function toast(message,isError){var el=document.getElementById('tc-toast');if(!el){el=document.createElement('div');el.id='tc-toast';el.className='tc-toast';el.setAttribute('role','status');document.body.appendChild(el)}el.textContent=message;el.classList.toggle('error',!!isError);el.classList.add('show');setTimeout(function(){el.classList.remove('show')},3200)}

function bindPasswordToggles(){
  document.querySelectorAll('[data-password-toggle]').forEach(function(button){
    if(button.dataset.bound==='1')return;
    button.dataset.bound='1';
    button.addEventListener('click',function(){
      var input=document.getElementById(button.getAttribute('data-password-toggle'));
      if(!input)return;
      var reveal=input.type==='password';
      input.type=reveal?'text':'password';
      button.setAttribute('aria-pressed',String(reveal));
      button.setAttribute('aria-label',(reveal?'Hide ':'Show ')+(input.id==='cskProfileCurrent'?'current':'new')+' password');
      button.title=(reveal?'Hide ':'Show ')+(input.id==='cskProfileCurrent'?'current':'new')+' password';
      button.classList.toggle('is-visible',reveal);
    });
  });
}
function ensureTeacherMobileMenu(){
  var side=document.querySelector('.csk-teacher-sidebar-final');
  var header=document.querySelector('.csk-teacher-header-final');
  if(!side||!header)return;
  var button=header.querySelector('.tc-mobile-menu-toggle');
  if(!button){
    button=document.createElement('button');
    button.type='button';button.className='tc-mobile-menu-toggle';
    button.setAttribute('aria-label','Open teacher menu');button.setAttribute('aria-expanded','false');
    button.innerHTML='<span></span><span></span><span></span>';
    header.insertBefore(button,header.firstChild);
    button.addEventListener('click',function(){
      var open=side.classList.toggle('tc-mobile-open');
      document.body.classList.toggle('tc-mobile-menu-open',open);
      button.setAttribute('aria-expanded',String(open));
      button.setAttribute('aria-label',open?'Close teacher menu':'Open teacher menu');
    });
  }
  if(!side.dataset.mobileBound){
    side.dataset.mobileBound='1';
    side.addEventListener('click',function(e){
      if(e.target.closest('a')){side.classList.remove('tc-mobile-open');document.body.classList.remove('tc-mobile-menu-open');var b=document.querySelector('.tc-mobile-menu-toggle');if(b){b.setAttribute('aria-expanded','false');b.setAttribute('aria-label','Open teacher menu')}}
    });
    document.addEventListener('keydown',function(e){if(e.key==='Escape'){side.classList.remove('tc-mobile-open');document.body.classList.remove('tc-mobile-menu-open');var b=document.querySelector('.tc-mobile-menu-toggle');if(b)b.setAttribute('aria-expanded','false')}});
  }
}

function enhanceShell(){
  var nav=document.querySelector('.csk-teacher-nav-final');
  if(nav){
    var ann=nav.querySelector('a[href$="/roles/teacher/teacher-announcements.html"],a[data-tc-nav="announcements"]');
    var noti=nav.querySelector('a[href$="/roles/teacher/teacher-notifications.html"],a[data-tc-nav="notifications"]');
    if(!ann&&!noti){
      var labelExists=Array.prototype.some.call(nav.querySelectorAll('.nav-label'),function(x){return /communications/i.test(x.textContent||'')});
      nav.insertAdjacentHTML('beforeend',(labelExists?'':'<div class="nav-label">COMMUNICATIONS</div>')+
        '<a href="/roles/teacher/teacher-announcements.html" data-tc-nav="announcements"><span class="nav-icon">▤</span><span>Announcements</span></a>'+
        '<a href="/roles/teacher/teacher-notifications.html" data-tc-nav="notifications"><span class="nav-icon">♧</span><span>Notifications</span><span class="tc-nav-unread" id="tc-nav-unread" hidden>0</span></a>');
      ann=nav.querySelector('a[href$="/roles/teacher/teacher-announcements.html"]');
      noti=nav.querySelector('a[href$="/roles/teacher/teacher-notifications.html"]');
    } else {
      if(!ann){nav.insertAdjacentHTML('beforeend','<a href="/roles/teacher/teacher-announcements.html" data-tc-nav="announcements"><span class="nav-icon">▤</span><span>Announcements</span></a>');ann=nav.querySelector('a[href$="/roles/teacher/teacher-announcements.html"]')}
      if(!noti){nav.insertAdjacentHTML('beforeend','<a href="/roles/teacher/teacher-notifications.html" data-tc-nav="notifications"><span class="nav-icon">♧</span><span>Notifications</span><span class="tc-nav-unread" id="tc-nav-unread" hidden>0</span></a>');noti=nav.querySelector('a[href$="/roles/teacher/teacher-notifications.html"]')}
    }
    if(ann)ann.setAttribute('data-tc-nav','announcements');
    if(noti){noti.setAttribute('data-tc-nav','notifications');if(!noti.querySelector('#tc-nav-unread')&&!noti.querySelector('.tc-nav-unread'))noti.insertAdjacentHTML('beforeend','<span class="tc-nav-unread" id="tc-nav-unread" hidden>0</span>')}
    var navKeyByFile={'/roles/teacher/teacher-dashboard.html':'dashboard','/roles/teacher/teacher-attendance.html':'attendance','/roles/teacher/teacher-teaching-assignments.html':'assignments','/roles/teacher/teacher-timetable.html':'timetable','/roles/teacher/teacher-assessments.html':'assessments','/roles/teacher/teacher-learning.html':'learning','/roles/teacher/teacher-announcements.html':'announcements','/roles/teacher/teacher-notifications.html':'notifications'};
    var activeKey=navKeyByFile[currentFile];
    nav.querySelectorAll('a').forEach(function(a){
      var href=(a.getAttribute('href')||'').split('?')[0].toLowerCase();
      var key=a.getAttribute('data-tc-nav')||a.getAttribute('data-t')||a.getAttribute('data-csk-teacher-link')||'';
      if(!key){if(href.endsWith('/roles/teacher/teacher-dashboard.html'))key='dashboard';else if(href.endsWith('/roles/teacher/teacher-attendance.html'))key='attendance';else if(href.endsWith('/roles/teacher/teacher-teaching-assignments.html'))key='assignments';else if(href.endsWith('/roles/teacher/teacher-timetable.html'))key='timetable';else if(href.endsWith('/roles/teacher/teacher-assessments.html'))key='assessments';else if(href.endsWith('/roles/teacher/teacher-learning.html'))key='learning';else if(href.endsWith('/roles/teacher/teacher-announcements.html'))key='announcements';else if(href.endsWith('/roles/teacher/teacher-notifications.html'))key='notifications';}
      if(key)a.classList.toggle('active',key===activeKey);
    });
  }
  var header=document.querySelector('.csk-teacher-header-final');
  var profile=header&&header.querySelector('.csk-teacher-profile-final');
  if(header&&profile){
    var actions=header.querySelector('.tc-header-actions');
    if(!actions){actions=document.createElement('div');actions.className='tc-header-actions';(profile.parentNode||header).insertBefore(actions,profile);actions.appendChild(profile)}
    var bell=actions.querySelector('.tc-bell-link')||header.querySelector('.tc-bell-link');
    if(!bell){bell=document.createElement('a');bell.className='tc-bell-link';bell.href='/roles/teacher/teacher-notifications.html';bell.setAttribute('aria-label','Notifications');bell.title='Notifications';bell.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span class="tc-bell-count" id="tc-header-unread" hidden>0</span>'}
    if(bell.parentElement!==actions)actions.insertBefore(bell,profile);
    if(profile.parentElement!==actions)actions.appendChild(profile);
    actions.classList.add('tc-header-actions');
    header.classList.add('tc-header-communications');
  }
  if(header)header.classList.toggle('tc-communications-page',currentFile==='/roles/teacher/teacher-announcements.html'||currentFile==='/roles/teacher/teacher-notifications.html');
  if(currentFile==='/roles/teacher/teacher-announcements.html'||currentFile==='/roles/teacher/teacher-notifications.html')document.body.classList.add('tc-communications-page');
  ensurePhotoPicker();applyPhoto(getUser());bindPasswordToggles();ensureTeacherMobileMenu();
}
function setUnread(){var count=state.notifications.filter(function(n){return !n.readAt}).length;[document.getElementById('tc-header-unread'),document.getElementById('tc-nav-unread')].forEach(function(el){if(!el)return;el.textContent=count>99?'99+':String(count);el.hidden=!count})}
function empty(title,detail){return '<div class="tc-empty"><strong>'+esc(title)+'</strong><span>'+esc(detail)+'</span></div>'}
function retryStatus(hostId,message){var host=document.getElementById(hostId);if(host)host.innerHTML='<div class="tc-status error"><strong>'+esc(message)+'</strong><button type="button" class="tc-button" data-tc-retry="'+esc(hostId)+'">Try again</button></div>'}
function renderAnnouncements(){var host=document.getElementById('tc-announcements-list');if(!host)return;var total=document.getElementById('tc-announcement-total');if(total)total.textContent=state.announcements.length+' announcement'+(state.announcements.length===1?'':'s');var rows=state.announcements.filter(function(a){var roles=Array.isArray(a.audienceRoles)?a.audienceRoles.map(function(x){return String(x).toUpperCase()}):[];return a.audienceAll===true||roles.includes('TEACHER')});if(!rows.length){host.innerHTML=empty('No announcements yet','General school announcements and announcements specifically for teachers will appear here.');return}host.innerHTML='<div class="tc-list">'+rows.map(function(a){return '<article class="tc-item"><div class="tc-item-icon">▤</div><div class="tc-item-main"><h4 class="tc-item-title">'+esc(a.title||'School announcement')+'</h4><div class="tc-item-content">'+esc(a.content||'')+'</div><div class="tc-item-meta">'+esc(fmt(a.createdAt))+' · '+(a.audienceAll?'<span>General announcement</span>':'<span>For teachers</span>')+'</div></div><div class="tc-item-actions"><a class="tc-button" href="/roles/teacher/teacher-notifications.html">Notifications →</a></div></article>'}).join('')+'</div>'}
function renderNotifications(){var host=document.getElementById('tc-notifications-list');if(!host)return;var total=document.getElementById('tc-notification-total');if(total)total.textContent=state.notifications.length+' notification'+(state.notifications.length===1?'':'s');var filter=document.getElementById('tc-notification-search');var q=(filter&&filter.value||'').trim().toLowerCase();var rows=state.notifications.filter(function(n){return !q||[n.title,n.content,n.type].join(' ').toLowerCase().includes(q)});if(!rows.length){host.innerHTML=empty(q?'No matching notifications':'You are all caught up','Only notifications addressed to your Teacher account are shown here.');return}host.innerHTML='<div class="tc-list">'+rows.map(function(n){return '<article class="tc-item '+(!n.readAt?'unread':'')+'"><div class="tc-item-icon">'+(String(n.type||'').toUpperCase()==='ANNOUNCEMENT'?'▤':String(n.type||'').toUpperCase().includes('ASSESS')?'✓':'♧')+'</div><div class="tc-item-main"><h4 class="tc-item-title">'+esc(n.title||'School notification')+(!n.readAt?'<span class="tc-pill">New</span>':'')+'</h4><div class="tc-item-content">'+esc(n.content||'')+'</div><div class="tc-item-meta">'+esc(fmt(n.createdAt))+' · '+esc(n.readAt?'Read':'Unread')+'</div></div><div class="tc-item-actions">'+(!n.readAt?'<button class="tc-button" type="button" data-tc-read="'+esc(n.id)+'">Mark read</button>':'')+(n.targetUrl&&/^(teacher-|https?:\/\/)/i.test(n.targetUrl)?'<a class="tc-button" href="'+esc(/^https?:\/\//i.test(n.targetUrl)?n.targetUrl:n.targetUrl)+'">Open →</a>':'')+'</div></article>'}).join('')+'</div>'}
async function loadAnnouncements(){var host=document.getElementById('tc-announcements-list');if(!host)return;host.innerHTML='<div class="tc-loading-state">Loading announcements…</div>';var finished=false;var guard=setTimeout(function(){if(!finished&&host.querySelector('.tc-loading-state'))retryStatus('tc-announcements-list','Announcements are taking longer than expected. Check your connection and try again.')},17000);try{var data=await request('/api/teacher-portal/announcements');state.announcements=Array.isArray(data)?data:(data.announcements||[]);finished=true;clearTimeout(guard);renderAnnouncements()}catch(error){finished=true;clearTimeout(guard);retryStatus('tc-announcements-list','Announcements could not be loaded: '+error.message)}}
async function loadNotifications(){try{var data=await request('/api/teacher-portal/notifications');state.notifications=Array.isArray(data)?data:(data.notifications||[]);setUnread();renderNotifications()}catch(error){if(document.getElementById('tc-notifications-list'))retryStatus('tc-notifications-list','Notifications could not be loaded: '+error.message)}}
async function loadProfile(){if(state.profileLoaded||state.profileLoadInFlight)return;state.profileLoadInFlight=true;try{var data=await request('/api/teacher-portal/me');var user=Object.assign({},getUser(),data.user||data);saveUser(user);applyPhoto(user);state.profileLoaded=true}catch(error){applyPhoto(getUser())}finally{state.profileLoadInFlight=false}}
async function markRead(id,button){button.disabled=true;try{await request('/api/teacher-portal/notifications/'+encodeURIComponent(id)+'/read',{method:'PATCH'});var row=state.notifications.find(function(n){return n.id===id});if(row)row.readAt=row.readAt||new Date().toISOString();setUnread();renderNotifications()}catch(error){button.disabled=false;toast(error.message,true)}}
async function markAllRead(button){var unread=state.notifications.filter(function(n){return !n.readAt});if(!unread.length){toast('There are no unread notifications.');return}button.disabled=true;var failed=0;await Promise.all(unread.map(async function(n){try{await request('/api/teacher-portal/notifications/'+encodeURIComponent(n.id)+'/read',{method:'PATCH'});n.readAt=new Date().toISOString()}catch(_){failed++}}));button.disabled=false;setUnread();renderNotifications();toast(failed?'Some notifications could not be marked as read.':'All notifications marked as read.',!!failed)}
function init(){var user=getUser();if(!getToken()||String(user.role||'').toUpperCase()!=='TEACHER'){if(!getToken())location.replace('/auth/signin.html');else location.replace(routeMap[String(user.role||'').toUpperCase()]||'/auth/signin.html');return}enhanceShell();loadProfile();if(currentFile==='/roles/teacher/teacher-announcements.html')loadAnnouncements();if(currentFile==='/roles/teacher/teacher-notifications.html'){var host=document.getElementById('tc-notifications-list');if(host)host.innerHTML='';loadNotifications();var mark=document.getElementById('tc-mark-all-read');if(mark&&!mark.dataset.tcBound){mark.dataset.tcBound='1';mark.addEventListener('click',function(){markAllRead(mark)})}}else{loadNotifications()}var search=document.getElementById('tc-notification-search');if(search)search.addEventListener('input',renderNotifications);document.addEventListener('click',function(event){var read=event.target.closest&&event.target.closest('[data-tc-read]');if(read){markRead(read.getAttribute('data-tc-read'),read);return}var retry=event.target.closest&&event.target.closest('[data-tc-retry]');if(retry){if(retry.getAttribute('data-tc-retry')==='tc-announcements-list')loadAnnouncements();else loadNotifications()}})}
function observeShell(){var attempts=0;var timer=setInterval(function(){attempts++;enhanceShell();if(document.querySelector('.csk-teacher-header-final')||attempts>40){clearInterval(timer);loadProfile()}if(attempts>50)clearInterval(timer)},100)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){init();observeShell();bindPasswordToggles()},{once:true});else{init();observeShell();bindPasswordToggles()}
})();
