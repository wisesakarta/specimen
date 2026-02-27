import Style from 'site/data/style'
import VariableFont from 'site/data/variable_font'

export async function loadFont(item, path){ 
  item.fontFace(path).forEach(async (font) => {
    await font.load();
    document.fonts.add(font);
  });
}

export async function loadFonts(container){
  (container || document).querySelectorAll('*[data-font-id]').forEach(async (e) => {
    if (e.dataset.fontType == 'style'){
      loadAndStyleStatic(e);
    } else {
      loadAndStyleVariable(e);
    }
  });
}

async function loadAndStyleStatic(e){
  e.dataset.fontId.split(',').forEach(async (id, i) => {
    let style = await Style.find(id);
    loadAndSetStyle(style, i, e);
  });
}

async function loadAndStyleVariable(e){
  e.dataset.fontId.split(',').forEach(async (id, i) => {
    let variable_font = await VariableFont.find(id);
    loadAndSetStyle(variable_font, i, e);
  });
}

function loadAndSetStyle(item, i, e){
  if (!item) return; 
 
  if (i == 0){
    item.loadAndSetStyle(e);
  } else {
    loadFont(item, e.dataset.fontFile);
  }
};
