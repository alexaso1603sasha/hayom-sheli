const APP_VERSION='20';
(function(){const show=msg=>{let b=document.getElementById('err-banner');if(!b){b=document.createElement('div');b.id='err-banner';b.style.cssText='position:fixed;inset:auto 8px 8px 8px;z-index:9999;background:#7a1f1f;color:#fff;padding:10px 14px;border-radius:12px;font:14px/1.4 sans-serif;direction:rtl;white-space:pre-wrap;-webkit-user-select:text;user-select:text';document.body.appendChild(b);}b.textContent=msg;};
window.addEventListener('error',e=>{if(e.message)show('שגיאה באפליקציה: '+e.message+'\n(אם משהו לא עובד, צלמי את ההודעה ושלחי לי)');});
const meta=document.querySelector('meta[name="app-version"]');if(!meta||meta.content!==APP_VERSION)show('הקבצים באתר לא תואמים: צריך להעלות את index.html ואת app.js יחד (גרסה '+APP_VERSION+').');})();
// כתובת השרת של ההתראות (Cloudflare Worker). משאירים ריק עד שהשרת מוכן.
// דוגמה: const API_BASE = 'https://hayom-sheli-push.YOURNAME.workers.dev';
const API_BASE = 'https://hayom-sheli-push.alexaso1603.workers.dev';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const days = ['יום א׳','יום ב׳','יום ג׳','יום ד׳','יום ה׳','יום ו׳','שבת'];
const shortDays = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];
const months = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseDate = value => { const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d); };
let today = new Date(); today.setHours(0, 0, 0, 0);
let nudgeIndex = 0, nudgeTimer = null, editingWeekday = null, delCtx = null, calMode = 'month', fmtOn = false, fmtSel = new Set(), draftAttach = [], appPick = null, moveCtx = null, lastPutSig = '';
let selectedDate = new Date(today), calendarDate = new Date(today.getFullYear(), today.getMonth(), 1), dialogDate = new Date(today), modalType = 'dated', editingTaskId = null, timeoutIds = [];

const sample = [
  {id:'welcome-1',title:'תכנון קצר ליום',type:'recurring',days:[0,1,2,3,4],time:'08:30',reminder:'0',group:'personal',done:{}},
  {id:'welcome-2',title:'אימון פילאטיס',type:'recurring',days:[1,3],time:'18:00',reminder:'15',group:'personal',done:{}},
  {id:'welcome-3',title:'לקבוע תור לרופאה',type:'general',time:'',reminder:'none',group:'personal',done:{}},
  {id:'welcome-4',title:'שיחת צוות',type:'dated',date:iso(today),time:'10:00',reminder:'5',group:'meetings',done:{}}
];
const defaultGroups = [{id:'personal',name:'אישי',color:'#2f6fc4'},{id:'meetings',name:'פגישות',color:'#13b5c9'},{id:'shopping',name:'קניות',color:'#8b7cf0'}];
let tasks = JSON.parse(localStorage.getItem('hayom-sheli-tasks') || 'null') || sample;
let groups = JSON.parse(localStorage.getItem('hayom-sheli-groups') || 'null') || defaultGroups;
let lists = JSON.parse(localStorage.getItem('hayom-sheli-lists') || '[]');
let panels = JSON.parse(localStorage.getItem('hayom-sheli-panels') || '[]');
const STALE_DAYS = 0; // אחרי כמה ימים משימה כללית שלא בוצעה מופיעה בהודעות המתחלפות (0 = כל משימה כללית פתוחה)
{tasks=tasks.filter(t=>!(t.type==='general'&&t.done?.general&&t.doneAt&&Date.now()-t.doneAt>30*864e5));let m=false;tasks.forEach(t=>{if(t.type==='general'&&!t.createdAt){t.createdAt=Date.now();m=true;}if(t.type==='general'&&t.done?.general&&!t.doneAt){t.doneAt=Date.now();m=true;}});if(m)localStorage.setItem('hayom-sheli-tasks',JSON.stringify(tasks));}
{const map={'#6d5bd0':'#2f6fc4','#3d3152':'#2f6fc4','#1d4f91':'#2f6fc4','#e47695':'#13b5c9','#b8924a':'#13b5c9','#4aa3e8':'#13b5c9','#d59b31':'#8b7cf0','#8c7fa6':'#8b7cf0','#8a9bb8':'#8b7cf0'};let g2=false;groups.forEach(g=>{const n=map[g.color];if(n){g.color=n;g2=true;}});if(g2)localStorage.setItem('hayom-sheli-groups',JSON.stringify(groups));}

function save(){stampItems();localStorage.setItem('hayom-sheli-tasks',JSON.stringify(tasks));localStorage.setItem('hayom-sheli-groups',JSON.stringify(groups));localStorage.setItem('hayom-sheli-lists',JSON.stringify(lists));localStorage.setItem('hayom-sheli-panels',JSON.stringify(panels));localStorage.setItem('hayom-sheli-updated',String(Date.now()));scheduleReminders();queueSync();}
function taskOnDate(task,date){return task.type==='dated'?task.date===iso(date):task.type==='recurring'&&task.days.includes(date.getDay())&&!task.skip?.[iso(date)];}
function doneOn(task,date){return !!task.done?.[iso(date)];}
function setDone(task,date,value){task.done ||= {};task.done[iso(date)]=value;save();render();}
function dateName(date){return `${days[date.getDay()]}, ${date.getDate()} ב${months[date.getMonth()]}`;}
function sorted(list){return [...list].sort((a,b)=>(a.time||'99:99').localeCompare(b.time||'99:99'));}
function escapeHtml(value){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));}
function getGroup(task){return groups.find(g=>g.id===task.group);}
function taskRow(task,date,general=false){const done=general?!!task.done?.general:doneOn(task,date),group=getGroup(task),reminder=task.reminder&&task.reminder!=='none'?' · תזכורת':'',meta=general?'כללית':task.type==='recurring'?'משימה קבועה':dateName(date),wd=(date||selectedDate).getDay(),time=task.time?`<span class="task-time" dir="ltr">${task.time}${task.end?`–${task.end}`:''}</span>`:'';return `<div class="swipe-wrap"><div class="swipe-bg sb-done"><svg class="ic"><use href="#i-check"/></svg> הושלם</div><div class="swipe-bg sb-move"><svg class="ic"><use href="#i-calendar"/></svg> יום אחר</div><div class="task-row ${done?'done':''}" data-id="${task.id}" data-wd="${wd}"${fmtAttr(task,wd)}><input class="task-check" type="checkbox" ${done?'checked':''} aria-label="סימון משימה כהושלמה">${group?`<i class="group-dot" style="--group-color:${group.color}" title="${escapeHtml(group.name)}"></i>`:''}<div class="task-main">${time}<span class="task-name">${escapeHtml(task.title)}</span><span class="task-meta">${meta}${group?` · ${escapeHtml(group.name)}`:''}${reminder}</span>${chipsHtml(task)}</div><button class="edit-task" aria-label="עריכת משימה">✎</button><button class="delete-task" aria-label="מחיקת משימה">×</button></div></div>`;}
function renderDateStrip(){const holder=$('#date-strip');holder.innerHTML='';for(let i=-3;i<=5;i++){const d=new Date(today);d.setDate(today.getDate()+i);holder.insertAdjacentHTML('beforeend',`<button class="date-pill ${iso(d)===iso(selectedDate)?'selected':''} ${iso(d)===iso(today)?'today':''}" data-date="${iso(d)}"><span>${shortDays[d.getDay()]}</span><strong>${d.getDate()}</strong></button>`);}}
function renderToday(){const dayAll=sorted(tasks.filter(t=>taskOnDate(t,selectedDate))),list=dayAll.filter(t=>!t.panel),complete=list.filter(t=>doneOn(t,selectedDate)).length;$('#schedule-title').textContent=iso(selectedDate)===iso(today)?'היום':dateName(selectedDate);$('#daily-progress').textContent=list.length?`${complete} מתוך ${list.length} הושלמו`:'יום פנוי';$('#daily-tasks').innerHTML=list.length?list.map(t=>taskRow(t,selectedDate)).join(''):'<div class="empty-state">אין כאן עדיין משימות. יום נעים ומרווח ✨</div>';const pending=sorted(dayAll.filter(t=>!doneOn(t,selectedDate))),nowD=new Date(),nowHM=`${String(nowD.getHours()).padStart(2,'0')}:${String(nowD.getMinutes()).padStart(2,'0')}`,upcoming=iso(selectedDate)===iso(today)?pending.filter(t=>!t.time||(t.end||t.time)>=nowHM):pending,next=upcoming[0],overdue=pending.length-upcoming.length;$('#next-task').innerHTML=next?`<strong>${escapeHtml(next.title)}</strong><span>${next.time||'ללא שעה'}${next.type==='recurring'?' · משימה קבועה':''}</span>`:pending.length?`<strong>אין עוד משימות להמשך היום</strong><span>${overdue} ${overdue===1?'משימה שעברה שעתה ממתינה':'משימות שעברה שעתן ממתינות'} לסימון</span>`:'<strong>סיימת הכול להיום ✨</strong><span>זמן לנשום קצת.</span>';}
function renderGeneral(){const list=tasks.filter(t=>t.type==='general'&&!t.panel);$('#general-tasks').innerHTML=list.length?list.map(t=>taskRow(t,null,true)).join(''):'<div class="empty-state">רשמי כאן כל דבר שתרצי לזכור, בלי להתחייב לתאריך.</div>';}
function renderCalendar(){const y=calendarDate.getFullYear(),m=calendarDate.getMonth();$('#month-title').textContent=`${months[m]} ${y}`;const first=new Date(y,m,1),start=first.getDay(),last=new Date(y,m+1,0).getDate(),previous=new Date(y,m,0).getDate();let cells='';for(let i=0;i<42;i++){const number=i<start?previous-start+i+1:i>=start+last?i-start-last+1:i-start+1,current=i>=start&&i<start+last,d=new Date(y,current?m:(i<start?m-1:m+1),number),dayTasks=tasks.filter(t=>taskOnDate(t,d)),amount=dayTasks.length;cells+=`<button class="calendar-day ${current?'':'muted'} ${iso(d)===iso(today)?'today':''} ${iso(d)===iso(selectedDate)?'selected':''}" data-date="${iso(d)}"><span class="day-number">${number}</span>${amount?`<span class="calendar-dots">${[...new Set(dayTasks.map(t=>taskColor(t)||'#9db8d8'))].slice(0,3).map(col=>`<i class="calendar-dot" style="background:${col}"></i>`).join('')}</span>`:''}</button>`;}$('#calendar-grid').innerHTML=cells;const list=sorted(tasks.filter(t=>taskOnDate(t,selectedDate)));$('#calendar-day-title').textContent=dateName(selectedDate);$('#calendar-day-tasks').innerHTML=list.length?list.map(t=>taskRow(t,selectedDate)).join(''):'<div class="empty-state">אין משימות ביום הזה עדיין. אפשר להוסיף אחת כאן.</div>';}
function renderDrawer(){const week=days.map((day,index)=>{const list=sorted(tasks.filter(t=>t.type==='recurring'&&t.days.includes(index)));return `<section class="week-day"><button class="week-day-head" data-week-day="${index}"><strong>${day}</strong><span>＋ הוספה</span></button><div class="week-tasks">${list.length?list.map(t=>`<button class="week-task" data-edit-id="${t.id}" data-edit-day="${index}" data-wd="${index}"${fmtAttr(t,index)}><i class="group-dot" style="--group-color:${taskColor(t)||'#9db8d8'}"></i><bdi class="wt-title">${escapeHtml(t.title)}</bdi>${t.time?`<small class="wt-time" dir="ltr">${t.time}${t.end?`–${t.end}`:''}</small>`:''}</button>`).join(''):'<div class="week-empty">אין משימות קבועות</div>'}</div></section>`;}).join('');$('#week-table').innerHTML=week;$('#group-list').innerHTML=groups.length?groups.map(g=>`<div class="group-row" data-group-id="${g.id}"><input class="group-color" type="color" value="${g.color}" aria-label="צבע ${escapeHtml(g.name)}"><span>${escapeHtml(g.name)}</span><small>${tasks.filter(t=>t.group===g.id).length} משימות</small><button class="delete-group" aria-label="מחיקת ${escapeHtml(g.name)}">×</button></div>`).join(''):'<div class="empty-state">הוסיפי קבוצה ראשונה.</div>';}
function render(){renderDateStrip();renderToday();renderGeneral();renderCalendar();renderWeekView();renderDrawer();renderLists();renderPanels();renderNudge();applyFmtSelection();}
function showToast(text){const toast=$('#toast');toast.textContent=text;toast.classList.add('visible');setTimeout(()=>toast.classList.remove('visible'),2500);}
function fillGroups(selected=''){$('#group-input').innerHTML='<option value="">ללא קבוצה</option>'+groups.map(g=>`<option value="${g.id}" ${g.id===selected?'selected':''}>${escapeHtml(g.name)}</option>`).join('');}
function fillTime(value='',remind='20:00',endV=''){const items=n=>'<div data-v="">--</div>'+Array.from({length:n},(_,i)=>{const v=String(i).padStart(2,'0');return `<div data-v="${v}">${v}</div>`;}).join('');for(const [p,val] of [['task',value],['end',endV],['rem',remind]]){const [h,m]=val?val.split(':'):['',''];$(`#${p}-hour-input`).innerHTML=items(24);$(`#${p}-minute-input`).innerHTML=items(60);$(`#${p}-hour-input`).value=h;$(`#${p}-minute-input`).value=m;}}
function selectedEnd(){const hour=$('#end-hour-input').value,minute=$('#end-minute-input').value;return hour?`${hour}:${minute||'00'}`:'';}
function selectedTime(){const hour=$('#task-hour-input').value,minute=$('#task-minute-input').value;return hour?`${hour}:${minute||'00'}`:'';}
function openDialog(type,task=null,weekday=null){editingWeekday=Number.isInteger(weekday)?weekday:null;modalType=type;editingTaskId=task?.id||null;dialogDate=task?.date?parseDate(task.date):new Date(selectedDate);$('#task-form').reset();fillGroups(task?.group||'');fillTime(task?.time||'',task?.remindAt||'20:00',task?.end||'');$('#repeat-days').style.display=type==='recurring'?'block':'none';$('.date-field').style.display=type==='dated'?'grid':'none';$('.reminder-field').style.display='grid';$('#dialog-kind').textContent=type==='recurring'?'שגרה קבועה':type==='general'?'רשימה כללית':'ליום מסוים';$('#dialog-title').textContent=task?'עריכת משימה':type==='recurring'?'משימה קבועה חדשה':type==='general'?'משימה כללית חדשה':'משימה חדשה';$('#task-title-input').value=task?.title||'';$('#reminder-input').value=task?.reminder||'none';$('#remind-date-input').value=task?.remindDate||iso(today);$('#delete-from-dialog').style.display=task?'block':'none';draftAttach=(task?.attach||[]).map(a=>({...a}));pendingFiles.clear();renderDraftChips();$('#app-picker').hidden=true;$('#attach-url').value='';$('#panel-input').innerHTML='<option value="">ללא פינה</option>'+panels.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');const panelCtx=!!presetPanel&&!task;$('#panel-input').value=task?.panel||presetPanel||'';presetPanel=null;$('.panel-field').style.display=(panels.length&&!panelCtx)?'grid':'none';$('#task-date-input').value=iso(dialogDate);$$('#repeat-days input').forEach(input=>input.checked=task?.days?.includes(Number(input.value))||false);$('#task-dialog').showModal();['task','end','rem'].forEach(p=>['hour','minute'].forEach(k=>{const w=$(`#${p}-${k}-input`);w.value=w.dataset.v||'';}));$('#type-switch').style.display=panelCtx?'grid':'none';setDialogType(type);if(matchMedia('(pointer:fine)').matches)$('#task-title-input').focus();}
function saveTask(){const title=$('#task-title-input').value.trim();if(!title)return;const st=selectedTime(),en=selectedEnd();if(st&&en&&en<=st){showToast('שעת הסיום צריכה להיות אחרי שעת ההתחלה');return;}const existing=tasks.find(t=>t.id===editingTaskId),task=existing||{id:crypto.randomUUID(),done:{},createdAt:Date.now()};Object.assign(task,{title,type:modalType,time:st,end:st?en:'',reminder:$('#reminder-input').value,remindAt:$('#reminder-input').value==='day'?`${$('#rem-hour-input').value||'20'}:${$('#rem-minute-input').value||'00'}`:'',group:$('#group-input').value,panel:$('#panel-input').value||'',remindDate:modalType==='general'?($('#remind-date-input').value||iso(today)):''});delete task.date;delete task.days;commitAttachments(task);if(modalType!=='general'||task.reminder==='none')delete task.remindDate;if(modalType==='dated')task.date=iso(dialogDate);if(modalType==='recurring'){task.days=$$('#repeat-days input:checked').map(i=>Number(i.value));if(!task.days.length){showToast('בחרי לפחות יום אחד');return;}}if(!existing)tasks.push(task);save();render();$('#task-dialog').close();showToast(existing?'המשימה עודכנה':'המשימה נשמרה');}
function switchDrawer(view){$('#action-drawer').dataset.mode=view?'page':'menu';$$('.drawer-page').forEach(page=>page.classList.toggle('active',page.id===`${view}-drawer`));}
function toggleDrawer(open,view=null){if(open)switchDrawer(view);$('#action-drawer').classList.toggle('open',open);$('#drawer-overlay').classList.toggle('open',open);}
async function enableNotifications(){if(!('Notification'in window)){showToast('הדפדפן הזה לא תומך בהתראות');return;}const result=await Notification.requestPermission();if(result==='granted'){showToast('התזכורות הופעלו');scheduleReminders();notify('התזכורות פעילות','ככה ייראו ההתראות','test');subscribePush();}else showToast('אפשר לאפשר התראות בהגדרות הדפדפן');}
async function notify(title,body,tag){const options={body,icon:'icon-180.png',tag,dir:'rtl',lang:'he'};try{const reg='serviceWorker'in navigator?await navigator.serviceWorker.getRegistration():null;if(reg&&reg.active){await reg.showNotification(title,options);return;}}catch(e){}try{new Notification(title,options);}catch(e){}}
function occursOn(task,date){return task.type==='general'?task.remindDate===iso(date):taskOnDate(task,date);}
function scheduleReminders(){timeoutIds.forEach(clearTimeout);timeoutIds=[];if(localStorage.getItem('hayom-sheli-push')==='1')return;if(!('Notification'in window)||Notification.permission!=='granted')return;for(const task of tasks){const dayBefore=task.reminder==='day';if(!task.reminder||task.reminder==='none'||(!task.time&&!dayBefore)||(task.type==='general'&&(!task.remindDate||task.done?.general)))continue;for(let offset=0;offset<3;offset++){const occ=new Date(today);occ.setDate(today.getDate()+offset);if(!occursOn(task,occ)||(task.type!=='general'&&doneOn(task,occ)))continue;const at=new Date(occ);let detail;if(dayBefore){const[h,m]=(task.remindAt||'20:00').split(':').map(Number);at.setDate(at.getDate()-1);at.setHours(h,m,0,0);detail=`מחר${task.time?` · ${task.time}`:''}`;}else{const[h,m]=task.time.split(':').map(Number),lead=Number(task.reminder);at.setHours(h,m-lead,0,0);detail=lead?`בעוד ${lead} דק׳`:'עכשיו';}const delay=at-Date.now();if(delay>0&&delay<259200000)timeoutIds.push(setTimeout(()=>notify(task.title,detail,`${task.id}-${iso(occ)}`),delay));}}}
document.addEventListener('click',event=>{const target=event.target;if(target.closest('#open-drawer'))return toggleDrawer(true);if(target.closest('#week-schedule-button')){toggleDrawer(true,'recurring');return;}if(target.closest('#close-drawer')||target.closest('#drawer-overlay'))return toggleDrawer(false);if(target.closest('#drawer-back'))return toggleDrawer(false);if(target.closest('.close-day')||target.id==='day-dialog')return $('#day-dialog').close();const section=target.closest('.drawer-section');if(section)return openDrawerPage(section.dataset.drawerView);if(target.closest('.close-dialog'))return $('#task-dialog').close();if(target.closest('#drawer-notification-button')||target.closest('#notification-button'))return enableNotifications();if(target.closest('#add-group')){switchDrawer('groups');$('#group-name-input').focus();return;}const weekDay=target.closest('[data-week-day]');if(weekDay){const day=Number(weekDay.dataset.weekDay);openDialog('recurring');$$('#repeat-days input').forEach(input=>input.checked=Number(input.value)===day);return;}const add=target.closest('.add-task');if(add)return openDialog(add.dataset.type);const editFromDrawer=target.closest('[data-edit-id]');if(editFromDrawer){const task=tasks.find(t=>t.id===editFromDrawer.dataset.editId);return openDialog(task.type,task,Number(editFromDrawer.dataset.editDay));}const pill=target.closest('.date-pill');if(pill){selectedDate=parseDate(pill.dataset.date);render();return;}const day=target.closest('.calendar-day');if(day){selectedDate=parseDate(day.dataset.date);calendarDate=new Date(selectedDate.getFullYear(),selectedDate.getMonth(),1);render();$('#day-dialog').showModal();return;}const row=target.closest('.task-row');if(row){const task=tasks.find(t=>t.id===row.dataset.id);if(!task)return;if(target.closest('.delete-task')){askDelete(task,{date:new Date(selectedDate)});}else if(target.closest('.edit-task'))openDialog(task.type,task);else if(target.matches('.task-check')){if(task.type==='general'){task.done ||= {};task.done.general=target.checked;task.doneAt=target.checked?Date.now():null;save();render();}else setDone(task,selectedDate,target.checked);}}const deleteGroup=target.closest('.delete-group');if(deleteGroup){const id=deleteGroup.closest('.group-row').dataset.groupId;tasks.forEach(t=>{if(t.group===id)t.group='';});groups=groups.filter(g=>g.id!==id);save();render();showToast('הקבוצה הוסרה');}});
document.addEventListener('change',event=>{if(event.target.matches('.group-color')){const group=groups.find(g=>g.id===event.target.closest('.group-row').dataset.groupId);group.color=event.target.value;save();render();}});
$$('.tab').forEach(tab=>tab.addEventListener('click',()=>{$$('.tab').forEach(t=>t.classList.toggle('active',t===tab));$$('.view').forEach(v=>v.classList.toggle('active',v.id===`${tab.dataset.view}-view`));}));
$('#task-form').addEventListener('submit',event=>{event.preventDefault();saveTask();});
$('#group-form').addEventListener('submit',event=>{event.preventDefault();const input=$('#group-name-input'),name=input.value.trim();if(!name)return;groups.push({id:crypto.randomUUID(),name,color:$('#group-color-input').value});input.value='';save();render();showToast('הקבוצה נוספה');});
$('#jump-today').addEventListener('click',()=>{selectedDate=new Date(today);render();});$('#prev-month').addEventListener('click',()=>{calendarDate.setMonth(calendarDate.getMonth()-1);renderCalendar();});$('#next-month').addEventListener('click',()=>{calendarDate.setMonth(calendarDate.getMonth()+1);renderCalendar();});$('#today-label').textContent=dateName(today);if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});render();scheduleReminders();

/* ===== סנכרון בין מכשירים והתראות Push ===== */
const syncKey='hayom-sheli-sync',updatedKey='hayom-sheli-updated';
let syncTimer=null;
const getCode=()=>localStorage.getItem(syncKey)||'';
const tzName=()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';}catch(e){return 'UTC';}};
function syncStatus(text){const el=$('#sync-status');if(el)el.textContent=text;}
async function api(path,options={}){const res=await fetch(API_BASE+path,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});if(!res.ok){let m='';try{m=(await res.json()).error||'';}catch(e){}throw new Error(`http-${res.status}${m?': '+m:''}`);}return res.json();}
function syncErr(e){const m=String((e&&e.message)||e);return /limit/i.test(m)?'מכסת הכתיבה היומית של Cloudflare נגמרה והיא תתאפס בלילה. אפשר להמשיך להשתמש באתר.':m;}
function queueSync(){if(!API_BASE||!getCode())return;clearTimeout(syncTimer);syncTimer=setTimeout(pushData,800);}
async function putData(force){const sig=sigOf(cols());if(!force&&sig===lastPutSig)return;await api('/api/sync',{method:'PUT',body:JSON.stringify({code:getCode(),tasks,groups,lists,panels,tomb:getTomb(),tz:tzName(),updatedAt:Number(localStorage.getItem(updatedKey)||Date.now())})});lastPutSig=sig;}
async function pushData(){try{const d=await api('/api/sync?code='+encodeURIComponent(getCode()));if(d&&d.tomb!==undefined&&d.updatedAt&&Number(localStorage.getItem(updatedKey)||0)){const before=JSON.stringify(cols());mergeIn(d);if(before!==JSON.stringify(cols())){scheduleReminders();render();}}await putData();syncStatus('מסונכרן ✓');return true;}catch(e){syncStatus('הסנכרון נכשל: '+syncErr(e));return false;}}
async function pullData(){
  if(!API_BASE||!getCode())return 'off';
  try{
    const data=await api('/api/sync?code='+encodeURIComponent(getCode()));
    if(!data||!data.updatedAt)return 'empty';
    const localUpdated=Number(localStorage.getItem(updatedKey)||0);
    if(data.tomb===undefined||!localUpdated){
      if(data.updatedAt<=localUpdated)return 'same';
      adoptData(data);return 'applied';
    }
    const before=JSON.stringify(cols());
    mergeIn(data);
    const after=JSON.stringify(cols());
    localStorage.setItem(updatedKey,String(Math.max(localUpdated,data.updatedAt)));
    if(before!==after){scheduleReminders();render();}
    if(sigOf(data)!==sigOf(cols()))await putData();else lastPutSig=sigOf(cols());
    return before!==after?'applied':'same';
  }catch(e){syncStatus('הסנכרון נכשל: '+syncErr(e));return 'error';}
}
function b64ToBytes(b64){const pad='='.repeat((4-b64.length%4)%4),raw=atob((b64+pad).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0));}
async function subscribePush(){
  if(!API_BASE||!getCode())return false;
  if(!('serviceWorker'in navigator)||!('PushManager'in window)){syncStatus('באייפון צריך קודם להוסיף את האפליקציה למסך הבית ולפתוח אותה משם');return false;}
  if(!('Notification'in window)||Notification.permission!=='granted')return false;
  try{
    const reg=await navigator.serviceWorker.ready,{key}=await api('/api/vapid');
    if(!key){syncStatus('בשרת חסר מפתח VAPID');return false;}
    let sub=await reg.pushManager.getSubscription();
    if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToBytes(key)});
    await api('/api/subscribe',{method:'POST',body:JSON.stringify({code:getCode(),subscription:sub.toJSON()})});localStorage.setItem('hayom-sheli-push','1');
    return true;
  }catch(e){syncStatus('ההרשמה להתראות נכשלה');return false;}
}
function newSyncCode(){const chars='abcdefghjkmnpqrstuvwxyz23456789',bytes=crypto.getRandomValues(new Uint8Array(20));return [...bytes].map(b=>chars[b%chars.length]).join('');}
async function connectSync(){
  if(!API_BASE){showToast('חסרה כתובת שרת ב-app.js');return;}
  const code=$('#sync-code-input').value.trim();
  if(!/^[A-Za-z0-9_-]{8,64}$/.test(code)){showToast('הקוד צריך להיות לפחות 8 תווים (אותיות ומספרים)');return;}
  if('Notification'in window&&Notification.permission==='default')await Notification.requestPermission();
  localStorage.setItem(syncKey,code);
  syncStatus('מתחבר...');
  const result=await pullData();
  if(result==='error'){syncStatus('אין חיבור לשרת');return;}
  if(result==='empty'){localStorage.setItem(updatedKey,String(Date.now()));await pushData();}
  const ok=await subscribePush();
  if(ok){showToast('מחובר ✓');syncStatus('מחובר: סנכרון והתראות פעילים ✓');}
  else if(!('Notification'in window)||Notification.permission!=='granted')syncStatus('מחובר לסנכרון. כדי לקבל התראות צריך לאשר אותן (באייפון: מתוך האפליקציה במסך הבית)');
}
function initSync(){
  const input=$('#sync-code-input');
  if(input)input.value=getCode();
  $('#sync-new-code')?.addEventListener('click',()=>{$('#sync-code-input').value=newSyncCode();});
  $('#sync-save-code')?.addEventListener('click',connectSync);
  if(getCode()){syncStatus(API_BASE?'מחובר':'חסרה כתובת שרת ב-app.js');pullData();}
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')pullData();});
}
initSync();

/* גלגלות שעה ודקות */
function markWheel(el){[...el.children].forEach(c=>c.classList.toggle('sel',c.dataset.v===(el.dataset.v||'')));}
function initWheel(el){
  const inp=document.createElement('input');inp.type='text';inp.className='time-type';inp.inputMode='numeric';inp.maxLength=2;inp.placeholder=el.getAttribute('aria-label')||'--';inp.setAttribute('aria-label',el.getAttribute('aria-label')||'');const col=document.createElement('div'),cap=document.createElement('small');col.className='time-col';cap.textContent=el.getAttribute('aria-label')||'';el.before(col);col.append(cap,inp,el);
  const max=()=>el.children.length-2,pad=n=>String(n).padStart(2,'0');
  inp.addEventListener('input',()=>{const d=inp.value.replace(/\D/g,'');inp.value=d;el.dataset.v=d?pad(Math.min(max(),parseInt(d,10))):'';if(d.length===2&&el.id.endsWith('hour-input'))el.closest('.time-picker').querySelectorAll('.time-type')[1]?.focus();});
  inp.addEventListener('blur',()=>{inp.value=el.dataset.v||'';});
  inp.addEventListener('focus',()=>inp.select());
  Object.defineProperty(el,'value',{get(){return el.dataset.v||'';},set(v){el.dataset.v=v;inp.value=v;const i=[...el.children].findIndex(c=>c.dataset.v===v);el.scrollTop=Math.max(0,i)*44;markWheel(el);}});
  el.addEventListener('scroll',()=>{clearTimeout(el._t);el._t=setTimeout(()=>{const i=Math.min(el.children.length-1,Math.max(0,Math.round(el.scrollTop/44)));if(el.children[i]){el.dataset.v=el.children[i].dataset.v;inp.value=el.dataset.v;markWheel(el);}},70);});
}
$$('.wheel').forEach(initWheel);

/* יום לפני, עדכון יום אוטומטי, גלילה בעכבר */
function toggleDayBefore(){$('#remind-date-field').style.display=(modalType==='general'&&$('#reminder-input').value!=='none')?'grid':'none';const on=$('#reminder-input').value==='day';$('#daybefore-field').style.display=on?'grid':'none';if(on)['hour','minute'].forEach(k=>{const w=$('#rem-'+k+'-input');w.value=w.dataset.v||'';});}
$('#reminder-input').addEventListener('change',toggleDayBefore);
function refreshToday(){const n=new Date();n.setHours(0,0,0,0);if(iso(n)===iso(today))return;const was=iso(selectedDate)===iso(today);today=n;if(was)selectedDate=new Date(n);calendarDate=new Date(n.getFullYear(),n.getMonth(),1);$('#today-label').textContent=dateName(today);scheduleReminders();render();}
setInterval(refreshToday,60000);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshToday();});
$$('.wheel').forEach(el=>{
  el.addEventListener('wheel',e=>{e.preventDefault();el.scrollTo({top:(Math.round(el.scrollTop/44)+Math.sign(e.deltaY))*44,behavior:'smooth'});},{passive:false});
  let sy=null,st=0;
  el.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse')return;sy=e.clientY;st=el.scrollTop;el.setPointerCapture(e.pointerId);el.style.scrollSnapType='none';});
  el.addEventListener('pointermove',e=>{if(sy!==null)el.scrollTop=st-(e.clientY-sy);});
  el.addEventListener('pointerup',()=>{if(sy===null)return;sy=null;el.style.scrollSnapType='';el.scrollTo({top:Math.round(el.scrollTop/44)*44,behavior:'smooth'});});
});

/* הודעות מתחלפות: משימות כלליות שלא בוצעו כבר זמן מה */
function staleTasks(){return tasks.filter(t=>t.type==='general'&&!t.done?.general&&!t.dismissed&&t.createdAt&&Date.now()-t.createdAt>=STALE_DAYS*864e5).sort((a,b)=>a.createdAt-b.createdAt);}
function ageText(ms){const d=Math.floor(ms/864e5);if(d<7)return d<=1?'יום':`${d} ימים`;const w=Math.floor(d/7);if(d<30)return w===1?'שבוע':w===2?'שבועיים':`${w} שבועות`;const mo=Math.floor(d/30);if(d<365)return mo===1?'חודש':mo===2?'חודשיים':`${mo} חודשים`;const y=Math.floor(d/365);return y===1?'שנה':y===2?'שנתיים':`${y} שנים`;}
function showNudge(fade){const list=staleTasks(),t=list[nudgeIndex%Math.max(list.length,1)],body=$('#nudge-body');if(!t)return;const set=()=>{body.innerHTML=`<p class="nudge-text">${escapeHtml(t.title)}</p><p class="nudge-age">${Date.now()-t.createdAt<864e5?'נוספה היום':'לא בוצעה כבר '+ageText(Date.now()-t.createdAt)}</p>`;$('#nudge-ignore').dataset.id=t.id;$('#nudge-dots').innerHTML=list.length>1?list.map((_,i)=>`<i class="${i===nudgeIndex%list.length?'on':''}"></i>`).join(''):'';body.classList.remove('out');};if(fade){body.classList.add('out');setTimeout(set,250);}else set();}
function renderNudge(){const box=$('#nudge'),list=staleTasks();clearInterval(nudgeTimer);box.hidden=!list.length;$('#hero-default').hidden=!!list.length;if(!list.length)return;nudgeIndex%=list.length;showNudge(false);if(list.length>1)nudgeTimer=setInterval(()=>{nudgeIndex=(nudgeIndex+1)%staleTasks().length;showNudge(true);},6500);}
$('#nudge-ignore').addEventListener('click',e=>{const t=tasks.find(x=>x.id===e.currentTarget.dataset.id);if(t){t.dismissed=true;save();render();showToast('בסדר, לא אזכיר את המשימה הזאת שוב');}});
renderNudge();

/* מחיקה, מעבר חלק בסרגל, חזרה ליום הנוכחי, ניקוי משימות שהושלמו */
function removeTask(id){tasks=tasks.filter(t=>t.id!==id);save();render();showToast('המשימה נמחקה');}
function askDelete(task,ctx){if(task.type!=='recurring'){removeTask(task.id);return;}delCtx={id:task.id,...ctx};const dayLabel=ctx.weekday!=null?`רק ב${days[ctx.weekday]}`:`רק ב${dateName(ctx.date)}`;$('#delete-text').textContent=`למחוק את ‘${task.title}’ מכל הימים, או ${dayLabel}?`;$('#delete-one').textContent=dayLabel;$('#delete-dialog').showModal();}
function deleteOne(){const t=tasks.find(x=>x.id===delCtx?.id);if(!t)return;if(delCtx.weekday!=null){t.days=t.days.filter(d=>d!==delCtx.weekday);if(!t.days.length){removeTask(t.id);return;}}else{t.skip={...(t.skip||{}),[iso(delCtx.date)]:true};}save();render();showToast('המשימה הוסרה מהיום הזה');}
document.addEventListener('click',e=>{const t=e.target;if(t.closest('#delete-all')){const id=delCtx?.id;$('#delete-dialog').close();if(id)removeTask(id);}else if(t.closest('#delete-one')){$('#delete-dialog').close();deleteOne();}else if(t.closest('#delete-cancel')||t.id==='delete-dialog')$('#delete-dialog').close();else if(t.closest('#delete-from-dialog')){const task=tasks.find(x=>x.id===editingTaskId);if(!task)return;$('#task-dialog').close();askDelete(task,{weekday:editingWeekday,date:new Date(selectedDate)});}});
function openDrawerPage(view){const d=$('#action-drawer');d.classList.add('turn');setTimeout(()=>{switchDrawer(view);void d.offsetWidth;d.classList.remove('turn');},260);}
function pruneDone(){const n=tasks.length;tasks=tasks.filter(t=>!(t.type==='general'&&t.done?.general&&t.doneAt&&Date.now()-t.doneAt>30*864e5));if(tasks.length!==n){save();render();}}
let hiddenAt=0;
function onResume(){refreshToday();if(hiddenAt&&Date.now()-hiddenAt>600000){selectedDate=new Date(today);calendarDate=new Date(today.getFullYear(),today.getMonth(),1);render();}$('#today-label').textContent=dateName(today);pruneDone();hiddenAt=0;refreshPushState();}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')hiddenAt=Date.now();else onResume();});
window.addEventListener('pageshow',onResume);
setInterval(pruneDone,3600000);

/* רשימות וזריזה */
function renderLists(){const box=$('#lists-container');if(!box)return;box.innerHTML=lists.length?lists.map(l=>{const done=l.items.filter(i=>i.done).length;return `<article class="list-card" data-list-id="${l.id}"><header class="list-head"><div><h4>${escapeHtml(l.title)}</h4><small>${l.items.length?`${done} מתוך ${l.items.length}`:'ריקה'}</small></div><button class="delete-list" aria-label="מחיקת הרשימה"></button></header><div class="list-items">${l.items.map(i=>`<div class="list-item ${i.done?'done':''}" data-item-id="${i.id}"><input class="task-check item-check" type="checkbox" ${i.done?'checked':''} aria-label="סימון פריט"><span>${escapeHtml(i.text)}</span><button class="delete-item" aria-label="מחיקת פריט"></button></div>`).join('')}</div><form class="item-form"><input class="item-input" maxlength="80" placeholder="הוספת פריט" autocomplete="off"><button class="add-item" aria-label="הוספה"></button></form></article>`;}).join(''):'<div class="empty-state">עוד אין רשימות. אפשר ליצור אחת למעלה, או להשתמש בכפתור הצף ״זריזה״.</div>';}
function addList(title,items=[]){lists.unshift({id:crypto.randomUUID(),title,items:items.map(text=>({id:crypto.randomUUID(),text,done:false})),createdAt:Date.now()});save();render();}
function quickSave(){const lines=$('#quick-items').value.split('\n').map(x=>x.trim()).filter(Boolean);if(!lines.length){showToast('כתבי לפחות פריט אחד');return false;}const now=new Date();addList($('#quick-title').value.trim()||`זריזה · ${now.getDate()}.${now.getMonth()+1}`,lines);$('#quick-dialog').close();showToast('נשמרה בדף הרשימות');return true;}
document.addEventListener('click',e=>{const t=e.target;if(t.closest('#quick-fab')){$('#quick-title').value='';$('#quick-items').value='';$('#quick-dialog').showModal();$('#quick-items').focus();}else if(t.closest('.close-quick')||t.id==='quick-dialog')$('#quick-dialog').close();else if(t.closest('.delete-item')){const l=lists.find(x=>x.id===t.closest('.list-card').dataset.listId);if(l){l.items=l.items.filter(i=>i.id!==t.closest('.list-item').dataset.itemId);save();render();}}else if(t.closest('.delete-list')){const id=t.closest('.list-card').dataset.listId,l=lists.find(x=>x.id===id);if(l&&confirm(`למחוק את הרשימה ‘${l.title}’?`)){lists=lists.filter(x=>x.id!==id);save();render();}}});
document.addEventListener('change',e=>{if(!e.target.matches('.item-check'))return;const l=lists.find(x=>x.id===e.target.closest('.list-card').dataset.listId),i=l?.items.find(x=>x.id===e.target.closest('.list-item').dataset.itemId);if(i){i.done=e.target.checked;save();render();}});
document.addEventListener('submit',e=>{if(e.target.id==='quick-form'){e.preventDefault();quickSave();}else if(e.target.id==='list-form'){e.preventDefault();const inp=$('#list-name-input'),name=inp.value.trim();if(!name)return;addList(name);inp.value='';}else if(e.target.classList.contains('item-form')){e.preventDefault();const card=e.target.closest('.list-card'),inp=e.target.querySelector('.item-input'),text=inp.value.trim(),l=lists.find(x=>x.id===card.dataset.listId);if(!l||!text)return;l.items.push({id:crypto.randomUUID(),text,done:false});save();render();$(`[data-list-id="${l.id}"] .item-input`)?.focus();}});

/* החלפת סוג משימה בחלון, פוקוס לפי שעה, בדיקת תזכורות */
function setDialogType(type){modalType=type;$('#repeat-days').style.display=type==='recurring'?'block':'none';$('.date-field').style.display=type==='dated'?'grid':'none';$('#dialog-kind').textContent=type==='recurring'?'שגרה קבועה':type==='general'?'רשימה כללית':'ליום מסוים';$('#dialog-title').textContent=editingTaskId?'עריכת משימה':type==='recurring'?'משימה קבועה חדשה':type==='general'?'משימה כללית חדשה':'משימה חדשה';$$('#type-switch button').forEach(b=>b.classList.toggle('active',b.dataset.type===type));if(type==='recurring'&&!$$('#repeat-days input:checked').length){const box=$(`#repeat-days input[value="${selectedDate.getDay()}"]`);if(box)box.checked=true;}toggleDayBefore();}
$('#type-switch').addEventListener('click',e=>{const b=e.target.closest('button');if(b)setDialogType(b.dataset.type);});
setInterval(renderToday,30000);
async function refreshPushState(){try{if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window)){localStorage.removeItem('hayom-sheli-push');scheduleReminders();return;}const reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();if(!(sub&&Notification.permission==='granted'&&getCode()))localStorage.removeItem('hayom-sheli-push');if(API_BASE&&getCode()&&Notification.permission==='granted')await subscribePush();scheduleReminders();}catch(e){}}
async function diagnose(){const out=$('#diag-result'),lines=[],add=(ok,t)=>lines.push(`${ok?'✓':'✗'} ${t}`),show=()=>{out.textContent=lines.join('\n');};
  const hasN='Notification'in window;add(hasN&&Notification.permission==='granted',hasN?'התראות מאושרות במכשיר':'הדפדפן לא תומך בהתראות (באייפון צריך להתקין למסך הבית ולפתוח משם)');
  let reg=null,sub=null;try{reg='serviceWorker'in navigator?await navigator.serviceWorker.getRegistration():null;sub=reg&&reg.pushManager?await reg.pushManager.getSubscription():null;}catch(e){}
  add(!!(reg&&reg.active),'שירות הרקע פעיל');add(!!sub,'המכשיר רשום להתראות מהשרת');add(!!getCode(),'קוד סנכרון מוגדר');add(!!API_BASE,'כתובת שרת מוגדרת');show();
  if(API_BASE&&getCode()){try{await api('/api/sync?code='+encodeURIComponent(getCode()));add(true,'קריאת נתונים מהשרת עובדת');await putData(true);add(true,'שמירת נתונים בשרת עובדת');}catch(e){add(false,'סנכרון: '+syncErr(e));}show();}
  if(API_BASE&&getCode()){try{const r=await api('/api/test',{method:'POST',body:JSON.stringify({code:getCode()})});if(r.subs===undefined)add(false,'השרת בגרסה ישנה: יש להדביק מחדש את worker.js ב-Cloudflare');else if(!r.subs)add(false,'אין מכשיר רשום בשרת. לחצי "חיבור" בסנכרון שוב');else if(r.ok)add(true,`התראת בדיקה נשלחה מהשרת (${r.ok} מתוך ${r.subs})`);else add(false,`השרת לא הצליח לשלוח (קוד ${r.fail.join(', ')}). 403 = מפתחות VAPID לא תואמים, 404/410 = ההרשמה פגה, ולכן צריך ללחוץ "חיבור" שוב`);}catch(e){add(false,'אין חיבור לשרת');}}
  else if(hasN&&Notification.permission==='granted'){await notify('בדיקת התראות','ההתראות במכשיר עובדות ✓','test-local');add(true,'נשלחה התראת בדיקה מקומית');}
  show();}
$('#diag-button').addEventListener('click',diagnose);
refreshPushState();

/* הפינות שלי בעמוד הבית */
let presetPanel=null;
function renderPanels(){
  const home=$('#panels-home'),list=$('#panel-list');
  if(home)home.innerHTML=panels.map(p=>{const items=sorted(tasks.filter(t=>t.panel===p.id&&(t.type==='general'||taskOnDate(t,selectedDate)))),done=items.filter(t=>t.type==='general'?t.done?.general:doneOn(t,selectedDate)).length;return `<section class="card panel-card" style="--pc:${escapeHtml(p.color)}"><div class="card-title-row"><div><p class="eyebrow">${items.length?`${done} מתוך ${items.length}`:'פינה אישית'}</p><h3>${escapeHtml(p.name)}</h3></div><button class="small-round panel-add" data-panel-id="${p.id}" aria-label="הוספת משימה ל${escapeHtml(p.name)}"></button></div><div class="task-list">${items.length?items.map(t=>taskRow(t,selectedDate,t.type==='general')).join(''):'<div class="empty-state">אין עדיין משימות כאן</div>'}</div></section>`;}).join('');
  if(list)list.innerHTML=panels.length?panels.map(p=>`<div class="group-row" data-panel-id="${p.id}"><input class="group-color panel-color" type="color" value="${escapeHtml(p.color)}" aria-label="צבע הפינה"><input class="panel-name" value="${escapeHtml(p.name)}" maxlength="30" aria-label="שם הפינה"><button class="delete-panel" aria-label="מחיקת הפינה"></button></div>`).join(''):'<div class="empty-state">עוד אין פינות. אפשר ליצור אחת למעלה.</div>';
}
document.addEventListener('submit',e=>{if(e.target.id!=='panel-form')return;e.preventDefault();const name=$('#panel-name-input').value.trim();if(!name)return;panels.push({id:crypto.randomUUID(),name,color:$('#panel-color-input').value||'#2f6fc4'});$('#panel-name-input').value='';save();render();showToast('הפינה נוספה לעמוד הבית');});
document.addEventListener('change',e=>{if(!e.target.matches('.panel-color,.panel-name'))return;const p=panels.find(x=>x.id===e.target.closest('.group-row').dataset.panelId);if(!p)return;if(e.target.matches('.panel-color'))p.color=e.target.value;else p.name=e.target.value.trim()||p.name;save();render();});
document.addEventListener('click',e=>{const t=e.target,add=t.closest('.panel-add'),del=t.closest('.delete-panel');if(add){presetPanel=add.dataset.panelId;openDialog('dated');}else if(del){const id=del.closest('.group-row').dataset.panelId,p=panels.find(x=>x.id===id);if(p&&confirm(`למחוק את הפינה ‘${p.name}’? המשימות שבה יישארו, בלי שיוך.`)){panels=panels.filter(x=>x.id!==id);tasks.forEach(x=>{if(x.panel===id)x.panel='';});save();render();}}});
renderPanels();

/* רענון וסנכרון */
async function refreshApp(){
  const btn=$('#refresh-button');btn.classList.add('spin');
  try{
    if('serviceWorker'in navigator){const reg=await navigator.serviceWorker.getRegistration();await reg?.update();}
    if(API_BASE&&getCode()){const r=await pullData();if(r==='same'||r==='empty')await pushData();}
    showToast('מעדכן...');
    setTimeout(()=>location.reload(),350);
  }catch(e){btn.classList.remove('spin');showToast('הרענון נכשל');}
}
$('#refresh-button').addEventListener('click',refreshApp);
setInterval(()=>{if(document.visibilityState==='visible')pullData();},60000);

/* מיזוג סנכרון: כל פריט נושא זמן עדכון, ומחיקות נשמרות כ"מצבות" כדי שלא יחזרו */
function cols(){return {tasks,groups,lists,panels};}
function getTomb(){try{return JSON.parse(localStorage.getItem('hayom-sheli-tomb')||'{}');}catch(e){return {};}}
function snapOf(){const out={};for(const [c,arr] of Object.entries(cols()))for(const it of arr)out[c+':'+it.id]=JSON.stringify({...it,u:0});return out;}
function stampItems(){const raw=localStorage.getItem('hayom-sheli-snap'),next=snapOf();if(raw){const snap=JSON.parse(raw),tomb=getTomb(),now=Date.now();for(const [c,arr] of Object.entries(cols()))for(const it of arr)if(snap[c+':'+it.id]!==next[c+':'+it.id])it.u=now;for(const k of Object.keys(snap))if(!(k in next))tomb[k]=now;localStorage.setItem('hayom-sheli-tomb',JSON.stringify(tomb));}localStorage.setItem('hayom-sheli-snap',JSON.stringify(next));}
function persistAll(){localStorage.setItem('hayom-sheli-tasks',JSON.stringify(tasks));localStorage.setItem('hayom-sheli-groups',JSON.stringify(groups));localStorage.setItem('hayom-sheli-lists',JSON.stringify(lists));localStorage.setItem('hayom-sheli-panels',JSON.stringify(panels));}
function adoptData(d){tasks=d.tasks||[];groups=d.groups&&d.groups.length?d.groups:defaultGroups;lists=d.lists||[];panels=d.panels||[];if(d.tomb)localStorage.setItem('hayom-sheli-tomb',JSON.stringify(d.tomb));persistAll();localStorage.setItem(updatedKey,String(d.updatedAt||Date.now()));localStorage.setItem('hayom-sheli-snap',JSON.stringify(snapOf()));scheduleReminders();render();}
function mergeIn(data){
  const tomb=getTomb();for(const [k,v] of Object.entries(data.tomb||{}))tomb[k]=Math.max(tomb[k]||0,v);
  const cutoff=Date.now()-60*864e5;for(const k of Object.keys(tomb))if(tomb[k]<cutoff)delete tomb[k];
  const local=cols(),out={};
  for(const c of ['tasks','groups','lists','panels']){const map=new Map(local[c].map(it=>[it.id,it]));for(const it of data[c]||[]){const cur=map.get(it.id);if(!cur||(it.u||0)>(cur.u||0))map.set(it.id,it);}out[c]=[...map.values()].filter(it=>!(tomb[c+':'+it.id]>(it.u||0)));}
  tasks=out.tasks;groups=out.groups.length?out.groups:defaultGroups;lists=out.lists;panels=out.panels;
  localStorage.setItem('hayom-sheli-tomb',JSON.stringify(tomb));persistAll();localStorage.setItem('hayom-sheli-snap',JSON.stringify(snapOf()));
}
if(!localStorage.getItem('hayom-sheli-snap'))localStorage.setItem('hayom-sheli-snap',JSON.stringify(snapOf()));

/* גיבוי */
$('#export-button').addEventListener('click',()=>{const blob=new Blob([JSON.stringify({v:1,tasks,groups,lists,panels,tomb:getTomb(),at:new Date().toISOString()})],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`yomi-backup-${iso(today)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);});
$('#import-input').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{const d=JSON.parse(await f.text());if(!Array.isArray(d.tasks)||!Array.isArray(d.groups))throw new Error('bad');if(!confirm('לשחזר מהגיבוי? המידע שבמכשיר הזה יוחלף.'))return;tasks=d.tasks;groups=d.groups;lists=d.lists||[];panels=d.panels||[];const now=Date.now();[tasks,groups,lists,panels].forEach(a=>a.forEach(it=>{it.u=now;}));save();render();showToast('שוחזר מהגיבוי');}catch(err){showToast('קובץ הגיבוי לא תקין');}e.target.value='';});

/* יומן: תצוגת שבוע */
function startOfWeek(d){const x=new Date(d);x.setDate(x.getDate()-x.getDay());x.setHours(0,0,0,0);return x;}
function renderWeekView(){
  const box=$('#week-view'),card=$('.calendar-card'),week=calMode==='week';
  box.hidden=!week;card.hidden=week;$$('#cal-mode button').forEach(b=>b.classList.toggle('active',b.dataset.mode===calMode));
  if(!week)return;
  const start=startOfWeek(selectedDate),end=new Date(start);end.setDate(end.getDate()+6);
  $('#month-title').textContent=`${start.getDate()} ${months[start.getMonth()]} - ${end.getDate()} ${months[end.getMonth()]}`;
  box.innerHTML=Array.from({length:7},(_,i)=>{const d=new Date(start);d.setDate(start.getDate()+i);const list=sorted(tasks.filter(t=>taskOnDate(t,d)));return `<button class="wk-day ${iso(d)===iso(today)?'today':''} ${iso(d)===iso(selectedDate)?'selected':''}" data-date="${iso(d)}"><span class="wk-head"><small>${days[i].replace('יום ','')}</small><strong>${d.getDate()}</strong></span><span class="wk-tasks">${list.length?list.map(t=>`<span class="wk-task ${doneOn(t,d)?'done':''}" data-id="${t.id}" data-wd="${d.getDay()}" style="--gc:${taskColor(t)||'#9db8d8'}${fmtVars(t,d.getDay())?';'+fmtVars(t,d.getDay()):''}">${t.time?`<em class="wk-time" dir="ltr">${t.time}${t.end?`–${t.end}`:''}</em>`:''}<bdi>${escapeHtml(t.title)}</bdi></span>`).join(''):'<span class="wk-empty">פנוי</span>'}</span></button>`;}).join('');
}
$('#cal-mode').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;calMode=b.dataset.mode;render();});
document.addEventListener('click',e=>{const wd=e.target.closest('.wk-day');if(!wd)return;selectedDate=parseDate(wd.dataset.date);calendarDate=new Date(selectedDate.getFullYear(),selectedDate.getMonth(),1);render();$('#day-dialog').showModal();});
['#prev-month','#next-month'].forEach((sel,i)=>$(sel).addEventListener('click',e=>{if(calMode!=='week')return;e.stopImmediatePropagation();selectedDate=new Date(selectedDate.getTime());selectedDate.setDate(selectedDate.getDate()+(i?7:-7));calendarDate=new Date(selectedDate.getFullYear(),selectedDate.getMonth(),1);render();},true));
renderWeekView();

/* החלקה בטלפון: ימינה = הושלם, שמאלה = העברה ליום אחר */
(()=>{let row=null,wrap=null,x0=0,y0=0,dx=0,moving=false,raf=0;const T=90;
  const reset=(act)=>{if(!row)return;const r=row,w=wrap,d=dx,was=moving;row=null;if(!was)return;r.style.transition='transform .25s cubic-bezier(.2,.8,.2,1)';r.style.transform='';setTimeout(()=>{r.style.willChange='';w.classList.remove('sw-done','sw-move','sw-ready');},260);if(!act)return;if(d>=T)r.querySelector('.task-check')?.click();else if(d<=-T)openMove(r.dataset.id);};
  document.addEventListener('touchstart',e=>{const r=e.target.closest?.('.task-row');if(!r||fmtOn||e.touches.length!==1||e.target.closest('button,input,.chip'))return;row=r;wrap=r.parentElement;x0=e.touches[0].clientX;y0=e.touches[0].clientY;dx=0;moving=false;},{passive:true});
  document.addEventListener('touchmove',e=>{if(!row)return;const t=e.touches[0],mx=t.clientX-x0,my=t.clientY-y0;if(!moving){if(Math.abs(my)>10&&Math.abs(my)>Math.abs(mx)){row=null;return;}if(Math.abs(mx)<8)return;moving=true;row.style.transition='none';row.style.willChange='transform';}dx=Math.max(-150,Math.min(150,mx));if(!raf)raf=requestAnimationFrame(()=>{raf=0;if(!row)return;row.style.transform=`translate3d(${dx}px,0,0)`;wrap.classList.toggle('sw-done',dx>0);wrap.classList.toggle('sw-move',dx<0);wrap.classList.toggle('sw-ready',Math.abs(dx)>=T);});},{passive:true});
  document.addEventListener('touchend',()=>reset(true));
  document.addEventListener('touchcancel',()=>reset(false));
})();

/* סרגל עיצוב משימות (מחשב בלבד): צבע, מרקר, גודל וכתב בולט, לכל משימה בנפרד */
function taskColor(t){const p=t.panel&&panels.find(x=>x.id===t.panel);return p?p.color:getGroup(t)?.color;}
function fmtOf(t,wd){return t.type==='recurring'&&t.fmtDays?t.fmtDays[wd]:t.fmt;}
function fmtVars(t,wd){const f=fmtOf(t,wd)||{},col=v=>/^#[0-9a-f]{3,8}$/i.test(v||'')?v:'',pc=t.panel?col(taskColor(t)):'';return [pc&&`--pc:${pc}`,col(f.bg)&&`--tbg:${col(f.bg)}`,Number(f.size)>0&&`--tsz:${Math.min(1.6,Math.max(.8,Number(f.size)))}`,f.bold&&'--tw:800',col(f.mark)&&`--tmark:${col(f.mark)}`].filter(Boolean).join(';');}
function fmtAttr(t,wd){const v=fmtVars(t,wd);return v?` style="${v}"`:'';}
function fmtKey(el){return `${el.dataset.id||el.dataset.editId}|${el.dataset.wd||''}`;}
function applyFmtSelection(){
  $$('.task-row,.week-task,.wk-task').forEach(r=>r.classList.toggle('fmt-selected',fmtOn&&fmtSel.has(fmtKey(r))));
  const n=fmtSel.size,t=n===1?tasks.find(x=>x.id===[...fmtSel][0].split('|')[0]):null;
  $('#fmt-hint').textContent=!fmtOn||!n?'לחצי על משימה כדי לעצב אותה':n>1?`נבחרו ${n} משימות`:(t?t.title:'');
}
function fmtApply(kind,val){
  if(!fmtSel.size){showToast('בחרי קודם משימה בלחיצה עליה');return;}
  for(const key of fmtSel){
    const [id,wd]=key.split('|'),t=tasks.find(x=>x.id===id);if(!t)continue;
    const rec=t.type==='recurring';
    if(rec&&!t.fmtDays){t.fmtDays={};if(t.fmt){(t.days||[]).forEach(d=>{t.fmtDays[d]={...t.fmt};});delete t.fmt;}}
    if(kind==='reset'){if(rec)delete t.fmtDays[wd];else delete t.fmt;continue;}
    const f={...(rec?(t.fmtDays[wd]||{}):(t.fmt||{}))};
    if(kind==='bg')f.bg=val||'';
    else if(kind==='mark')f.mark=val||'';
    else if(kind==='bigger')f.size=Math.min(1.6,+((f.size||1)+.1).toFixed(2));
    else if(kind==='smaller')f.size=Math.max(.8,+((f.size||1)-.1).toFixed(2));
    else if(kind==='bold')f.bold=!f.bold;
    if(f.size&&Math.abs(f.size-1)<.01)delete f.size;
    Object.keys(f).forEach(k=>{if(!f[k])delete f[k];});
    const has=Object.keys(f).length;
    if(rec){if(has)t.fmtDays[wd]=f;else delete t.fmtDays[wd];}else{if(has)t.fmt=f;else delete t.fmt;}
  }
  save();render();
}
function setFmt(on){fmtOn=on;$('#fmt-tools').hidden=!on;$('#fmt-bar').classList.toggle('open',on);$('#fmt-toggle').classList.toggle('active',on);document.body.classList.toggle('fmt-open',on);if(!on)fmtSel.clear();applyFmtSelection();}
function updateFmtVisibility(){
  const bar=$('#fmt-bar'),drawer=$('#action-drawer'),fine=matchMedia('(hover:hover) and (pointer:fine)').matches;
  const inWeek=!!$('#calendar-view')?.classList.contains('active')&&calMode==='week';
  const inRec=drawer.classList.contains('open')&&drawer.dataset.mode==='page'&&!!$('#recurring-drawer')?.classList.contains('active');
  const show=fine&&(inWeek||inRec);
  if(bar.hidden!==!show)bar.hidden=!show;
  if(!show&&fmtOn)setFmt(false);
}
$('#fmt-toggle').addEventListener('click',()=>setFmt(!fmtOn));
$('#fmt-tools').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.bg!==undefined)fmtApply('bg',b.dataset.bg);else if(b.dataset.mark!==undefined)fmtApply('mark',b.dataset.mark);else if(b.dataset.fmt)fmtApply(b.dataset.fmt);});
$('#fmt-tools').addEventListener('change',e=>{if(e.target.matches('.fmt-custom'))fmtApply(e.target.dataset.custom,e.target.value);});
document.addEventListener('click',e=>{if(!fmtOn)return;if(e.target.closest('input,.fmt-bar'))return;const el=e.target.closest('.task-row,.week-task,.wk-task');if(!el)return;e.preventDefault();e.stopImmediatePropagation();const key=fmtKey(el);if(e.metaKey||e.ctrlKey){if(fmtSel.has(key))fmtSel.delete(key);else fmtSel.add(key);}else{fmtSel.clear();fmtSel.add(key);}applyFmtSelection();},true);
if(typeof MutationObserver!=='undefined')new MutationObserver(updateFmtVisibility).observe(document.body,{subtree:true,attributes:true,attributeFilter:['class','data-mode']});
updateFmtVisibility();applyFmtSelection();

/* חזרה לעמוד הראשי: התאריך חוזר להיום */
document.addEventListener('click',e=>{const tab=e.target.closest('.tab');if(tab&&tab.dataset.view==='today'){selectedDate=new Date(today);calendarDate=new Date(today.getFullYear(),today.getMonth(),1);render();}});

/* מרכז הקשרים: קישורים חכמים, קבצים ואפליקציות */
const pendingFiles=new Map(),MAX_FILE=15*1024*1024;
function attIcon(sub){return ({zoom:'video',meet:'video',teams:'video',youtube:'video',maps:'pin',waze:'nav',whatsapp:'chat',doc:'file',web:'link'})[sub];}
function openDb(){return new Promise((res,rej)=>{const r=indexedDB.open('yomi-files',1);r.onupgradeneeded=()=>r.result.createObjectStore('files');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
async function putFile(id,blob){const db=await openDb();return new Promise((res,rej)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').put(blob,id);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}
async function getFile(id){const db=await openDb();return new Promise((res,rej)=>{const r=db.transaction('files').objectStore('files').get(id);r.onsuccess=()=>res(r.result||null);r.onerror=()=>rej(r.error);});}
async function delFile(id){try{const db=await openDb();return new Promise(res=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').delete(id);tx.oncomplete=()=>res();tx.onerror=()=>res();});}catch(e){}}
async function gcFiles(){try{const db=await openDb(),keys=await new Promise(res=>{const r=db.transaction('files').objectStore('files').getAllKeys();r.onsuccess=()=>res(r.result);r.onerror=()=>res([]);}),used=new Set(tasks.flatMap(t=>(t.attach||[]).filter(a=>a.kind==='file').map(a=>a.id)));for(const k of keys)if(!used.has(k))await delFile(k);}catch(e){}}

function normUrl(raw){raw=(raw||'').trim();if(!raw||/\s/.test(raw))return null;if(!/^[a-z][a-z0-9+.-]*:/i.test(raw)){if(!/^[^\s/]+\.[a-z]{2,}(\/|$|\?|#)/i.test(raw))return null;raw='https://'+raw;}try{return new URL(raw);}catch(e){return null;}}
function parseLink(raw){
  const u=normUrl(raw);if(!u||!/^https?:$/.test(u.protocol))return null;
  const host=u.hostname.replace(/^www\./,''),q=u.searchParams;let path=u.pathname;try{path=decodeURIComponent(path);}catch(e){}
  let kind='web',title=host;
  if(/(^|\.)zoom\.(us|com)$/.test(host)){kind='zoom';title='פגישת Zoom';}
  else if(host==='meet.google.com'){kind='meet';title='פגישת Google Meet';}
  else if(/(^|\.)teams\.(microsoft|live)\.com$/.test(host)){kind='teams';title='פגישת Teams';}
  else if(host==='maps.app.goo.gl'||(host==='goo.gl'&&path.startsWith('/maps'))||(/(^|\.)google\.[a-z.]+$/.test(host)&&path.startsWith('/maps'))){kind='maps';const m=path.match(/\/maps\/(?:place|search)\/([^/@]+)/),name=m?m[1].replace(/\+/g,' '):(q.get('q')||q.get('query')||'');title=name?`Google Maps: ${name}`:'מיקום ב-Google Maps';}
  else if(host==='waze.com'||host.endsWith('.waze.com')){kind='waze';const d=q.get('q');title=d?`Waze: ${d}`:'ניווט ב-Waze';}
  else if(host==='youtu.be'||host.endsWith('youtube.com')){kind='youtube';title='סרטון ב-YouTube';}
  else if(host==='wa.me'||host==='api.whatsapp.com'){kind='whatsapp';title='WhatsApp';}
  else if(host==='docs.google.com'){kind='doc';title=path.startsWith('/spreadsheets')?'גיליון Google':path.startsWith('/presentation')?'מצגת Google':'מסמך Google';}
  else if(host==='drive.google.com'){kind='doc';title='Google Drive';}
  return {url:u.href,kind,title:title.slice(0,80),host};
}
function chipHtml(a,taskId,removable){
  const sub=a.kind==='link'?a.sub:a.kind,icon=a.icon||attIcon(a.sub)||'link',web=a.kind==='link'&&['web','youtube','doc'].includes(a.sub)&&a.host;
  const fav=web?`<img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(a.host)}&sz=64" alt="" onload="this.previousElementSibling.style.display='none'" onerror="this.remove()">`:'';
  return `<button type="button" class="chip k-${sub}" data-attach="${a.id}" data-task="${taskId||''}" title="${escapeHtml(a.host||a.name||'')}"><svg class="ic"><use href="#i-${icon}"/></svg>${fav}<span>${escapeHtml(a.title||a.name||'')}</span>${removable?'<i class="chip-x" role="button" data-remove="'+a.id+'" aria-label="הסרה"></i>':''}</button>`;
}
function chipsHtml(task){return task.attach&&task.attach.length?`<div class="chips">${task.attach.map(a=>chipHtml(a,task.id,false)).join('')}</div>`:'';}
function renderDraftChips(){const box=$('#attach-chips');if(box)box.innerHTML=draftAttach.map(a=>chipHtml(a,'',true)).join('');}
async function enrichTitle(a){
  if(!API_BASE||a.kind!=='link'||!['web','youtube','doc'].includes(a.sub))return;
  try{const r=await api('/api/meta?url='+encodeURIComponent(a.url)),t=((r&&r.title)||'').trim();if(!t)return;a.title=t.slice(0,60);renderDraftChips();if(tasks.some(x=>(x.attach||[]).includes(a))){save();render();}}catch(e){}
}
function addLinkToDraft(raw){const p=parseLink(raw);if(!p){showToast('לא זיהיתי קישור תקין');return false;}if(draftAttach.some(a=>a.url===p.url)){showToast('הקישור כבר צורף');return true;}const a={id:crypto.randomUUID(),kind:'link',sub:p.kind,url:p.url,title:p.title,host:p.host};draftAttach.push(a);renderDraftChips();enrichTitle(a);return true;}
function addFilesToDraft(files){for(const f of files){if(f.size>MAX_FILE){showToast(`‘${f.name}’ גדול מדי (עד 15MB)`);continue;}const id=crypto.randomUUID();pendingFiles.set(id,f);draftAttach.push({id,kind:'file',name:f.name,title:f.name,mime:f.type||'',size:f.size,icon:/^image\//.test(f.type)?'image':'file'});}renderDraftChips();}
function commitAttachments(task){const keep=new Set(draftAttach.map(a=>a.id));(task.attach||[]).filter(a=>a.kind==='file'&&!keep.has(a.id)).forEach(a=>delFile(a.id));for(const [id,f] of pendingFiles)if(keep.has(id))putFile(id,f).catch(()=>showToast('לא הצלחתי לשמור קובץ'));pendingFiles.clear();if(draftAttach.length)task.attach=draftAttach;else delete task.attach;}
async function attachDirect(taskId,files,urlText){
  const t=tasks.find(x=>x.id===taskId);if(!t)return;t.attach=t.attach||[];let n=0;
  for(const f of files){if(f.size>MAX_FILE){showToast(`‘${f.name}’ גדול מדי (עד 15MB)`);continue;}const id=crypto.randomUUID();try{await putFile(id,f);t.attach.push({id,kind:'file',name:f.name,title:f.name,mime:f.type||'',size:f.size,icon:/^image\//.test(f.type)?'image':'file'});n++;}catch(e){showToast('לא הצלחתי לשמור קובץ');}}
  const p=!files.length&&urlText?parseLink(urlText.split('\n')[0].trim()):null;
  if(p&&!t.attach.some(a=>a.url===p.url)){const a={id:crypto.randomUUID(),kind:'link',sub:p.kind,url:p.url,title:p.title,host:p.host};t.attach.push(a);n++;enrichTitle(a);}
  if(!t.attach.length)delete t.attach;if(n){save();render();showToast('צורף למשימה');}
}
async function openAttachment(id,taskId){
  const task=tasks.find(t=>t.id===taskId),a=(task?.attach||[]).find(x=>x.id===id)||draftAttach.find(x=>x.id===id);if(!a)return;
  if(a.kind==='file'){const w=window.open('','_blank'),blob=pendingFiles.get(id)||await getFile(id).catch(()=>null);if(!blob){if(w)w.close();showToast('הקובץ הזה נשמר במכשיר אחר');return;}const url=URL.createObjectURL(blob);if(w)w.location.href=url;else location.href=url;setTimeout(()=>URL.revokeObjectURL(url),60000);return;}
  if(/^https?:/i.test(a.url))window.open(a.url,'_blank','noopener');else location.href=a.url;
}
document.addEventListener('click',e=>{
  const x=e.target.closest('[data-remove]');
  if(x){e.preventDefault();const id=x.dataset.remove;draftAttach=draftAttach.filter(a=>a.id!==id);pendingFiles.delete(id);renderDraftChips();return;}
  const chip=e.target.closest('.chip[data-attach]');if(!chip||fmtOn)return;
  e.preventDefault();openAttachment(chip.dataset.attach,chip.dataset.task);
});
/* הוספת קישור: הדבקה, Enter או כפתור */
const addUrlNow=()=>{const inp=$('#attach-url'),v=inp.value.trim();if(v&&addLinkToDraft(v))inp.value='';};
$('#attach-url').addEventListener('paste',()=>setTimeout(()=>{const v=$('#attach-url').value.trim();if(v&&parseLink(v))addUrlNow();},0));
$('#attach-url').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addUrlNow();}});
$('#attach-add-link').addEventListener('click',addUrlNow);
$('#attach-file').addEventListener('change',e=>{addFilesToDraft([...e.target.files]);e.target.value='';});
/* אפליקציות: רשימה לחיפוש */
const APP_CATALOG=[
  {key:'waze',name:'Waze',icon:'nav',url:'waze://',arg:{ph:'יעד לניווט (אפשר להשאיר ריק)',make:a=>a?`https://waze.com/ul?q=${encodeURIComponent(a)}&navigate=yes`:'waze://'}},
  {key:'maps',name:'Google Maps',icon:'pin',url:'https://maps.google.com/',arg:{ph:'כתובת (אפשר להשאיר ריק)',make:a=>a?`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a)}`:'https://maps.google.com/'}},
  {key:'whatsapp',name:'WhatsApp',icon:'chat',url:'https://wa.me/',arg:{ph:'מספר עם קידומת מדינה (אפשר להשאיר ריק)',make:a=>`https://wa.me/${a.replace(/\D/g,'')}`}},
  {key:'phone',name:'חיוג',icon:'phone',arg:{need:true,ph:'מספר טלפון',make:a=>`tel:${a.replace(/[^\d+]/g,'')}`}},
  {key:'sms',name:'הודעת SMS',icon:'chat',arg:{need:true,ph:'מספר טלפון',make:a=>`sms:${a.replace(/[^\d+]/g,'')}`}},
  {key:'mail',name:'מייל',icon:'mail',arg:{need:true,ph:'כתובת מייל',make:a=>`mailto:${a.trim()}`}},
  {key:'gmail',name:'Gmail',icon:'mail',url:'googlegmail://'},
  {key:'telegram',name:'Telegram',icon:'chat',url:'tg://'},
  {key:'instagram',name:'Instagram',icon:'app',url:'instagram://app'},
  {key:'facebook',name:'Facebook',icon:'app',url:'fb://'},
  {key:'x',name:'X (Twitter)',icon:'app',url:'twitter://'},
  {key:'youtube',name:'YouTube',icon:'video',url:'youtube://'},
  {key:'spotify',name:'Spotify',icon:'app',url:'spotify://'},
  {key:'netflix',name:'Netflix',icon:'video',url:'nflx://'},
  {key:'uber',name:'Uber',icon:'nav',url:'uber://'},
  {key:'moovit',name:'Moovit',icon:'nav',url:'moovit://'},
  {key:'zoom',name:'Zoom',icon:'video',url:'zoomus://'},
  {key:'teams',name:'Microsoft Teams',icon:'video',url:'msteams://'},
  {key:'meet',name:'Google Meet',icon:'video',url:'https://meet.google.com/'},
  {key:'calendar',name:'Google Calendar',icon:'calendar',url:'https://calendar.google.com/'},
  {key:'drive',name:'Google Drive',icon:'file',url:'https://drive.google.com/'},
  {key:'notion',name:'Notion',icon:'file',url:'notion://'},
  {key:'slack',name:'Slack',icon:'chat',url:'slack://'},
  {key:'discord',name:'Discord',icon:'chat',url:'discord://'},
  {key:'bit',name:'Bit',icon:'app',url:'https://www.bitpay.co.il/'},
  {key:'paybox',name:'PayBox',icon:'app',url:'https://payboxapp.com/'},
  {key:'hapoalim',name:'בנק הפועלים',icon:'app',url:'https://www.bankhapoalim.co.il/'},
  {key:'leumi',name:'בנק לאומי',icon:'app',url:'https://www.leumi.co.il/'},
  {key:'discount',name:'בנק דיסקונט',icon:'app',url:'https://www.discountbank.co.il/'},
  {key:'mizrahi',name:'מזרחי-טפחות',icon:'app',url:'https://www.mizrahi-tefahot.co.il/'},
  {key:'isracard',name:'ישראכרט',icon:'app',url:'https://www.isracard.co.il/'},
  {key:'max',name:'MAX',icon:'app',url:'https://www.max.co.il/'},
  {key:'cal',name:'כאל',icon:'app',url:'https://www.cal-online.co.il/'},
  {key:'custom',name:'אחר: להזין קישור או Deep Link',icon:'app',custom:true}
];
function renderAppList(){const q=($('#app-search').value||'').trim().toLowerCase(),list=APP_CATALOG.filter(a=>!q||a.name.toLowerCase().includes(q)||a.key.includes(q));$('#app-list').innerHTML=list.length?list.map(a=>`<button type="button" class="app-item ${appPick&&appPick.key===a.key?'active':''}" data-app="${a.key}"><svg class="ic"><use href="#i-${a.icon}"/></svg><span>${escapeHtml(a.name)}</span></button>`).join(''):'<div class="empty-state">לא נמצאה אפליקציה. אפשר לבחור ״אחר״ ולהזין קישור.</div>';}
function pushApp(app,url,title){draftAttach.push({id:crypto.randomUUID(),kind:'app',app:app.key,icon:app.icon,title:title.slice(0,60),url});renderDraftChips();$('#app-picker').hidden=true;$('#app-extra').hidden=true;$('#app-search').value='';appPick=null;}
$('#attach-app-btn').addEventListener('click',()=>{const p=$('#app-picker');p.hidden=!p.hidden;if(!p.hidden){appPick=null;$('#app-extra').hidden=true;renderAppList();$('#app-search').focus();}});
$('#app-search').addEventListener('input',renderAppList);
$('#app-search').addEventListener('keydown',e=>{if(e.key==='Enter')e.preventDefault();});
$('#app-list').addEventListener('click',e=>{const b=e.target.closest('[data-app]');if(!b)return;const a=APP_CATALOG.find(x=>x.key===b.dataset.app);if(!a)return;appPick=a;
  if(a.arg||a.custom){$('#app-extra').hidden=false;$('#app-name').hidden=!a.custom;$('#app-arg').placeholder=a.custom?'קישור או Deep Link, למשל myapp://pay':a.arg.ph;$('#app-arg').value='';renderAppList();$('#app-arg').focus();}
  else pushApp(a,a.url,a.name);});
$('#app-arg').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#app-add').click();}});
$('#app-add').addEventListener('click',()=>{
  const a=appPick;if(!a){showToast('בחרי קודם אפליקציה');return;}const arg=$('#app-arg').value.trim();
  if(a.custom){const name=$('#app-name').value.trim();if(!name){showToast('חסר שם לאפליקציה');return;}let url=arg;if(!/^[a-z][a-z0-9+.-]*:/i.test(url)){const u=normUrl(url);if(!u){showToast('הקישור לא תקין');return;}url=u.href;}pushApp(a,url,name);$('#app-name').value='';return;}
  if(a.arg.need&&!arg){showToast('חסר ערך לשדה');return;}
  pushApp(a,a.arg.make(arg),arg?`${a.name}: ${arg}`:a.name);
});
/* גרירה והדבקה */
const DROP='#task-dialog,.task-row';
document.addEventListener('dragover',e=>{const tgt=e.target.closest?.(DROP);if(tgt&&[...(e.dataTransfer?.types||[])].some(t=>t==='Files'||t==='text/uri-list'||t==='text/plain')){e.preventDefault();tgt.classList.add('drop-hover');}});
document.addEventListener('dragleave',e=>{e.target.closest?.(DROP)?.classList.remove('drop-hover');});
document.addEventListener('drop',async e=>{
  const tgt=e.target.closest?.(DROP);if(!tgt)return;e.preventDefault();$$('.drop-hover').forEach(x=>x.classList.remove('drop-hover'));
  const files=[...(e.dataTransfer.files||[])],url=e.dataTransfer.getData('text/uri-list')||e.dataTransfer.getData('text/plain')||'';
  if(tgt.id==='task-dialog'){if(files.length)addFilesToDraft(files);else if(url)addLinkToDraft(url.split('\n')[0].trim());}
  else await attachDirect(tgt.dataset.id,files,url);
});
document.addEventListener('paste',e=>{
  if(!$('#task-dialog').open)return;const t=e.target,files=[...(e.clipboardData?.files||[])];
  if(files.length){e.preventDefault();addFilesToDraft(files);return;}
  if(t.id==='attach-url'||t.matches?.('input,textarea,select'))return;
  const txt=(e.clipboardData?.getData('text')||'').trim();if(parseLink(txt)){e.preventDefault();addLinkToDraft(txt);}
});
setTimeout(gcFiles,5000);setInterval(gcFiles,3600000);

/* העברת משימה ליום אחר (החלקה שמאלה) + בחירת תאריך בחלון המשימה */
$('#task-date-input').addEventListener('change',e=>{if(!e.target.value)return;const d=parseDate(e.target.value);if(!isNaN(d))dialogDate=d;});
function openMove(id){const t=tasks.find(x=>x.id===id);if(!t)return;moveCtx={id};$('#move-title').textContent=t.title;const d=new Date(selectedDate);d.setDate(d.getDate()+1);$('#move-date').value=iso(d);$('#move-dialog').showModal();}
function moveTaskTo(date){
  const t=tasks.find(x=>x.id===moveCtx?.id);if(!t||isNaN(date))return;const target=iso(date),from=new Date(selectedDate);
  if(t.type==='recurring'){t.skip={...(t.skip||{}),[iso(from)]:true};const copy={...t,id:crypto.randomUUID(),type:'dated',date:target,done:{},createdAt:Date.now()};delete copy.days;delete copy.skip;delete copy.fmtDays;delete copy.u;if(t.fmtDays&&t.fmtDays[from.getDay()])copy.fmt=t.fmtDays[from.getDay()];tasks.push(copy);}
  else{t.type='dated';t.date=target;delete t.remindDate;}
  $('#move-dialog').close();save();render();showToast('המשימה הועברה ל'+dateName(date));
}
document.addEventListener('click',e=>{
  if(e.target.closest('.close-move')||e.target.id==='move-dialog'){$('#move-dialog').close();return;}
  const q=e.target.closest('#move-dialog [data-days]');if(q){const d=new Date(selectedDate);d.setDate(d.getDate()+Number(q.dataset.days));moveTaskTo(d);return;}
  if(e.target.closest('#move-go')){const v=$('#move-date').value;if(v)moveTaskTo(parseDate(v));}
});
function sigOf(o){const out={};for(const c of ['tasks','groups','lists','panels'])out[c]=(o[c]||[]).map(it=>[it.id,JSON.stringify(it)]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);return JSON.stringify(out);}
