let activities = [];
let counter = 0;
let previewUrl = null;
let activeActivityId = null;
let coverDesign = 'modern';
let initializing = true;
const imageDbName = 'reporter-images';
const imageStoreName = 'activity-images';
const savedFieldConfig = {
  teacherName: {storageKey: 'reporter-teachers', listId: 'teacherList'},
  studentName: {storageKey: 'reporter-student-names', listId: 'studentNameList'},
  studentGroup: {storageKey: 'reporter-student-groups', listId: 'studentGroupList'},
  courseName: {storageKey: 'reporter-course-names', listId: 'courseNameList'}
};

const coverDesignOptions = [
  {value:'modern', label:'Modern'},
  {value:'bold', label:'Bold'},
  {value:'academic', label:'Academic'},
  {value:'color', label:'Color block'}
];

const dividerOptions = [
  {value:'minimal', label:'Minimal'},
  {value:'banner', label:'Banner'},
  {value:'card', label:'Card'},
  {value:'grid', label:'Grid'},
  {value:'classic', label:'Classic'}
];

function addActivity(){
  const id = counter++;
  activities.push({id, title:'Activity ' + (activities.length + 1), files:[], design:'minimal'});
  render();
  if(!initializing) persistImages();
}

function removeActivity(id){
  activities = activities.filter(a=>a.id!==id);
  activities.forEach((act, idx)=>{ act.title = act.title || 'Activity ' + (idx + 1); if(!act.title.startsWith('Activity')) act.title = 'Activity ' + (idx + 1); });
  render();
  persistImages();
}

function addFiles(id, fileList){
  const act = activities.find(a=>a.id===id);
  for(const f of fileList){
    if(f.type.startsWith('image/')) act.files.push(f);
  }
  render();
  persistImages();
}

function addPastedImages(id, clipboardData){
  const imageFiles = [];
  for(const item of clipboardData.items){
    if(item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const blob = item.getAsFile();
    if(blob) imageFiles.push(new File([blob], 'pasted-image-' + Date.now() + '.png', {type:blob.type}));
  }
  if(imageFiles.length) addFiles(id, imageFiles);
}

function pasteImagesIntoActiveActivity(clipboardData){
  const target = document.activeElement.closest?.('.activity');
  const targetActivity = target
    ? activities.find(activity => target.querySelector('.drop') && activity.id === Number(target.dataset.activityId))
    : null;
  const activity = targetActivity || activities.find(item => item.id === activeActivityId) || activities[0];
  if(activity) addPastedImages(activity.id, clipboardData);
}

function setActiveActivity(id){
  activeActivityId = id;
  document.querySelectorAll('.activity').forEach(activity => {
    activity.classList.toggle('active', Number(activity.dataset.activityId) === id);
  });
}

function loadSavedField(fieldId){
  const config = savedFieldConfig[fieldId];
  const values = JSON.parse(localStorage.getItem(config.storageKey) || '[]');
  const list = document.getElementById(config.listId);
  list.innerHTML = '';
  values.forEach(value => {
    const option = document.createElement('option');
    option.value = value;
    list.appendChild(option);
  });
}

function saveField(fieldId){
  const config = savedFieldConfig[fieldId];
  const input = document.getElementById(fieldId);
  const value = input.value.trim();
  if(!value) return;
  const values = JSON.parse(localStorage.getItem(config.storageKey) || '[]');
  if(!values.includes(value)) values.push(value);
  localStorage.setItem(config.storageKey, JSON.stringify(values));
  loadSavedField(fieldId);
}

function removeFile(id, idx){
  const act = activities.find(a=>a.id===id);
  act.files.splice(idx,1);
  render();
  persistImages();
}

function openImageDb(){
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(imageDbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(imageStoreName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function persistImages(){
  try{
    const db = await openImageDb();
    const transaction = db.transaction(imageStoreName, 'readwrite');
    const store = transaction.objectStore(imageStoreName);
    store.clear();
    activities.forEach((activity, activityIndex) => {
      activity.files.forEach((file, fileIndex) => {
        store.put({activityIndex, name:file.name, type:file.type, blob:file}, activityIndex + ':' + fileIndex);
      });
    });
  }catch(error){
    console.warn('Could not persist images.', error);
  }
}

async function restoreImages(){
  try{
    const db = await openImageDb();
    const request = db.transaction(imageStoreName, 'readonly').objectStore(imageStoreName).getAll();
    request.onsuccess = () => {
      request.result.forEach(record => {
        while(!activities[record.activityIndex]){
          const id = counter++;
          activities.push({id, title:'Activity ' + (activities.length + 1), files:[], design:'minimal'});
        }
        activities[record.activityIndex].files.push(new File([record.blob], record.name, {type:record.type}));
      });
      render();
    };
  }catch(error){
    console.warn('Could not restore images.', error);
  }
}

async function resetImages(){
  activities.forEach(activity => { activity.files = []; });
  render();
  try{
    const db = await openImageDb();
    db.transaction(imageStoreName, 'readwrite').objectStore(imageStoreName).clear();
  }catch(error){
    console.warn('Could not reset saved images.', error);
  }
}

function render(){
  const wrap = document.getElementById('activities');
  wrap.innerHTML = '';
  activities.forEach((act)=>{
    const div = document.createElement('div');
    div.className = 'activity';
    div.dataset.activityId = act.id;
    div.onmouseenter = () => setActiveActivity(act.id);

    const head = document.createElement('div');
    head.className = 'activity-head';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = act.title;
    input.oninput = e => act.title = e.target.value;

    const rm = document.createElement('button');
    rm.className = 'remove-act';
    rm.textContent = 'Remove';
    rm.onclick = ()=>removeActivity(act.id);
    head.appendChild(input);
    const pasteTarget = document.createElement('button');
    pasteTarget.type = 'button';
    pasteTarget.className = 'paste-target';
    pasteTarget.textContent = 'Paste here';
    pasteTarget.title = 'Make this activity the paste destination';
    pasteTarget.onclick = () => setActiveActivity(act.id);
    head.appendChild(pasteTarget);
    head.appendChild(rm);

    const body = document.createElement('div');
    body.className = 'activity-body';

    const formatWrap = document.createElement('div');
    formatWrap.className = 'activity-format';
    const label = document.createElement('span');
    label.className = 'design-label';
    label.textContent = 'Choose a design';
    formatWrap.appendChild(label);
    const options = document.createElement('div');
    options.className = 'design-options';
    dividerOptions.forEach(opt => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'design-option' + (act.design === opt.value ? ' selected' : '');
      option.setAttribute('aria-pressed', act.design === opt.value ? 'true' : 'false');
      const swatch = document.createElement('span');
      swatch.className = 'design-swatch swatch-' + opt.value;
      if(opt.value === 'banner'){
        swatch.appendChild(document.createElement('span'));
        swatch.appendChild(document.createElement('span'));
      } else {
        swatch.appendChild(document.createElement('span'));
      }
      const name = document.createElement('span');
      name.textContent = opt.label;
      option.appendChild(swatch);
      option.appendChild(name);
      option.onclick = () => { act.design = opt.value; render(); };
      options.appendChild(option);
    });
    formatWrap.appendChild(options);
    body.appendChild(formatWrap);

    const drop = document.createElement('div');
    drop.className = 'drop';
    drop.textContent = 'Click, drop, or paste images here';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.multiple = true;
    fileInput.style.display = 'none';
    fileInput.onchange = e => { addFiles(act.id, e.target.files); fileInput.value=''; };
    drop.onclick = ()=>fileInput.click();
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('drag'); };
    drop.ondragleave = ()=>drop.classList.remove('drag');
    drop.ondrop = e => {
      e.preventDefault();
      drop.classList.remove('drag');
      addFiles(act.id, e.dataTransfer.files);
    };
    drop.tabIndex = 0;
    drop.onfocus = () => setActiveActivity(act.id);

    body.appendChild(drop);
    body.appendChild(fileInput);

    if(act.files.length){
      const thumbs = document.createElement('div');
      thumbs.className = 'thumbs';
      act.files.forEach((f,idx)=>{
        const t = document.createElement('div');
        t.className = 'thumb';
        const img = document.createElement('img');
        img.src = URL.createObjectURL(f);
        const x = document.createElement('div');
        x.className = 'x';
        x.textContent = '×';
        x.onclick = ()=>removeFile(act.id, idx);
        t.appendChild(img);
        t.appendChild(x);
        thumbs.appendChild(t);
      });
      body.appendChild(thumbs);
    }

    div.appendChild(head);
    div.appendChild(body);
    wrap.appendChild(div);
  });
}

function drawDividerPage(pdf, act, index, pageW, pageH) {
  const title = (act.title || 'Activity').trim() || 'Activity';
  const activityNo = 'ACTIVITY ' + (index + 1);
  const pagePad = 44;

  pdf.setFillColor(251, 250, 247);
  pdf.rect(0, 0, pageW, pageH, 'F');

  switch(act.design){
    case 'banner': {
      pdf.setFillColor(28, 48, 42);
      pdf.rect(0, 0, pageW, 110, 'F');
      pdf.setFillColor(65, 98, 81);
      pdf.rect(0, pageH - 82, pageW, 82, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(18);
      pdf.text(activityNo, pageW / 2, 42, {align:'center'});
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(30);
      const lines = pdf.splitTextToSize(title, pageW - 120);
      const yStart = pageH / 2 - ((lines.length - 1) * 24) / 2;
      pdf.text(lines, pageW / 2, yStart, {align:'center'});
      pdf.setDrawColor(255, 255, 255);
      pdf.setLineWidth(1.2);
      pdf.line(pagePad, pageH - 118, pageW - pagePad, pageH - 118);
      break;
    }
    case 'card': {
      pdf.setDrawColor(214, 208, 196);
      pdf.setLineWidth(1.6);
      pdf.roundedRect(pagePad, pagePad + 18, pageW - pagePad * 2, pageH - (pagePad * 2) - 36, 22, 22, 'S');
      pdf.setFillColor(245, 240, 233);
      pdf.roundedRect(pagePad + 18, pagePad + 38, pageW - pagePad * 2 - 36, pageH - (pagePad * 2) - 76, 18, 18, 'F');
      pdf.setFillColor(31, 54, 44);
      pdf.roundedRect(pagePad + 34, pagePad + 62, 120, 28, 8, 8, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(10);
      pdf.text(activityNo, pagePad + 52, pagePad + 82, {align:'left'});
      pdf.setTextColor(28, 27, 25);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(31);
      const lines = pdf.splitTextToSize(title, pageW - pagePad * 3 - 50);
      const yStart = pageH / 2 - ((lines.length - 1) * 26) / 2 + 8;
      pdf.text(lines, pageW / 2, yStart, {align:'center'});
      break;
    }
    case 'grid': {
      pdf.setDrawColor(212, 205, 191);
      pdf.setLineWidth(0.8);
      for(let x = 50; x < pageW - 50; x += 50) pdf.line(x, 40, x, pageH - 40);
      for(let y = 40; y < pageH - 40; y += 50) pdf.line(40, y, pageW - 40, y);
      pdf.setDrawColor(44, 59, 52);
      pdf.setLineWidth(1.5);
      pdf.rect(52, 52, pageW - 104, pageH - 104, 'S');
      pdf.setFillColor(255, 255, 255);
      pdf.roundedRect(pageW / 2 - 75, 80, 150, 26, 10, 10, 'F');
      pdf.setTextColor(28, 27, 25);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(11);
      pdf.text(activityNo, pageW / 2, 98, {align:'center'});
      pdf.setFont('times', 'bold');
      pdf.setFontSize(34);
      const lines = pdf.splitTextToSize(title, pageW - 180);
      const yStart = pageH / 2 - ((lines.length - 1) * 24) / 2;
      pdf.text(lines, pageW / 2, yStart, {align:'center'});
      break;
    }
    case 'classic': {
      pdf.setDrawColor(65, 82, 67);
      pdf.setLineWidth(1.5);
      pdf.line(68, 72, pageW - 68, 72);
      pdf.line(68, pageH - 72, pageW - 68, pageH - 72);
      pdf.setDrawColor(168, 157, 142);
      pdf.line(82, 92, 82, pageH - 92);
      pdf.setTextColor(27, 29, 28);
      pdf.setFont('times', 'bolditalic');
      pdf.setFontSize(15);
      pdf.text('Study log', 98, 98);
      pdf.setFont('times', 'bold');
      pdf.setFontSize(34);
      const lines = pdf.splitTextToSize(title, pageW - 220);
      const yStart = pageH / 2 - ((lines.length - 1) * 28) / 2;
      pdf.text(lines, pageW / 2, yStart, {align:'center'});
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(12);
      pdf.setTextColor(92, 92, 92);
      pdf.text(activityNo, pageW / 2, pageH - 94, {align:'center'});
      break;
    }
    default: {
      pdf.setDrawColor(212, 206, 196);
      pdf.setLineWidth(1.2);
      pdf.rect(42, 42, pageW - 84, pageH - 84, 'S');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(12);
      pdf.setTextColor(76, 97, 79);
      pdf.text(activityNo, pageW / 2, 92, {align:'center'});
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(30);
      const lines = pdf.splitTextToSize(title, pageW - 140);
      const yStart = pageH / 2 - ((lines.length - 1) * 24) / 2;
      pdf.text(lines, pageW / 2, yStart, {align:'center'});
      break;
    }
  }
}

function loadImage(file){
  return new Promise((resolve,reject)=>{
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = ()=>resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function fieldValue(id, fallback){
  return document.getElementById(id).value.trim() || fallback;
}

function renderCoverDesignOptions(){
  const wrap = document.getElementById('coverDesignOptions');
  coverDesignOptions.forEach(opt => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'cover-design-option' + (coverDesign === opt.value ? ' selected' : '');
    option.setAttribute('aria-pressed', coverDesign === opt.value ? 'true' : 'false');
    const swatch = document.createElement('span');
    swatch.className = 'cover-swatch cover-swatch-' + opt.value;
    swatch.appendChild(document.createElement('span'));
    if(opt.value === 'bold' || opt.value === 'color' || opt.value === 'academic'){
      swatch.appendChild(document.createElement('span'));
    }
    const name = document.createElement('span');
    name.textContent = opt.label;
    option.appendChild(swatch);
    option.appendChild(name);
    option.onclick = () => {
      coverDesign = opt.value;
      renderCoverDesignOptions();
    };
    wrap.appendChild(option);
  });
}

function drawCoverPage(pdf, pageW, pageH){
  const student = fieldValue('studentName', 'Student name');
  const group = fieldValue('studentGroup', 'Student group');
  const course = fieldValue('courseName', 'Course name');
  const unit = fieldValue('unitName', 'Unit');
  const title = fieldValue('coverTitle', 'Report title');
  const teacher = fieldValue('teacherName', 'Teacher name');
  const date = fieldValue('coverDate', 'Date');

  pdf.setFillColor(251, 250, 247);
  pdf.rect(0, 0, pageW, pageH, 'F');
  if(coverDesign === 'bold'){
    pdf.setFillColor(28, 48, 42);
    pdf.rect(0, 0, pageW, 116, 'F');
    pdf.setFillColor(65, 98, 81);
    pdf.rect(0, pageH - 68, pageW, 68, 'F');
  } else if(coverDesign === 'academic'){
    pdf.setDrawColor(65, 82, 67);
    pdf.setLineWidth(1.5);
    pdf.line(68, 72, pageW - 68, 72);
    pdf.line(68, pageH - 72, pageW - 68, pageH - 72);
    pdf.setDrawColor(168, 157, 142);
    pdf.line(82, 92, 82, pageH - 92);
  } else if(coverDesign === 'color'){
    pdf.setFillColor(233, 238, 232);
    pdf.rect(0, 0, pageW, pageH, 'F');
    pdf.setFillColor(61, 90, 69);
    pdf.rect(0, 0, 26, pageH, 'F');
    pdf.setFillColor(28, 48, 42);
    pdf.rect(54, 54, pageW - 108, 8, 'F');
  } else {
    pdf.setDrawColor(61, 90, 69);
    pdf.setLineWidth(1.2);
    pdf.line(54, 54, pageW - 54, 54);
    pdf.line(54, pageH - 54, pageW - 54, pageH - 54);
  }

  const lightText = coverDesign === 'bold';
  pdf.setTextColor(lightText ? 255 : 28, lightText ? 255 : 27, lightText ? 255 : 25);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.text(student, 68, 88);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(11);
  pdf.setTextColor(lightText ? 235 : 92, lightText ? 235 : 92, lightText ? 235 : 92);
  pdf.text(group, 68, 108);

  pdf.setTextColor(28, 27, 25);
  pdf.setFont('times', 'bold');
  pdf.setFontSize(28);
  pdf.text(pdf.splitTextToSize(course, pageW - 140), pageW / 2, pageH / 2 - 58, {align:'center'});
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(14);
  pdf.setTextColor(76, 97, 79);
  pdf.text(unit, pageW / 2, pageH / 2 - 20, {align:'center'});
  pdf.setFont('times', 'normal');
  pdf.setFontSize(22);
  pdf.setTextColor(28, 27, 25);
  pdf.text(pdf.splitTextToSize(title, pageW - 140), pageW / 2, pageH / 2 + 28, {align:'center'});

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(11);
  pdf.setTextColor(92, 92, 92);
  pdf.text(teacher, 68, pageH - 84);
  pdf.text(date, pageW - 68, pageH - 84, {align:'right'});
}

document.getElementById('addActivity').onclick = addActivity;
addActivity();
initializing = false;
renderCoverDesignOptions();
setActiveActivity(activities[0].id);
Object.keys(savedFieldConfig).forEach(loadSavedField);
document.getElementById('coverDate').value = new Date().toISOString().slice(0, 10);
restoreImages();
document.querySelectorAll('[data-save-field]').forEach(button => {
  button.onclick = () => saveField(button.dataset.saveField);
});
document.querySelectorAll('[data-clear-field]').forEach(button => {
  button.onclick = () => {
    localStorage.removeItem(savedFieldConfig[button.dataset.clearField].storageKey);
    loadSavedField(button.dataset.clearField);
  };
});
document.getElementById('resetImages').onclick = resetImages;

document.addEventListener('paste', event => {
  if(document.getElementById('editor').hidden || !event.clipboardData?.items.length) return;
  const hasImage = Array.from(event.clipboardData.items).some(item => item.kind === 'file' && item.type.startsWith('image/'));
  if(!hasImage) return;
  event.preventDefault();
  pasteImagesIntoActiveActivity(event.clipboardData);
});

document.getElementById('generate').onclick = async ()=>{
  const status = document.getElementById('status');
  const btn = document.getElementById('generate');
  const withImages = activities.filter(a=>a.files.length);
  if(!withImages.length){
    status.textContent = 'Add at least one image.';
    return;
  }
  btn.disabled = true;
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({unit:'pt', format:'a4'});
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  drawCoverPage(pdf, pageW, pageH);
  for(const [index, act] of withImages.entries()){
    status.textContent = 'Adding: ' + act.title;
    pdf.addPage();
    drawDividerPage(pdf, act, activities.findIndex(item => item.id === act.id), pageW, pageH);
    for(const file of act.files){
      pdf.addPage();
      try{
        const img = await loadImage(file);
        const margin = 30;
        const maxW = pageW - margin*2;
        const maxH = pageH - margin*2;
        const compressionMax = 1600;
        const sourceScale = Math.min(1, compressionMax / Math.max(img.width, img.height));
        let w = img.width * sourceScale, h = img.height * sourceScale;
        const scale = Math.min(maxW/w, maxH/h);
        w *= scale; h *= scale;
        const x = (pageW - w)/2;
        const y2 = (pageH - h)/2;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w);
        canvas.height = Math.round(h);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(img,0,0);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
        pdf.addImage(dataUrl, 'JPEG', x, y2, w, h);
      }catch(err){
        pdf.setFontSize(12);
        pdf.text('Could not load: ' + file.name, 40, 60);
      }
    }
  }

  if(previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(pdf.output('blob'));
  document.getElementById('previewFrame').src = previewUrl;
  document.getElementById('editor').hidden = true;
  document.getElementById('preview').hidden = false;
  status.textContent = 'Preview ready.';
  btn.disabled = false;
};

document.getElementById('backToEdit').onclick = ()=>{
  document.getElementById('preview').hidden = true;
  document.getElementById('editor').hidden = false;
};

document.getElementById('download').onclick = ()=>{
  if(!previewUrl) return;
  const link = document.createElement('a');
  link.href = previewUrl;
  const requestedName = document.getElementById('pdfName').value.trim() || 'activities';
  const safeName = requestedName.replace(/[\\/:*?"<>|]+/g, '-').replace(/\.pdf$/i, '').trim() || 'activities';
  link.download = safeName + '.pdf';
  link.click();
};
