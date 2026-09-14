let activities = [];
let counter = 0;
let previewUrl = null;

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
}

function removeActivity(id){
  activities = activities.filter(a=>a.id!==id);
  activities.forEach((act, idx)=>{ act.title = act.title || 'Activity ' + (idx + 1); if(!act.title.startsWith('Activity')) act.title = 'Activity ' + (idx + 1); });
  render();
}

function addFiles(id, fileList){
  const act = activities.find(a=>a.id===id);
  for(const f of fileList){
    if(f.type.startsWith('image/')) act.files.push(f);
  }
  render();
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

function removeFile(id, idx){
  const act = activities.find(a=>a.id===id);
  act.files.splice(idx,1);
  render();
}

function render(){
  const wrap = document.getElementById('activities');
  wrap.innerHTML = '';
  activities.forEach((act)=>{
    const div = document.createElement('div');
    div.className = 'activity';

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
    drop.onpaste = e => {
      e.preventDefault();
      addPastedImages(act.id, e.clipboardData);
    };

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

document.getElementById('addActivity').onclick = addActivity;
addActivity();

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

  for(const [index, act] of withImages.entries()){
    status.textContent = 'Adding: ' + act.title;
    if(index > 0) pdf.addPage();
    drawDividerPage(pdf, act, activities.findIndex(item => item.id === act.id), pageW, pageH);
    for(const file of act.files){
      pdf.addPage();
      try{
        const img = await loadImage(file);
        const margin = 30;
        const maxW = pageW - margin*2;
        const maxH = pageH - margin*2;
        let w = img.width, h = img.height;
        const scale = Math.min(maxW/w, maxH/h);
        w *= scale; h *= scale;
        const x = (pageW - w)/2;
        const y2 = (pageH - h)/2;
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(img,0,0);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
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
