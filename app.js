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
let nudgeIndex = 0, nudgeTimer = null, editingWeekday = null, delCtx = null;
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

function save(){localStorage.setItem('hayom-sheli-tasks',JSON.stringify(tasks));localStorage.setItem('hayom-sheli-groups',JSON.stringify(groups));localStorage.setItem('hayom-sheli-lists',JSON.stringify(lists));localStorage.setItem('hayom-sheli-panels',JSON.stringify(panels));localStorage.setItem('hayom-sheli-updated',String(Date.now()));scheduleReminders();queueSync();}
function taskOnDate(task,date){return task.type==='dated'?task.date===iso(date):task.type==='recurring'&&task.days.includes(date.getDay())&&!task.skip?.[iso(date)];}
function doneOn(task,date){return !!task.done?.[iso(date)];}
function setDone(task,date,value){task.done ||= {};task.done[iso(date)]=value;save();render();}
function dateName(date){return `${days[date.getDay()]}, ${date.getDate()} ב${months[date.getMonth()]}`;}
function sorted(list){return [...list].sort((a,b)=>(a.time||'99:99').localeCompare(b.time||'99:99'));}
function escapeHtml(value){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));}
function getGroup(task){return groups.find(g=>g.id===task.group);}
function taskRow(task,date,general=false){const done=general?!!task.done?.general:doneOn(task,date),group=getGroup(task),reminder=task.reminder&&task.reminder!=='none'?' · תזכורת':'',meta=general?'כללית':task.type==='recurring'?'משימה קבועה':dateName(date);return `<div class="task-row ${done?'done':''}" data-id="${task.id}"><input class="task-check" type="checkbox" ${done?'checked':''} aria-label="סימון משימה כהושלמה">${group?`<i class="group-dot" style="--group-color:${group.color}" title="${escapeHtml(group.name)}"></i>`:''}<div class="task-main"><span class="task-name">${escapeHtml(task.title)}</span><span class="task-meta">${meta}${group?` · ${escapeHtml(group.name)}`:''}${reminder}</span></div>${task.time?`<span class="task-time">${task.time}</span>`:''}<button class="edit-task" aria-label="עריכת משימה">✎</button><button class="delete-task" aria-label="מחיקת משימה">×</button></div>`;}
function renderDateStrip(){const holder=$('#date-strip');holder.innerHTML='';for(let i=-3;i<=5;i++){const d=new Date(today);d.setDate(today.getDate()+i);holder.insertAdjacentHTML('beforeend',`<button class="date-pill ${iso(d)===iso(selectedDate)?'selected':''} ${iso(d)===iso(today)?'today':''}" data-date="${iso(d)}"><span>${shortDays[d.getDay()]}</span><strong>${d.getDate()}</strong></button>`);}}
function renderToday(){const list=sorted(tasks.filter(t=>taskOnDate(t,selectedDate))),complete=list.filter(t=>doneOn(t,selectedDate)).length;$('#schedule-title').textContent=iso(selectedDate)===iso(today)?'היום':dateName(selectedDate);$('#daily-progress').textContent=list.length?`${complete} מתוך ${list.length} הושלמו`:'יום פנוי';$('#daily-tasks').innerHTML=list.length?list.map(t=>taskRow(t,selectedDate)).join(''):'<div class="empty-state">אין כאן עדיין משימות. יום נעים ומרווח ✨</div>';const pending=sorted(list.filter(t=>!doneOn(t,selectedDate))),nowD=new Date(),nowHM=`${String(nowD.getHours()).padStart(2,'0')}:${String(nowD.getMinutes()).padStart(2,'0')}`,upcoming=iso(selectedDate)===iso(today)?pending.filter(t=>!t.time||t.time>=nowHM):pending,next=upcoming[0],overdue=pending.length-upcoming.length;$('#next-task').innerHTML=next?`<strong>${escapeHtml(next.title)}</strong><span>${next.time||'ללא שעה'}${next.type==='recurring'?' · משימה קבועה':''}</span>`:pending.length?`<strong>אין עוד משימות להמשך היום</strong><span>${overdue} ${overdue===1?'משימה שעברה שעתה ממתינה':'משימות שעברה שעתן ממתינות'} לסימון</span>`:'<strong>סיימת הכול להיום ✨</strong><span>זמן לנשום קצת.</span>';const recurring=tasks.filter(t=>t.type==='recurring').slice(0,4);$('#recurring-preview').innerHTML=recurring.length?recurring.map(t=>`<div class="mini-row"><strong>${escapeHtml(t.title)}</strong><span>${t.time||'ללא שעה'}</span></div>`).join(''):'<div class="empty-state">עוד אין משימות קבועות.</div>';}
function renderGeneral(){const list=tasks.filter(t=>t.type==='general');$('#general-tasks').innerHTML=list.length?list.map(t=>taskRow(t,null,true)).join(''):'<div class="empty-state">רשמי כאן כל דבר שתרצי לזכור, בלי להתחייב לתאריך.</div>';}
function renderCalendar(){const y=calendarDate.getFullYear(),m=calendarDate.getMonth();$('#month-title').textContent=`${months[m]} ${y}`;const first=new Date(y,m,1),start=first.getDay(),last=new Date(y,m+1,0).getDate(),previous=new Date(y,m,0).getDate();let cells='';for(let i=0;i<42;i++){const number=i<start?previous-start+i+1:i>=start+last?i-start-last+1:i-start+1,current=i>=start&&i<start+last,d=new Date(y,current?m:(i<start?m-1:m+1),number),dayTasks=tasks.filter(t=>taskOnDate(t,d)),amount=dayTasks.length;cells+=`<button class="calendar-day ${current?'':'muted'} ${iso(d)===iso(today)?'today':''} ${iso(d)===iso(selectedDate)?'selected':''}" data-date="${iso(d)}"><span class="day-number">${number}</span>${amount?`<span class="calendar-dots">${[...new Set(dayTasks.map(t=>getGroup(t)?.color||'#9db8d8'))].slice(0,3).map(col=>`<i class="calendar-dot" style="background:${col}"></i>`).join('')}</span>`:''}</button>`;}$('#calendar-grid').innerHTML=cells;const list=sorted(tasks.filter(t=>taskOnDate(t,selectedDate)));$('#calendar-day-title').textContent=dateName(selectedDate);$('#calendar-day-tasks').innerHTML=list.length?list.map(t=>taskRow(t,selectedDate)).join(''):'<div class="empty-state">אין משימות ביום הזה עדיין. אפשר להוסיף אחת כאן.</div>';}
function renderDrawer(){const week=days.map((day,index)=>{const list=sorted(tasks.filter(t=>t.type==='recurring'&&t.days.includes(index)));return `<section class="week-day"><button class="week-day-head" data-week-day="${index}"><strong>${day}</strong><span>＋ הוספה</span></button><div class="week-tasks">${list.length?list.map(t=>`<button class="week-task" data-edit-id="${t.id}" data-edit-day="${index}"><i class="group-dot" style="--group-color:${getGroup(t)?.color||'#9db8d8'}"></i>${escapeHtml(t.title)}<small>${t.time||''}</small></button>`).join(''):'<div class="week-empty">אין משימות קבועות</div>'}</div></section>`;}).join('');$('#week-table').innerHTML=week;$('#group-list').innerHTML=groups.length?groups.map(g=>`<div class="group-row" data-group-id="${g.id}"><input class="group-color" type="color" value="${g.color}" aria-label="צבע ${escapeHtml(g.name)}"><span>${escapeHtml(g.name)}</span><small>${tasks.filter(t=>t.group===g.id).length} משימות</small><button class="delete-group" aria-label="מחיקת ${escapeHtml(g.name)}">×</button></div>`).join(''):'<div class="empty-state">הוסיפי קבוצה ראשונה.</div>';}
function render(){renderDateStrip();renderToday();renderGeneral();renderCalendar();renderDrawer();renderLists();renderPanels();renderNudge();}
function showToast(text){const toast=$('#toast');toast.textContent=text;toast.classList.add('visible');setTimeout(()=>toast.classList.remove('visible'),2500);}
function fillGroups(selected=''){$('#group-input').innerHTML='<option value="">ללא קבוצה</option>'+groups.map(g=>`<option value="${g.id}" ${g.id===selected?'selected':''}>${escapeHtml(g.name)}</option>`).join('');}
function fillTime(value='',remind='20:00'){const items=n=>'<div data-v="">--</div>'+Array.from({length:n},(_,i)=>{const v=String(i).padStart(2,'0');return `<div data-v="${v}">${v}</div>`;}).join('');for(const [p,val] of [['task',value],['rem',remind]]){const [h,m]=val?val.split(':'):['',''];$(`#${p}-hour-input`).innerHTML=items(24);$(`#${p}-minute-input`).innerHTML=items(60);$(`#${p}-hour-input`).value=h;$(`#${p}-minute-input`).value=m;}}
function selectedTime(){const hour=$('#task-hour-input').value,minute=$('#task-minute-input').value;return hour?`${hour}:${minute||'00'}`:'';}
function openDialog(type,task=null,weekday=null){editingWeekday=Number.isInteger(weekday)?weekday:null;modalType=type;editingTaskId=task?.id||null;dialogDate=task?.date?parseDate(task.date):new Date(selectedDate);$('#task-form').reset();fillGroups(task?.group||'');fillTime(task?.time||'',task?.remindAt||'20:00');$('#repeat-days').style.display=type==='recurring'?'block':'none';$('.date-field').style.display=type==='dated'?'grid':'none';$('.reminder-field').style.display='grid';$('#dialog-kind').textContent=type==='recurring'?'שגרה קבועה':type==='general'?'רשימה כללית':'ליום מסוים';$('#dialog-title').textContent=task?'עריכת משימה':type==='recurring'?'משימה קבועה חדשה':type==='general'?'משימה כללית חדשה':'משימה חדשה';$('#task-title-input').value=task?.title||'';$('#reminder-input').value=task?.reminder||'none';$('#remind-date-input').value=task?.remindDate||iso(today);$('#delete-from-dialog').style.display=task?'block':'none';$('#panel-input').innerHTML='<option value="">ללא מלבן</option>'+panels.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');$('#panel-input').value=task?.panel||presetPanel||'';presetPanel=null;$('.panel-field').style.display=panels.length?'grid':'none';$('#task-date-display').textContent=dateName(dialogDate);$$('#repeat-days input').forEach(input=>input.checked=task?.days?.includes(Number(input.value))||false);$('#task-dialog').showModal();['task','rem'].forEach(p=>['hour','minute'].forEach(k=>{const w=$(`#${p}-${k}-input`);w.value=w.dataset.v||'';}));$('#type-switch').style.display=!task?'grid':'none';setDialogType(type);if(matchMedia('(pointer:fine)').matches)$('#task-title-input').focus();}
function saveTask(){const title=$('#task-title-input').value.trim();if(!title)return;const existing=tasks.find(t=>t.id===editingTaskId),task=existing||{id:crypto.randomUUID(),done:{},createdAt:Date.now()};Object.assign(task,{title,type:modalType,time:selectedTime(),reminder:$('#reminder-input').value,remindAt:$('#reminder-input').value==='day'?`${$('#rem-hour-input').value||'20'}:${$('#rem-minute-input').value||'00'}`:'',group:$('#group-input').value,panel:$('#panel-input').value||'',remindDate:modalType==='general'?($('#remind-date-input').value||iso(today)):''});delete task.date;delete task.days;if(modalType!=='general'||task.reminder==='none')delete task.remindDate;if(modalType==='dated')task.date=iso(dialogDate);if(modalType==='recurring'){task.days=$$('#repeat-days input:checked').map(i=>Number(i.value));if(!task.days.length){showToast('בחרי לפחות יום אחד');return;}}if(!existing)tasks.push(task);save();render();$('#task-dialog').close();showToast(existing?'המשימה עודכנה':'המשימה נשמרה');}
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
async function api(path,options={}){const res=await fetch(API_BASE+path,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});if(!res.ok)throw new Error('http-'+res.status);return res.json();}
function queueSync(){if(!API_BASE||!getCode())return;clearTimeout(syncTimer);syncTimer=setTimeout(pushData,800);}
async function pushData(){try{await api('/api/sync',{method:'PUT',body:JSON.stringify({code:getCode(),tasks,groups,lists,panels,tz:tzName(),updatedAt:Number(localStorage.getItem(updatedKey)||Date.now())})});syncStatus('מסונכרן ✓');return true;}catch(e){syncStatus('הסנכרון נכשל. ננסה שוב בשמירה הבאה');return false;}}
async function pullData(){
  if(!API_BASE||!getCode())return 'off';
  try{
    const data=await api('/api/sync?code='+encodeURIComponent(getCode()));
    if(!data||!data.updatedAt)return 'empty';
    if(data.updatedAt>Number(localStorage.getItem(updatedKey)||0)){
      tasks=data.tasks||[];groups=data.groups||defaultGroups;if(Array.isArray(data.lists)){lists=data.lists;localStorage.setItem('hayom-sheli-lists',JSON.stringify(lists));}if(Array.isArray(data.panels)){panels=data.panels;localStorage.setItem('hayom-sheli-panels',JSON.stringify(panels));}
      localStorage.setItem('hayom-sheli-tasks',JSON.stringify(tasks));localStorage.setItem('hayom-sheli-groups',JSON.stringify(groups));localStorage.setItem(updatedKey,String(data.updatedAt));
      scheduleReminders();render();return 'applied';
    }
    return 'same';
  }catch(e){return 'error';}
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
function onResume(){refreshToday();if(hiddenAt&&Date.now()-hiddenAt>600000){selectedDate=new Date(today);calendarDate=new Date(today.getFullYear(),today.getMonth(),1);render();}$('#today-label').textContent=dateName(today);pruneDone();hiddenAt=0;}
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
async function refreshPushState(){try{if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window)){localStorage.removeItem('hayom-sheli-push');scheduleReminders();return;}const reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();if(!(sub&&Notification.permission==='granted'&&getCode()))localStorage.removeItem('hayom-sheli-push');scheduleReminders();}catch(e){}}
async function diagnose(){const out=$('#diag-result'),lines=[],add=(ok,t)=>lines.push(`${ok?'✓':'✗'} ${t}`),show=()=>{out.textContent=lines.join('\n');};
  const hasN='Notification'in window;add(hasN&&Notification.permission==='granted',hasN?'התראות מאושרות במכשיר':'הדפדפן לא תומך בהתראות (באייפון צריך להתקין למסך הבית ולפתוח משם)');
  let reg=null,sub=null;try{reg='serviceWorker'in navigator?await navigator.serviceWorker.getRegistration():null;sub=reg&&reg.pushManager?await reg.pushManager.getSubscription():null;}catch(e){}
  add(!!(reg&&reg.active),'שירות הרקע פעיל');add(!!sub,'המכשיר רשום להתראות מהשרת');add(!!getCode(),'קוד סנכרון מוגדר');add(!!API_BASE,'כתובת שרת מוגדרת');show();
  if(API_BASE&&getCode()){try{const r=await api('/api/test',{method:'POST',body:JSON.stringify({code:getCode()})});if(r.subs===undefined)add(false,'השרת בגרסה ישנה: יש להדביק מחדש את worker.js ב-Cloudflare');else if(!r.subs)add(false,'אין מכשיר רשום בשרת. לחצי "חיבור" בסנכרון שוב');else if(r.ok)add(true,`התראת בדיקה נשלחה מהשרת (${r.ok} מתוך ${r.subs})`);else add(false,`השרת לא הצליח לשלוח (קוד ${r.fail.join(', ')}). 403 = מפתחות VAPID לא תואמים, 404/410 = ההרשמה פגה, ולכן צריך ללחוץ "חיבור" שוב`);}catch(e){add(false,'אין חיבור לשרת');}}
  else if(hasN&&Notification.permission==='granted'){await notify('בדיקת התראות','ההתראות במכשיר עובדות ✓','test-local');add(true,'נשלחה התראת בדיקה מקומית');}
  show();}
$('#diag-button').addEventListener('click',diagnose);
refreshPushState();

/* מלבנים אישיים בעמוד הבית */
let presetPanel=null;
function renderPanels(){
  const home=$('#panels-home'),list=$('#panel-list');
  if(home)home.innerHTML=panels.map(p=>{const items=sorted(tasks.filter(t=>t.panel===p.id&&(t.type==='general'||taskOnDate(t,selectedDate)))),done=items.filter(t=>t.type==='general'?t.done?.general:doneOn(t,selectedDate)).length;return `<section class="card panel-card" style="--pc:${escapeHtml(p.color)}"><div class="card-title-row"><div><p class="eyebrow">${items.length?`${done} מתוך ${items.length}`:'מלבן אישי'}</p><h3>${escapeHtml(p.name)}</h3></div><button class="small-round panel-add" data-panel-id="${p.id}" aria-label="הוספת משימה ל${escapeHtml(p.name)}"></button></div><div class="task-list">${items.length?items.map(t=>taskRow(t,selectedDate,t.type==='general')).join(''):'<div class="empty-state">אין עדיין משימות כאן</div>'}</div></section>`;}).join('');
  if(list)list.innerHTML=panels.length?panels.map(p=>`<div class="group-row" data-panel-id="${p.id}"><input class="group-color panel-color" type="color" value="${escapeHtml(p.color)}" aria-label="צבע המלבן"><input class="panel-name" value="${escapeHtml(p.name)}" maxlength="30" aria-label="שם המלבן"><button class="delete-panel" aria-label="מחיקת המלבן"></button></div>`).join(''):'<div class="empty-state">עוד אין מלבנים. אפשר ליצור אחד למעלה.</div>';
}
document.addEventListener('submit',e=>{if(e.target.id!=='panel-form')return;e.preventDefault();const name=$('#panel-name-input').value.trim();if(!name)return;panels.push({id:crypto.randomUUID(),name,color:$('#panel-color-input').value||'#2f6fc4'});$('#panel-name-input').value='';save();render();showToast('המלבן נוסף לעמוד הבית');});
document.addEventListener('change',e=>{if(!e.target.matches('.panel-color,.panel-name'))return;const p=panels.find(x=>x.id===e.target.closest('.group-row').dataset.panelId);if(!p)return;if(e.target.matches('.panel-color'))p.color=e.target.value;else p.name=e.target.value.trim()||p.name;save();render();});
document.addEventListener('click',e=>{const t=e.target,add=t.closest('.panel-add'),del=t.closest('.delete-panel');if(add){presetPanel=add.dataset.panelId;openDialog('dated');}else if(del){const id=del.closest('.group-row').dataset.panelId,p=panels.find(x=>x.id===id);if(p&&confirm(`למחוק את המלבן ‘${p.name}’? המשימות שבו יישארו, בלי שיוך.`)){panels=panels.filter(x=>x.id!==id);tasks.forEach(x=>{if(x.panel===id)x.panel='';});save();render();}}});
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
