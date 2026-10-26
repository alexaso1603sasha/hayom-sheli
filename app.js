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
const today = new Date(); today.setHours(0, 0, 0, 0);
let selectedDate = new Date(today), calendarDate = new Date(today.getFullYear(), today.getMonth(), 1), dialogDate = new Date(today), modalType = 'dated', editingTaskId = null, timeoutIds = [];

const sample = [
  {id:'welcome-1',title:'תכנון קצר ליום',type:'recurring',days:[0,1,2,3,4],time:'08:30',reminder:'0',group:'personal',done:{}},
  {id:'welcome-2',title:'אימון פילאטיס',type:'recurring',days:[1,3],time:'18:00',reminder:'15',group:'personal',done:{}},
  {id:'welcome-3',title:'לקבוע תור לרופאה',type:'general',time:'',reminder:'none',group:'personal',done:{}},
  {id:'welcome-4',title:'שיחת צוות',type:'dated',date:iso(today),time:'10:00',reminder:'5',group:'meetings',done:{}}
];
const defaultGroups = [{id:'personal',name:'אישי',color:'#3d3152'},{id:'meetings',name:'פגישות',color:'#b8924a'},{id:'shopping',name:'קניות',color:'#8c7fa6'}];
let tasks = JSON.parse(localStorage.getItem('hayom-sheli-tasks') || 'null') || sample;
let groups = JSON.parse(localStorage.getItem('hayom-sheli-groups') || 'null') || defaultGroups;

function save(){localStorage.setItem('hayom-sheli-tasks',JSON.stringify(tasks));localStorage.setItem('hayom-sheli-groups',JSON.stringify(groups));localStorage.setItem('hayom-sheli-updated',String(Date.now()));scheduleReminders();queueSync();}
function taskOnDate(task,date){return task.type==='dated'?task.date===iso(date):task.type==='recurring'&&task.days.includes(date.getDay());}
function doneOn(task,date){return !!task.done?.[iso(date)];}
function setDone(task,date,value){task.done ||= {};task.done[iso(date)]=value;save();render();}
function dateName(date){return `${days[date.getDay()]}, ${date.getDate()} ב${months[date.getMonth()]}`;}
function sorted(list){return [...list].sort((a,b)=>(a.time||'99:99').localeCompare(b.time||'99:99'));}
function escapeHtml(value){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));}
function getGroup(task){return groups.find(g=>g.id===task.group);}
function taskRow(task,date,general=false){const done=general?!!task.done?.general:doneOn(task,date),group=getGroup(task),reminder=task.reminder&&task.reminder!=='none'?' · תזכורת':'',meta=general?'כללית':task.type==='recurring'?'משימה קבועה':dateName(date);return `<div class="task-row ${done?'done':''}" data-id="${task.id}"><input class="task-check" type="checkbox" ${done?'checked':''} aria-label="סימון משימה כהושלמה">${group?`<i class="group-dot" style="--group-color:${group.color}" title="${escapeHtml(group.name)}"></i>`:''}<div class="task-main"><span class="task-name">${escapeHtml(task.title)}</span><span class="task-meta">${meta}${group?` · ${escapeHtml(group.name)}`:''}${reminder}</span></div>${task.time?`<span class="task-time">${task.time}</span>`:''}<button class="edit-task" aria-label="עריכת משימה">עריכה</button><button class="delete-task" aria-label="מחיקת משימה">×</button></div>`;}
function renderDateStrip(){const holder=$('#date-strip');holder.innerHTML='';for(let i=-3;i<=5;i++){const d=new Date(today);d.setDate(today.getDate()+i);holder.insertAdjacentHTML('beforeend',`<button class="date-pill ${iso(d)===iso(selectedDate)?'selected':''}" data-date="${iso(d)}"><span>${shortDays[d.getDay()]}</span><strong>${d.getDate()}</strong></button>`);}}
function renderToday(){const list=sorted(tasks.filter(t=>taskOnDate(t,selectedDate))),complete=list.filter(t=>doneOn(t,selectedDate)).length;$('#schedule-title').textContent=iso(selectedDate)===iso(today)?'היום':dateName(selectedDate);$('#daily-progress').textContent=list.length?`${complete} מתוך ${list.length} הושלמו`:'יום פנוי';$('#daily-tasks').innerHTML=list.length?list.map(t=>taskRow(t,selectedDate)).join(''):'<div class="empty-state">אין כאן עדיין משימות. יום נעים ומרווח ✨</div>';const next=sorted(list.filter(t=>!doneOn(t,selectedDate)))[0];$('#next-task').innerHTML=next?`<strong>${escapeHtml(next.title)}</strong><span>${next.time||'ללא שעה'}${next.type==='recurring'?' · משימה קבועה':''}</span>`:'<strong>סיימת הכול להיום ✨</strong><span>זמן לנשום קצת.</span>';const recurring=tasks.filter(t=>t.type==='recurring').slice(0,4);$('#recurring-preview').innerHTML=recurring.length?recurring.map(t=>`<div class="mini-row"><strong>${escapeHtml(t.title)}</strong><span>${t.time||'ללא שעה'}</span></div>`).join(''):'<div class="empty-state">עוד אין משימות קבועות.</div>';}
function renderGeneral(){const list=tasks.filter(t=>t.type==='general');$('#general-tasks').innerHTML=list.length?list.map(t=>taskRow(t,null,true)).join(''):'<div class="empty-state">רשמי כאן כל דבר שתרצי לזכור, בלי להתחייב לתאריך.</div>';}
function renderCalendar(){const y=calendarDate.getFullYear(),m=calendarDate.getMonth();$('#month-title').textContent=`${months[m]} ${y}`;const first=new Date(y,m,1),start=first.getDay(),last=new Date(y,m+1,0).getDate(),previous=new Date(y,m,0).getDate();let cells='';for(let i=0;i<42;i++){const number=i<start?previous-start+i+1:i>=start+last?i-start-last+1:i-start+1,current=i>=start&&i<start+last,d=new Date(y,current?m:(i<start?m-1:m+1),number),amount=tasks.filter(t=>taskOnDate(t,d)).length;cells+=`<button class="calendar-day ${current?'':'muted'} ${iso(d)===iso(today)?'today':''} ${iso(d)===iso(selectedDate)?'selected':''}" data-date="${iso(d)}"><span class="day-number">${number}</span>${amount?`<span class="calendar-dots">${Array(Math.min(amount,3)).fill('<i class="calendar-dot"></i>').join('')}</span>`:''}</button>`;}$('#calendar-grid').innerHTML=cells;const list=sorted(tasks.filter(t=>taskOnDate(t,selectedDate)));$('#calendar-day-title').textContent=dateName(selectedDate);$('#calendar-day-tasks').innerHTML=list.length?list.map(t=>taskRow(t,selectedDate)).join(''):'<div class="empty-state">אין משימות ביום הזה עדיין. אפשר להוסיף אחת כאן.</div>';}
function renderDrawer(){const week=days.map((day,index)=>{const list=sorted(tasks.filter(t=>t.type==='recurring'&&t.days.includes(index)));return `<section class="week-day"><button class="week-day-head" data-week-day="${index}"><strong>${day}</strong><span>＋ הוספה</span></button><div class="week-tasks">${list.length?list.map(t=>`<button class="week-task" data-edit-id="${t.id}"><i class="group-dot" style="--group-color:${getGroup(t)?.color||'#b9b3c8'}"></i>${escapeHtml(t.title)}<small>${t.time||''}</small></button>`).join(''):'<div class="week-empty">אין משימות קבועות</div>'}</div></section>`;}).join('');$('#week-table').innerHTML=week;$('#group-list').innerHTML=groups.length?groups.map(g=>`<div class="group-row" data-group-id="${g.id}"><input class="group-color" type="color" value="${g.color}" aria-label="צבע ${escapeHtml(g.name)}"><span>${escapeHtml(g.name)}</span><small>${tasks.filter(t=>t.group===g.id).length} משימות</small><button class="delete-group" aria-label="מחיקת ${escapeHtml(g.name)}">×</button></div>`).join(''):'<div class="empty-state">הוסיפי קבוצה ראשונה.</div>';}
function render(){renderDateStrip();renderToday();renderGeneral();renderCalendar();renderDrawer();}
function showToast(text){const toast=$('#toast');toast.textContent=text;toast.classList.add('visible');setTimeout(()=>toast.classList.remove('visible'),2500);}
function fillGroups(selected=''){$('#group-input').innerHTML='<option value="">ללא קבוצה</option>'+groups.map(g=>`<option value="${g.id}" ${g.id===selected?'selected':''}>${escapeHtml(g.name)}</option>`).join('');}
function fillTime(value=''){const [h,m]=value?value.split(':'):['',''],items=n=>'<div data-v="">--</div>'+Array.from({length:n},(_,i)=>{const v=String(i).padStart(2,'0');return `<div data-v="${v}">${v}</div>`;}).join('');$('#task-hour-input').innerHTML=items(24);$('#task-minute-input').innerHTML=items(60);$('#task-hour-input').value=h;$('#task-minute-input').value=m;}
function selectedTime(){const hour=$('#task-hour-input').value,minute=$('#task-minute-input').value;return hour?`${hour}:${minute||'00'}`:'';}
function openDialog(type,task=null){modalType=type;editingTaskId=task?.id||null;dialogDate=task?.date?parseDate(task.date):new Date(selectedDate);$('#task-form').reset();fillGroups(task?.group||'');fillTime(task?.time||'');$('#repeat-days').style.display=type==='recurring'?'block':'none';$('.date-field').style.display=type==='dated'?'grid':'none';$('.reminder-field').style.display=type==='general'?'none':'grid';$('#dialog-kind').textContent=type==='recurring'?'שגרה קבועה':type==='general'?'רשימה כללית':'ליום מסוים';$('#dialog-title').textContent=task?'עריכת משימה':type==='recurring'?'משימה קבועה חדשה':type==='general'?'משימה כללית חדשה':'משימה חדשה';$('#task-title-input').value=task?.title||'';$('#reminder-input').value=task?.reminder||'none';$('#task-date-display').textContent=dateName(dialogDate);$$('#repeat-days input').forEach(input=>input.checked=task?.days?.includes(Number(input.value))||false);$('#task-dialog').showModal();['hour','minute'].forEach(k=>{const w=$('#task-'+k+'-input');w.value=w.dataset.v||'';});if(matchMedia('(pointer:fine)').matches)$('#task-title-input').focus();}
function saveTask(){const title=$('#task-title-input').value.trim();if(!title)return;const existing=tasks.find(t=>t.id===editingTaskId),task=existing||{id:crypto.randomUUID(),done:{}};Object.assign(task,{title,type:modalType,time:selectedTime(),reminder:$('#reminder-input').value,group:$('#group-input').value});delete task.date;delete task.days;if(modalType==='dated')task.date=iso(dialogDate);if(modalType==='recurring'){task.days=$$('#repeat-days input:checked').map(i=>Number(i.value));if(!task.days.length){showToast('בחרי לפחות יום אחד');return;}}if(!existing)tasks.push(task);save();render();$('#task-dialog').close();showToast(existing?'המשימה עודכנה':'המשימה נשמרה');}
function switchDrawer(view){$('#action-drawer').dataset.mode=view?'page':'menu';$$('.drawer-page').forEach(page=>page.classList.toggle('active',page.id===`${view}-drawer`));}
function toggleDrawer(open){if(open)switchDrawer(null);$('#action-drawer').classList.toggle('open',open);$('#drawer-overlay').classList.toggle('open',open);}
async function enableNotifications(){if(!('Notification'in window)){showToast('הדפדפן הזה לא תומך בהתראות');return;}const result=await Notification.requestPermission();if(result==='granted'){showToast('התזכורות הופעלו');scheduleReminders();notify('התזכורות פעילות ✨ ככה ייראו ההתראות','test');subscribePush();}else showToast('אפשר לאפשר התראות בהגדרות הדפדפן');}
async function notify(body,tag){const title='יומי',options={body,icon:'icon.svg',tag};try{const reg='serviceWorker'in navigator?await navigator.serviceWorker.getRegistration():null;if(reg&&reg.active){await reg.showNotification(title,options);return;}}catch(e){}try{new Notification(title,options);}catch(e){}}
function scheduleReminders(){timeoutIds.forEach(clearTimeout);timeoutIds=[];if(!('Notification'in window)||Notification.permission!=='granted')return;for(const task of tasks){if(!task.time||!task.reminder||task.reminder==='none')continue;for(let offset=0;offset<2;offset++){const d=new Date(today);d.setDate(today.getDate()+offset);if(!taskOnDate(task,d)||doneOn(task,d))continue;const[h,min]=task.time.split(':').map(Number);d.setHours(h,min-Number(task.reminder),0,0);const delay=d-Date.now();if(delay>0&&delay<172800000)timeoutIds.push(setTimeout(()=>notify(`תזכורת: ${task.title}`,`${task.id}-${iso(d)}`),delay));}}}
document.addEventListener('click',event=>{const target=event.target;if(target.closest('#open-drawer'))return toggleDrawer(true);if(target.closest('#week-schedule-button')){toggleDrawer(true);switchDrawer('recurring');return;}if(target.closest('#close-drawer')||target.closest('#drawer-overlay'))return toggleDrawer(false);if(target.closest('#drawer-back'))return switchDrawer(null);if(target.closest('.close-day')||target.id==='day-dialog')return $('#day-dialog').close();const section=target.closest('.drawer-section');if(section)return switchDrawer(section.dataset.drawerView);if(target.closest('.close-dialog'))return $('#task-dialog').close();if(target.closest('#drawer-notification-button')||target.closest('#notification-button'))return enableNotifications();if(target.closest('#add-group')){switchDrawer('groups');$('#group-name-input').focus();return;}const weekDay=target.closest('[data-week-day]');if(weekDay){const day=Number(weekDay.dataset.weekDay);openDialog('recurring');$$('#repeat-days input').forEach(input=>input.checked=Number(input.value)===day);return;}const add=target.closest('.add-task');if(add)return openDialog(add.dataset.type);const editFromDrawer=target.closest('[data-edit-id]');if(editFromDrawer){const task=tasks.find(t=>t.id===editFromDrawer.dataset.editId);return openDialog(task.type,task);}const pill=target.closest('.date-pill');if(pill){selectedDate=parseDate(pill.dataset.date);render();return;}const day=target.closest('.calendar-day');if(day){selectedDate=parseDate(day.dataset.date);calendarDate=new Date(selectedDate.getFullYear(),selectedDate.getMonth(),1);render();$('#day-dialog').showModal();return;}const row=target.closest('.task-row');if(row){const task=tasks.find(t=>t.id===row.dataset.id);if(!task)return;if(target.closest('.delete-task')){tasks=tasks.filter(t=>t.id!==task.id);save();render();showToast('המשימה נמחקה');}else if(target.closest('.edit-task'))openDialog(task.type,task);else if(target.matches('.task-check')){if(task.type==='general'){task.done ||= {};task.done.general=target.checked;save();render();}else setDone(task,selectedDate,target.checked);}}const deleteGroup=target.closest('.delete-group');if(deleteGroup){const id=deleteGroup.closest('.group-row').dataset.groupId;tasks.forEach(t=>{if(t.group===id)t.group='';});groups=groups.filter(g=>g.id!==id);save();render();showToast('הקבוצה הוסרה');}});
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
async function pushData(){try{await api('/api/sync',{method:'PUT',body:JSON.stringify({code:getCode(),tasks,groups,tz:tzName(),updatedAt:Number(localStorage.getItem(updatedKey)||Date.now())})});syncStatus('מסונכרן ✓');return true;}catch(e){syncStatus('הסנכרון נכשל. ננסה שוב בשמירה הבאה');return false;}}
async function pullData(){
  if(!API_BASE||!getCode())return 'off';
  try{
    const data=await api('/api/sync?code='+encodeURIComponent(getCode()));
    if(!data||!data.updatedAt)return 'empty';
    if(data.updatedAt>Number(localStorage.getItem(updatedKey)||0)){
      tasks=data.tasks||[];groups=data.groups||defaultGroups;
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
    await api('/api/subscribe',{method:'POST',body:JSON.stringify({code:getCode(),subscription:sub.toJSON()})});
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
  Object.defineProperty(el,'value',{get(){return el.dataset.v||'';},set(v){el.dataset.v=v;const i=[...el.children].findIndex(c=>c.dataset.v===v);el.scrollTop=Math.max(0,i)*44;markWheel(el);}});
  el.addEventListener('scroll',()=>{clearTimeout(el._t);el._t=setTimeout(()=>{const i=Math.min(el.children.length-1,Math.max(0,Math.round(el.scrollTop/44)));if(el.children[i]){el.dataset.v=el.children[i].dataset.v;markWheel(el);}},70);});
}
initWheel($('#task-hour-input'));initWheel($('#task-minute-input'));
