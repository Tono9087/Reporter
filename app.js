let activities = [];
let counter = 0;
let previewUrl = null;
let activeActivityId = null;
let coverDesign = 'modern';
let initializing = true;
let pendingUploads = 0;
const pdfWorkerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
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

function nextActivityNumber(){
  let maxNum = 0;
  activities.forEach(act => {
    const parsed = parseFloat(act.number);
    if(Number.isFinite(parsed) && parsed > maxNum){
      maxNum = Math.floor(parsed);
    }
  });
  return String(maxNum > 0 ? maxNum + 1 : activities.length + 1);
}

function getActivityNumber(act, index){
  const raw = String(act?.number ?? '').trim();
  return raw || String(index + 1);
}

function formatIndexNumber(activityNumber){
  const text = String(activityNumber);
  return /^\d+$/.test(text) ? text.padStart(2, '0') : text;
}

function addActivity(){
  const id = counter++;
  const num = nextActivityNumber();
  activities.push({id, number:num, customNumber:false, title:'Activity ' + num, files:[], design:'minimal'});
  render();
  if(!initializing) persistImages();
}

function removeActivity(id){
  activities = activities.filter(a=>a.id!==id);
  activities.forEach((act, idx)=>{
    if(!act.customNumber) act.number = String(idx + 1);
    if(!act.title) act.title = 'Activity ' + getActivityNumber(act, idx);
  });
  render();
  persistImages();
}

function isPdfFile(file){
  return Boolean(file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')));
}

function isImageFile(file){
  return Boolean(file && file.type && file.type.startsWith('image/'));
}

function ensurePdfJsWorker(){
  if(window.pdfjsLib?.GlobalWorkerOptions && !window.pdfjsLib.GlobalWorkerOptions.workerSrc){
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
  }
}

function canvasToJpegBlob(canvas, quality){
  return new Promise((resolve, reject) => {
    const fallbackFromDataUrl = () => {
      try{
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const parts = dataUrl.split(',');
        const mimeMatch = parts[0].match(/:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
        const binary = atob(parts[1]);
        const bytes = new Uint8Array(binary.length);
        for(let i = 0; i < binary.length; i++){
          bytes[i] = binary.charCodeAt(i);
        }
        resolve(new Blob([bytes], {type:mime}));
      }catch(err){
        reject(err);
      }
    };
    if(typeof canvas.toBlob === 'function'){
      canvas.toBlob(blob => {
        if(blob) resolve(blob);
        else fallbackFromDataUrl();
      }, 'image/jpeg', quality);
    } else {
      fallbackFromDataUrl();
    }
  });
}

async function extractPdfPages(file){
  if(!window.pdfjsLib){
    throw new Error('PDF library is not loaded.');
  }
  ensurePdfJsWorker();
  const data = await file.arrayBuffer();
  const pdfDoc = await window.pdfjsLib.getDocument({
    data,
    cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/standard_fonts/'
  }).promise;
  const pages = [];
  const sourceName = file.name || 'document.pdf';
  const baseName = sourceName.replace(/\.pdf$/i, '') || 'document';
  try{
    for(let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++){
      const page = await pdfDoc.getPage(pageNum);
      let canvas = null;
      try{
        const baseViewport = page.getViewport({scale:1});
        const scale = 1600 / Math.max(baseViewport.width, baseViewport.height, 1);
        const viewport = page.getViewport({scale});
        canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const ctx = canvas.getContext('2d');
        if(!ctx) throw new Error('Canvas 2D context is unavailable.');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({canvasContext:ctx, viewport}).promise;
        const blob = await canvasToJpegBlob(canvas, 0.85);
        const pageFile = new File([blob], baseName + '-p' + pageNum + '.jpg', {type:'image/jpeg'});
        pageFile.sourcePdf = sourceName;
        pageFile.sourcePage = pageNum;
        pages.push(pageFile);
      } finally {
        if(canvas){
          canvas.width = 0;
          canvas.height = 0;
        }
        page.cleanup?.();
      }
    }
  } finally {
    await pdfDoc.destroy?.();
  }
  return pages;
}

async function addFiles(id, fileList){
  const incoming = Array.from(fileList || []);
  const act = activities.find(a=>a.id===id);
  if(!act || !incoming.length) return;

  const hasPdf = incoming.some(isPdfFile);
  const generateBtn = document.getElementById('generate');
  const status = document.getElementById('status');
  let hasError = false;

  if(hasPdf){
    pendingUploads++;
    act.pendingPdfCount = (act.pendingPdfCount || 0) + 1;
    act.loadingPdf = true;
    if(generateBtn) generateBtn.disabled = true;
    render();
  }

  try{
    for(const f of incoming){
      if(!activities.includes(act)) break;
      if(isImageFile(f)){
        act.files.push(f);
      } else if(isPdfFile(f)){
        const pdfName = f.name || 'document.pdf';
        if(status) status.textContent = 'Loading PDF: ' + pdfName + '...';
        try{
          const pages = await extractPdfPages(f);
          if(activities.includes(act)) act.files.push(...pages);
        }catch(error){
          console.warn('Could not read PDF.', error);
          hasError = true;
          if(status) status.textContent = 'Could not read PDF: ' + pdfName;
        }
      }
    }
  } finally {
    if(hasPdf){
      pendingUploads = Math.max(0, pendingUploads - 1);
      act.pendingPdfCount = Math.max(0, (act.pendingPdfCount || 1) - 1);
      act.loadingPdf = act.pendingPdfCount > 0;
      if(generateBtn && pendingUploads === 0) generateBtn.disabled = false;
      if(!hasError && pendingUploads === 0 && status && status.textContent.startsWith('Loading PDF: ')){
        status.textContent = '';
      }
    }
    render();
    await persistImages();
  }
}

function isSupportedClipboardItem(item){
  if(item.kind !== 'file') return false;
  if(item.type.startsWith('image/') || item.type === 'application/pdf') return true;
  return isPdfFile(item.getAsFile());
}

function addPastedImages(id, clipboardData){
  const pastedFiles = [];
  for(const item of clipboardData.items){
    if(item.kind !== 'file') continue;
    const blob = item.getAsFile();
    if(!blob) continue;
    if(item.type.startsWith('image/')){
      pastedFiles.push(new File([blob], blob.name || ('pasted-image-' + Date.now() + '.png'), {type:blob.type || 'image/png'}));
    } else if(item.type === 'application/pdf' || isPdfFile(blob)){
      pastedFiles.push(new File([blob], blob.name || ('pasted-pdf-' + Date.now() + '.pdf'), {type:'application/pdf'}));
    }
  }
  if(pastedFiles.length) addFiles(id, pastedFiles);
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
  const records = [];
  activities.forEach((activity, activityIndex) => {
    activity.files.forEach((file, fileIndex) => {
      records.push({
        activityIndex,
        fileIndex,
        name:file.name,
        type:file.type,
        blob:file,
        sourcePdf:file.sourcePdf || null,
        sourcePage:file.sourcePage || null
      });
    });
  });
  try{
    const db = await openImageDb();
    const transaction = db.transaction(imageStoreName, 'readwrite');
    const store = transaction.objectStore(imageStoreName);
    store.clear();
    records.forEach(record => {
      store.put(record, record.activityIndex + ':' + record.fileIndex);
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
      const records = request.result.slice().sort((a, b) =>
        (a.activityIndex - b.activityIndex) || ((a.fileIndex ?? 0) - (b.fileIndex ?? 0))
      );
      records.forEach(record => {
        while(!activities[record.activityIndex]){
          const id = counter++;
          const num = nextActivityNumber();
          activities.push({id, number:num, customNumber:false, title:'Activity ' + num, files:[], design:'minimal'});
        }
        const restoredFile = new File([record.blob], record.name, {type:record.type});
        if(record.sourcePdf) restoredFile.sourcePdf = record.sourcePdf;
        if(record.sourcePage) restoredFile.sourcePage = record.sourcePage;
        activities[record.activityIndex].files.push(restoredFile);
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
  activities.forEach((act, idx)=>{
    const div = document.createElement('div');
    div.className = 'activity';
    div.dataset.activityId = act.id;
    div.onmouseenter = () => setActiveActivity(act.id);

    const head = document.createElement('div');
    head.className = 'activity-head';

    const numWrap = document.createElement('label');
    numWrap.className = 'activity-num-wrap';
    numWrap.title = 'Activity number (e.g. 1, 1.5, 2)';
    const numLabel = document.createElement('span');
    numLabel.textContent = '#';
    const numInput = document.createElement('input');
    numInput.type = 'text';
    numInput.className = 'activity-num';
    numInput.inputMode = 'decimal';
    numInput.value = act.number ?? '';
    numInput.placeholder = String(idx + 1);
    numInput.setAttribute('aria-label', 'Activity number');
    numInput.oninput = e => {
      act.number = e.target.value;
      act.customNumber = Boolean(e.target.value.trim());
    };
    numWrap.appendChild(numLabel);
    numWrap.appendChild(numInput);

    const input = document.createElement('input');
    input.type = 'text';
    input.value = act.title;
    input.oninput = e => act.title = e.target.value;

    const rm = document.createElement('button');
    rm.className = 'remove-act';
    rm.textContent = 'Remove';
    rm.onclick = ()=>removeActivity(act.id);
    head.appendChild(numWrap);
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
    drop.className = 'drop' + (act.loadingPdf ? ' loading' : '');
    drop.textContent = act.loadingPdf ? 'Loading PDF pages...' : 'Click, drop, or paste images or PDFs here';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*,application/pdf,.pdf';
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
        t.title = f.sourcePdf ? (f.sourcePdf + ' (page ' + f.sourcePage + ')') : f.name;
        const img = document.createElement('img');
        const thumbUrl = URL.createObjectURL(f);
        img.onload = () => URL.revokeObjectURL(thumbUrl);
        img.onerror = () => URL.revokeObjectURL(thumbUrl);
        img.src = thumbUrl;
        const x = document.createElement('div');
        x.className = 'x';
        x.textContent = '×';
        x.onclick = ()=>removeFile(act.id, idx);
        t.appendChild(img);
        if(f.sourcePdf){
          const badge = document.createElement('div');
          badge.className = 'pdf-badge';
          badge.textContent = 'PDF p.' + f.sourcePage;
          t.appendChild(badge);
        }
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
  const activityNo = 'ACTIVITY ' + getActivityNumber(act, index);
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
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(10);
      const badgeW = Math.max(120, pdf.getTextWidth(activityNo) + 36);
      pdf.setFillColor(31, 54, 44);
      pdf.roundedRect(pagePad + 34, pagePad + 62, badgeW, 28, 8, 8, 'F');
      pdf.setTextColor(255, 255, 255);
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
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(11);
      const pillW = Math.max(150, pdf.getTextWidth(activityNo) + 36);
      pdf.setFillColor(255, 255, 255);
      pdf.roundedRect(pageW / 2 - pillW / 2, 80, pillW, 26, 10, 10, 'F');
      pdf.setTextColor(28, 27, 25);
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

function loadImageFromDataUrl(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = () => reject(reader.error || new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(file){
  return new Promise((resolve,reject)=>{
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = ()=>{
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = ()=>{
      URL.revokeObjectURL(url);
      loadImageFromDataUrl(file).then(resolve, reject);
    };
    img.src = url;
  });
}

function fieldValue(id, fallback){
  return document.getElementById(id).value.trim() || fallback;
}

function suggestedPdfName(){
  const studentName = document.getElementById('studentName').value.trim();
  const reportTitle = document.getElementById('coverTitle').value.trim();
  const parts = [studentName, reportTitle]
    .filter(Boolean)
    .join('_')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]+/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return parts || 'activities';
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
  pdf.text('Teacher: ' + teacher, 68, pageH - 84);
  pdf.text(date, pageW - 68, pageH - 84, {align:'right'});
}

function buildIndexPages(pdf, allActivities, withImages, pageW, pageH){
  const marginX = 64;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10.5);
  const maxNumW = withImages.reduce((max, act) => {
    const idx = allActivities.findIndex(item => item.id === act.id);
    const numStr = formatIndexNumber(getActivityNumber(act, idx));
    return Math.max(max, pdf.getTextWidth(numStr));
  }, 0);
  const numColWidth = Math.max(34, Math.ceil(maxNumW) + 12);
  const pageColWidth = 56;
  const titleX = marginX + numColWidth;
  const maxTitleW = pageW - titleX - marginX - pageColWidth;
  const firstPageStartY = 192;
  const contPageStartY = 152;
  const contentBottomY = pageH - 92;
  const lineHeight = 16;
  const rowGap = 14;

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(12);

  const pages = [[]];
  let currentY = firstPageStartY;

  const entries = withImages.map(act => {
    const activityIndex = allActivities.findIndex(item => item.id === act.id);
    const activityNumber = getActivityNumber(act, activityIndex);
    const title = (act.title || 'Activity').trim() || 'Activity';
    const lines = pdf.splitTextToSize(title, maxTitleW);
    const rowHeight = Math.max(1, lines.length) * lineHeight + rowGap;
    return {
      activityNumber,
      lines,
      fileCount: act.files.length,
      rowHeight,
      startPage: 0
    };
  });

  entries.forEach(entry => {
    if(pages[pages.length - 1].length > 0 && currentY + entry.rowHeight > contentBottomY){
      pages.push([]);
      currentY = contPageStartY;
    }
    pages[pages.length - 1].push(entry);
    currentY += entry.rowHeight;
  });

  let nextPage = 2 + pages.length;
  entries.forEach(entry => {
    entry.startPage = nextPage;
    nextPage += 1 + entry.fileCount;
  });

  return { pages, totalActivities: entries.length, totalPages: nextPage - 1, numColWidth };
}

function drawIndexPage(pdf, entries, pageIndex, totalActivities, totalPages, pageW, pageH, numColWidth = 34){
  const ruleX = 54;
  const marginX = 64;
  const titleX = marginX + numColWidth;
  const lineHeight = 16;

  pdf.setFillColor(251, 250, 247);
  pdf.rect(0, 0, pageW, pageH, 'F');
  pdf.setDrawColor(61, 90, 69);
  pdf.setLineWidth(1.2);
  pdf.line(ruleX, 54, pageW - ruleX, 54);
  pdf.line(ruleX, pageH - 54, pageW - ruleX, pageH - 54);

  let headerY;
  if(pageIndex === 0){
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.setTextColor(61, 90, 69);
    pdf.text('CONTENTS', marginX, 82);

    pdf.setFont('times', 'bold');
    pdf.setFontSize(26);
    pdf.setTextColor(28, 27, 25);
    pdf.text('Index', marginX, 110);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(138, 132, 120);
    pdf.text('Starting page of each activity', marginX, 128);
    headerY = 156;
  } else {
    pdf.setFont('times', 'bold');
    pdf.setFontSize(18);
    pdf.setTextColor(28, 27, 25);
    pdf.text('Index (continued)', marginX, 88);
    headerY = 116;
  }

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.setTextColor(138, 132, 120);
  pdf.text('ACTIVITY', marginX, headerY);
  pdf.text('PAGE', pageW - marginX, headerY, {align:'right'});

  pdf.setDrawColor(216, 211, 200);
  pdf.setLineWidth(0.75);
  pdf.line(marginX, headerY + 8, pageW - marginX, headerY + 8);
  let y = headerY + 36;

  entries.forEach(entry => {
    const numStr = formatIndexNumber(entry.activityNumber);
    const pageText = String(entry.startPage);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10.5);
    pdf.setTextColor(61, 90, 69);
    pdf.text(numStr, marginX, y);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(12);
    pdf.setTextColor(28, 27, 25);
    entry.lines.forEach((line, lineIdx) => {
      pdf.text(line, titleX, y + lineIdx * lineHeight);
    });
    const firstLineW = pdf.getTextWidth(entry.lines[0] || '');

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.setTextColor(28, 27, 25);
    pdf.text(pageText, pageW - marginX, y, {align:'right'});
    const pageTextW = pdf.getTextWidth(pageText);

    if(entry.lines.length === 1){
      const leaderStart = titleX + firstLineW + 10;
      const leaderEnd = pageW - marginX - pageTextW - 10;
      if(leaderEnd > leaderStart + 12){
        pdf.setDrawColor(216, 211, 200);
        pdf.setLineWidth(0.6);
        pdf.line(leaderStart, y - 3, leaderEnd, y - 3);
      }
    }

    if(typeof pdf.link === 'function'){
      pdf.link(marginX - 4, y - 12, pageW - marginX * 2 + 8, entry.rowHeight - 4, {pageNumber: entry.startPage});
    }

    y += entry.rowHeight;
  });

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9.5);
  pdf.setTextColor(138, 132, 120);
  const actLabel = totalActivities === 1 ? 'activity' : 'activities';
  pdf.text(totalActivities + ' ' + actLabel + ' · ' + totalPages + ' pages', marginX, pageH - 68);
  pdf.text('Page ' + (pageIndex + 2) + ' of ' + totalPages, pageW - marginX, pageH - 68, {align:'right'});
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
  const hasSupportedFile = Array.from(event.clipboardData.items).some(isSupportedClipboardItem);
  if(!hasSupportedFile) return;
  event.preventDefault();
  pasteImagesIntoActiveActivity(event.clipboardData);
});

async function fileToPdfJpegData(file, img, imgW, imgH){
  if(file.sourcePdf && file.type === 'image/jpeg'){
    const bytes = new Uint8Array(await file.arrayBuffer());
    if(bytes.length > 0) return bytes;
  }
  const compressionMax = 1600;
  const sourceScale = Math.min(1, compressionMax / Math.max(imgW, imgH));
  const compressedW = Math.max(1, Math.round(imgW * sourceScale));
  const compressedH = Math.max(1, Math.round(imgH * sourceScale));
  const canvas = document.createElement('canvas');
  canvas.width = compressedW;
  canvas.height = compressedH;
  try{
    const ctx = canvas.getContext('2d');
    if(!ctx) throw new Error('Canvas 2D context is unavailable.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
    if(!dataUrl || !dataUrl.startsWith('data:image/jpeg')){
      throw new Error('Could not encode image as JPEG.');
    }
    return dataUrl;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

document.getElementById('generate').onclick = async ()=>{
  const status = document.getElementById('status');
  const btn = document.getElementById('generate');
  if(pendingUploads > 0){
    status.textContent = 'Please wait for PDF pages to finish loading.';
    return;
  }
  const withImages = activities.filter(a=>a.files.length);
  if(!withImages.length){
    status.textContent = 'Add at least one image or PDF.';
    return;
  }
  btn.disabled = true;
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({unit:'pt', format:'a4'});
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  drawCoverPage(pdf, pageW, pageH);
  const indexData = buildIndexPages(pdf, activities, withImages, pageW, pageH);
  indexData.pages.forEach((entries, pageIndex) => {
    pdf.addPage();
    drawIndexPage(pdf, entries, pageIndex, indexData.totalActivities, indexData.totalPages, pageW, pageH, indexData.numColWidth);
  });
  for(const act of withImages){
    status.textContent = 'Adding: ' + act.title;
    pdf.addPage();
    drawDividerPage(pdf, act, activities.findIndex(item => item.id === act.id), pageW, pageH);
    for(const file of act.files){
      pdf.addPage();
      try{
        const img = await loadImage(file);
        const imgW = img.naturalWidth || img.width;
        const imgH = img.naturalHeight || img.height;
        if(!imgW || !imgH) throw new Error('Image has zero dimensions.');
        const margin = 30;
        const maxW = pageW - margin*2;
        const maxH = pageH - margin*2;
        const scale = Math.min(maxW/imgW, maxH/imgH);
        const w = imgW * scale;
        const h = imgH * scale;
        const x = (pageW - w)/2;
        const y2 = (pageH - h)/2;
        const jpegData = await fileToPdfJpegData(file, img, imgW, imgH);
        pdf.addImage(jpegData, 'JPEG', x, y2, w, h);
      }catch(err){
        console.warn('Could not load page into PDF:', file.name, err);
        pdf.setFontSize(12);
        pdf.text('Could not load: ' + file.name, 40, 60);
      }
    }
  }

  if(previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(pdf.output('blob'));
  document.getElementById('pdfName').value = suggestedPdfName();
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
