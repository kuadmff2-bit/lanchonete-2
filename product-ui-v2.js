(() => {
  function setup(){
    if(!document.body.classList.contains('admin-view')) return;
    const tab=document.getElementById('tab-products'),form=document.getElementById('productForm'),list=document.getElementById('productList');
    if(!tab||!form||!list||document.getElementById('productEditorV2')) return;
    const grid=tab.querySelector('.admin-grid'),formCard=form.closest('.admin-card'),listCard=list.closest('.product-list-card')||list.closest('.admin-card'),heading=tab.querySelector('.panel-heading');
    if(!grid||!formCard||!listCard||!heading) return;
    const add=document.createElement('button');add.type='button';add.id='productV2Add';add.textContent='Adicionar produto';heading.appendChild(add);
    const overlay=document.createElement('div');overlay.id='productEditorV2';overlay.className='product-editor-v2';overlay.hidden=true;overlay.innerHTML='<div class="product-editor-v2-backdrop" data-product-v2-close></div><section class="product-editor-v2-dialog" role="dialog" aria-modal="true" aria-label="Produto"><div class="product-editor-v2-head"><div><small>CARDÁPIO</small><strong id="productV2Title">Adicionar produto</strong></div><button type="button" class="product-editor-v2-close" data-product-v2-close aria-label="Fechar">×</button></div><div id="productV2Host"></div></section>';
    document.body.appendChild(overlay);overlay.querySelector('#productV2Host').appendChild(formCard);grid.classList.add('product-v2-grid');if(grid.children.length===1&&grid.firstElementChild===listCard)grid.style.display='block';
    const title=overlay.querySelector('#productV2Title');function syncTitle(){title.textContent=(document.getElementById('productFormTitle')?.textContent||'Adicionar produto').trim()}function open(reset=false){if(reset)document.getElementById('cancelEdit')?.click();syncTitle();overlay.hidden=false;document.body.style.overflow='hidden';setTimeout(()=>document.getElementById('productName')?.focus(),80)}function close(reset=true){if(reset)document.getElementById('cancelEdit')?.click();overlay.hidden=true;document.body.style.overflow=''}
    add.addEventListener('click',()=>open(true));overlay.querySelectorAll('[data-product-v2-close]').forEach(el=>el.addEventListener('click',()=>close(true)));document.getElementById('cancelEdit')?.addEventListener('click',()=>{if(!overlay.hidden)setTimeout(()=>close(false),0)});
    list.addEventListener('click',event=>{const edit=event.target.closest('[data-edit-product]'),photo=event.target.closest('[data-photo-product]');if(edit||photo)setTimeout(()=>{syncTitle();overlay.hidden=false;document.body.style.overflow='hidden'},0)});
    form.addEventListener('submit',()=>{let tries=0;const timer=setInterval(()=>{tries++;const h=(document.getElementById('productFormTitle')?.textContent||'').toLowerCase(),s=(document.getElementById('productStatus')?.textContent||'').toLowerCase();if((h.includes('adicionar')&&/(adicionado|atualizado|salvo)/.test(s))||tries>30){clearInterval(timer);if(tries<=30)close(false)}},180)});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(setup,0),{once:true});else setTimeout(setup,0);
})();